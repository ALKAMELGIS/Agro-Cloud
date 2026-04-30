import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useMap, useMapEvents, ScaleControl, ZoomControl, MapContainer, TileLayer, CircleMarker } from 'react-leaflet';
import L from 'leaflet';

// Re-export ZoomControl with default props if needed, or just use it directly
export const CustomZoomControl: React.FC = () => {
  return null; // Deprecated in favor of ZoomLocationControl
};

export const ScaleBar: React.FC = () => {
  return (
    <div className="leaflet-bottom leaflet-left" style={{ marginBottom: '10px', marginLeft: '60px' }}>
      <ScaleControl position="bottomleft" imperial={false} />
    </div>
  );
};

export const MouseCoordinates: React.FC = () => {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  
  useMapEvents({
    mousemove(e) {
      setCoords(e.latlng);
    },
  });

  if (!coords) return null;

  return (
    <div
      className="leaflet-bottom leaflet-right"
      style={{
        marginBottom: '5px',
        marginRight: '110px', // Clear 3D Globe
        pointerEvents: 'none',
        zIndex: 1000,
        background: 'rgba(255, 255, 255, 0.9)',
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '11px',
        fontFamily: 'monospace',
        border: '1px solid #ccc',
        color: '#333',
        whiteSpace: 'nowrap',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
      }}
    >
      Lat: {coords.lat.toFixed(5)} | Lng: {coords.lng.toFixed(5)}
    </div>
  );
};

export const ZoomLocationControl: React.FC = () => {
  const map = useMap();
  const [loading, setLoading] = useState(false);

  const handleLocate = () => {
    setLoading(true);
    map.locate().on('locationfound', function (e) {
      map.flyTo(e.latlng, map.getZoom());
      setLoading(false);
    }).on('locationerror', function () {
      alert("Could not access location");
      setLoading(false);
    });
  };

  const handleZoomIn = () => {
    map.setZoom(map.getZoom() + 1);
  };

  const handleZoomOut = () => {
    map.setZoom(map.getZoom() - 1);
  };

  const btnStyle = {
    width: '30px',
    height: '30px',
    border: 'none',
    background: 'white',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#666',
    transition: 'all 0.2s'
  };

  return (
    <div style={{
      position: 'absolute',
      bottom: '20px',
      left: '20px',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      alignItems: 'center'
    }}>
       {/* Zoom Controls */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
        borderRadius: '8px',
        background: 'white',
        overflow: 'hidden'
      }}>
        <button 
          onClick={handleZoomIn} 
          style={{...btnStyle, borderBottom: '1px solid #f0f0f0'}}
          title="Zoom In"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#f8f9fa';
            e.currentTarget.style.color = '#333';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'white';
            e.currentTarget.style.color = '#666';
          }}
        >
          <i className="fa-solid fa-plus"></i>
        </button>
        <button 
          onClick={handleZoomOut} 
          style={btnStyle}
          title="Zoom Out"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#f8f9fa';
            e.currentTarget.style.color = '#333';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'white';
            e.currentTarget.style.color = '#666';
          }}
        >
          <i className="fa-solid fa-minus"></i>
        </button>
      </div>
      
      {/* GPS Button */}
      <button 
        onClick={handleLocate} 
        style={{
          ...btnStyle, 
          borderRadius: '8px', 
          boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
        }}
        title="Show Your Location"
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#f8f9fa';
          e.currentTarget.style.color = '#1a73e8';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'white';
          e.currentTarget.style.color = '#666';
        }}
      >
        <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : 'fa-location-crosshairs'}`}></i>
      </button>
    </div>
  );
};

// MiniMap Component
function MinimapBounds({ parentMap, zoom }: { parentMap: L.Map, zoom: number }) {
  const minimap = useMap();

  // Sync minimap center with parent map
  const onChange = useCallback(() => {
    minimap.setView(parentMap.getCenter(), zoom);
  }, [minimap, parentMap, zoom]);

  // Listen to parent map move events
  useEffect(() => {
    parentMap.on('move', onChange);
    parentMap.on('zoom', onChange);
    return () => {
      parentMap.off('move', onChange);
      parentMap.off('zoom', onChange);
    };
  }, [parentMap, onChange]);

  return (
    <CircleMarker 
      center={parentMap.getCenter()} 
      radius={4}
      pathOptions={{ 
        color: '#ffeb3b', 
        fillColor: '#ffeb3b', 
        fillOpacity: 1, 
        weight: 1,
        opacity: 1
      }} 
    />
  );
}

export const MiniMap: React.FC = () => {
  const parentMap = useMap();
  const mapZoom = 0; // Show the whole world

  // Memoize the minimap to prevent re-renders
  const minimap = useMemo(
    () => (
      <MapContainer
        style={{ height: '100%', width: '100%', background: '#0f172a' }}
        center={[0, 0]}
        zoom={mapZoom}
        dragging={true}
        doubleClickZoom={true}
        scrollWheelZoom={false}
        attributionControl={false}
        zoomControl={false}
      >
        <TileLayer url="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={19} />
        <MinimapBounds parentMap={parentMap} zoom={mapZoom} />
      </MapContainer>
    ),
    []
  );

  return (
    <div style={{ 
      position: 'absolute',
      bottom: '10px', 
      right: '10px', 
      zIndex: 1000, 
      width: '80px',
      height: '80px',
      borderRadius: '50%',
      border: '3px solid #fff',
      boxShadow: '0 5px 15px rgba(0,0,0,0.4)',
      overflow: 'hidden',
      transition: 'all 0.3s ease',
      cursor: 'pointer'
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.transform = 'scale(1.1)';
      e.currentTarget.style.boxShadow = '0 15px 35px rgba(0,0,0,0.6)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.transform = 'scale(1)';
      e.currentTarget.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';
    }}
    >
      {minimap}
      {/* 3D Sphere Overlay */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        pointerEvents: 'none',
        background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.1) 0%, rgba(0,0,0,0.1) 60%, rgba(0,0,0,0.3) 100%)',
        boxShadow: 'inset 0 0 20px rgba(0,0,0,0.5), inset 2px 2px 5px rgba(255,255,255,0.4)',
        zIndex: 1001
      }} />
    </div>
  );
};
