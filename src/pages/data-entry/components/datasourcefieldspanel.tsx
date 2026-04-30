import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

type FieldConfig = { name: string; enabled: boolean; required?: boolean }
type ManagementLayerBinding = { sourceId: string; selectedFields: string[]; availableFields?: string[] }
type FormBinding = {
  sourceId?: string
  sourceIds?: string[]
  fieldConfigsBySource?: Record<string, FieldConfig[]>
  selectedFieldsBySource?: Record<string, string[]>
  managementLayer?: ManagementLayerBinding
}
type FormBindings = Record<string, FormBinding>

export type DataSourceFormState = {
  sourceIds: string[]
  selectedFieldsBySource: Record<string, string[]>
  valuesBySource: Record<string, Record<string, string>>
}

type Props = {
  formKey: string
  mode: 'settings' | 'fill'
  variant?: 'embedded'
  onChange?: (state: DataSourceFormState) => void
  externalValuesBySource?: Record<string, Record<string, string>> | null
  externalApplyKey?: string | number
  testOverrides?: {
    loadSavedLayers?: () => Promise<any[]>
    fetchJson?: (url: string) => Promise<any>
    farmSuggestDebounceMs?: number
  }
}

const STORAGE_KEY = 'form_data_source_bindings_v1'
const GIS_CONTENT_FIELDS_KEY = 'gisContent.layerFields.v1'

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

const EC_PH_INPUT_FIELDS = new Set([
  'EC_In',
  'EC_Out',
  'pH_In',
  'pH_Out',
  'DripVolume_ml',
  'Drain_Volume_ml',
  'Qty_Of_Water_M3',
  'Cycle',
])

const EC_PH_CALCULATED_FIELDS = new Set([
  'N_DripVolume_ml',
  'Drain',
  'Total_Water_QTY',
  'Total_Water_Qty_Calculations',
])

const toNumberOrZero = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const roundTo = (value: number, decimals: number): number => {
  const d = Number.isFinite(decimals) ? Math.max(0, Math.min(12, Math.floor(decimals))) : 0
  const p = 10 ** d
  return Math.round((value + Number.EPSILON) * p) / p
}

const getCurrentHHMM = (): string => {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

const readPreviousDripVolumeMl = (): number => {
  try {
    const raw = localStorage.getItem('ecph_records_v1')
    if (!raw) return 0
    const records = JSON.parse(raw) as any[]
    if (!Array.isArray(records) || !records.length) return 0
    const r = records.find(x => x && typeof x === 'object' && x.formKey === 'EC')
    const valuesBySource = r?.state?.valuesBySource
    if (!valuesBySource || typeof valuesBySource !== 'object') return 0
    for (const sourceValues of Object.values(valuesBySource)) {
      if (!sourceValues || typeof sourceValues !== 'object') continue
      const v = (sourceValues as any).DripVolume_ml
      const n = toNumberOrZero(v)
      if (Number.isFinite(n) && n !== 0) return n
      if (v === 0 || v === '0') return 0
    }
    return 0
  } catch {
    return 0
  }
}

const computeEcPhCalculatedStrings = (sourceValues: Record<string, string>, previousDripVolumeMl: number) => {
  const drip = toNumberOrZero(sourceValues.DripVolume_ml ?? '')
  const drainVol = toNumberOrZero(sourceValues.Drain_Volume_ml ?? '')
  const qtyM3 = toNumberOrZero(sourceValues.Qty_Of_Water_M3 ?? '')
  const cycleRaw = toNumberOrZero(sourceValues.Cycle ?? '')
  const cycle = Number.isFinite(cycleRaw) ? Math.trunc(cycleRaw) : 0

  const N_DripVolume_ml = drip * 12
  const Drain = N_DripVolume_ml === 0 ? 0 : roundTo((drainVol / N_DripVolume_ml) * 100, 2)
  const Total_Water_QTY = roundTo(qtyM3 * cycle, 3)
  const Total_Water_Qty_Calculations = roundTo(((drip + toNumberOrZero(previousDripVolumeMl)) / 2) * 24400 / 1_000_000, 6)

  return {
    N_DripVolume_ml: String(N_DripVolume_ml),
    Drain: Drain.toFixed(2),
    Total_Water_QTY: Total_Water_QTY.toFixed(3),
    Total_Water_Qty_Calculations: Total_Water_Qty_Calculations.toFixed(6),
  }
}

const normalizeIds = (input: unknown): string[] =>
  Array.isArray(input) ? input.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean) : []

const normalizeEnabledBySource = (binding: FormBinding | undefined): { sourceIds: string[]; enabledBySource: Record<string, string[]> } => {
  const sourceIds = normalizeIds(binding?.sourceIds)
  const legacy = typeof binding?.sourceId === 'string' ? binding.sourceId.trim() : ''
  const ids = sourceIds.length ? Array.from(new Set(sourceIds)) : legacy ? [legacy] : []
  const enabledBySource: Record<string, string[]> = {}
  for (const id of ids) {
    const configs = binding?.fieldConfigsBySource?.[id]
    if (Array.isArray(configs)) {
      enabledBySource[id] = configs.filter(c => c && c.enabled).map(c => c.name).filter(Boolean)
      continue
    }
    const legacySelected = binding?.selectedFieldsBySource?.[id]
    enabledBySource[id] = Array.isArray(legacySelected) ? legacySelected.filter(Boolean) : []
  }
  return { sourceIds: ids, enabledBySource }
}

type SavedLayer = { id: string; name: string; fields: string[] }
const DB_NAME = 'GisMapStore'
const STORE_NAME = 'layers'

const initDB = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

const loadSavedLayers = async (): Promise<any[]> => {
  try {
    const db = await initDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get('savedLayers')
    return await new Promise<any[]>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = reject
    })
  } catch {
    return []
  }
}

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

const getLayerFields = (layer: any): string[] => {
  const fromArc: string[] = Array.isArray(layer?.arcgisLayerDefinition?.fields)
    ? (layer.arcgisLayerDefinition.fields as any[]).map((f: any) => String(f?.name || '')).filter(Boolean)
    : []
  if (fromArc.length) return Array.from(new Set(fromArc)).sort((a: string, b: string) => a.localeCompare(b))
  return getGeoJsonFields(layer?.data)
}

const normalizeFieldConfigs = (binding: FormBinding | undefined, sourceId: string): FieldConfig[] => {
  const raw = binding?.fieldConfigsBySource?.[sourceId]
  if (Array.isArray(raw)) {
    return raw
      .filter(c => c && typeof (c as any).name === 'string')
      .map((c) => ({
        name: String((c as any).name),
        enabled: Boolean((c as any).enabled),
        required: Boolean((c as any).required),
      }))
      .filter(c => c.name && c.enabled)
  }
  const legacy = binding?.selectedFieldsBySource?.[sourceId]
  if (Array.isArray(legacy)) return legacy.filter(Boolean).map(name => ({ name, enabled: true, required: false }))
  return []
}

const moveItem = <T,>(arr: T[], from: number, to: number): T[] => {
  if (from === to) return arr
  const next = arr.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

const getLayerGroupKey = (id: string) => {
  const trimmed = String(id || '').trim()
  const prefix = trimmed.includes(':') ? trimmed.slice(0, trimmed.indexOf(':')).toLowerCase() : ''
  if (prefix) return prefix
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return 'url'
  return 'custom'
}

const groupLabel: Record<string, string> = {
  arcgis: 'ArcGIS',
  geojson: 'GeoJSON',
  url: 'URL',
  custom: 'Custom',
}

function IndeterminateCheckbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
}: {
  checked: boolean
  indeterminate: boolean
  onChange: () => void
  ariaLabel: string
}) {
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked
  }, [indeterminate, checked])
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={ariaLabel} />
}

export function AdvancedLayerMultiSelect({
  layers,
  selectedIds,
  onToggle,
  onSelectMany,
  onClearMany,
  search,
  onSearchChange,
}: {
  layers: SavedLayer[]
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onSelectMany: (ids: string[]) => void
  onClearMany: (ids: string[]) => void
  search: string
  onSearchChange: (value: string) => void
}) {
  const [view, setView] = useState<'list' | 'grid' | 'tree'>('grid')
  const [typeFilter, setTypeFilter] = useState<'all' | 'arcgis' | 'geojson' | 'url' | 'custom'>('all')
  const [showSelectedOnly, setShowSelectedOnly] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [scrollTop, setScrollTop] = useState(0)
  const listViewportRef = useRef<HTMLDivElement | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return layers
      .filter(l => {
        if (typeFilter !== 'all' && getLayerGroupKey(l.id) !== typeFilter) return false
        if (showSelectedOnly && !selectedIds.has(l.id)) return false
        if (!q) return true
        return l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q)
      })
      .slice()
  }, [layers, search, typeFilter, showSelectedOnly, selectedIds])

  const selectedInFiltered = useMemo(() => filtered.filter(l => selectedIds.has(l.id)).length, [filtered, selectedIds])
  const allFilteredIds = useMemo(() => filtered.map(l => l.id), [filtered])

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault()
      onSelectMany(allFilteredIds)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onClearMany(allFilteredIds)
    }
  }

  const rowHeight = 34
  const viewportHeight = 260
  const overscan = 10
  const total = filtered.length
  const startIndex = view === 'list' ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscan) : 0
  const endIndex = view === 'list' ? Math.min(total, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan) : total
  const visible = view === 'list' ? filtered.slice(startIndex, endIndex) : filtered
  const padTop = view === 'list' ? startIndex * rowHeight : 0
  const padBottom = view === 'list' ? Math.max(0, (total - endIndex) * rowHeight) : 0

  const grouped = useMemo(() => {
    const map = new Map<string, SavedLayer[]>()
    for (const l of filtered) {
      const k = getLayerGroupKey(l.id)
      const arr = map.get(k) ?? []
      arr.push(l)
      map.set(k, arr)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  return (
    <div onKeyDown={handleKeyDown}>
      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setView('grid')}
            style={{
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              background: view === 'grid' ? '#e2e8f0' : '#ffffff',
              cursor: 'pointer',
              fontWeight: 800,
              fontSize: 12,
            }}
            aria-label="Grid view"
          >
            Grid
          </button>

          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as any)}
            style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#ffffff', fontWeight: 800, fontSize: 12 }}
            aria-label="Layer type filter"
          >
            <option value="all">All</option>
            <option value="arcgis">ArcGIS</option>
            <option value="geojson">GeoJSON</option>
            <option value="url">URL</option>
            <option value="custom">Custom</option>
          </select>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#334155', fontWeight: 800 }}>
            <input type="checkbox" checked={showSelectedOnly} onChange={() => setShowSelectedOnly(v => !v)} aria-label="Show selected only" />
            Selected only
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 800 }}>
            {selectedInFiltered}/{filtered.length} selected
          </div>
          <button
            type="button"
            onClick={() => onSelectMany(allFilteredIds)}
            disabled={filtered.length === 0}
            style={{
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              cursor: filtered.length ? 'pointer' : 'not-allowed',
              fontWeight: 900,
              fontSize: 12,
            }}
            aria-label="Select all filtered"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => onClearMany(allFilteredIds)}
            disabled={selectedInFiltered === 0}
            style={{
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              cursor: selectedInFiltered ? 'pointer' : 'not-allowed',
              fontWeight: 900,
              fontSize: 12,
            }}
            aria-label="Clear all filtered"
          >
            Clear
          </button>
        </div>
      </div>

      <input
        value={search}
        onChange={e => onSearchChange(e.target.value)}
        placeholder="Search layers…"
        style={{ width: '100%', marginTop: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid #e2e8f0' }}
        aria-label="Search available layers"
      />

      {view === 'tree' ? (
        <div style={{ marginTop: 10, display: 'grid', gap: 10, maxHeight: viewportHeight, overflow: 'auto', paddingRight: 6 }}>
          {grouped.length ? (
            grouped.map(([k, items]) => {
              const label = groupLabel[k] ?? k
              const totalCount = items.length
              const selectedCount = items.filter(l => selectedIds.has(l.id)).length
              const allChecked = totalCount > 0 && selectedCount === totalCount
              const indeterminate = selectedCount > 0 && selectedCount < totalCount
              const expanded = expandedGroups[k] ?? true
              return (
                <div key={k} style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#ffffff', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 10px', background: '#f8fafc' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <IndeterminateCheckbox
                        checked={allChecked}
                        indeterminate={indeterminate}
                        onChange={() => {
                          const ids = items.map(i => i.id)
                          if (allChecked) onClearMany(ids)
                          else onSelectMany(ids)
                        }}
                        ariaLabel={`Select group ${label}`}
                      />
                      <button
                        type="button"
                        onClick={() => setExpandedGroups(prev => ({ ...prev, [k]: !(prev[k] ?? true) }))}
                        style={{ border: '1px solid #e2e8f0', background: '#ffffff', borderRadius: 10, padding: '6px 10px', cursor: 'pointer', fontWeight: 900, fontSize: 12 }}
                        aria-label={`Toggle group ${label}`}
                      >
                        {expanded ? '▾' : '▸'} {label} <span style={{ color: '#64748b', fontWeight: 800 }}>({selectedCount}/{totalCount})</span>
                      </button>
                    </div>
                  </div>
                  {!expanded ? null : (
                    <div style={{ padding: 10, display: 'grid', gap: 6 }}>
                      {items.map(l => {
                        const checked = selectedIds.has(l.id)
                        return (
                          <label key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#334155' }}>
                            <input type="checkbox" checked={checked} onChange={() => onToggle(l.id)} aria-label={`Toggle ${l.name}`} />
                            <span style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {l.name}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          ) : (
            <div style={{ fontSize: 12, color: '#64748b' }}>No layers found.</div>
          )}
        </div>
      ) : view === 'grid' ? (
        <div style={{ marginTop: 10, display: 'grid', gap: 10, maxHeight: viewportHeight, overflow: 'auto', paddingRight: 6, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {filtered.length ? (
            filtered.map(l => {
              const checked = selectedIds.has(l.id)
              return (
                <label
                  key={l.id}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 12,
                    padding: 10,
                    background: checked ? '#f0f9ff' : '#ffffff',
                    display: 'grid',
                    gridTemplateColumns: '18px 1fr',
                    gap: 10,
                    alignItems: 'start',
                    cursor: 'pointer',
                  }}
                >
                  <input type="checkbox" checked={checked} onChange={() => onToggle(l.id)} aria-label={`Toggle ${l.name}`} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                    <div style={{ marginTop: 6, fontSize: 11, color: '#64748b', fontWeight: 700 }}>{l.fields.length ? `${l.fields.length} fields` : 'Fields: unknown'}</div>
                  </div>
                </label>
              )
            })
          ) : (
            <div style={{ fontSize: 12, color: '#64748b' }}>No layers found.</div>
          )}
        </div>
      ) : (
        <div
          ref={listViewportRef}
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
          style={{ marginTop: 10, display: 'grid', gap: 6, height: viewportHeight, overflow: 'auto', paddingRight: 6 }}
          role="listbox"
          aria-multiselectable="true"
          aria-label="Available layers"
          tabIndex={0}
        >
          <div style={{ paddingTop: padTop, paddingBottom: padBottom, display: 'grid', gap: 6 }}>
            {total ? (
              visible.map(l => {
                const checked = selectedIds.has(l.id)
                return (
                  <label key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#334155', height: rowHeight }}>
                    <input type="checkbox" checked={checked} onChange={() => onToggle(l.id)} aria-label={`Toggle ${l.name}`} />
                    <span style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.name}
                    </span>
                  </label>
                )
              })
            ) : (
              <div style={{ fontSize: 12, color: '#64748b' }}>No layers found.</div>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 11, color: '#64748b', fontWeight: 700 }}>
        Shortcuts: Ctrl/Cmd+A select all filtered • Esc clear filtered
      </div>
    </div>
  )
}

export function DataSourceFieldsPanel({ formKey, mode, onChange, externalValuesBySource, externalApplyKey, testOverrides }: Props) {
  const [isOpen, setIsOpen] = useState(mode !== 'fill')
  const [draftSourceIds, setDraftSourceIds] = useState<string[]>([])
  const [draftFieldConfigsBySource, setDraftFieldConfigsBySource] = useState<Record<string, FieldConfig[]>>({})
  const [savedLayers, setSavedLayers] = useState<SavedLayer[]>([])
  const [savedLayersLoading, setSavedLayersLoading] = useState(false)
  const [savedLayersError, setSavedLayersError] = useState<string | null>(null)
  const [savedLayerDomainsById, setSavedLayerDomainsById] = useState<Record<string, Record<string, Array<{ code: string; name: string }>>>>({})
  const [layerSearch, setLayerSearch] = useState('')
  const [fieldSearchBySource, setFieldSearchBySource] = useState<Record<string, string>>({})
  const [selectedDragFromIndex, setSelectedDragFromIndex] = useState<number | null>(null)
  const [selectedDragOverIndex, setSelectedDragOverIndex] = useState<number | null>(null)

  const bindings = useMemo(() => readJson<FormBindings>(STORAGE_KEY, {}), [formKey])
  const enabledInfo = useMemo(() => normalizeEnabledBySource(bindings[formKey]), [bindings, formKey])
  const mgmtBinding = useMemo(() => bindings[formKey]?.managementLayer, [bindings, formKey])
  const binding = useMemo(() => bindings[formKey], [bindings, formKey])
  const layerFieldsById = useMemo(() => readJson<Record<string, any[]>>(GIS_CONTENT_FIELDS_KEY, {}), [mode, formKey])

  const [valuesBySource, setValuesBySource] = useState<Record<string, Record<string, string>>>({})
  const lastExternalApplyKeyRef = useRef<string | number | null>(null)
  const ecTimeAutoFilledRef = useRef<Record<string, boolean>>({})

  const getRealSourceId = (sourceId: string) => (sourceId.startsWith('management:') ? sourceId.slice('management:'.length) : sourceId)
  const setFieldSearchForSource = (sourceId: string, value: string) => {
    const id = String(sourceId ?? '')
    setFieldSearchBySource(prev => ({ ...prev, [id]: value }))
  }
  const clearFieldSearchForSource = (sourceId: string) => {
    const id = String(sourceId ?? '')
    setFieldSearchBySource(prev => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }
  const layerNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const l of savedLayers) {
      map.set(String(l.id), String(l.name))
    }
    return map
  }, [savedLayers])
  const getLayerDisplayName = (sourceId: string) => {
    const real = String(getRealSourceId(sourceId) ?? '')
    const candidates: string[] = [real]
    const lower = real.toLowerCase()
    const normalizeArcUrl = (value: string) =>
      String(value ?? '')
        .trim()
        .replace(/^arcgis:/i, '')
        .replace(/[?#].*$/, '')
        .replace(/\/+$/, '')
        .toLowerCase()
    const agroStructures21Url =
      'https://services1.arcgis.com/jz3ndhbYv5k9nwi8/arcgis/rest/services/agro_structures/featureserver/21'

    if (lower.startsWith('arcgis:')) candidates.push(real.slice('arcgis:'.length))
    if (lower.startsWith('geojson:')) candidates.push(real.slice('geojson:'.length))
    if (lower.startsWith('url:')) candidates.push(real.slice('url:'.length))

    if (/^https?:\/\//i.test(real)) {
      candidates.push(`arcgis:${real}`)
      candidates.push(`url:${real}`)
      candidates.push(`geojson:${real}`)
    }

    for (const id of candidates) {
      if (normalizeArcUrl(id) === agroStructures21Url) return 'Agro_Structures'
      const name = layerNameById.get(id)
      if (name && name.trim()) return name
    }
    return sourceId
  }
  const getFieldType = (sourceId: string, fieldName: string): 'text' | 'number' | 'date' | 'boolean' => {
    const realId = getRealSourceId(sourceId)
    const list = Array.isArray(layerFieldsById[realId]) ? (layerFieldsById[realId] as any[]) : []
    const found = list.find(f => String((f as any)?.name ?? '') === fieldName)
    const t = String((found as any)?.type ?? '').toLowerCase()
    if (t === 'date') return 'date'
    if (t === 'number') return 'number'
    if (t === 'boolean') return 'boolean'
    return 'text'
  }

  const FARM_AUTO_FIELDS = useMemo(
    () => new Set(['Farm_Name', 'ZONE_ID', 'Area_ha', 'Structure_Type', 'Country', 'ProjectCode', 'Project_Code']),
    []
  )

  const farmUiTimersRef = useRef<Record<string, number>>({})
  const farmHideTimersRef = useRef<Record<string, number>>({})
  const farmSuggestSeqRef = useRef<Record<string, number>>({})
  const farmLoadSeqRef = useRef<Record<string, number>>({})
  const farmCacheRef = useRef<Map<string, any>>(new Map())
  const farmSuggestCacheRef = useRef<Map<string, Array<{ code: string; name: string }>>>(new Map())
  const [farmUiBySource, setFarmUiBySource] = useState<
    Record<
      string,
      { open: boolean; loading: boolean; error: string | null; suggestions: Array<{ code: string; name: string }> }
    >
  >({})

  const normalizeFarmToken = (s: string) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const escapeWhereText = (s: string) => String(s ?? '').replace(/[%_]/g, '').replace(/'/g, "''")

  type ValveOption = { valveNo: string; objectId: string }
  const valveUiTimersRef = useRef<Record<string, number>>({})
  const valveHideTimersRef = useRef<Record<string, number>>({})
  const valveSuggestSeqRef = useRef<Record<string, number>>({})
  const valveLoadSeqRef = useRef<Record<string, number>>({})
  const valveAllCacheRef = useRef<Map<string, ValveOption[]>>(new Map())
  const [valveUiBySource, setValveUiBySource] = useState<
    Record<string, { open: boolean; browseOpen: boolean; loading: boolean; error: string | null; suggestions: ValveOption[]; browseQuery: string; sortDir: 'asc' | 'desc' }>
  >({})

  useEffect(() => {
    return () => {
      for (const id of Object.values(farmUiTimersRef.current)) clearTimeout(id)
      for (const id of Object.values(farmHideTimersRef.current)) clearTimeout(id)
      for (const id of Object.values(valveUiTimersRef.current)) clearTimeout(id)
      for (const id of Object.values(valveHideTimersRef.current)) clearTimeout(id)
      farmUiTimersRef.current = {}
      farmHideTimersRef.current = {}
      valveUiTimersRef.current = {}
      valveHideTimersRef.current = {}
      farmSuggestSeqRef.current = {}
      farmLoadSeqRef.current = {}
      valveSuggestSeqRef.current = {}
      valveLoadSeqRef.current = {}
    }
  }, [])

  const normalizeValveToken = (s: string) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const compareValveNo = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

  const setValveUi = (
    sourceId: string,
    patch: Partial<{ open: boolean; browseOpen: boolean; loading: boolean; error: string | null; suggestions: ValveOption[]; browseQuery: string; sortDir: 'asc' | 'desc' }>,
  ) => {
    setValveUiBySource(prev => {
      const cur = prev[sourceId] ?? { open: false, browseOpen: false, loading: false, error: null, suggestions: [], browseQuery: '', sortDir: 'asc' as const }
      return { ...prev, [sourceId]: { ...cur, ...patch } }
    })
  }

  const isIrrigationSystemValve = (sourceId: string) => {
    const display = String(getLayerDisplayName(sourceId) ?? '').toLowerCase()
    const sid = String(sourceId ?? '').toLowerCase()
    const real = String(getRealSourceId(sourceId) ?? '').toLowerCase()
    const url = String(getArcgisLayerUrl(real) ?? '').toLowerCase()
    const sig = [display, sid, real, url].join(' ')
    return sig.includes('irrigation_system_valve') || sig.includes('irrigation system valve')
  }

  const getArcgisLayerUrl = (sourceId: string) => {
    const raw = String(sourceId ?? '')
    const id = raw.startsWith('arcgis:') ? raw.slice('arcgis:'.length) : raw
    if (!/^https?:\/\//i.test(id)) return null
    return id
  }

  const isAgroStructures21 = (sourceId: string) => {
    const url = getArcgisLayerUrl(sourceId)
    return Boolean(url && /\/FeatureServer\/21\/?$/i.test(url))
  }

  const arcFetchJson = async (url: string) => {
    const data = testOverrides?.fetchJson
      ? await testOverrides.fetchJson(url)
      : await (async () => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.json()
      })()
    const err = (data as any)?.error
    if (err) throw new Error(String(err?.message ?? 'ArcGIS query failed'))
    return data as any
  }

  const arcQuery = async (layerUrl: string, params: Record<string, string>) => {
    const qs = new URLSearchParams({ f: 'json', ...params })
    return arcFetchJson(`${layerUrl.replace(/\/+$/, '')}/query?${qs.toString()}`)
  }

  const fetchAllValveOptions = async (sourceId: string): Promise<ValveOption[]> => {
    const layerUrl = getArcgisLayerUrl(sourceId)
    if (!layerUrl) return []
    const cacheKey = `${layerUrl}|allValves|Valve_No`
    const cached = valveAllCacheRef.current.get(cacheKey)
    if (cached) return cached

    const out: ValveOption[] = []
    const pageSize = 2000
    let offset = 0
    let guard = 0
    while (guard < 50) {
      guard += 1
      const data = await arcQuery(layerUrl, {
        where: '1=1',
        outFields: 'Valve_No,OBJECTID',
        returnGeometry: 'false',
        orderByFields: 'Valve_No',
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
      })
      const feats = Array.isArray((data as any)?.features) ? ((data as any).features as any[]) : []
      if (!feats.length) break
      for (const f of feats) {
        const attrs = f?.attributes ?? {}
        const valveNo = String(attrs?.Valve_No ?? '').trim()
        const objectId = String(attrs?.OBJECTID ?? '').trim()
        if (!valveNo) continue
        out.push({ valveNo, objectId })
      }
      if (feats.length < pageSize) break
      offset += pageSize
    }

    const seen = new Set<string>()
    const unique = out.filter(v => {
      if (seen.has(v.valveNo)) return false
      seen.add(v.valveNo)
      return true
    })
    unique.sort((a, b) => compareValveNo(a.valveNo, b.valveNo))
    valveAllCacheRef.current.set(cacheKey, unique)
    return unique
  }

  const computeValveSuggestions = (all: ValveOption[], term: string) => {
    const t = normalizeValveToken(term)
    if (!t) return all.slice(0, 20)
    const scored = all
      .map((v) => {
        const c = normalizeValveToken(v.valveNo)
        let score = 0
        if (c === t) score = 1000
        else if (c.startsWith(t)) score = 900
        else if (c.includes(t)) score = 800
        return { v, score }
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || compareValveNo(a.v.valveNo, b.v.valveNo))
      .slice(0, 20)
      .map(x => x.v)
    return scored
  }

  const ensureValveOptionsLoaded = async (sourceId: string) => {
    const layerUrl = getArcgisLayerUrl(sourceId)
    if (!layerUrl) return
    const cacheKey = `${layerUrl}|allValves|Valve_No`
    if (valveAllCacheRef.current.get(cacheKey)) return

    const seq = (valveLoadSeqRef.current[sourceId] ?? 0) + 1
    valveLoadSeqRef.current[sourceId] = seq
    setValveUi(sourceId, { loading: true, error: null })
    try {
      await fetchAllValveOptions(sourceId)
      if (valveLoadSeqRef.current[sourceId] !== seq) return
      setValveUi(sourceId, { loading: false, error: null })
    } catch (e) {
      if (valveLoadSeqRef.current[sourceId] !== seq) return
      setValveUi(sourceId, { loading: false, error: e instanceof Error ? e.message : 'Failed to load Valve_No list.' })
    }
  }

  const queueValveSuggestions = (sourceId: string, term: string) => {
    const q = term.trim()
    const layerUrl = getArcgisLayerUrl(sourceId)
    if (!layerUrl) return
    const cacheKey = `${layerUrl}|allValves|Valve_No`
    const cached = valveAllCacheRef.current.get(cacheKey)
    if (cached) {
      setValveUi(sourceId, { suggestions: computeValveSuggestions(cached, q), loading: false, error: null, open: true })
      return
    }

    const nextSeq = (valveSuggestSeqRef.current[sourceId] ?? 0) + 1
    valveSuggestSeqRef.current[sourceId] = nextSeq
    const prevTimer = valveUiTimersRef.current[sourceId]
    if (prevTimer) window.clearTimeout(prevTimer)

    if (q.length < 1) {
      setValveUi(sourceId, { suggestions: [], loading: false, error: null })
      return
    }

    valveUiTimersRef.current[sourceId] = window.setTimeout(() => {
      setValveUi(sourceId, { loading: true, error: null, open: true })
      arcQuery(layerUrl, {
        where: `Valve_No LIKE '%${escapeWhereText(q)}%'`,
        outFields: 'Valve_No,OBJECTID',
        returnGeometry: 'false',
        resultRecordCount: '20',
        orderByFields: 'Valve_No',
      })
        .then((data) => {
          if (valveSuggestSeqRef.current[sourceId] !== nextSeq) return
          const feats = Array.isArray((data as any)?.features) ? ((data as any).features as any[]) : []
          const list = feats
            .map(f => ({ valveNo: String(f?.attributes?.Valve_No ?? '').trim(), objectId: String(f?.attributes?.OBJECTID ?? '').trim() }))
            .filter(v => v.valveNo)
          list.sort((a, b) => compareValveNo(a.valveNo, b.valveNo))
          setValveUi(sourceId, { suggestions: list, loading: false, open: true })
        })
        .catch((e) => {
          if (valveSuggestSeqRef.current[sourceId] !== nextSeq) return
          setValveUi(sourceId, { suggestions: [], loading: false, error: e instanceof Error ? e.message : 'Failed to query valves.', open: true })
        })
    }, 200)
  }

  const computeLonLatCenter = (geom: any): { lon: number; lat: number } | null => {
    const rings = Array.isArray(geom?.rings) ? (geom.rings as any[]) : null
    if (!rings || rings.length === 0) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const ring of rings) {
      const pts = Array.isArray(ring) ? ring : []
      for (const pt of pts) {
        const x = Array.isArray(pt) ? Number(pt[0]) : NaN
        const y = Array.isArray(pt) ? Number(pt[1]) : NaN
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null
    return { lon: (minX + maxX) / 2, lat: (minY + maxY) / 2 }
  }

  const formatYmd = (v: any) => {
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n)) return ''
    const d = new Date(n)
    if (Number.isNaN(d.getTime())) return ''
    return d.toISOString().slice(0, 10)
  }

  const setFarmUi = (
    sourceId: string,
    patch: Partial<{ open: boolean; loading: boolean; error: string | null; suggestions: Array<{ code: string; name: string }> }>
  ) => {
    setFarmUiBySource(prev => {
      const cur = prev[sourceId] ?? { open: false, loading: false, error: null, suggestions: [] }
      return { ...prev, [sourceId]: { ...cur, ...patch } }
    })
  }

  const fetchFarmSuggestions = async (sourceId: string, term: string) => {
    const layerUrl = getArcgisLayerUrl(sourceId)
    if (!layerUrl) return []
    const q = term.trim()
    if (q.length < 2) return []
    const cacheKey = `${layerUrl}|suggest|${normalizeFarmToken(q)}`
    const cached = farmSuggestCacheRef.current.get(cacheKey)
    if (cached) return cached

    const safe = escapeWhereText(q)
    const data = await arcQuery(layerUrl, {
      where: `Farm_Code LIKE '%${safe}%'`,
      outFields: 'Farm_Code,Farm_Name',
      returnGeometry: 'false',
      resultRecordCount: '20',
      orderByFields: 'Farm_Code',
    })
    const feats = Array.isArray((data as any)?.features) ? ((data as any).features as any[]) : []
    const list = feats
      .map(f => ({
        code: String(f?.attributes?.Farm_Code ?? '').trim(),
        name: String(f?.attributes?.Farm_Name ?? '').trim(),
      }))
      .filter(v => v.code)

    farmSuggestCacheRef.current.set(cacheKey, list)
    return list
  }

  const loadFarmFeatureByCode = async (sourceId: string, farmCode: string) => {
    const layerUrl = getArcgisLayerUrl(sourceId)
    if (!layerUrl) return null
    const code = farmCode.trim()
    if (!code) return null
    const cacheKey = `${layerUrl}|farm|${normalizeFarmToken(code)}`
    const cached = farmCacheRef.current.get(cacheKey)
    if (cached) return cached

    const safe = escapeWhereText(code)
    const data = await arcQuery(layerUrl, {
      where: `Farm_Code='${safe}'`,
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      resultRecordCount: '1',
    })
    const feats = Array.isArray((data as any)?.features) ? ((data as any).features as any[]) : []
    const first = feats[0] ?? null
    if (first) farmCacheRef.current.set(cacheKey, first)
    return first
  }

  useEffect(() => {
    if (mode === 'fill') {
      const sources: string[] = []
      const selectedFieldsBySource: Record<string, string[]> = {}
      if (mgmtBinding?.sourceId && Array.isArray(mgmtBinding.selectedFields) && mgmtBinding.selectedFields.length) {
        const mgmtKey = `management:${mgmtBinding.sourceId}`
        sources.push(mgmtKey)
        selectedFieldsBySource[mgmtKey] = mgmtBinding.selectedFields.filter(Boolean)
      }
      for (const sourceId of enabledInfo.sourceIds) {
        sources.push(sourceId)
        selectedFieldsBySource[sourceId] = enabledInfo.enabledBySource[sourceId] ?? []
      }

      const nextValues: Record<string, Record<string, string>> = {}
      for (const sourceId of sources) {
        nextValues[sourceId] = valuesBySource[sourceId] ?? {}
      }
      setValuesBySource(nextValues)
      onChange?.({ sourceIds: sources, selectedFieldsBySource, valuesBySource: nextValues })
    } else {
      const ids = enabledInfo.sourceIds.slice()
      setDraftSourceIds(ids)
      const nextConfigs: Record<string, FieldConfig[]> = {}
      for (const id of ids) {
        nextConfigs[id] = normalizeFieldConfigs(binding, id)
      }
      setDraftFieldConfigsBySource(nextConfigs)
    }
  }, [mode, formKey, binding])

  useEffect(() => {
    if (mode !== 'settings' || !isOpen) return
    let cancelled = false
    setSavedLayersLoading(true)
    setSavedLayersError(null)
    ;(testOverrides?.loadSavedLayers ?? loadSavedLayers)().then((layers) => {
      if (cancelled) return
      const gisContentFields = readJson<Record<string, any[]>>(GIS_CONTENT_FIELDS_KEY, {})
      const list: SavedLayer[] = (Array.isArray(layers) ? layers : []).map((l: any) => {
        const id = String(l?.id ?? '')
        const name = String(l?.name ?? id)
        const fromGisContent = Array.isArray(gisContentFields[id]) ? gisContentFields[id] : []
        const fieldsFromGisContent = fromGisContent.map((f: any) => String(f?.name || '')).filter(Boolean)
        const fields = fieldsFromGisContent.length ? Array.from(new Set(fieldsFromGisContent)).sort((a: string, b: string) => a.localeCompare(b)) : getLayerFields(l)
        return { id, name, fields }
      }).filter(l => l.id)
      setSavedLayers(list.sort((a, b) => a.name.localeCompare(b.name)))

      const domains: Record<string, Record<string, Array<{ code: string; name: string }>>> = {}
      for (const l of Array.isArray(layers) ? layers : []) {
        const id = String((l as any)?.id ?? '')
        if (!id) continue
        const fields = Array.isArray((l as any)?.arcgisLayerDefinition?.fields) ? ((l as any).arcgisLayerDefinition.fields as any[]) : []
        const map: Record<string, Array<{ code: string; name: string }>> = {}
        for (const f of fields) {
          const name = String(f?.name ?? '')
          const coded = Array.isArray(f?.domain?.codedValues) ? (f.domain.codedValues as any[]) : []
          if (!name || coded.length === 0) continue
          map[name] = coded
            .map(v => ({ code: String(v?.code ?? ''), name: String(v?.name ?? v?.code ?? '') }))
            .filter(v => v.code)
        }
        if (Object.keys(map).length) domains[id] = map
      }
      setSavedLayerDomainsById(domains)
      setSavedLayersLoading(false)
    }).catch((e) => {
      if (cancelled) return
      setSavedLayers([])
      setSavedLayerDomainsById({})
      setSavedLayersLoading(false)
      setSavedLayersError(e instanceof Error ? e.message : 'Failed to load saved layers')
    })
    return () => {
      cancelled = true
    }
  }, [mode, isOpen])

  useEffect(() => {
    if (mode !== 'fill') return
    let cancelled = false
    ;(testOverrides?.loadSavedLayers ?? loadSavedLayers)().then((layers) => {
      if (cancelled) return
      const gisContentFields = readJson<Record<string, any[]>>(GIS_CONTENT_FIELDS_KEY, {})
      const list: SavedLayer[] = (Array.isArray(layers) ? layers : []).map((l: any) => {
        const id = String(l?.id ?? '')
        const name = String(l?.name ?? id)
        const fromGisContent = Array.isArray(gisContentFields[id]) ? gisContentFields[id] : []
        const fieldsFromGisContent = fromGisContent.map((f: any) => String(f?.name || '')).filter(Boolean)
        const fields = fieldsFromGisContent.length ? Array.from(new Set(fieldsFromGisContent)).sort((a: string, b: string) => a.localeCompare(b)) : getLayerFields(l)
        return { id, name, fields }
      }).filter(l => l.id)
      setSavedLayers(list.sort((a, b) => a.name.localeCompare(b.name)))

      const domains: Record<string, Record<string, Array<{ code: string; name: string }>>> = {}
      for (const l of Array.isArray(layers) ? layers : []) {
        const id = String((l as any)?.id ?? '')
        if (!id) continue
        const fields = Array.isArray((l as any)?.arcgisLayerDefinition?.fields) ? ((l as any).arcgisLayerDefinition.fields as any[]) : []
        const map: Record<string, Array<{ code: string; name: string }>> = {}
        for (const f of fields) {
          const name = String(f?.name ?? '')
          const coded = Array.isArray(f?.domain?.codedValues) ? (f.domain.codedValues as any[]) : []
          if (!name || coded.length === 0) continue
          map[name] = coded
            .map(v => ({ code: String(v?.code ?? ''), name: String(v?.name ?? v?.code ?? '') }))
            .filter(v => v.code)
        }
        if (Object.keys(map).length) domains[id] = map
      }
      setSavedLayerDomainsById(domains)
    })
    return () => {
      cancelled = true
    }
  }, [mode])

  const saveSettings = () => {
    const sourceIds = draftSourceIds.map(v => v.trim()).filter(Boolean)
    const fieldConfigsBySource: Record<string, FieldConfig[]> = {}
    const selectedFieldsBySource: Record<string, string[]> = {}
    for (const id of sourceIds) {
      const configs = Array.isArray(draftFieldConfigsBySource[id]) ? draftFieldConfigsBySource[id] : []
      const normalized = configs
        .filter(c => c && typeof c.name === 'string')
        .map(c => ({ name: c.name.trim(), enabled: true, required: Boolean(c.required) }))
        .filter(c => c.name)
      selectedFieldsBySource[id] = normalized.map(c => c.name)
      fieldConfigsBySource[id] = normalized
    }
    const nextBindings: FormBindings = { ...bindings }
    nextBindings[formKey] = { sourceIds, selectedFieldsBySource, fieldConfigsBySource, managementLayer: bindings[formKey]?.managementLayer }
    writeJson(STORAGE_KEY, nextBindings)
    setIsOpen(false)
  }

  if (mode === 'settings') {
    const selectedIds = new Set(draftSourceIds)
    return (
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, background: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontWeight: 700, color: '#0f172a' }}>Data Source Fields</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              id="open-fields-btn"
              type="button"
              onClick={() => setIsOpen(v => !v)}
              style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer' }}
            >
              {isOpen ? 'Close' : 'Configure'}
            </button>
            <button
              type="button"
              onClick={saveSettings}
              disabled={!draftSourceIds.some(v => v.trim())}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid #0ea5e9',
                background: '#0ea5e9',
                color: 'white',
                cursor: draftSourceIds.some(v => v.trim()) ? 'pointer' : 'not-allowed',
                fontWeight: 600,
              }}
            >
              Save
            </button>
          </div>
        </div>

        {!isOpen ? null : (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, background: '#ffffff' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: '#0f172a' }}>Data Source</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>Multi Layer then choose fields</div>
              </div>

              <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                {savedLayersLoading ? (
                  <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>Loading saved layers…</div>
                ) : savedLayersError ? (
                  <div style={{ fontSize: 12, color: '#b91c1c', fontWeight: 700, background: '#fef2f2', border: '1px solid #fecaca', padding: '8px 10px', borderRadius: 12 }}>
                    {savedLayersError}
                  </div>
                ) : null}

                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a' }}>Layer</div>
                  <AdvancedLayerMultiSelect
                    layers={savedLayers}
                    selectedIds={selectedIds}
                    onToggle={(id) => {
                      const nextId = String(id)
                      const removing = selectedIds.has(nextId)
                      setDraftSourceIds((prev) => (prev.includes(nextId) ? prev.filter((x) => x !== nextId) : [...prev, nextId]))
                      if (removing) clearFieldSearchForSource(nextId)
                      setDraftFieldConfigsBySource((prev) => {
                        const next = { ...prev }
                        if (removing) {
                          delete next[nextId]
                          return next
                        }
                        next[nextId] = next[nextId] ?? normalizeFieldConfigs(binding, nextId)
                        return next
                      })
                    }}
                    onSelectMany={(ids) => {
                      const list = ids.map(String)
                      setDraftSourceIds((prev) => Array.from(new Set([...prev, ...list])))
                      setDraftFieldConfigsBySource((prev) => {
                        const next = { ...prev }
                        for (const id of list) {
                          next[id] = next[id] ?? normalizeFieldConfigs(binding, id)
                        }
                        return next
                      })
                    }}
                    onClearMany={(ids) => {
                      const set = new Set(ids.map(String))
                      setDraftSourceIds((prev) => prev.filter((id) => !set.has(id)))
                      for (const id of set) clearFieldSearchForSource(id)
                      setDraftFieldConfigsBySource((prev) => {
                        const next = { ...prev }
                        for (const id of set) delete next[id]
                        return next
                      })
                    }}
                    search={layerSearch}
                    onSearchChange={(value) => setLayerSearch(value)}
                  />
                </div>
              </div>
            </div>

            {draftSourceIds.map((id, index) => {
              const key = `${index}-${id}`
              const layerName = savedLayers.find(l => l.id === id)?.name ?? 'Layer'
              const availableFieldsRaw = savedLayers.find(l => l.id === id)?.fields ?? []
              const availableFields = Array.isArray(availableFieldsRaw)
                ? (availableFieldsRaw as any[]).map(v => String(v ?? '').trim()).filter(Boolean)
                : []
              const selectedConfigs = Array.isArray(draftFieldConfigsBySource[id]) ? draftFieldConfigsBySource[id] : []
              if (!availableFields.length && !selectedConfigs.length) return null
              const selectedSet = new Set(selectedConfigs.map(c => c.name))
              const fieldSearch = fieldSearchBySource[id] ?? ''
              const filteredFields = (() => {
                const q = fieldSearch.trim().toLowerCase()
                if (!q) return availableFields
                return availableFields.filter(f => f.toLowerCase().includes(q))
              })()
              return (
                <div key={key} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, background: '#ffffff' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: '#0f172a' }}>
                      {layerName}
                    </div>
                  </div>

                  <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 12, background: '#f8fafc' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: '#0f172a' }}>Select Fields</div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#64748b' }}>
                          {selectedConfigs.length}/{availableFields.length}
                        </div>
                      </div>

                      <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
                        <input
                          value={fieldSearch}
                          onChange={e => setFieldSearchForSource(id, e.target.value)}
                          placeholder="Search fields…"
                          style={{ flex: 1, padding: '10px 12px', borderRadius: 12, border: '1px solid #e2e8f0', background: '#ffffff' }}
                          aria-label={`${layerName}:Search fields`}
                        />
                        <button
                          type="button"
                          onClick={() => clearFieldSearchForSource(id)}
                          disabled={!fieldSearch.trim()}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 12,
                            border: '1px solid #e2e8f0',
                            background: '#ffffff',
                            cursor: fieldSearch.trim() ? 'pointer' : 'not-allowed',
                            fontWeight: 800,
                            fontSize: 12,
                            color: '#334155',
                          }}
                        >
                          Clear
                        </button>
                      </div>

                      <div style={{ marginTop: 10, display: 'grid', gap: 6, maxHeight: 320, overflow: 'auto', paddingRight: 6 }}>
                        {filteredFields.length ? (
                          filteredFields.map((f) => {
                            const checked = selectedSet.has(f)
                            return (
                              <label
                                key={f}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 10,
                                  padding: '8px 10px',
                                  borderRadius: 12,
                                  border: '1px solid #e2e8f0',
                                  background: checked ? '#ffffff' : '#ffffff',
                                  fontSize: 12,
                                  color: '#334155',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setDraftFieldConfigsBySource(prev => {
                                      const next = { ...prev }
                                      const list = Array.isArray(next[id]) ? next[id].slice() : []
                                      if (checked) {
                                        next[id] = list.filter(x => x.name !== f)
                                        return next
                                      }
                                      next[id] = [...list, { name: f, enabled: true, required: false }]
                                      return next
                                    })
                                  }}
                                />
                                <span style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</span>
                                {savedLayerDomainsById[id]?.[f]?.length ? (
                                  <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 900, color: '#475569', border: '1px solid #e2e8f0', background: '#f1f5f9', padding: '2px 8px', borderRadius: 999 }}>
                                    List
                                  </span>
                                ) : (
                                  <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: '#94a3b8' }}>Text</span>
                                )}
                              </label>
                            )
                          })
                        ) : (
                          <div style={{ fontSize: 12, color: '#64748b' }}>
                            {availableFields.length ? 'No matching results.' : id.trim() ? 'No fields found for this layer.' : 'Select a layer first.'}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 12, background: '#ffffff' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: '#0f172a' }}>Order Fields</div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#64748b' }}>{selectedConfigs.length ? 'Drag or use arrows' : '—'}</div>
                      </div>

                      <div style={{ marginTop: 10, display: 'grid', gap: 8, maxHeight: 320, overflow: 'auto', paddingRight: 6 }}>
                        {selectedConfigs.length ? (
                          selectedConfigs.map((cfg, idx) => {
                            const canUp = idx > 0
                            const canDown = idx < selectedConfigs.length - 1
                            const dragActive = selectedDragOverIndex === idx
                            return (
                              <div
                                key={`${cfg.name}-${idx}`}
                                draggable
                                onDragStart={(e) => {
                                  setSelectedDragFromIndex(idx)
                                  setSelectedDragOverIndex(idx)
                                  try {
                                    e.dataTransfer.effectAllowed = 'move'
                                    e.dataTransfer.setData('text/plain', String(idx))
                                  } catch {
                                  }
                                }}
                                onDragOver={(e) => {
                                  e.preventDefault()
                                  setSelectedDragOverIndex(idx)
                                }}
                                onDragLeave={() => setSelectedDragOverIndex(prev => (prev === idx ? null : prev))}
                                onDrop={(e) => {
                                  e.preventDefault()
                                  const raw = (() => {
                                    try {
                                      return e.dataTransfer.getData('text/plain')
                                    } catch {
                                      return ''
                                    }
                                  })()
                                  const parsed = Number.isFinite(Number(raw)) ? Number(raw) : selectedDragFromIndex
                                  const from = typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
                                  const to = idx
                                  setSelectedDragFromIndex(null)
                                  setSelectedDragOverIndex(null)
                                  if (from === null || from === to) return
                                  setDraftFieldConfigsBySource(prev => {
                                    const next = { ...prev }
                                    const list = Array.isArray(next[id]) ? next[id].slice() : []
                                    next[id] = moveItem(list, from, to)
                                    return next
                                  })
                                }}
                                onDragEnd={() => {
                                  setSelectedDragFromIndex(null)
                                  setSelectedDragOverIndex(null)
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 10,
                                  padding: '8px 10px',
                                  borderRadius: 12,
                                  border: '1px solid #e2e8f0',
                                  background: dragActive ? '#f1f5f9' : '#ffffff',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                  <div style={{ fontWeight: 900, color: '#94a3b8', cursor: 'grab', userSelect: 'none' }} aria-hidden="true">
                                    ☰
                                  </div>
                                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <div style={{ fontSize: 12, fontWeight: 900, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {idx + 1}. {cfg.name}
                                    </div>
                                  </div>
                                </div>

                                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!canUp) return
                                      setDraftFieldConfigsBySource(prev => {
                                        const next = { ...prev }
                                        const list = Array.isArray(next[id]) ? next[id].slice() : []
                                        next[id] = moveItem(list, idx, idx - 1)
                                        return next
                                      })
                                    }}
                                    disabled={!canUp}
                                    aria-label="Move up"
                                    style={{
                                      border: '1px solid #e2e8f0',
                                      background: '#ffffff',
                                      borderRadius: 10,
                                      padding: '6px 10px',
                                      cursor: canUp ? 'pointer' : 'not-allowed',
                                      fontWeight: 900,
                                      fontSize: 12,
                                      color: '#334155',
                                    }}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!canDown) return
                                      setDraftFieldConfigsBySource(prev => {
                                        const next = { ...prev }
                                        const list = Array.isArray(next[id]) ? next[id].slice() : []
                                        next[id] = moveItem(list, idx, idx + 1)
                                        return next
                                      })
                                    }}
                                    disabled={!canDown}
                                    aria-label="Move down"
                                    style={{
                                      border: '1px solid #e2e8f0',
                                      background: '#ffffff',
                                      borderRadius: 10,
                                      padding: '6px 10px',
                                      cursor: canDown ? 'pointer' : 'not-allowed',
                                      fontWeight: 900,
                                      fontSize: 12,
                                      color: '#334155',
                                    }}
                                  >
                                    ↓
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDraftFieldConfigsBySource(prev => {
                                        const next = { ...prev }
                                        const list = Array.isArray(next[id]) ? next[id].slice() : []
                                        next[id] = list.filter(x => x.name !== cfg.name)
                                        return next
                                      })
                                    }}
                                    aria-label="Remove field"
                                    style={{
                                      border: '1px solid #e2e8f0',
                                      background: '#ffffff',
                                      borderRadius: 10,
                                      padding: '6px 10px',
                                      cursor: 'pointer',
                                      fontWeight: 900,
                                      fontSize: 12,
                                      color: '#b91c1c',
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            )
                          })
                        ) : (
                          <div style={{ fontSize: 12, color: '#64748b', border: '1px dashed #cbd5e1', background: '#f8fafc', padding: '10px 12px', borderRadius: 12 }}>
                            Select fields from the left list to show them here, then reorder them.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const visible = enabledInfo.sourceIds
  const mgmtKey = mgmtBinding?.sourceId && Array.isArray(mgmtBinding.selectedFields) && mgmtBinding.selectedFields.length
    ? `management:${mgmtBinding.sourceId}`
    : null
  const hasMgmt = Boolean(mgmtKey)
  const hasAny = hasMgmt || visible.some(id => (enabledInfo.enabledBySource[id] ?? []).length > 0)
  const stateFromValues = (nextValuesBySource: Record<string, Record<string, string>>): DataSourceFormState => ({
    sourceIds: mgmtKey ? [mgmtKey, ...enabledInfo.sourceIds] : enabledInfo.sourceIds,
    selectedFieldsBySource: mgmtKey
      ? { [mgmtKey]: mgmtBinding?.selectedFields ?? [], ...enabledInfo.enabledBySource }
      : enabledInfo.enabledBySource,
    valuesBySource: nextValuesBySource,
  })

  const toSourceDomId = (sourceId: string) => `ds-source-${String(sourceId).replace(/[^a-zA-Z0-9_-]/g, '_')}`

  useEffect(() => {
    if (mode !== 'fill') return
    if (externalApplyKey === undefined || externalApplyKey === null) return
    if (lastExternalApplyKeyRef.current === externalApplyKey) return
    lastExternalApplyKeyRef.current = externalApplyKey
    if (!externalValuesBySource) return
    setValuesBySource(prev => {
      const next: Record<string, Record<string, string>> = { ...prev }
      let changed = false
      for (const [sid, values] of Object.entries(externalValuesBySource)) {
        const sourceId = String(sid)
        if (!values || typeof values !== 'object') continue
        const prevSource = prev[sourceId] ?? {}
        const nextSource = { ...prevSource, ...values }
        if (JSON.stringify(prevSource) !== JSON.stringify(nextSource)) {
          next[sourceId] = nextSource
          changed = true
        }
      }
      if (!changed) return prev
      onChange?.(stateFromValues(next))
      return next
    })
  }, [mode, externalApplyKey, externalValuesBySource])

  useEffect(() => {
    if (mode !== 'fill') return
    if (formKey !== 'EC') return

    const prevDrip = readPreviousDripVolumeMl()
    setValuesBySource(prev => {
      let changedAny = false
      const next: Record<string, Record<string, string>> = { ...prev }
      for (const sourceId of Object.keys(prev)) {
        const enabled = enabledInfo.enabledBySource[sourceId] ?? []
        const hasAnyCalc = enabled.some(f => EC_PH_CALCULATED_FIELDS.has(f))
        if (!hasAnyCalc) continue

        const src = prev[sourceId] ?? {}
        const calc = computeEcPhCalculatedStrings(src, prevDrip)
        const nextSource: Record<string, string> = { ...src }
        let changedThisSource = false
        for (const [k, v] of Object.entries(calc)) {
          if (!EC_PH_CALCULATED_FIELDS.has(k)) continue
          if ((nextSource[k] ?? '') !== v) {
            nextSource[k] = v
            changedThisSource = true
            changedAny = true
          }
        }
        if (changedThisSource) next[sourceId] = nextSource
      }

      if (!changedAny) return prev
      onChange?.(stateFromValues(next))
      return next
    })
  }, [mode, formKey, enabledInfo.enabledBySource, valuesBySource])

  useEffect(() => {
    if (mode !== 'fill') return
    if (formKey !== 'EC') return

    setValuesBySource(prev => {
      const next: Record<string, Record<string, string>> = { ...prev }
      let changed = false
      const now = getCurrentHHMM()

      for (const [sourceId, enabled] of Object.entries(enabledInfo.enabledBySource)) {
        if (!Array.isArray(enabled) || !enabled.length) continue
        if (ecTimeAutoFilledRef.current[sourceId]) continue

        const timeField = enabled.find((f) => /^time$/i.test(String(f)))
        if (!timeField) continue
        const current = String(prev[sourceId]?.[timeField] ?? '').trim()
        if (current) {
          ecTimeAutoFilledRef.current[sourceId] = true
          continue
        }

        next[sourceId] = { ...(prev[sourceId] ?? {}), [timeField]: now }
        ecTimeAutoFilledRef.current[sourceId] = true
        changed = true
      }

      if (!changed) return prev
      onChange?.(stateFromValues(next))
      return next
    })
  }, [mode, formKey, enabledInfo.enabledBySource])

  const buildFarmUpdates = (enabledFieldSet: Set<string>, feature: any) => {
    const attrs = feature?.attributes ?? {}
    const geom = feature?.geometry
    const center = computeLonLatCenter(geom)
    const safeText = (v: any) => String(v ?? '').trim()

    const updates: Record<string, string> = {}
    const setIfEnabled = (field: string, val: string) => {
      if (!enabledFieldSet.has(field)) return
      updates[field] = val
    }

    setIfEnabled('Farm_Code', safeText(attrs.Farm_Code))
    setIfEnabled('Farm_Name', safeText(attrs.Farm_Name))
    setIfEnabled('ZONE_ID', safeText(attrs.ZONE_ID))
    setIfEnabled('Area_ha', safeText(attrs.Area_ha))
    setIfEnabled('Structure_Type', safeText(attrs.Structure_Type))
    setIfEnabled('Country', safeText(attrs.Country))
    const proj = safeText(attrs.ProjectCode || attrs.Project_Code)
    setIfEnabled('ProjectCode', proj)
    setIfEnabled('Project_Code', proj)

    if (center) {
      const lat = Number(center.lat)
      const lon = Number(center.lon)
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const latStr = lat.toFixed(6)
        const lonStr = lon.toFixed(6)
        ;['Location', 'LOCATION', 'Farm_Location', 'FarmLocation'].forEach((k) => setIfEnabled(k, `${latStr}, ${lonStr}`))
        ;['Latitude', 'LATITUDE', 'Lat', 'LAT'].forEach((k) => setIfEnabled(k, latStr))
        ;['Longitude', 'LONGITUDE', 'Lon', 'LON', 'Lng', 'LNG'].forEach((k) => setIfEnabled(k, lonStr))
      }
    }

    const lastEdit = attrs.last_edited_date ?? attrs.Last_Update ?? attrs.LAST_UPDATE ?? attrs.edit_date
    const ymd = formatYmd(lastEdit)
    if (ymd) {
      ;['Last_Update', 'LAST_UPDATE', 'last_edited_date', 'edit_date'].forEach((k) => setIfEnabled(k, ymd))
    }

    return updates
  }

  const clearFarmUpdates = (enabledFieldSet: Set<string>) => {
    const updates: Record<string, string> = {}
    const setIfEnabled = (field: string, val: string) => {
      if (!enabledFieldSet.has(field)) return
      updates[field] = val
    }
    setIfEnabled('Farm_Code', '')
    for (const f of FARM_AUTO_FIELDS) setIfEnabled(f, '')
    return updates
  }

  const applyFarmUpdatesToMany = (targets: Array<{ sourceId: string; enabledFieldSet: Set<string> }>, updatesBySource: Record<string, Record<string, string>>) => {
    setValuesBySource(prev => {
      let changed = false
      const next: Record<string, Record<string, string>> = { ...prev }
      for (const t of targets) {
        const updates = updatesBySource[t.sourceId]
        if (!updates) continue
        const cur = prev[t.sourceId] ?? {}
        const merged = { ...cur, ...updates }
        if (merged !== cur) {
          next[t.sourceId] = merged
          changed = true
        }
      }
      if (!changed) return prev
      onChange?.(stateFromValues(next))
      return next
    })
  }

  if (!hasAny) {
    return (
      <div style={{ padding: 12, borderRadius: 12, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569', fontSize: 13 }}>
        No configured data source fields for <span style={{ fontWeight: 700 }}>{formKey}</span>. Ask an Admin/Manager to configure this form in Settings.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {mgmtKey ? (
        <div key={mgmtKey} style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: 'white' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #e2e8f0', fontWeight: 800, color: '#0f172a' }}>
            Management Layer <span style={{ fontWeight: 700, color: '#64748b' }}>({getLayerDisplayName(mgmtKey)})</span>
          </div>
          <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {(mgmtBinding?.selectedFields ?? []).map(fieldName => (
              <label key={fieldName} style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#334155' }}>
                <span style={{ fontWeight: 800 }}>{fieldName}</span>
                {(() => {
                  const value = (valuesBySource[mgmtKey] ?? {})[fieldName] ?? ''
                  const type = getFieldType(mgmtKey, fieldName)
                  const domainByField = savedLayerDomainsById[getRealSourceId(mgmtKey)] ?? {}
                  const domainOptions = domainByField[fieldName] ?? []
                  const commit = (nextValue: string) => {
                    setValuesBySource(prev => {
                      const nextSource = { ...(prev[mgmtKey] ?? {}) }
                      nextSource[fieldName] = nextValue
                      const next = { ...prev, [mgmtKey]: nextSource }
                      onChange?.({
                        sourceIds: [mgmtKey, ...enabledInfo.sourceIds],
                        selectedFieldsBySource: { [mgmtKey]: mgmtBinding?.selectedFields ?? [], ...enabledInfo.enabledBySource },
                        valuesBySource: next,
                      })
                      return next
                    })
                  }
                  if (domainOptions.length) {
                    return (
                      <select
                        value={value}
                        onChange={e => commit(e.target.value)}
                        style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid #e2e8f0', background: 'white' }}
                      >
                        <option value="">Select…</option>
                        {domainOptions.map(opt => (
                          <option key={opt.code} value={opt.code}>
                            {opt.name}
                          </option>
                        ))}
                      </select>
                    )
                  }
                  if (type === 'boolean') {
                    return (
                      <select
                        value={value}
                        onChange={e => commit(e.target.value)}
                        style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid #e2e8f0', background: 'white' }}
                      >
                        <option value="">Select…</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    )
                  }
                  return (
                    <input
                      type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
                      value={value}
                      onChange={e => commit(e.target.value)}
                      style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid #e2e8f0' }}
                    />
                  )
                })()}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {visible.map(sourceId => {
        const configs = normalizeFieldConfigs(binding, sourceId)
        const enabledFields = configs.length ? configs : (enabledInfo.enabledBySource[sourceId] ?? []).map(name => ({ name, enabled: true, required: false }))
        if (!enabledFields.length) return null
        const sourceValues = valuesBySource[sourceId] ?? {}
        const domainByField = savedLayerDomainsById[sourceId] ?? {}
        const enabledFieldSet = new Set(enabledFields.map(f => String(f.name)))
        const isAgro21 = isAgroStructures21(sourceId)
        const displayName = getLayerDisplayName(sourceId)
        const isCropsPlanted = (() => {
          const name = String(displayName ?? '').toLowerCase()
          const real = getRealSourceId(sourceId)
          const url = getArcgisLayerUrl(real)
          const u = String(url ?? '').toLowerCase()
          const sid = String(sourceId ?? '').toLowerCase()
          return name.includes('crops_planted') || u.includes('crops_planted') || sid.includes('crops_planted')
        })()
        const agroLookupSourceId = (() => {
          if (isAgro21) return sourceId
          if (!isCropsPlanted) return null
          return visible.find(v => isAgroStructures21(v)) ?? null
        })()
        const isFarmLookupEnabled = Boolean(agroLookupSourceId && isAgroStructures21(agroLookupSourceId))
        const cropsTargets = isAgro21 ? visible.filter(v => {
          const name = String(getLayerDisplayName(v) ?? '').toLowerCase()
          const real = getRealSourceId(v)
          const url = getArcgisLayerUrl(real)
          const u = String(url ?? '').toLowerCase()
          const sid = String(v ?? '').toLowerCase()
          return name.includes('crops_planted') || u.includes('crops_planted') || sid.includes('crops_planted')
        }) : []
        const farmUi = farmUiBySource[sourceId] ?? { open: false, loading: false, error: null, suggestions: [] }

        const commitField = (fieldName: string, nextValue: string) => {
          setValuesBySource(prev => {
            const nextSource = { ...(prev[sourceId] ?? {}) }
            nextSource[fieldName] = nextValue
            const next = { ...prev, [sourceId]: nextSource }
            onChange?.(stateFromValues(next))
            return next
          })
        }

        const pickBestFarmCode = (term: string, options: Array<{ code: string; name: string }>) => {
          const t = normalizeFarmToken(term)
          if (!t) return null
          let best: { code: string; name: string } | null = null
          let bestScore = -1
          for (const opt of options) {
            const c = normalizeFarmToken(opt.code)
            if (!c) continue
            let score = 0
            if (c === t) score = 1000
            else if (c.startsWith(t)) score = 900
            else if (c.includes(t)) score = 800
            else score = 0
            if (score > bestScore) {
              bestScore = score
              best = opt
            }
          }
          return best
        }

        const getEnabledFieldSetFor = (id: string) => {
          const c = normalizeFieldConfigs(binding, id)
          const ef = c.length ? c : (enabledInfo.enabledBySource[id] ?? []).map(name => ({ name, enabled: true, required: false }))
          return new Set(ef.map(v => String(v.name)))
        }

        const getFarmTargets = () => {
          const list: Array<{ sourceId: string; enabledFieldSet: Set<string> }> = [{ sourceId, enabledFieldSet }]
          if (isAgro21) {
            for (const id of cropsTargets) {
              if (id === sourceId) continue
              list.push({ sourceId: id, enabledFieldSet: getEnabledFieldSetFor(id) })
            }
          }
          const seen = new Set<string>()
          return list.filter(t => {
            if (seen.has(t.sourceId)) return false
            seen.add(t.sourceId)
            return true
          })
        }

        const runFarmLookup = async (term: string) => {
          if (!isFarmLookupEnabled || !agroLookupSourceId) return
          const q = term.trim()
          if (!q) return
          const targets = getFarmTargets()
          const hideT = farmHideTimersRef.current[sourceId]
          if (hideT) window.clearTimeout(hideT)
          setFarmUi(sourceId, { open: true })
          const seq = (farmLoadSeqRef.current[sourceId] ?? 0) + 1
          farmLoadSeqRef.current[sourceId] = seq
          setFarmUi(sourceId, { loading: true, error: null })
          try {
            const direct = await loadFarmFeatureByCode(agroLookupSourceId, q)
            if (farmLoadSeqRef.current[sourceId] !== seq) return
            if (direct) {
              const updatesBySource: Record<string, Record<string, string>> = {}
              for (const t of targets) updatesBySource[t.sourceId] = buildFarmUpdates(t.enabledFieldSet, direct)
              applyFarmUpdatesToMany(targets, updatesBySource)
              setFarmUi(sourceId, { loading: false, open: false })
              return
            }

            const suggestions = await fetchFarmSuggestions(agroLookupSourceId, q)
            if (farmLoadSeqRef.current[sourceId] !== seq) return
            const best = pickBestFarmCode(q, suggestions)
            if (!best?.code) {
              const updatesBySource: Record<string, Record<string, string>> = {}
              for (const t of targets) updatesBySource[t.sourceId] = clearFarmUpdates(t.enabledFieldSet)
              applyFarmUpdatesToMany(targets, updatesBySource)
              setFarmUi(sourceId, { loading: false, error: 'Farm code not found', open: true })
              return
            }
            commitField('Farm_Code', best.code)

            const feature = await loadFarmFeatureByCode(agroLookupSourceId, best.code)
            if (farmLoadSeqRef.current[sourceId] !== seq) return
            if (!feature) {
              const updatesBySource: Record<string, Record<string, string>> = {}
              for (const t of targets) updatesBySource[t.sourceId] = clearFarmUpdates(t.enabledFieldSet)
              applyFarmUpdatesToMany(targets, updatesBySource)
              setFarmUi(sourceId, { loading: false, error: 'Farm code not found', open: true })
              return
            }
            const updatesBySource: Record<string, Record<string, string>> = {}
            for (const t of targets) updatesBySource[t.sourceId] = buildFarmUpdates(t.enabledFieldSet, feature)
            applyFarmUpdatesToMany(targets, updatesBySource)
            setFarmUi(sourceId, { loading: false, open: false })
          } catch (e) {
            if (farmLoadSeqRef.current[sourceId] !== seq) return
            setFarmUi(sourceId, { loading: false, error: e instanceof Error ? e.message : 'Failed to query ArcGIS', open: true })
          }
        }

        const queueFarmSuggestions = (term: string) => {
          if (!isFarmLookupEnabled || !agroLookupSourceId) return
          const q = term.trim()
          const nextSeq = (farmSuggestSeqRef.current[sourceId] ?? 0) + 1
          farmSuggestSeqRef.current[sourceId] = nextSeq

          const prevTimer = farmUiTimersRef.current[sourceId]
          if (prevTimer) window.clearTimeout(prevTimer)

          if (q.length < 2) {
            setFarmUi(sourceId, { suggestions: [], loading: false, error: null })
            return
          }

          const delayMs = typeof testOverrides?.farmSuggestDebounceMs === 'number' ? testOverrides.farmSuggestDebounceMs : 250
          farmUiTimersRef.current[sourceId] = window.setTimeout(() => {
            setFarmUi(sourceId, { loading: true, error: null, open: true })
            fetchFarmSuggestions(agroLookupSourceId, q).then((suggestions) => {
              if (farmSuggestSeqRef.current[sourceId] !== nextSeq) return
              setFarmUi(sourceId, { suggestions, loading: false, open: true })
            }).catch((e) => {
              if (farmSuggestSeqRef.current[sourceId] !== nextSeq) return
              setFarmUi(sourceId, { suggestions: [], loading: false, error: e instanceof Error ? e.message : 'Failed to query ArcGIS', open: true })
            })
          }, delayMs)
        }

        return (
          <div
            key={sourceId}
            id={toSourceDomId(sourceId)}
            data-source-id={sourceId}
            style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: 'white' }}
          >
            <div style={{ padding: '12px 14px', borderBottom: '1px solid #e2e8f0', fontWeight: 700, color: '#0f172a' }}>
              {displayName}
            </div>
            <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              {enabledFields.map((cfg) => {
                const fieldName = cfg.name
                const required = Boolean(cfg.required)
                const domainOptions = domainByField[fieldName] ?? []
                const previousDrip = formKey === 'EC' ? readPreviousDripVolumeMl() : 0
                const calculatedNow = formKey === 'EC' ? computeEcPhCalculatedStrings(sourceValues, previousDrip) : null
                const isCalcEcPh = formKey === 'EC' && EC_PH_CALCULATED_FIELDS.has(fieldName)
                const value = isCalcEcPh ? (calculatedNow?.[fieldName as keyof typeof calculatedNow] ?? sourceValues[fieldName] ?? '') : (sourceValues[fieldName] ?? '')
                const fieldType = getFieldType(sourceId, fieldName)
                const isEcTimeField = formKey === 'EC' && /^time$/i.test(fieldName)
                const effectiveFieldType = isEcTimeField ? 'time' : fieldType
                const autoReadOnly =
                  isCalcEcPh || (isAgro21 && FARM_AUTO_FIELDS.has(fieldName) && fieldName !== 'Farm_Code') || (isCropsPlanted && fieldName === 'Farm_Name')
                const inputBaseStyle = { padding: '10px 12px', borderRadius: 12, border: '1px solid #e2e8f0' } as const
                const inputAutoStyle = { ...inputBaseStyle, background: '#f8fafc', borderColor: '#cbd5e1', color: '#0f172a' } as const
                const fieldValidationError = (() => {
                  if (formKey !== 'EC') return null
                  if (isCalcEcPh) return null
                  if (!EC_PH_INPUT_FIELDS.has(fieldName)) return null
                  const raw = String(sourceValues[fieldName] ?? '').trim()
                  if (!raw) return null
                  const n = Number(raw)
                  if (!Number.isFinite(n)) return 'Must be a number.'
                  if (fieldName === 'pH_In' || fieldName === 'pH_Out') {
                    if (n < 0 || n > 14) return 'Must be between 0 and 14.'
                    return null
                  }
                  if (fieldName === 'Cycle') {
                    if (!Number.isInteger(n)) return 'Must be an integer.'
                    if (n < 1) return 'Must be ≥ 1.'
                    return null
                  }
                  if (fieldName === 'DripVolume_ml' || fieldName === 'Drain_Volume_ml' || fieldName === 'Qty_Of_Water_M3') {
                    if (n < 0) return 'Must be ≥ 0.'
                  }
                  return null
                })()
                const inputErrorStyle =
                  fieldValidationError && !autoReadOnly
                    ? ({ ...inputBaseStyle, borderColor: '#fecaca', background: '#fef2f2' } as const)
                    : undefined
                return (
                  <label key={fieldName} style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#334155' }}>
                    <span style={{ fontWeight: 700 }}>
                      {fieldName}
                      {required ? <span style={{ color: '#ef4444', marginLeft: 4 }}>*</span> : null}
                    </span>
                    {isFarmLookupEnabled && fieldName === 'Farm_Code' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
                        <input
                          type="text"
                          value={value}
                          onChange={e => {
                            const nextValue = e.target.value
                            commitField(fieldName, nextValue)
                            setFarmUi(sourceId, { open: true, error: null })
                            queueFarmSuggestions(nextValue)
                          }}
                          onFocus={() => {
                            const t = farmHideTimersRef.current[sourceId]
                            if (t) window.clearTimeout(t)
                            if (farmUi.suggestions.length) setFarmUi(sourceId, { open: true })
                          }}
                          onBlur={() => {
                            const prev = farmHideTimersRef.current[sourceId]
                            if (prev) window.clearTimeout(prev)
                            farmHideTimersRef.current[sourceId] = window.setTimeout(() => setFarmUi(sourceId, { open: false }), 140)
                            void runFarmLookup(value)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void runFarmLookup(value)
                            }
                            if (e.key === 'Escape') {
                              setFarmUi(sourceId, { open: false })
                            }
                          }}
                          style={inputBaseStyle}
                          required={required}
                          aria-required={required}
                          aria-label={`${displayName}:${fieldName} (smart lookup)`}
                        />

                        {farmUi.open && (farmUi.loading || farmUi.error || farmUi.suggestions.length) ? (
                          <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: 'white', maxHeight: 220, overflow: 'auto' }}>
                            {farmUi.loading ? (
                              <div style={{ padding: '10px 12px', fontSize: 12, color: '#64748b', fontWeight: 700 }}>
                                Searching…
                              </div>
                            ) : null}
                            {farmUi.error ? (
                              <div style={{ padding: '10px 12px', fontSize: 12, color: '#b91c1c', fontWeight: 700 }}>
                                {farmUi.error}
                              </div>
                            ) : null}
                            {!farmUi.loading && !farmUi.error ? (
                              farmUi.suggestions.length ? (
                                farmUi.suggestions.map((opt) => (
                                  <button
                                    key={opt.code}
                                    type="button"
                                    onMouseDown={() => {
                                      const t = farmHideTimersRef.current[sourceId]
                                      if (t) window.clearTimeout(t)
                                    }}
                                    onClick={() => {
                                      commitField(fieldName, opt.code)
                                      setFarmUi(sourceId, { open: false, error: null })
                                      void runFarmLookup(opt.code)
                                    }}
                                    style={{
                                      width: '100%',
                                      textAlign: 'left',
                                      padding: '10px 12px',
                                      border: 'none',
                                      background: 'transparent',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    <div style={{ fontWeight: 800, color: '#0f172a' }}>{opt.code}</div>
                                    {opt.name ? <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>{opt.name}</div> : null}
                                  </button>
                                ))
                              ) : (
                                <div style={{ padding: '10px 12px', fontSize: 12, color: '#64748b', fontWeight: 700 }}>
                                  No matches
                                </div>
                              )
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : formKey === 'EC' && fieldName === 'Valve_No' && isIrrigationSystemValve(sourceId) && getArcgisLayerUrl(sourceId) ? (
                      (() => {
                        const valveUi = valveUiBySource[sourceId] ?? {
                          open: false,
                          browseOpen: false,
                          loading: false,
                          error: null,
                          suggestions: [],
                          browseQuery: '',
                          sortDir: 'asc' as const,
                        }

                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
                            <input
                              type="text"
                              value={value}
                              onChange={e => {
                                const nextValue = e.target.value
                                commitField(fieldName, nextValue)
                                setValveUi(sourceId, { open: true, error: null })
                                void ensureValveOptionsLoaded(sourceId)
                                queueValveSuggestions(sourceId, nextValue)
                              }}
                              onFocus={() => {
                                const t = valveHideTimersRef.current[sourceId]
                                if (t) window.clearTimeout(t)
                                setValveUi(sourceId, { open: true })
                                void ensureValveOptionsLoaded(sourceId)
                                queueValveSuggestions(sourceId, value)
                              }}
                              onBlur={() => {
                                const prev = valveHideTimersRef.current[sourceId]
                                if (prev) window.clearTimeout(prev)
                                valveHideTimersRef.current[sourceId] = window.setTimeout(() => setValveUi(sourceId, { open: false }), 140)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') setValveUi(sourceId, { open: false })
                              }}
                              style={inputBaseStyle}
                              required={required}
                              aria-required={required}
                              aria-label={`${displayName}:${fieldName} (valve lookup)`}
                            />

                            {valveUi.open && (valveUi.loading || valveUi.error || valveUi.suggestions.length) ? (
                              <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: 'white', maxHeight: 220, overflow: 'auto' }}>
                                {valveUi.loading ? (
                                  <div style={{ padding: '10px 12px', fontSize: 12, color: '#64748b', fontWeight: 700 }}>
                                    Searching…
                                  </div>
                                ) : null}
                                {valveUi.error ? (
                                  <div style={{ padding: '10px 12px', fontSize: 12, color: '#b91c1c', fontWeight: 700 }}>
                                    {valveUi.error}
                                  </div>
                                ) : null}
                                {!valveUi.loading && !valveUi.error ? (
                                  valveUi.suggestions.length ? (
                                    valveUi.suggestions.map(opt => (
                                      <button
                                        key={`${opt.valveNo}:${opt.objectId}`}
                                        type="button"
                                        onMouseDown={() => {
                                          const t = valveHideTimersRef.current[sourceId]
                                          if (t) window.clearTimeout(t)
                                        }}
                                        onClick={() => {
                                          commitField(fieldName, opt.valveNo)
                                          setValveUi(sourceId, { open: false, error: null })
                                        }}
                                        style={{
                                          width: '100%',
                                          textAlign: 'left',
                                          padding: '10px 12px',
                                          border: 'none',
                                          background: 'transparent',
                                          cursor: 'pointer',
                                        }}
                                      >
                                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{opt.valveNo}</div>
                                      </button>
                                    ))
                                  ) : (
                                    <div style={{ padding: '10px 12px', fontSize: 12, color: '#64748b', fontWeight: 700 }}>
                                      No matches
                                    </div>
                                  )
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        )
                      })()
                    ) : domainOptions.length ? (
                      <select
                        value={value}
                        onChange={e => {
                          const nextValue = e.target.value
                          commitField(fieldName, nextValue)
                        }}
                        style={autoReadOnly ? inputAutoStyle : inputErrorStyle ?? { ...inputBaseStyle, background: 'white' }}
                        required={required}
                        aria-required={required}
                        disabled={autoReadOnly}
                      >
                        <option value="">Select…</option>
                        {domainOptions.map(opt => (
                          <option key={opt.code} value={opt.code}>
                            {opt.name}
                          </option>
                        ))}
                      </select>
                    ) : fieldType === 'boolean' ? (
                      <select
                        value={value}
                        onChange={e => {
                          const nextValue = e.target.value
                          commitField(fieldName, nextValue)
                        }}
                        style={autoReadOnly ? inputAutoStyle : inputErrorStyle ?? { ...inputBaseStyle, background: 'white' }}
                        required={required}
                        aria-required={required}
                        disabled={autoReadOnly}
                      >
                        <option value="">Select…</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    ) : (
                      <input
                        type={effectiveFieldType === 'number' ? 'number' : effectiveFieldType === 'date' ? 'date' : effectiveFieldType === 'time' ? 'time' : 'text'}
                        value={value}
                        onChange={e => {
                          commitField(fieldName, e.target.value)
                        }}
                        style={autoReadOnly ? inputAutoStyle : inputErrorStyle ?? inputBaseStyle}
                        required={required}
                        aria-required={required}
                        step={effectiveFieldType === 'number' ? 'any' : undefined}
                        readOnly={autoReadOnly}
                      />
                    )}
                    {fieldValidationError ? (
                      <div style={{ fontSize: 11, color: '#b91c1c', fontWeight: 700 }}>
                        {fieldValidationError}
                      </div>
                    ) : null}
                    {autoReadOnly ? (
                      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>
                        {isCalcEcPh ? 'Calculated field (read-only)' : 'Auto-filled from Agro_Structures (FeatureServer/21)'}
                      </div>
                    ) : null}
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
