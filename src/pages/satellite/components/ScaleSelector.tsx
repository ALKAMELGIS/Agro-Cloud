import React, { useState, useRef, useEffect } from 'react';

interface ScaleSelectorProps {
  label: string;
  zoom: number;
  onChange: (zoom: number) => void;
  currentMapZoom: number;
}

interface ScaleOption {
  label: string;
  scale: number;
  zoom: number;
}

// Approximate Web Mercator scale at equator
const ZOOM_SCALE_FACTOR = 591657550.5;

const getScaleFromZoom = (zoom: number) => Math.round(ZOOM_SCALE_FACTOR / Math.pow(2, zoom));
const getZoomFromScale = (scale: number) => Math.log2(ZOOM_SCALE_FACTOR / scale);

const SCALE_OPTIONS: ScaleOption[] = [
  { label: 'World', scale: 0, zoom: 0 }, // Special case
  { label: 'Continent', scale: 50000000, zoom: getZoomFromScale(50000000) },
  { label: 'Countries - big', scale: 25000000, zoom: getZoomFromScale(25000000) },
  { label: 'Countries - small', scale: 12000000, zoom: getZoomFromScale(12000000) },
  { label: 'States/Provinces', scale: 6000000, zoom: getZoomFromScale(6000000) },
  { label: 'State/Province', scale: 3000000, zoom: getZoomFromScale(3000000) },
  { label: 'Counties', scale: 1500000, zoom: getZoomFromScale(1500000) },
  { label: 'County', scale: 750000, zoom: getZoomFromScale(750000) },
  { label: 'Metropolitan area', scale: 320000, zoom: getZoomFromScale(320000) },
  { label: 'Cities', scale: 160000, zoom: getZoomFromScale(160000) },
  { label: 'City', scale: 80000, zoom: getZoomFromScale(80000) },
  { label: 'Town', scale: 40000, zoom: getZoomFromScale(40000) },
  { label: 'Neighborhood', scale: 20000, zoom: getZoomFromScale(20000) },
  { label: 'Streets', scale: 10000, zoom: getZoomFromScale(10000) },
  { label: 'Street', scale: 5000, zoom: getZoomFromScale(5000) },
  { label: 'Buildings', scale: 2500, zoom: getZoomFromScale(2500) },
  { label: 'Building', scale: 1250, zoom: getZoomFromScale(1250) },
  { label: 'Small building', scale: 800, zoom: getZoomFromScale(800) },
  { label: 'Rooms', scale: 400, zoom: getZoomFromScale(400) },
];

export const ScaleSelector: React.FC<ScaleSelectorProps> = ({ label, zoom, onChange, currentMapZoom }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [customScale, setCustomScale] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentScale = getScaleFromZoom(zoom);
  const formattedScale = zoom === 0 ? 'World' : `1:${currentScale.toLocaleString()}`;

  const handleCustomScaleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const scale = parseInt(customScale.replace(/,/g, ''), 10);
    if (!isNaN(scale) && scale > 0) {
      onChange(Math.round(getZoomFromScale(scale)));
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <div 
        style={{ fontSize: '12px', color: '#666', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}
      >
        {label}
        <i className="fa-solid fa-chevron-down" style={{ fontSize: '10px' }}></i>
      </div>
      
      <button 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '6px 8px',
          border: '1px solid #ddd',
          borderRadius: '4px',
          background: 'white',
          textAlign: 'left',
          fontSize: '13px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <span>{formattedScale}</span>
        {/* <i className="fa-solid fa-chevron-down" style={{ fontSize: '10px', color: '#999' }}></i> */}
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: 'white',
          border: '1px solid #ddd',
          borderRadius: '4px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 1000,
          maxHeight: '300px',
          overflowY: 'auto',
          marginTop: '4px'
        }}>
          {/* Custom Input */}
          <div style={{ padding: '8px', borderBottom: '1px solid #eee' }}>
            <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>Custom</div>
            <form onSubmit={handleCustomScaleSubmit} style={{ display: 'flex', alignItems: 'center', border: '1px solid #ddd', borderRadius: '4px' }}>
              <span style={{ padding: '0 6px', color: '#666', fontSize: '12px', background: '#f5f5f5', borderRight: '1px solid #ddd' }}>1:</span>
              <input 
                type="text" 
                value={customScale}
                onChange={(e) => setCustomScale(e.target.value)}
                placeholder="Scale (e.g. 50,000)"
                style={{ border: 'none', padding: '4px', fontSize: '12px', width: '100%', outline: 'none' }}
              />
            </form>
          </div>

          {/* Current Map View */}
          <div 
            onClick={() => {
              onChange(currentMapZoom);
              setIsOpen(false);
            }}
            style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #eee', fontSize: '13px' }}
            className="scale-option"
          >
            <div style={{ color: '#2196f3' }}>Current map view</div>
            <div style={{ fontSize: '11px', color: '#666' }}>1:{getScaleFromZoom(currentMapZoom).toLocaleString()}</div>
          </div>

          {/* Scale List */}
          {SCALE_OPTIONS.map((option, index) => (
            <div 
              key={index}
              onClick={() => {
                onChange(option.label === 'World' ? 0 : Math.round(option.zoom));
                setIsOpen(false);
              }}
              style={{ 
                padding: '8px 12px', 
                cursor: 'pointer', 
                borderBottom: '1px solid #f5f5f5',
                background: Math.round(zoom) === Math.round(option.zoom) ? '#f0f9ff' : 'white'
              }}
              className="scale-option"
            >
              <div style={{ fontSize: '13px', color: '#333' }}>{option.label}</div>
              {option.scale > 0 && (
                <div style={{ fontSize: '11px', color: '#888' }}>1:{option.scale.toLocaleString()}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
