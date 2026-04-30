import { useEffect, useMemo, useRef, useState } from 'react'
import type { LayerData } from './LayerManager'

type PopupState = {
  layerId: string
  layerName: string
  featureKey: string
  feature: any
  latlng: { lat: number; lng: number }
  phase: 'open' | 'closing'
}

type PopupPos = {
  left: number
  top: number
  placement: 'top' | 'bottom'
  arrowLeft: number
}

type FieldDef = {
  name: string
  label: string
  kind: 'text' | 'number' | 'date'
  required: boolean
  editable: boolean
  subtypeOptions?: Array<{ value: string; label: string; rawId: any }>
  codedValues?: Array<{ value: string; label: string; rawCode: any }>
  range?: { min?: number; max?: number }
}

export type MapPopupStrings = {
  table: string
  edit: string
  zoomTo: string
  save: string
  cancel: string
  required: string
  invalidNumber: string
  outOfRange: (min?: number, max?: number) => string
}

const defaultStrings: MapPopupStrings = {
  table: 'Table',
  edit: 'Edit',
  zoomTo: 'Zoom to',
  save: 'Save',
  cancel: 'Cancel',
  required: 'Required',
  invalidNumber: 'Invalid number',
  outOfRange: (min?: number, max?: number) => {
    if (typeof min === 'number' && typeof max === 'number') return `Must be between ${min} and ${max}`
    if (typeof min === 'number') return `Must be ≥ ${min}`
    if (typeof max === 'number') return `Must be ≤ ${max}`
    return 'Out of range'
  },
}

const formatPopupValue = (raw: any) => {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'bigint') return String(raw)
  try {
    return JSON.stringify(raw)
  } catch {
    try {
      return String(raw)
    } catch {
      return ''
    }
  }
}

const getPopupTitle = (feature: any) => {
  const props = feature?.properties && typeof feature.properties === 'object' ? (feature.properties as Record<string, any>) : {}
  const candidates = [
    'Farm_Name',
    'farm_name',
    'NAME',
    'Name',
    'name',
    'title',
    'Title',
    'Project_Code',
    'ProjectCode',
    'OBJECTID',
    'ObjectId',
    'objectid',
  ]
  for (const k of candidates) {
    const v = formatPopupValue(props[k]).trim()
    if (v) return v
  }
  return ''
}

const toDateInputValue = (raw: any) => {
  const ms = typeof raw === 'number' ? raw : raw ? Number(raw) : NaN
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const fromDateInputValue = (raw: string) => {
  if (!raw) return null
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : null
}

const guessKind = (arcType?: string, raw?: any): FieldDef['kind'] => {
  if (typeof arcType === 'string') {
    const t = arcType.toLowerCase()
    if (t.includes('date')) return 'date'
    if (t.includes('integer') || t.includes('double') || t.includes('single') || t.includes('smallinteger')) return 'number'
  }
  if (typeof raw === 'number') return 'number'
  return 'text'
}

export type MapPopupProps = {
  popup: PopupState
  pos: PopupPos
  layer: LayerData | null
  rootRef?: { current: HTMLDivElement | null }
  onClose: () => void
  onOpenTable: () => void
  onZoomTo: () => void
  onUpdateFeature: (nextFeature: any) => void
  strings?: Partial<MapPopupStrings>
}

/**
 * Popup لعرض وتحرير حقول Feature.
 * - يستخرج الحقول من ArcGIS layer definition (fields/domains/subtypes) أو من properties عند عدم توفرها.
 * - يدعم view/edit داخل نفس النافذة مع تحقق من القيم (required / range / number).
 */
export function MapPopup({ popup, pos, layer, rootRef: externalRootRef, onClose, onOpenTable, onZoomTo, onUpdateFeature, strings }: MapPopupProps) {
  const s = { ...defaultStrings, ...(strings || {}) }
  const internalRootRef = useRef<HTMLDivElement | null>(null)
  const rootRef = externalRootRef ?? internalRootRef
  const [collapsed, setCollapsed] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [form, setForm] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const fieldDefs = useMemo<FieldDef[]>(() => {
    const props = popup.feature?.properties && typeof popup.feature.properties === 'object' ? (popup.feature.properties as Record<string, any>) : {}
    const arcDef = layer?.source === 'arcgis' ? layer.arcgisLayerDefinition : null

    if (!arcDef || !Array.isArray(arcDef.fields)) {
      return Object.keys(props)
        .filter(k => k)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({
          name,
          label: name,
          kind: guessKind(undefined, props[name]),
          required: false,
          editable: true,
        }))
    }

    const arcFields: any[] = arcDef.fields
    const arcTypeIdField = typeof arcDef.typeIdField === 'string' && arcDef.typeIdField ? String(arcDef.typeIdField) : null
    const arcTypes: any[] = Array.isArray(arcDef.types) ? arcDef.types : []
    const arcTypesById = new Map<string, any>(arcTypes.map(t => [String(t?.id), t]))
    const arcFieldsByLower = new Map<string, any>(
      arcFields
        .filter(f => typeof f?.name === 'string' && f.name)
        .map(f => [String(f.name).toLowerCase(), f]),
    )

    const getSubtype = () => {
      if (!arcTypeIdField) return null
      const raw = props[arcTypeIdField]
      if (raw === null || raw === undefined || raw === '') return null
      return arcTypesById.get(String(raw)) ?? null
    }

    const getDomainForField = (fieldName: string) => {
      const subtype = getSubtype()
      const subtypeDomains = subtype && subtype.domains && typeof subtype.domains === 'object' ? subtype.domains : null
      const subtypeDomain = subtypeDomains ? subtypeDomains[fieldName] ?? subtypeDomains[String(fieldName)] : null
      if (subtypeDomain) return subtypeDomain
      const fieldDef = arcFieldsByLower.get(String(fieldName).toLowerCase())
      return fieldDef?.domain ?? null
    }

    const subtypeOptions: Array<{ value: string; label: string; rawId: any }> =
      arcTypeIdField && arcTypes.length
        ? arcTypes.map((t: any) => ({
            value: String(t?.id ?? ''),
            label: typeof t?.name === 'string' && t.name ? t.name : String(t?.id ?? ''),
            rawId: t?.id,
          }))
        : []

    const defs: FieldDef[] = []
    for (const f of arcFields) {
      const name = typeof f?.name === 'string' ? f.name : ''
      if (!name) continue
      const alias = typeof f?.alias === 'string' && f.alias ? f.alias : name
      const editable = typeof f?.editable === 'boolean' ? f.editable : true
      const required = typeof f?.nullable === 'boolean' ? !f.nullable : false
      const kind = guessKind(typeof f?.type === 'string' ? f.type : undefined, props[name])
      const domain = getDomainForField(name)

      const isSubtype = arcTypeIdField && String(name).toLowerCase() === String(arcTypeIdField).toLowerCase()
      if (isSubtype && subtypeOptions.length) {
        defs.push({ name, label: alias, kind: 'text', required, editable, subtypeOptions })
        continue
      }

      if (domain?.type === 'codedValue' && Array.isArray(domain?.codedValues)) {
        const codedValues = (domain.codedValues as any[])
          .filter(cv => cv && cv.code !== undefined)
          .map(cv => ({
            value: String(cv.code),
            label: typeof cv?.name === 'string' && cv.name ? cv.name : String(cv.code),
            rawCode: cv.code,
          }))
        defs.push({ name, label: alias, kind: 'text', required, editable, codedValues })
        continue
      }

      if (domain?.type === 'range') {
        const min = typeof domain.minValue === 'number' ? domain.minValue : undefined
        const max = typeof domain.maxValue === 'number' ? domain.maxValue : undefined
        defs.push({ name, label: alias, kind: 'number', required, editable, range: { min, max } })
        continue
      }

      defs.push({ name, label: alias, kind, required, editable })
    }

    const existing = new Set(defs.map(d => d.name))
    for (const k of Object.keys(props)) {
      if (!k || existing.has(k)) continue
      defs.push({ name: k, label: k, kind: guessKind(undefined, props[k]), required: false, editable: true })
    }

    return defs
  }, [layer, popup.feature])

  useEffect(() => {
    if (popup.phase === 'closing') return
    setCollapsed(false)
    setMaximized(false)
    setMode('view')
    setErrors({})
  }, [popup.layerId, popup.featureKey, popup.phase])

  useEffect(() => {
    const props = popup.feature?.properties && typeof popup.feature.properties === 'object' ? (popup.feature.properties as Record<string, any>) : {}
    const next: Record<string, string> = {}
    for (const def of fieldDefs) {
      const raw = props[def.name]
      if (def.kind === 'date') next[def.name] = toDateInputValue(raw)
      else next[def.name] = raw === null || raw === undefined ? '' : String(raw)
    }
    setForm(next)
  }, [popup.feature, fieldDefs])

  const validate = () => {
    const nextErrors: Record<string, string> = {}
    for (const def of fieldDefs) {
      if (!def.editable) continue
      const raw = form[def.name] ?? ''
      const value = String(raw).trim()
      if (def.required && !value) {
        nextErrors[def.name] = s.required
        continue
      }
      if (def.kind === 'number' && value) {
        const n = Number(value)
        if (!Number.isFinite(n)) {
          nextErrors[def.name] = s.invalidNumber
          continue
        }
        const min = def.range?.min
        const max = def.range?.max
        if (typeof min === 'number' && n < min) nextErrors[def.name] = s.outOfRange(min, max)
        else if (typeof max === 'number' && n > max) nextErrors[def.name] = s.outOfRange(min, max)
      }
    }
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const applySave = () => {
    if (!validate()) return
    const prevProps = popup.feature?.properties && typeof popup.feature.properties === 'object' ? (popup.feature.properties as Record<string, any>) : {}
    const nextProps: Record<string, any> = { ...prevProps }

    for (const def of fieldDefs) {
      if (!def.editable) continue
      const raw = (form[def.name] ?? '').trim()
      if (!raw) {
        nextProps[def.name] = null
        continue
      }
      if (def.subtypeOptions?.length) {
        const match = def.subtypeOptions.find(o => o.value === raw)
        nextProps[def.name] = match ? match.rawId : raw
        continue
      }
      if (def.codedValues?.length) {
        const match = def.codedValues.find(cv => cv.value === raw)
        nextProps[def.name] = match ? match.rawCode : raw
        continue
      }
      if (def.kind === 'number') nextProps[def.name] = Number(raw)
      else if (def.kind === 'date') nextProps[def.name] = fromDateInputValue(raw)
      else nextProps[def.name] = raw
    }

    const nextFeature = {
      ...popup.feature,
      properties: nextProps,
    }
    onUpdateFeature(nextFeature)
    setMode('view')
  }

  const renderValueForView = (def: FieldDef) => {
    const props = popup.feature?.properties && typeof popup.feature.properties === 'object' ? (popup.feature.properties as Record<string, any>) : {}
    const raw = props[def.name]
    const rawText = formatPopupValue(raw)
    if (def.subtypeOptions?.length) {
      const opt = def.subtypeOptions.find(o => o.value === rawText)
      return opt?.label || rawText
    }
    if (def.codedValues?.length) {
      const cv = def.codedValues.find(o => o.value === rawText)
      return cv?.label || rawText
    }
    if (def.kind === 'date' && rawText) {
      const ms = typeof raw === 'number' ? raw : Number(raw)
      const d = Number.isFinite(ms) ? new Date(ms) : null
      return d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : rawText
    }
    return rawText
  }

  const title = getPopupTitle(popup.feature) || popup.layerName

  return (
    <div className="gis-map-popup-layer" aria-hidden={popup.phase === 'closing' ? 'true' : 'false'}>
      <div
        ref={rootRef}
        className={maximized ? 'gis-map-popup maximized' : 'gis-map-popup'}
        role="dialog"
        aria-label={`Feature details${popup.layerName ? `: ${popup.layerName}` : ''}`}
        data-state={popup.phase}
        data-placement={pos.placement}
        style={
          {
            left: `${pos.left}px`,
            top: `${pos.top}px`,
            ['--arrow-left' as any]: `${pos.arrowLeft}px`,
          } as any
        }
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
            return
          }
          if (e.key !== 'Tab') return
          const root = rootRef.current
          if (!root) return
          const els = Array.from(
            root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
          ).filter(el => !el.hasAttribute('disabled') && el.tabIndex !== -1 && el.offsetParent !== null)
          if (!els.length) return
          const first = els[0]
          const last = els[els.length - 1]
          const active = document.activeElement
          if ((e as any).shiftKey) {
            if (active === first || !root.contains(active)) {
              e.preventDefault()
              last.focus()
            }
          } else {
            if (active === last) {
              e.preventDefault()
              first.focus()
            }
          }
        }}
      >
        <div className="gis-map-popup-header">
          <div className="gis-map-popup-title" title={title}>
            {title}
          </div>
          <div className="gis-map-popup-headactions">
            <button
              className="gis-map-popup-headbtn"
              type="button"
              onClick={() => setMaximized(v => !v)}
              aria-label={maximized ? 'Restore popup size' : 'Maximize popup'}
              title={maximized ? 'Restore' : 'Maximize'}
            >
              <i className="fa-regular fa-square" aria-hidden="true" />
            </button>
            <button
              className="gis-map-popup-headbtn"
              type="button"
              onClick={() => setCollapsed(v => !v)}
              aria-label={collapsed ? 'Expand popup' : 'Collapse popup'}
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              <i className={`fa-solid ${collapsed ? 'fa-chevron-down' : 'fa-chevron-up'}`} aria-hidden="true" />
            </button>
            <button className="gis-map-popup-headbtn" type="button" onClick={onClose} aria-label="Close popup" title="Close">
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="gis-map-popup-toolbar" role="toolbar" aria-label="Popup actions">
          <button className="gis-map-popup-toolbtn" type="button" onClick={onOpenTable}>
            <i className="fa-solid fa-table" aria-hidden="true" />
            <span>{s.table}</span>
          </button>
          <span className="gis-map-popup-toolsep" aria-hidden="true" />
          <button className="gis-map-popup-toolbtn" type="button" onClick={() => setMode(v => (v === 'edit' ? 'view' : 'edit'))}>
            <i className="fa-solid fa-pen" aria-hidden="true" />
            <span>{s.edit}</span>
          </button>
          <span className="gis-map-popup-toolsep" aria-hidden="true" />
          <button className="gis-map-popup-toolbtn" type="button" onClick={onZoomTo}>
            <i className="fa-solid fa-magnifying-glass-plus" aria-hidden="true" />
            <span>{s.zoomTo}</span>
          </button>
        </div>

        <div className={collapsed ? 'gis-map-popup-body collapsed' : 'gis-map-popup-body'}>
          {mode === 'edit' ? (
            <div className="gis-map-popup-form" aria-label="Edit fields">
              {fieldDefs.map((def) => {
                const err = errors[def.name]
                const value = form[def.name] ?? ''
                const disabled = !def.editable
                return (
                  <div key={def.name} className="gis-map-popup-field" data-invalid={err ? 'true' : 'false'}>
                    <div className="gis-map-popup-fieldlabel">
                      <span title={def.name}>{def.label}</span>
                      {def.required ? <span className="gis-map-popup-required" aria-hidden="true">*</span> : null}
                    </div>
                    {def.subtypeOptions?.length ? (
                      <select
                        className="gis-map-popup-input"
                        value={value}
                        disabled={disabled}
                        onChange={(e) => setForm(prev => ({ ...prev, [def.name]: e.target.value }))}
                      >
                        <option value="" />
                        {def.subtypeOptions.map(o => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : def.codedValues?.length ? (
                      <select
                        className="gis-map-popup-input"
                        value={value}
                        disabled={disabled}
                        onChange={(e) => setForm(prev => ({ ...prev, [def.name]: e.target.value }))}
                      >
                        <option value="" />
                        {def.codedValues.map(o => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : def.kind === 'number' ? (
                      <input
                        className="gis-map-popup-input"
                        type="number"
                        inputMode="numeric"
                        value={value}
                        disabled={disabled}
                        min={typeof def.range?.min === 'number' ? def.range.min : undefined}
                        max={typeof def.range?.max === 'number' ? def.range.max : undefined}
                        onChange={(e) => setForm(prev => ({ ...prev, [def.name]: e.target.value }))}
                      />
                    ) : def.kind === 'date' ? (
                      <input
                        className="gis-map-popup-input"
                        type="datetime-local"
                        value={value}
                        disabled={disabled}
                        onChange={(e) => setForm(prev => ({ ...prev, [def.name]: e.target.value }))}
                      />
                    ) : (
                      <input
                        className="gis-map-popup-input"
                        type="text"
                        value={value}
                        disabled={disabled}
                        onChange={(e) => setForm(prev => ({ ...prev, [def.name]: e.target.value }))}
                      />
                    )}
                    {err ? (
                      <div className="gis-map-popup-error" role="alert">
                        {err}
                      </div>
                    ) : null}
                  </div>
                )
              })}
              <div className="gis-map-popup-form-actions">
                <button className="gis-btn gis-btn-primary" type="button" onClick={applySave}>
                  {s.save}
                </button>
                <button
                  className="gis-btn"
                  type="button"
                  onClick={() => {
                    setErrors({})
                    setMode('view')
                  }}
                >
                  {s.cancel}
                </button>
              </div>
            </div>
          ) : (
            <dl className="gis-map-popup-dl">
              {fieldDefs.length ? (
                fieldDefs.map((def) => (
                  <div key={def.name} className="gis-map-popup-row">
                    <dt className="gis-map-popup-k">{def.label || def.name}</dt>
                    <dd className="gis-map-popup-v" title={renderValueForView(def)}>
                      {renderValueForView(def)}
                    </dd>
                  </div>
                ))
              ) : (
                <div className="gis-map-popup-empty">No attribute data available.</div>
              )}
            </dl>
          )}
        </div>
      </div>
    </div>
  )
}
