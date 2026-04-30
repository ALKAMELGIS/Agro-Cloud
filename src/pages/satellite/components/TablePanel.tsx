import React, { useState, useRef, useEffect } from 'react';

interface TablePanelProps {
  data: any[];
  title: string;
  onClose?: () => void;
  onAdd?: () => void; // Legacy/Generic add
  onFileSelect?: (file: File) => void;
}

export const TablePanel: React.FC<TablePanelProps> = ({ data, title, onClose, onAdd, onFileSelect }) => {
  const [showMenu, setShowMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleBrowseClick = () => {
    setShowMenu(false);
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && onFileSelect) {
      onFileSelect(file);
    }
    // Reset input value to allow selecting the same file again
    if (event.target) {
      event.target.value = '';
    }
  };

  // Render Empty State
  if (!data || data.length === 0) {
    return (
      <div className="tool-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="tool-header" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          {onClose && (
            <button onClick={onClose} className="close-btn" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
              <i className="fa-solid fa-times"></i>
            </button>
          )}
        </div>
        <div className="tool-content" style={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center', 
          padding: '20px',
          color: '#444'
        }}>
          {/* Icon */}
          <div style={{ 
            fontSize: '64px', 
            marginBottom: '30px', 
            color: '#d0d0d0', 
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            width: '100px',
            height: '100px',
            background: '#f9f9f9',
            borderRadius: '50%'
          }}>
            <i className="fa-solid fa-table"></i>
          </div>

          {/* Text Box */}
          <div style={{ 
            border: '1px solid #e0e0e0',
            padding: '20px',
            marginBottom: '30px',
            textAlign: 'center',
            width: '100%',
            color: '#666',
            fontSize: '14px',
            background: '#fff'
          }}>
            Add tables to your map and they will appear here.
          </div>

          {/* Add Button & Dropdown */}
          <div style={{ position: 'relative' }} ref={menuRef}>
            <button 
              onClick={() => setShowMenu(!showMenu)}
              style={{
                background: 'white',
                border: '1px solid #005e9c', 
                color: '#005e9c',
                padding: '8px 25px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '14px',
                minWidth: '120px',
                justifyContent: 'space-between'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f0f8ff'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <i className="fa-solid fa-table"></i>
                <span>Add</span>
              </div>
              <i className={`fa-solid fa-chevron-${showMenu ? 'up' : 'down'}`} style={{ fontSize: '10px' }}></i>
            </button>

            {/* Dropdown Menu */}
            {showMenu && (
              <div style={{
                position: 'absolute',
                bottom: '100%', // Position above the button
                left: 0,
                width: '100%',
                minWidth: '180px',
                background: 'white',
                border: '1px solid #005e9c',
                boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
                zIndex: 1000,
                marginBottom: '5px',
                display: 'flex',
                flexDirection: 'column'
              }}>
                <div 
                  onClick={handleBrowseClick}
                  style={{
                    padding: '10px 15px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    fontSize: '13px',
                    color: '#333',
                    borderBottom: '1px solid #eee'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                >
                  <i className="fa-solid fa-magnifying-glass" style={{ width: '16px', color: '#666' }}></i>
                  <span>Browse tables</span>
                </div>
              </div>
            )}
            
            <input 
              type="file" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              accept=".csv,.xlsx,.xls,.json,.geojson"
              onChange={handleFileChange}
            />
          </div>
        </div>
      </div>
    );
  }

  const columns = Object.keys(data[0]);

  return (
    <div className="tool-panel" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="tool-header" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        {onClose && (
          <button onClick={onClose} className="close-btn" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <i className="fa-solid fa-times"></i>
          </button>
        )}
      </div>

      <div className="tool-content" style={{ flex: 1, overflow: 'auto', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead style={{ background: '#f5f5f5', position: 'sticky', top: 0 }}>
            <tr>
              {columns.map((col) => (
                <th key={col} style={{ padding: '8px', borderBottom: '1px solid #ddd', textAlign: 'left', fontWeight: 600 }}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                {columns.map((col) => (
                  <td key={`${i}-${col}`} style={{ padding: '8px' }}>
                    {row[col]?.toString() || ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tool-footer" style={{ padding: '10px', borderTop: '1px solid #eee', fontSize: '12px', color: '#666' }}>
        Total Rows: {data.length}
      </div>
    </div>
  );
};
