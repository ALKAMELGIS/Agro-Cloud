import React, { useState } from 'react';
import { LayerData } from './LayerManager';
import { ScaleSelector } from './ScaleSelector';

interface LayerPropertiesProps {
  layer: LayerData;
  onUpdateLayer: (id: number | string, updates: Partial<LayerData>) => void;
  onClose: () => void;
  currentZoom?: number;
}

export const LayerProperties: React.FC<LayerPropertiesProps> = ({
  layer,
  onUpdateLayer,
  onClose,
  currentZoom = 13
}) => {
  // Section toggle state
  const [sections, setSections] = useState({
    information: true,
    symbology: true,
    appearance: true,
    visibility: true
  });

  const toggleSection = (section: keyof typeof sections) => {
    setSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="layer-properties-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f8f8f8' }}>
      {/* Header handled by parent panel usually, but we can add specific layer header if needed */}
      <div style={{ padding: '15px', borderBottom: '1px solid #ddd', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{layer.name}</h3>
          <span style={{ fontSize: '12px', color: '#666' }}>{layer.type.toUpperCase()} Layer</span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
        
        {/* Information Section */}
        <div className="prop-section" style={sectionStyle}>
          <div className="prop-header" onClick={() => toggleSection('information')} style={headerStyle}>
            <span>Information</span>
            <i className={`fa-solid fa-chevron-${sections.information ? 'up' : 'down'}`} style={{ fontSize: '12px', color: '#666' }}></i>
          </div>
          {sections.information && (
            <div className="prop-content" style={contentStyle}>
              <div style={rowStyle}>
                <span style={labelStyle}>Name</span>
                <span style={valueStyle}>{layer.name}</span>
              </div>
            </div>
          )}
        </div>

        {/* Symbology Section */}
        <div className="prop-section" style={sectionStyle}>
          <div className="prop-header" onClick={() => toggleSection('symbology')} style={headerStyle}>
            <span>Symbology</span>
            <i className={`fa-solid fa-chevron-${sections.symbology ? 'up' : 'down'}`} style={{ fontSize: '12px', color: '#666' }}></i>
          </div>
          {sections.symbology && (
            <div className="prop-content" style={contentStyle}>
              <div style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '13px', color: '#444', marginBottom: '8px' }}>Symbol style</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'white', border: '1px solid #ddd', borderRadius: '6px' }}>
                  
                  {/* Color Preview/Picker */}
                  <div style={{ position: 'relative', width: '40px', height: '40px', background: '#f8f8f8', borderRadius: '4px', border: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ 
                      width: '24px', 
                      height: '24px', 
                      backgroundColor: layer.fillColor || layer.color || '#3388ff',
                      border: `${Math.min(layer.weight || 2, 6)}px solid ${layer.color || '#3388ff'}`,
                      borderRadius: '2px'
                    }}></div>
                    <input 
                      type="color" 
                      value={layer.color || '#3388ff'}
                      onChange={(e) => onUpdateLayer(layer.id, { color: e.target.value, fillColor: e.target.value })}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                    />
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#333' }}>Simple Layer</div>
                    <div style={{ fontSize: '12px', color: '#666' }}>Single symbol</div>
                  </div>
                </div>
              </div>

              {/* Stroke Width */}
              <div style={{ marginBottom: '15px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ fontSize: '13px', color: '#444' }}>Outline width</div>
                  <div style={{ fontSize: '13px', color: '#666' }}>{layer.weight || 2}px</div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="1"
                  value={layer.weight || 2}
                  onChange={(e) => onUpdateLayer(layer.id, { weight: parseInt(e.target.value) })}
                  style={{ width: '100%', cursor: 'pointer', accentColor: layer.color || '#3388ff' }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Appearance Section */}
        <div className="prop-section" style={sectionStyle}>
          <div className="prop-header" onClick={() => toggleSection('appearance')} style={headerStyle}>
            <span>Appearance</span>
            <i className={`fa-solid fa-chevron-${sections.appearance ? 'up' : 'down'}`} style={{ fontSize: '12px', color: '#666' }}></i>
          </div>
          {sections.appearance && (
            <div className="prop-content" style={contentStyle}>
              
              {/* Blending */}
              <div style={{ marginBottom: '15px' }}>
                <div style={{ fontSize: '13px', marginBottom: '5px', color: '#444' }}>Blending</div>
                <select 
                  style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #ddd', fontSize: '13px' }}
                  value={layer.blendMode || 'normal'}
                  onChange={(e) => onUpdateLayer(layer.id, { blendMode: e.target.value as any })}
                >
                  <option value="normal">Normal</option>
                  <option value="multiply">Multiply</option>
                  <option value="screen">Screen</option>
                  <option value="overlay">Overlay</option>
                  <option value="darken">Darken</option>
                  <option value="lighten">Lighten</option>
                </select>
              </div>

              {/* Transparency */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                  <div style={{ fontSize: '13px', color: '#444' }}>Transparency</div>
                  <div style={{ fontSize: '13px', color: '#666' }}>{Math.round((1 - layer.opacity) * 100)}%</div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={1 - layer.opacity}
                  onChange={(e) => onUpdateLayer(layer.id, { opacity: 1 - parseFloat(e.target.value) })}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#999', marginTop: '4px' }}>
                  <span>0%</span>
                  <span>25%</span>
                  <span>50%</span>
                  <span>75%</span>
                  <span>100%</span>
                </div>
              </div>

            </div>
          )}
        </div>

        {/* Visibility Section */}
        <div className="prop-section" style={sectionStyle}>
          <div className="prop-header" onClick={() => toggleSection('visibility')} style={headerStyle}>
            <span>Visibility</span>
            <i className={`fa-solid fa-chevron-${sections.visibility ? 'up' : 'down'}`} style={{ fontSize: '12px', color: '#666' }}></i>
          </div>
          {sections.visibility && (
            <div className="prop-content" style={contentStyle}>
              <div style={{ marginBottom: '5px', fontSize: '13px', color: '#444' }}>Visible range</div>
              
              {/* Range Slider Visual */}
              <div style={{ position: 'relative', height: '30px', margin: '10px 0' }}>
                <div style={{ position: 'absolute', top: '14px', left: '0', right: '0', height: '2px', background: '#ccc' }}></div>
                
                {/* Active Range Bar */}
                <div style={{ 
                  position: 'absolute', 
                  top: '14px', 
                  left: `${((layer.minZoom || 0) / 20) * 100}%`, 
                  right: `${100 - ((layer.maxZoom || 20) / 20) * 100}%`, 
                  height: '2px', 
                  background: '#2196f3' 
                }}></div>
                
                {/* Min Handle */}
                <div style={{ 
                  position: 'absolute', 
                  top: '5px', 
                  left: `${((layer.minZoom || 0) / 20) * 100}%`, 
                  transform: 'translateX(-50%)',
                  width: '16px', 
                  height: '16px', 
                  borderRadius: '50%', 
                  background: 'white', 
                  border: '2px solid #2196f3', 
                  cursor: 'pointer' 
                }}></div>

                {/* Max Handle */}
                <div style={{ 
                  position: 'absolute', 
                  top: '5px', 
                  left: `${((layer.maxZoom || 20) / 20) * 100}%`, 
                  transform: 'translateX(-50%)',
                  width: '16px', 
                  height: '16px', 
                  borderRadius: '50%', 
                  background: 'white', 
                  border: '2px solid #2196f3', 
                  cursor: 'pointer' 
                }}></div>
                
                {/* Current Zoom Indicator */}
                <div style={{ 
                  position: 'absolute', 
                  top: '22px', 
                  left: `${(currentZoom / 20) * 100}%`, 
                  transform: 'translateX(-50%)', 
                  width: 0, 
                  height: 0, 
                  borderLeft: '5px solid transparent', 
                  borderRight: '5px solid transparent', 
                  borderBottom: '6px solid #333',
                  transition: 'left 0.3s ease'
                }}></div>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#2196f3', gap: '15px' }}>
                <div style={{ width: '50%' }}>
                  <ScaleSelector 
                    label="World" 
                    zoom={layer.minZoom || 0} 
                    onChange={(z) => onUpdateLayer(layer.id, { minZoom: z })}
                    currentMapZoom={currentZoom}
                  />
                </div>
                <div style={{ width: '50%' }}>
                  <ScaleSelector 
                    label="Room" 
                    zoom={layer.maxZoom || 20} 
                    onChange={(z) => onUpdateLayer(layer.id, { maxZoom: z })}
                    currentMapZoom={currentZoom}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

// Styles
const sectionStyle: React.CSSProperties = {
  background: 'white',
  marginBottom: '8px',
  borderRadius: '4px',
  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
  overflow: 'hidden'
};

const headerStyle: React.CSSProperties = {
  padding: '12px 15px',
  cursor: 'pointer',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontWeight: 500,
  fontSize: '14px',
  color: '#333',
  userSelect: 'none'
};

const contentStyle: React.CSSProperties = {
  padding: '0 15px 15px 15px',
  borderTop: '1px solid #f0f0f0'
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: '8px',
  fontSize: '13px'
};

const labelStyle: React.CSSProperties = {
  color: '#666'
};

const valueStyle: React.CSSProperties = {
  color: '#333',
  fontWeight: 500,
  textAlign: 'right' as const
};
