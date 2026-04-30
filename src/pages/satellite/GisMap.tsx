import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Map as LeafletMap } from 'leaflet'
import L from 'leaflet'
import { GeoJSON } from 'react-leaflet'
import MapView from '../../components/MapView'
import type { LayerData, SymbologyClassMethod, SymbologyColorRamp, SymbologyConfig, SymbologyStyle } from './components/LayerManager'
import { FieldVisibilityControl } from './components/FieldVisibilityControl'
import { MapPopup } from './components/MapPopup'
import { DrawToolsController } from './components/DrawTools'

type AddLayerTab = 'arcgis' | 'upload'

const DB_NAME = 'GisMapStore'
const STORE_NAME = 'layers'

const initDB = () => new Promise<IDBDatabase>((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1)
  req.onupgradeneeded = () => {
    if (!req.result.objectStoreNames.contains(STORE_NAME)) {
      req.result.createObjectStore(STORE_NAME)
    }
  }
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

const saveLayersToDB = async (layers: LayerData[]) => {
  try {
    const db = await initDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(layers, 'savedLayers')
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = reject
    })
  } catch (e) {
    console.error('Failed to save layers', e)
  }
}

const loadLayersFromDB = async (): Promise<LayerData[]> => {
  try {
    const db = await initDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get('savedLayers')
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = reject
    })
  } catch (e) {
    console.error('Failed to load layers', e)
    return []
  }
}

export type ArcGisLegendEntry = { label: string; symbol: any }

export const buildArcGisLegendEntries = (renderer: any, limit = 16): ArcGisLegendEntry[] => {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.min(64, Math.floor(limit))) : 16
  if (!renderer || typeof renderer !== 'object') return []
  const type = renderer?.type
  if (type === 'simple') {
    const symbol = renderer?.symbol ?? null
    if (!symbol) return []
    const label = typeof renderer?.label === 'string' && renderer.label ? renderer.label : 'Default'
    return [{ label, symbol }]
  }
  if (type === 'uniqueValue') {
    const infos = Array.isArray(renderer?.uniqueValueInfos) ? (renderer.uniqueValueInfos as any[]) : []
    const out: ArcGisLegendEntry[] = []
    for (const info of infos.slice(0, safeLimit)) {
      const symbol = info?.symbol ?? null
      if (!symbol) continue
      const label =
        typeof info?.label === 'string' && info.label
          ? info.label
          : typeof info?.value === 'string' && info.value
            ? info.value
            : 'Value'
      out.push({ label, symbol })
    }
    if (out.length < safeLimit && renderer?.defaultSymbol) out.push({ label: 'Other', symbol: renderer.defaultSymbol })
    return out
  }
  if (type === 'classBreaks') {
    const infos = Array.isArray(renderer?.classBreakInfos) ? (renderer.classBreakInfos as any[]) : []
    const out: ArcGisLegendEntry[] = []
    for (const info of infos.slice(0, safeLimit)) {
      const symbol = info?.symbol ?? null
      if (!symbol) continue
      const max = info?.classMaxValue
      const label =
        typeof info?.label === 'string' && info.label
          ? info.label
          : typeof max === 'number' && Number.isFinite(max)
            ? `≤ ${max}`
            : 'Range'
      out.push({ label, symbol })
    }
    if (out.length < safeLimit && renderer?.defaultSymbol) out.push({ label: 'Other', symbol: renderer.defaultSymbol })
    return out
  }
  return []
}

export default function GisMap() {
  const mapRef = useRef<LeafletMap | null>(null)
  const selectionOverlayRef = useRef<L.LayerGroup | null>(null)
  const drawingFeatureGroupRef = useRef<L.FeatureGroup | null>(null)
  const [layers, setLayers] = useState<LayerData[]>([])
  const [layersLoaded, setLayersLoaded] = useState(false)
  const persistLayersJobRef = useRef<null | { kind: 'idle'; id: number } | { kind: 'timeout'; id: ReturnType<typeof setTimeout> }>(null)
  const geoJsonDataIdByObjectRef = useRef<WeakMap<object, number>>(new WeakMap())
  const geoJsonDataIdSeqRef = useRef(1)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [tab, setTab] = useState<AddLayerTab>('arcgis')
  const [serviceUrl, setServiceUrl] = useState('')
  const [token, setToken] = useState('')
  const [layerName, setLayerName] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [discoveredLayers, setDiscoveredLayers] = useState<Array<{ id: number; name: string; kind: 'layer' | 'table'; url: string; geometryType?: string }>>([])
  const [selectedDiscoveredUrl, setSelectedDiscoveredUrl] = useState<string>('')
  const [addingLayerKey, setAddingLayerKey] = useState<string | null>(null)
  const [syncingLayerKey, setSyncingLayerKey] = useState<string | null>(null)
  const [openLayerMenuId, setOpenLayerMenuId] = useState<string | null>(null)
  const [layerMenuPos, setLayerMenuPos] = useState<null | { top: number; left: number }>(null)
  const [layerDialog, setLayerDialog] = useState<null | { mode: 'props' | 'table' | 'legend'; layerId: string }>(null)
  const layerDialogRef = useRef<null | { mode: 'props' | 'table' | 'legend'; layerId: string }>(null)
  const [tableDockHeight, setTableDockHeight] = useState(320)
  const [tableDockCollapsed, setTableDockCollapsed] = useState(false)
  const [tableDockMinimized, setTableDockMinimized] = useState(false)
  const [tableToolsCollapsed, setTableToolsCollapsed] = useState(true)
  const [showSelectedOnly, setShowSelectedOnly] = useState(false)
  const [selectedFeatureKeys, setSelectedFeatureKeys] = useState<Set<string>>(() => new Set())
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null)
  const [featureDialog, setFeatureDialog] = useState<null | { layerId: string; featureKey: string; feature: any; layerName: string }>(null)
  const [drawingSelected, setDrawingSelected] = useState<any | null>(null)
  const [drawingCount, setDrawingCount] = useState(0)
  const [drawingColor, setDrawingColor] = useState('#10b981')
  const [drawingActiveTool, setDrawingActiveTool] = useState<string | null>(null)
  const [drawingEditorOpen, setDrawingEditorOpen] = useState(false)
  const [drawingIsEditing, setDrawingIsEditing] = useState(false)
  const [drawingDirty, setDrawingDirty] = useState(false)
  const drawingSnapshotRef = useRef<any[] | null>(null)
  const [drawingConfirm, setDrawingConfirm] = useState<null | { kind: 'save' | 'discard' | 'deleteAll' }>(null)
  const [editSettingsCollapsed, setEditSettingsCollapsed] = useState(false)
  const [editSnappingLayersOpen, setEditSnappingLayersOpen] = useState(false)
  const [editGridOptionsOpen, setEditGridOptionsOpen] = useState(false)
  const [editSnappingLayerIds, setEditSnappingLayerIds] = useState<Set<string>>(() => new Set())
  const [editGridSize, setEditGridSize] = useState('10')
  const [editGridUnit, setEditGridUnit] = useState('m')
  const [symbologyDialog, setSymbologyDialog] = useState<null | { layerId: string; draft: Required<SymbologyConfig>; original?: SymbologyConfig }>(null)
  const dragDepthRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const tableDockBeforeEditRef = useRef<null | { collapsed: boolean; minimized: boolean; height: number }>(null)
  const pendingTableSelectionRef = useRef<null | { layerId: string; keys: Set<string>; zoom?: boolean }>(null)
  const tableScrollRootRef = useRef<HTMLDivElement | null>(null)
  const featureKeyCacheRef = useRef<WeakMap<any, string>>(new WeakMap())
  const featureByKeyByLayerRef = useRef<Map<string, Map<string, any>>>(new Map())
  const [hiddenTableFieldsByLayerId, setHiddenTableFieldsByLayerId] = useState<Record<string, Set<string>>>(() => ({}))
  const popupRef = useRef<HTMLDivElement | null>(null)
  const popupCloseTimerRef = useRef<number | null>(null)
  const popupLastFocusRef = useRef<HTMLElement | null>(null)
  const [mapPopup, setMapPopup] = useState<
    | null
    | {
        layerId: string
        layerName: string
        featureKey: string
        feature: any
        latlng: { lat: number; lng: number }
        phase: 'open' | 'closing'
      }
  >(null)
  const [mapPopupPos, setMapPopupPos] = useState<null | { left: number; top: number; placement: 'top' | 'bottom'; arrowLeft: number }>(null)

  const orderedLayers = useMemo(() => [...layers].reverse(), [layers])
  const geoJsonIndexSignature = useMemo(() => {
    const ids: string[] = []
    for (const layer of layers) {
      if (layer.type !== 'geojson' || !layer.data || typeof layer.data !== 'object') continue
      const obj = layer.data as object
      let id = geoJsonDataIdByObjectRef.current.get(obj)
      if (!id) {
        id = geoJsonDataIdSeqRef.current
        geoJsonDataIdSeqRef.current += 1
        geoJsonDataIdByObjectRef.current.set(obj, id)
      }
      ids.push(`${String(layer.id)}:${id}`)
    }
    return ids.join('|')
  }, [layers])
  const symbologySignature = useMemo(() => {
    const parts: string[] = []
    for (const layer of layers) {
      if (layer.type !== 'geojson' || !layer.data || typeof layer.data !== 'object') continue
      const obj = layer.data as object
      let dataId = geoJsonDataIdByObjectRef.current.get(obj)
      if (!dataId) {
        dataId = geoJsonDataIdSeqRef.current
        geoJsonDataIdSeqRef.current += 1
        geoJsonDataIdByObjectRef.current.set(obj, dataId)
      }
      const s = layer.symbology ? JSON.stringify(layer.symbology) : ''
      parts.push(
        [
          String(layer.id),
          String(dataId),
          layer.color ?? '',
          layer.fillColor ?? '',
          String(layer.weight ?? ''),
          String(layer.opacity ?? ''),
          s,
        ].join('~'),
      )
    }
    return parts.join('|')
  }, [layers])
  const initialZoom = useMemo(() => {
    const targetScaleDenominator = 100_000_000
    const latitude = 20
    const dpi = 96
    const inchesPerMeter = 39.37
    const baseResolution = 156543.03392804097
    const metersPerPixel = targetScaleDenominator / (dpi * inchesPerMeter)
    const z = Math.log2((baseResolution * Math.cos((latitude * Math.PI) / 180)) / metersPerPixel)
    return Math.max(0, Math.min(22, Math.round(z * 10) / 10))
  }, [])

  const stripLegacyLayerProps = useCallback((layer: any): LayerData => {
    const { autoRefresh, refreshInterval, fieldsLinked, labelField, relationshipFieldsLinked, relationshipIdField, ...rest } = layer || {}
    return rest as LayerData
  }, [])

  const normalizeLoadedLayers = useCallback(
    (raw: unknown): LayerData[] => (Array.isArray(raw) ? raw.map(stripLegacyLayerProps) : []),
    [stripLegacyLayerProps],
  )

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
    loadLayersFromDB().then((savedLayers) => {
      const normalized = normalizeLoadedLayers(savedLayers)
      if (normalized.length > 0) setLayers(normalized)
      setLayersLoaded(true)
    })
  }, [normalizeLoadedLayers])

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
      saveLayersToDB(layers.map(stripLegacyLayerProps))
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
  }, [layers, layersLoaded, stripLegacyLayerProps])

  useEffect(() => {
    layerDialogRef.current = layerDialog
  }, [layerDialog])

  useEffect(() => {
    if (!openLayerMenuId && !layerDialog) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpenLayerMenuId(null)
        setLayerDialog(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openLayerMenuId, layerDialog])

  useEffect(() => {
    if (!openLayerMenuId) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Element)) {
        setOpenLayerMenuId(null)
        return
      }
      if (target.closest(`[data-layer-menu-root="${openLayerMenuId}"]`)) return
      setOpenLayerMenuId(null)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [openLayerMenuId])

  useEffect(() => {
    if (!openLayerMenuId) setLayerMenuPos(null)
  }, [openLayerMenuId])

  useEffect(() => {
    if (layerDialog?.mode !== 'table') return
    const pending = pendingTableSelectionRef.current
    if (pending && String(pending.layerId) === String(layerDialog.layerId)) {
      pendingTableSelectionRef.current = null
      setSelectedFeatureKeys(new Set(pending.keys))
      setShowSelectedOnly(false)
      setTableDockCollapsed(false)
      setTableDockMinimized(false)
      return
    }
    setSelectedFeatureKeys(new Set())
    setShowSelectedOnly(false)
    setTableDockCollapsed(false)
  }, [layerDialog?.mode, layerDialog?.layerId])

  useEffect(() => {
    if (!featureDialog) {
      setEditSnappingLayersOpen(false)
      setEditGridOptionsOpen(false)
      return
    }
    setEditSnappingLayerIds(prev => (prev.size ? prev : new Set(layers.map(l => String(l.id)))))
  }, [featureDialog, layers])

  useEffect(() => {
    const syncTableDockToEdit = () => {
      if (!featureDialog) {
        if (tableDockBeforeEditRef.current) {
          const prev = tableDockBeforeEditRef.current
          tableDockBeforeEditRef.current = null
          setTableDockHeight(prev.height)
          setTableDockCollapsed(prev.collapsed)
          setTableDockMinimized(prev.minimized)
        }
        return
      }

      if (layerDialog?.mode !== 'table') return

      const isNarrow = window.innerWidth <= 640
      if (isNarrow) {
        if (!tableDockBeforeEditRef.current) {
          tableDockBeforeEditRef.current = { collapsed: tableDockCollapsed, minimized: tableDockMinimized, height: tableDockHeight }
        }
        setTableDockMinimized(true)
        setTableDockCollapsed(true)
        return
      }

      if (tableDockBeforeEditRef.current) {
        const prev = tableDockBeforeEditRef.current
        tableDockBeforeEditRef.current = null
        setTableDockHeight(prev.height)
        setTableDockCollapsed(prev.collapsed)
        setTableDockMinimized(prev.minimized)
      }
    }

    syncTableDockToEdit()

    if (!featureDialog) return
    window.addEventListener('resize', syncTableDockToEdit)
    return () => window.removeEventListener('resize', syncTableDockToEdit)
  }, [featureDialog, layerDialog?.mode, tableDockCollapsed, tableDockMinimized, tableDockHeight])

  const zoomToLayer = (layer: LayerData) => {
    const map = mapRef.current
    if (!map) return
    if (!layer.data) return
    try {
      const bounds = L.geoJSON(layer.data as any).getBounds()
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 })
    } catch {}
  }

  useEffect(() => {
    let cancelled = false
    let scheduled: null | { kind: 'idle'; id: number } | { kind: 'timeout'; id: ReturnType<typeof setTimeout> } = null

    const layerWork: Array<{ layerId: string; features: any[] }> = []
    for (const layer of layers) {
      if (layer.type !== 'geojson' || !layer.data) continue
      const features = Array.isArray((layer.data as any)?.features) ? ((layer.data as any).features as any[]) : []
      if (features.length) layerWork.push({ layerId: String(layer.id), features })
    }

    const nextCache = new WeakMap<any, string>()
    const nextByLayer = new Map<string, Map<string, any>>()

    let layerIdx = 0
    let featureIdx = 0
    let currentByKey: Map<string, any> | null = null
    let currentFeatures: any[] | null = null
    let currentLayerId: string | null = null

    const cancelScheduled = () => {
      if (!scheduled) return
      if (scheduled.kind === 'idle') {
        ;(window as any).cancelIdleCallback?.(scheduled.id)
      } else {
        clearTimeout(scheduled.id)
      }
      scheduled = null
    }

    const schedule = () => {
      cancelScheduled()
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        scheduled = { kind: 'idle', id: (window as any).requestIdleCallback(run, { timeout: 800 }) }
        return
      }
      scheduled = { kind: 'timeout', id: setTimeout(run, 0) }
    }

    const computeKey = (ft: any, idx: number) => {
      const direct = ft?.id
      if (direct !== null && direct !== undefined && direct !== '') return String(direct)
      const props = ft?.properties
      if (props && typeof props === 'object') {
        const candidates = ['OBJECTID', 'ObjectId', 'objectid', 'FID', 'fid', 'Id', 'ID', 'id']
        for (const k of candidates) {
          const v = (props as any)[k]
          if (v !== null && v !== undefined && v !== '') return `${k}:${String(v)}`
        }
      }
      return `idx:${idx}`
    }

    const run = (deadline?: IdleDeadline) => {
      if (cancelled) return
      const budgetMs = deadline ? Math.max(2, deadline.timeRemaining()) : 8
      const start = typeof performance !== 'undefined' ? performance.now() : Date.now()

      while (layerIdx < layerWork.length) {
        if (!currentFeatures) {
          const next = layerWork[layerIdx]
          currentLayerId = next.layerId
          currentFeatures = next.features
          currentByKey = new Map<string, any>()
          featureIdx = 0
        }

        while (currentFeatures && featureIdx < currentFeatures.length) {
          const ft = currentFeatures[featureIdx]
          const key = computeKey(ft, featureIdx)
          if (ft && typeof ft === 'object') nextCache.set(ft, key)
          if (currentByKey && !currentByKey.has(key)) currentByKey.set(key, ft)
          featureIdx += 1

          const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
          if (now - start >= budgetMs) {
            schedule()
            return
          }
        }

        if (currentLayerId && currentByKey) nextByLayer.set(currentLayerId, currentByKey)
        currentFeatures = null
        currentByKey = null
        currentLayerId = null
        layerIdx += 1
      }

      featureKeyCacheRef.current = nextCache
      featureByKeyByLayerRef.current = nextByLayer
    }

    schedule()

    return () => {
      cancelled = true
      cancelScheduled()
    }
  }, [geoJsonIndexSignature])

  const getFeatureKey = (feature: any, idx: number) => {
    if (feature && typeof feature === 'object') {
      const cached = featureKeyCacheRef.current.get(feature)
      if (cached) return cached
    }
    const direct = feature?.id
    if (direct !== null && direct !== undefined && direct !== '') return String(direct)
    const props = feature?.properties
    if (props && typeof props === 'object') {
      const candidates = ['OBJECTID', 'ObjectId', 'objectid', 'FID', 'fid', 'Id', 'ID', 'id']
      for (const k of candidates) {
        const v = (props as any)[k]
        if (v !== null && v !== undefined && v !== '') return `${k}:${String(v)}`
      }
    }
    const key = `idx:${idx}`
    if (feature && typeof feature === 'object') featureKeyCacheRef.current.set(feature, key)
    return key
  }

  const getFeatureKeyFromCache = (feature: any) => {
    if (!feature || typeof feature !== 'object') return null
    return featureKeyCacheRef.current.get(feature) ?? null
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

  const buildPopupFields = (feature: any, latlng: { lat: number; lng: number } | null) => {
    const props = feature?.properties && typeof feature.properties === 'object' ? (feature.properties as Record<string, any>) : {}
    const preferred = [
      'name',
      'Name',
      'NAME',
      'title',
      'Title',
      'ADDRESS',
      'Address',
      'address',
      'street',
      'Street',
      'city',
      'City',
      'area',
      'Area',
      'phone',
      'Phone',
      'email',
      'Email',
    ]
    const seen = new Set<string>()
    const fields: Array<{ label: string; value: string }> = []

    if (latlng) {
      fields.push({ label: 'Coordinates', value: `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}` })
    }

    for (const key of preferred) {
      const raw = props[key]
      const value = formatPopupValue(raw).trim()
      if (!value) continue
      if (seen.has(key.toLowerCase())) continue
      seen.add(key.toLowerCase())
      fields.push({ label: key, value })
    }

    const remaining = Object.keys(props)
      .filter(k => k && !seen.has(k.toLowerCase()))
      .sort((a, b) => a.localeCompare(b))

    for (const key of remaining) {
      if (fields.length >= 12) break
      const value = formatPopupValue(props[key]).trim()
      if (!value) continue
      fields.push({ label: key, value })
    }

    return fields
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

  const closeMapPopup = useCallback(() => {
    setMapPopup(prev => {
      if (!prev) return prev
      if (prev.phase === 'closing') return prev
      return { ...prev, phase: 'closing' }
    })
  }, [])

  const openMapPopup = useCallback((next: { layer: LayerData; feature: any; latlng: { lat: number; lng: number } }) => {
    const key = getFeatureKeyFromCache(next.feature) ?? getFeatureKey(next.feature, 0)
    if (popupCloseTimerRef.current) {
      window.clearTimeout(popupCloseTimerRef.current)
      popupCloseTimerRef.current = null
    }
    popupLastFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setMapPopup({
      layerId: String(next.layer.id),
      layerName: next.layer.name,
      featureKey: String(key),
      feature: next.feature,
      latlng: next.latlng,
      phase: 'open',
    })
  }, [])

  useEffect(() => {
    if (!mapPopup) {
      if (popupCloseTimerRef.current) {
        window.clearTimeout(popupCloseTimerRef.current)
        popupCloseTimerRef.current = null
      }
      setMapPopupPos(null)
      return
    }
    if (mapPopup.phase !== 'closing') return
    if (popupCloseTimerRef.current) window.clearTimeout(popupCloseTimerRef.current)
    popupCloseTimerRef.current = window.setTimeout(() => {
      popupCloseTimerRef.current = null
      setMapPopup(null)
      setMapPopupPos(null)
      const prev = popupLastFocusRef.current
      popupLastFocusRef.current = null
      prev?.focus?.()
    }, 170)
    return () => {
      if (popupCloseTimerRef.current) {
        window.clearTimeout(popupCloseTimerRef.current)
        popupCloseTimerRef.current = null
      }
    }
  }, [mapPopup])

  useEffect(() => {
    if (!mapPopup || mapPopup.phase === 'closing') return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      const root = popupRef.current
      if (!root) return
      if (root.contains(target)) return
      closeMapPopup()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [mapPopup, closeMapPopup])

  const updateMapPopupPos = useCallback(() => {
    const map = mapRef.current
    const popup = mapPopup
    const el = popupRef.current
    if (!map || !popup || popup.phase === 'closing') return
    const pt = map.latLngToContainerPoint(L.latLng(popup.latlng.lat, popup.latlng.lng))
    const size = map.getSize()
    const w = el ? Math.max(1, el.offsetWidth) : 340
    const h = el ? Math.max(1, el.offsetHeight) : 220
    const pad = 10
    const offset = 14

    const canPlaceTop = pt.y - h - offset >= pad
    const placement: 'top' | 'bottom' = canPlaceTop ? 'top' : 'bottom'
    const desiredLeft = pt.x - w / 2
    const desiredTop = placement === 'top' ? pt.y - h - offset : pt.y + offset

    const left = Math.max(pad, Math.min(size.x - w - pad, desiredLeft))
    const top = Math.max(pad, Math.min(size.y - h - pad, desiredTop))
    const arrowLeft = Math.max(16, Math.min(w - 16, pt.x - left))
    setMapPopupPos({ left, top, placement, arrowLeft })
  }, [mapPopup])

  useEffect(() => {
    const map = mapRef.current
    if (!mapPopup || !map || mapPopup.phase === 'closing') return
    updateMapPopupPos()
    const onMove = () => updateMapPopupPos()
    map.on('move', onMove)
    map.on('zoom', onMove)
    map.on('resize', onMove)
    window.addEventListener('resize', onMove)
    return () => {
      map.off('move', onMove)
      map.off('zoom', onMove)
      map.off('resize', onMove)
      window.removeEventListener('resize', onMove)
    }
  }, [mapPopup, updateMapPopupPos])

  useLayoutEffect(() => {
    if (!mapPopup || mapPopup.phase === 'closing') return
    updateMapPopupPos()
    const id = window.requestAnimationFrame(() => updateMapPopupPos())
    return () => window.cancelAnimationFrame(id)
  }, [mapPopup, updateMapPopupPos])

  useEffect(() => {
    if (!mapPopup || mapPopup.phase === 'closing') return
    const id = window.setTimeout(() => {
      const el = popupRef.current
      const focusTarget =
        el?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? el ?? null
      focusTarget?.focus?.()
    }, 0)
    return () => window.clearTimeout(id)
  }, [mapPopup])

  const clearSelectionOverlay = () => {
    try {
      selectionOverlayRef.current?.clearLayers()
    } catch {}
  }

  const showFeatureSelectionOnMap = (layerId: string, featureKey: string, opts?: { zoom?: boolean }) => {
    const map = mapRef.current
    const overlay = selectionOverlayRef.current
    if (!map || !overlay) return

    const feature = featureByKeyByLayerRef.current.get(String(layerId))?.get(String(featureKey))
    if (!feature) {
      clearSelectionOverlay()
      setSelectionNotice('لا يمكن العثور على العنصر المكاني المقابل لهذا الصف.')
      return
    }

    const geom = feature?.geometry
    const kind = getGeometryKind(geom?.type)
    if (kind === 'other') {
      clearSelectionOverlay()
      setSelectionNotice('الصف المحدد لا يحتوي على بيانات مكانية صالحة.')
      return
    }

    setSelectionNotice(null)
    try {
      overlay.clearLayers()
      const highlight = L.geoJSON(feature as any, {
        style: {
          color: '#00FFFF',
          weight: 4,
          opacity: 1,
          fillColor: '#00FFFF',
          fillOpacity: 0.3,
        } as any,
        pointToLayer: (_, latlng) =>
          L.marker(latlng, {
            icon: L.divIcon({
              className: 'gis-exact-point-highlight',
              html: `<div style="color: #00FFFF; font-size: 24px; text-shadow: 0 0 4px rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-location-dot"></i></div>`,
              iconSize: [24, 24],
              iconAnchor: [12, 24],
            }),
          }),
      })
      overlay.addLayer(highlight)
    } catch {}

    if (opts?.zoom) {
      zoomToFeatures([feature])
    }
  }

  const identifyFeatureOnMap = (layer: LayerData, feature: any) => {
    const layerId = String(layer.id)
    const key = getFeatureKeyFromCache(feature)
    if (!key) {
      setSelectionNotice('لا يمكن تحديد هذا العنصر بسبب عدم توفر مُعرّف مناسب.')
      return
    }

    setTableDockCollapsed(false)
    setTableDockMinimized(false)
    setShowSelectedOnly(false)

    const current = layerDialogRef.current
    if (current?.mode === 'table' && String(current.layerId) === layerId) {
      setSelectedFeatureKeys(new Set([key]))
    } else {
      pendingTableSelectionRef.current = { layerId, keys: new Set([key]), zoom: true }
      setLayerDialog({ mode: 'table', layerId })
      setSelectedFeatureKeys(new Set([key]))
    }

    showFeatureSelectionOnMap(layerId, key, { zoom: true })
    requestAnimationFrame(() => scrollSelectedRowIntoView(key))
  }

  const scrollSelectedRowIntoView = (featureKey: string) => {
    const root = tableScrollRootRef.current
    if (!root) return
    const esc = (v: string) => {
      const c = (window as any).CSS
      const fn = c && typeof c.escape === 'function' ? c.escape : null
      if (fn) return fn(v)
      return v.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
    }
    const row = root.querySelector(`tr[data-row-key="${esc(featureKey)}"]`)
    if (row instanceof HTMLElement) {
      try {
        row.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      } catch {}
    }
  }

  useEffect(() => {
    if (layerDialog?.mode !== 'table') {
      clearSelectionOverlay()
      setSelectionNotice(null)
      return
    }
    if (selectedFeatureKeys.size !== 1) {
      clearSelectionOverlay()
      setSelectionNotice(null)
      return
    }
    const it = selectedFeatureKeys.values().next()
    const key = it.done ? null : (it.value as string)
    if (!key) return
    showFeatureSelectionOnMap(String(layerDialog.layerId), key)
    requestAnimationFrame(() => scrollSelectedRowIntoView(key))
  }, [layerDialog?.mode, layerDialog?.layerId, selectedFeatureKeys])

  const zoomToFeatures = (features: any[]) => {
    const map = mapRef.current
    if (!map) return
    if (!features.length) return
    try {
      const fc = { type: 'FeatureCollection', features }
      const bounds = L.geoJSON(fc as any).getBounds()
      if (bounds.isValid()) {
        if (typeof (map as any).flyToBounds === 'function') (map as any).flyToBounds(bounds, { padding: [24, 24], maxZoom: 16, duration: 0.75 })
        else map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 })
      }
    } catch {}
  }

  const getDrawableLayers = useCallback(() => {
    const fg = drawingFeatureGroupRef.current
    if (!fg) return [] as any[]
    try {
      return fg.getLayers().filter((l: any) => !(l && typeof l === 'object' && (l as any).__isCircleCenter))
    } catch {
      return [] as any[]
    }
  }, [])

  const snapshotDrawing = useCallback(() => {
    const fg = drawingFeatureGroupRef.current
    if (!fg) return null
    try {
      const layers = fg.getLayers().filter((l: any) => !(l && typeof l === 'object' && (l as any).__isCircleCenter))
      const snap = layers.map((layer: any) => {
        const style = layer?.options && typeof layer.options === 'object' ? { ...layer.options } : null
        if (layer instanceof (L as any).Circle) {
          return { kind: 'circle', latlng: layer.getLatLng(), radius: layer.getRadius(), style }
        }
        if (layer instanceof (L as any).Marker) {
          const latlng = layer.getLatLng()
          const tooltip = (layer as any).getTooltip?.()
          const tooltipContent = tooltip ? tooltip.getContent?.() : null
          const tooltipOpts = tooltip ? tooltip.options : null
          return { kind: 'marker', latlng, style, tooltipContent, tooltipOpts }
        }
        if (layer?.toGeoJSON) {
          return { kind: 'geojson', geojson: layer.toGeoJSON(), style }
        }
        return { kind: 'unknown' }
      })
      return snap
    } catch {
      return null
    }
  }, [])

  const zoomToDrawing = useCallback((layer?: any | null) => {
    const map = mapRef.current as any
    if (!map) return
    const target = layer ?? drawingSelected ?? null
    const tryZoom = (l: any) => {
      try {
        if (l?.getBounds) {
          const b = l.getBounds()
          if (b?.isValid?.()) {
            if (typeof map.flyToBounds === 'function') map.flyToBounds(b, { padding: [80, 80], maxZoom: 18, duration: 0.8 })
            else map.fitBounds(b, { padding: [80, 80], maxZoom: 18 })
            return true
          }
        }
      } catch {
      }
      try {
        if (l?.getLatLng) {
          const ll = l.getLatLng()
          if (ll && typeof ll.lat === 'number' && typeof ll.lng === 'number') {
            if (typeof map.flyTo === 'function') map.flyTo(ll, Math.max(map.getZoom?.() ?? 0, 17), { duration: 0.8 })
            else map.setView(ll, Math.max(map.getZoom?.() ?? 0, 17))
            return true
          }
        }
      } catch {
      }
      return false
    }

    if (target && tryZoom(target)) return

    const layers = getDrawableLayers()
    if (!layers.length) return
    try {
      const group = L.featureGroup(layers)
      const b = group.getBounds()
      if (b?.isValid?.()) {
        if (typeof map.flyToBounds === 'function') map.flyToBounds(b, { padding: [80, 80], maxZoom: 18, duration: 0.8 })
        else map.fitBounds(b, { padding: [80, 80], maxZoom: 18 })
      }
    } catch {
    }
  }, [drawingSelected, getDrawableLayers])

  const restoreDrawing = useCallback((snap: any[] | null) => {
    const fg = drawingFeatureGroupRef.current
    const map = mapRef.current as any
    if (!fg || !snap) return
    try {
      fg.clearLayers()
    } catch {
      return
    }
    for (const item of snap) {
      try {
        if (item?.kind === 'circle' && item.latlng && typeof item.radius === 'number') {
          const circle = L.circle(item.latlng, { ...(item.style ?? {}), radius: item.radius })
          circle.on('click', () => {
            setDrawingSelected(circle)
            zoomToDrawing(circle)
          })
          fg.addLayer(circle)
          const centerMarker = L.marker(circle.getLatLng(), { interactive: true })
          ;(centerMarker as any).__isCircleCenter = true
          ;(centerMarker as any).__parentCircle = circle
          ;(circle as any).centerMarker = centerMarker
          centerMarker.on('click', () => {
            setDrawingSelected(circle)
            zoomToDrawing(circle)
          })
          fg.addLayer(centerMarker)
        } else if (item?.kind === 'marker' && item.latlng) {
          const marker = L.marker(item.latlng, { ...(item.style ?? {}), interactive: true })
          if (item.tooltipContent) {
            marker.bindTooltip(item.tooltipContent, item.tooltipOpts ?? { permanent: true, direction: 'top' })
          }
          marker.on('click', () => {
            setDrawingSelected(marker)
            zoomToDrawing(marker)
          })
          fg.addLayer(marker)
        } else if (item?.kind === 'geojson' && item.geojson) {
          const group = L.geoJSON(item.geojson as any, {
            style: () => (item.style ?? {}),
            pointToLayer: (_: any, latlng: any) => L.marker(latlng, { interactive: true }),
          })
          group.eachLayer((l: any) => {
            try {
              l.on?.('click', () => {
                setDrawingSelected(l)
                zoomToDrawing(l)
              })
            } catch {
            }
            fg.addLayer(l)
          })
        }
      } catch {
      }
    }
    try {
      const count = fg.getLayers().filter((l: any) => !(l && typeof l === 'object' && (l as any).__isCircleCenter)).length
      setDrawingCount(count)
    } catch {
    }
    try {
      if (map?.invalidateSize) map.invalidateSize()
    } catch {
    }
  }, [zoomToDrawing])

  const applyDrawingColor = useCallback((nextColor: string) => {
    const layers = getDrawableLayers()
    for (const l of layers) {
      try {
        if (l?.setStyle) {
          l.setStyle({ color: nextColor, fillColor: nextColor })
        }
      } catch {
      }
    }
    setDrawingDirty(true)
  }, [getDrawableLayers])

  const openDrawingEditor = useCallback(() => {
    if (!drawingCount) return
    drawingSnapshotRef.current = snapshotDrawing()
    setDrawingIsEditing(true)
    setDrawingDirty(false)
    setDrawingEditorOpen(true)
    setDrawingActiveTool('edit')
  }, [drawingCount, snapshotDrawing])

  const closeDrawingEditor = useCallback(() => {
    if (drawingDirty) {
      setDrawingConfirm({ kind: 'discard' })
      return
    }
    setDrawingIsEditing(false)
    setDrawingEditorOpen(false)
    setDrawingActiveTool(null)
    drawingSnapshotRef.current = null
  }, [drawingDirty])

  const goHome = () => {
    const map = mapRef.current
    if (!map) return
    try {
      map.setView([20, 0], initialZoom)
    } catch {}
  }

  const startTableResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startY = e.clientY
    const startHeight = tableDockHeight
    const maxHeight = Math.max(220, Math.round(window.innerHeight * 0.75))

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientY - startY
      const next = Math.max(180, Math.min(maxHeight, Math.round(startHeight - delta)))
      setTableDockHeight(next)
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
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

  const sanitizeFileName = (name: string) => {
    const trimmed = name.trim() || 'layer'
    const cleaned = trimmed.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ')
    return cleaned.length > 80 ? cleaned.slice(0, 80).trim() : cleaned
  }

  const downloadTextFile = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const getNumericFields = (data: any) => {
    const features = Array.isArray(data?.features) ? (data.features as any[]) : []
    const counts = new Map<string, { numeric: number; total: number }>()
    for (let i = 0; i < Math.min(features.length, 200); i += 1) {
      const props = features[i]?.properties
      if (!props || typeof props !== 'object') continue
      Object.entries(props).forEach(([k, v]) => {
        const cur = counts.get(k) ?? { numeric: 0, total: 0 }
        cur.total += 1
        if (typeof v === 'number' && Number.isFinite(v)) cur.numeric += 1
        counts.set(k, cur)
      })
    }
    return Array.from(counts.entries())
      .filter(([, v]) => v.total > 0 && v.numeric / v.total >= 0.6)
      .map(([k]) => k)
      .sort((a, b) => a.localeCompare(b))
  }

  const clampInt = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(n)))

  const normalizeSymbology = (layer: LayerData, cfg?: SymbologyConfig): Required<SymbologyConfig> => {
    const allFields = getGeoJsonFields(layer.data)
    const numericFields = getNumericFields(layer.data)
    const baseUseArcGisOnline = layer.source === 'arcgis'
    const style = (cfg?.style as SymbologyStyle) || 'color'
    const cfgField = typeof cfg?.field === 'string' ? cfg.field : ''
    const field =
      style === 'unique'
        ? cfgField || allFields[0] || numericFields[0] || ''
        : numericFields.includes(cfgField)
          ? cfgField
          : numericFields[0] || ''
    const next: Required<SymbologyConfig> = {
      useArcGisOnline: typeof cfg?.useArcGisOnline === 'boolean' ? cfg.useArcGisOnline : baseUseArcGisOnline,
      style,
      field,
      classes: clampInt(typeof cfg?.classes === 'number' ? cfg.classes : style === 'unique' ? 12 : 5, 2, 12),
      method: (cfg?.method as SymbologyClassMethod) || 'jenks',
      colorRamp: (cfg?.colorRamp as SymbologyColorRamp) || 'viridis',
      threshold: typeof cfg?.threshold === 'number' && Number.isFinite(cfg.threshold) ? cfg.threshold : Number.NaN,
    }
    if (!baseUseArcGisOnline) next.useArcGisOnline = false
    return next
  }

  const hexToRgb = (hex: string) => {
    const cleaned = hex.trim().replace('#', '')
    if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null
    const r = parseInt(cleaned.slice(0, 2), 16)
    const g = parseInt(cleaned.slice(2, 4), 16)
    const b = parseInt(cleaned.slice(4, 6), 16)
    return { r, g, b }
  }

  const rgbToHex = (r: number, g: number, b: number) => {
    const to = (v: number) => clampInt(v, 0, 255).toString(16).padStart(2, '0')
    return `#${to(r)}${to(g)}${to(b)}`
  }

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t

  const getRampStops = (ramp: SymbologyColorRamp) => {
    switch (ramp) {
      case 'blues':
        return ['#eff6ff', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a']
      case 'greens':
        return ['#f0fdf4', '#bbf7d0', '#4ade80', '#16a34a', '#14532d']
      case 'plasma':
        return ['#0d0887', '#7e03a8', '#cc4778', '#f89540', '#f0f921']
      case 'magma':
        return ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf']
      case 'turbo':
        return ['#30123b', '#3b4cc0', '#26a6d1', '#3de07e', '#f9e721', '#f20c0c']
      case 'viridis':
      default:
        return ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725']
    }
  }

  const sampleRamp = (ramp: SymbologyColorRamp, n: number) => {
    const count = clampInt(n, 2, 12)
    const stops = getRampStops(ramp).map(c => hexToRgb(c)).filter(Boolean) as Array<{ r: number; g: number; b: number }>
    if (stops.length < 2) return Array.from({ length: count }, () => '#22c55e')
    const out: string[] = []
    for (let i = 0; i < count; i += 1) {
      const t = count === 1 ? 0 : i / (count - 1)
      const pos = t * (stops.length - 1)
      const idx = Math.floor(pos)
      const frac = pos - idx
      const a = stops[idx]
      const b = stops[Math.min(stops.length - 1, idx + 1)]
      out.push(rgbToHex(lerp(a.r, b.r, frac), lerp(a.g, b.g, frac), lerp(a.b, b.b, frac)))
    }
    return out
  }

  const quantileAt = (sorted: number[], q: number) => {
    if (sorted.length === 0) return 0
    const pos = (sorted.length - 1) * q
    const base = Math.floor(pos)
    const rest = pos - base
    const a = sorted[base]
    const b = sorted[Math.min(sorted.length - 1, base + 1)]
    return lerp(a, b, rest)
  }

  const jenksBreaks = (data: number[], nClasses: number) => {
    const sorted = [...data].filter(v => Number.isFinite(v)).sort((a, b) => a - b)
    if (sorted.length === 0) return [0, 0]
    const k = clampInt(nClasses, 2, 12)
    const n = sorted.length
    const mat1: number[][] = Array.from({ length: n + 1 }, () => Array(k + 1).fill(0))
    const mat2: number[][] = Array.from({ length: n + 1 }, () => Array(k + 1).fill(0))
    for (let i = 1; i <= k; i += 1) {
      mat1[0][i] = 1
      mat2[0][i] = 0
      for (let j = 1; j <= n; j += 1) mat2[j][i] = Infinity
    }
    let v = 0
    for (let l = 1; l <= n; l += 1) {
      let s1 = 0
      let s2 = 0
      let w = 0
      for (let m = 1; m <= l; m += 1) {
        const i3 = l - m + 1
        const val = sorted[i3 - 1]
        s2 += val * val
        s1 += val
        w += 1
        v = s2 - (s1 * s1) / w
        const i4 = i3 - 1
        if (i4 !== 0) {
          for (let j = 2; j <= k; j += 1) {
            if (mat2[l][j] >= v + mat2[i4][j - 1]) {
              mat1[l][j] = i3
              mat2[l][j] = v + mat2[i4][j - 1]
            }
          }
        }
      }
      mat1[l][1] = 1
      mat2[l][1] = v
    }
    const breaks: number[] = Array(k + 1).fill(0)
    breaks[k] = sorted[n - 1]
    breaks[0] = sorted[0]
    let countK = k
    let kIdx = n
    while (countK > 1) {
      const id = mat1[kIdx][countK] - 1
      breaks[countK - 1] = sorted[id]
      kIdx = mat1[kIdx][countK] - 1
      countK -= 1
    }
    return breaks
  }

  const computeBreaks = (values: number[], classes: number, method: SymbologyClassMethod) => {
    const cleaned = values.filter(v => Number.isFinite(v))
    if (cleaned.length === 0) return [0, 0]
    const k = clampInt(classes, 2, 12)
    const sorted = [...cleaned].sort((a, b) => a - b)
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    if (min === max) return Array.from({ length: k + 1 }, (_, i) => (i === 0 ? min : max))
    if (method === 'equal_interval') {
      const step = (max - min) / k
      return Array.from({ length: k + 1 }, (_, i) => (i === k ? max : min + step * i))
    }
    if (method === 'quantile') {
      const out: number[] = [min]
      for (let i = 1; i < k; i += 1) out.push(quantileAt(sorted, i / k))
      out.push(max)
      return out
    }
    return jenksBreaks(sorted, k)
  }

  const getClassIndex = (value: number, breaks: number[]) => {
    if (!Number.isFinite(value) || breaks.length < 2) return 0
    for (let i = 0; i < breaks.length - 1; i += 1) {
      const a = breaks[i]
      const b = breaks[i + 1]
      if (i === breaks.length - 2) return value <= b ? i : i
      if (value >= a && value < b) return i
    }
    return breaks.length - 2
  }

  const getGeometryCenter = (geom: any): [number, number] | null => {
    if (!geom || typeof geom !== 'object') return null
    const t = geom.type
    const c = geom.coordinates
    const pickMid = (coords: any[]) => {
      if (!Array.isArray(coords) || coords.length === 0) return null
      const mid = coords[Math.floor(coords.length / 2)]
      if (!Array.isArray(mid) || mid.length < 2) return null
      return [mid[0], mid[1]] as [number, number]
    }
    if (t === 'Point') return Array.isArray(c) && c.length >= 2 ? ([c[0], c[1]] as [number, number]) : null
    if (t === 'LineString') return pickMid(c)
    if (t === 'MultiLineString') return Array.isArray(c) && c.length ? pickMid(c[0]) : null
    if (t === 'Polygon') return Array.isArray(c) && c.length ? pickMid(c[0]) : null
    if (t === 'MultiPolygon') return Array.isArray(c) && c.length && c[0]?.length ? pickMid(c[0][0]) : null
    return null
  }

  const getGeometryKind = (geomType: any): 'point' | 'line' | 'polygon' | 'other' => {
    if (typeof geomType !== 'string') return 'other'
    if (geomType === 'Point' || geomType === 'MultiPoint') return 'point'
    if (geomType === 'LineString' || geomType === 'MultiLineString') return 'line'
    if (geomType === 'Polygon' || geomType === 'MultiPolygon') return 'polygon'
    return 'other'
  }

  const getLayerGeometryKind = (data: any): 'point' | 'line' | 'polygon' | 'other' => {
    const features = Array.isArray(data?.features) ? (data.features as any[]) : []
    for (let i = 0; i < Math.min(features.length, 50); i += 1) {
      const t = features[i]?.geometry?.type
      const kind = getGeometryKind(t)
      if (kind !== 'other') return kind
    }
    return 'other'
  }

  const darkenColor = (hex: string, amount: number) => {
    const rgb = hexToRgb(hex)
    if (!rgb) return hex
    const t = Math.max(0, Math.min(1, amount))
    return rgbToHex(rgb.r * (1 - t), rgb.g * (1 - t), rgb.b * (1 - t))
  }

  const esriColorToRgbHexAndOpacity = (c: any, layerOpacity: number) => {
    const o = typeof layerOpacity === 'number' && Number.isFinite(layerOpacity) ? Math.max(0, Math.min(1, layerOpacity)) : 1
    if (!Array.isArray(c) || c.length < 3) return { hex: '#22c55e', opacity: o }
    const r = clampInt(Number(c[0]), 0, 255)
    const g = clampInt(Number(c[1]), 0, 255)
    const b = clampInt(Number(c[2]), 0, 255)
    const a = c.length >= 4 ? clampInt(Number(c[3]), 0, 255) : 255
    return { hex: rgbToHex(r, g, b), opacity: (a / 255) * o }
  }

  const esriLineStyleToDashArray = (style: any, width: number) => {
    const w = Math.max(1, Number.isFinite(width) ? width : 2)
    switch (style) {
      case 'esriSLSDash':
        return `${w * 4} ${w * 3}`
      case 'esriSLSDashDot':
        return `${w * 4} ${w * 2} ${w} ${w * 2}`
      case 'esriSLSDashDotDot':
        return `${w * 4} ${w * 2} ${w} ${w * 2} ${w} ${w * 2}`
      case 'esriSLSDot':
        return `${w} ${w * 2.5}`
      case 'esriSLSLongDash':
        return `${w * 7} ${w * 3}`
      case 'esriSLSLongDashDot':
        return `${w * 7} ${w * 2.5} ${w} ${w * 2.5}`
      case 'esriSLSShortDash':
        return `${w * 3} ${w * 2.5}`
      case 'esriSLSShortDashDot':
        return `${w * 3} ${w * 2} ${w} ${w * 2}`
      case 'esriSLSShortDashDotDot':
        return `${w * 3} ${w * 2} ${w} ${w * 2} ${w} ${w * 2}`
      case 'esriSLSShortDot':
        return `${w} ${w * 1.6}`
      case 'esriSLSNull':
        return '0 1000'
      case 'esriSLSSolid':
      default:
        return undefined
    }
  }

  const resolveArcGisSymbolUrl = (layer: LayerData, rawUrl: string) => {
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : ''
    if (!url) return ''
    if (url.startsWith('data:') || url.startsWith('blob:')) return url
    const normalized = url.startsWith('//') ? `${window.location.protocol}${url}` : url
    try {
      const base = typeof layer.url === 'string' && layer.url.trim() ? `${layer.url.replace(/\/+$/, '')}/` : window.location.origin
      const u = new URL(normalized, base)

      const isHttpsApp = window.location.protocol === 'https:'
      const isHttpSymbol = u.protocol === 'http:'
      const isArcGisHost = u.hostname === 'static.arcgis.com' || /(^|\.)arcgis\.com$/i.test(u.hostname) || /(^|\.)arcgisonline\.com$/i.test(u.hostname)
      if (isHttpsApp && isHttpSymbol && isArcGisHost) u.protocol = 'https:'

      const token = typeof layer.authToken === 'string' ? layer.authToken.trim() : ''
      if (token && !u.searchParams.has('token')) {
        let allowToken = isArcGisHost
        try {
          if (!allowToken && typeof layer.url === 'string' && layer.url.trim()) {
            const serviceHost = new URL(layer.url).hostname
            allowToken = serviceHost === u.hostname
          }
        } catch {}
        if (allowToken) u.searchParams.set('token', token)
      }

      return u.toString()
    } catch {
      return normalized
    }
  }

  const getArcGisRendererSymbolForFeature = (renderer: any, feature: any) => {
    const type = renderer?.type
    if (type === 'simple') return renderer?.symbol ?? null
    if (type === 'uniqueValue') {
      const f1 = typeof renderer?.field1 === 'string' ? renderer.field1 : ''
      const f2 = typeof renderer?.field2 === 'string' ? renderer.field2 : ''
      const f3 = typeof renderer?.field3 === 'string' ? renderer.field3 : ''
      const delim = typeof renderer?.fieldDelimiter === 'string' ? renderer.fieldDelimiter : ', '
      const parts = [f1, f2, f3].filter(Boolean).map(f => feature?.properties?.[f])
      const val = parts.map(v => (v === null || v === undefined ? '' : String(v))).join(delim)
      const infos = Array.isArray(renderer?.uniqueValueInfos) ? renderer.uniqueValueInfos : []
      const found = infos.find((i: any) => String(i?.value ?? '') === val)
      return found?.symbol ?? renderer?.defaultSymbol ?? null
    }
    if (type === 'classBreaks') {
      const f = typeof renderer?.field === 'string' ? renderer.field : ''
      const raw = f ? feature?.properties?.[f] : undefined
      const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw)
      if (!Number.isFinite(v)) return renderer?.defaultSymbol ?? null
      const infos = Array.isArray(renderer?.classBreakInfos) ? renderer.classBreakInfos : []
      const found = infos.find((i: any) => typeof i?.classMaxValue === 'number' && v <= i.classMaxValue)
      return found?.symbol ?? renderer?.defaultSymbol ?? null
    }
    if (type === 'heatmap') return null
    return renderer?.symbol ?? null
  }

  const arcGisSymbolToLeaflet = (
    symbol: any,
    geometryKind: 'point' | 'line' | 'polygon',
    layerOpacity: number,
    fallbackStroke: string,
    fallbackFill: string,
  ) => {
    const baseOpacity = typeof layerOpacity === 'number' && Number.isFinite(layerOpacity) ? Math.max(0, Math.min(1, layerOpacity)) : 1
    const mkPath = (partial: any) => ({
      color: fallbackStroke,
      weight: 2,
      opacity: baseOpacity,
      fillColor: fallbackFill,
      fillOpacity: geometryKind === 'polygon' ? 0.35 * baseOpacity : 0,
      ...partial,
    })

    if (!symbol || typeof symbol !== 'object') return { path: mkPath({}) }

    if (geometryKind === 'point') {
      const st = symbol?.type
      if (st === 'esriPMS' && typeof symbol?.imageData === 'string' && symbol.imageData) {
        const contentType = typeof symbol?.contentType === 'string' && symbol.contentType ? symbol.contentType : 'image/png'
        const dataUrl = `data:${contentType};base64,${symbol.imageData}`
        const w = Number.isFinite(symbol?.width) ? Math.max(1, symbol.width) : Number.isFinite(symbol?.size) ? symbol.size : 24
        const h = Number.isFinite(symbol?.height) ? Math.max(1, symbol.height) : Number.isFinite(symbol?.size) ? symbol.size : 24
        return {
          point: {
            kind: 'icon',
            url: dataUrl,
            size: [w, h] as [number, number],
            anchor: [w / 2, h / 2] as [number, number],
            opacity: baseOpacity,
          },
        }
      }
      if (st === 'esriPMS' && typeof symbol?.url === 'string' && symbol.url) {
        const w = Number.isFinite(symbol?.width) ? Math.max(1, symbol.width) : Number.isFinite(symbol?.size) ? symbol.size : 24
        const h = Number.isFinite(symbol?.height) ? Math.max(1, symbol.height) : Number.isFinite(symbol?.size) ? symbol.size : 24
        return {
          point: {
            kind: 'icon',
            url: symbol.url,
            size: [w, h] as [number, number],
            anchor: [w / 2, h / 2] as [number, number],
            opacity: baseOpacity,
          },
        }
      }
      if (st === 'esriSMS') {
        const fill = esriColorToRgbHexAndOpacity(symbol?.color, baseOpacity)
        const outline = symbol?.outline
        const stroke = outline?.color ? esriColorToRgbHexAndOpacity(outline.color, baseOpacity) : { hex: fallbackStroke, opacity: baseOpacity }
        const weight = Number.isFinite(outline?.width) ? Math.max(1, outline.width) : 1.5
        const size = Number.isFinite(symbol?.size) ? Math.max(2, symbol.size) : 10
        const radius = Math.max(2, Math.min(18, size / 2))
        return {
          point: {
            kind: 'circle',
            options: {
              radius,
              color: stroke.hex,
              weight,
              opacity: stroke.opacity,
              fillColor: fill.hex,
              fillOpacity: fill.opacity,
            },
          },
        }
      }
    }

    if (geometryKind === 'line') {
      const st = symbol?.type
      if (st === 'esriSLS') {
        const c = esriColorToRgbHexAndOpacity(symbol?.color, baseOpacity)
        const w = Number.isFinite(symbol?.width) ? Math.max(1, symbol.width) : 2
        const dashArray = esriLineStyleToDashArray(symbol?.style, w)
        return { path: mkPath({ color: c.hex, opacity: c.opacity, weight: w, fillOpacity: 0, dashArray }) }
      }
    }

    if (geometryKind === 'polygon') {
      const st = symbol?.type
      if (st === 'esriSFS') {
        const fill = esriColorToRgbHexAndOpacity(symbol?.color, baseOpacity)
        const outline = symbol?.outline
        const stroke = outline?.color ? esriColorToRgbHexAndOpacity(outline.color, baseOpacity) : { hex: darkenColor(fill.hex, 0.25), opacity: baseOpacity }
        const w = Number.isFinite(outline?.width) ? Math.max(1, outline.width) : 1.5
        const dashArray = esriLineStyleToDashArray(outline?.style, w)
        return { path: mkPath({ color: stroke.hex, opacity: stroke.opacity, weight: w, fillColor: fill.hex, fillOpacity: fill.opacity, dashArray }) }
      }
    }

    return { path: mkPath({}) }
  }

  const getArcGisPathStyleForFeature = (layer: LayerData, feature: any) => {
    const renderer = layer.arcgisRenderer ?? layer.arcgisLayerDefinition?.drawingInfo?.renderer
    if (!renderer) return null
    const kind = getGeometryKind(feature?.geometry?.type)
    if (kind !== 'line' && kind !== 'polygon') return null
    const symbol = getArcGisRendererSymbolForFeature(renderer, feature)
    const baseStroke = layer.color || '#22c55e'
    const baseFill = layer.fillColor || layer.color || '#22c55e'
    const res = arcGisSymbolToLeaflet(symbol, kind, layer.opacity, baseStroke, baseFill)
    return res.path ?? null
  }

  const getArcGisPointLayer = (layer: LayerData, feature: any, latlng: any) => {
    const renderer = layer.arcgisRenderer ?? layer.arcgisLayerDefinition?.drawingInfo?.renderer
    if (!renderer) return null
    if (getGeometryKind(feature?.geometry?.type) !== 'point') return null
    const symbol = getArcGisRendererSymbolForFeature(renderer, feature)
    const baseStroke = layer.color || '#22c55e'
    const baseFill = layer.fillColor || layer.color || '#22c55e'
    const res = arcGisSymbolToLeaflet(symbol, 'point', layer.opacity, baseStroke, baseFill)
    if (!res.point) return null
    if (res.point.kind === 'icon') {
      const iconUrl = resolveArcGisSymbolUrl(layer, res.point.url)
      const icon = L.icon({ iconUrl, iconSize: res.point.size, iconAnchor: res.point.anchor })
      return L.marker(latlng, { icon, opacity: res.point.opacity })
    }
    return L.circleMarker(latlng, res.point.options as any)
  }

  const dialogLayer = useMemo(() => {
    if (!layerDialog) return null
    return layers.find(l => String(l.id) === layerDialog.layerId) ?? null
  }, [layerDialog, layers])

  const symbologyLayer = useMemo(() => {
    if (!symbologyDialog) return null
    return layers.find(l => String(l.id) === symbologyDialog.layerId) ?? null
  }, [symbologyDialog, layers])

  const setHiddenFieldsForLayer = useCallback((layerId: string, next: Set<string>) => {
    setHiddenTableFieldsByLayerId(prev => {
      const safe = new Set(next)
      return { ...prev, [String(layerId)]: safe }
    })
  }, [])

  type SymbologyContext = {
    cfg: Required<SymbologyConfig>
    geometryKind: 'point' | 'line' | 'polygon' | 'other'
    values: number[]
    breaks: number[]
    colors: string[]
    widths: number[]
    categories: string[]
    categoryColors: Record<string, string>
    uniqueDashes: Record<string, string>
    dotDashes: string[]
    otherColor: string
    threshold: number
    thresholdPoints?: any
  }

  const symbologyContexts = useMemo(() => {
    const dashPatterns = ['', '8 4', '2 3', '10 3 2 3', '1 4', '14 4', '4 2 1 2', '12 2 4 2']
    const toWidths = (k: number) => {
      const minW = 1.5
      const maxW = 6
      const out: number[] = []
      for (let i = 0; i < k; i += 1) out.push(lerp(minW, maxW, k === 1 ? 0 : i / (k - 1)))
      return out
    }
    const dotDashes = (k: number) => {
      const presets = ['1 10', '1 7', '1 5', '1 3.5', '1 2.5', '1 2', '1 1.6', '1 1.3', '1 1.1']
      return presets.slice(0, clampInt(k, 3, 9))
    }
    const m = new Map<string, SymbologyContext>()
    for (const layer of layers) {
      if (layer.type !== 'geojson' || !layer.data) continue
      const id = String(layer.id)
      const cfg = normalizeSymbology(layer, layer.symbology)
      const geometryKind = getLayerGeometryKind(layer.data)
      const features = Array.isArray((layer.data as any)?.features) ? ((layer.data as any).features as any[]) : []
      const values: number[] = []
      if (cfg.field && cfg.style !== 'unique') {
        for (let i = 0; i < Math.min(features.length, 5000); i += 1) {
          const v = features[i]?.properties?.[cfg.field]
          if (typeof v === 'number' && Number.isFinite(v)) values.push(v)
        }
      }
      const classes = clampInt(cfg.classes, 2, 12)
      const breaks = values.length ? computeBreaks(values, classes, cfg.method) : [0, 0]
      const colors = sampleRamp(cfg.colorRamp, classes)
      const widths = toWidths(classes)
      const otherColor = '#94a3b8'
      const categories: string[] = []
      const categoryColors: Record<string, string> = {}
      const uniqueDashes: Record<string, string> = {}
      if (cfg.style === 'unique' && cfg.field) {
        const counts = new Map<string, number>()
        for (let i = 0; i < Math.min(features.length, 5000); i += 1) {
          const raw = features[i]?.properties?.[cfg.field]
          if (raw === null || raw === undefined || raw === '') continue
          const key = String(raw)
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
        const maxCats = clampInt(cfg.classes, 2, 12)
        const sortedCats = Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([k]) => k)
          .slice(0, maxCats)
        categories.push(...sortedCats)
        if (geometryKind === 'line') {
          categories.slice(0, dashPatterns.length).forEach((v, idx) => {
            uniqueDashes[v] = dashPatterns[idx] ?? ''
          })
        } else {
          const palette = sampleRamp(cfg.colorRamp, Math.max(2, categories.length))
          categories.forEach((v, idx) => {
            categoryColors[v] = palette[idx % palette.length] ?? otherColor
          })
        }
      }
      const dots = dotDashes(classes)
      let threshold = cfg.threshold
      if (!Number.isFinite(threshold) && values.length) {
        const sorted = [...values].sort((a, b) => a - b)
        threshold = quantileAt(sorted, 0.8)
      }
      const ctx: SymbologyContext = {
        cfg,
        geometryKind,
        values,
        breaks,
        colors,
        widths,
        categories,
        categoryColors,
        uniqueDashes,
        dotDashes: dots,
        otherColor,
        threshold: Number.isFinite(threshold) ? threshold : 0,
      }
      if (cfg.style === 'threshold_markers' && cfg.field && values.length) {
        const pts: any[] = []
        for (let i = 0; i < Math.min(features.length, 5000); i += 1) {
          const ft = features[i]
          const v = ft?.properties?.[cfg.field]
          if (typeof v !== 'number' || !Number.isFinite(v) || v < ctx.threshold) continue
          const center = getGeometryCenter(ft?.geometry)
          if (!center) continue
          pts.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: center },
            properties: { __value: v },
          })
        }
        ctx.thresholdPoints = { type: 'FeatureCollection', features: pts }
      }
      m.set(id, ctx)
    }
    return m
  }, [symbologySignature])

  const getFeatureStyle = (layer: LayerData, feature: any) => {
    const baseStroke = layer.color || '#22c55e'
    const baseFill = layer.fillColor || layer.color || '#22c55e'
    const baseWeight = layer.weight ?? 2
    const baseOpacity = typeof layer.opacity === 'number' && Number.isFinite(layer.opacity) ? Math.max(0, Math.min(1, layer.opacity)) : 1
    const geometryKind = getGeometryKind(feature?.geometry?.type)
    const ctx = symbologyContexts.get(String(layer.id))
    const base: any = {
      color: baseStroke,
      weight: baseWeight,
      opacity: baseOpacity,
      fillColor: baseFill,
      fillOpacity: geometryKind === 'polygon' ? 0.35 * baseOpacity : geometryKind === 'point' ? 0.7 * baseOpacity : 0,
    }
    if (geometryKind !== 'polygon') base.fillOpacity = 0
    if (!ctx || ctx.cfg.useArcGisOnline) {
      const arc = getArcGisPathStyleForFeature(layer, feature)
      return arc ?? base
    }

    if (ctx.cfg.style === 'unique') {
      const raw = ctx.cfg.field ? feature?.properties?.[ctx.cfg.field] : undefined
      const key = raw === null || raw === undefined || raw === '' ? 'Other' : String(raw)
      if (geometryKind === 'line') {
        return { ...base, dashArray: ctx.uniqueDashes[key] ?? '', lineCap: 'round', fillOpacity: 0 }
      }
      const fill = ctx.categoryColors[key] ?? ctx.otherColor
      const stroke = darkenColor(fill, 0.25)
      if (geometryKind === 'polygon') return { ...base, color: stroke, fillColor: fill, fillOpacity: 0.35 * baseOpacity }
      return { ...base, color: stroke, fillColor: fill, fillOpacity: 0 }
    }

    const vRaw = ctx.cfg.field ? feature?.properties?.[ctx.cfg.field] : undefined
    const v = typeof vRaw === 'number' && Number.isFinite(vRaw) ? vRaw : null
    const idx = v === null ? 0 : getClassIndex(v, ctx.breaks)
    const classColor = ctx.colors[idx] ?? baseStroke
    const classWidth = ctx.widths[idx] ?? baseWeight

    if (ctx.cfg.style === 'color') {
      if (geometryKind === 'polygon') return { ...base, color: darkenColor(classColor, 0.25), fillColor: classColor, fillOpacity: 0.35 * baseOpacity }
      if (geometryKind === 'line') return { ...base, color: classColor, fillOpacity: 0 }
      return base
    }

    if (ctx.cfg.style === 'size') {
      if (geometryKind === 'polygon') return { ...base, weight: classWidth, fillColor: baseFill, fillOpacity: 0.35 * baseOpacity }
      if (geometryKind === 'line') return { ...base, weight: classWidth, fillOpacity: 0 }
      return base
    }

    if (ctx.cfg.style === 'color_size') {
      if (geometryKind === 'polygon')
        return { ...base, color: darkenColor(classColor, 0.25), fillColor: classColor, weight: classWidth, fillOpacity: 0.35 * baseOpacity }
      if (geometryKind === 'line') return { ...base, color: classColor, weight: classWidth, fillOpacity: 0 }
      return base
    }

    if (ctx.cfg.style === 'dot_density') {
      if (geometryKind === 'polygon') return { ...base, dashArray: ctx.dotDashes[idx] ?? '1 5', lineCap: 'round', fillColor: baseFill, fillOpacity: 0.35 * baseOpacity }
      if (geometryKind === 'line') return { ...base, dashArray: ctx.dotDashes[idx] ?? '1 5', lineCap: 'round', fillOpacity: 0 }
      return base
    }

    if (ctx.cfg.style === 'threshold_markers') {
      if (geometryKind === 'polygon') return { ...base, fillColor: baseFill, fillOpacity: 0.35 * baseOpacity }
      if (geometryKind === 'line') return { ...base, fillOpacity: 0 }
      return base
    }

    return base
  }

  const getPointMarkerOptions = (layer: LayerData, feature: any) => {
    const baseStroke = layer.color || '#22c55e'
    const baseFill = layer.fillColor || layer.color || '#22c55e'
    const baseWeight = layer.weight ?? 2
    const baseOpacity = typeof layer.opacity === 'number' && Number.isFinite(layer.opacity) ? Math.max(0, Math.min(1, layer.opacity)) : 1
    const ctx = symbologyContexts.get(String(layer.id))
    let radius = 6
    let color = baseStroke
    let fillColor = baseFill
    let weight = baseWeight
    let opacity = baseOpacity
    let fillOpacity = 0.7 * baseOpacity

    if (ctx && !ctx.cfg.useArcGisOnline) {
      if (ctx.cfg.style === 'unique') {
        const raw = ctx.cfg.field ? feature?.properties?.[ctx.cfg.field] : undefined
        const key = raw === null || raw === undefined || raw === '' ? 'Other' : String(raw)
        const fill = ctx.categoryColors[key] ?? ctx.otherColor
        fillColor = fill
        color = darkenColor(fill, 0.25)
        radius = 7
      } else {
        const vRaw = ctx.cfg.field ? feature?.properties?.[ctx.cfg.field] : undefined
        const v = typeof vRaw === 'number' && Number.isFinite(vRaw) ? vRaw : null
        const idx = v === null ? 0 : getClassIndex(v, ctx.breaks)
        const classColor = ctx.colors[idx] ?? baseStroke
        const classWidth = ctx.widths[idx] ?? baseWeight
        if (ctx.cfg.style === 'color') {
          fillColor = classColor
          color = darkenColor(classColor, 0.25)
        }
        if (ctx.cfg.style === 'size') radius = Math.max(4, Math.min(14, 3 + classWidth * 2))
        if (ctx.cfg.style === 'color_size') {
          fillColor = classColor
          color = darkenColor(classColor, 0.25)
          radius = Math.max(4, Math.min(14, 3 + classWidth * 2))
        }
        if (ctx.cfg.style === 'dot_density') radius = Math.max(4, Math.min(12, 4 + idx))
        if (ctx.cfg.style === 'threshold_markers' && v !== null && v >= ctx.threshold) {
          fillColor = '#ef4444'
          color = '#ef4444'
          radius = 8
        }
      }
    }

    return { radius, color, weight, opacity, fillColor, fillOpacity }
  }

  const applyLayerSymbology = (layerId: string, next?: SymbologyConfig) => {
    setLayers(prev =>
      prev.map(l => (String(l.id) === layerId ? { ...l, symbology: next && Object.keys(next).length ? next : undefined } : l)),
    )
  }

  const cancelSymbology = () => {
    if (!symbologyDialog) return
    applyLayerSymbology(symbologyDialog.layerId, symbologyDialog.original)
    setSymbologyDialog(null)
  }

  const saveSymbology = () => {
    setSymbologyDialog(null)
  }

  const updateSymbologyDraft = (patch: Partial<Required<SymbologyConfig>>) => {
    setSymbologyDialog(prev => {
      if (!prev) return prev
      const nextDraft: Required<SymbologyConfig> = { ...prev.draft, ...patch }
      const layer = symbologyLayer ?? layers.find(l => String(l.id) === prev.layerId)
      if (!layer) return prev
      const normalized = normalizeSymbology(layer, nextDraft)
      applyLayerSymbology(prev.layerId, normalized)
      return { ...prev, draft: normalized }
    })
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

  const discoverArcGisLayers = async () => {
    const base = normalizeArcGisServiceUrl(serviceUrl)
    if (!base) return
    setIsDiscovering(true)
    setDiscoverError(null)
    setDiscoveredLayers([])
    setSelectedDiscoveredUrl('')
    try {
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
      if (discovered.length === 0) {
        throw new Error('No layers/tables found in this service URL.')
      }
      setDiscoveredLayers(discovered)
      setSelectedDiscoveredUrl(discovered[0].url)
      setLayerName(prev => (prev.trim() ? prev : discovered[0].name))
    } catch (e: any) {
      setDiscoverError(typeof e?.message === 'string' ? e.message : 'Failed to connect to service.')
    } finally {
      setIsDiscovering(false)
    }
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
    if (!geojson || geojson.type !== 'FeatureCollection') {
      throw new Error('Service did not return GeoJSON.')
    }
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

  const extractArcGisPortalItemId = (def: any): string | undefined => {
    const direct = typeof def?.portalItem?.id === 'string' ? def.portalItem.id : undefined
    if (direct) return direct
    const serviceItemId = typeof def?.serviceItemId === 'string' ? def.serviceItemId : undefined
    if (serviceItemId) return serviceItemId
    const itemId = typeof def?.itemId === 'string' ? def.itemId : undefined
    if (itemId) return itemId
    return undefined
  }

  const syncArcGisLayer = async (layer: LayerData, opts?: { silent?: boolean }) => {
    const isArcGis = layer.source === 'arcgis' && typeof layer.url === 'string' && layer.url.trim() !== ''
    if (!isArcGis) return
    const layerKey = String(layer.id)
    if (!opts?.silent) setSyncingLayerKey(layerKey)
    try {
      const def = await fetchArcGisLayerDefinition(layer.url as string, layer.authToken).catch((e) => {
        console.error('ArcGIS layer definition fetch failed:', e)
        return null
      })
      const hasGeometry = (def?.type && String(def.type).toLowerCase() === 'table') ? false : typeof def?.geometryType === 'string' ? true : true
      const geojson = await fetchArcGisGeoJson(layer.url as string, layer.authToken, { returnGeometry: hasGeometry })
      setLayers(prev =>
        prev.map(l =>
          l.id === layer.id
            ? {
                ...l,
                data: geojson,
                arcgisLayerDefinition: def ?? l.arcgisLayerDefinition,
                arcgisRenderer: def?.drawingInfo?.renderer ?? l.arcgisRenderer,
                arcgisLabelingInfo: def?.drawingInfo?.labelingInfo ?? l.arcgisLabelingInfo,
                arcgisPortalItemId: (def ? extractArcGisPortalItemId(def) : undefined) ?? l.arcgisPortalItemId,
                arcgisStyleUrl: (typeof def?.styleUrl === 'string' ? def.styleUrl : undefined) ?? l.arcgisStyleUrl,
              }
            : l,
        ),
      )
    } catch (e) {
      if (!opts?.silent) {
        window.alert(e instanceof Error ? e.message : 'Failed to sync layer.')
      }
    } finally {
      if (!opts?.silent) setSyncingLayerKey(null)
    }
  }

  const addArcGisLayerAsGeoJson = async (l: { id: number; name: string; kind: 'layer' | 'table'; url: string }) => {
    const layerKey = `arcgis:${l.url}`
    setAddingLayerKey(layerKey)
    setDiscoverError(null)
    try {
      const def = await fetchArcGisLayerDefinition(l.url, token).catch((e) => {
        console.error('ArcGIS layer definition fetch failed:', e)
        return null
      })
      const hasGeometry = (def?.type && String(def.type).toLowerCase() === 'table') ? false : typeof def?.geometryType === 'string' ? true : l.kind !== 'table'
      const geojson = await fetchArcGisGeoJson(l.url, token, { returnGeometry: hasGeometry })
      const name = layerName.trim() || l.name
      const newLayer: LayerData = {
        id: layerKey,
        name,
        type: 'geojson',
        source: 'arcgis',
        visible: true,
        opacity: 1,
        data: geojson,
        url: l.url,
        authToken: token.trim() ? token.trim() : undefined,
        arcgisLayerDefinition: def ?? undefined,
        arcgisRenderer: def?.drawingInfo?.renderer ?? undefined,
        arcgisLabelingInfo: def?.drawingInfo?.labelingInfo ?? undefined,
        arcgisPortalItemId: def ? extractArcGisPortalItemId(def) : undefined,
        arcgisStyleUrl: typeof def?.styleUrl === 'string' ? def.styleUrl : undefined,
      }
      setLayers(prev => [...prev, newLayer])
      setIsAddOpen(false)
      setLayerName('')
      setServiceUrl('')
      setToken('')
      setDiscoveredLayers([])
      setSelectedDiscoveredUrl('')
    } catch (e: any) {
      setDiscoverError(typeof e?.message === 'string' ? e.message : 'Failed to add layer.')
    } finally {
      setAddingLayerKey(null)
    }
  }

  return (
    <div className={sidebarOpen ? 'gis-map-page' : 'gis-map-page sidebar-closed'}>
      {sidebarOpen ? (
        <aside className="gis-sidebar" aria-label="GIS Layers">
          <div className="gis-sidebar-header">
            <div className="gis-sidebar-title">
              <i className="fa-solid fa-layer-group" aria-hidden="true" />
              <span>GIS Layers</span>
            </div>
            <div className="gis-sidebar-actions" aria-label="Sidebar actions">
              <button className="gis-addlayer-btn" type="button" onClick={() => setIsAddOpen(true)} aria-label="Add layer">
                <i className="fa-solid fa-plus" aria-hidden="true" />
                Add Layer
              </button>
              <button
                className="gis-sidebar-close"
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close GIS Layers"
                title="Close"
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="gis-sidebar-body">
            {layers.length === 0 ? (
            <div className="gis-empty" role="status" aria-live="polite">
              <div className="gis-empty-title">No layers yet</div>
              <div className="gis-empty-sub">No layers yet. Add an ArcGIS connection or upload a file.</div>
            </div>
          ) : (
            <div className="gis-layer-list" role="list" aria-label="Layers list">
              {orderedLayers.map(layer => {
                const layerId = String(layer.id)
                const isMenuOpen = openLayerMenuId === layerId
                const featureCount = Array.isArray((layer.data as any)?.features) ? (layer.data as any).features.length : 0

                return (
                  <div key={layerId} role="listitem" className="gis-layer-card">
                    <div className="gis-layer-top">
                      <div className="gis-layer-header">
                        <button
                          className={layer.visible ? 'gis-layer-visibility-btn active' : 'gis-layer-visibility-btn'}
                          type="button"
                          aria-pressed={layer.visible}
                          onClick={() => setLayers(prev => prev.map(l => (l.id === layer.id ? { ...l, visible: !l.visible } : l)))}
                          aria-label={`Toggle ${layer.name}`}
                          title={layer.visible ? 'Hide layer' : 'Show layer'}
                        >
                          <i className={layer.visible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash'} aria-hidden="true" />
                        </button>
                        <span className="gis-layer-dot" aria-hidden="true" style={{ background: layer.color || '#22c55e' }} />
                        <span className="gis-layer-titlewrap">
                          <span className="gis-layer-name" title={layer.name}>
                            {layer.name}
                          </span>
                          <span className="gis-layer-meta" aria-label="Layer metadata">
                            <i
                              className={layer.source === 'arcgis' ? 'fa-solid fa-cloud' : 'fa-solid fa-file-arrow-up'}
                              aria-hidden="true"
                            />
                            <span>{(layer.source === 'arcgis' ? 'ArcGIS' : 'Upload') + ' - ' + featureCount + ' features'}</span>
                          </span>
                        </span>
                      </div>

                      <div
                        className="gis-layer-menu"
                        data-layer-menu-root={layerId}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          className={isMenuOpen ? 'gis-layer-menu-btn active' : 'gis-layer-menu-btn'}
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={isMenuOpen}
                          aria-label={`Options for ${layer.name}`}
                          title="Options"
                          onClick={(e) => {
                            const nextOpen = openLayerMenuId === layerId ? null : layerId
                            if (!nextOpen) {
                              setOpenLayerMenuId(null)
                              return
                            }
                            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                            const menuWidth = 220
                            const menuHeight = 360
                            const vw = window.innerWidth
                            const vh = window.innerHeight
                            let left = Math.min(rect.right - menuWidth, vw - menuWidth - 8)
                            left = Math.max(8, left)
                            let top = rect.bottom + 6
                            if (top + menuHeight > vh - 8) top = Math.max(8, rect.top - 6 - menuHeight)
                            setLayerMenuPos({ top, left })
                            setOpenLayerMenuId(nextOpen)
                          }}
                        >
                          <i className="fa-solid fa-ellipsis-vertical" aria-hidden="true" />
                        </button>

                        {isMenuOpen ? (
                          <div
                            className="gis-layer-menu-popover"
                            role="menu"
                            aria-label={`Layer options menu for ${layer.name}`}
                            style={layerMenuPos ? { position: 'fixed', top: layerMenuPos.top, left: layerMenuPos.left } : undefined}
                          >
                            <button
                              className="gis-layer-menu-item"
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenLayerMenuId(null)
                                zoomToLayer(layer)
                              }}
                            >
                              <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                              <span>Zoom to layer</span>
                            </button>

                            <button
                              className="gis-layer-menu-item"
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenLayerMenuId(null)
                                setLayerDialog({ mode: 'props', layerId })
                              }}
                            >
                              <i className="fa-solid fa-circle-info" aria-hidden="true" />
                              <span>Show properties</span>
                            </button>

                            <button
                              className="gis-layer-menu-item"
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenLayerMenuId(null)
                                setTableDockMinimized(false)
                                setTableDockCollapsed(false)
                                setLayerDialog({ mode: 'table', layerId })
                              }}
                            >
                              <i className="fa-solid fa-table" aria-hidden="true" />
                              <span>Show table</span>
                            </button>

                            <div className="gis-layer-menu-sep" role="separator" />

                            <button
                              className="gis-layer-menu-item"
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenLayerMenuId(null)
                                const next = window.prompt('Rename layer:', layer.name)
                                if (next === null) return
                                const name = next.trim()
                                if (!name) return
                                setLayers(prev => prev.map(l => (l.id === layer.id ? { ...l, name } : l)))
                              }}
                            >
                              <i className="fa-solid fa-pen" aria-hidden="true" />
                              <span>Rename</span>
                            </button>

                            <button
                              className="gis-layer-menu-item"
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenLayerMenuId(null)
                                const filename = `${sanitizeFileName(layer.name)}.geojson`
                                downloadTextFile(filename, JSON.stringify(layer.data ?? {}, null, 2), 'application/geo+json')
                              }}
                            >
                              <i className="fa-solid fa-floppy-disk" aria-hidden="true" />
                              <span>Save</span>
                            </button>

                            <button
                              className="gis-layer-menu-item"
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenLayerMenuId(null)
                                const suggested = sanitizeFileName(layer.name)
                                const next = window.prompt('Save as (filename without extension):', suggested)
                                if (next === null) return
                                const base = sanitizeFileName(next)
                                if (!base) return
                                downloadTextFile(`${base}.geojson`, JSON.stringify(layer.data ?? {}, null, 2), 'application/geo+json')
                              }}
                            >
                              <i className="fa-solid fa-floppy-disk" aria-hidden="true" />
                              <span>Save as</span>
                            </button>

                            <button
                              className="gis-layer-menu-item"
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenLayerMenuId(null)
                                const cloneId = `${layerId}:copy:${Date.now()}`
                                const name = `${layer.name} (copy)`
                                setLayers(prev => [...prev, { ...layer, id: cloneId, name }])
                              }}
                            >
                              <i className="fa-regular fa-copy" aria-hidden="true" />
                              <span>Duplicate</span>
                            </button>

                            <button
                              className="gis-layer-menu-item danger"
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenLayerMenuId(null)
                                setLayers(prev => prev.filter(l => l.id !== layer.id))
                              }}
                            >
                              <i className="fa-solid fa-trash-can" aria-hidden="true" />
                              <span>Remove</span>
                            </button>

                            <div className="gis-layer-menu-sep" role="separator" />

                            <button
                              className="gis-layer-menu-item"
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenLayerMenuId(null)
                                const next = window.prompt('Group name (leave empty to clear):', layer.group ?? '')
                                if (next === null) return
                                const group = next.trim()
                                setLayers(prev => prev.map(l => (l.id === layer.id ? { ...l, group: group || undefined } : l)))
                              }}
                            >
                              <i className="fa-solid fa-layer-group" aria-hidden="true" />
                              <span>Group</span>
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>

                  <div className="gis-layer-actions-row" aria-label={`Layer actions for ${layer.name}`}>
                    <button
                      className="gis-icon-btn"
                      type="button"
                      onClick={() => syncArcGisLayer(layer)}
                      disabled={layer.source !== 'arcgis' || !layer.url}
                      aria-label={`Sync ${layer.name} from ArcGIS`}
                      title="Sync from ArcGIS"
                    >
                      <i
                        className={syncingLayerKey === String(layer.id) ? 'fa-solid fa-arrows-rotate fa-spin' : 'fa-solid fa-arrows-rotate'}
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      className="gis-icon-btn"
                      type="button"
                      onClick={() => {
                        setTableDockMinimized(false)
                        setLayerDialog({ mode: 'table', layerId })
                        setTableDockCollapsed(false)
                      }}
                      disabled={layer.type !== 'geojson' || !layer.data}
                      aria-label={`Open table for ${layer.name}`}
                      title="Table"
                    >
                      <i className="fa-solid fa-table-cells" aria-hidden="true" />
                    </button>
                    <button
                      className="gis-icon-btn"
                      type="button"
                      onClick={() => {
                        const layerId = String(layer.id)
                        const original = layer.symbology
                        const draft = normalizeSymbology(layer, original)
                        applyLayerSymbology(layerId, draft)
                        setSymbologyDialog({ layerId, draft, original })
                      }}
                      aria-label={`Symbology for ${layer.name}`}
                      title="Symbology"
                    >
                      <i className="fa-solid fa-sliders" aria-hidden="true" />
                    </button>
                    <button
                      className={
                        layerDialog?.mode === 'legend' && String(layerDialog.layerId) === String(layer.id) ? 'gis-icon-btn active' : 'gis-icon-btn'
                      }
                      type="button"
                      onClick={() => setLayerDialog({ mode: 'legend', layerId })}
                      aria-label={`Legend for ${layer.name}`}
                      title="Legend"
                    >
                      <i className="fa-solid fa-key" aria-hidden="true" />
                    </button>
                    <button className="gis-icon-btn" type="button" onClick={() => zoomToLayer(layer)} aria-label={`Zoom to ${layer.name}`} title="Zoom">
                      <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                    </button>
                    <button
                      className="gis-icon-btn danger"
                      type="button"
                      onClick={() => setLayers(prev => prev.filter(l => l.id !== layer.id))}
                      aria-label={`Remove ${layer.name}`}
                      title="Delete"
                    >
                      <i className="fa-solid fa-trash" aria-hidden="true" />
                    </button>
                  </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </aside>
      ) : null}

      <section className="gis-map-canvas" aria-label="Map" data-edit-open={featureDialog ? 'true' : 'false'}>
        <MapView
          center={[20, 0]}
          zoom={initialZoom}
          zoomSnap={0.1}
          zoomDelta={0.5}
          onMapReady={(m) => {
            mapRef.current = m
            if (!selectionOverlayRef.current) {
              selectionOverlayRef.current = L.layerGroup()
              selectionOverlayRef.current.addTo(m)
            }
          }}
          showZoomControl={false}
          showScaleControl={false}
        >
          <DrawToolsController
            activeTool={drawingActiveTool}
            onToolActivate={(tool) => {
              setDrawingActiveTool(tool)
              if (tool === null && drawingIsEditing) setDrawingDirty(true)
            }}
            featureGroupRef={drawingFeatureGroupRef}
            shapeColor={drawingColor}
            onAOICreated={() => {
              setDrawingDirty(true)
            }}
            onSelectionChange={(layer) => {
              setDrawingSelected(layer)
              zoomToDrawing(layer)
            }}
            onDrawingChanged={(count) => {
              setDrawingCount(count)
              if (count === 0) setDrawingSelected(null)
              if (drawingIsEditing) setDrawingDirty(true)
            }}
          />
          {layers.map(layer =>
            layer.visible && layer.type === 'geojson' && layer.data ? (
              <GeoJSON
                key={String(layer.id)}
                data={layer.data as any}
                style={(feature: any) => getFeatureStyle(layer, feature)}
                onEachFeature={(feature: any, ll: any) => {
                  try {
                    ll?.off?.('click')
                    ll?.on?.('click', (e: any) => {
                      identifyFeatureOnMap(layer, feature)
                      const llLatLng = e?.latlng
                      const lat = typeof llLatLng?.lat === 'number' ? llLatLng.lat : undefined
                      const lng = typeof llLatLng?.lng === 'number' ? llLatLng.lng : undefined
                      if (typeof lat === 'number' && typeof lng === 'number') {
                        openMapPopup({ layer, feature, latlng: { lat, lng } })
                      }
                    })
                  } catch {}
                }}
                pointToLayer={(feature: any, latlng) => {
                  const ctx = symbologyContexts.get(String(layer.id))
                  if (ctx?.cfg.useArcGisOnline) {
                    const arc = getArcGisPointLayer(layer, feature, latlng)
                    if (arc) return arc
                  }
                  const opts = getPointMarkerOptions(layer, feature)
                  return L.circleMarker(latlng, opts as any)
                }}
              />
            ) : null
          )}
          {layers.map(layer => {
            if (!layer.visible || layer.type !== 'geojson' || !layer.data) return null
            const ctx = symbologyContexts.get(String(layer.id))
            if (!ctx || ctx.cfg.useArcGisOnline) return null
            if (ctx.cfg.style !== 'threshold_markers' || !ctx.thresholdPoints) return null
            return (
              <GeoJSON
                key={`${String(layer.id)}:threshold`}
                data={ctx.thresholdPoints as any}
                pointToLayer={(_, latlng) =>
                  L.circleMarker(latlng, {
                    radius: 6,
                    color: '#ef4444',
                    weight: 2,
                    opacity: 1,
                    fillColor: '#ef4444',
                    fillOpacity: 0.85,
                  })
                }
              />
            )
          })}
        </MapView>

        {drawingEditorOpen ? (
          <div className="gis-modal-overlay" role="presentation" onClick={() => closeDrawingEditor()}>
            <div className="gis-modal gis-modal-compact" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className="gis-modal-header">
                <div className="gis-modal-title">Edit drawing</div>
                <button className="gis-sidebar-close" type="button" onClick={() => closeDrawingEditor()} aria-label="Close dialog">
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </div>
              <div className="gis-modal-body">
                <div className="gis-layer-panel">
                  <div className="gis-layer-panel-title">
                    <i className="fa-solid fa-pen-to-square" aria-hidden="true" />
                    Editing tools
                  </div>
                  <div className="gis-layer-actions-row" style={{ flexWrap: 'wrap' }}>
                    <button
                      className={drawingActiveTool === 'edit' ? 'gis-icon-btn active' : 'gis-icon-btn'}
                      type="button"
                      onClick={() => setDrawingActiveTool('edit')}
                      title="Move / reshape"
                      aria-label="Move / reshape"
                    >
                      <i className="fa-solid fa-up-down-left-right" aria-hidden="true" />
                    </button>
                    <button
                      className={drawingActiveTool === 'delete_mode' ? 'gis-icon-btn active danger' : 'gis-icon-btn danger'}
                      type="button"
                      onClick={() => setDrawingActiveTool(drawingActiveTool === 'delete_mode' ? 'edit' : 'delete_mode')}
                      title="Delete shapes"
                      aria-label="Delete shapes"
                    >
                      <i className="fa-solid fa-trash" aria-hidden="true" />
                    </button>
                    <button className="gis-icon-btn" type="button" onClick={() => setDrawingActiveTool('polygon')} title="Add polygon" aria-label="Add polygon">
                      <i className="fa-solid fa-draw-polygon" aria-hidden="true" />
                    </button>
                    <button className="gis-icon-btn" type="button" onClick={() => setDrawingActiveTool('rectangle')} title="Add rectangle" aria-label="Add rectangle">
                      <i className="fa-regular fa-square" aria-hidden="true" />
                    </button>
                    <button className="gis-icon-btn" type="button" onClick={() => setDrawingActiveTool('circle')} title="Add circle" aria-label="Add circle">
                      <i className="fa-solid fa-circle" aria-hidden="true" />
                    </button>
                    <button className="gis-icon-btn" type="button" onClick={() => setDrawingActiveTool('marker')} title="Add marker" aria-label="Add marker">
                      <i className="fa-solid fa-location-dot" aria-hidden="true" />
                    </button>
                    <button className="gis-icon-btn" type="button" onClick={() => zoomToDrawing()} title="Zoom" aria-label="Zoom">
                      <i className="fa-solid fa-magnifying-glass-plus" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="gis-layer-panel">
                  <div className="gis-layer-panel-title">
                    <i className="fa-solid fa-palette" aria-hidden="true" />
                    Appearance
                  </div>
                  <div className="gis-layer-panel-row">
                    <div className="gis-layer-panel-label">Color</div>
                    <input
                      className="gis-input"
                      type="color"
                      value={drawingColor}
                      onChange={(e) => {
                        const next = e.target.value
                        setDrawingColor(next)
                        applyDrawingColor(next)
                      }}
                      aria-label="Drawing color"
                    />
                  </div>
                </div>

                <div className="gis-layer-panel">
                  <div className="gis-layer-panel-title">
                    <i className="fa-solid fa-list-check" aria-hidden="true" />
                    Selection
                  </div>
                  <div className="gis-layer-panel-muted">
                    {drawingSelected ? 'A shape is selected. Use Zoom to focus on it.' : 'Click a shape on the map to select it.'}
                  </div>
                </div>
              </div>
              <div className="gis-modal-actions">
                <button className="gis-btn" type="button" onClick={() => setDrawingConfirm({ kind: 'deleteAll' })} disabled={!drawingCount}>
                  حذف الكل
                </button>
                <button
                  className="gis-btn"
                  type="button"
                  onClick={() => {
                    if (drawingDirty) setDrawingConfirm({ kind: 'discard' })
                    else closeDrawingEditor()
                  }}
                >
                  إلغاء
                </button>
                <button className="gis-btn gis-btn-primary" type="button" onClick={() => setDrawingConfirm({ kind: 'save' })} disabled={!drawingDirty}>
                  حفظ
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {drawingConfirm ? (
          <div className="gis-modal-overlay" role="presentation" onClick={() => setDrawingConfirm(null)}>
            <div className="gis-modal gis-modal-compact" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className="gis-modal-header">
                <div className="gis-modal-title">تأكيد</div>
                <button className="gis-sidebar-close" type="button" onClick={() => setDrawingConfirm(null)} aria-label="Close dialog">
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </div>
              <div className="gis-modal-body">
                {drawingConfirm.kind === 'save'
                  ? 'هل تريد حفظ تغييرات الرسم؟'
                  : drawingConfirm.kind === 'discard'
                    ? 'هل تريد تجاهل التغييرات والرجوع للحالة السابقة؟'
                    : 'هل تريد حذف جميع مكونات الرسم؟'}
              </div>
              <div className="gis-modal-actions">
                <button className="gis-btn" type="button" onClick={() => setDrawingConfirm(null)}>
                  إلغاء
                </button>
                <button
                  className="gis-btn gis-btn-primary"
                  type="button"
                  onClick={() => {
                    const kind = drawingConfirm.kind
                    setDrawingConfirm(null)
                    if (kind === 'save') {
                      setDrawingIsEditing(false)
                      setDrawingEditorOpen(false)
                      setDrawingActiveTool(null)
                      setDrawingDirty(false)
                      drawingSnapshotRef.current = null
                    } else if (kind === 'discard') {
                      restoreDrawing(drawingSnapshotRef.current)
                      setDrawingIsEditing(false)
                      setDrawingEditorOpen(false)
                      setDrawingActiveTool(null)
                      setDrawingDirty(false)
                      drawingSnapshotRef.current = null
                    } else if (kind === 'deleteAll') {
                      try {
                        drawingFeatureGroupRef.current?.clearLayers()
                      } catch {
                      }
                      setDrawingSelected(null)
                      setDrawingCount(0)
                      setDrawingDirty(false)
                      setDrawingActiveTool(null)
                    }
                  }}
                >
                  تأكيد
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {mapPopup && mapPopupPos ? (
          <MapPopup
            popup={mapPopup}
            pos={mapPopupPos}
            layer={layers.find(l => String(l.id) === String(mapPopup.layerId)) ?? null}
            rootRef={popupRef}
            onClose={closeMapPopup}
            onOpenTable={() => {
              pendingTableSelectionRef.current = { layerId: mapPopup.layerId, keys: new Set([mapPopup.featureKey]), zoom: false }
              setLayerDialog({ mode: 'table', layerId: mapPopup.layerId })
              setShowSelectedOnly(false)
              setTableDockCollapsed(false)
              setTableDockMinimized(false)
            }}
            onZoomTo={() => {
              setSelectedFeatureKeys(new Set([mapPopup.featureKey]))
              showFeatureSelectionOnMap(mapPopup.layerId, mapPopup.featureKey, { zoom: true })
            }}
            onUpdateFeature={(nextFeature) => {
              setLayers((prev) =>
                prev.map((l) => {
                  if (String(l.id) === String(mapPopup.layerId) && l.data && Array.isArray((l.data as any).features)) {
                    const newFeatures = (l.data as any).features.map((f: any, i: number) => {
                      const fKey = getFeatureKey(f, i)
                      if (fKey === mapPopup.featureKey) return nextFeature
                      return f
                    })
                    return { ...l, data: { ...l.data, features: newFeatures } }
                  }
                  return l
                }),
              )
              setMapPopup((prev) => (prev ? { ...prev, feature: nextFeature } : prev))
            }}
          />
        ) : null}

        {layers.length > 0 ? (
          <div className="gis-legend" aria-label="Layer legend">
            {orderedLayers.slice(0, 8).map(l => (
              <div key={String(l.id)} className="gis-legend-row">
                <span className="gis-legend-swatch" style={{ background: l.color || '#22c55e' }} aria-hidden="true" />
                <span className="gis-legend-name" title={l.name}>
                  {l.name}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {layerDialog?.mode === 'table' && dialogLayer ? (
          (() => {
            const features = Array.isArray((dialogLayer.data as any)?.features) ? ((dialogLayer.data as any).features as any[]) : []
            const fields = getGeoJsonFields(dialogLayer.data)
            const hiddenFields = hiddenTableFieldsByLayerId[String(dialogLayer.id)] ?? new Set<string>()
            const visibleFields = fields.filter(f => !hiddenFields.has(f))
            const maxRows = 2000
            const allRows = features.slice(0, maxRows)
            const selectionCount = selectedFeatureKeys.size
            const filteredRows = showSelectedOnly
              ? allRows.filter((ft, idx) => selectedFeatureKeys.has(getFeatureKey(ft, idx)))
              : allRows
            const isSyncing = syncingLayerKey === String(dialogLayer.id)
            const canRefresh = dialogLayer.source === 'arcgis' && typeof dialogLayer.url === 'string' && dialogLayer.url.trim() !== ''
            const arcDef = dialogLayer.source === 'arcgis' ? dialogLayer.arcgisLayerDefinition : null
            const arcTypeIdField =
              typeof arcDef?.typeIdField === 'string' && arcDef.typeIdField ? (arcDef.typeIdField as string) : undefined
            const arcTypes = Array.isArray(arcDef?.types) ? (arcDef.types as any[]) : []
            const arcTypesById = new Map<string, any>(arcTypes.map(t => [String(t?.id), t]))
            const arcFields = Array.isArray(arcDef?.fields) ? (arcDef.fields as any[]) : []
            const arcFieldsByLower = new Map<string, any>(
              arcFields
                .filter(f => typeof f?.name === 'string' && f.name)
                .map(f => [String(f.name).toLowerCase(), f]),
            )
            const getArcSubtype = (ft: any) => {
              if (!arcTypeIdField) return null
              const raw = ft?.properties?.[arcTypeIdField]
              if (raw === null || raw === undefined || raw === '') return null
              return arcTypesById.get(String(raw)) ?? null
            }
            const getArcDomainForField = (ft: any, fieldName: string) => {
              if (!arcDef) return null
              const subtype = getArcSubtype(ft)
              const subtypeDomains = subtype && subtype.domains && typeof subtype.domains === 'object' ? subtype.domains : null
              const subtypeDomain = subtypeDomains ? subtypeDomains[fieldName] ?? subtypeDomains[String(fieldName)] : null
              if (subtypeDomain) return subtypeDomain
              const fieldDef = arcFieldsByLower.get(String(fieldName).toLowerCase())
              return fieldDef?.domain ?? null
            }
            const getArcDisplayValue = (ft: any, fieldName: string, raw: any) => {
              if (!arcDef) {
                const text = raw === null || raw === undefined ? '' : typeof raw === 'object' ? JSON.stringify(raw) : String(raw)
                return { display: text, title: text }
              }

              if (arcTypeIdField && String(fieldName).toLowerCase() === String(arcTypeIdField).toLowerCase()) {
                const subtype = getArcSubtype(ft)
                const label = subtype?.name
                const rawText = raw === null || raw === undefined ? '' : String(raw)
                const display = typeof label === 'string' && label ? label : rawText
                const title = display !== rawText ? `${display} (code: ${rawText})` : display
                return { display, title }
              }

              const domain = getArcDomainForField(ft, fieldName)
              const rawText = raw === null || raw === undefined ? '' : typeof raw === 'object' ? JSON.stringify(raw) : String(raw)

              if (domain?.type === 'codedValue' && Array.isArray(domain?.codedValues)) {
                const coded = domain.codedValues.find((cv: any) => String(cv?.code) === rawText)
                const name = typeof coded?.name === 'string' ? coded.name : ''
                const display = name || rawText
                const title = name && display !== rawText ? `${display} (code: ${rawText})` : display
                return { display, title }
              }

              return { display: rawText, title: rawText }
            }
            const hasSelection = selectionCount > 0
            const onToggleAll = () => {
              setSelectedFeatureKeys(prev => {
                const next = new Set(prev)
                const keys = filteredRows.map((ft, idx) => getFeatureKey(ft, idx))
                const allSelected = keys.length > 0 && keys.every(k => next.has(k))
                if (allSelected) keys.forEach(k => next.delete(k))
                else keys.forEach(k => next.add(k))
                return next
              })
            }
            const onToggleOne = (key: string) => {
              setSelectedFeatureKeys(prev => {
                const next = new Set(prev)
                if (next.has(key)) next.delete(key)
                else next.add(key)
                return next
              })
            }
            return (
              <div
                className={
                  tableDockMinimized
                    ? 'gis-table-dock collapsed minimized'
                    : tableDockCollapsed
                      ? 'gis-table-dock collapsed'
                      : 'gis-table-dock'
                }
                style={{ height: tableDockMinimized ? 38 : tableDockCollapsed ? 56 : tableDockHeight }}
                role="dialog"
                aria-label={`Table: ${dialogLayer.name}`}
              >
                {tableDockCollapsed ? null : (
                  <div className="gis-table-dock-resize" onPointerDown={startTableResize} aria-hidden="true" />
                )}
                <div className="gis-table-dock-header">
                  <div className="gis-table-dock-title" title={dialogLayer.name}>
                    <i className="fa-solid fa-table" aria-hidden="true" />
                    <span>{dialogLayer.name}</span>
                  </div>
                  <div className="gis-table-dock-meta">
                    {features.length} record{features.length === 1 ? '' : 's'}, {selectionCount} selected
                  </div>
                  <div className="gis-table-dock-actions" aria-label="Table actions">
                    <button
                      className="gis-table-dock-collapse"
                      type="button"
                      onClick={() => {
                        setTableDockMinimized(false)
                        setTableDockCollapsed(false)
                      }}
                      aria-label="Expand table"
                      title="Expand"
                      disabled={!tableDockCollapsed && !tableDockMinimized}
                    >
                      <i className="fa-solid fa-chevron-up" aria-hidden="true" />
                    </button>
                    <button
                      className="gis-table-dock-collapse"
                      type="button"
                      onClick={() => {
                        setTableDockMinimized(false)
                        setTableDockCollapsed(true)
                      }}
                      aria-label="Collapse table"
                      title="Collapse"
                      disabled={tableDockCollapsed && !tableDockMinimized}
                    >
                      <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                    </button>
                    <button
                      className="gis-table-dock-collapse"
                      type="button"
                      onClick={() => {
                        setTableDockMinimized(true)
                        setTableDockCollapsed(true)
                      }}
                      aria-label="Minimize table"
                      title="Minimize"
                      disabled={tableDockMinimized}
                    >
                      <i className="fa-solid fa-minus" aria-hidden="true" />
                    </button>
                  </div>
                  <button className="gis-table-dock-close" type="button" onClick={() => setLayerDialog(null)} aria-label="Close table">
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                  </button>
                </div>

                {tableDockCollapsed ? null : (
                <div className="gis-table-dock-body">
                  {fields.length === 0 ? (
                    <div className="gis-layer-panel-muted">No fields found.</div>
                  ) : (
                    <div className="gis-table-dock-layout">
                      <div
                        className={tableToolsCollapsed ? 'gis-table-dock-sidebar collapsed' : 'gis-table-dock-sidebar'}
                        aria-label="Table tools"
                      >
                        <button
                          className="gis-table-toolbtn"
                          type="button"
                          onClick={() => zoomToFeatures(filteredRows.filter((ft, idx) => selectedFeatureKeys.has(getFeatureKey(ft, idx))))}
                          disabled={!hasSelection}
                          title="Zoom to selection"
                        >
                          <i className="fa-solid fa-magnifying-glass-plus" aria-hidden="true" />
                          <span className="gis-table-tooltext">Zoom to selection</span>
                        </button>

                        <button className="gis-table-toolbtn" type="button" onClick={goHome} title="Home">
                          <i className="fa-solid fa-house" aria-hidden="true" />
                          <span className="gis-table-tooltext">Home</span>
                        </button>

                        <div className="gis-table-toolsep" role="separator" />

                        <button
                          className="gis-table-toolbtn"
                          type="button"
                          onClick={() => setSelectedFeatureKeys(new Set())}
                          disabled={!hasSelection}
                          title="Clear selection"
                        >
                          <i className="fa-solid fa-eraser" aria-hidden="true" />
                          <span className="gis-table-tooltext">Clear selection</span>
                        </button>

                        <button
                          className="gis-table-toolbtn"
                          type="button"
                          onClick={() => setShowSelectedOnly(true)}
                          disabled={!hasSelection}
                          title="Show selected"
                        >
                          <i className="fa-solid fa-filter" aria-hidden="true" />
                          <span className="gis-table-tooltext">Show selected</span>
                        </button>

                        <button
                          className="gis-table-toolbtn"
                          type="button"
                          onClick={() => setShowSelectedOnly(false)}
                          disabled={!showSelectedOnly}
                          title="Show all"
                        >
                          <i className="fa-solid fa-list" aria-hidden="true" />
                          <span className="gis-table-tooltext">Show all</span>
                        </button>

                        <div className="gis-table-toolsep" role="separator" />

                        <button
                          className="gis-table-toolbtn"
                          type="button"
                          onClick={() => syncArcGisLayer(dialogLayer)}
                          disabled={!canRefresh || isSyncing}
                          title="Refresh"
                        >
                          <i className="fa-solid fa-rotate-right" aria-hidden="true" />
                          <span className="gis-table-tooltext">{isSyncing ? 'Refreshing…' : 'Refresh'}</span>
                        </button>

                        <button
                          className="gis-table-toolbtn"
                          type="button"
                          onClick={() => setTableToolsCollapsed(v => !v)}
                          aria-expanded={!tableToolsCollapsed}
                          aria-label={tableToolsCollapsed ? 'Expand tools' : 'Collapse tools'}
                          title={tableToolsCollapsed ? 'Expand tools' : 'Collapse tools'}
                        >
                          <i
                            className={tableToolsCollapsed ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left'}
                            aria-hidden="true"
                          />
                          <span className="gis-table-tooltext">{tableToolsCollapsed ? 'Expand' : 'Collapse'}</span>
                        </button>
                      </div>

                      <div className="gis-layer-table-wrap gis-table-dock-table" aria-label="Layer table" ref={tableScrollRootRef}>
                        <div className="gis-layer-table-meta">
                          <div className="gis-layer-table-metatext">
                            {showSelectedOnly ? `Showing selected: ${filteredRows.length}` : `Showing ${filteredRows.length}`} of {features.length} feature(s)
                            {features.length > maxRows ? ` (first ${maxRows} loaded)` : ''}
                          </div>
                        </div>
                      {selectionNotice ? <div className="gis-layer-panel-muted">{selectionNotice}</div> : null}
                      <table className="gis-layer-table">
                        <thead>
                          <tr>
                            <th className="gis-layer-table-select">
                              <input
                                type="checkbox"
                                aria-label="Select all rows"
                                checked={filteredRows.length > 0 && filteredRows.every((ft, idx) => selectedFeatureKeys.has(getFeatureKey(ft, idx)))}
                                onChange={onToggleAll}
                              />
                            </th>
                            {visibleFields.map(f => (
                              <th key={f}>{f}</th>
                            ))}
                            <th className="gis-layer-table-actions" aria-label="Actions" />
                            <th className="gis-layer-table-fieldvis" aria-label="Field visibility">
                              <FieldVisibilityControl
                                layerId={String(dialogLayer.id)}
                                fields={fields}
                                hiddenFields={hiddenFields}
                                onChangeHiddenFields={(next) => setHiddenFieldsForLayer(String(dialogLayer.id), next)}
                              />
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRows.map((ft, idx) => {
                            const key = getFeatureKey(ft, idx)
                            const isSelected = selectedFeatureKeys.has(key)
                            return (
                            <tr
                              key={key}
                              data-row-key={key}
                              className={isSelected ? 'gis-row-selected' : undefined}
                              onClick={(e) => {
                                const t = e.target
                                if (t instanceof Element && t.closest('input,button,a,select,textarea,label')) return
                                setSelectedFeatureKeys(new Set([key]))
                                showFeatureSelectionOnMap(String(dialogLayer.id), key)
                              }}
                            >
                              <td className="gis-layer-table-select">
                                <input
                                  type="checkbox"
                                  aria-label={`Select row ${idx + 1}`}
                                  checked={isSelected}
                                  onChange={() => onToggleOne(key)}
                                />
                              </td>
                              {visibleFields.map(f => {
                                const v = ft?.properties?.[f]
                                const out = getArcDisplayValue(ft, f, v)
                                return (
                                  <td key={f} title={out.title}>
                                    {out.display}
                                  </td>
                                )
                              })}
                              <td className="gis-layer-table-actions">
                                <button
                                  className="gis-table-rowbtn"
                                  type="button"
                                  aria-label="Row details"
                                  title="Details"
                                  onClick={() => {
                                    setSelectedFeatureKeys(new Set([key]))
                                    showFeatureSelectionOnMap(String(dialogLayer.id), key)
                                    setFeatureDialog({ layerId: String(dialogLayer.id), featureKey: key, feature: ft, layerName: dialogLayer.name })
                                  }}
                                >
                                  <i className="fa-solid fa-pen" aria-hidden="true" />
                                </button>
                              </td>
                              <td className="gis-layer-table-fieldvis" aria-hidden="true" />
                            </tr>
                          )})}
                        </tbody>
                      </table>
                    </div>
                    </div>
                  )}
                </div>
                )}
              </div>
            )
          })()
        ) : null}
      </section>

      {layerDialog?.mode === 'props' && dialogLayer ? (
        <div className="gis-modal-overlay" role="presentation" onClick={() => setLayerDialog(null)}>
          <div
            className="gis-modal gis-modal-compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gis-layer-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gis-modal-header">
              <div className="gis-modal-title" id="gis-layer-dialog-title">
                Show properties: {dialogLayer.name}
              </div>
              <button className="gis-sidebar-close" type="button" onClick={() => setLayerDialog(null)} aria-label="Close dialog">
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>

            <div className="gis-modal-body">
              <pre className="gis-layer-code">
                {JSON.stringify(
                  {
                    name: dialogLayer.name,
                    source: dialogLayer.source ?? null,
                    url: dialogLayer.url ?? null,
                    group: dialogLayer.group ?? null,
                    visible: dialogLayer.visible,
                    featureCount: Array.isArray((dialogLayer.data as any)?.features) ? (dialogLayer.data as any).features.length : 0,
                    fields: getGeoJsonFields(dialogLayer.data),
                    sampleProperties:
                      Array.isArray((dialogLayer.data as any)?.features) && (dialogLayer.data as any).features[0]?.properties
                        ? (dialogLayer.data as any).features[0].properties
                        : null,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          </div>
        </div>
      ) : null}

      {layerDialog?.mode === 'legend' && dialogLayer ? (
        <div className="gis-modal-overlay" role="presentation" onClick={() => setLayerDialog(null)}>
          <div
            className="gis-modal gis-modal-compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gis-layer-legend-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gis-modal-header">
              <div className="gis-modal-title" id="gis-layer-legend-title">
                Legend: {dialogLayer.name}
              </div>
              <button className="gis-sidebar-close" type="button" onClick={() => setLayerDialog(null)} aria-label="Close dialog">
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>

            <div className="gis-modal-body">
              {(() => {
                const ctx = symbologyContexts.get(String(dialogLayer.id))
                const geometryKindRaw = ctx?.geometryKind ?? getLayerGeometryKind(dialogLayer.data)
                const geometryKind: 'point' | 'line' | 'polygon' =
                  geometryKindRaw === 'point' ? 'point' : geometryKindRaw === 'polygon' ? 'polygon' : 'line'
                const renderer = dialogLayer.arcgisRenderer ?? dialogLayer.arcgisLayerDefinition?.drawingInfo?.renderer
                const showArcGis = Boolean(ctx?.cfg.useArcGisOnline && dialogLayer.source === 'arcgis' && renderer)
                const baseStroke = dialogLayer.color || '#22c55e'
                const baseFill = dialogLayer.fillColor || dialogLayer.color || '#22c55e'
                const baseWeight = dialogLayer.weight ?? 2

                const renderArcGisSwatch = (symbol: any) => {
                  const res = arcGisSymbolToLeaflet(symbol, geometryKind, dialogLayer.opacity, baseStroke, baseFill)
                  if (geometryKind === 'point' && res.point) {
                    if (res.point.kind === 'icon') {
                      const iconUrl = resolveArcGisSymbolUrl(dialogLayer, res.point.url)
                      return (
                        <svg width="62" height="14" viewBox="0 0 62 14" aria-hidden="true">
                          <image href={iconUrl} x="22" y="1" width="18" height="12" preserveAspectRatio="xMidYMid meet" />
                        </svg>
                      )
                    }
                    const o = res.point.options as any
                    const stroke = typeof o?.color === 'string' ? o.color : baseStroke
                    const fill = typeof o?.fillColor === 'string' ? o.fillColor : baseFill
                    const width = typeof o?.weight === 'number' && Number.isFinite(o.weight) ? Math.max(1, o.weight) : baseWeight
                    return (
                      <svg width="62" height="14" viewBox="0 0 62 14" aria-hidden="true">
                        <circle cx="31" cy="7" r="5" fill={fill} stroke={stroke} strokeWidth={Math.min(4, width)} />
                      </svg>
                    )
                  }

                  const p = res.path as any
                  const stroke = typeof p?.color === 'string' ? p.color : baseStroke
                  const width = typeof p?.weight === 'number' && Number.isFinite(p.weight) ? Math.max(1, p.weight) : baseWeight
                  const dash = typeof p?.dashArray === 'string' && p.dashArray ? p.dashArray : undefined
                  const fill = typeof p?.fillColor === 'string' ? p.fillColor : baseFill

                  if (geometryKind === 'polygon') {
                    return (
                      <svg width="62" height="14" viewBox="0 0 62 14" aria-hidden="true">
                        <rect x="18" y="2" width="26" height="10" rx="3" fill={fill} stroke={stroke} strokeWidth={Math.min(4, width)} />
                      </svg>
                    )
                  }

                  return (
                    <svg width="62" height="14" viewBox="0 0 62 14" aria-hidden="true">
                      <line
                        x1="4"
                        y1="7"
                        x2="58"
                        y2="7"
                        stroke={stroke}
                        strokeWidth={width}
                        strokeLinecap="round"
                        strokeDasharray={dash}
                      />
                    </svg>
                  )
                }

                const renderCustomSwatch = (it: {
                  label: string
                  kind: 'line' | 'point' | 'polygon'
                  color: string
                  width: number
                  dash?: string
                  fill?: string
                }) => (
                  <svg width="62" height="14" viewBox="0 0 62 14" aria-hidden="true">
                    {it.kind === 'line' ? (
                      <line
                        x1="4"
                        y1="7"
                        x2="58"
                        y2="7"
                        stroke={it.color}
                        strokeWidth={it.width}
                        strokeLinecap="round"
                        strokeDasharray={it.dash || undefined}
                      />
                    ) : it.kind === 'polygon' ? (
                      <rect x="18" y="2" width="26" height="10" rx="3" fill={it.fill || it.color} stroke={it.color} strokeWidth="2" />
                    ) : (
                      <circle cx="31" cy="7" r="5" fill={it.fill || it.color} stroke={it.color} strokeWidth="2" />
                    )}
                  </svg>
                )

                if (showArcGis) {
                  const entries = buildArcGisLegendEntries(renderer)
                  if (!entries.length) return <div className="gis-style-info">No legend entries found for this layer.</div>
                  return (
                    <div className="gis-style-card gis-style-card-legend">
                      <div className="gis-style-legend">
                        {entries.map((it, idx) => (
                          <div key={idx} className="gis-style-legend-row">
                            {renderArcGisSwatch(it.symbol)}
                            <div className="gis-style-legend-text">{it.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                }

                const items = (() => {
                  const out: Array<{ label: string; kind: 'line' | 'point' | 'polygon'; color: string; width: number; dash?: string; fill?: string }> = []
                  if (!ctx) return out
                  const kind: 'line' | 'point' | 'polygon' = geometryKind === 'polygon' ? 'polygon' : geometryKind === 'point' ? 'point' : 'line'
                  if (ctx.cfg.style === 'unique') {
                    if (kind === 'line') {
                      const vals = ctx.categories.length ? ctx.categories : Object.keys(ctx.uniqueDashes)
                      vals.slice(0, 12).forEach((val) => {
                        out.push({ label: val, kind, color: baseStroke, width: baseWeight, dash: ctx.uniqueDashes[val] ?? '' })
                      })
                      if (vals.length === 0) out.push({ label: 'No values', kind, color: baseStroke, width: baseWeight })
                      return out
                    }
                    const vals = ctx.categories.length ? ctx.categories : Object.keys(ctx.categoryColors)
                    vals.slice(0, 12).forEach((val) => {
                      const fill = ctx.categoryColors[val] ?? ctx.otherColor
                      out.push({ label: val, kind, color: darkenColor(fill, 0.25), width: baseWeight, fill })
                    })
                    if (vals.length === 0) out.push({ label: 'No values', kind, color: baseStroke, width: baseWeight, fill: baseStroke })
                    return out
                  }
                  if (ctx.cfg.style === 'threshold_markers') {
                    out.push({ label: 'Base', kind, color: baseStroke, width: baseWeight })
                    out.push({ label: `Marker ≥ ${ctx.threshold.toFixed(2)}`, kind: 'point', color: '#ef4444', width: 4, fill: '#ef4444' })
                    return out
                  }
                  const breaks = ctx.breaks
                  const classes = clampInt(ctx.cfg.classes, 2, 12)
                  const showColor = ctx.cfg.style === 'color' || ctx.cfg.style === 'color_size'
                  const showSize = ctx.cfg.style === 'size' || ctx.cfg.style === 'color_size'
                  for (let i = 0; i < Math.min(classes, breaks.length - 1); i += 1) {
                    const a = breaks[i]
                    const b = breaks[i + 1]
                    const label = `${a.toFixed(2)} – ${b.toFixed(2)}`
                    const color = showColor ? ctx.colors[i] ?? baseStroke : baseStroke
                    const width = showSize ? ctx.widths[i] ?? baseWeight : baseWeight
                    const dash = ctx.cfg.style === 'dot_density' ? ctx.dotDashes[i] : undefined
                    if (kind === 'polygon') {
                      const fill = showColor ? color : baseStroke
                      out.push({ label, kind, color: darkenColor(fill, 0.25), width, dash, fill })
                    } else if (kind === 'point') {
                      const fill = showColor ? color : baseStroke
                      out.push({ label, kind, color: darkenColor(fill, 0.25), width, dash, fill })
                    } else {
                      out.push({ label, kind, color, width, dash })
                    }
                  }
                  return out
                })()

                if (!items.length) return <div className="gis-style-info">No legend available for this layer.</div>
                return (
                  <div className="gis-style-card gis-style-card-legend">
                    <div className="gis-style-legend">
                      {items.map((it, idx) => (
                        <div key={idx} className="gis-style-legend-row">
                          {renderCustomSwatch(it)}
                          <div className="gis-style-legend-text">{it.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      ) : null}

      {featureDialog ? (
        <div className="gis-right-sidebar">
          <div className="gis-right-sidebar-header">
            <button className="gis-right-sidebar-back" onClick={() => setFeatureDialog(null)} title="Back">
              <i className="fa-solid fa-chevron-left" aria-hidden="true" />
            </button>
            <span className="gis-right-sidebar-title">Edit feature</span>
          </div>

          <div className="gis-right-sidebar-body">
            {(() => {
              const layer = layers.find(l => String(l.id) === featureDialog.layerId) ?? null
              const arcDef = layer?.source === 'arcgis' ? layer.arcgisLayerDefinition : null
              const arcTypeIdField =
                typeof arcDef?.typeIdField === 'string' && arcDef.typeIdField ? (arcDef.typeIdField as string) : undefined
              const arcTypes = Array.isArray(arcDef?.types) ? (arcDef.types as any[]) : []
              const arcTypesById = new Map<string, any>(arcTypes.map(t => [String(t?.id), t]))
              const arcFields = Array.isArray(arcDef?.fields) ? (arcDef.fields as any[]) : []
              const arcFieldsByLower = new Map<string, any>(
                arcFields
                  .filter(f => typeof f?.name === 'string' && f.name)
                  .map(f => [String(f.name).toLowerCase(), f]),
              )
              const getArcSubtype = (ft: any) => {
                if (!arcTypeIdField) return null
                const raw = ft?.properties?.[arcTypeIdField]
                if (raw === null || raw === undefined || raw === '') return null
                return arcTypesById.get(String(raw)) ?? null
              }
              const getArcDomainForField = (ft: any, fieldName: string) => {
                if (!arcDef) return null
                const subtype = getArcSubtype(ft)
                const subtypeDomains = subtype && subtype.domains && typeof subtype.domains === 'object' ? subtype.domains : null
                const subtypeDomain = subtypeDomains ? subtypeDomains[fieldName] ?? subtypeDomains[String(fieldName)] : null
                if (subtypeDomain) return subtypeDomain
                const fieldDef = arcFieldsByLower.get(String(fieldName).toLowerCase())
                return fieldDef?.domain ?? null
              }
              const getArcDisplayText = (ft: any, fieldName: string, raw: any) => {
                if (!arcDef) {
                  return raw === null || raw === undefined ? '' : typeof raw === 'object' ? JSON.stringify(raw) : String(raw)
                }
                if (arcTypeIdField && String(fieldName).toLowerCase() === String(arcTypeIdField).toLowerCase()) {
                  const subtype = getArcSubtype(ft)
                  const label = typeof subtype?.name === 'string' ? subtype.name : ''
                  const rawText = raw === null || raw === undefined ? '' : String(raw)
                  return label || rawText
                }
                const domain = getArcDomainForField(ft, fieldName)
                const rawText = raw === null || raw === undefined ? '' : typeof raw === 'object' ? JSON.stringify(raw) : String(raw)
                if (domain?.type === 'codedValue' && Array.isArray(domain?.codedValues)) {
                  const coded = domain.codedValues.find((cv: any) => String(cv?.code) === rawText)
                  const name = typeof coded?.name === 'string' ? coded.name : ''
                  return name || rawText
                }
                return rawText
              }
              const keys = Object.keys(featureDialog.feature?.properties || {})

              return (
                <>
            <div className="gis-edit-section">
              <button
                className="gis-edit-section-headerbtn"
                type="button"
                onClick={() => setEditSettingsCollapsed(v => !v)}
                aria-expanded={!editSettingsCollapsed}
                aria-controls="gis-edit-settings-content"
              >
                <span className="gis-edit-section-header">
                  <i className="fa-solid fa-gear" aria-hidden="true" /> Settings
                </span>
                <span className="gis-edit-section-header-icons" aria-hidden="true">
                  <i className={editSettingsCollapsed ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up'} />
                </span>
              </button>

              {editSettingsCollapsed ? null : (
              <div className="gis-edit-section-content" id="gis-edit-settings-content">
                <label className="gis-edit-toggle">
                  <span>Enable tooltips</span>
                  <div className="gis-toggle-switch">
                    <input type="checkbox" defaultChecked />
                    <span className="gis-slider"></span>
                  </div>
                </label>
                <label className="gis-edit-toggle">
                  <span>Enable snapping</span>
                  <div className="gis-toggle-switch">
                    <input type="checkbox" defaultChecked />
                    <span className="gis-slider"></span>
                  </div>
                </label>
                <div className="gis-edit-sub-options">
                  <label className="gis-edit-toggle">
                    <span>Geometry guides</span>
                    <div className="gis-toggle-switch">
                      <input type="checkbox" defaultChecked />
                      <span className="gis-slider"></span>
                    </div>
                  </label>
                  <label className="gis-edit-toggle">
                    <span>Feature to feature</span>
                    <div className="gis-toggle-switch">
                      <input type="checkbox" defaultChecked />
                      <span className="gis-slider"></span>
                    </div>
                  </label>
                  <label className="gis-edit-toggle">
                    <span>Grid</span>
                    <div className="gis-toggle-switch">
                      <input type="checkbox" />
                      <span className="gis-slider"></span>
                    </div>
                  </label>
                </div>
                <button
                  className="gis-edit-accordion"
                  type="button"
                  onClick={() => setEditSnappingLayersOpen(v => !v)}
                  aria-expanded={editSnappingLayersOpen}
                  aria-controls="gis-edit-snapping-layers"
                >
                  <span>Snapping layers</span>
                  <i className={editSnappingLayersOpen ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'} aria-hidden="true" />
                </button>
                {editSnappingLayersOpen ? (
                  <div className="gis-edit-accordion-panel" id="gis-edit-snapping-layers">
                    <div className="gis-edit-mini-actions">
                      <button
                        className="gis-edit-linkbtn"
                        type="button"
                        onClick={() => setEditSnappingLayerIds(new Set(layers.map(l => String(l.id))))}
                      >
                        Select all
                      </button>
                      <button className="gis-edit-linkbtn" type="button" onClick={() => setEditSnappingLayerIds(new Set())}>
                        Clear
                      </button>
                    </div>
                    <div className="gis-edit-checklist">
                      {layers.map((l) => {
                        const id = String(l.id)
                        const checked = editSnappingLayerIds.has(id)
                        return (
                          <label key={id} className="gis-edit-checkrow">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const nextChecked = e.target.checked
                                setEditSnappingLayerIds(prev => {
                                  const next = new Set(prev)
                                  if (nextChecked) next.add(id)
                                  else next.delete(id)
                                  return next
                                })
                              }}
                            />
                            <span className="gis-edit-checkname">{l.name || id}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                <button
                  className="gis-edit-accordion"
                  type="button"
                  onClick={() => setEditGridOptionsOpen(v => !v)}
                  aria-expanded={editGridOptionsOpen}
                  aria-controls="gis-edit-grid-options"
                >
                  <span>Grid options</span>
                  <i className={editGridOptionsOpen ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'} aria-hidden="true" />
                </button>
                {editGridOptionsOpen ? (
                  <div className="gis-edit-accordion-panel" id="gis-edit-grid-options">
                    <div className="gis-edit-gridform">
                      <label className="gis-edit-gridfield">
                        <span>Grid size</span>
                        <input
                          className="gis-edit-gridinput"
                          inputMode="numeric"
                          value={editGridSize}
                          onChange={(e) => setEditGridSize(e.target.value)}
                        />
                      </label>
                      <label className="gis-edit-gridfield">
                        <span>Unit</span>
                        <select className="gis-edit-gridselect" value={editGridUnit} onChange={(e) => setEditGridUnit(e.target.value)}>
                          <option value="m">m</option>
                          <option value="ft">ft</option>
                        </select>
                      </label>
                    </div>
                  </div>
                ) : null}

                <div className="gis-edit-toolsbar" aria-label="Grid tools">
                  <button
                    className="gis-edit-iconbtn"
                    type="button"
                    title="Zoom"
                    aria-label="Zoom to feature"
                    onClick={() => zoomToFeatures([featureDialog.feature])}
                  >
                    <i className="fa-solid fa-magnifying-glass-plus" aria-hidden="true" />
                  </button>
                  <button
                    className="gis-edit-iconbtn"
                    type="button"
                    title="Split"
                    aria-label="Split view"
                    onClick={() => {
                      setLayerDialog({ mode: 'table', layerId: featureDialog.layerId })
                      setTableDockCollapsed(false)
                      setTableDockMinimized(false)
                    }}
                  >
                    <i className="fa-solid fa-table-columns" aria-hidden="true" />
                  </button>
                  <input className="gis-edit-toolsinput" value={featureDialog.layerName} readOnly />
                </div>
              </div>
              )}
            </div>

            <div className="gis-edit-message">
              <i className="fa-solid fa-circle-info" aria-hidden="true" />
              Editing is restricted but you have privileges to edit this layer.
            </div>

            <div className="gis-edit-fields">
              {keys.map((key) => {
                const raw = featureDialog.feature?.properties?.[key]
                const domain = getArcDomainForField(featureDialog.feature, key)
                const subtype = getArcSubtype(featureDialog.feature)
                const subtypeText = typeof subtype?.name === 'string' && subtype.name ? subtype.name : ''
                const subtypeId = subtype?.id ?? (arcTypeIdField ? featureDialog.feature?.properties?.[arcTypeIdField] : null)
                const domainName =
                  domain && typeof domain === 'object' && typeof (domain as any).name === 'string' && (domain as any).name
                    ? String((domain as any).name)
                    : domain?.type
                      ? String(domain.type)
                      : ''
                const isSubtypeField = arcTypeIdField && String(key).toLowerCase() === String(arcTypeIdField).toLowerCase()
                const codedValues: any[] =
                  domain?.type === 'codedValue' && Array.isArray(domain?.codedValues) ? (domain.codedValues as any[]) : []
                const range = domain?.type === 'range' && domain && typeof domain === 'object' ? domain : null
                const display = getArcDisplayText(featureDialog.feature, key, raw)

                const setProp = (value: any) => {
                  setFeatureDialog((prev) =>
                    prev
                      ? {
                          ...prev,
                          feature: {
                            ...prev.feature,
                            properties: {
                              ...prev.feature.properties,
                              [key]: value,
                            },
                          },
                        }
                      : null,
                  )
                }

                return (
                  <div className="gis-edit-field" key={key}>
                    <label title={display !== (raw === null || raw === undefined ? '' : String(raw)) ? `${display} (code: ${String(raw ?? '')})` : undefined}>
                      {key.replace(/_/g, ' ')}
                    </label>
                    {domainName || subtypeText ? (
                      <div className="gis-edit-field-meta" aria-label="Domain and subtype details">
                        {domainName ? (
                          <div className="gis-edit-field-metaitem">
                            <span className="gis-edit-field-metak">Domain</span>
                            <span className="gis-edit-field-metav" title={domainName}>
                              {domainName}
                            </span>
                          </div>
                        ) : null}
                        {subtypeText ? (
                          <div className="gis-edit-field-metaitem">
                            <span className="gis-edit-field-metak">Subtype</span>
                            <span
                              className="gis-edit-field-metav"
                              title={subtypeId !== null && subtypeId !== undefined && subtypeId !== '' ? `${subtypeText} (${String(subtypeId)})` : subtypeText}
                            >
                              {subtypeId !== null && subtypeId !== undefined && subtypeId !== '' ? `${subtypeText} (${String(subtypeId)})` : subtypeText}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {isSubtypeField && arcTypes.length ? (
                      <select
                        value={raw === null || raw === undefined ? '' : String(raw)}
                        onChange={(e) => {
                          const selected = arcTypesById.get(String(e.target.value))
                          setProp(selected ? selected.id : e.target.value)
                        }}
                      >
                        <option value="">Select subtype</option>
                        {arcTypes.map(t => (
                          <option key={String(t?.id)} value={String(t?.id)}>
                            {typeof t?.name === 'string' && t.name ? t.name : String(t?.id ?? '')}
                          </option>
                        ))}
                      </select>
                    ) : codedValues.length ? (
                      <select
                        value={raw === null || raw === undefined ? '' : String(raw)}
                        onChange={(e) => {
                          const selected = codedValues.find(cv => String(cv?.code) === String(e.target.value))
                          setProp(selected ? selected.code : e.target.value)
                        }}
                      >
                        <option value="">Select value</option>
                        {codedValues.map((cv) => (
                          <option key={String(cv?.code)} value={String(cv?.code)}>
                            {typeof cv?.name === 'string' && cv.name ? cv.name : String(cv?.code ?? '')}
                          </option>
                        ))}
                      </select>
                    ) : range && (typeof range?.minValue === 'number' || typeof range?.maxValue === 'number') ? (
                      <input
                        type="number"
                        value={raw ?? ''}
                        min={typeof range.minValue === 'number' ? range.minValue : undefined}
                        max={typeof range.maxValue === 'number' ? range.maxValue : undefined}
                        onChange={(e) => setProp(e.target.value === '' ? '' : Number(e.target.value))}
                      />
                    ) : (
                      <input type="text" value={raw ?? ''} onChange={(e) => setProp(e.target.value)} />
                    )}
                  </div>
                )
              })}
            </div>
                </>
              )
            })()}
          </div>

          <div className="gis-right-sidebar-footer">
            <button
              className="gis-btn-update"
              onClick={() => {
                setLayers((prev) =>
                  prev.map((l) => {
                    if (String(l.id) === featureDialog.layerId && l.data && Array.isArray((l.data as any).features)) {
                      const newFeatures = (l.data as any).features.map((f: any, i: number) => {
                        const fKey = getFeatureKey(f, i)
                        if (fKey === featureDialog.featureKey) return featureDialog.feature
                        return f
                      })
                      return { ...l, data: { ...l.data, features: newFeatures } }
                    }
                    return l
                  })
                )
                setFeatureDialog(null)
              }}
            >
              Update
            </button>
            <button
              className="gis-btn-delete"
              onClick={() => {
                setLayers((prev) =>
                  prev.map((l) => {
                    if (String(l.id) === featureDialog.layerId && l.data && Array.isArray((l.data as any).features)) {
                      const newFeatures = (l.data as any).features.filter((f: any, i: number) => {
                        const fKey = getFeatureKey(f, i)
                        return fKey !== featureDialog.featureKey
                      })
                      return { ...l, data: { ...l.data, features: newFeatures } }
                    }
                    return l
                  })
                )
                setFeatureDialog(null)
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}

      {symbologyDialog && symbologyLayer ? (
        <div className="gis-modal-overlay" role="presentation" onClick={cancelSymbology}>
          <div className="gis-modal gis-modal-styles" role="dialog" aria-modal="true" aria-labelledby="gis-style-dialog-title" onClick={(e) => e.stopPropagation()}>
            <div className="gis-modal-header">
              <div className="gis-modal-header-left">
                <div className="gis-modal-icon" aria-hidden="true">
                  <i className="fa-solid fa-palette" aria-hidden="true" />
                </div>
                <div className="gis-modal-title" id="gis-style-dialog-title">
                  Styles - {symbologyLayer.name}
                </div>
              </div>
              <button className="gis-sidebar-close" type="button" onClick={cancelSymbology} aria-label="Close dialog">
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>

            <div className="gis-modal-body">
              <div className="gis-style-hero">
                <div className="gis-style-subtitle">Choose an attribute and visualization style. Preview updates live on the map.</div>
                <label className="gis-style-check">
                  <input
                    type="checkbox"
                    checked={symbologyDialog.draft.useArcGisOnline}
                    onChange={(e) => updateSymbologyDraft({ useArcGisOnline: e.target.checked })}
                    disabled={symbologyLayer.source !== 'arcgis'}
                  />
                  <span>Use ArcGIS Online symbology</span>
                </label>
              </div>

              {symbologyDialog.draft.useArcGisOnline ? (
                <div className="gis-style-info">
                  ArcGIS renderer preview is enabled. Uncheck &quot;Use ArcGIS Online symbology&quot; to configure custom styles.
                </div>
              ) : (
                (() => {
                  const allFields = getGeoJsonFields(symbologyLayer.data)
                  const numericFields = getNumericFields(symbologyLayer.data)
                  const ctx = symbologyContexts.get(String(symbologyLayer.id))
                  const geometryKind = ctx?.geometryKind ?? getLayerGeometryKind(symbologyLayer.data)
                  const isUnique = symbologyDialog.draft.style === 'unique'
                  const classes = clampInt(symbologyDialog.draft.classes, 2, 12)
                  const showColor =
                    symbologyDialog.draft.style === 'color' ||
                    symbologyDialog.draft.style === 'color_size' ||
                    (isUnique && geometryKind !== 'line')
                  const showSize = symbologyDialog.draft.style === 'size' || symbologyDialog.draft.style === 'color_size'
                  const showMethod =
                    symbologyDialog.draft.style !== 'unique' && symbologyDialog.draft.style !== 'threshold_markers'
                  const showClasses = true
                  const legendItems = (() => {
                    const items: Array<{ label: string; kind: 'line' | 'point' | 'polygon'; color: string; width: number; dash?: string; fill?: string }> = []
                    if (!ctx) return items
                    const baseStroke = symbologyLayer.color || '#22c55e'
                    const baseWeight = symbologyLayer.weight ?? 2
                    const kind: 'line' | 'point' | 'polygon' = geometryKind === 'polygon' ? 'polygon' : geometryKind === 'point' ? 'point' : 'line'
                    if (symbologyDialog.draft.style === 'unique') {
                      if (kind === 'line') {
                        const vals = ctx.categories.length ? ctx.categories : Object.keys(ctx.uniqueDashes)
                        vals.slice(0, 12).forEach((val) => {
                          items.push({ label: val, kind, color: baseStroke, width: baseWeight, dash: ctx.uniqueDashes[val] ?? '' })
                        })
                        if (vals.length === 0) items.push({ label: 'No values', kind, color: baseStroke, width: baseWeight })
                        return items
                      }
                      const vals = ctx.categories.length ? ctx.categories : Object.keys(ctx.categoryColors)
                      vals.slice(0, 12).forEach((val) => {
                        const fill = ctx.categoryColors[val] ?? ctx.otherColor
                        items.push({ label: val, kind, color: darkenColor(fill, 0.25), width: baseWeight, fill })
                      })
                      if (vals.length === 0) items.push({ label: 'No values', kind, color: baseStroke, width: baseWeight, fill: baseStroke })
                      return items
                    }
                    if (symbologyDialog.draft.style === 'threshold_markers') {
                      items.push({ label: 'Base', kind, color: baseStroke, width: baseWeight })
                      items.push({ label: `Marker ≥ ${ctx.threshold.toFixed(2)}`, kind: 'point', color: '#ef4444', width: 4, fill: '#ef4444' })
                      return items
                    }
                    const breaks = ctx.breaks
                    for (let i = 0; i < Math.min(classes, breaks.length - 1); i += 1) {
                      const a = breaks[i]
                      const b = breaks[i + 1]
                      const label = `${a.toFixed(2)} – ${b.toFixed(2)}`
                      const color = showColor ? ctx.colors[i] ?? baseStroke : baseStroke
                      const width = showSize ? ctx.widths[i] ?? baseWeight : baseWeight
                      const dash = symbologyDialog.draft.style === 'dot_density' ? ctx.dotDashes[i] : undefined
                      if (kind === 'polygon') {
                        const fill = showColor ? color : baseStroke
                        items.push({ label, kind, color: darkenColor(fill, 0.25), width, dash, fill })
                      } else if (kind === 'point') {
                        const fill = showColor ? color : baseStroke
                        items.push({ label, kind, color: darkenColor(fill, 0.25), width, dash, fill })
                      } else {
                        items.push({ label, kind, color, width, dash })
                      }
                    }
                    return items
                  })()

                  return (
                    <>
                      <div className="gis-style-card">
                      <div className="gis-style-grid">
                        <div className="gis-style-field">
                          <div className="gis-style-label">Style</div>
                          <div className="gis-style-selectwrap">
                            <select
                              className="gis-style-select"
                              value={symbologyDialog.draft.style}
                              onChange={(e) => updateSymbologyDraft({ style: e.target.value as SymbologyStyle })}
                            >
                              <option value="unique">Types (unique symbols)</option>
                              <option value="color">Counts and Amounts (color)</option>
                              <option value="size">Counts and Amounts (size)</option>
                              <option value="color_size">Counts and Amounts (color + size)</option>
                              <option value="dot_density">Dot density</option>
                              <option value="threshold_markers">Single symbol + threshold markers</option>
                            </select>
                            <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                          </div>
                        </div>

                        <div className="gis-style-field">
                          <div className="gis-style-label">{isUnique ? 'Attribute (categorical)' : 'Attribute (numeric)'}</div>
                          <div className="gis-style-selectwrap">
                            <select
                              className="gis-style-select"
                              value={symbologyDialog.draft.field}
                              onChange={(e) => updateSymbologyDraft({ field: e.target.value })}
                            >
                              {isUnique ? (allFields.length ? null : <option value="">No fields</option>) : numericFields.length ? null : <option value="">No numeric fields</option>}
                              {(isUnique ? allFields : numericFields).map(f => (
                                <option key={f} value={f}>
                                  {f}
                                </option>
                              ))}
                            </select>
                            <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                          </div>
                        </div>

                        {showColor ? (
                          <div className="gis-style-field">
                            <div className="gis-style-label">Color ramp</div>
                            <div className="gis-style-selectwrap">
                              <select
                                className="gis-style-select"
                                value={symbologyDialog.draft.colorRamp}
                                onChange={(e) => updateSymbologyDraft({ colorRamp: e.target.value as SymbologyColorRamp })}
                              >
                                <option value="viridis">Viridis</option>
                                <option value="blues">Blues</option>
                                <option value="greens">Greens</option>
                                <option value="plasma">Plasma</option>
                                <option value="magma">Magma</option>
                                <option value="turbo">Turbo</option>
                              </select>
                              <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                            </div>
                          </div>
                        ) : null}

                        {showClasses ? (
                          <div className="gis-style-field">
                            <div className="gis-style-label">{isUnique ? 'Max categories' : 'Classes'}</div>
                            <div className="gis-style-selectwrap">
                              <select
                                className="gis-style-select"
                                value={String(classes)}
                                onChange={(e) => updateSymbologyDraft({ classes: parseInt(e.target.value, 10) })}
                              >
                                {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                                  <option key={n} value={String(n)}>
                                    {n}
                                  </option>
                                ))}
                              </select>
                              <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                            </div>
                          </div>
                        ) : null}

                        {showMethod ? (
                          <div className="gis-style-field">
                            <div className="gis-style-label">Method</div>
                            <div className="gis-style-selectwrap">
                              <select
                                className="gis-style-select"
                                value={symbologyDialog.draft.method}
                                onChange={(e) => updateSymbologyDraft({ method: e.target.value as SymbologyClassMethod })}
                              >
                                <option value="jenks">Natural breaks</option>
                                <option value="quantile">Quantile</option>
                                <option value="equal_interval">Equal interval</option>
                              </select>
                              <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                            </div>
                          </div>
                        ) : null}

                        {symbologyDialog.draft.style === 'threshold_markers' ? (
                          <div className="gis-style-field">
                            <div className="gis-style-label">Threshold</div>
                            <input
                              className="gis-style-input"
                              type="number"
                              value={Number.isFinite(symbologyDialog.draft.threshold) ? String(symbologyDialog.draft.threshold) : ''}
                              onChange={(e) => updateSymbologyDraft({ threshold: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
                              placeholder="Threshold"
                            />
                          </div>
                        ) : null}
                      </div>
                      </div>

                      <div className="gis-style-card gis-style-card-legend">
                      <div className="gis-style-legend">
                        {legendItems.map((it, idx) => (
                          <div key={idx} className="gis-style-legend-row">
                            <svg width="62" height="14" viewBox="0 0 62 14" aria-hidden="true">
                              {it.kind === 'line' ? (
                                <line
                                  x1="4"
                                  y1="7"
                                  x2="58"
                                  y2="7"
                                  stroke={it.color}
                                  strokeWidth={it.width}
                                  strokeLinecap="round"
                                  strokeDasharray={it.dash || undefined}
                                />
                              ) : it.kind === 'polygon' ? (
                                <rect x="18" y="2" width="26" height="10" rx="3" fill={it.fill || it.color} stroke={it.color} strokeWidth="2" />
                              ) : (
                                <circle cx="31" cy="7" r="5" fill={it.fill || it.color} stroke={it.color} strokeWidth="2" />
                              )}
                            </svg>
                            <div className="gis-style-legend-text">{it.label}</div>
                          </div>
                        ))}
                      </div>
                      </div>
                    </>
                  )
                })()
              )}
            </div>

            <div className="gis-style-footer">
              <button className="gis-btn" type="button" onClick={cancelSymbology}>
                Cancel
              </button>
              <button className="gis-btn gis-btn-primary" type="button" onClick={saveSymbology}>
                Save Style
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAddOpen ? (
        <div className="gis-modal-overlay" role="presentation" onClick={() => setIsAddOpen(false)}>
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
                    id="gis-arcgis-url"
                    className="gis-input"
                    type="text"
                    value={serviceUrl}
                    onChange={(e) => setServiceUrl(e.target.value)}
                    placeholder="Feature Service URL"
                    autoComplete="off"
                    inputMode="url"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        discoverArcGisLayers()
                      }
                    }}
                  />

                  <input
                    id="gis-arcgis-token"
                    className="gis-input"
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Token / API Key (optional)"
                    autoComplete="off"
                  />

                  <button
                    className="gis-btn-outline"
                    type="button"
                    onClick={discoverArcGisLayers}
                    disabled={isDiscovering || serviceUrl.trim() === ''}
                  >
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

                      <div className="gis-discovered-row" aria-label="Selected discovered layer">
                        <div className="gis-discovered-name" title={layerName}>
                          {layerName}
                        </div>
                        <button
                          className="gis-discovered-add"
                          type="button"
                          onClick={() => {
                            const found = discoveredLayers.find(d => d.url === selectedDiscoveredUrl)
                            if (found) addArcGisLayerAsGeoJson(found)
                          }}
                          disabled={!selectedDiscoveredUrl || addingLayerKey === `arcgis:${selectedDiscoveredUrl}`}
                        >
                          {addingLayerKey === `arcgis:${selectedDiscoveredUrl}` ? 'Adding…' : 'Add'}
                        </button>
                      </div>
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
                    }}
                  >
                    <div className="gis-dropzone-icon" aria-hidden="true">
                      <i className="fa-solid fa-upload" />
                    </div>
                    <div className="gis-dropzone-text">Drop a file here or click to browse</div>
                    <div className="gis-dropzone-subtext">Supports: GeoJSON, KML, KMZ, Shapefile (.zip)</div>
                  </div>

                  <input ref={fileInputRef} type="file" style={{ display: 'none' }} />

                  <input
                    id="gis-layer-name"
                    className="gis-input"
                    type="text"
                    value={layerName}
                    onChange={(e) => setLayerName(e.target.value)}
                    placeholder="Layer Name (optional)"
                    autoComplete="off"
                  />

                  <button className="gis-btn-primary-full" type="button">
                    <i className="fa-solid fa-upload" aria-hidden="true" />
                    Upload &amp; Import
                  </button>
                </div>
              )}
            </div>

            <div className="gis-modal-footer">
              <button className="gis-link-btn" type="button" onClick={() => setIsAddOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
