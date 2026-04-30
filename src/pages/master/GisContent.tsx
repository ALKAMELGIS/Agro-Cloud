import { useEffect, useMemo, useRef, useState } from 'react'
import { parseFile } from '../../utils/FileLoader'

export default function GisContent() {
  return <GisContentPage />
}

type AddLayerTab = 'arcgis' | 'upload'

type FieldType = 'text' | 'number' | 'date' | 'boolean'

type FieldSchema = {
  id: string
  name: string
  type: FieldType
  length?: number
  defaultValue?: string
  nullable?: boolean
}

type RelationshipType = 'one-to-one' | 'one-to-many' | 'many-to-many'

type Relationship = {
  id: string
  name: string
  type: RelationshipType
  originLayerId: string
  destinationLayerId: string
  originKey: string
  destinationKey: string
  enforce?: boolean
  cascadeDelete?: boolean
  junctionLayerId?: string
  originJunctionKey?: string
  destinationJunctionKey?: string
}

type LayerRow = {
  id: string
  name: string
  visible: boolean
  source?: string
  geometryType: string
  recordCount: number
  createdAt: string
}

type LayerData = {
  id: number | string
  name: string
  type: 'geojson' | 'wms' | 'tile' | 'image'
  source?: 'arcgis' | 'upload'
  visible: boolean
  opacity: number
  data?: any
  url?: string
  authToken?: string
  arcgisLayerDefinition?: any
}

const DB_NAME = 'GisMapStore'
const STORE_NAME = 'layers'

const LS_META_KEY = 'gisContent.layerMeta.v1'
const LS_ORDER_KEY = 'gisContent.layerOrder.v1'
const LS_FIELDS_KEY = 'gisContent.layerFields.v1'
const LS_RELATIONSHIPS_KEY = 'gisContent.relationships.v1'
const LS_HIDDEN_FIELDS_KEY = 'gisContent.hiddenFields.v1'

const initDB = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment.'))
      return
    }
    let settled = false
    const timeoutId = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('IndexedDB initialization timed out.'))
    }, 1500)

    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      resolve(req.result)
    }
    req.onerror = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      reject(req.error)
    }
  })

const saveLayersToDB = async (layers: LayerData[]) => {
  const db = await initDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  tx.objectStore(STORE_NAME).put(layers, 'savedLayers')
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

const loadLayersFromDB = async (): Promise<LayerData[]> => {
  const db = await initDB()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const req = tx.objectStore(STORE_NAME).get('savedLayers')
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

const safeLocalStorageGetItem = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const safeLocalStorageSetItem = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
  }
}

const safeParseJson = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return (parsed as T) ?? fallback
  } catch {
    return fallback
  }
}

const safeString = (v: any) => (v === null || v === undefined ? '' : String(v))

const newId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`

const normalizeName = (raw: string) => raw.trim().replace(/\s+/g, ' ')

const isValidFieldName = (name: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)

const getGeoJsonFields = (data: any) => {
  const features = Array.isArray(data?.features) ? (data.features as any[]) : []
  const fields = new Set<string>()
  for (let i = 0; i < Math.min(features.length, 50); i += 1) {
    const props = features[i]?.properties
    if (!props || typeof props !== 'object') continue
    Object.keys(props).forEach(k => fields.add(k))
  }
  return Array.from(fields).sort((a, b) => a.localeCompare(b))
}

const getGeometryType = (layer: LayerData) => {
  const arc = layer.source === 'arcgis' ? layer.arcgisLayerDefinition : null
  const fromArc = typeof arc?.geometryType === 'string' ? arc.geometryType : ''
  if (fromArc) return fromArc
  const features = Array.isArray(layer.data?.features) ? (layer.data.features as any[]) : []
  const g = features.find(f => f?.geometry?.type)?.geometry?.type
  return typeof g === 'string' ? g : '—'
}

const getRecordCount = (layer: LayerData) => {
  const features = Array.isArray(layer.data?.features) ? (layer.data.features as any[]) : []
  return features.length
}

const mapArcFieldType = (arcType: string | undefined): FieldType => {
  const t = (arcType || '').toLowerCase()
  if (t.includes('date')) return 'date'
  if (t.includes('integer') || t.includes('double') || t.includes('single') || t.includes('smallinteger')) return 'number'
  if (t.includes('oid')) return 'number'
  if (t.includes('string') || t.includes('guid')) return 'text'
  return 'text'
}

const buildArcGisUrl = (baseUrl: string, params: Record<string, string>) => {
  const normalized = baseUrl.trim().replace(/#.*$/, '').replace(/\?.*$/, '').replace(/\/+$/, '')
  const u = new URL(normalized, window.location.origin)
  const search = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== '') search.set(k, v)
  })
  u.search = search.toString()
  return u.toString()
}

const normalizeArcGisServiceUrl = (raw: string) => {
  const trimmed = raw.trim().replace(/#.*$/, '').replace(/\?.*$/, '').replace(/\/+$/, '')
  const parts = trimmed.split('/')
  const last = parts[parts.length - 1]
  const prev = parts[parts.length - 2]
  if (/^\d+$/.test(last) && (prev === 'FeatureServer' || prev === 'MapServer')) {
    return parts.slice(0, -1).join('/')
  }
  return trimmed
}

const discoverArcGisLayers = async (serviceUrl: string, token: string) => {
  const base = normalizeArcGisServiceUrl(serviceUrl)
  const url = buildArcGisUrl(base, { f: 'json', token: token.trim() })
  const res = await fetch(url, { method: 'GET' })
  const json = await res.json()
  if (json?.error?.message) {
    const details = Array.isArray(json?.error?.details) ? json.error.details.join(' ') : ''
    throw new Error([json.error.message, details].filter(Boolean).join(' '))
  }
  const layersArr = Array.isArray(json?.layers) ? json.layers : []
  const tablesArr = Array.isArray(json?.tables) ? json.tables : []
  const discovered = [...layersArr.map((l: any) => ({ ...l, kind: 'layer' as const })), ...tablesArr.map((t: any) => ({ ...t, kind: 'table' as const }))]
    .filter((l: any) => typeof l?.id === 'number' && typeof l?.name === 'string')
    .map((l: any) => ({
      id: l.id as number,
      name: l.name as string,
      kind: l.kind as 'layer' | 'table',
      url: `${base.replace(/\/+$/, '')}/${l.id}`,
      geometryType: typeof l?.geometryType === 'string' ? (l.geometryType as string) : undefined,
    }))
  if (discovered.length === 0) throw new Error('No layers/tables found at this URL.')
  return discovered
}

const fetchArcGisGeoJson = async (layerUrl: string, authToken?: string, opts?: { returnGeometry?: boolean }) => {
  const returnGeometry = opts?.returnGeometry !== false
  const url = buildArcGisUrl(`${layerUrl.replace(/\/+$/, '')}/query`, {
    where: '1=1',
    outFields: '*',
    returnGeometry: returnGeometry ? 'true' : 'false',
    outSR: '4326',
    f: 'geojson',
    resultRecordCount: '2000',
    token: (authToken ?? '').trim(),
  })
  const res = await fetch(url, { method: 'GET' })
  const geojson = await res.json()
  if (geojson?.error?.message) {
    const details = Array.isArray(geojson?.error?.details) ? geojson.error.details.join(' ') : ''
    throw new Error([geojson.error.message, details].filter(Boolean).join(' '))
  }
  if (!geojson || geojson.type !== 'FeatureCollection') throw new Error('Service did not return valid GeoJSON.')
  return geojson
}

const fetchArcGisLayerDefinition = async (layerUrl: string, authToken?: string) => {
  const url = buildArcGisUrl(layerUrl.replace(/\/+$/, ''), { f: 'json', token: (authToken ?? '').trim() })
  const res = await fetch(url, { method: 'GET' })
  const json = await res.json()
  if (json?.error?.message) {
    const details = Array.isArray(json?.error?.details) ? json.error.details.join(' ') : ''
    throw new Error([json.error.message, details].filter(Boolean).join(' '))
  }
  return json
}

function RecordsPanel({
  layer,
  fields,
  hiddenFields,
  setHiddenFields,
}: {
  layer: LayerData
  fields: FieldSchema[]
  hiddenFields: string[]
  setHiddenFields: (next: string[]) => void
}) {
  const features = Array.isArray(layer.data?.features) ? (layer.data.features as any[]) : []
  const fieldsAll = useMemo(() => fields.map(f => f.name).filter(Boolean), [fields])
  const hidden = useMemo(() => new Set(hiddenFields), [hiddenFields])
  const fieldsVisible = useMemo(() => fieldsAll.filter(f => !hidden.has(f)), [fieldsAll, hidden])

  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return features
    const maxScan = Math.min(features.length, 5000)
    const out: any[] = []
    for (let i = 0; i < maxScan; i += 1) {
      const props = features[i]?.properties
      if (!props || typeof props !== 'object') continue
      const hay = fieldsVisible
        .slice(0, 20)
        .map(k => safeString(props[k]).toLowerCase())
        .join(' ')
      if (hay.includes(q)) out.push(features[i])
    }
    return out
  }, [features, query, fieldsVisible])

  const total = filtered.length
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.max(0, Math.min(pages - 1, page))
  const start = safePage * pageSize
  const view = filtered.slice(start, start + pageSize)

  useEffect(() => {
    if (safePage !== page) setPage(safePage)
  }, [safePage])

  return (
    <div className="gis-content-panel">
      <div className="gis-content-panelbar">
        <div className="gis-content-paneltitle">Data Table</div>
        <div className="gis-content-panelactions">
          <input className="gis-input gis-content-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search in records..." />
          <div className="gis-content-selectwrap">
            <select className="gis-content-select" value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value))}>
              {[25, 50, 100, 200].map(n => (
                <option key={n} value={String(n)}>
                  {n} / page
                </option>
              ))}
            </select>
            <i className="fa-solid fa-chevron-down" aria-hidden="true" />
          </div>
          <button
            className="gis-btn"
            type="button"
            onClick={() => {
              setHiddenFields(hiddenFields.length ? [] : fieldsAll)
            }}
            disabled={!fieldsAll.length}
          >
            {hidden.size ? 'Show all fields' : 'Hide all fields'}
          </button>
        </div>
      </div>

      <div className="gis-content-fieldsbar" aria-label="Field controls">
        {fieldsAll.length ? (
          fieldsAll.map((f) => {
            const on = !hidden.has(f)
            return (
              <button
                key={f}
                type="button"
                className={on ? 'gis-content-chip active' : 'gis-content-chip'}
                aria-pressed={on}
                onClick={() => {
                  const prev = new Set(hiddenFields)
                  if (on) prev.add(f)
                  else prev.delete(f)
                  setHiddenFields(Array.from(prev))
                }}
              >
                {f}
              </button>
            )
          })
        ) : (
          <div className="gis-content-muted">No fields.</div>
        )}
      </div>

      <div className="gis-content-tablewrap" role="region" aria-label="Tabular data">
        <table className="gis-content-table">
          <thead>
            <tr>
              {fieldsVisible.map(f => (
                <th key={f} title={f}>
                  {f}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((ft, idx) => {
              const props = ft?.properties && typeof ft.properties === 'object' ? (ft.properties as Record<string, any>) : {}
              const rowKey = `${start + idx}`
              return (
                <tr key={rowKey}>
                  {fieldsVisible.map((f) => (
                    <td key={`${rowKey}:${f}`} title={safeString(props[f])}>
                      {safeString(props[f])}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="gis-content-pagination" aria-label="Pagination">
        <div className="gis-content-muted">{total ? `${start + 1}-${Math.min(start + pageSize, total)} of ${total}` : '0'}</div>
        <div className="gis-content-pager">
          <button className="gis-btn" type="button" onClick={() => setPage(0)} disabled={safePage === 0}>
            First
          </button>
          <button className="gis-btn" type="button" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}>
            Prev
          </button>
          <div className="gis-content-pageinfo">
            Page {safePage + 1} / {pages}
          </div>
          <button className="gis-btn" type="button" onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={safePage >= pages - 1}>
            Next
          </button>
          <button className="gis-btn" type="button" onClick={() => setPage(pages - 1)} disabled={safePage >= pages - 1}>
            Last
          </button>
        </div>
      </div>
    </div>
  )
}

function GisContentPage() {
  const [layers, setLayers] = useState<LayerData[]>([])
  const [layersLoaded, setLayersLoaded] = useState(false)
  const [layersLoadError, setLayersLoadError] = useState<string | null>(null)
  const persistLayersJobRef = useRef<null | { kind: 'idle'; id: number } | { kind: 'timeout'; id: ReturnType<typeof setTimeout> }>(null)
  const [syncingLayerId, setSyncingLayerId] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'data' | 'fields' | 'relationships'>('data')
  const [helpOpen, setHelpOpen] = useState(false)
  const [layerQuery, setLayerQuery] = useState('')
  const [sortBy, setSortBy] = useState<'priority' | 'name' | 'date'>('priority')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const [layerMeta, setLayerMeta] = useState<Record<string, { createdAt: string }>>(() =>
    safeParseJson<Record<string, { createdAt: string }>>(safeLocalStorageGetItem(LS_META_KEY), {}),
  )
  const [layerOrder, setLayerOrder] = useState<string[]>(() => safeParseJson<string[]>(safeLocalStorageGetItem(LS_ORDER_KEY), []))
  const [layerFields, setLayerFields] = useState<Record<string, FieldSchema[]>>(() =>
    safeParseJson<Record<string, FieldSchema[]>>(safeLocalStorageGetItem(LS_FIELDS_KEY), {}),
  )
  const [relationships, setRelationships] = useState<Relationship[]>(() =>
    safeParseJson<Relationship[]>(safeLocalStorageGetItem(LS_RELATIONSHIPS_KEY), []),
  )
  const [hiddenFieldsByLayerId, setHiddenFieldsByLayerId] = useState<Record<string, string[]>>(() =>
    safeParseJson<Record<string, string[]>>(safeLocalStorageGetItem(LS_HIDDEN_FIELDS_KEY), {}),
  )

  const [layerModal, setLayerModal] = useState<null | { mode: 'edit'; layerId: string }>(null)
  const [confirm, setConfirm] = useState<
    | null
    | { kind: 'deleteLayer'; layerId: string }
    | { kind: 'deleteField'; layerId: string; fieldId: string }
    | { kind: 'deleteRelationship'; id: string }
  >(null)

  const [editName, setEditName] = useState('')
  const [editError, setEditError] = useState<string | null>(null)

  const [isAddOpen, setIsAddOpen] = useState(false)
  const [tab, setTab] = useState<AddLayerTab>('arcgis')
  const [serviceUrl, setServiceUrl] = useState('')
  const [token, setToken] = useState('')
  const [discoveredLayers, setDiscoveredLayers] = useState<Array<{ id: number; name: string; kind: 'layer' | 'table'; url: string; geometryType?: string }>>([])
  const [selectedDiscoveredUrl, setSelectedDiscoveredUrl] = useState('')
  const [layerName, setLayerName] = useState('')
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [addingLayerKey, setAddingLayerKey] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)

  const [fieldModal, setFieldModal] = useState<null | { mode: 'add' | 'edit'; layerId: string; fieldId?: string }>(null)
  const [fieldDraft, setFieldDraft] = useState<{ name: string; type: FieldType; length: string; defaultValue: string; nullable: boolean }>({
    name: '',
    type: 'text',
    length: '',
    defaultValue: '',
    nullable: true,
  })
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [dragFieldId, setDragFieldId] = useState<string | null>(null)

  const [relModal, setRelModal] = useState<null | { mode: 'add' | 'edit'; id?: string }>(null)
  const [relDraft, setRelDraft] = useState<Relationship>(() => ({
    id: newId(),
    name: '',
    type: 'one-to-many',
    originLayerId: '',
    destinationLayerId: '',
    originKey: '',
    destinationKey: '',
    enforce: true,
    cascadeDelete: false,
    junctionLayerId: '',
    originJunctionKey: '',
    destinationJunctionKey: '',
  }))
  const [relError, setRelError] = useState<string | null>(null)

  const selectedLayer = useMemo(
    () => (selectedLayerId ? layers.find(l => String(l.id) === selectedLayerId) ?? null : null),
    [layers, selectedLayerId],
  )

  useEffect(() => {
    loadLayersFromDB()
      .then((saved) => {
        setLayers(saved)
        setLayersLoaded(true)
        setLayersLoadError(null)
        if (!selectedLayerId && saved.length) setSelectedLayerId(String(saved[0].id))
      })
      .catch((e: any) => {
        setLayersLoaded(true)
        setLayers([])
        setLayersLoadError(typeof e?.message === 'string' ? e.message : 'Failed to load saved layers.')
      })
  }, [])

  useEffect(() => {
    if (layersLoaded) return
    const t = window.setTimeout(() => {
      if (layersLoaded) return
      setLayersLoaded(true)
      setLayers([])
      setLayersLoadError('Loading GIS content timed out. Local storage/IndexedDB may be blocked. Use Reset to continue.')
    }, 2500)
    return () => window.clearTimeout(t)
  }, [layersLoaded])

  const resetGisContentStorage = () => {
    try {
      localStorage.removeItem(LS_META_KEY)
      localStorage.removeItem(LS_ORDER_KEY)
      localStorage.removeItem(LS_FIELDS_KEY)
      localStorage.removeItem(LS_RELATIONSHIPS_KEY)
      localStorage.removeItem(LS_HIDDEN_FIELDS_KEY)
    } catch {
    }
    try {
      if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase(DB_NAME)
    } catch {
    }
    window.location.reload()
  }

  useEffect(() => {
    if (!isAddOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setIsAddOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isAddOpen])

  useEffect(() => {
    if (!syncError) return
    const t = window.setTimeout(() => setSyncError(null), 2500)
    return () => window.clearTimeout(t)
  }, [syncError])

  useEffect(() => {
    if (!layersLoaded) return
    if (persistLayersJobRef.current) {
      const job = persistLayersJobRef.current
      persistLayersJobRef.current = null
      if (job.kind === 'idle') {
        ;(window as any).cancelIdleCallback?.(job.id)
      } else {
        clearTimeout(job.id)
      }
    }

    const run = () => {
      persistLayersJobRef.current = null
      saveLayersToDB(layers).catch(() => {})
    }

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const id = (window as any).requestIdleCallback(run, { timeout: 2000 })
      persistLayersJobRef.current = { kind: 'idle', id }
      return () => {
        ;(window as any).cancelIdleCallback?.(id)
      }
    }

    const id = setTimeout(run, 1200)
    persistLayersJobRef.current = { kind: 'timeout', id }
    return () => {
      clearTimeout(id)
    }
  }, [layers, layersLoaded])

  useEffect(() => {
    safeLocalStorageSetItem(LS_META_KEY, JSON.stringify(layerMeta))
  }, [layerMeta])

  useEffect(() => {
    safeLocalStorageSetItem(LS_ORDER_KEY, JSON.stringify(layerOrder))
  }, [layerOrder])

  useEffect(() => {
    safeLocalStorageSetItem(LS_FIELDS_KEY, JSON.stringify(layerFields))
  }, [layerFields])

  useEffect(() => {
    safeLocalStorageSetItem(LS_RELATIONSHIPS_KEY, JSON.stringify(relationships))
  }, [relationships])

  useEffect(() => {
    safeLocalStorageSetItem(LS_HIDDEN_FIELDS_KEY, JSON.stringify(hiddenFieldsByLayerId))
  }, [hiddenFieldsByLayerId])

  useEffect(() => {
    const nextMeta: Record<string, { createdAt: string }> = { ...layerMeta }
    let changed = false
    layers.forEach((l) => {
      const id = String(l.id)
      if (!nextMeta[id]?.createdAt) {
        nextMeta[id] = { createdAt: new Date().toISOString() }
        changed = true
      }
    })
    if (changed) setLayerMeta(nextMeta)
  }, [layers])

  useEffect(() => {
    const ids = layers.map(l => String(l.id))
    const current = layerOrder.filter(id => ids.includes(id))
    const missing = ids.filter(id => !current.includes(id))
    if (missing.length) setLayerOrder([...current, ...missing])
  }, [layers])

  useEffect(() => {
    if (!selectedLayer) return
    const layerId = String(selectedLayer.id)
    if (layerFields[layerId]?.length) return
    const fromArc: FieldSchema[] =
      selectedLayer.source === 'arcgis' && Array.isArray(selectedLayer.arcgisLayerDefinition?.fields)
        ? (selectedLayer.arcgisLayerDefinition.fields as any[])
            .filter(f => typeof f?.name === 'string' && f.name)
            .map((f) => ({
              id: newId(),
              name: String(f.name),
              type: mapArcFieldType(typeof f?.type === 'string' ? f.type : undefined),
              length: typeof f?.length === 'number' ? f.length : undefined,
              defaultValue: '',
              nullable: typeof f?.nullable === 'boolean' ? f.nullable : true,
            }))
        : []
    const fromProps: FieldSchema[] = getGeoJsonFields(selectedLayer.data).map((name) => ({
      id: newId(),
      name,
      type: 'text',
      defaultValue: '',
      nullable: true,
    }))
    const initial = fromArc.length ? fromArc : fromProps
    setLayerFields(prev => ({ ...prev, [layerId]: initial }))
  }, [selectedLayerId, selectedLayer, layerFields])

  const rows: LayerRow[] = useMemo(() => {
    const q = layerQuery.trim().toLowerCase()
    const base = layers.map((l) => {
      const id = String(l.id)
      return {
        id,
        name: l.name,
        visible: !!l.visible,
        source: l.source,
        geometryType: getGeometryType(l),
        recordCount: getRecordCount(l),
        createdAt: layerMeta[id]?.createdAt || new Date().toISOString(),
      }
    })
    const filtered = q ? base.filter(r => r.name.toLowerCase().includes(q) || r.geometryType.toLowerCase().includes(q) || r.id.includes(q)) : base

    const orderIndex = new Map<string, number>()
    layerOrder.forEach((id, idx) => orderIndex.set(id, idx))

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'priority') {
        const ai = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER
        const bi = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER
        return ai - bi
      }
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      return a.createdAt.localeCompare(b.createdAt)
    })
    if (sortDir === 'desc') sorted.reverse()
    return sorted
  }, [layers, layerMeta, layerQuery, sortBy, sortDir, layerOrder])

  const selectedFields = useMemo(() => (selectedLayer ? layerFields[String(selectedLayer.id)] ?? [] : []), [selectedLayer, layerFields])

  const visibleFieldNames = useMemo(() => {
    if (!selectedLayer) return []
    const layerId = String(selectedLayer.id)
    const hidden = new Set(hiddenFieldsByLayerId[layerId] ?? [])
    return selectedFields.map(f => f.name).filter(n => n && !hidden.has(n))
  }, [selectedLayer, selectedFields, hiddenFieldsByLayerId])

  const applyMoveLayer = (layerId: string, direction: 'up' | 'down') => {
    const idx = layerOrder.indexOf(layerId)
    if (idx === -1) return
    const next = [...layerOrder]
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= next.length) return
    ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    setLayerOrder(next)
  }

  const toggleLayerVisible = (layerId: string) => {
    setLayers(prev => prev.map(l => (String(l.id) === layerId ? { ...l, visible: !l.visible } : l)))
  }

  const syncArcGisLayer = async (layerId: string) => {
    const layer = layers.find(l => String(l.id) === layerId)
    if (!layer || layer.source !== 'arcgis' || !layer.url) return
    if (syncingLayerId) return

    setSyncError(null)
    setSyncingLayerId(layerId)
    try {
      const def = await fetchArcGisLayerDefinition(layer.url, layer.authToken)
      const isTable = def?.type && String(def.type).toLowerCase() === 'table'
      const geojson = await fetchArcGisGeoJson(layer.url, layer.authToken, { returnGeometry: !isTable })
      setLayers(prev =>
        prev.map(l =>
          String(l.id) === layerId
            ? {
                ...l,
                data: geojson,
                arcgisLayerDefinition: def ?? l.arcgisLayerDefinition,
              }
            : l,
        ),
      )
    } catch (e: any) {
      setSyncError(typeof e?.message === 'string' ? e.message : 'Failed to sync from ArcGIS.')
    } finally {
      setSyncingLayerId(null)
    }
  }

  const openEditLayer = (layerId: string) => {
    const l = layers.find(x => String(x.id) === layerId)
    if (!l) return
    setEditError(null)
    setEditName(l.name)
    setLayerModal({ mode: 'edit', layerId })
  }

  const openAddLayer = () => {
    dragDepthRef.current = 0
    setIsDragOver(false)
    setUploadFile(null)
    setTab('arcgis')
    setServiceUrl('')
    setToken('')
    setDiscoveredLayers([])
    setSelectedDiscoveredUrl('')
    setLayerName('')
    setDiscoverError(null)
    setIsDiscovering(false)
    setAddingLayerKey(null)
    setIsAddOpen(true)
  }

  const closeEditLayerModal = () => {
    setLayerModal(null)
    setEditError(null)
  }

  const saveEditLayer = () => {
    if (!layerModal) return
    const name = normalizeName(editName)
    if (!name) {
      setEditError('Layer name is required.')
      return
    }
    setLayers(prev => prev.map(l => (String(l.id) === layerModal.layerId ? { ...l, name } : l)))
    closeEditLayerModal()
  }

  const closeAddLayer = () => {
    dragDepthRef.current = 0
    setIsDragOver(false)
    setIsAddOpen(false)
    setDiscoverError(null)
    setIsDiscovering(false)
    setAddingLayerKey(null)
  }

  const discoverFromService = async () => {
    setDiscoverError(null)
    setIsDiscovering(true)
    try {
      const found = await discoverArcGisLayers(serviceUrl, token)
      setDiscoveredLayers(found)
      const firstUrl = found[0]?.url ?? ''
      setSelectedDiscoveredUrl(firstUrl)
      if (firstUrl) setLayerName(found[0]?.name ?? '')
    } catch (e: any) {
      setDiscoverError(typeof e?.message === 'string' ? e.message : 'Failed to connect to service.')
      setDiscoveredLayers([])
      setSelectedDiscoveredUrl('')
    } finally {
      setIsDiscovering(false)
    }
  }

  const addArcGisLayerAsGeoJson = async (selected: { name: string; kind: 'layer' | 'table'; url: string; geometryType?: string }) => {
    const key = `arcgis:${selected.url}`
    setAddingLayerKey(key)
    setDiscoverError(null)
    try {
      const def = await fetchArcGisLayerDefinition(selected.url, token).catch(() => null)
      const hasGeometry =
        def?.type && String(def.type).toLowerCase() === 'table'
          ? false
          : typeof def?.geometryType === 'string'
            ? true
            : !!selected.geometryType
      const geojson = await fetchArcGisGeoJson(selected.url, token, { returnGeometry: hasGeometry })
      const name = normalizeName(layerName) || selected.name
      const newLayer: LayerData = {
        id: key,
        name,
        type: 'geojson',
        source: 'arcgis',
        visible: true,
        opacity: 1,
        data: geojson,
        url: selected.url,
        authToken: token.trim() ? token.trim() : undefined,
        arcgisLayerDefinition: def ?? undefined,
      }
      setLayers(prev => [...prev, newLayer])
      setSelectedLayerId(key)
      closeAddLayer()
    } catch (e: any) {
      setDiscoverError(typeof e?.message === 'string' ? e.message : 'Failed to add layer.')
    } finally {
      setAddingLayerKey(null)
    }
  }

  const setUploadFromFile = (file: File | null) => {
    setUploadFile(file)
    if (!file) return
    const current = normalizeName(layerName)
    if (current) return
    const fallback = normalizeName(file.name.replace(/\.[^.]+$/, ''))
    if (fallback) setLayerName(fallback)
  }

  const addUploadLayerAsGeoJson = async () => {
    if (!uploadFile) return
    const key = `upload:${uploadFile.name}`
    setAddingLayerKey(key)
    setDiscoverError(null)
    try {
      const parsed = await parseFile(uploadFile)
      if (parsed.type !== 'geojson') throw new Error('File must contain GIS features (GeoJSON/KML/KMZ/Shapefile zip).')
      let geojson: any = parsed.data
      if (Array.isArray(geojson)) geojson = geojson[0]
      if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
        throw new Error('File must be a GeoJSON FeatureCollection.')
      }
      const layerId = `upload:${newId()}`
      const name = normalizeName(layerName) || normalizeName(uploadFile.name.replace(/\.[^.]+$/, '')) || 'Layer'
      const newLayer: LayerData = { id: layerId, name, type: 'geojson', source: 'upload', visible: true, opacity: 1, data: geojson }
      setLayers(prev => [...prev, newLayer])
      setSelectedLayerId(layerId)
      closeAddLayer()
    } catch (e: any) {
      setDiscoverError(typeof e?.message === 'string' ? e.message : 'Failed to import file.')
    } finally {
      setAddingLayerKey(null)
    }
  }

  const openAddField = (layerId: string) => {
    setFieldError(null)
    setFieldDraft({ name: '', type: 'text', length: '', defaultValue: '', nullable: true })
    setFieldModal({ mode: 'add', layerId })
  }

  const openEditField = (layerId: string, fieldId: string) => {
    const fields = layerFields[layerId] ?? []
    const f = fields.find(x => x.id === fieldId)
    if (!f) return
    setFieldError(null)
    setFieldDraft({
      name: f.name,
      type: f.type,
      length: typeof f.length === 'number' ? String(f.length) : '',
      defaultValue: f.defaultValue ?? '',
      nullable: typeof f.nullable === 'boolean' ? f.nullable : true,
    })
    setFieldModal({ mode: 'edit', layerId, fieldId })
  }

  const closeFieldModal = () => {
    setFieldModal(null)
    setFieldError(null)
  }

  const applyFieldSave = () => {
    if (!fieldModal) return
    const layerId = fieldModal.layerId
    const existing = layerFields[layerId] ?? []
    const name = normalizeName(fieldDraft.name)
    if (!name) {
      setFieldError('Field name is required.')
      return
    }
    if (!isValidFieldName(name)) {
      setFieldError('Field name must start with a letter/underscore and contain only letters, numbers, and underscores.')
      return
    }
    const dup = existing.find(f => f.name.toLowerCase() === name.toLowerCase() && f.id !== fieldModal.fieldId)
    if (dup) {
      setFieldError('Field name already exists.')
      return
    }
    const lengthNum = fieldDraft.length.trim() ? Number(fieldDraft.length) : undefined
    if (fieldDraft.type === 'text' && fieldDraft.length.trim() && (!Number.isFinite(lengthNum) || (lengthNum as number) <= 0)) {
      setFieldError('Length must be a positive number.')
      return
    }

    const nextField: FieldSchema = {
      id: fieldModal.mode === 'add' ? newId() : (fieldModal.fieldId as string),
      name,
      type: fieldDraft.type,
      length: fieldDraft.type === 'text' && typeof lengthNum === 'number' ? Math.round(lengthNum) : undefined,
      defaultValue: fieldDraft.defaultValue,
      nullable: fieldDraft.nullable,
    }

    if (fieldModal.mode === 'add') {
      setLayerFields(prev => ({ ...prev, [layerId]: [...existing, nextField] }))
      setLayers(prev =>
        prev.map((l) => {
          if (String(l.id) !== layerId) return l
          if (!l.data || !Array.isArray((l.data as any).features)) return l
          const features = (l.data as any).features as any[]
          const rawDefault = (nextField.defaultValue ?? '').trim()
          const defVal =
            rawDefault === ''
              ? null
              : nextField.type === 'number'
                ? Number(rawDefault)
                : nextField.type === 'boolean'
                  ? rawDefault === 'true' || rawDefault === '1'
                  : rawDefault
          const updated = features.map((f) => ({
            ...f,
            properties: { ...(f?.properties ?? {}), [name]: defVal },
          }))
          return { ...l, data: { ...l.data, features: updated } }
        }),
      )
      closeFieldModal()
      return
    }

    const prevField = existing.find(f => f.id === fieldModal.fieldId)
    if (!prevField) return
    setLayerFields(prev => ({ ...prev, [layerId]: existing.map(f => (f.id === prevField.id ? nextField : f)) }))

    if (prevField.name !== nextField.name) {
      setLayers(prev =>
        prev.map((l) => {
          if (String(l.id) !== layerId) return l
          if (!l.data || !Array.isArray((l.data as any).features)) return l
          const features = (l.data as any).features as any[]
          const updated = features.map((f) => {
            const props = { ...(f?.properties ?? {}) }
            if (Object.prototype.hasOwnProperty.call(props, prevField.name)) {
              props[nextField.name] = props[prevField.name]
              delete props[prevField.name]
            }
            return { ...f, properties: props }
          })
          return { ...l, data: { ...l.data, features: updated } }
        }),
      )
    }
    closeFieldModal()
  }

  const applyFieldReorder = (layerId: string, sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    const arr = layerFields[layerId] ?? []
    const fromIdx = arr.findIndex(f => f.id === sourceId)
    const toIdx = arr.findIndex(f => f.id === targetId)
    if (fromIdx === -1 || toIdx === -1) return
    const next = [...arr]
    const [item] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, item)
    setLayerFields(prev => ({ ...prev, [layerId]: next }))
  }

  const applyDeleteLayer = (layerId: string) => {
    setLayers(prev => prev.filter(l => String(l.id) !== layerId))
    setRelationships(prev => prev.filter(r => r.originLayerId !== layerId && r.destinationLayerId !== layerId && r.junctionLayerId !== layerId))
    setLayerFields(prev => {
      const next = { ...prev }
      delete next[layerId]
      return next
    })
    setHiddenFieldsByLayerId(prev => {
      const next = { ...prev }
      delete next[layerId]
      return next
    })
    setLayerOrder(prev => prev.filter(id => id !== layerId))
    setLayerMeta(prev => {
      const next = { ...prev }
      delete next[layerId]
      return next
    })
    if (selectedLayerId === layerId) setSelectedLayerId(null)
  }

  const applyDeleteField = (layerId: string, fieldId: string) => {
    const fields = layerFields[layerId] ?? []
    const target = fields.find(f => f.id === fieldId)
    if (!target) return
    const usedInRelationship = relationships.some((r) => {
      if (r.originLayerId === layerId && r.originKey === target.name) return true
      if (r.destinationLayerId === layerId && r.destinationKey === target.name) return true
      if (r.junctionLayerId === layerId && (r.originJunctionKey === target.name || r.destinationJunctionKey === target.name)) return true
      return false
    })
    if (usedInRelationship) {
      window.alert('Cannot delete this field because it is used by a relationship. Edit or delete the relationship first.')
      return
    }
    setLayerFields(prev => ({ ...prev, [layerId]: fields.filter(f => f.id !== fieldId) }))
    setLayers(prev =>
      prev.map((l) => {
        if (String(l.id) !== layerId) return l
        if (!l.data || !Array.isArray((l.data as any).features)) return l
        const features = (l.data as any).features as any[]
        const updated = features.map((f) => {
          const props = { ...(f?.properties ?? {}) }
          delete props[target.name]
          return { ...f, properties: props }
        })
        return { ...l, data: { ...l.data, features: updated } }
      }),
    )
  }

  const openAddRelationship = () => {
    setRelError(null)
    setRelDraft({
      id: newId(),
      name: '',
      type: 'one-to-many',
      originLayerId: selectedLayerId ?? '',
      destinationLayerId: '',
      originKey: '',
      destinationKey: '',
      enforce: true,
      cascadeDelete: false,
      junctionLayerId: '',
      originJunctionKey: '',
      destinationJunctionKey: '',
    })
    setRelModal({ mode: 'add' })
  }

  const openEditRelationship = (id: string) => {
    const r = relationships.find(x => x.id === id)
    if (!r) return
    setRelError(null)
    setRelDraft({ ...r })
    setRelModal({ mode: 'edit', id })
  }

  const closeRelModal = () => {
    setRelModal(null)
    setRelError(null)
  }

  const relationshipKeyFieldsForLayer = (layerId: string) => {
    const fields = layerFields[layerId] ?? []
    return fields.map(f => f.name).filter(Boolean)
  }

  const validateRelationship = (draft: Relationship) => {
    if (!draft.name.trim()) return 'Relationship name is required.'
    if (!draft.originLayerId || !draft.destinationLayerId) return 'Select origin and destination layers.'
    if (draft.originLayerId === draft.destinationLayerId && draft.type !== 'many-to-many') return 'You can only relate a layer to itself via Many-to-Many.'
    if (!draft.originKey || !draft.destinationKey) return 'Select key fields.'
    if (draft.type === 'many-to-many') {
      if (!draft.junctionLayerId) return 'Select a junction layer for Many-to-Many.'
      if (!draft.originJunctionKey || !draft.destinationJunctionKey) return 'Select junction keys.'
    }
    const dup = relationships.find(r => r.id !== draft.id && r.name.trim().toLowerCase() === draft.name.trim().toLowerCase())
    if (dup) return 'Relationship name already exists.'
    return null
  }

  const saveRelationship = () => {
    const err = validateRelationship(relDraft)
    if (err) {
      setRelError(err)
      return
    }
    if (relModal?.mode === 'edit') {
      setRelationships(prev => prev.map(r => (r.id === relDraft.id ? relDraft : r)))
    } else {
      setRelationships(prev => [...prev, relDraft])
    }
    closeRelModal()
  }

  const relationshipTree = useMemo(() => {
    const byOrigin = new Map<string, Relationship[]>()
    relationships.forEach((r) => {
      const list = byOrigin.get(r.originLayerId) ?? []
      list.push(r)
      byOrigin.set(r.originLayerId, list)
    })
    return { byOrigin }
  }, [relationships])

  const renderMainHeader = () => (
    <div className="gis-content-header">
      <div className="gis-content-title">
        <i className="fa-solid fa-layer-group" aria-hidden="true" />
        <span>GIS Layers</span>
      </div>
      <div className="gis-content-tabs" role="tablist" aria-label="Layer management tabs">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'data'}
          className={activeTab === 'data' ? 'gis-content-tab active' : 'gis-content-tab'}
          onClick={() => setActiveTab('data')}
          disabled={!selectedLayer}
        >
          Data
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'fields'}
          className={activeTab === 'fields' ? 'gis-content-tab active' : 'gis-content-tab'}
          onClick={() => setActiveTab('fields')}
          disabled={!selectedLayer}
        >
          Fields
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'relationships'}
          className={activeTab === 'relationships' ? 'gis-content-tab active' : 'gis-content-tab'}
          onClick={() => setActiveTab('relationships')}
        >
          Relationships
        </button>
        <button className="gis-content-tab gis-content-tab-docs" type="button" onClick={() => setHelpOpen(true)}>
          <i className="fa-solid fa-book" aria-hidden="true" />
          <span>Documentation</span>
        </button>
      </div>
    </div>
  )

  const renderRecords = () => {
    if (!selectedLayer) return <div className="gis-content-empty">Select a layer from the list to view data.</div>
    const layerId = String(selectedLayer.id)
    const hidden = hiddenFieldsByLayerId[layerId] ?? []
    return (
      <RecordsPanel
        layer={selectedLayer}
        fields={selectedFields}
        hiddenFields={hidden}
        setHiddenFields={(next) => setHiddenFieldsByLayerId(prev => ({ ...prev, [layerId]: next }))}
      />
    )
  }

  const [fieldSortBy, setFieldSortBy] = useState<'name' | 'type' | 'length' | 'domain' | 'subtype' | 'default' | 'nullable'>('name')
  const [fieldSortDir, setFieldSortDir] = useState<'asc' | 'desc'>('asc')
  const [fieldQuery, setFieldQuery] = useState('')

  const renderFields = () => {
    if (!selectedLayer) return <div className="gis-content-empty">Select a layer first.</div>
    const layerId = String(selectedLayer.id)
    const fields = layerFields[layerId] ?? []
    
    const arcDef = selectedLayer.source === 'arcgis' ? selectedLayer.arcgisLayerDefinition : null
    const arcFields = Array.isArray(arcDef?.fields) ? (arcDef.fields as any[]) : []
    const arcTypes = Array.isArray(arcDef?.types) ? (arcDef.types as any[]) : []
    const typeIdField = typeof arcDef?.typeIdField === 'string' ? arcDef.typeIdField : ''

    const enrichedFields = fields.map(f => {
      const arcField = arcFields.find(af => String(af?.name).toLowerCase() === f.name.toLowerCase())
      const domain = arcField?.domain
      const domainName = domain?.name ? String(domain.name) : domain?.type ? String(domain.type) : '—'
      
      let subtypeDesc = '—'
      if (typeIdField && f.name.toLowerCase() === typeIdField.toLowerCase()) {
        subtypeDesc = 'Subtype Field'
      } else if (arcTypes.some(t => t.domains && t.domains[f.name])) {
        subtypeDesc = 'Varies by Subtype'
      }

      return {
        ...f,
        domainName,
        subtypeDesc
      }
    })

    const filtered = fieldQuery.trim() 
      ? enrichedFields.filter(f => f.name.toLowerCase().includes(fieldQuery.toLowerCase()) || f.type.toLowerCase().includes(fieldQuery.toLowerCase()))
      : enrichedFields

    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0
      if (fieldSortBy === 'name') cmp = a.name.localeCompare(b.name)
      else if (fieldSortBy === 'type') cmp = a.type.localeCompare(b.type)
      else if (fieldSortBy === 'length') cmp = (a.length || 0) - (b.length || 0)
      else if (fieldSortBy === 'domain') cmp = a.domainName.localeCompare(b.domainName)
      else if (fieldSortBy === 'subtype') cmp = a.subtypeDesc.localeCompare(b.subtypeDesc)
      else if (fieldSortBy === 'default') cmp = (a.defaultValue || '').localeCompare(b.defaultValue || '')
      else if (fieldSortBy === 'nullable') cmp = (a.nullable === false ? 0 : 1) - (b.nullable === false ? 0 : 1)
      return fieldSortDir === 'asc' ? cmp : -cmp
    })

    const toggleSort = (col: typeof fieldSortBy) => {
      if (fieldSortBy === col) setFieldSortDir(d => d === 'asc' ? 'desc' : 'asc')
      else {
        setFieldSortBy(col)
        setFieldSortDir('asc')
      }
    }

    const renderSortIcon = (col: typeof fieldSortBy) => {
      if (fieldSortBy !== col) return <i className="fa-solid fa-sort gis-content-muted" style={{ marginLeft: 6, fontSize: 10 }} />
      return <i className={`fa-solid fa-sort-${fieldSortDir === 'asc' ? 'up' : 'down'}`} style={{ marginLeft: 6, fontSize: 10 }} />
    }

    return (
      <div className="gis-content-panel">
        <div className="gis-content-panelbar">
          <div className="gis-content-paneltitle">Field Management</div>
          <div className="gis-content-panelactions">
            <input 
              className="gis-input gis-content-search" 
              value={fieldQuery} 
              onChange={(e) => setFieldQuery(e.target.value)} 
              placeholder="Filter fields..." 
            />
            <button className="gis-btn gis-btn-primary" type="button" onClick={() => openAddField(layerId)}>
              <i className="fa-solid fa-plus" aria-hidden="true" />
              <span>Add field</span>
            </button>
          </div>
        </div>

        <div className="gis-content-tablewrap">
          <table className="gis-content-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort('name')} style={{ cursor: 'pointer' }}>Name {renderSortIcon('name')}</th>
                <th onClick={() => toggleSort('type')} style={{ cursor: 'pointer' }}>Type {renderSortIcon('type')}</th>
                <th onClick={() => toggleSort('length')} style={{ cursor: 'pointer' }}>Length {renderSortIcon('length')}</th>
                <th onClick={() => toggleSort('domain')} style={{ cursor: 'pointer' }}>Domain {renderSortIcon('domain')}</th>
                <th onClick={() => toggleSort('subtype')} style={{ cursor: 'pointer' }}>Subtype Description {renderSortIcon('subtype')}</th>
                <th onClick={() => toggleSort('default')} style={{ cursor: 'pointer' }}>Default {renderSortIcon('default')}</th>
                <th onClick={() => toggleSort('nullable')} style={{ cursor: 'pointer' }}>Nullable {renderSortIcon('nullable')}</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((f) => (
                <tr
                  key={f.id}
                  draggable={!fieldQuery && fieldSortBy === 'name'}
                  onDragStart={() => setDragFieldId(f.id)}
                  onDragOver={(e) => {
                    e.preventDefault()
                  }}
                  onDrop={() => {
                    if (!dragFieldId) return
                    applyFieldReorder(layerId, dragFieldId, f.id)
                    setDragFieldId(null)
                  }}
                  className={!fieldQuery && fieldSortBy === 'name' ? "gis-content-draggable" : ""}
                >
                  <td title={f.name}>
                    {!fieldQuery && fieldSortBy === 'name' ? (
                      <span className="gis-content-draghandle" aria-hidden="true">
                        <i className="fa-solid fa-grip-vertical" />
                      </span>
                    ) : null}
                    {f.name}
                  </td>
                  <td>{f.type}</td>
                  <td>{typeof f.length === 'number' ? f.length : '—'}</td>
                  <td title={f.domainName !== '—' ? f.domainName : undefined}>{f.domainName}</td>
                  <td title={f.subtypeDesc !== '—' ? f.subtypeDesc : undefined}>{f.subtypeDesc}</td>
                  <td title={f.defaultValue || ''}>{f.defaultValue || '—'}</td>
                  <td>{f.nullable === false ? 'No' : 'Yes'}</td>
                  <td className="gis-content-actions">
                    <button className="gis-btn" type="button" onClick={() => openEditField(layerId, f.id)}>
                      Edit
                    </button>
                    <button className="gis-btn" type="button" onClick={() => setConfirm({ kind: 'deleteField', layerId, fieldId: f.id })}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!sorted.length ? (
                <tr>
                  <td colSpan={8} className="gis-content-muted">
                    No fields found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {!fieldQuery && fieldSortBy === 'name' ? (
          <div className="gis-content-muted" style={{ marginTop: 8 }}>Drag and drop fields to reorder.</div>
        ) : (
          <div className="gis-content-muted" style={{ marginTop: 8 }}>Clear filter and sort by Name to enable drag-and-drop reordering.</div>
        )}
      </div>
    )
  }

  const renderRelationships = () => {
    const layersById = new Map<string, LayerRow>(rows.map(r => [r.id, r]))
    return (
      <div className="gis-content-panel">
        <div className="gis-content-panelbar">
          <div className="gis-content-paneltitle">Relationships</div>
          <div className="gis-content-panelactions">
            <button className="gis-btn gis-btn-primary" type="button" onClick={openAddRelationship} disabled={!layers.length}>
              <i className="fa-solid fa-link" aria-hidden="true" />
              <span>Add relationship</span>
            </button>
          </div>
        </div>

        <div className="gis-content-split">
          <div className="gis-content-card">
            <div className="gis-content-cardtitle">Relationship list</div>
            <div className="gis-content-list">
              {relationships.map((r) => (
                <div key={r.id} className="gis-content-relrow">
                  <div className="gis-content-relmain">
                    <div className="gis-content-reltitle" title={r.name}>
                      {r.name}
                    </div>
                    <div className="gis-content-relmeta">
                      <span>{r.type}</span>
                      <span>•</span>
                      <span title={r.originLayerId}>{layersById.get(r.originLayerId)?.name ?? r.originLayerId}</span>
                      <span>→</span>
                      <span title={r.destinationLayerId}>{layersById.get(r.destinationLayerId)?.name ?? r.destinationLayerId}</span>
                    </div>
                  </div>
                  <div className="gis-content-actions">
                    <button className="gis-btn" type="button" onClick={() => openEditRelationship(r.id)}>
                      Edit
                    </button>
                    <button className="gis-btn" type="button" onClick={() => setConfirm({ kind: 'deleteRelationship', id: r.id })}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {!relationships.length ? <div className="gis-content-muted">No relationships.</div> : null}
            </div>
          </div>

          <div className="gis-content-card">
            <div className="gis-content-cardtitle">Relationship tree</div>
            <div className="gis-content-tree" aria-label="Relationship tree">
              {rows.map((lr) => {
                const rels = relationshipTree.byOrigin.get(lr.id) ?? []
                if (!rels.length) return null
                return (
                  <div key={lr.id} className="gis-content-treegroup">
                    <div className="gis-content-treenode root" title={lr.name}>
                      {lr.name}
                    </div>
                    <div className="gis-content-treechildren">
                      {rels.map((r) => {
                        const dest = layersById.get(r.destinationLayerId)
                        const mid =
                          r.type === 'many-to-many' && r.junctionLayerId
                            ? layersById.get(r.junctionLayerId)?.name ?? r.junctionLayerId
                            : null
                        return (
                          <div key={r.id} className="gis-content-treeedge">
                            <div className="gis-content-treelabel">
                              {r.type} ({r.originKey}→{r.destinationKey})
                            </div>
                            {mid ? (
                              <div className="gis-content-treenode" title={mid}>
                                {mid}
                              </div>
                            ) : null}
                            <div className="gis-content-treenode" title={dest?.name ?? r.destinationLayerId}>
                              {dest?.name ?? r.destinationLayerId}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {!relationships.length ? <div className="gis-content-muted">Add a relationship to show the tree.</div> : null}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderMain = () => {
    if (activeTab === 'fields') return renderFields()
    if (activeTab === 'relationships') return renderRelationships()
    return renderRecords()
  }

  return (
    <div className="gis-map-page gis-content-page" dir="ltr" lang="en">
      {!layersLoaded ? (
        <div className="gis-empty" style={{ margin: 16 }}>
          <div className="gis-empty-title">Loading GIS Content…</div>
          <div className="gis-empty-sub">Initializing local storage.</div>
        </div>
      ) : null}

      {layersLoadError ? (
        <div className="gis-empty" style={{ margin: 16 }}>
          <div className="gis-empty-title">GIS Content failed to load</div>
          <div className="gis-empty-sub">{layersLoadError}</div>
          <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="gis-btn" type="button" onClick={() => window.location.reload()}>
              Retry
            </button>
            <button className="gis-btn gis-btn-danger" type="button" onClick={resetGisContentStorage}>
              Reset storage
            </button>
          </div>
        </div>
      ) : null}

      <aside className="gis-sidebar" aria-label="GIS Layers Sidebar">
        <div className="gis-sidebar-header">
          <div className="gis-sidebar-title">
            <i className="fa-solid fa-map" aria-hidden="true" />
            <span>GIS Layers</span>
          </div>
          <div className="gis-sidebar-actions">
            <button className="gis-addlayer-btn" type="button" onClick={openAddLayer}>
              <i className="fa-solid fa-plus" aria-hidden="true" />
              <span>Add layer</span>
            </button>
          </div>
        </div>

        <div className="gis-sidebar-body">
          <div className="gis-content-sidebarfilters">
            <input className="gis-input" value={layerQuery} onChange={(e) => setLayerQuery(e.target.value)} placeholder="Search for a layer..." />
            <div className="gis-content-filterrow">
              <div className="gis-content-selectwrap">
                <select className="gis-content-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} aria-label="Sort by">
                  <option value="priority">Priority</option>
                  <option value="name">Name</option>
                  <option value="date">Created date</option>
                </select>
                <i className="fa-solid fa-chevron-down" aria-hidden="true" />
              </div>
              <button className="gis-btn" type="button" onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))} aria-label="Reverse sort direction">
                {sortDir === 'asc' ? 'Ascending' : 'Descending'}
              </button>
            </div>
            {syncError ? (
              <div className="gis-content-muted" style={{ color: '#b91c1c', fontWeight: 800 }}>
                {syncError}
              </div>
            ) : null}
          </div>

          <div className="gis-layer-list">
            {rows.map((r) => {
              const layer = layers.find(l => String(l.id) === r.id)
              const canSync = r.source === 'arcgis' && Boolean(layer?.url)
              const isSyncing = syncingLayerId === r.id

              return (
                <div
                  key={r.id}
                  className={selectedLayerId === r.id ? 'gis-layer-card active' : 'gis-layer-card'}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedLayerId(r.id)
                    if (activeTab === 'relationships') return
                    setActiveTab('data')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelectedLayerId(r.id)
                    }
                  }}
                >
                <div className="gis-layer-top">
                  <div className="gis-layer-title">
                    <div className="gis-layer-name" title={r.name}>
                      {r.name}
                    </div>
                    <div className="gis-content-submeta">
                      <span>{r.geometryType}</span>
                      <span>•</span>
                      <span>{r.recordCount} records</span>
                    </div>
                  </div>
                  <div className="gis-layer-menu">
                    <button
                      className="gis-layer-menu-btn"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleLayerVisible(r.id)
                      }}
                      aria-label={r.visible ? 'Hide layer' : 'Show layer'}
                      title={r.visible ? 'Hide' : 'Show'}
                    >
                      <i className={`fa-solid ${r.visible ? 'fa-eye' : 'fa-eye-slash'}`} aria-hidden="true" />
                    </button>
                    <button
                      className="gis-layer-menu-btn"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        openEditLayer(r.id)
                      }}
                      aria-label="Edit layer"
                      title="Edit"
                    >
                      <i className="fa-solid fa-pen" aria-hidden="true" />
                    </button>
                    <button
                      className="gis-layer-menu-btn"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void syncArcGisLayer(r.id)
                      }}
                      disabled={!canSync || Boolean(syncingLayerId)}
                      aria-label={`Sync ${r.name} from ArcGIS`}
                      title="Sync from ArcGIS"
                    >
                      <i
                        className={isSyncing ? 'fa-solid fa-arrows-rotate fa-spin' : 'fa-solid fa-arrows-rotate'}
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      className="gis-layer-menu-btn"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirm({ kind: 'deleteLayer', layerId: r.id })
                      }}
                      aria-label="Delete layer"
                      title="Delete"
                    >
                      <i className="fa-solid fa-trash" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div className="gis-content-layerfooter">
                  <div className="gis-content-muted" title={r.createdAt}>
                    {new Date(r.createdAt).toLocaleDateString('en-US')}
                  </div>
                  <div className="gis-content-order">
                    <button
                      className="gis-btn"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        applyMoveLayer(r.id, 'up')
                      }}
                      aria-label="Increase layer priority"
                    >
                      ↑
                    </button>
                    <button
                      className="gis-btn"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        applyMoveLayer(r.id, 'down')
                      }}
                      aria-label="Decrease layer priority"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              </div>
              )
            })}
            {!rows.length ? (
              <div className="gis-empty">
                <div className="gis-empty-title">No layers</div>
                <div className="gis-empty-sub">Add a GeoJSON layer or connect an ArcGIS service.</div>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      <section className="gis-map-canvas gis-content-canvas" aria-label="GIS Content">
        {renderMainHeader()}
        <div className="gis-content-body">{renderMain()}</div>
      </section>

      {layerModal ? (
        <div className="gis-modal-overlay" role="presentation" onClick={closeEditLayerModal}>
          <div className="gis-modal gis-modal-compact" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="gis-modal-header">
              <div className="gis-modal-header-left">
                <div className="gis-modal-icon" aria-hidden="true">
                  <i className="fa-solid fa-layer-group" aria-hidden="true" />
                </div>
                <div className="gis-modal-title">Edit layer</div>
              </div>
              <button className="gis-sidebar-close" type="button" onClick={closeEditLayerModal} aria-label="Close">
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
            <div className="gis-modal-body">
              <div className="gis-content-formgrid">
                <label className="gis-label">
                  Layer name
                  <input
                    className={editError && !editName.trim() ? 'gis-input invalid' : 'gis-input'}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    aria-label="Layer name"
                  />
                </label>
                {editError ? <div className="gis-inline-error">{editError}</div> : null}
              </div>
            </div>
            <div className="gis-modal-actions">
              <button className="gis-btn" type="button" onClick={closeEditLayerModal}>
                Cancel
              </button>
              <button className="gis-btn gis-btn-primary" type="button" onClick={saveEditLayer}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAddOpen ? (
        <div className="gis-modal-overlay" role="presentation" onClick={closeAddLayer}>
          <div
            className="gis-modal gis-modal-compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gis-add-layer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gis-modal-compact-title" id="gis-add-layer-title">
              Add GIS Layer
            </div>

            <div className="gis-modal-compact-tabs" role="tablist" aria-label="Add GIS layer source">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'arcgis'}
                className={tab === 'arcgis' ? 'gis-compact-tab active' : 'gis-compact-tab'}
                onClick={() => setTab('arcgis')}
              >
                <i className="fa-solid fa-cloud" aria-hidden="true" />
                ArcGIS Feature Service
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'upload'}
                className={tab === 'upload' ? 'gis-compact-tab active' : 'gis-compact-tab'}
                onClick={() => setTab('upload')}
              >
                <i className="fa-solid fa-upload" aria-hidden="true" />
                Upload File
              </button>
            </div>

            <div className="gis-modal-body">
              {tab === 'arcgis' ? (
                <div role="tabpanel" aria-label="ArcGIS Feature Service">
                  <input
                    className="gis-input"
                    type="text"
                    value={serviceUrl}
                    onChange={(e) => setServiceUrl(e.target.value)}
                    placeholder="Feature Service URL"
                    autoComplete="off"
                    inputMode="url"
                    aria-label="Feature Service URL"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        discoverFromService()
                      }
                    }}
                  />

                  <input
                    className="gis-input"
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Token / API Key (optional)"
                    autoComplete="off"
                    aria-label="Token / API Key (optional)"
                  />

                  <button className="gis-btn-outline" type="button" onClick={discoverFromService} disabled={isDiscovering || serviceUrl.trim() === ''}>
                    <i className="fa-solid fa-link" aria-hidden="true" />
                    {isDiscovering ? 'Connecting…' : 'Connect & Discover Layers'}
                  </button>

                  {discoverError ? (
                    <div className="gis-inline-error" role="alert">
                      <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                      <span>{discoverError}</span>
                    </div>
                  ) : null}

                  {discoveredLayers.length > 0 ? (
                    <div className="gis-discover-panel" aria-label="Discovered layers panel">
                      <div className="gis-discover-meta">FOUND {discoveredLayers.length} LAYER/TABLE(S):</div>

                      <div className="gis-form-field">
                        <div className="gis-form-label">Select Layer</div>
                        <div className="gis-select-wrap">
                          <select
                            className="gis-input gis-select"
                            value={selectedDiscoveredUrl}
                            onChange={(e) => {
                              const next = e.target.value
                              setSelectedDiscoveredUrl(next)
                              const found = discoveredLayers.find(d => d.url === next)
                              if (found) setLayerName(found.name)
                            }}
                            aria-label="Select discovered layer"
                          >
                            {discoveredLayers.map((l) => (
                              <option key={l.url} value={l.url}>
                                {l.kind === 'table' ? `${l.name} (Table)` : l.geometryType ? `${l.name} (${l.geometryType})` : l.name}
                              </option>
                            ))}
                          </select>
                          <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                        </div>
                      </div>

                      <div className="gis-form-field">
                        <div className="gis-form-label">Layer Name</div>
                        <input
                          className="gis-input"
                          type="text"
                          value={layerName}
                          onChange={(e) => setLayerName(e.target.value)}
                          placeholder="Layer Name"
                          autoComplete="off"
                          aria-label="Layer Name"
                        />
                      </div>

                      <button
                        className="gis-btn-primary-full"
                        type="button"
                        onClick={() => {
                          const found = discoveredLayers.find(d => d.url === selectedDiscoveredUrl)
                          if (found) addArcGisLayerAsGeoJson(found)
                        }}
                        disabled={!selectedDiscoveredUrl || addingLayerKey === `arcgis:${selectedDiscoveredUrl}`}
                      >
                        {addingLayerKey === `arcgis:${selectedDiscoveredUrl}` ? 'Adding…' : 'Add Layer'}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div role="tabpanel" aria-label="Upload file">
                  <div
                    className={isDragOver ? 'gis-dropzone drag-over' : 'gis-dropzone'}
                    role="button"
                    tabIndex={0}
                    aria-label="Drop a file here or click to browse"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        fileInputRef.current?.click()
                      }
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const types = Array.from(e.dataTransfer?.types ?? [])
                      if (!types.includes('Files')) return
                      dragDepthRef.current += 1
                      setIsDragOver(true)
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const types = Array.from(e.dataTransfer?.types ?? [])
                      if (!types.includes('Files')) return
                      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
                      if (dragDepthRef.current === 0) setIsDragOver(false)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      dragDepthRef.current = 0
                      setIsDragOver(false)
                      const file = e.dataTransfer?.files?.[0] ?? null
                      setUploadFromFile(file)
                    }}
                  >
                    <div className="gis-dropzone-icon" aria-hidden="true">
                      <i className="fa-solid fa-upload" />
                    </div>
                    <div className="gis-dropzone-text">Drop a file here or click to browse</div>
                    <div className="gis-dropzone-subtext">Supports: GeoJSON, KML, KMZ, Shapefile (.zip)</div>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    style={{ display: 'none' }}
                    onChange={(e) => setUploadFromFile(e.target.files?.[0] ?? null)}
                  />

                  <input
                    className="gis-input"
                    type="text"
                    value={layerName}
                    onChange={(e) => setLayerName(e.target.value)}
                    placeholder="Layer Name (optional)"
                    autoComplete="off"
                    aria-label="Layer Name (optional)"
                  />

                  <button
                    className="gis-btn-primary-full"
                    type="button"
                    onClick={addUploadLayerAsGeoJson}
                    disabled={!uploadFile || addingLayerKey === `upload:${uploadFile.name}`}
                  >
                    <i className="fa-solid fa-upload" aria-hidden="true" />
                    {addingLayerKey === `upload:${uploadFile?.name ?? ''}` ? 'Uploading…' : 'Upload & Import'}
                  </button>
                </div>
              )}
            </div>

            <div className="gis-modal-footer">
              <button className="gis-link-btn" type="button" onClick={closeAddLayer}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {fieldModal ? (
        <div className="gis-modal-overlay" role="presentation" onClick={closeFieldModal}>
          <div className="gis-modal gis-modal-compact" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="gis-modal-header">
              <div className="gis-modal-header-left">
                <div className="gis-modal-icon" aria-hidden="true">
                  <i className="fa-solid fa-list" aria-hidden="true" />
                </div>
                <div className="gis-modal-title">{fieldModal.mode === 'add' ? 'Add field' : 'Edit field'}</div>
              </div>
              <button className="gis-sidebar-close" type="button" onClick={closeFieldModal} aria-label="Close">
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
            <div className="gis-modal-body">
              <div className="gis-content-formgrid">
                <label className="gis-label">
                  Field name
                  <input
                    className={fieldError ? 'gis-input invalid' : 'gis-input'}
                    value={fieldDraft.name}
                    onChange={(e) => setFieldDraft(p => ({ ...p, name: e.target.value }))}
                  />
                </label>

                <label className="gis-label">
                  Data type
                  <div className="gis-content-selectwrap">
                    <select
                      className="gis-content-select"
                      value={fieldDraft.type}
                      onChange={(e) => setFieldDraft(p => ({ ...p, type: e.target.value as FieldType }))}
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="date">Date</option>
                      <option value="boolean">Boolean</option>
                    </select>
                    <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                  </div>
                </label>

                <label className="gis-label">
                  Length (text)
                  <input
                    className="gis-input"
                    value={fieldDraft.length}
                    onChange={(e) => setFieldDraft(p => ({ ...p, length: e.target.value }))}
                    disabled={fieldDraft.type !== 'text'}
                    placeholder="Example: 50"
                  />
                </label>

                <label className="gis-label">
                  Default value
                  <input className="gis-input" value={fieldDraft.defaultValue} onChange={(e) => setFieldDraft(p => ({ ...p, defaultValue: e.target.value }))} />
                </label>

                <label className="gis-label">Nullable</label>
                <button
                  type="button"
                  className={fieldDraft.nullable ? 'gis-content-chip active' : 'gis-content-chip'}
                  aria-pressed={fieldDraft.nullable}
                  onClick={() => setFieldDraft(p => ({ ...p, nullable: !p.nullable }))}
                >
                  {fieldDraft.nullable ? 'Yes' : 'No'}
                </button>

                {fieldError ? <div className="gis-inline-error">{fieldError}</div> : null}
              </div>
            </div>
            <div className="gis-modal-actions">
              <button className="gis-btn" type="button" onClick={closeFieldModal}>
                Cancel
              </button>
              <button className="gis-btn gis-btn-primary" type="button" onClick={applyFieldSave}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {relModal ? (
        <div className="gis-modal-overlay" role="presentation" onClick={closeRelModal}>
          <div className="gis-modal gis-modal-compact" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="gis-modal-header">
              <div className="gis-modal-header-left">
                <div className="gis-modal-icon" aria-hidden="true">
                  <i className="fa-solid fa-link" aria-hidden="true" />
                </div>
                <div className="gis-modal-title">{relModal.mode === 'add' ? 'Add relationship' : 'Edit relationship'}</div>
              </div>
              <button className="gis-sidebar-close" type="button" onClick={closeRelModal} aria-label="Close">
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
            <div className="gis-modal-body">
              <div className="gis-content-formgrid">
                <label className="gis-label">
                  Relationship name
                  <input
                    className={relError && !relDraft.name.trim() ? 'gis-input invalid' : 'gis-input'}
                    value={relDraft.name}
                    onChange={(e) => setRelDraft(p => ({ ...p, name: e.target.value }))}
                  />
                </label>

                <label className="gis-label">
                  Relationship type
                  <div className="gis-content-selectwrap">
                    <select
                      className="gis-content-select"
                      value={relDraft.type}
                      onChange={(e) => setRelDraft(p => ({ ...p, type: e.target.value as RelationshipType }))}
                    >
                      <option value="one-to-one">One-to-One</option>
                      <option value="one-to-many">One-to-Many</option>
                      <option value="many-to-many">Many-to-Many</option>
                    </select>
                    <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                  </div>
                </label>

                <label className="gis-label">
                  Origin Layer
                  <div className="gis-content-selectwrap">
                    <select
                      className="gis-content-select"
                      value={relDraft.originLayerId}
                      onChange={(e) => setRelDraft(p => ({ ...p, originLayerId: e.target.value, originKey: '' }))}
                    >
                      <option value="">—</option>
                      {rows.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                  </div>
                </label>

                <label className="gis-label">
                  Destination Layer
                  <div className="gis-content-selectwrap">
                    <select
                      className="gis-content-select"
                      value={relDraft.destinationLayerId}
                      onChange={(e) => setRelDraft(p => ({ ...p, destinationLayerId: e.target.value, destinationKey: '' }))}
                    >
                      <option value="">—</option>
                      {rows.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                  </div>
                </label>

                <label className="gis-label">
                  Origin Key Field
                  <div className="gis-content-selectwrap">
                    <select
                      className="gis-content-select"
                      value={relDraft.originKey}
                      onChange={(e) => setRelDraft(p => ({ ...p, originKey: e.target.value }))}
                      disabled={!relDraft.originLayerId}
                    >
                      <option value="">—</option>
                      {relationshipKeyFieldsForLayer(relDraft.originLayerId).map(k => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                    <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                  </div>
                </label>

                <label className="gis-label">
                  Destination Key Field
                  <div className="gis-content-selectwrap">
                    <select
                      className="gis-content-select"
                      value={relDraft.destinationKey}
                      onChange={(e) => setRelDraft(p => ({ ...p, destinationKey: e.target.value }))}
                      disabled={!relDraft.destinationLayerId}
                    >
                      <option value="">—</option>
                      {relationshipKeyFieldsForLayer(relDraft.destinationLayerId).map(k => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                    <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                  </div>
                </label>

                {relDraft.type === 'many-to-many' ? (
                  <>
                    <label className="gis-label">
                      Junction Layer
                      <div className="gis-content-selectwrap">
                        <select
                          className="gis-content-select"
                          value={relDraft.junctionLayerId || ''}
                          onChange={(e) =>
                            setRelDraft(p => ({ ...p, junctionLayerId: e.target.value, originJunctionKey: '', destinationJunctionKey: '' }))
                          }
                        >
                          <option value="">—</option>
                          {rows.map(r => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                        <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                      </div>
                    </label>

                    <label className="gis-label">
                      Origin Junction Key
                      <div className="gis-content-selectwrap">
                        <select
                          className="gis-content-select"
                          value={relDraft.originJunctionKey || ''}
                          onChange={(e) => setRelDraft(p => ({ ...p, originJunctionKey: e.target.value }))}
                          disabled={!relDraft.junctionLayerId}
                        >
                          <option value="">—</option>
                          {relationshipKeyFieldsForLayer(relDraft.junctionLayerId || '').map(k => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                        <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                      </div>
                    </label>

                    <label className="gis-label">
                      Destination Junction Key
                      <div className="gis-content-selectwrap">
                        <select
                          className="gis-content-select"
                          value={relDraft.destinationJunctionKey || ''}
                          onChange={(e) => setRelDraft(p => ({ ...p, destinationJunctionKey: e.target.value }))}
                          disabled={!relDraft.junctionLayerId}
                        >
                          <option value="">—</option>
                          {relationshipKeyFieldsForLayer(relDraft.junctionLayerId || '').map(k => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                        <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                      </div>
                    </label>
                  </>
                ) : null}

                <label className="gis-label">Constraints</label>
                <div className="gis-content-row">
                  <button
                    type="button"
                    className={relDraft.enforce ? 'gis-content-chip active' : 'gis-content-chip'}
                    aria-pressed={!!relDraft.enforce}
                    onClick={() => setRelDraft(p => ({ ...p, enforce: !p.enforce }))}
                  >
                    Enforce
                  </button>
                  <button
                    type="button"
                    className={relDraft.cascadeDelete ? 'gis-content-chip active' : 'gis-content-chip'}
                    aria-pressed={!!relDraft.cascadeDelete}
                    onClick={() => setRelDraft(p => ({ ...p, cascadeDelete: !p.cascadeDelete }))}
                  >
                    Cascade Delete
                  </button>
                </div>

                {relError ? <div className="gis-inline-error">{relError}</div> : null}
              </div>
            </div>
            <div className="gis-modal-actions">
              <button className="gis-btn" type="button" onClick={closeRelModal}>
                Cancel
              </button>
              <button className="gis-btn gis-btn-primary" type="button" onClick={saveRelationship}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirm ? (
        <div
          className="gis-modal-overlay"
          role="presentation"
          onClick={() => {
            setConfirm(null)
          }}
        >
          <div className="gis-modal gis-modal-compact" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="gis-modal-header">
              <div className="gis-modal-header-left">
                <div className="gis-modal-icon" aria-hidden="true">
                  <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                </div>
                <div className="gis-modal-title">Confirm</div>
              </div>
              <button className="gis-sidebar-close" type="button" onClick={() => setConfirm(null)} aria-label="Close">
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
            <div className="gis-modal-body">
              <div className="gis-content-confirmtext">
                {confirm.kind === 'deleteLayer'
                  ? 'Delete this layer? Related relationships will also be removed.'
                  : confirm.kind === 'deleteField'
                    ? 'Delete this field? It will be removed from all records.'
                    : 'Delete this relationship?'}
              </div>
            </div>
            <div className="gis-modal-actions">
              <button className="gis-btn" type="button" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="gis-btn gis-btn-primary"
                type="button"
                onClick={() => {
                  if (confirm.kind === 'deleteLayer') applyDeleteLayer(confirm.layerId)
                  if (confirm.kind === 'deleteField') applyDeleteField(confirm.layerId, confirm.fieldId)
                  if (confirm.kind === 'deleteRelationship') setRelationships(prev => prev.filter(r => r.id !== confirm.id))
                  setConfirm(null)
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {helpOpen ? (
        <div className="gis-modal-overlay" role="presentation" onClick={() => setHelpOpen(false)}>
          <div className="gis-modal gis-modal-compact" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="gis-modal-header">
              <div className="gis-modal-header-left">
                <div className="gis-modal-icon" aria-hidden="true">
                  <i className="fa-solid fa-circle-info" aria-hidden="true" />
                </div>
                <div className="gis-modal-title">Features and UI documentation</div>
              </div>
              <button className="gis-sidebar-close" type="button" onClick={() => setHelpOpen(false)} aria-label="Close">
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
            <div className="gis-modal-body">
              <div className="gis-content-confirmtext">
                <div className="gis-content-muted">Goal</div>
                <div>This page manages GIS layers in a tabular format (no map), including fields and relationships.</div>
              </div>

              <div className="gis-content-confirmtext">
                <div className="gis-content-muted">Layers (CRUD)</div>
                <div>Add (upload GeoJSON or connect ArcGIS), rename, delete with confirmation, show/hide, reorder priority (↑/↓), or sort by name/date.</div>
              </div>

              <div className="gis-content-confirmtext">
                <div className="gis-content-muted">Fields (CRUD)</div>
                <div>Add/edit/delete with name validation, and reorder via drag-and-drop. Field add/delete/rename is applied to each GeoJSON feature’s properties.</div>
              </div>

              <div className="gis-content-confirmtext">
                <div className="gis-content-muted">Relationships</div>
                <div>One-to-One / One-to-Many / Many-to-Many with origin/destination, key fields, and constraints. The relationships tab shows a visual tree.</div>
              </div>

              <div className="gis-content-confirmtext">
                <div className="gis-content-muted">ArcGIS APIs used (client-side)</div>
                <div>
                  Discover: <span dir="ltr">GET {`{serviceUrl}`}?f=json&amp;token=...</span>
                </div>
                <div>
                  Layer Definition: <span dir="ltr">GET {`{layerUrl}`}?f=json&amp;token=...</span>
                </div>
                <div>
                  Query GeoJSON: <span dir="ltr">GET {`{layerUrl}`}/query?where=1%3D1&amp;outFields=*&amp;returnGeometry=true&amp;outSR=4326&amp;f=geojson&amp;token=...</span>
                </div>
              </div>

              <div className="gis-content-confirmtext">
                <div className="gis-content-muted">Storage</div>
                <div dir="ltr">
                  IndexedDB: {DB_NAME} / {STORE_NAME} / key=savedLayers
                </div>
                <div dir="ltr">
                  localStorage: {LS_META_KEY}, {LS_ORDER_KEY}, {LS_FIELDS_KEY}, {LS_RELATIONSHIPS_KEY}, {LS_HIDDEN_FIELDS_KEY}
                </div>
              </div>
            </div>
            <div className="gis-modal-actions">
              <button className="gis-btn" type="button" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
