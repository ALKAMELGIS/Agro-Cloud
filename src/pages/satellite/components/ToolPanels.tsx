import React from 'react';
import { LayerData } from './LayerManager';

// --- Satellite Status Widget ---
export const SatelliteStatus: React.FC = () => {
  // Simulate satellite passes
  const passes = [
    { name: 'Sentinel-2A', time: '10:45 AM', date: 'Today' },
    { name: 'Landsat 9', time: '02:30 PM', date: 'Tomorrow' },
    { name: 'Sentinel-2B', time: '11:15 AM', date: 'Feb 12' },
  ];

  return (
    <div className="tool-panel">
      <div className="tool-section" style={{ borderLeft: '4px solid #2196f3', background: '#e3f2fd' }}>
        <h4 style={{ margin: '0 0 5px 0', color: '#0d47a1' }}>Current Status</h4>
        <div style={{ fontSize: '12px' }}>Clear skies, optimal for imaging.</div>
      </div>
      
      <div className="tool-section">
        <div className="tool-section-header">Upcoming Passes</div>
        <div className="pass-list">
          {passes.map((pass, idx) => (
            <div key={idx} className="list-item">
              <div>
                <div style={{ fontWeight: 500 }}>{pass.name}</div>
                <div style={{ fontSize: '11px', color: '#666' }}>{pass.date}</div>
              </div>
              <div style={{ color: '#0079c1', fontWeight: 600 }}>{pass.time}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// --- Add Data Tool ---
export const AddDataTool: React.FC<{ onAction?: (action: string, data?: any) => void }> = ({ onAction }) => {
  const [showMenu, setShowMenu] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      // Pass the file object to parent for parsing
      onAction?.('file_loaded', { file });
      // Reset input so same file can be selected again if needed
      e.target.value = '';
    }
  };

  return (
    <div className="tool-panel" style={{ padding: '20px' }}>
      {/* Empty State / Info Box */}
      <div style={{ 
        border: '1px solid #ddd', 
        padding: '30px 20px', 
        textAlign: 'center', 
        color: '#666',
        borderRadius: '0',
        fontSize: '14px',
        marginBottom: '20px',
        backgroundColor: '#fff'
      }}>
        Add layers to your map and they will appear here.
      </div>

      {/* Add Button & Dropdown */}
      <div style={{ position: 'relative', width: 'fit-content', margin: '0 auto' }}>
        <button 
          onClick={() => setShowMenu(!showMenu)}
          style={{
            background: '#fff',
            border: '1px solid #007ac2',
            color: '#007ac2',
            padding: '8px 16px',
            borderRadius: '2px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontWeight: 500,
            fontSize: '14px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
          }}
        >
          <i className="fa-solid fa-layer-group"></i>
          Add
          <i className={`fa-solid fa-chevron-${showMenu ? 'up' : 'down'}`} style={{ fontSize: '10px', marginLeft: 'auto' }}></i>
        </button>

        {showMenu && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: '4px',
            background: 'white',
            border: '1px solid #ddd',
            boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
            borderRadius: '2px',
            width: '240px',
            zIndex: 100
          }}>
            <MenuItem 
              icon="fa-magnifying-glass" 
              label="Browse layers" 
              onClick={() => { setShowMenu(false); onAction?.('browse'); }} 
            />
            <MenuItem 
              icon="fa-file-arrow-up" 
              label="Add layer from file" 
              onClick={() => { setShowMenu(false); fileInputRef.current?.click(); }} 
            />
            <MenuItem 
              icon="fa-pencil" 
              label="Create sketch layer" 
              onClick={() => { setShowMenu(false); onAction?.('sketch'); }} 
            />
            <MenuItem 
              icon="fa-image" 
              label="Add media layer" 
              onClick={() => { setShowMenu(false); onAction?.('media'); }} 
            />
          </div>
        )}
      </div>

      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        style={{ display: 'none' }} 
        onChange={handleFileSelect}
        accept=".geojson,.json,.kml,.kmz,.zip,.csv,.shp"
      />
    </div>
  );
};

const MenuItem = ({ icon, label, onClick }: { icon: string, label: string, onClick: () => void }) => (
  <div 
    onClick={onClick}
    style={{
      padding: '12px 15px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      color: '#333',
      fontSize: '13px',
      borderBottom: '1px solid #f5f5f5'
    }}
    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f0f8ff'}
    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
  >
    <i className={`fa-solid ${icon}`} style={{ width: '16px', color: '#666', textAlign: 'center' }}></i>
    {label}
  </div>
);

// --- Legend Tool ---
export const LegendTool: React.FC<{ layers: LayerData[] }> = ({ layers }) => {
  const activeLayers = layers.filter(l => l.visible);

  return (
    <div className="tool-panel">
      {activeLayers.length === 0 ? (
        <div className="tool-section" style={{ textAlign: 'center', padding: '40px 20px', color: '#888' }}>
          <i className="fa-solid fa-layer-group" style={{ fontSize: '32px', marginBottom: '10px', opacity: 0.3 }}></i>
          <div>No active layers to show in legend.</div>
        </div>
      ) : (
        <div className="tool-section">
          {activeLayers.map(layer => (
            <div key={layer.id} style={{ marginBottom: '15px' }}>
              <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '5px' }}>{layer.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', fontSize: '12px' }}>
                <div style={{ width: '20px', height: '10px', background: '#3388ff', marginRight: '10px', borderRadius: '2px', opacity: layer.opacity !== undefined ? 1 - layer.opacity : 0.2 }}></div>
                <span>Polygon Fill</span>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Static Legend Example for Base */}
      <div className="tool-section">
        <div className="tool-section-header">Basemap Features</div>
        <div style={{ display: 'flex', alignItems: 'center', fontSize: '12px', marginBottom: '8px' }}>
          <div style={{ width: '20px', height: '2px', background: '#f57f17', marginRight: '10px' }}></div>
          <span>Major Roads</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', fontSize: '12px' }}>
          <div style={{ width: '20px', height: '20px', background: '#a5d6a7', marginRight: '10px', opacity: 0.5 }}></div>
          <span>Vegetation</span>
        </div>
      </div>
    </div>
  );
};

// --- Bookmarks Tool ---
export const BookmarksTool: React.FC = () => {
  const bookmarks = [
    { name: 'Dubai Farms', coords: '25.2, 55.3' },
    { name: 'Al Ain Oasis', coords: '24.2, 55.7' },
    { name: 'Ras Al Khaimah', coords: '25.7, 55.9' },
  ];

  return (
    <div className="tool-panel">
      <div className="tool-input-group" style={{ marginBottom: '10px' }}>
        <input type="text" placeholder="Bookmark current view..." />
        <button><i className="fa-solid fa-plus"></i></button>
      </div>

      <div className="tool-section" style={{ padding: 0, overflow: 'hidden' }}>
        {bookmarks.map((bm, idx) => (
          <div key={idx} className="list-item">
            <div>
              <div style={{ fontWeight: 500 }}>{bm.name}</div>
              <div style={{ fontSize: '11px', color: '#888' }}>{bm.coords}</div>
            </div>
            <i className="fa-solid fa-chevron-right" style={{ fontSize: '10px', color: '#ccc' }}></i>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Print Tool ---
export const PrintTool: React.FC = () => {
  return (
    <div className="tool-panel">
      <div className="tool-section">
        <div className="tool-section-header">Layout</div>
        <select style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', outline: 'none' }}>
          <option>A4 Landscape</option>
          <option>A4 Portrait</option>
          <option>A3 Landscape</option>
          <option>Map Only (PNG)</option>
        </select>
      </div>

      <div className="tool-section">
        <div className="tool-section-header">Resolution</div>
        <div style={{ display: 'flex', gap: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', fontSize: '13px', cursor: 'pointer' }}>
            <input type="radio" name="res" defaultChecked style={{ marginRight: '8px' }} /> 96 DPI
          </label>
          <label style={{ display: 'flex', alignItems: 'center', fontSize: '13px', cursor: 'pointer' }}>
            <input type="radio" name="res" style={{ marginRight: '8px' }} /> 300 DPI
          </label>
        </div>
      </div>

      <button style={{ width: '100%', padding: '12px', background: '#0079c1', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, marginTop: 'auto' }}>
        <i className="fa-solid fa-print" style={{ marginRight: '8px' }}></i>
        Print / Export
      </button>
    </div>
  );
};

// --- Generic Placeholder ---
export const GenericToolPanel: React.FC<{ title: string; icon: string; description?: string }> = ({ title, icon, description }) => {
  return (
    <div className="tool-panel" style={{ alignItems: 'center', justifyContent: 'center', color: '#888', textAlign: 'center' }}>
      <div style={{ width: '80px', height: '80px', background: '#f5f5f5', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px' }}>
        <i className={`fa-solid ${icon}`} style={{ fontSize: '32px', color: '#ccc' }}></i>
      </div>
      <h3 style={{ margin: '0 0 10px 0', color: '#333' }}>{title}</h3>
      <p style={{ fontSize: '14px', lineHeight: '1.5', maxWidth: '200px' }}>
        {description || "This tool is currently under development."}
      </p>
    </div>
  );
};
