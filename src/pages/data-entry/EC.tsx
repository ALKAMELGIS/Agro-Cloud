import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DataSourceFieldsPanel, type DataSourceFormState } from './components/datasourcefieldspanel'
import { canManageDataSourceSettings, readCurrentUser } from '../../lib/auth'
import { Modal } from '../../components/ui/Modal'
import './EC.css'

type SaveRecord = {
  id: string
  tsUtc: string
  formKey: 'EC'
  state: DataSourceFormState
}

const STORAGE_KEY = 'ecph_records_v1'

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

export default function EC() {
  const navigate = useNavigate()
  const canManageSettings = useMemo(() => canManageDataSourceSettings(), [])
  const [panelKey, setPanelKey] = useState(0)
  const [formState, setFormState] = useState<DataSourceFormState>({ sourceIds: [], selectedFieldsBySource: {}, valuesBySource: {} })
  const [busy, setBusy] = useState<null | 'saveAdd' | 'submit'>(null)
  const [modal, setModal] = useState<null | { kind: 'confirmClear' } | { kind: 'confirmDiscard'; nextPath?: string }>(null)
  const [flash, setFlash] = useState<null | { kind: 'success' | 'error'; message: string }>(null)
  const [quickFillApplyKey, setQuickFillApplyKey] = useState(0)
  const [quickFillValuesBySource, setQuickFillValuesBySource] = useState<Record<string, Record<string, string>> | null>(null)
  const nextIndexRef = useRef(0)

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

  const clearForm = () => {
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

  const persistLocal = () => {
    const record: SaveRecord = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      tsUtc: new Date().toISOString(),
      formKey: 'EC',
      state: formState,
    }
    const existing = readJson<SaveRecord[]>(STORAGE_KEY, [])
    const next = [record, ...existing].slice(0, 2000)
    writeJson(STORAGE_KEY, next)
    try {
      localStorage.setItem('ecph_quickfill_template_v1', JSON.stringify(formState.valuesBySource ?? {}))
    } catch {
    }
  }

  const persistBackend = async (kind: 'draft' | 'submitted') => {
    const user = readCurrentUser()
    const res = await fetch('/api/ecph/entries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-email': String(user?.email ?? ''),
      },
      body: JSON.stringify({ formKey: 'EC', kind, state: formState }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = data && typeof data === 'object' && typeof (data as any).error === 'string' ? (data as any).error : 'Save failed'
      throw new Error(msg)
    }
    return data
  }

  const validateForSubmit = (): string[] => {
    const errs: string[] = []
    const bindings = readJson<any>('form_data_source_bindings_v1', {})
    const binding = bindings?.EC
    const configsBySource = binding?.fieldConfigsBySource && typeof binding.fieldConfigsBySource === 'object' ? binding.fieldConfigsBySource : {}
    const valuesBySource = formState.valuesBySource ?? {}

    const requiredPairs: Array<{ sourceId: string; fieldName: string }> = []
    for (const [sourceId, cfgs] of Object.entries<any>(configsBySource)) {
      if (!Array.isArray(cfgs)) continue
      for (const c of cfgs) {
        if (!c || typeof c !== 'object') continue
        if (!c.enabled) continue
        if (!c.required) continue
        const name = String(c.name || '')
        if (!name) continue
        requiredPairs.push({ sourceId: String(sourceId), fieldName: name })
      }
    }

    for (const req of requiredPairs) {
      const v = valuesBySource[req.sourceId]?.[req.fieldName]
      if (String(v ?? '').trim() === '') errs.push(`${req.fieldName}`)
    }

    const checkNumber = (field: string, min?: number, max?: number, integer?: boolean) => {
      const candidates: string[] = []
      for (const sourceId of Object.keys(valuesBySource)) {
        const v = valuesBySource[sourceId]?.[field]
        if (v === undefined) continue
        candidates.push(String(v))
      }
      if (!candidates.length) return
      for (const raw of candidates) {
        const t = String(raw ?? '').trim()
        if (!t) continue
        const n = Number(t)
        if (!Number.isFinite(n)) {
          errs.push(`${field} must be a number`)
          return
        }
        if (integer && !Number.isInteger(n)) {
          errs.push(`${field} must be an integer`)
          return
        }
        if (typeof min === 'number' && n < min) {
          errs.push(`${field} must be ≥ ${min}`)
          return
        }
        if (typeof max === 'number' && n > max) {
          errs.push(`${field} must be ≤ ${max}`)
          return
        }
      }
    }

    checkNumber('pH_In', 0, 14)
    checkNumber('pH_Out', 0, 14)
    checkNumber('DripVolume_ml', 0)
    checkNumber('Drain_Volume_ml', 0)
    checkNumber('Qty_Of_Water_M3', 0)
    checkNumber('Cycle', 1, undefined, true)

    return errs
  }

  const onQuickFill = async () => {
    if (busy) return
    setFlash(null)
    try {
      const res = await fetch('/api/ecph/entries/latest')
      const data = await res.json().catch(() => null)
      if (res.ok && data && typeof data === 'object' && data.item && typeof data.item === 'object') {
        const vb = (data.item as any).state?.valuesBySource
        if (vb && typeof vb === 'object') {
          setQuickFillValuesBySource(vb)
          setQuickFillApplyKey(k => k + 1)
          setFlash({ kind: 'success', message: 'Quick Fill applied from latest saved entry.' })
          return
        }
      }
    } catch {
    }
    try {
      const raw = localStorage.getItem('ecph_quickfill_template_v1')
      if (!raw) throw new Error('No quick fill template found.')
      const vb = JSON.parse(raw)
      if (!vb || typeof vb !== 'object') throw new Error('Invalid quick fill template.')
      setQuickFillValuesBySource(vb)
      setQuickFillApplyKey(k => k + 1)
      setFlash({ kind: 'success', message: 'Quick Fill applied from previously entered data.' })
    } catch (e: any) {
      setFlash({ kind: 'error', message: typeof e?.message === 'string' ? e.message : 'Quick Fill failed.' })
    }
  }

  const onSaveAddAnother = async () => {
    if (busy) return
    setFlash(null)
    if (!isDirty) {
      setFlash({ kind: 'error', message: 'Nothing to save.' })
      return
    }
    setBusy('saveAdd')
    try {
      persistLocal()
      await persistBackend('draft')
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
    const errors = validateForSubmit()
    if (errors.length) {
      const unique = Array.from(new Set(errors)).slice(0, 12)
      setFlash({ kind: 'error', message: `Fix required/invalid fields: ${unique.join(', ')}${errors.length > unique.length ? '…' : ''}` })
      return
    }
    setBusy('submit')
    try {
      persistLocal()
      await persistBackend('submitted')
      setFlash({ kind: 'success', message: 'Entry submitted successfully.' })
    } catch (e: any) {
      setFlash({ kind: 'error', message: typeof e?.message === 'string' ? e.message : 'Submission failed.' })
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
            <i className="fa-solid fa-droplet"></i>
            <div>
              EC / pH
              <div className="ec-section-subtitle">Daily EC / pH and water tracking</div>
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
                  onClick={() => attemptNavigate('/master/workflow-settings?form=EC')}
                >
                  <i className="fa-solid fa-gear"></i>
                </button>
              </div>
            ) : null}
          </div>
          <div className="ec-card-body">
            <DataSourceFieldsPanel
              key={panelKey}
              formKey="EC"
              mode="fill"
              variant="embedded"
              onChange={setFormState}
              externalValuesBySource={quickFillValuesBySource}
              externalApplyKey={quickFillApplyKey}
            />

            <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="ec-btn"
                onClick={() => void onQuickFill()}
                disabled={Boolean(busy)}
                aria-label="Quick Fill"
                title="Quick Fill"
              >
                <i className="fa-solid fa-bolt" aria-hidden="true" /> Quick Fill
              </button>
              <button
                type="button"
                className="ec-btn ec-btn-ghost"
                onClick={onClear}
                disabled={Boolean(busy)}
                aria-label="Clear"
                title="Clear"
              >
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
    </div>
  )
}
