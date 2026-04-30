import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import OpenAI from 'openai'
import { spawn } from 'child_process'
import path from 'path'
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import * as yup from 'yup'
import fs from 'fs'

const app = express()
app.use(cors())
app.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      try {
        req.rawBody = buf
      } catch {
      }
    },
  }),
)

app.get('*', (req, res, next) => {
  try {
    if (req.method !== 'GET') return next()
    const accept = String(req.headers['accept-encoding'] || '')
    const urlPath = req.path
    if (!urlPath.startsWith('/assets/') && !urlPath.endsWith('.js') && !urlPath.endsWith('.css')) return next()
    const distPath = path.join(process.cwd(), 'dist')
    const filePath = path.join(distPath, urlPath)
    const ext = path.extname(filePath)
    if (!ext) return next()
    res.setHeader('Vary', 'Accept-Encoding')
    if (accept.includes('br') && fs.existsSync(`${filePath}.br`)) {
      res.setHeader('Content-Encoding', 'br')
      res.type(ext)
      return res.sendFile(`${filePath}.br`)
    }
    if (accept.includes('gzip') && fs.existsSync(`${filePath}.gz`)) {
      res.setHeader('Content-Encoding', 'gzip')
      res.type(ext)
      return res.sendFile(`${filePath}.gz`)
    }
    return next()
  } catch {
    return next()
  }
})

app.use(express.static(path.join(process.cwd(), 'dist')))

const GITHUB_CLIENT_ID = String(process.env.GITHUB_CLIENT_ID || '')
const GITHUB_CLIENT_SECRET = String(process.env.GITHUB_CLIENT_SECRET || '')
const GITHUB_WEBHOOK_SECRET = String(process.env.GITHUB_WEBHOOK_SECRET || '')
const GITHUB_OAUTH_REDIRECT_URL = String(process.env.GITHUB_OAUTH_REDIRECT_URL || 'http://localhost:3001/api/github/oauth/callback')
const APP_ORIGIN = String(process.env.APP_ORIGIN || 'http://localhost:5173')

const ghSessions = new Map()
const ghStates = new Map()
const ghEvents = []

function parseCookies(header) {
  const out = {}
  const raw = String(header || '')
  if (!raw) return out
  raw.split(';').forEach((part) => {
    const [k, ...rest] = part.split('=')
    const key = String(k || '').trim()
    if (!key) return
    const value = rest.join('=').trim()
    out[key] = decodeURIComponent(value)
  })
  return out
}

function setCookie(res, name, value, opts) {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  if (opts?.maxAgeSeconds) parts.push(`Max-Age=${Math.floor(opts.maxAgeSeconds)}`)
  if (opts?.path) parts.push(`Path=${opts.path}`)
  if (opts?.httpOnly) parts.push('HttpOnly')
  if (opts?.sameSite) parts.push(`SameSite=${opts.sameSite}`)
  if (opts?.secure) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}

function getOrCreateSessionId(req, res) {
  const cookies = parseCookies(req.headers.cookie)
  const existing = String(cookies.gh_sid || '').trim()
  if (existing) return existing
  const sid = randomBytes(16).toString('hex')
  setCookie(res, 'gh_sid', sid, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: Boolean(process.env.NODE_ENV === 'production'),
    maxAgeSeconds: 60 * 60 * 24 * 30,
  })
  return sid
}

async function githubApiFetch(token, url, init) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'agri-cloud',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  })

  const remaining = Number(res.headers.get('x-ratelimit-remaining') || '0')
  const reset = Number(res.headers.get('x-ratelimit-reset') || '0')
  const scope = String(res.headers.get('x-oauth-scopes') || '')

  const text = await res.text()
  const data = text ? (() => { try { return JSON.parse(text) } catch { return { raw: text } } })() : null

  return { ok: res.ok, status: res.status, data, remaining, reset, scope }
}

function requireGitHubSession(req, res) {
  const cookies = parseCookies(req.headers.cookie)
  const sid = String(cookies.gh_sid || '').trim()
  const s = sid ? ghSessions.get(sid) : null
  if (!s || !s.token) {
    res.status(401).json({ error: 'GitHub not connected.' })
    return null
  }
  return { sid, token: s.token, scope: s.scope || '' }
}

app.get('/api/github/status', (req, res) => {
  const cookies = parseCookies(req.headers.cookie)
  const sid = String(cookies.gh_sid || '').trim()
  const s = sid ? ghSessions.get(sid) : null
  res.json({ connected: Boolean(s?.token), scope: String(s?.scope || '') })
})

app.post('/api/github/disconnect', (req, res) => {
  const cookies = parseCookies(req.headers.cookie)
  const sid = String(cookies.gh_sid || '').trim()
  if (sid) ghSessions.delete(sid)
  res.json({ ok: true })
})

app.get('/api/github/oauth/start', (req, res) => {
  if (!GITHUB_CLIENT_ID) return res.status(500).json({ error: 'GitHub OAuth is not configured (missing GITHUB_CLIENT_ID).' })
  const sid = getOrCreateSessionId(req, res)
  const state = randomBytes(16).toString('hex')
  ghStates.set(sid, { state, exp: Date.now() + 10 * 60 * 1000 })
  const scope = encodeURIComponent('read:user repo admin:repo_hook')
  const authorizeUrl =
    `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(GITHUB_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(GITHUB_OAUTH_REDIRECT_URL)}` +
    `&scope=${scope}&state=${encodeURIComponent(state)}`
  res.redirect(authorizeUrl)
})

app.get('/api/github/oauth/callback', async (req, res) => {
  const sid = getOrCreateSessionId(req, res)
  const code = String(req.query.code || '').trim()
  const state = String(req.query.state || '').trim()
  const record = ghStates.get(sid)
  ghStates.delete(sid)

  if (!code) return res.redirect(`${APP_ORIGIN}/admin/github?error=${encodeURIComponent('Missing code')}`)
  if (!record || !record.state || record.state !== state || record.exp < Date.now()) {
    return res.redirect(`${APP_ORIGIN}/admin/github?error=${encodeURIComponent('Invalid OAuth state')}`)
  }
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return res.redirect(`${APP_ORIGIN}/admin/github?error=${encodeURIComponent('GitHub OAuth not configured')}`)
  }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'agri-cloud' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_OAUTH_REDIRECT_URL,
      }),
    })
    const tokenJson = await tokenRes.json().catch(() => null)
    const token = tokenJson && typeof tokenJson.access_token === 'string' ? tokenJson.access_token : ''
    if (!token) return res.redirect(`${APP_ORIGIN}/admin/github?error=${encodeURIComponent('Failed to get access token')}`)

    const check = await githubApiFetch(token, 'https://api.github.com/user', { method: 'GET' })
    if (!check.ok) return res.redirect(`${APP_ORIGIN}/admin/github?error=${encodeURIComponent('Token validation failed')}`)

    ghSessions.set(sid, { token, scope: check.scope, createdAt: Date.now() })
    res.redirect(`${APP_ORIGIN}/admin/github?connected=1`)
  } catch {
    res.redirect(`${APP_ORIGIN}/admin/github?error=${encodeURIComponent('OAuth callback failed')}`)
  }
})

app.get('/api/github/repos', async (req, res) => {
  const s = requireGitHubSession(req, res)
  if (!s) return
  const r = await githubApiFetch(s.token, 'https://api.github.com/user/repos?per_page=100&sort=updated', { method: 'GET' })
  if (r.status === 401) {
    ghSessions.delete(s.sid)
    return res.status(401).json({ error: 'GitHub token expired. Reconnect.' })
  }
  if (!r.ok) {
    if (r.status === 403 && r.remaining === 0) return res.status(429).json({ error: 'GitHub rate limit exceeded', reset: r.reset })
    return res.status(r.status).json({ error: 'GitHub API error', details: r.data })
  }
  res.json({ items: r.data, scope: r.scope })
})

app.get('/api/github/repos/:owner/:repo/issues', async (req, res) => {
  const s = requireGitHubSession(req, res)
  if (!s) return
  const owner = encodeURIComponent(String(req.params.owner || ''))
  const repo = encodeURIComponent(String(req.params.repo || ''))
  const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=30`
  const r = await githubApiFetch(s.token, url, { method: 'GET' })
  if (!r.ok) {
    if (r.status === 403 && r.remaining === 0) return res.status(429).json({ error: 'GitHub rate limit exceeded', reset: r.reset })
    return res.status(r.status).json({ error: 'GitHub API error', details: r.data })
  }
  res.json({ items: r.data })
})

app.get('/api/github/repos/:owner/:repo/pulls', async (req, res) => {
  const s = requireGitHubSession(req, res)
  if (!s) return
  const owner = encodeURIComponent(String(req.params.owner || ''))
  const repo = encodeURIComponent(String(req.params.repo || ''))
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=30`
  const r = await githubApiFetch(s.token, url, { method: 'GET' })
  if (!r.ok) {
    if (r.status === 403 && r.remaining === 0) return res.status(429).json({ error: 'GitHub rate limit exceeded', reset: r.reset })
    return res.status(r.status).json({ error: 'GitHub API error', details: r.data })
  }
  res.json({ items: r.data })
})

app.post('/api/github/repos/:owner/:repo/issues', async (req, res) => {
  const s = requireGitHubSession(req, res)
  if (!s) return
  const owner = encodeURIComponent(String(req.params.owner || ''))
  const repo = encodeURIComponent(String(req.params.repo || ''))
  const title = String(req.body?.title || '').trim()
  const body = String(req.body?.body || '').trim()
  if (!title) return res.status(400).json({ error: 'Title is required.' })

  const url = `https://api.github.com/repos/${owner}/${repo}/issues`
  const r = await githubApiFetch(s.token, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body }),
  })
  if (!r.ok) {
    if (r.status === 403 && r.remaining === 0) return res.status(429).json({ error: 'GitHub rate limit exceeded', reset: r.reset })
    return res.status(r.status).json({ error: 'GitHub API error', details: r.data })
  }
  res.status(201).json({ item: r.data })
})

app.get('/api/github/events', (req, res) => {
  res.json({ items: ghEvents.slice(-50).reverse() })
})

app.post('/api/github/webhook', (req, res) => {
  const sig = String(req.headers['x-hub-signature-256'] || '')
  const event = String(req.headers['x-github-event'] || '')
  const delivery = String(req.headers['x-github-delivery'] || '')

  if (!GITHUB_WEBHOOK_SECRET) return res.status(500).json({ error: 'Webhook secret not configured.' })
  const raw = req.rawBody instanceof Buffer ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}))
  const mac = createHmac('sha256', GITHUB_WEBHOOK_SECRET).update(raw).digest('hex')
  const expected = `sha256=${mac}`
  const ok =
    sig &&
    expected &&
    sig.length === expected.length &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  if (!ok) return res.status(401).json({ error: 'Invalid signature.' })

  const payload = req.body && typeof req.body === 'object' ? req.body : {}
  const summary = {
    id: delivery || randomUUID(),
    at: new Date().toISOString(),
    event,
    action: typeof payload.action === 'string' ? payload.action : undefined,
    repo: payload?.repository?.full_name ? String(payload.repository.full_name) : undefined,
    sender: payload?.sender?.login ? String(payload.sender.login) : undefined,
  }
  ghEvents.push(summary)
  while (ghEvents.length > 200) ghEvents.shift()
  try {
    broadcast({ topic: 'github', payload: summary })
  } catch {
  }
  res.json({ ok: true })
})

app.post('/api/tree-detection', (req, res) => {
  const { aoi, apiKey } = req.body
  
  if (!aoi) {
    return res.status(400).json({ error: 'AOI is required' })
  }

  const pythonScript = path.join(process.cwd(), 'server', 'sam_detector.py')
  
  // Use 'python' or 'python3' depending on environment.
  // Assuming 'python' is available in path.
  const pythonProcess = spawn('python', [pythonScript])
  
  let dataString = ''
  let errorString = ''

  pythonProcess.stdout.on('data', (data) => {
    dataString += data.toString()
  })

  pythonProcess.stderr.on('data', (data) => {
    errorString += data.toString()
  })

  pythonProcess.on('close', (code) => {
    if (code !== 0) {
      console.error('Python script error:', errorString)
      return res.status(500).json({ error: 'Tree detection failed', details: errorString })
    }
    
    try {
      const result = JSON.parse(dataString)
      if (result.error) {
        return res.status(500).json(result)
      }
      res.json(result)
    } catch (e) {
      console.error('Failed to parse Python output:', dataString)
      res.status(500).json({ error: 'Invalid response from detection engine', raw: dataString })
    }
  })

  // Send input to Python script
  pythonProcess.stdin.write(JSON.stringify({ aoi, apiKey }))
  pythonProcess.stdin.end()
})

app.post('/api/ai/analyze', (req, res) => {
  const score = Math.round((Math.random() * 0.4 + 0.6) * 100) / 100
  res.json({ score, advisories: ['Irrigate in 24h', 'Apply NPK 10-10-10'] })
})

app.get('/api/weather/latest', (req, res) => {
  res.json({ temp_c: 36.2, humidity_pct: 42, wind_ms: 3.2, rainfall_mm: 0 })
})

const ECPH_ENTRIES_FILE = path.join(process.cwd(), 'server', 'ecph_entries.json')

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function readEcphEntries() {
  try {
    if (!fs.existsSync(ECPH_ENTRIES_FILE)) return []
    const raw = fs.readFileSync(ECPH_ENTRIES_FILE, 'utf8')
    const parsed = safeJsonParse(raw, [])
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeEcphEntries(entries) {
  try {
    fs.writeFileSync(ECPH_ENTRIES_FILE, JSON.stringify(entries, null, 2))
  } catch (e) {
    console.error('Failed to persist ecph entries', e)
  }
}

const ecphEntrySchema = yup
  .object({
    formKey: yup.string().oneOf(['EC']).required(),
    kind: yup.string().oneOf(['draft', 'submitted']).required(),
    state: yup
      .object({
        sourceIds: yup.array(yup.string()).required(),
        selectedFieldsBySource: yup.object().required(),
        valuesBySource: yup.object().required(),
      })
      .required(),
  })
  .noUnknown(true)

app.get('/api/ecph/entries/latest', (req, res) => {
  const entries = readEcphEntries()
  const item = entries.length ? entries[0] : null
  res.json({ item })
})

app.post('/api/ecph/entries', async (req, res) => {
  try {
    const parsed = await ecphEntrySchema.validate(req.body, { abortEarly: false, stripUnknown: true })
    const email = String(req.headers['x-user-email'] || req.headers['x-user'] || 'unknown')
    const now = new Date().toISOString()
    const item = {
      id: randomUUID(),
      created_at: now,
      updated_at: now,
      updated_by: email,
      ...parsed,
    }
    const entries = readEcphEntries()
    const next = [item, ...entries].slice(0, 5000)
    writeEcphEntries(next)
    res.status(201).json({ item })
  } catch (e) {
    const msg = e && typeof e === 'object' && typeof e.message === 'string' ? e.message : 'Invalid request'
    res.status(400).json({ error: msg })
  }
})

// Mock PostGIS Storage
const AOI_STORAGE = []

app.get('/api/aoi', (req, res) => {
  res.json(AOI_STORAGE)
})

app.post('/api/aoi', (req, res) => {
  const aoi = req.body
  if (!aoi || !aoi.geometry) {
    return res.status(400).json({ error: 'Invalid AOI data' })
  }
  // Assign a mock ID if not present
  if (!aoi.id) {
    aoi.id = Date.now()
  }
  AOI_STORAGE.push(aoi)
  console.log('Saved AOI to Mock PostGIS:', aoi.id)
  res.json(aoi)
})

app.delete('/api/aoi/:id', (req, res) => {
  const { id } = req.params
  const index = AOI_STORAGE.findIndex(a => a.id == id)
  if (index !== -1) {
    AOI_STORAGE.splice(index, 1)
    res.json({ success: true })
  } else {
    res.status(404).json({ error: 'AOI not found' })
  }
})

const GEO_LOCATIONS = []
const GEO_ATTRIBUTES = []
const GEO_FORM_LINKS = []

function toInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) ? n : fallback
}

function paginate(items, limit, offset) {
  const safeLimit = Math.max(1, Math.min(100, limit))
  const safeOffset = Math.max(0, offset)
  return {
    total: items.length,
    limit: safeLimit,
    offset: safeOffset,
    items: items.slice(safeOffset, safeOffset + safeLimit),
  }
}

function normalizeKey(value) {
  let v = String(value ?? '')
  try {
    v = v.normalize('NFKC')
  } catch {
  }
  return v.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase()
}

function countVertices(latlngs) {
  if (!latlngs) return 0
  if (Array.isArray(latlngs)) {
    if (latlngs.length === 0) return 0
    if (Array.isArray(latlngs[0])) return countVertices(latlngs[0])
    return latlngs.length
  }
  if (typeof latlngs.lat === 'number' && typeof latlngs.lng === 'number') return 1
  return 0
}

const locationSchema = yup
  .object({
    country: yup.string().required(),
    site: yup.string().trim().required(),
    project: yup.string().required(),
    projectId: yup.string().nullable().default(''),
    zoneId: yup
      .string()
      .transform(v => String(v ?? '').toUpperCase())
      .matches(/^[A-Z0-9]{3}$/)
      .required(),
    codeId: yup
      .string()
      .transform(v => String(v ?? '').toUpperCase())
      .matches(/^[A-Z0-9]{8}$/)
      .required(),
    date: yup.string().required(),
    wkt: yup.string().required(),
    geometryType: yup
      .string()
      .oneOf(['marker', 'polygon', 'polyline', 'circle', 'Point', 'Polygon', 'LineString', 'Circle'])
      .required(),
    latlngs: yup.mixed().required(),
    radius: yup.number().nullable().notRequired(),
    attributes: yup.object().nullable().default(null),
    linkedForms: yup
      .array(
        yup.object({
          id: yup.string().required(),
          permissions: yup.array(yup.string().oneOf(['create', 'read', 'update', 'delete'])).required(),
        })
      )
      .nullable()
      .default([]),
  })
  .noUnknown(true)

app.get('/api/geo/locations', (req, res) => {
  const limit = toInt(req.query.limit, 20)
  const offset = toInt(req.query.offset, 0)
  res.json(paginate(GEO_LOCATIONS, limit, offset))
})

app.post('/api/geo/locations', async (req, res) => {
  try {
    const parsed = await locationSchema.validate(req.body, { abortEarly: false, stripUnknown: true })
    const siteKey = normalizeKey(parsed.site)
    const exists = GEO_LOCATIONS.some(l => normalizeKey(l.site) === siteKey)
    if (exists) return res.status(409).json({ error: 'Site name must be unique.' })

    const vertexCount = countVertices(parsed.latlngs)
    if (vertexCount > 1000) return res.status(400).json({ error: 'Geometry too complex (>1000 vertices).' })

    const geoId = randomUUID()
    const createdAt = new Date().toISOString()

    const record = {
      id: geoId,
      ...parsed,
      createdAt,
    }
    GEO_LOCATIONS.push(record)

    const attrsSource = parsed.attributes && typeof parsed.attributes === 'object' ? parsed.attributes : {
      country: parsed.country,
      site: parsed.site,
      project: parsed.project,
      projectId: parsed.projectId,
      zoneId: parsed.zoneId,
      codeId: parsed.codeId,
      date: parsed.date,
    }
    for (const [fieldId, value] of Object.entries(attrsSource)) {
      GEO_ATTRIBUTES.push({
        geoId,
        fieldId,
        value,
        tsUtc: createdAt,
      })
    }

    if (Array.isArray(parsed.linkedForms)) {
      for (const link of parsed.linkedForms) {
        GEO_FORM_LINKS.push({
          geoId,
          formId: link.id,
          permissions: link.permissions,
          createdAt,
        })
      }
    }

    res.status(201).json(record)
  } catch (err) {
    if (err?.name === 'ValidationError') {
      return res.status(400).json({ error: 'Validation failed', details: err.errors || [] })
    }
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/geo/:geoId/forms', (req, res) => {
  const { geoId } = req.params
  const limit = toInt(req.query.limit, 20)
  const offset = toInt(req.query.offset, 0)
  const items = GEO_FORM_LINKS.filter(l => l.geoId === geoId).map(l => ({
    id: l.formId,
    permissions: l.permissions,
    createdAt: l.createdAt,
  }))
  res.json(paginate(items, limit, offset))
})

app.post('/api/geo/:geoId/forms', async (req, res) => {
  const { geoId } = req.params
  const body = req.body || {}

  const schema = yup.object({
    links: yup.array(
      yup.object({
        id: yup.string().required(),
        permissions: yup.array(yup.string().oneOf(['create', 'read', 'update', 'delete'])).required(),
      })
    ).required(),
  }).noUnknown(true)

  try {
    const parsed = await schema.validate(body, { abortEarly: false, stripUnknown: true })
    const exists = GEO_LOCATIONS.some(l => l.id === geoId)
    if (!exists) return res.status(404).json({ error: 'GeoID not found' })

    for (let i = GEO_FORM_LINKS.length - 1; i >= 0; i--) {
      if (GEO_FORM_LINKS[i].geoId === geoId) GEO_FORM_LINKS.splice(i, 1)
    }
    const createdAt = new Date().toISOString()
    for (const link of parsed.links) {
      GEO_FORM_LINKS.push({
        geoId,
        formId: link.id,
        permissions: link.permissions,
        createdAt,
      })
    }
    res.json({ success: true })
  } catch (err) {
    if (err?.name === 'ValidationError') {
      return res.status(400).json({ error: 'Validation failed', details: err.errors || [] })
    }
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/geo/:geoId/attributes', (req, res) => {
  const { geoId } = req.params
  const attrs = GEO_ATTRIBUTES.filter(a => a.geoId === geoId)
  const asObject = {}
  for (const a of attrs) asObject[a.fieldId] = a.value
  res.json({ geoId, attributes: asObject, items: attrs })
})

const GIS_EXTERNAL_TABLES = {
  location_master: {
    name: 'location_master',
    label: 'Location Master',
    primaryKey: 'farm_id',
    columns: [
      { name: 'farm_id', type: 'string', required: true },
      { name: 'farm_name', type: 'string', required: true },
      { name: 'crop_type', type: 'enum', required: true, enum: ['Wheat', 'Corn', 'Tomato', 'Potato'] },
      { name: 'area_ha', type: 'number', required: true },
      { name: 'planted_on', type: 'date', required: false },
      { name: 'status', type: 'enum', required: true, enum: ['Active', 'Inactive'] },
    ],
    rows: [
      { farm_id: 'F-1001', farm_name: 'North Farm', crop_type: 'Tomato', area_ha: 12.5, planted_on: '2026-01-11', status: 'Active' },
      { farm_id: 'F-1002', farm_name: 'South Farm', crop_type: 'Wheat', area_ha: 54.2, planted_on: '2025-11-04', status: 'Active' },
    ],
  },
  irrigation_log: {
    name: 'irrigation_log',
    label: 'Irrigation Log',
    primaryKey: 'log_id',
    columns: [
      { name: 'log_id', type: 'string', required: true },
      { name: 'farm_id', type: 'string', required: true },
      { name: 'irrigation_date', type: 'date', required: true },
      { name: 'amount_mm', type: 'number', required: true },
      { name: 'method', type: 'enum', required: true, enum: ['Drip', 'Sprinkler', 'Flood'] },
      { name: 'notes', type: 'string', required: false },
    ],
    rows: [
      { log_id: 'L-9001', farm_id: 'F-1001', irrigation_date: '2026-03-01', amount_mm: 18, method: 'Drip', notes: '' },
      { log_id: 'L-9002', farm_id: 'F-1001', irrigation_date: '2026-03-03', amount_mm: 16, method: 'Drip', notes: 'Reduced due to humidity' },
      { log_id: 'L-9010', farm_id: 'F-1002', irrigation_date: '2026-02-21', amount_mm: 22, method: 'Sprinkler', notes: '' },
    ],
  },
}

const GIS_RELATIONSHIPS = []

function getExternalTable(tableName) {
  return GIS_EXTERNAL_TABLES[String(tableName || '').toLowerCase()] || null
}

function hasColumn(table, columnName) {
  return table.columns.some(c => c.name === columnName)
}

function applyValueTransform(value, transform) {
  let v = value
  if (transform === 'trim') return String(v ?? '').trim()
  if (transform === 'lowercase') return String(v ?? '').toLowerCase()
  if (transform === 'uppercase') return String(v ?? '').toUpperCase()
  if (transform === 'number') {
    const n = Number(String(v ?? '').trim())
    return Number.isFinite(n) ? n : null
  }
  return v
}

const relationshipSchema = yup.object({
  sourceLayerName: yup.string().required(),
  relationshipType: yup.string().oneOf(['one_to_one', 'one_to_many']).required(),
  sourceKeyField: yup.string().required(),
  targetTable: yup.string().required(),
  targetKeyField: yup.string().required(),
  sourceKeyTransform: yup.string().oneOf(['none', 'trim', 'lowercase', 'uppercase', 'number']).default('none'),
  fieldSelection: yup.array(
    yup.object({
      field: yup.string().required(),
      label: yup.string().nullable().default(null),
      control: yup.string().oneOf(['auto', 'text', 'number', 'date', 'select', 'checkbox', 'textarea']).default('auto'),
      transform: yup.string().oneOf(['none', 'trim', 'lowercase', 'uppercase', 'number', 'date_iso']).default('none'),
      required: yup.boolean().default(false),
      readOnly: yup.boolean().default(false),
    }).noUnknown(true)
  ).default([]),
}).noUnknown(true)

app.get('/api/gis/external-tables', (req, res) => {
  const list = Object.values(GIS_EXTERNAL_TABLES).map(t => ({
    name: t.name,
    label: t.label,
    primaryKey: t.primaryKey,
    columns: t.columns,
  }))
  res.json(list)
})

app.get('/api/gis/external-tables/:table/schema', (req, res) => {
  const t = getExternalTable(req.params.table)
  if (!t) return res.status(404).json({ error: 'Table not found' })
  res.json({ name: t.name, label: t.label, primaryKey: t.primaryKey, columns: t.columns })
})

app.get('/api/gis/external-tables/:table/rows', (req, res) => {
  const t = getExternalTable(req.params.table)
  if (!t) return res.status(404).json({ error: 'Table not found' })
  const field = String(req.query.field || '').trim()
  const value = String(req.query.value ?? '').trim()
  let rows = t.rows
  if (field) {
    if (!hasColumn(t, field)) return res.status(400).json({ error: 'Unknown field' })
    rows = rows.filter(r => String(r[field] ?? '') === value)
  }
  const limit = toInt(req.query.limit, 50)
  const offset = toInt(req.query.offset, 0)
  res.json(paginate(rows, limit, offset))
})

app.post('/api/gis/external-tables/:table/rows', async (req, res) => {
  const t = getExternalTable(req.params.table)
  if (!t) return res.status(404).json({ error: 'Table not found' })
  const row = req.body || {}
  const pk = t.primaryKey
  const pkValue = String(row[pk] ?? '').trim()
  if (!pkValue) return res.status(400).json({ error: `Missing primary key: ${pk}` })
  const exists = t.rows.some(r => String(r[pk] ?? '') === pkValue)
  if (exists) return res.status(409).json({ error: 'Row already exists' })
  t.rows.push(row)
  res.status(201).json(row)
})

app.put('/api/gis/external-tables/:table/rows/:rowId', (req, res) => {
  const t = getExternalTable(req.params.table)
  if (!t) return res.status(404).json({ error: 'Table not found' })
  const pk = t.primaryKey
  const rowId = String(req.params.rowId ?? '').trim()
  const idx = t.rows.findIndex(r => String(r[pk] ?? '') === rowId)
  if (idx === -1) return res.status(404).json({ error: 'Row not found' })
  const next = { ...t.rows[idx], ...(req.body || {}) }
  next[pk] = t.rows[idx][pk]
  t.rows[idx] = next
  res.json(next)
})

app.delete('/api/gis/external-tables/:table/rows/:rowId', (req, res) => {
  const t = getExternalTable(req.params.table)
  if (!t) return res.status(404).json({ error: 'Table not found' })
  const pk = t.primaryKey
  const rowId = String(req.params.rowId ?? '').trim()
  const idx = t.rows.findIndex(r => String(r[pk] ?? '') === rowId)
  if (idx === -1) return res.status(404).json({ error: 'Row not found' })
  t.rows.splice(idx, 1)
  res.json({ success: true })
})

app.get('/api/gis/relationships', (req, res) => {
  res.json(GIS_RELATIONSHIPS)
})

app.post('/api/gis/relationships', async (req, res) => {
  try {
    const parsed = await relationshipSchema.validate(req.body, { abortEarly: false, stripUnknown: true })
    const t = getExternalTable(parsed.targetTable)
    if (!t) return res.status(400).json({ error: 'Target table not found' })
    if (!hasColumn(t, parsed.targetKeyField)) return res.status(400).json({ error: 'Target key field not found' })

    const conflict = GIS_RELATIONSHIPS.some(r =>
      normalizeKey(r.sourceLayerName) === normalizeKey(parsed.sourceLayerName) &&
      normalizeKey(r.targetTable) === normalizeKey(parsed.targetTable) &&
      r.relationshipType === parsed.relationshipType
    )
    if (conflict) return res.status(409).json({ error: 'Relationship conflict: already exists for this layer/table/type.' })

    const createdAt = new Date().toISOString()
    const rel = {
      id: randomUUID(),
      ...parsed,
      targetTable: t.name,
      createdAt,
      updatedAt: createdAt,
    }

    const seen = new Set()
    for (const f of rel.fieldSelection || []) {
      if (seen.has(f.field)) return res.status(400).json({ error: 'Duplicate field in selection.' })
      seen.add(f.field)
      if (!hasColumn(t, f.field)) return res.status(400).json({ error: `Unknown field: ${f.field}` })
    }

    GIS_RELATIONSHIPS.push(rel)
    res.status(201).json(rel)
  } catch (err) {
    if (err?.name === 'ValidationError') {
      return res.status(400).json({ error: 'Validation failed', details: err.errors || [] })
    }
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.put('/api/gis/relationships/:id', async (req, res) => {
  const id = String(req.params.id || '')
  const idx = GIS_RELATIONSHIPS.findIndex(r => r.id === id)
  if (idx === -1) return res.status(404).json({ error: 'Relationship not found' })
  try {
    const parsed = await relationshipSchema.validate(req.body, { abortEarly: false, stripUnknown: true })
    const t = getExternalTable(parsed.targetTable)
    if (!t) return res.status(400).json({ error: 'Target table not found' })
    if (!hasColumn(t, parsed.targetKeyField)) return res.status(400).json({ error: 'Target key field not found' })

    const conflict = GIS_RELATIONSHIPS.some(r =>
      r.id !== id &&
      normalizeKey(r.sourceLayerName) === normalizeKey(parsed.sourceLayerName) &&
      normalizeKey(r.targetTable) === normalizeKey(parsed.targetTable) &&
      r.relationshipType === parsed.relationshipType
    )
    if (conflict) return res.status(409).json({ error: 'Relationship conflict: already exists for this layer/table/type.' })

    const updatedAt = new Date().toISOString()
    const rel = {
      ...GIS_RELATIONSHIPS[idx],
      ...parsed,
      targetTable: t.name,
      updatedAt,
    }
    GIS_RELATIONSHIPS[idx] = rel
    res.json(rel)
  } catch (err) {
    if (err?.name === 'ValidationError') {
      return res.status(400).json({ error: 'Validation failed', details: err.errors || [] })
    }
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.delete('/api/gis/relationships/:id', (req, res) => {
  const id = String(req.params.id || '')
  const idx = GIS_RELATIONSHIPS.findIndex(r => r.id === id)
  if (idx === -1) return res.status(404).json({ error: 'Relationship not found' })
  GIS_RELATIONSHIPS.splice(idx, 1)
  res.json({ success: true })
})

app.post('/api/gis/resolve', async (req, res) => {
  const body = req.body || {}
  const sourceLayerName = String(body.sourceLayerName || '').trim()
  const feature = body.feature && typeof body.feature === 'object' ? body.feature : null
  if (!sourceLayerName) return res.status(400).json({ error: 'sourceLayerName is required' })
  if (!feature) return res.status(400).json({ error: 'feature is required' })

  const rels = GIS_RELATIONSHIPS.filter(r => normalizeKey(r.sourceLayerName) === normalizeKey(sourceLayerName))
  const results = []
  for (const r of rels) {
    const t = getExternalTable(r.targetTable)
    if (!t) continue
    const rawKey = feature[r.sourceKeyField]
    const transform = r.sourceKeyTransform && r.sourceKeyTransform !== 'none' ? r.sourceKeyTransform : null
    const keyValue = transform ? applyValueTransform(rawKey, transform) : rawKey
    const keyString = keyValue === null || keyValue === undefined ? '' : String(keyValue)
    if (!keyString) {
      results.push({ relationshipId: r.id, error: `Missing source key field: ${r.sourceKeyField}` })
      continue
    }
    const rows = t.rows.filter(row => String(row[r.targetKeyField] ?? '') === keyString)
    results.push({
      relationshipId: r.id,
      relationshipType: r.relationshipType,
      targetTable: t.name,
      targetLabel: t.label,
      primaryKey: t.primaryKey,
      targetKeyField: r.targetKeyField,
      sourceKeyField: r.sourceKeyField,
      keyValue: keyString,
      schema: { name: t.name, label: t.label, primaryKey: t.primaryKey, columns: t.columns },
      fieldSelection: r.fieldSelection || [],
      rows,
    })
  }
  res.json({ sourceLayerName, results })
})

const CLIENT_LOGS = []

function sanitizeSecrets(value) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(v => sanitizeSecrets(v))
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    const key = String(k).toLowerCase()
    if (key.includes('token') || key.includes('password') || key.includes('apikey') || key.includes('api_key') || key.includes('secret')) {
      out[k] = '***'
    } else {
      out[k] = sanitizeSecrets(v)
    }
  }
  return out
}

app.post('/api/log/client', (req, res) => {
  const body = req.body || {}
  const event = String(body.event || '').trim()
  const at = String(body.at || '').trim()
  const page = String(body.page || '').trim()
  const details = body.details && typeof body.details === 'object' ? body.details : {}
  if (!event) return res.status(400).json({ error: 'event is required' })

  const entry = {
    id: randomUUID(),
    event,
    at: at || new Date().toISOString(),
    page: page || 'unknown',
    details: sanitizeSecrets(details),
  }
  CLIENT_LOGS.push(entry)
  if (CLIENT_LOGS.length > 200) CLIENT_LOGS.splice(0, CLIENT_LOGS.length - 200)
  res.status(201).json({ success: true })
})

app.post('/api/gis/db/test', async (req, res) => {
  const body = req.body || {}
  const type = String(body.type || '').trim().toLowerCase()
  const host = String(body.host || '').trim()
  const port = String(body.port || '').trim()
  const database = String(body.database || '').trim()
  const user = String(body.user || '').trim()

  if (!['postgis', 'sqlserver', 'oracle'].includes(type)) return res.status(400).json({ error: 'Unsupported database type' })
  if (!host) return res.status(400).json({ error: 'Host is required' })
  if (!database) return res.status(400).json({ error: 'Database is required' })
  if (!user) return res.status(400).json({ error: 'User is required' })
  if (port && !Number.isFinite(Number(port))) return res.status(400).json({ error: 'Port must be a number' })

  const fail =
    host.toLowerCase().includes('fail') ||
    database.toLowerCase().includes('fail') ||
    user.toLowerCase().includes('fail')
  const latency = 80 + Math.floor(Math.random() * 180)
  await new Promise(r => setTimeout(r, latency))

  if (fail) return res.status(503).json({ error: 'Connection failed (simulated). Check host/port/firewall and credentials.' })

  res.json({ success: true, type, latencyMs: latency })
})

const SYSTEM_PROMPT = `
**Role & Objective:**
You are 'AgriCloud', an agricultural science assistant. Answer concisely with a short "Summary" followed by 1–2 brief next steps. Default to English. If the user's message is primarily Arabic or explicitly requests Arabic/translation, respond in Arabic.

**Guidelines:**
1. **Focus:** Prioritize crop physiology, soil science, irrigation, nutrition, plant pathology, entomology, and IPM.
2. **Structure:** Provide variables to monitor (Soil Moisture, EC, pH, Temp, Humidity, VPD), measurement methods, thresholds, and actions.
3. **Evidence:** Use scientifically accepted ranges (e.g., pH 0–14; typical vegetable pH target ~6.0–7.5; caution when soil EC > 4 dS/m).
4. **Safety:** Recommend safe, practical steps and note constraints. Avoid unsafe advice.
5. **Clarity:** Use concise bullets and readable formatting.
`

const VISION_PROMPT = `
**Image Analysis Request - Plant Health Diagnostic**

Please analyze this image as an agricultural expert.

**Focus Areas:**
1.  **Plant Identification:** Identify the crop/plant species if visible.
2.  **Symptom Description:** Detail visible symptoms on leaves, stems, fruits, or roots (e.g., color changes, spots, wilting, deformities).
3.  **Preliminary Assessment:** Suggest the most likely causes (e.g., fungal infection, nutrient deficiency, insect damage, water stress).
4.  **Confidence & Clarity:** Rate your confidence level (Low/Medium/High) and note if the image is unclear.

**Output Format:**
- **Plant:** [Species or "Unidentifiable"]
- **Visible Symptoms:** [Bulleted list]
- **Likely Causes:** [Bulleted list, order by probability]
- **Recommended Next Steps:** [Suggest clear photos to take or key details to provide]
`

// Helper to construct the API Context Prompt
function getApiContextPrompt(userQuestion, extractedSymptoms = "unspecified") {
  return `
The user is asking about: "${userQuestion}".

Before formulating your final answer, you may need to fetch specific data.
If the query is about:
- **Weather/Risk Alerts:** Call the 'getWeatherAlerts' API with the user's provided location (or ask for it).
- **Disease Database:** Call the 'searchDiseaseLibrary' API with the identified symptoms: ${extractedSymptoms}.
- **Product Recommendations:** Call the 'getOrganicRemedies' API with the diagnosed issue.

**API Call Guidance:** Use the functions/APIs available to you. Summarize the fetched data for the user in a helpful, concise way.
`;
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null

function chooseLang(en, ar, original) {
  const msg = String(original || '').toLowerCase()
  const hasArabicChars = /[\u0600-\u06FF]/.test(original || '')
  const wantsArabic = hasArabicChars || msg.includes('arabic') || msg.includes('عربي') || msg.includes('بالعربي') || msg.includes('ترجم') || msg.includes('translate')
  return wantsArabic ? ar : en
}

// Data for Simulated AI
const SIM_DATA = {
  tomato: {
    keywords: ['tomato', 'tomatoes', 'lycopersicon'],
    basic: {
      en: "Tomato Care Guide:\n- Temperature: Thrives in 20-30°C.\n- Watering: Regular, deep watering to prevent blossom end rot.\n- Common Issues: Early blight (spots), Hornworms.\n- Tip: Stake plants early to keep fruit off the ground.",
      ar: "دليل العناية بالطماطم:\n- درجة الحرارة: تزدهر بين 20–30°م.\n- الري: ري عميق منتظم لتجنب تعفن الطرف الزهري.\n- مشاكل شائعة: لفحة مبكرة (بقع)، ديدان قرنية.\n- نصيحة: اسند النباتات مبكرًا لإبعاد الثمار عن الأرض."
    },
    detailed: {
      en: "Advanced Tomato Guide:\n- Soil: Well-draining, pH 6.0-6.8. Add compost.\n- Fertilization: Heavy feeder. Use 5-10-10 NPK. Avoid high Nitrogen during fruiting.\n- Pruning: Remove suckers (side shoots) to focus energy on fruit.\n- Diseases: Watch for Septoria Leaf Spot. Rotate crops every 3 years.",
      ar: "دليل الطماطم المتقدم:\n- التربة: جيدة الصرف، pH 6.0-6.8. أضف السماد العضوي.\n- التسميد: نبات نهم. استخدم NPK 5-10-10. تجنب النيتروجين العالي أثناء الإثمار.\n- التقليم: أزل الفروع الجانبية لتركيز الطاقة.\n- الأمراض: راقب تبقع الأوراق السبتوري. دهر المحاصيل كل 3 سنوات."
    }
  },
  cucumber: {
    keywords: ['cucumber', 'cucumbers'],
    basic: {
      en: "Cucumber Care:\n- Watering: Needs consistent moisture. Bitter cucumbers are often caused by heat or water stress.\n- Pests: Watch for Aphids and Cucumber Beetles.\n- Disease: Powdery Mildew is common; improve airflow.",
      ar: "العناية بالخيار:\n- الري: يحتاج إلى رطوبة ثابتة. مرارة الثمار غالبًا سببها الحرارة أو إجهاد الماء.\n- الآفات: راقب المن وخنافس الخيار.\n- الأمراض: البياض الدقيقي شائع؛ حسّن التهوية."
    },
    detailed: {
      en: "Advanced Cucumber Guide:\n- Soil: Fertile, warm soil with pH 6.0-7.0.\n- Trellising: Grow vertically to save space and keep fruit clean.\n- Pollination: Most varieties need bees; if fruit withers, try hand pollination.\n- Harvest: Pick frequently to encourage more production.",
      ar: "دليل الخيار المتقدم:\n- التربة: خصبة ودافئة بـ pH 6.0-7.0.\n- التعريش: ازرع عموديًا لتوفير المساحة ونظافة الثمار.\n- التلقيح: معظم الأصناف تحتاج للنحل؛ إذا ذبلت الثمار، جرب التلقيح اليدوي.\n- الحصاد: اقطف بانتظام لتحفيز الإنتاج."
    }
  },
  date_palm: {
    keywords: ['date', 'palm', 'phoenix', 'dactylifera'],
    basic: {
      en: "Date Palm Management:\n- Irrigation: Critical during fruit development (May-Aug).\n- Pests: Red Palm Weevil is the main threat. Look for bore holes.\n- Harvest: Harvest at the 'Rutab' stage for soft dates.",
      ar: "إدارة نخيل التمر:\n- الري: حاسم خلال تطور الثمار (مايو–أغسطس).\n- الآفات: سوسة النخيل الحمراء هي التهديد الرئيسي؛ ابحث عن ثقوب الساق.\n- الحصاد: احصد في مرحلة الرطب للحصول على تمر طري."
    },
    detailed: {
      en: "Advanced Date Palm Guide:\n- Pollination: Must be done manually in early spring.\n- Thinning: Remove 30% of fruit strands to improve size and quality.\n- Fertilization: Apply NPK + Micronutrients (especially Boron/Zinc) 3 times/year.\n- Disease: Watch for Bayoud disease (fungal wilt).",
      ar: "دليل النخيل المتقدم:\n- التلقيح: يجب أن يتم يدويًا في أوائل الربيع.\n- الخف: أزل 30٪ من الشماريخ لتحسين الحجم والجودة.\n- التسميد: أضف NPK + عناصر صغرى (خاصة البورون/الزنك) 3 مرات سنويًا.\n- الأمراض: راقب مرض البيوض (ذبول فطري)."
    }
  },
  fertilizer: {
    keywords: ['fertilizer', 'npk', 'nutrition', 'nutrient'],
    basic: {
      en: "Fertilizer Advice:\n- Growth Stage: Use high Nitrogen (N).\n- Flowering/Fruiting: Switch to higher Phosphorus (P) and Potassium (K).\n- General: A balanced 10-10-10 NPK is good for maintenance.",
      ar: "نصائح التسميد:\n- مرحلة النمو: استخدم نسبة نيتروجين (N) أعلى.\n- التزهير/الإثمار: انتقل إلى فوسفور (P) وبوتاسيوم (K) أعلى.\n- عام: تركيبة متوازنة 10-10-10 مناسبة للصيانة."
    },
    detailed: {
      en: "Advanced Nutrition:\n- Soil Test: Essential before major applications.\n- Organic: Compost/Manure improves soil structure + nutrients.\n- Deficiency Signs: Yellow leaves (Nitrogen), Purple veins (Phosphorus), Burnt edges (Potassium).",
      ar: "تغذية متقدمة:\n- فحص التربة: ضروري قبل الإضافات الكبيرة.\n- عضوي: الكمبوست/السماد يحسن بنية التربة + العناصر.\n- علامات النقص: أوراق صفراء (نيتروجين)، عروق بنفسجية (فوسفور)، حواف محترقة (بوتاسيوم)."
    }
  },
  irrigation: {
    keywords: ['irrigation', 'water', 'watering'],
    basic: {
      en: "Irrigation Tips:\n- Timing: Water early morning (before 8 AM) to minimize evaporation.\n- Method: Drip irrigation saves 30-50% water compared to sprinklers.\n- Check: Ensure soil is moist at root depth (5-10 cm down).",
      ar: "نصائح الري:\n- التوقيت: اسقِ في الصباح الباكر (قبل 8 صباحًا) لتقليل التبخر.\n- الطريقة: الري بالتنقيط يوفر 30–50٪ من الماء مقارنة بالرش.\n- الفحص: تأكد أن التربة رطبة عند عمق الجذور (5–10 سم)."
    },
    detailed: {
      en: "Advanced Irrigation:\n- ET-Based: Calculate Evapotranspiration (ET0) x Crop Coefficient (Kc).\n- Salinity: If water is saline, apply leaching fraction (extra water) to push salts down.\n- Technology: Use soil moisture sensors for precision.",
      ar: "ري متقدم:\n- معتمد على ET: احسب البخر-النتح (ET0) × معامل المحصول (Kc).\n- الملوحة: إذا كان الماء مالحًا، أضف نسبة غسيل (ماء إضافي) لدفع الأملاح لأسفل.\n- التكنولوجيا: استخدم مجسات رطوبة التربة للدقة."
    }
  },
  pest: {
    keywords: ['pest', 'disease', 'bug', 'worm', 'insect'],
    basic: {
       en: "Integrated Pest Management (IPM):\n- Monitor: Scout weekly for pests.\n- Control: Use biological controls or targeted sprays.\n- Sanitation: Remove infected plant debris.",
       ar: "الإدارة المتكاملة للآفات (IPM):\n- المراقبة: افحص النباتات أسبوعيًا.\n- المكافحة: استخدم مكافحة حيوية أو رش موجه.\n- النظافة: أزل بقايا النباتات المصابة."
    },
    detailed: {
       en: "Advanced IPM Strategy:\n- ID: Correctly identify pest before spraying.\n- Thresholds: Only treat when damage exceeds economic threshold.\n- Rotation: Rotate chemical modes of action to prevent resistance.",
       ar: "استراتيجية IPM متقدمة:\n- التعريف: حدد الآفة بدقة قبل الرش.\n- العتبات: عالج فقط عندما يتجاوز الضرر العتبة الاقتصادية.\n- التدوير: نوّع آليات المبيدات لمنع المقاومة."
    }
  }
}

// Simulated AI Engine with Context
function getSimulatedResponse(message, history = []) {
  const lower = message.toLowerCase()
  
  // 0. Greetings/Identity (Static)
  if (lower.match(/^(hi|hello|hey|greetings)/)) {
    return chooseLang(
      "Hello! I'm AgriCloud, ready to help you with your farming questions.",
      "مرحبًا! أنا أجري كلاود، جاهز لمساعدتك في أسئلة الزراعة.",
      message
    )
  }
  if (lower.includes('who are you') || lower.includes('your name')) {
    return chooseLang(
      "I am AgriCloud, an intelligent assistant designed to help farmers optimize their crops and manage resources.",
      "أنا أجري كلاود، مساعد ذكي لمساعدة المزارعين على تحسين المحاصيل وإدارة الموارد.",
      message
    )
  }
  
  if (lower.includes('help') || lower.includes('what can you do')) {
    return chooseLang(
      "I can analyze plant health from photos, suggest fertilizer plans, provide irrigation schedules, identify common pests, and answer general questions across many topics. Ask me anything.",
      "أستطيع تحليل صحة النبات من الصور، واقتراح خطط تسميد، وتقديم جداول الري، وتحديد الآفات الشائعة، والإجابة عن الأسئلة العامة في مواضيع متعددة. اسألني أي شيء.",
      message
    );
  }

  // 1. Detect Topic & Intent
  const isFollowUp = lower.match(/^(more|detail|continue|what else|again|info)/) || (lower.split(' ').length <= 3 && history.length > 0)
  
  let topicKey = null
  
  // Search current message for keywords
  for (const key in SIM_DATA) {
    if (SIM_DATA[key].keywords.some(k => lower.includes(k))) {
      topicKey = key
      break
    }
  }
  
  // If follow-up, check history
  let isContextual = false
  if (!topicKey && isFollowUp && history.length > 0) {
    // Look back at last user messages
    const recentUserMsgs = history.filter(m => m.role === 'user').slice(-3).reverse()
    for (const msg of recentUserMsgs) {
      const mContent = (msg.content || '').toLowerCase()
      for (const key in SIM_DATA) {
        if (SIM_DATA[key].keywords.some(k => mContent.includes(k))) {
          topicKey = key
          isContextual = true
          break
        }
      }
      if (topicKey) break
    }
  }

  // 2. Generate Response
  if (topicKey) {
    const data = SIM_DATA[topicKey]
    
    // Determine level: Detailed if explicitly asked "more", or if it's a context-based follow-up
    const wantsDetail = lower.includes('detail') || lower.includes('more') || lower.includes('full') || (isContextual && isFollowUp)
    
    // Also give detailed if they repeat the keyword immediately
    const lastUserMsg = history.filter(m => m.role === 'user').pop()
    const immediateRepeat = lastUserMsg && SIM_DATA[topicKey].keywords.some(k => (lastUserMsg.content || '').toLowerCase().includes(k))
    
    if (wantsDetail || immediateRepeat) {
       return chooseLang(data.detailed.en, data.detailed.ar, message)
    }
    return chooseLang(data.basic.en, data.basic.ar, message)
  }
  
  // 3. Fallback / Catch-All
  return chooseLang(
      "Summary: Agronomic approach using measurable variables and thresholds.\nNext Steps: Measure soil moisture, EC, and pH regularly. | Use ET and Kc to plan irrigation.",
      "الملخص: منهج زراعي يعتمد على متغيرات قابلة للقياس وعتبات واضحة.\nالخطوات التالية: قِس رطوبة التربة و EC و pH بانتظام. | استخدم ET و Kc لتخطيط الري.",
      message
  )
}

// Sanitize reply for plain text UI (remove Markdown bold markers)
function formatReply(text) {
  return String(text).replace(/\*\*/g, '')
}

function guessPlant(message) {
  const m = String(message || '').toLowerCase()
  if (m.includes('tomato')) return 'Tomato'
  if (m.includes('cucumber')) return 'Cucumber'
  if (m.includes('date') || m.includes('palm')) return 'Date Palm'
  return 'Unidentified'
}

function getSimulatedVisionResponse(message) {
  const plant = guessPlant(message)
  const en = [
    `Plant: ${plant}`,
    `Location: Provide region (optional)`,
    `Type: Possible insect/disease/abiotic`,
    `Category: Preliminary assessment`,
    `Notes: Capture close, well-lit images of leaves and stems.`,
    `Recommended Actions: Improve airflow; avoid leaf wetness; scout twice weekly.`
  ].join('\n')
  const ar = [
    `النبات: ${plant === 'Unidentified' ? 'غير معروف' : plant}`,
    `الموقع: يرجى ذكر المنطقة (اختياري)`,
    `النوع: حشرة/مرض/إجهاد لا حيوي محتمل`,
    `الفئة: تقييم أولي`,
    `ملاحظات: التقط صورًا قريبة ومضيئة للأوراق والسيقان.`,
    `الإجراءات: حسّن التهوية؛ تجنب البلل الورقي؛ قم بالكشف مرتين أسبوعيًا.`
  ].join('\n')
  return chooseLang(en, ar, message)
}

app.post('/api/ai/chat', async (req, res) => {
  const { message, image, modelProvider = 'openai', history = [] } = req.body
  
  try {
    // Immediate free-mode path
    if (modelProvider === 'simulated') {
      const simReply = image ? getSimulatedVisionResponse(message) : getSimulatedResponse(message, history)
      res.json({ reply: formatReply(simReply), model: 'AgriCloud-Basic (Simulated)' })
      return
    }
    let messages = []
    let targetModel = 'gpt-4o' 

    // Force OpenAI for Vision requests (DeepSeek V3 is text-only usually)
    if (image) {
      if (modelProvider === 'deepseek') {
        console.log("Switching to OpenAI for Vision request")
      }
      
      messages = [
        { role: "system", content: SYSTEM_PROMPT },
        { 
          role: "user", 
          content: [
            { type: "text", text: message ? message + "\n\n" + VISION_PROMPT : VISION_PROMPT },
            { type: "image_url", image_url: { url: image } }
          ]
        }
      ]
    } else {
      // Text Request
      
      // Context Injection (Shared logic)
      const lowerMsg = message.toLowerCase()
      let contextData = ""
      
      if (lowerMsg.includes('weather') || lowerMsg.includes('rain') || lowerMsg.includes('temperature')) {
        contextData = `[System Injection - Mock Weather Data]\nCurrent Conditions: 36.2°C, 42% Humidity. Risk: High Temp.`
      } else if (lowerMsg.includes('pest') || lowerMsg.includes('bug') || lowerMsg.includes('worm')) {
        contextData = `[System Injection - Mock Database]\nFound Organic Remedy: Neem Oil Solution (2%). Application: Evening spray.`
      }

      const finalUserMessage = contextData 
        ? `${message}\n\nCONTEXT_DATA:\n${contextData}\n\nInstruction: Use the provided context data to answer the user's question.` 
        : message

      messages = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: finalUserMessage }
      ]
    }

    // Use OpenAI SDK
    try {
        if (!openai) {
          throw new Error("OpenAI API key not configured")
        }
        const response = await openai.chat.completions.create({
            model: targetModel,
            messages: messages,
            max_tokens: 1000,
            store: true, 
        });

        const reply = response.choices[0].message.content
        res.json({ reply: formatReply(reply), model: targetModel })

    } catch (openaiError) {
        console.error("OpenAI Error:", openaiError);
        
        let fallbackSuccess = false;

        // 1. Auto-Fallback to DeepSeek for Text Requests
        if (!image && DEEPSEEK_API_KEY) {
            console.log("Falling back to DeepSeek...")
            try {
                // DeepSeek doesn't have an SDK instance here, use fetch
                const deepseekResp = await fetch('https://api.deepseek.com/chat/completions', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
                    },
                    body: JSON.stringify({
                      model: 'deepseek-chat',
                      messages: messages,
                      max_tokens: 1000,
                      stream: false
                    })
                })
                
                const deepseekData = await deepseekResp.json()
                if (deepseekResp.ok) {
                    const reply = deepseekData.choices[0].message.content
                    res.json({ reply: formatReply(reply), model: 'deepseek-chat (fallback)' })
                    fallbackSuccess = true;
                    return
                } else {
                    console.error("DeepSeek Fallback Error:", deepseekData)
                }
            } catch (dsError) {
                console.error("DeepSeek Exception:", dsError)
            }
        }
        
        // 2. Final Fallback: Offline/Free Mode (Rule-Based)
        if (!fallbackSuccess) {
            console.log("All APIs failed. Switching to Simulated AI Mode.")
            const simReply = getSimulatedResponse(message, history)
            res.json({ reply: formatReply(simReply), model: 'AgriCloud-Basic (Simulated)' })
            return
        }

        throw openaiError;
    }

  } catch (error) {
    console.error('Chat Error:', error)
    // Fallback to mock response if everything fails
    res.json({ 
      reply: `[System Error] Unable to connect to AI Core (${error.message}).\n\nFallback Advice: Please consult a local expert.` 
    })
  }
})

app.get('*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dist', 'index.html'))
})

const server = app.listen(3001, () => {
  console.log('API on http://localhost:3001')
})

const wss = new WebSocketServer({ port: 3002 })
function broadcast(obj) {
  const msg = JSON.stringify(obj)
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg) })
}
setInterval(() => {
  broadcast({ topic: 'sensor/ec', payload: (Math.random() * 2 + 1).toFixed(2) })
  broadcast({ topic: 'sensor/ph', payload: (Math.random() * 2 + 6).toFixed(2) })
}, 3000)

process.on('SIGINT', () => {
  server.close(() => process.exit(0))
})
