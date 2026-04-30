import type React from 'react'
import { useEffect } from 'react'
import { MapContainer, TileLayer, ZoomControl, ScaleControl, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

type Props = {
  center?: [number, number]
  zoom?: number
  zoomSnap?: number
  zoomDelta?: number
  mapboxToken?: string
  children?: React.ReactNode
  onMapReady?: (map: any) => void
  showZoomControl?: boolean
  showScaleControl?: boolean
}

export default function MapView({
  center = [25, 55],
  zoom = 10,
  zoomSnap,
  zoomDelta,
  mapboxToken,
  children,
  onMapReady,
  showZoomControl = true,
  showScaleControl = true,
}: Props) {
  const useMapbox = Boolean(mapboxToken)
  const url = useMapbox
    ? `https://api.mapbox.com/styles/v1/mapbox/streets-v11/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  const attribution = useMapbox
    ? '© Mapbox © OpenStreetMap'
    : '© OpenStreetMap contributors'
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      zoomSnap={zoomSnap}
      zoomDelta={zoomDelta}
      style={{ height: '100%', width: '100%' }}
      zoomControl={false}
    >
      <TileLayer url={url} attribution={attribution} />
      <MapReady onMapReady={onMapReady} />
      {children}
      {showZoomControl ? <ZoomControl position="topright" /> : null}
      {showScaleControl ? <ScaleControl position="bottomleft" /> : null}
    </MapContainer>
  )
}

function MapReady({ onMapReady }: { onMapReady?: (map: any) => void }) {
  const map = useMap()
  useEffect(() => {
    onMapReady?.(map)
    const timer = window.setTimeout(() => {
      map.invalidateSize?.()
    }, 0)
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        map.invalidateSize?.()
      })
      ro.observe(map.getContainer())
    } else {
      const onResize = () => map.invalidateSize?.()
      window.addEventListener('resize', onResize)
      return () => {
        window.clearTimeout(timer)
        window.removeEventListener('resize', onResize)
      }
    }
    return () => {
      window.clearTimeout(timer)
      ro?.disconnect()
    }
  }, [map, onMapReady])
  return null
}
