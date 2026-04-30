import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DataSourceFieldsPanel, type DataSourceFormState } from './components/datasourcefieldspanel'
import { canManageDataSourceSettings } from '../../lib/auth'
import { FertigationReportModal } from './components/FertigationReportModal'
import './EC.css'

type FertigationEntry = {
  id: number
  site: string
  project: string
  block: string
  date: string
  time: string
  country?: string
  location?: string
  fertilizerType?: string
  concentration?: string
  status?: string
  flowRate: string
  durationHours: string
  cycles: string
  totalVolume: string
}

const STORAGE_KEY = 'fertigation_records_v1'

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
  }
}

export default function FertigationRecords() {
  const navigate = useNavigate()
  const canManageSettings = useMemo(() => canManageDataSourceSettings(), [])
  const [, setDataSourceState] = useState<DataSourceFormState>({ sourceIds: [], selectedFieldsBySource: {}, valuesBySource: {} })
  const [isOpeningSettings, setIsOpeningSettings] = useState(false)

  const [records, setRecords] = useState<FertigationEntry[]>(() => readJson<FertigationEntry[]>(STORAGE_KEY, []))
  const [isReportOpen, setIsReportOpen] = useState(false)

  const [draft, setDraft] = useState<Omit<FertigationEntry, 'id'>>({
    site: '',
    project: '',
    block: '',
    date: new Date().toISOString().slice(0, 10),
    time: new Date().toTimeString().slice(0, 5),
    country: '',
    location: '',
    fertilizerType: '',
    concentration: '',
    status: 'Planned',
    flowRate: '',
    durationHours: '',
    cycles: '1',
    totalVolume: '',
  })

  useEffect(() => {
    writeJson(STORAGE_KEY, records)
  }, [records])

  const sorted = useMemo(() => {
    const next = records.slice()
    next.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
    return next
  }, [records])

  const canSave = Boolean(draft.site.trim() && draft.project.trim() && draft.block.trim() && draft.date && draft.time)

  return (
    <div className="ec-page">
      <div className="ec-container ec-animate-in">
        <div className="ec-header">
          <div className="ec-title">
            <i className="fa-solid fa-flask"></i>
            <div>
              Fertigation Records
              <div className="ec-section-subtitle">Plan and track fertigation schedules</div>
            </div>
          </div>
        </div>

        <div className="ec-card">
          <div className="ec-card-header">
            <div>
              <div className="ec-card-title">
                <i className="fa-solid fa-circle-info" style={{ color: 'var(--ec-primary)' }}></i>
                Basic Information
              </div>
              <div className="ec-card-subtitle-small">Configured in Settings (Manager and Admin only)</div>
            </div>
            {canManageSettings ? (
              <div className="ec-card-header-actions">
                <button
                  type="button"
                  className="ec-icon-btn"
                  aria-label="Open data source settings"
                  title="Settings"
                  disabled={isOpeningSettings}
                  onClick={() => {
                    setIsOpeningSettings(true)
                    navigate('/master/workflow-settings?form=Fertigation')
                  }}
                >
                  <i className={isOpeningSettings ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-gear'}></i>
                </button>
              </div>
            ) : null}
          </div>
          <div className="ec-card-body">
            <DataSourceFieldsPanel formKey="Fertigation" mode="fill" variant="embedded" onChange={setDataSourceState} />
          </div>
        </div>

        <div className="ec-card">
          <div className="ec-card-header">
            <div className="ec-card-title">
              <i className="fa-solid fa-pen-to-square" style={{ color: '#0ea5e9' }}></i>
              New Record
            </div>
            <div className="ec-card-header-actions">
              <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={() => setIsReportOpen(true)}>
                <i className="fa-solid fa-chart-pie"></i> Report
              </button>
            </div>
          </div>
          <div className="ec-card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <label className="ec-input-group">
              <span className="ec-label">Date</span>
              <input className="ec-input" type="date" value={draft.date} onChange={e => setDraft(prev => ({ ...prev, date: e.target.value }))} />
            </label>
            <label className="ec-input-group">
              <span className="ec-label">Time</span>
              <input className="ec-input" type="time" value={draft.time} onChange={e => setDraft(prev => ({ ...prev, time: e.target.value }))} />
            </label>
            <label className="ec-input-group">
              <span className="ec-label">Country</span>
              <input className="ec-input" value={draft.country ?? ''} onChange={e => setDraft(prev => ({ ...prev, country: e.target.value }))} />
            </label>
            <label className="ec-input-group">
              <span className="ec-label">Site</span>
              <input className="ec-input" value={draft.site} onChange={e => setDraft(prev => ({ ...prev, site: e.target.value }))} />
            </label>
            <label className="ec-input-group">
              <span className="ec-label">Project</span>
              <input className="ec-input" value={draft.project} onChange={e => setDraft(prev => ({ ...prev, project: e.target.value }))} />
            </label>
            <label className="ec-input-group">
              <span className="ec-label">Location</span>
              <input className="ec-input" value={draft.location ?? ''} onChange={e => setDraft(prev => ({ ...prev, location: e.target.value }))} />
            </label>
            <label className="ec-input-group">
              <span className="ec-label">Block</span>
              <input className="ec-input" value={draft.block} onChange={e => setDraft(prev => ({ ...prev, block: e.target.value }))} />
            </label>
            <label className="ec-input-group">
              <span className="ec-label">Fertilizer Type</span>
              <input className="ec-input" value={draft.fertilizerType ?? ''} onChange={e => setDraft(prev => ({ ...prev, fertilizerType: e.target.value }))} />
            </label>
            <label className="ec-input-group">
              <span className="ec-label">Concentration (ppm)</span>
              <input className="ec-input" value={draft.concentration ?? ''} onChange={e => setDraft(prev => ({ ...prev, concentration: e.target.value }))} />
            </label>
            <label className="ec-input-group">
              <span className="ec-label">Status</span>
              <select className="ec-select" value={draft.status ?? 'Planned'} onChange={e => setDraft(prev => ({ ...prev, status: e.target.value }))}>
                <option value="Planned">Planned</option>
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
              </select>
            </label>
            <label className="ec-input-group">
              <span className="ec-label">Flow Rate (m³/h)</span>
              <input className="ec-input" value={draft.flowRate} onChange={e => setDraft(prev => ({ ...prev, flowRate: e.target.value }))} />
            </label>
            <label className="ec-input-group">
              <span className="ec-label">Duration (h)</span>
              <input className="ec-input" value={draft.durationHours} onChange={e => setDraft(prev => ({ ...prev, durationHours: e.target.value }))} />
            </label>
            <label className="ec-input-group">
              <span className="ec-label">Cycles</span>
              <input className="ec-input" value={draft.cycles} onChange={e => setDraft(prev => ({ ...prev, cycles: e.target.value }))} />
            </label>
            <label className="ec-input-group">
              <span className="ec-label">Total Volume (m³)</span>
              <input className="ec-input" value={draft.totalVolume} onChange={e => setDraft(prev => ({ ...prev, totalVolume: e.target.value }))} />
            </label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <button
                type="button"
                className="ec-btn ec-btn-primary"
                disabled={!canSave}
                onClick={() => {
                  const next: FertigationEntry = { id: Date.now(), ...draft }
                  setRecords(prev => [next, ...prev].slice(0, 2000))
                  setDraft(prev => ({ ...prev, project: '', block: '', flowRate: '', durationHours: '', totalVolume: '' }))
                }}
              >
                <i className="fa-solid fa-plus"></i> Add
              </button>
              <button
                type="button"
                className="ec-btn ec-btn-ghost"
                onClick={() => setDraft(prev => ({ ...prev, site: '', project: '', block: '', flowRate: '', durationHours: '', cycles: '1', totalVolume: '' }))}
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        <div className="ec-card">
          <div className="ec-card-header">
            <div className="ec-card-title">
              <i className="fa-solid fa-list" style={{ color: '#64748b' }}></i>
              Recent Records
            </div>
          </div>
          <div className="ec-card-body" style={{ overflowX: 'auto' }}>
            {sorted.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 13 }}>No records yet.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b' }}>
                    <th style={{ padding: '10px 8px' }}>Date</th>
                    <th style={{ padding: '10px 8px' }}>Site</th>
                    <th style={{ padding: '10px 8px' }}>Project</th>
                    <th style={{ padding: '10px 8px' }}>Block</th>
                    <th style={{ padding: '10px 8px' }}>Status</th>
                    <th style={{ padding: '10px 8px' }}>Volume</th>
                    <th style={{ padding: '10px 8px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 8px', color: '#0f172a' }}>
                        {r.date} {r.time}
                      </td>
                      <td style={{ padding: '10px 8px' }}>{r.site}</td>
                      <td style={{ padding: '10px 8px' }}>{r.project}</td>
                      <td style={{ padding: '10px 8px' }}>{r.block}</td>
                      <td style={{ padding: '10px 8px' }}>{r.status || '—'}</td>
                      <td style={{ padding: '10px 8px' }}>{r.totalVolume || '—'}</td>
                      <td style={{ padding: '10px 8px' }}>
                        <button
                          type="button"
                          className="ec-btn ec-btn-ghost ec-btn-sm"
                          onClick={() => setRecords(prev => prev.filter(x => x.id !== r.id))}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <FertigationReportModal isOpen={isReportOpen} onClose={() => setIsReportOpen(false)} records={records} />
    </div>
  )
}
