import React, { useState, useMemo, useRef, useEffect } from 'react';
import Map, { Source, Layer, NavigationControl } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import './SatelliteIntelligence.css';
import { parseFile } from '../../utils/FileLoader';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';
const MAPBOX_SATELLITE_STYLE =
  import.meta.env.VITE_MAPBOX_STYLE || 'mapbox://styles/alkamelgis/cmlkdwadt009k01sc8pzigp32';
const EMPTY_MAP_STYLE: any = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': '#020617'
      }
    }
  ]
};
const OSM_RASTER_STYLE: any = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors'
    }
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
};
const ESRI_SATELLITE_STYLE: any = {
  version: 8,
  sources: {
    esri: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Tiles © Esri'
    }
  },
  layers: [{ id: 'esri', type: 'raster', source: 'esri' }]
};
const GOOGLE_SATELLITE_STYLE: any = {
  version: 8,
  sources: {
    google: {
      type: 'raster',
      tiles: ['https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'],
      tileSize: 256,
      attribution: 'Imagery © Google'
    }
  },
  layers: [{ id: 'google', type: 'raster', source: 'google' }]
};
const WMS_INSTANCE_ID = '7b6554b7-76f2-483e-a06d-90053e49f462';
const WMS_URL = `https://services.sentinel-hub.com/ogc/wms/${WMS_INSTANCE_ID}`;
const EARTH_CIRCUMFERENCE_METERS = 40075016.68557849;
const ERROR_FILTER_PATTERNS = [
  'net::ERR_ABORTED',
  'services.sentinel-hub.com/ogc/wms',
  'sh.dataspace.copernicus.eu/ogc/wms',
  'api.mapbox.com/v4/mapbox.satellite'
];

interface WmsLayerInfo {
  name: string;
  title: string;
}

const FALLBACK_WMS_LAYERS: WmsLayerInfo[] = [
  { name: 'NDVI', title: 'Normalized Difference Veg. Index (NDVI)' },
  { name: 'NDWI', title: 'Moisture Index (NDWI)' }
];

interface BasemapOption {
  id: string;
  label: string;
  style: any;
}

const BASEMAPS: BasemapOption[] = [
  { id: 'esri', label: 'Esri World Imagery', style: ESRI_SATELLITE_STYLE },
  { id: 'osm', label: 'OSM', style: OSM_RASTER_STYLE },
  { id: 'google-earth', label: 'Google Earth', style: GOOGLE_SATELLITE_STYLE },
  { id: 'mapbox-satellite', label: 'Satellite (Mapbox)', style: MAPBOX_SATELLITE_STYLE }
];
const BASEMAP_FAILOVER_ORDER = ['mapbox-satellite', 'esri', 'google-earth', 'osm'];

const LEGENDS: Record<string, { label: string; stops: { color: string; value: string }[] }> = {
  NDVI: {
    label: 'NDVI',
    stops: [
      { color: '#fefce8', value: '-1.0' },
      { color: '#d9f99d', value: '-0.5' },
      { color: '#a3e635', value: '0.0' },
      { color: '#22c55e', value: '0.5' },
      { color: '#166534', value: '1.0' }
    ]
  },
  NDWI: {
    label: 'NDWI',
    stops: [
      { color: '#0b1120', value: '-1.0' },
      { color: '#1d4ed8', value: '-0.5' },
      { color: '#22d3ee', value: '0.0' },
      { color: '#fde047', value: '0.5' },
      { color: '#f97316', value: '1.0' }
    ]
  },
  SAVI: {
    label: 'SAVI',
    stops: [
      { color: '#7c2d12', value: '-1.0' },
      { color: '#b45309', value: '-0.5' },
      { color: '#facc15', value: '0.0' },
      { color: '#4ade80', value: '0.5' },
      { color: '#166534', value: '1.0' }
    ]
  }
};

interface CustomLayer {
  id: string;
  name: string;
  geojson: any;
  visible: boolean;
}

export default function SatelliteIntelligence() {
  const [viewState, setViewState] = useState({
    longitude: -34,
    latitude: 38,
    zoom: 2,
    pitch: 0,
    bearing: 0
  });

  const [wmsLayer, setWmsLayer] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [customLayers, setCustomLayers] = useState<CustomLayer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [timeSeriesStart, setTimeSeriesStart] = useState('2025-11-18');
  const [timeSeriesEnd, setTimeSeriesEnd] = useState('2026-02-16');
  const [showFieldBoundaries, setShowFieldBoundaries] = useState(false);
  const [showProductivityZones, setShowProductivityZones] = useState(false);
  const [wmsLayers, setWmsLayers] = useState<WmsLayerInfo[]>([]);
  const [isLoadingLayers, setIsLoadingLayers] = useState(false);
  const [isLayerDropdownOpen, setIsLayerDropdownOpen] = useState(false);
  const [basemapId, setBasemapId] = useState('mapbox-satellite');
  const [isBasemapOpen, setIsBasemapOpen] = useState(false);
  const [is3DView, setIs3DView] = useState(true);
  const [cloudCoverage, setCloudCoverage] = useState(60);
  const [isTimelinePlaying, setIsTimelinePlaying] = useState(false);
  const [timelineIndex, setTimelineIndex] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any | null>(null);
  const consoleErrorRef = useRef<typeof console.error | null>(null);
  const fallbackLockRef = useRef(false);

  const applySelectedDate = (date: Date) => {
    const iso = date.toISOString().split('T')[0];
    setSelectedDate(date);
    setTimeSeriesStart(prev => (prev && iso < prev ? iso : prev || iso));
    setTimeSeriesEnd(prev => (prev && iso > prev ? iso : prev || iso));
  };

  const getGeoJsonBounds = (geojson: any): [number, number, number, number] | null => {
    const points: [number, number][] = [];

    const walkCoords = (coords: any) => {
      if (!coords) return;
      if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        points.push([coords[0], coords[1]]);
        return;
      }
      if (Array.isArray(coords)) {
        coords.forEach(walkCoords);
      }
    };

    if (geojson.type === 'FeatureCollection') {
      geojson.features?.forEach((f: any) => walkCoords(f.geometry?.coordinates));
    } else if (geojson.type === 'Feature') {
      walkCoords(geojson.geometry?.coordinates);
    } else if (geojson.type === 'GeometryCollection') {
      geojson.geometries?.forEach((g: any) => walkCoords(g.coordinates));
    } else if (geojson.coordinates) {
      walkCoords(geojson.coordinates);
    }

    if (points.length === 0) return null;

    let [minX, minY] = points[0];
    let [maxX, maxY] = points[0];
    for (let i = 1; i < points.length; i++) {
      const [x, y] = points[i];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return [minX, minY, maxX, maxY];
  };

  const getMetersPerPixel = (latitude: number, zoom: number, tileSize = 512) => {
    const latRad = (latitude * Math.PI) / 180;
    return (EARTH_CIRCUMFERENCE_METERS * Math.cos(latRad)) / (tileSize * Math.pow(2, zoom));
  };

  const handleLayerFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = await parseFile(file);
      if (parsed.type === 'geojson') {
        const id = `custom-${Date.now()}-${file.name}`;
        setCustomLayers(prev => [
          ...prev,
          {
            id,
            name: file.name,
            geojson: parsed.data,
            visible: true
          }
        ]);

        const bounds = getGeoJsonBounds(parsed.data);
        if (bounds) {
          const [minX, minY, maxX, maxY] = bounds;
          const mapInstance = mapRef.current?.getMap ? mapRef.current.getMap() : mapRef.current;
          if (mapInstance && typeof mapInstance.fitBounds === 'function') {
            mapInstance.fitBounds(
              [
                [minX, minY],
                [maxX, maxY]
              ],
              { padding: 80, duration: 800 }
            );
          } else {
            const centerLng = (minX + maxX) / 2;
            const centerLat = (minY + maxY) / 2;
            setViewState(prev => ({
              ...prev,
              longitude: centerLng,
              latitude: centerLat,
              zoom: Math.max(prev.zoom, 13)
            }));
          }
        }
      } else {
        console.warn('Uploaded file does not contain spatial data');
      }
    } catch (error) {
      console.error('Failed to add layer', error);
    } finally {
      event.target.value = '';
    }
  };

  const toggle3DView = () => {
    const mapInstance = mapRef.current?.getMap ? mapRef.current.getMap() : mapRef.current;
    const nextIs3D = !is3DView;
    setIs3DView(nextIs3D);

    const pitch = nextIs3D ? Math.max(viewState.pitch || 0, 55) : 0;
    const bearing = viewState.bearing || 0;
    const projection = nextIs3D ? { name: 'globe' as const } : { name: 'mercator' as const };

    if (mapInstance && typeof mapInstance.setProjection === 'function') {
      try {
        mapInstance.setProjection(projection);
      } catch {
      }
    }

    if (mapInstance && typeof mapInstance.easeTo === 'function') {
      mapInstance.easeTo({
        pitch,
        bearing,
        duration: 800
      });
    }

    setViewState(prev => ({
      ...prev,
      pitch,
      bearing
    }));
  };

  const handleSelectWmsLayer = (layerName: string) => {
    setWmsLayer(current => (current === layerName ? '' : layerName));
    setIsLayerDropdownOpen(false);
  };

  const handleUploadCustomLayerClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const toggleCustomLayerVisibility = (id: string, visible: boolean) => {
    setCustomLayers(prev =>
      prev.map(layer =>
        layer.id === id ? { ...layer, visible } : layer
      )
    );
  };

  const performSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setIsSearching(true);
    try {
      const response = MAPBOX_TOKEN
        ? await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&limit=5`
          )
        : await fetch(
            `https://nominatim.openstreetmap.org/search?format=geojson&limit=5&q=${encodeURIComponent(q)}`,
            { headers: { 'Accept-Language': 'en' } }
          );
      if (response.ok) {
        const data = await response.json();
        const features = Array.isArray(data?.features)
          ? data.features
          : Array.isArray(data)
              ? data
              : [];
        setSearchResults(features);
        setShowSearchResults(true);
      }
    } catch (error) {
      console.error('Search failed', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (feature: any) => {
    const center = feature?.center || feature?.geometry?.coordinates;
    if (!Array.isArray(center) || center.length < 2) return;
    const [lng, lat] = center;
    setViewState(prev => ({
      ...prev,
      longitude: lng,
      latitude: lat,
      zoom: 11,
      pitch: 45,
      bearing: 0
    }));
    setSearchQuery(feature.text || feature?.properties?.name || feature?.properties?.display_name || '');
    setShowSearchResults(false);
  };

  const dates = useMemo(() => {
    const arr = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      arr.push({
        day: d.getDate(),
        month: d.toLocaleString('default', { month: 'short' }),
        full: d
      });
    }
    return arr;
  }, []);

  const formatTimelineDate = (date: Date) =>
    date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

  const applySelectedDateByIndex = (index: number) => {
    if (!dates.length) return;
    const safe = Math.max(0, Math.min(dates.length - 1, index));
    setTimelineIndex(safe);
    applySelectedDate(dates[safe].full);
  };

  useEffect(() => {
    if (!dates.length) return;
    const selectedIdx = dates.findIndex(d => d.full.toDateString() === selectedDate.toDateString());
    if (selectedIdx >= 0 && selectedIdx !== timelineIndex) {
      setTimelineIndex(selectedIdx);
    }
  }, [dates, selectedDate, timelineIndex]);

  useEffect(() => {
    if (!isTimelinePlaying || dates.length === 0) return;

    const interval = setInterval(() => {
      setTimelineIndex(prev => {
        const next = prev + 1;
        if (next >= dates.length) {
          setIsTimelinePlaying(false);
          return prev;
        }
        applySelectedDate(dates[next].full);
        return next;
      });
    }, 1100);

    return () => clearInterval(interval);
  }, [isTimelinePlaying, dates]);

  useEffect(() => {
    const iso = selectedDate.toISOString().split('T')[0];
    if (timeSeriesStart && iso < timeSeriesStart) {
      setSelectedDate(new Date(timeSeriesStart));
      return;
    }
    if (timeSeriesEnd && iso > timeSeriesEnd) {
      setSelectedDate(new Date(timeSeriesEnd));
    }
  }, [timeSeriesStart, timeSeriesEnd]);

  useEffect(() => {
    const loadLayers = async () => {
      setIsLoadingLayers(true);
      try {
        const response = await fetch(`${WMS_URL}?SERVICE=WMS&REQUEST=GetCapabilities`);
        if (response.ok) {
          const text = await response.text();
          const parser = new DOMParser();
          const xml = parser.parseFromString(text, 'application/xml');
          const nodes = Array.from(xml.getElementsByTagName('Layer'));
          const parsed: WmsLayerInfo[] = [];
          nodes.forEach(node => {
            const nameNode = node.getElementsByTagName('Name')[0];
            if (!nameNode) return;
            const titleNode = node.getElementsByTagName('Title')[0];
            const name = nameNode.textContent || '';
            const title = titleNode?.textContent || name;
            if (name && !parsed.some(l => l.name === name)) {
              parsed.push({ name, title });
            }
          });
          FALLBACK_WMS_LAYERS.forEach(layer => {
            if (!parsed.some(l => l.name === layer.name)) {
              parsed.push(layer);
            }
          });
          if (parsed.length > 0) {
            setWmsLayers(parsed);
            return;
          }
        }
        setWmsLayers(FALLBACK_WMS_LAYERS);
      } catch (error) {
        console.error('Failed to load WMS layers', error);
        setWmsLayers(FALLBACK_WMS_LAYERS);
      } finally {
        setIsLoadingLayers(false);
      }
    };
    loadLayers();
  }, []);

  const activeWmsLayer = wmsLayer;
  const legendKey = activeWmsLayer
    ? Object.keys(LEGENDS).find(key => activeWmsLayer.toUpperCase().includes(key))
    : undefined;
  const wmsDate = selectedDate.toISOString().split('T')[0];
  const sentinelVisible = !!wmsLayer;
  const currentBasemap = BASEMAPS.find(b => b.id === basemapId) || BASEMAPS[0];
  const requestedStyle = currentBasemap.style || EMPTY_MAP_STYLE;
  const isMapboxStyle = typeof requestedStyle === 'string' && requestedStyle.startsWith('mapbox://');
  const mapStyle = isMapboxStyle ? (MAPBOX_TOKEN ? requestedStyle : ESRI_SATELLITE_STYLE) : requestedStyle;

  const moveToNextBasemap = (reason?: string) => {
    if (fallbackLockRef.current) return;
    fallbackLockRef.current = true;
    const currentIndex = BASEMAP_FAILOVER_ORDER.indexOf(basemapId);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextId = BASEMAP_FAILOVER_ORDER[(safeIndex + 1) % BASEMAP_FAILOVER_ORDER.length];
    if (nextId !== basemapId) {
      setBasemapId(nextId);
    }
    window.setTimeout(() => {
      fallbackLockRef.current = false;
    }, 1200);
    if (reason) {
      console.warn(`[Basemap fallback] ${reason} -> ${nextId}`);
    }
  };

  useEffect(() => {
    const original = console.error;
    consoleErrorRef.current = original;
    console.error = (...args: any[]) => {
      const text = args.map(arg => (typeof arg === 'string' ? arg : '')).join(' ');
      if (ERROR_FILTER_PATTERNS.some(pattern => text.includes(pattern))) {
        return;
      }
      original(...args);
    };
    return () => {
      if (consoleErrorRef.current) {
        console.error = consoleErrorRef.current;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current?.getMap ? mapRef.current.getMap() : mapRef.current;
    if (!map || !map.on) return;

    const handleMapError = (e: any) => {
      const message = e?.error?.message || '';
      const url = e?.error?.url || '';
      const status = e?.error?.status;
      const isBasemapRequest =
        url.includes('api.mapbox.com') ||
        url.includes('arcgisonline.com') ||
        url.includes('tile.openstreetmap.org') ||
        url.includes('opentopomap.org') ||
        url.includes('mt1.google.com');

      if (
        message.includes('ERR_ABORTED') ||
        status === 0 ||
        url.includes('api.mapbox.com/v4/mapbox.satellite') ||
        url.includes('services.sentinel-hub.com/ogc/wms')
      ) {
        if ((message.includes('style') || message.includes('sprite') || message.includes('source')) && basemapId !== 'esri') {
          setBasemapId('esri');
        }

        if (typeof e.preventDefault === 'function') {
          e.preventDefault();
        }
        return;
      }

      if (isBasemapRequest || status >= 400 || message.toLowerCase().includes('tile')) {
        moveToNextBasemap(message || 'Tile request failed');
        if (typeof e.preventDefault === 'function') {
          e.preventDefault();
        }
        return;
      }
    };

    map.on('error', handleMapError);
    return () => {
      map.off('error', handleMapError);
    };
  }, [basemapId]);

  useEffect(() => {
    // If Mapbox style is selected without token, immediately recover to Esri.
    if (basemapId === 'mapbox-satellite' && !MAPBOX_TOKEN) {
      setBasemapId('esri');
    }
  }, [basemapId]);

  const wmsTileUrl = useMemo(() => {
    const safeLayer = encodeURIComponent(activeWmsLayer);
    const start = timeSeriesStart || wmsDate;
    const end = timeSeriesEnd || wmsDate;
    return `${WMS_URL}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0` +
      `&LAYERS=${safeLayer}` +
      `&BBOX={bbox-epsg-3857}&CRS=EPSG:3857` +
      `&FORMAT=image/png&TRANSPARENT=true&WIDTH=512&HEIGHT=512` +
      `&TIME=${start}/${end}&MAXCC=${cloudCoverage}&SHOWLOGO=false&WARNINGS=true`;
  }, [activeWmsLayer, timeSeriesStart, timeSeriesEnd, wmsDate, cloudCoverage]);

  return (
    <div className="si-page">
      <div className="si-main-content">
        <div className="si-top-bar">
          <div className="si-top-card si-top-card-center">
            <div className="si-timeline-inline">
              <button
                type="button"
                className={`si-timeline-run ${isTimelinePlaying ? 'playing' : ''}`}
                onClick={() => {
                  if (!isTimelinePlaying && timelineIndex >= dates.length - 1) {
                    applySelectedDateByIndex(0);
                  }
                  setIsTimelinePlaying(prev => !prev);
                }}
                aria-label={isTimelinePlaying ? 'Pause timeline' : 'Run timeline'}
                title={isTimelinePlaying ? 'Pause timeline' : 'Run timeline'}
              >
                <i className={isTimelinePlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play'}></i>
              </button>
              <div className="si-timeline-track">
                <div className="track-line"></div>
                <div
                  className="track-progress"
                  style={{
                    width: dates.length > 1
                      ? `${(timelineIndex / (dates.length - 1)) * 100}%`
                      : '0%'
                  }}
                ></div>
                <input
                  type="range"
                  className="si-timeline-slider"
                  min={0}
                  max={Math.max(0, dates.length - 1)}
                  step={1}
                  value={timelineIndex}
                  aria-label="Time slider"
                  onChange={(e) => {
                    setIsTimelinePlaying(false);
                    applySelectedDateByIndex(Number(e.target.value));
                  }}
                />
                {dates.map((date, idx) => {
                  const isActive = idx === timelineIndex;
                  const isEdge = idx === 0 || idx === dates.length - 1;
                  const maxBaseLabels = 4;
                  const step = Math.max(1, Math.ceil(dates.length / maxBaseLabels));
                  const isStepped = idx % step === 0;
                  const isTodayDate = date.full.toDateString() === new Date().toDateString();
                  const showLabel = isActive || (isEdge && !isTodayDate) || isStepped;
                  return (
                    <div
                      key={idx}
                      className={`track-point ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        setIsTimelinePlaying(false);
                        applySelectedDateByIndex(idx);
                      }}
                    >
                      <div className="point-dot"></div>
                      {showLabel && (
                        <span className="point-label">
                          {formatTimelineDate(date.full)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="si-timeline-current-date">
                {selectedDate.toDateString() === new Date().toDateString()
                  ? 'Today'
                  : selectedDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
            </div>
          </div>
          <div className="si-top-card si-top-card-right">
            <div className="si-env-rail">
              <button
                type="button"
                className={`si-env-rail-button ${isLayerDropdownOpen ? 'active' : ''}`}
                onClick={() => setIsLayerDropdownOpen(open => !open)}
                title="NDVI"
              >
                <i className="fa-solid fa-layer-group"></i>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="add-layer-input"
                accept=".kml,.kmz,.zip,.geojson,.json,.csv"
                onChange={handleLayerFileChange}
              />
              {isLayerDropdownOpen && (
                <div className="si-env-panel">
                  <div className="si-env-panel-header">
                    <div className="si-env-title">Environmental Index</div>
                    <button
                      type="button"
                      className="si-env-close"
                      onClick={() => setIsLayerDropdownOpen(false)}
                    >
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                  <div className="si-env-panel-body">
                    {isLoadingLayers && (
                      <div className="si-env-message">Loading NDVI layers...</div>
                    )}
                    {!isLoadingLayers && wmsLayers.length === 0 && (
                      <div className="si-env-message">No WMS layers found</div>
                    )}
                    {!isLoadingLayers && wmsLayers.length > 0 && (
                      <div className="si-env-imagery-date">
                        Imagery date: {selectedDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </div>
                    )}
                    {!isLoadingLayers && wmsLayers.length > 0 && (
                      <div className="si-env-layer-list">
                        {wmsLayers.map(layer => {
                          const isActive = activeWmsLayer === layer.name;
                          return (
                            <button
                              type="button"
                              key={layer.name}
                              className={`si-env-layer-item ${isActive ? 'active' : ''}`}
                              onClick={() => handleSelectWmsLayer(layer.name)}
                            >
                              <div className="si-env-layer-info">
                                <span className="si-env-layer-title">
                                  {layer.title === 'Sentinel Hub WMS' ? 'NDVI' : layer.title}
                                </span>
                                <span className="si-env-layer-name">{layer.name}</span>
                              </div>
                              <div className={`si-env-layer-toggle ${isActive ? 'on' : 'off'}`}>
                                <div className="si-env-layer-toggle-knob" />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <button
                      type="button"
                      className="si-env-upload"
                      onClick={() => {
                        setIsLayerDropdownOpen(false);
                        handleUploadCustomLayerClick();
                      }}
                    >
                      <i className="fa-solid fa-upload"></i>
                      <span>Upload custom field layer</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="si-map-container">
          <Map
            ref={mapRef}
            {...viewState}
            onMove={evt => setViewState(evt.viewState)}
            style={{ width: '100%', height: '100%' }}
            mapStyle={mapStyle}
            mapboxAccessToken={MAPBOX_TOKEN || undefined}
            projection={is3DView ? { name: 'globe' } : { name: 'mercator' }}
            renderWorldCopies={!is3DView}
            dragRotate={is3DView}
            pitchWithRotate={is3DView}
            fog={is3DView ? { 'range': [0.5, 10], 'color': '#020617', 'horizon-blend': 0.1 } : undefined}
            onError={(e: any) => {
              const message = e?.error?.message || '';
              const url = e?.error?.url || '';
              const status = e?.error?.status;

              if (url.includes('services.sentinel-hub.com/ogc/wms')) return;
              console.warn('Map Error:', e);
            }}
            onLoad={() => setIsMapLoaded(true)}
          >
            {customLayers.map(layer => (
              layer.visible && (
                <Source key={layer.id} id={layer.id} type="geojson" data={layer.geojson}>
                  <Layer
                    id={`${layer.id}-fill`}
                    type="fill"
                    paint={{
                      'fill-color': '#22c55e',
                      'fill-opacity': 0.35
                    }}
                  />
                  <Layer
                    id={`${layer.id}-line`}
                    type="line"
                    paint={{
                      'line-color': '#22c55e',
                      'line-width': 1.5
                    }}
                  />
                  <Layer
                    id={`${layer.id}-circle`}
                    type="circle"
                    paint={{
                      'circle-radius': 4,
                      'circle-color': '#22c55e',
                      'circle-stroke-width': 1,
                      'circle-stroke-color': '#052e16'
                    }}
                  />
                </Source>
              )
            ))}

            {isMapLoaded && sentinelVisible && (
              <Source
                key={`sentinel-${activeWmsLayer}-${wmsDate}`}
                id="sentinel-source"
                type="raster"
                tiles={[wmsTileUrl]}
                tileSize={512}
              >
                <Layer
                  id="sentinel-layer"
                  type="raster"
                  paint={{
                    'raster-opacity': 0.85,
                    'raster-fade-duration': 0
                  }}
                />
              </Source>
            )}

            <NavigationControl position="bottom-right" />
          </Map>

          {sentinelVisible && legendKey && LEGENDS[legendKey] && (
            <div className="si-legend">
              <div className="si-legend-header">
                <span className="si-legend-label">{LEGENDS[legendKey].label}</span>
                <span className="si-legend-sub">Index scale</span>
              </div>
              <div className="si-legend-gradient">
                {LEGENDS[legendKey].stops.map((stop, index) => (
                  <div
                    key={stop.value}
                    className="si-legend-stop"
                    style={{
                      backgroundColor: stop.color,
                      borderTopLeftRadius: index === 0 ? 999 : 0,
                      borderBottomLeftRadius: index === 0 ? 999 : 0,
                      borderTopRightRadius: index === LEGENDS[legendKey].stops.length - 1 ? 999 : 0,
                      borderBottomRightRadius: index === LEGENDS[legendKey].stops.length - 1 ? 999 : 0
                    }}
                  />
                ))}
              </div>
              <div className="si-legend-ticks">
                {LEGENDS[legendKey].stops.map(stop => (
                  <span key={stop.value} className="si-legend-tick">
                    {stop.value}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="si-basemap-toggle">
            <button
              type="button"
              className={`si-basemap-button ${isBasemapOpen ? 'active' : ''}`}
              onClick={() => setIsBasemapOpen(open => !open)}
              title="Basemap"
            >
              <i className="fa-solid fa-globe"></i>
            </button>
            {isBasemapOpen && (
              <div className="si-basemap-widget">
                {BASEMAPS.map(option => (
                  <button
                    key={option.id}
                    className={`basemap-pill ${basemapId === option.id ? 'active' : ''}`}
                    onClick={() => setBasemapId(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            ref={searchRef}
            className={`si-map-search ${isSearchOpen ? 'open' : 'collapsed'}`}
          >
            <button
              type="button"
              className="si-map-search-toggle"
              onClick={() => setIsSearchOpen(open => !open)}
            >
              <i className={isSearchOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-magnifying-glass'}></i>
            </button>

            {isSearchOpen && (
              <div className="si-map-search-inner">
                <i className="fa-solid fa-magnifying-glass si-map-search-icon"></i>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search places"
                  className="si-map-search-input"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      performSearch();
                    }
                  }}
                />
                <button
                  type="button"
                  className="si-map-search-button"
                  onClick={performSearch}
                >
                  {isSearching ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-arrow-right"></i>}
                </button>
              </div>
            )}

            {isSearchOpen && showSearchResults && searchResults.length > 0 && (
              <div className="si-map-search-results">
                {searchResults.map(feature => {
                  const title = feature?.text || feature?.properties?.name || feature?.properties?.display_name || 'Result';
                  const subtitle = feature?.place_name
                    ? feature.place_name.replace(String(feature.text || '') + ', ', '')
                    : feature?.properties?.display_name && feature?.properties?.display_name !== title
                      ? feature.properties.display_name
                      : '';
                  const key =
                    feature?.id ||
                    feature?.properties?.place_id ||
                    feature?.properties?.osm_id ||
                    `${title}-${String(feature?.geometry?.coordinates || '')}`;
                  return (
                    <button
                      type="button"
                      key={key}
                      className="si-map-search-result"
                      onClick={() => handleSelectSearchResult(feature)}
                    >
                      <span className="si-map-search-result-title">{title}</span>
                      {subtitle && (
                        <span className="si-map-search-result-subtitle">
                          {subtitle}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
