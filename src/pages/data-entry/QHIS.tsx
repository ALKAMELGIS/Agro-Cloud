import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DataSourceFieldsPanel, type DataSourceFormState } from './components/datasourcefieldspanel'
import { canManageDataSourceSettings } from '../../lib/auth'
import { Modal } from '../../components/ui/Modal'
import './EC.css'

type FieldConfig = { name: string; enabled: boolean; required?: boolean }
type FormBinding = {
  sourceIds?: string[]
  fieldConfigsBySource?: Record<string, FieldConfig[]>
  managementLayer?: { sourceId: string; selectedFields: string[]; availableFields?: string[] }
}
type FormBindings = Record<string, FormBinding>

type FieldSchema = { name: string; type: 'text' | 'number' | 'date' | 'boolean' }
type LayerFields = Record<string, FieldSchema[]>

type SaveRecord = {
  id: string
  tsUtc: string
  formKey: 'QHIS'
  kind?: 'draft' | 'submitted'
  state: DataSourceFormState
}

const DB_NAME = 'GisMapStore'
const STORE_NAME = 'layers'

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
  localStorage.setItem(key, JSON.stringify(value))
}

const STORAGE_KEY = 'qhis_records_v1'
const BINDINGS_KEY = 'form_data_source_bindings_v1'
const GIS_FIELDS_KEY = 'gisContent.layerFields.v1'

const getRealSourceId = (sourceId: string) => (sourceId.startsWith('management:') ? sourceId.slice('management:'.length) : sourceId)

export default function QHIS() {
  const navigate = useNavigate()
  const canManageSettings = useMemo(() => canManageDataSourceSettings(), [])
  const [panelKey, setPanelKey] = useState(0)
  const [formState, setFormState] = useState<DataSourceFormState>({ sourceIds: [], selectedFieldsBySource: {}, valuesBySource: {} })
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [busy, setBusy] = useState<null | 'saveAdd' | 'submit'>(null)
  const [modal, setModal] = useState<null | { kind: 'confirmClear' } | { kind: 'confirmDiscard'; nextPath?: string }>(null)
  const [flash, setFlash] = useState<null | { kind: 'success' | 'error'; message: string }>(null)
  const [layerNameById, setLayerNameById] = useState<Record<string, string>>({})
  const [quickFillApplyKey, setQuickFillApplyKey] = useState(0)
  const [quickFillValuesBySource, setQuickFillValuesBySource] = useState<Record<string, Record<string, string>> | null>(null)
  const nextIndexRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, 1)
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        })
        const tx = db.transaction(STORE_NAME, 'readonly')
        const req = tx.objectStore(STORE_NAME).get('savedLayers')
        const layers = await new Promise<any[]>((resolve) => {
          req.onsuccess = () => resolve(req.result || [])
          req.onerror = () => resolve([])
        })
        if (cancelled) return
        const next: Record<string, string> = {}
        ;(Array.isArray(layers) ? layers : []).forEach((l: any) => {
          const id = String(l?.id ?? '').trim()
          const name = String(l?.name ?? '').trim()
          if (id && name) next[id] = name
        })
        setLayerNameById(next)
      } catch {
        if (!cancelled) setLayerNameById({})
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const getLayerDisplayName = (sourceId: string) => {
    const real = String(getRealSourceId(sourceId) ?? '')
    const candidates: string[] = [real]
    const lower = real.toLowerCase()
    if (lower.startsWith('arcgis:')) candidates.push(real.slice('arcgis:'.length))
    if (lower.startsWith('geojson:')) candidates.push(real.slice('geojson:'.length))
    if (lower.startsWith('url:')) candidates.push(real.slice('url:'.length))
    if (/^https?:\/\//i.test(real)) {
      candidates.push(`arcgis:${real}`)
      candidates.push(`url:${real}`)
      candidates.push(`geojson:${real}`)
    }
    for (const id of candidates) {
      const name = layerNameById[id]
      if (name && name.trim()) return name
    }
    return sourceId
  }

  const isDirty = useMemo(() => {
    const values = formState.valuesBySource || {}
    for (const sourceValues of Object.values(values)) {
      for (const v of Object.values(sourceValues || {})) {
        if (String(v ?? '').trim()) return true
      }
    }
    return false
  }, [formState.valuesBySource])

  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 2500)
    return () => window.clearTimeout(t)
  }, [flash])

  const validate = (state: DataSourceFormState): string[] => {
    const bindings = readJson<FormBindings>(BINDINGS_KEY, {})
    const b = bindings.QHIS || {}
    const requiredBySource: Record<string, string[]> = {}
    for (const [sourceId, cfgs] of Object.entries(b.fieldConfigsBySource || {})) {
      const required = (Array.isArray(cfgs) ? cfgs : [])
        .filter(c => c && (c as any).required)
        .map(c => String((c as any).name ?? '').trim())
        .filter(Boolean)
      if (required.length) requiredBySource[sourceId] = required
    }

    const layerFields = readJson<LayerFields>(GIS_FIELDS_KEY, {})
    const getFieldType = (sourceId: string, fieldName: string) => {
      const realId = getRealSourceId(sourceId)
      const list = Array.isArray(layerFields[realId]) ? layerFields[realId] : []
      const found = list.find(f => String((f as any)?.name ?? '') === fieldName)
      const t = String((found as any)?.type ?? '').toLowerCase()
      if (t === 'date') return 'date'
      if (t === 'number') return 'number'
      if (t === 'boolean') return 'boolean'
      return 'text'
    }

    const errors: string[] = []
    for (const sourceId of state.sourceIds) {
      const realId = getRealSourceId(sourceId)
      const displayName = getLayerDisplayName(sourceId)
      const requiredFields = requiredBySource[realId] ?? requiredBySource[sourceId] ?? []
      const values = state.valuesBySource[sourceId] ?? {}
      for (const field of requiredFields) {
        const v = String(values[field] ?? '').trim()
        if (!v) errors.push(`${displayName}: ${field} is required.`)
      }

      const selected = state.selectedFieldsBySource[sourceId] ?? []
      for (const field of selected) {
        const raw = String(values[field] ?? '').trim()
        if (!raw) continue
        const type = getFieldType(sourceId, field)
        if (type === 'number') {
          const n = Number(raw)
          if (!Number.isFinite(n)) errors.push(`${displayName}: ${field} must be a valid number.`)
        }
        if (type === 'date') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) errors.push(`${displayName}: ${field} must be a valid date.`)
        }
        if (type === 'boolean') {
          const v = raw.toLowerCase()
          if (!(v === 'true' || v === 'false' || v === '1' || v === '0' || v === 'yes' || v === 'no')) {
            errors.push(`${displayName}: ${field} must be a valid boolean value.`)
          }
        }
      }
    }
    return errors
  }

  const clearForm = () => {
    setValidationErrors([])
    setFormState({ sourceIds: [], selectedFieldsBySource: {}, valuesBySource: {} })
    setPanelKey(k => k + 1)
    setQuickFillValuesBySource(null)
    nextIndexRef.current = 0
  }

  const attemptNavigate = (path: string) => {
    if (!isDirty) {
      navigate(path)
      return
    }
    setModal({ kind: 'confirmDiscard', nextPath: path })
  }

  const persistLocal = (kind: 'draft' | 'submitted') => {
    try {
      const record: SaveRecord = {
        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        tsUtc: new Date().toISOString(),
        formKey: 'QHIS',
        kind,
        state: formState,
      }
      const existing = readJson<SaveRecord[]>(STORAGE_KEY, [])
      const next = [record, ...existing].slice(0, 2000)
      writeJson(STORAGE_KEY, next)
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'Failed to save. Please try again.'
      throw new Error(msg)
    }
  }

  const onQuickFill = () => {
    if (busy) return
    setFlash(null)
    try {
      const existing = readJson<SaveRecord[]>(STORAGE_KEY, [])
      const latest = Array.isArray(existing) ? existing[0] : null
      const vb = latest && typeof latest === 'object' ? (latest as any).state?.valuesBySource : null
      if (!vb || typeof vb !== 'object') throw new Error('No previous entry found for Quick Fill.')
      setQuickFillValuesBySource(vb)
      setQuickFillApplyKey(k => k + 1)
      setFlash({ kind: 'success', message: 'Quick Fill applied from latest saved entry.' })
    } catch (e: any) {
      setFlash({ kind: 'error', message: typeof e?.message === 'string' ? e.message : 'Quick Fill failed.' })
    }
  }

  const onSaveAddAnother = async () => {
    if (busy) return
    setFlash(null)
    const errors = validate(formState)
    setValidationErrors(errors)
    if (errors.length) {
      setFlash({ kind: 'error', message: 'Please fix the highlighted issues before saving.' })
      return
    }
    if (!isDirty) {
      setFlash({ kind: 'error', message: 'Nothing to save.' })
      return
    }
    setBusy('saveAdd')
    try {
      persistLocal('draft')
      setFlash({ kind: 'success', message: 'Saved. Ready for next entry.' })
      clearForm()
    } catch (e: any) {
      setFlash({ kind: 'error', message: typeof e?.message === 'string' ? e.message : 'Failed to save.' })
    } finally {
      setBusy(null)
    }
  }

  const onSubmit = async () => {
    if (busy) return
    setFlash(null)
    const errors = validate(formState)
    setValidationErrors(errors)
    if (errors.length) {
      setFlash({ kind: 'error', message: 'Please fix the highlighted issues before submitting.' })
      return
    }
    if (!isDirty) {
      setFlash({ kind: 'error', message: 'Nothing to submit.' })
      return
    }
    setBusy('submit')
    try {
      persistLocal('submitted')
      setFlash({ kind: 'success', message: 'Submitted successfully.' })
      clearForm()
    } catch (e: any) {
      setFlash({ kind: 'error', message: typeof e?.message === 'string' ? e.message : 'Failed to submit.' })
    } finally {
      setBusy(null)
    }
  }

  const onClear = () => {
    if (busy) return
    if (!isDirty) {
      clearForm()
      setFlash({ kind: 'success', message: 'Cleared.' })
      return
    }
    setModal({ kind: 'confirmClear' })
  }

  const onNext = () => {
    if (!formState.sourceIds.length) return
    const ids = formState.sourceIds
      .filter(id => !String(id).startsWith('management:'))
      .filter(id => (formState.selectedFieldsBySource?.[id] ?? []).length > 0)
    if (!ids.length) return
    nextIndexRef.current = (nextIndexRef.current + 1) % ids.length
    const sourceId = ids[nextIndexRef.current]
    const domId = `ds-source-${String(sourceId).replace(/[^a-zA-Z0-9_-]/g, '_')}`
    const el = document.getElementById(domId)
    ;(el as any)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    const input = el?.querySelector('input, select, textarea') as HTMLElement | null
    input?.focus?.()
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = String(e.key || '').toLowerCase()
      if ((e.ctrlKey || (e as any).metaKey) && key === 's') {
        e.preventDefault()
        void onSaveAddAnother()
        return
      }
      if (key === 'escape') {
        if (busy) return
        attemptNavigate('/')
      }
    }
    window.addEventListener('keydown', onKeyDown as any)
    return () => window.removeEventListener('keydown', onKeyDown as any)
  }, [busy, isDirty, formState])

  return (
    <div className="ec-page">
      <div className="ec-container ec-animate-in">
        <div className="ec-header">
          <div className="ec-title">
            <i className="fa-solid fa-shield-halved"></i>
            <div>
              QHIS
              <div className="ec-section-subtitle">Configurable, layer-driven QHIS data entry</div>
            </div>
          </div>
        </div>

        {flash ? (
          <div
            className="ec-card"
            style={{
              borderColor: flash.kind === 'success' ? '#bbf7d0' : '#fecaca',
              background: flash.kind === 'success' ? '#f0fdf4' : '#fef2f2',
            }}
          >
            <div className="ec-card-body" style={{ color: '#0f172a', fontWeight: 700 }}>
              {flash.message}
            </div>
          </div>
        ) : null}

        <div className="ec-card">
          <div className="ec-card-header">
            <div>
              <div className="ec-card-title">
                <i className="fa-solid fa-circle-info" style={{ color: 'var(--ec-primary)' }}></i>
                Data Entry Form
              </div>
              <div className="ec-card-subtitle-small">Configured in Settings (Manager and Admin only)</div>
            </div>
            <div className="ec-card-header-actions">
              {canManageSettings ? (
                <button type="button" className="ec-icon-btn" aria-label="Open workflow settings" title="Settings" onClick={() => attemptNavigate('/master/workflow-settings?form=QHIS')}>
                  <i className="fa-solid fa-gear"></i>
                </button>
              ) : null}
            </div>
          </div>
          <div className="ec-card-body">
            <DataSourceFieldsPanel
              key={panelKey}
              formKey="QHIS"
              mode="fill"
              variant="embedded"
              onChange={setFormState}
              externalValuesBySource={quickFillValuesBySource}
              externalApplyKey={quickFillApplyKey}
            />
            {validationErrors.length ? (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: '1px solid #fecaca', background: '#fef2f2', color: '#7f1d1d', fontSize: 13 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Validation issues</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {validationErrors.slice(0, 50).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className="ec-btn" onClick={onQuickFill} disabled={Boolean(busy)} aria-label="Quick Fill" title="Quick Fill">
                <i className="fa-solid fa-bolt" aria-hidden="true" /> Quick Fill
              </button>
              <button type="button" className="ec-btn ec-btn-ghost" onClick={onClear} disabled={Boolean(busy)} aria-label="Clear" title="Clear">
                <i className="fa-solid fa-eraser" aria-hidden="true" /> Clear
              </button>
              <button
                type="button"
                className="ec-btn"
                onClick={() => void onSaveAddAnother()}
                disabled={Boolean(busy)}
                aria-label="Save and add another"
                title="Ctrl+S"
              >
                <i className={busy === 'saveAdd' ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-plus'} aria-hidden="true" /> Save & Add Another
              </button>
              <button
                type="button"
                className="ec-btn ec-btn-primary"
                onClick={() => void onSubmit()}
                disabled={Boolean(busy)}
                aria-label="Submit entry"
                title="Submit Entry"
              >
                <i className={busy === 'submit' ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-check'} aria-hidden="true" /> Submit Entry
              </button>
              <button type="button" className="ec-btn" onClick={onNext} disabled={Boolean(busy)} aria-label="Next section" title="Next">
                Next <i className="fa-solid fa-arrow-right" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        isOpen={modal?.kind === 'confirmClear'}
        title="Clear all fields?"
        onClose={() => (busy ? null : setModal(null))}
        actions={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="ds-btn ds-btn-ghost" type="button" onClick={() => setModal(null)} disabled={Boolean(busy)}>
              Cancel
            </button>
            <button
              className="ds-btn ds-btn-danger"
              type="button"
              onClick={() => {
                setModal(null)
                clearForm()
                setFlash({ kind: 'success', message: 'Cleared.' })
              }}
              disabled={Boolean(busy)}
            >
              Clear
            </button>
          </div>
        }
      >
        This will reset all form fields to an empty state.
      </Modal>

      <Modal
        isOpen={modal?.kind === 'confirmDiscard'}
        title="Discard changes?"
        onClose={() => setModal(null)}
        actions={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="ds-btn ds-btn-ghost" type="button" onClick={() => setModal(null)}>
              Keep editing
            </button>
            <button
              className="ds-btn ds-btn-danger"
              type="button"
              onClick={() => {
                const nextPath = modal?.kind === 'confirmDiscard' ? modal.nextPath : undefined
                setModal(null)
                clearForm()
                if (nextPath) navigate(nextPath)
              }}
            >
              Discard
            </button>
          </div>
        }
      >
        You have unsaved changes. Leaving this page will discard them.
      </Modal>
    </div>
  )
}
