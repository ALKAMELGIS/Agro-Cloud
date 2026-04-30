import React from 'react';

export type SymbologyStyle =
  | 'unique'
  | 'color'
  | 'size'
  | 'color_size'
  | 'dot_density'
  | 'threshold_markers';

export type SymbologyClassMethod = 'jenks' | 'quantile' | 'equal_interval';

export type SymbologyColorRamp = 'viridis' | 'blues' | 'greens' | 'plasma' | 'magma' | 'turbo';

export interface SymbologyConfig {
  useArcGisOnline?: boolean;
  style?: SymbologyStyle;
  field?: string;
  classes?: number;
  method?: SymbologyClassMethod;
  colorRamp?: SymbologyColorRamp;
  threshold?: number;
}

export interface LayerData {
  id: number | string;
  name: string;
  type: 'geojson' | 'wms' | 'tile' | 'image';
  source?: 'arcgis' | 'upload';
  visible: boolean;
  opacity: number;
  data?: any; // GeoJSON data or other source info
  url?: string;
  authToken?: string;
  arcgisLayerDefinition?: any;
  arcgisRenderer?: any;
  arcgisLabelingInfo?: any;
  arcgisPortalItemId?: string;
  arcgisStyleUrl?: string;
  group?: string;
  blendMode?: 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';
  minZoom?: number;
  maxZoom?: number;
  bbox?: [number, number, number, number]; // [minX, minY, maxX, maxY]
  color?: string;       // Stroke color
  fillColor?: string;   // Fill color
  weight?: number;      // Stroke width
  symbology?: SymbologyConfig;
}

interface LayerManagerProps {
  layers: LayerData[];
  setLayers: (layers: LayerData[]) => void;
  onZoomToLayer?: (layer: LayerData) => void;
  onLayerInfo?: (layer: LayerData) => void;
  onRemoveLayer?: (layerId: number | string) => void;
}

export const LayerManager: React.FC<LayerManagerProps> = ({ 
  layers, 
  setLayers,
  onZoomToLayer,
  onLayerInfo,
  onRemoveLayer
}) => {
  const [openMenuId, setOpenMenuId] = React.useState<number | string | null>(null);

  const toggleLayer = (id: number | string) => {
    setLayers(layers.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
  };

  const changeOpacity = (id: number | string, opacity: number) => {
    setLayers(layers.map(l => l.id === id ? { ...l, opacity } : l));
  };

  const moveLayer = (id: number | string, direction: 'up' | 'down') => {
    const index = layers.findIndex(l => l.id === id);
    if (index === -1) return;
    if (direction === 'up' && index > 0) {
      const newLayers = [...layers];
      [newLayers[index - 1], newLayers[index]] = [newLayers[index], newLayers[index - 1]];
      setLayers(newLayers);
    } else if (direction === 'down' && index < layers.length - 1) {
      const newLayers = [...layers];
      [newLayers[index + 1], newLayers[index]] = [newLayers[index], newLayers[index + 1]];
      setLayers(newLayers);
    }
  };

  const handleRename = (id: number | string) => {
    const layer = layers.find(l => l.id === id);
    if (layer) {
      const newName = prompt("Enter new layer name:", layer.name);
      if (newName && newName !== layer.name) {
        setLayers(layers.map(l => l.id === id ? { ...l, name: newName } : l));
      }
    }
    setOpenMenuId(null);
  };

  const handleGroup = (id: number | string) => {
    const layer = layers.find(l => l.id === id);
    if (layer) {
      const groupName = prompt("Enter group name:", layer.group || "");
      if (groupName !== null) {
        setLayers(layers.map(l => l.id === id ? { ...l, group: groupName || undefined } : l));
      }
    }
    setOpenMenuId(null);
  };

  const handleUngroup = (id: number | string) => {
    setLayers(layers.map(l => l.id === id ? { ...l, group: undefined } : l));
    setOpenMenuId(null);
  };

  // Close menu when clicking outside
  React.useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  // Group layers for display
  const groupedLayers = React.useMemo(() => {
    const groups: { [key: string]: LayerData[] } = {};
    const ungrouped: LayerData[] = [];

    layers.forEach(layer => {
      if (layer.group) {
        if (!groups[layer.group]) groups[layer.group] = [];
        groups[layer.group].push(layer);
      } else {
        ungrouped.push(layer);
      }
    });

    return { groups, ungrouped };
  }, [layers]);

  return (
    <div className="tool-panel">
      <div className="tool-section">
        <div className="tool-section-header">Operational Layers</div>
        
        {layers.length === 0 && (
          <div className="upload-dropzone" style={{ padding: '40px 20px', background: '#f9f9f9', border: '1px dashed #ddd', borderRadius: '4px', textAlign: 'center' }}>
            <i className="fa-solid fa-layer-group" style={{ fontSize: '24px', marginBottom: '10px', color: '#ccc' }}></i>
            <div className="upload-text" style={{ fontSize: '13px', color: '#555' }}>No layers added</div>
            <div className="upload-subtext" style={{ fontSize: '11px', color: '#999' }}>Add data to see layers here</div>
          </div>
        )}

        <div className="layer-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Render Ungrouped Layers */}
          {groupedLayers.ungrouped.map((layer) => (
            <LayerItem 
              key={layer.id} 
              layer={layer} 
              layers={layers}
              openMenuId={openMenuId}
              setOpenMenuId={setOpenMenuId}
              toggleLayer={toggleLayer}
              changeOpacity={changeOpacity}
              moveLayer={moveLayer}
              handleRename={handleRename}
              handleGroup={handleGroup}
              handleUngroup={handleUngroup}
              onZoomToLayer={onZoomToLayer}
              onLayerInfo={onLayerInfo}
              onRemoveLayer={onRemoveLayer}
            />
          ))}

          {/* Render Grouped Layers */}
          {Object.entries(groupedLayers.groups).map(([groupName, groupLayers]) => (
            <div key={groupName} className="layer-group" style={{ border: '1px solid #eee', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ padding: '8px 10px', background: '#f5f5f5', fontWeight: 600, fontSize: '12px', color: '#666', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <i className="fa-solid fa-folder-open"></i>
                {groupName}
                <span style={{ marginLeft: 'auto', fontSize: '10px', background: '#e0e0e0', padding: '2px 6px', borderRadius: '10px' }}>{groupLayers.length}</span>
              </div>
              <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {groupLayers.map(layer => (
                  <LayerItem 
                    key={layer.id} 
                    layer={layer} 
                    layers={layers}
                    openMenuId={openMenuId}
                    setOpenMenuId={setOpenMenuId}
                    toggleLayer={toggleLayer}
                    changeOpacity={changeOpacity}
                    moveLayer={moveLayer}
                    handleRename={handleRename}
                    handleGroup={handleGroup}
                    handleUngroup={handleUngroup}
                    onZoomToLayer={onZoomToLayer}
                    onLayerInfo={onLayerInfo}
                    onRemoveLayer={onRemoveLayer}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Extracted LayerItem component for cleaner code
const LayerItem = ({ 
  layer, layers, openMenuId, setOpenMenuId, toggleLayer, changeOpacity, moveLayer, handleRename, handleGroup, handleUngroup, onZoomToLayer, onLayerInfo, onRemoveLayer 
}: any) => (
  <div className="layer-item" style={{ background: 'white', border: '1px solid #eee', borderRadius: '4px', padding: '10px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', position: 'relative' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
        <input
          type="checkbox"
          checked={layer.visible}
          onChange={() => toggleLayer(layer.id)}
          style={{ cursor: 'pointer', width: '16px', height: '16px' }}
        />
        <span style={{ fontWeight: 500, fontSize: '13px', color: '#333' }}>{layer.name}</span>
      </div>
      
      {/* Context Menu Trigger */}
      <button 
        onClick={(e) => {
          e.stopPropagation();
          setOpenMenuId(openMenuId === layer.id ? null : layer.id);
        }}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '4px',
          borderRadius: '4px',
          color: '#666'
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <i className="fa-solid fa-ellipsis"></i>
      </button>

      {/* Dropdown Menu */}
      {openMenuId === layer.id && (
        <div 
          style={{
            position: 'absolute',
            top: '30px',
            right: '10px',
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: '4px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
            zIndex: 100,
            width: '160px',
            display: 'flex',
            flexDirection: 'column',
            padding: '4px 0'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem icon="fa-magnifying-glass-plus" label="Zoom to layer" onClick={() => { onZoomToLayer?.(layer); setOpenMenuId(null); }} />
          <MenuItem icon="fa-circle-info" label="Show properties" onClick={() => { onLayerInfo?.(layer); setOpenMenuId(null); }} />
          <MenuItem icon="fa-pen" label="Rename" onClick={() => handleRename(layer.id)} />
          <MenuItem icon="fa-trash-can" label="Remove" onClick={() => { onRemoveLayer?.(layer.id); setOpenMenuId(null); }} danger />
          <div style={{ height: '1px', background: '#eee', margin: '4px 0' }}></div>
          <MenuItem 
            icon="fa-object-group" 
            label={layer.group ? "Change Group" : "Group"} 
            onClick={() => handleGroup(layer.id)} 
          />
          {layer.group && (
             <MenuItem 
               icon="fa-folder-minus" 
               label="Ungroup" 
               onClick={() => handleUngroup(layer.id)} 
             />
          )}
          <div style={{ position: 'relative' }} className="submenu-parent">
              <MenuItem icon="fa-arrows-up-down" label="Move" onClick={() => {}} hasSubmenu />
              <div className="submenu" style={{ 
                  position: 'relative', 
                  paddingLeft: '20px',
                  background: '#f9f9f9',
                  borderTop: '1px solid #eee',
                  borderBottom: '1px solid #eee'
              }}>
                   <MenuItem icon="fa-arrow-up" label="Move Up" onClick={() => { moveLayer(layer.id, 'up'); setOpenMenuId(null); }} disabled={layers.indexOf(layer) === 0} />
                   <MenuItem icon="fa-arrow-down" label="Move Down" onClick={() => { moveLayer(layer.id, 'down'); setOpenMenuId(null); }} disabled={layers.indexOf(layer) === layers.length - 1} />
              </div>
          </div>
        </div>
      )}
    </div>
    
    {layer.visible && (
      <div style={{ paddingLeft: '28px', paddingRight: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <i className="fa-solid fa-eye" style={{ fontSize: '10px', color: '#999' }}></i>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={1 - layer.opacity}
            onChange={(e) => changeOpacity(layer.id, 1 - parseFloat(e.target.value))}
            style={{ flex: 1, height: '4px', cursor: 'pointer' }}
          />
        </div>
      </div>
    )}
  </div>
);

const MenuItem = ({ icon, label, onClick, danger, disabled, hasSubmenu }: { icon: string, label: string, onClick: () => void, danger?: boolean, disabled?: boolean, hasSubmenu?: boolean }) => (
  <div 
    onClick={!disabled ? onClick : undefined}
    style={{
      padding: '8px 15px',
      cursor: disabled ? 'not-allowed' : 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      color: disabled ? '#ccc' : (danger ? '#d32f2f' : '#333'),
      fontSize: '13px',
      transition: 'background 0.2s'
    }}
    onMouseEnter={(e) => !disabled && (e.currentTarget.style.background = '#f5f5f5')}
    onMouseLeave={(e) => !disabled && (e.currentTarget.style.background = 'transparent')}
  >
    <i className={`fa-solid ${icon}`} style={{ width: '16px', textAlign: 'center', fontSize: '12px' }}></i>
    <span style={{ flex: 1 }}>{label}</span>
    {hasSubmenu && <i className="fa-solid fa-chevron-right" style={{ fontSize: '10px', color: '#999' }}></i>}
  </div>
);
