import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { connectRealtime } from '../../lib/realtime'

type Repo = {
  id: number
  full_name: string
  private: boolean
  html_url: string
}

type Issue = {
  id: number
  number: number
  title: string
  html_url: string
  state: string
  pull_request?: unknown
}

type Pull = {
  id: number
  number: number
  title: string
  html_url: string
  state: string
}

type GhEvent = {
  id: string
  at: string
  event: string
  action?: string
  repo?: string
  sender?: string
}

const getWsUrl = () => {
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'
  const proto = isHttps ? 'wss' : 'ws'
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost:5173'
  return `${proto}://${host}/ws`
}

export default function GitHubIntegration() {
  const navigate = useNavigate()
  const location = useLocation()
  const [connected, setConnected] = useState(false)
  const [scope, setScope] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [repos, setRepos] = useState<Repo[]>([])
  const [selectedRepoFullName, setSelectedRepoFullName] = useState<string>('')
  const [issues, setIssues] = useState<Issue[]>([])
  const [pulls, setPulls] = useState<Pull[]>([])
  const [events, setEvents] = useState<GhEvent[]>([])

  const [newIssueTitle, setNewIssueTitle] = useState('')
  const [newIssueBody, setNewIssueBody] = useState('')

  const selectedRepo = useMemo(() => repos.find(r => r.full_name === selectedRepoFullName) || null, [repos, selectedRepoFullName])

  const loadStatus = async () => {
    const res = await fetch('/api/github/status')
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error((data && data.error) || 'Failed to load GitHub status.')
    setConnected(Boolean(data?.connected))
    setScope(String(data?.scope || ''))
  }

  const loadRepos = async () => {
    const res = await fetch('/api/github/repos')
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error((data && data.error) || 'Failed to load repos.')
    const items = Array.isArray(data?.items) ? (data.items as Repo[]) : []
    setRepos(items)
    const first = items[0]?.full_name
    setSelectedRepoFullName(prev => (prev ? prev : first ? String(first) : ''))
    setScope(String(data?.scope || scope))
  }

  const loadRepoDetails = async (fullName: string) => {
    const [owner, repo] = String(fullName).split('/')
    if (!owner || !repo) return

    const issuesRes = await fetch(`/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`)
    const issuesData = await issuesRes.json().catch(() => null)
    if (!issuesRes.ok) throw new Error((issuesData && issuesData.error) || 'Failed to load issues.')
    const listIssues = Array.isArray(issuesData?.items) ? (issuesData.items as Issue[]) : []
    setIssues(listIssues.filter(i => !i.pull_request))

    const pullsRes = await fetch(`/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`)
    const pullsData = await pullsRes.json().catch(() => null)
    if (!pullsRes.ok) throw new Error((pullsData && pullsData.error) || 'Failed to load pull requests.')
    setPulls(Array.isArray(pullsData?.items) ? (pullsData.items as Pull[]) : [])
  }

  const loadEvents = async () => {
    const res = await fetch('/api/github/events')
    const data = await res.json().catch(() => null)
    if (!res.ok) return
    setEvents(Array.isArray(data?.items) ? (data.items as GhEvent[]) : [])
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const err = params.get('error')
    if (err) setError(err)
    void (async () => {
      try {
        await loadStatus()
        setError(null)
      } catch (e: any) {
        setError(typeof e?.message === 'string' ? e.message : 'Failed to load status.')
      }
    })()
  }, [location.search])

  useEffect(() => {
    if (!connected) return
    setBusy(true)
    void (async () => {
      try {
        await Promise.all([loadRepos(), loadEvents()])
        setError(null)
      } catch (e: any) {
        setError(typeof e?.message === 'string' ? e.message : 'Failed to load GitHub data.')
      } finally {
        setBusy(false)
      }
    })()
  }, [connected])

  useEffect(() => {
    if (!connected) return
    if (!selectedRepoFullName) return
    setBusy(true)
    void (async () => {
      try {
        await loadRepoDetails(selectedRepoFullName)
        setError(null)
      } catch (e: any) {
        setError(typeof e?.message === 'string' ? e.message : 'Failed to load repo details.')
      } finally {
        setBusy(false)
      }
    })()
  }, [connected, selectedRepoFullName])

  useEffect(() => {
    const disconnect = connectRealtime(getWsUrl(), (u) => {
      if (u?.topic !== 'github') return
      const ev = u.payload as any
      if (!ev || typeof ev !== 'object') return
      setEvents(prev => [{ ...ev }, ...prev].slice(0, 50))
      if (ev.repo && typeof ev.repo === 'string' && selectedRepoFullName && ev.repo === selectedRepoFullName) {
        void loadRepoDetails(selectedRepoFullName).catch(() => {})
      }
    })
    return disconnect
  }, [selectedRepoFullName])

  const onConnect = () => {
    window.location.href = '/api/github/oauth/start'
  }

  const onDisconnect = async () => {
    setBusy(true)
    try {
      await fetch('/api/github/disconnect', { method: 'POST' })
      setConnected(false)
      setScope('')
      setRepos([])
      setSelectedRepoFullName('')
      setIssues([])
      setPulls([])
      setEvents([])
    } finally {
      setBusy(false)
    }
  }

  const onCreateIssue = async () => {
    if (!selectedRepoFullName) return
    const title = newIssueTitle.trim()
    if (!title) {
      setError('Issue title is required.')
      return
    }
    const [owner, repo] = String(selectedRepoFullName).split('/')
    setBusy(true)
    try {
      const res = await fetch(`/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body: newIssueBody }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error((data && data.error) || 'Failed to create issue.')
      setNewIssueTitle('')
      setNewIssueBody('')
      await loadRepoDetails(selectedRepoFullName)
      setError(null)
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Failed to create issue.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>GitHub Integration</div>
          <div style={{ color: 'var(--ds-color-text-muted)', fontSize: 13 }}>
            OAuth connection, repos, issues, pull requests, and real-time sync via webhooks.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="ds-btn ds-btn-ghost" onClick={() => navigate('/', { state: { openGroup: 'admin' } })}>
            Back
          </button>
          {connected ? (
            <button type="button" className="ds-btn ds-btn-danger" onClick={() => void onDisconnect()} disabled={busy}>
              Disconnect
            </button>
          ) : (
            <button type="button" className="ds-btn ds-btn-primary" onClick={onConnect} disabled={busy}>
              Connect GitHub
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="ds-card ds-card-pad" role="status" aria-live="polite" style={{ borderColor: 'rgba(220, 38, 38, 0.35)' }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Error</div>
          <div style={{ color: 'rgba(127, 29, 29, 1)' }}>{error}</div>
        </div>
      ) : null}

      <div className="ds-card ds-card-pad" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="ds-badge">{connected ? 'Connected' : 'Not connected'}</span>
          {scope ? <span className="ds-badge">Scopes: {scope || '—'}</span> : null}
        </div>

        {connected ? (
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 800 }}>Repository</span>
            <select
              className="ds-input"
              value={selectedRepoFullName}
              onChange={e => setSelectedRepoFullName(e.target.value)}
              disabled={busy || repos.length === 0}
              aria-label="Select repository"
            >
              {repos.length === 0 ? <option value="">No repos</option> : null}
              {repos.map(r => (
                <option key={r.id} value={r.full_name}>
                  {r.full_name}{r.private ? ' (private)' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div style={{ color: 'var(--ds-color-text-muted)', fontSize: 13 }}>
            Configure these server environment variables then click Connect: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, APP_ORIGIN, GITHUB_OAUTH_REDIRECT_URL.
          </div>
        )}
      </div>

      {connected && selectedRepo ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
          <div className="ds-card ds-card-pad" style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 900 }}>Open Issues</div>
              <a className="ds-btn ds-btn-ghost" href={selectedRepo.html_url + '/issues'} target="_blank" rel="noreferrer">
                Open on GitHub
              </a>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {issues.length === 0 ? <div style={{ color: 'var(--ds-color-text-muted)', fontSize: 13 }}>No open issues.</div> : null}
              {issues.slice(0, 15).map(i => (
                <a key={i.id} href={i.html_url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ color: 'var(--ds-color-text)', fontWeight: 800, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      #{i.number} {i.title}
                    </div>
                    <span className="ds-badge">{i.state}</span>
                  </div>
                </a>
              ))}
            </div>
            <div className="ds-divider" />
            <div style={{ fontWeight: 900 }}>Create Issue</div>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800 }}>Title</span>
              <input className="ds-input" value={newIssueTitle} onChange={e => setNewIssueTitle(e.target.value)} disabled={busy} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800 }}>Body</span>
              <textarea className="ds-textarea" value={newIssueBody} onChange={e => setNewIssueBody(e.target.value)} disabled={busy} />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="ds-btn ds-btn-primary" onClick={() => void onCreateIssue()} disabled={busy}>
                Create
              </button>
            </div>
          </div>

          <div className="ds-card ds-card-pad" style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 900 }}>Open Pull Requests</div>
              <a className="ds-btn ds-btn-ghost" href={selectedRepo.html_url + '/pulls'} target="_blank" rel="noreferrer">
                Open on GitHub
              </a>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {pulls.length === 0 ? <div style={{ color: 'var(--ds-color-text-muted)', fontSize: 13 }}>No open pull requests.</div> : null}
              {pulls.slice(0, 15).map(p => (
                <a key={p.id} href={p.html_url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ color: 'var(--ds-color-text)', fontWeight: 800, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      #{p.number} {p.title}
                    </div>
                    <span className="ds-badge">{p.state}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>

          <div className="ds-card ds-card-pad" style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 900 }}>Real-time Events</div>
              <button type="button" className="ds-btn ds-btn-ghost" onClick={() => void loadEvents()} disabled={busy}>
                Refresh
              </button>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {events.length === 0 ? <div style={{ color: 'var(--ds-color-text-muted)', fontSize: 13 }}>No events received yet.</div> : null}
              {events.slice(0, 20).map(e => (
                <div key={e.id} style={{ border: '1px solid var(--ds-color-border)', borderRadius: 12, padding: 10, background: 'var(--ds-color-surface)' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontWeight: 900, fontSize: 13 }}>{e.event}{e.action ? ` • ${e.action}` : ''}</div>
                    <span className="ds-badge">{new Date(e.at).toLocaleString()}</span>
                  </div>
                  <div style={{ marginTop: 6, color: 'var(--ds-color-text-muted)', fontSize: 12 }}>
                    {(e.repo || '—') + (e.sender ? ` • ${e.sender}` : '')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

