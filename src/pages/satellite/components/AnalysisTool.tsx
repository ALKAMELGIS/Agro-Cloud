import React, { useState } from 'react';

export type IndexType = 'NDVI' | 'NDWI' | 'NDMI' | 'SAVI';

interface AnalysisPanelProps {
  activeIndices: Record<IndexType, boolean>;
  onToggleIndex: (index: IndexType) => void;
  loading: boolean;
  error: string | null;
  aoiArea: number;
  hasAOI: boolean;
  selectedItem?: any;
  stats?: any;
  onExportCSV?: () => void;
}

const TEMPLATES = [
  { 
    id: 'NDVI' as IndexType, 
    name: 'Vegetation Health', 
    subtitle: 'NDVI',
    description: 'Normalized Difference Vegetation Index. Measures live green vegetation.', 
    icon: 'fa-seedling', 
    color: '#4caf50',
    bg: '#e8f5e9',
    stats: { mean: 0.68, min: 0.12, max: 0.89, label: 'Healthy Vegetation' }
  },
  { 
    id: 'NDWI' as IndexType, 
    name: 'Water Content', 
    subtitle: 'NDWI',
    description: 'Normalized Difference Water Index. Monitor plant water stress.', 
    icon: 'fa-water', 
    color: '#2196f3',
    bg: '#e3f2fd',
    stats: { mean: 0.45, min: -0.1, max: 0.76, label: 'Moderate Moisture' }
  },
  { 
    id: 'NDMI' as IndexType, 
    name: 'Moisture Index', 
    subtitle: 'NDMI',
    description: 'Normalized Difference Moisture Index. Detects moisture levels in crop canopy.', 
    icon: 'fa-droplet', 
    color: '#00bcd4',
    bg: '#e0f7fa',
    stats: { mean: 0.55, min: 0.2, max: 0.82, label: 'Adequate Hydration' }
  },
  { 
    id: 'SAVI' as IndexType, 
    name: 'Soil Adjusted', 
    subtitle: 'SAVI',
    description: 'Soil Adjusted Vegetation Index. Minimizes soil brightness influence.', 
    icon: 'fa-layer-group', 
    color: '#ff9800',
    bg: '#fff3e0',
    stats: { mean: 0.62, min: 0.15, max: 0.85, label: 'Soil Corrected' }
  }
];

export const AnalysisPanel: React.FC<AnalysisPanelProps> = ({
  activeIndices,
  onToggleIndex,
  loading,
  error,
  aoiArea,
  hasAOI,
  selectedItem,
  stats,
  onExportCSV
}) => {
  const [selectedTemplate, setSelectedTemplate] = useState<IndexType | null>(null);
  const [showResults, setShowResults] = useState(false);

  const handleRunAnalysis = () => {
    if (selectedTemplate) {
      // Check if image is selected
      if (!selectedItem) {
         alert("Please select a satellite image from the 'Image Collection Explorer' before running analysis.");
         return;
      }

      // If not active, toggle it on
      if (!activeIndices[selectedTemplate]) {
        onToggleIndex(selectedTemplate);
      }
      setShowResults(true);
    }
  };

  const activeTemplate = TEMPLATES.find(t => activeIndices[t.id]);
  const displayTemplate = selectedTemplate ? TEMPLATES.find(t => t.id === selectedTemplate) : activeTemplate;

  return (
    <div className="tool-panel">
      <div className="tool-header">
        <h3>Satellite Intelligence</h3>
      </div>
      <div className="tool-content">
        {!hasAOI ? (
          <div className="aoi-setup-section">
            <div className="info-box" style={{ 
              marginBottom: '20px', 
              background: '#e3f2fd', 
              color: '#0d47a1', 
              border: '1px solid #bbdefb',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              alignItems: 'start',
              gap: '12px'
            }}>
              <i className="fa-solid fa-layer-group" style={{ marginTop: '3px' }}></i>
              <div>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>Define Area of Interest</div>
                <div style={{ fontSize: '13px', opacity: 0.9 }}>Drawing tools are disabled. Load or select an existing AOI layer to enable analysis.</div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {!selectedItem && (
               <div style={{ 
                 marginBottom: '15px', 
                 padding: '12px', 
                 background: '#fff3e0', 
                 borderLeft: '4px solid #ff9800',
                 borderRadius: '4px',
                 fontSize: '12px',
                 color: '#e65100'
               }}>
                 <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: '6px' }}></i>
                 <strong>Action Required:</strong> Please select a satellite image from the <em>Image Collection Explorer</em> to enable analysis.
               </div>
            )}

            <div className="section-header" style={{ 
               fontSize: '12px', 
               fontWeight: 600, 
               color: '#888', 
               textTransform: 'uppercase', 
               letterSpacing: '0.5px',
               marginBottom: '12px',
               marginTop: '5px'
             }}>Processing Templates</div>

            <div className="analysis-grid" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {TEMPLATES.map((template) => {
                const isActive = activeIndices[template.id];
                const isSelected = selectedTemplate === template.id;
                
                return (
                  <div 
                    key={template.id}
                    onClick={() => {
                      setSelectedTemplate(template.id);
                      setShowResults(false); // Reset results when changing selection
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '12px',
                      borderRadius: '8px',
                      background: isSelected ? template.bg : '#fff',
                      border: isSelected ? `1px solid ${template.color}` : '1px solid #eee',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      position: 'relative',
                      overflow: 'hidden'
                    }}
                  >
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '8px',
                      background: template.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      marginRight: '12px',
                      flexShrink: 0
                    }}>
                      <i className={`fa-solid ${template.icon}`}></i>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: '14px', color: '#333' }}>{template.name}</span>
                        <span style={{ fontSize: '10px', fontWeight: 700, color: template.color, background: 'rgba(255,255,255,0.8)', padding: '2px 6px', borderRadius: '4px' }}>{template.subtitle}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#666', marginTop: '2px', lineHeight: '1.3' }}>
                        {template.description}
                      </div>
                    </div>
                    {isActive && (
                      <div style={{
                        position: 'absolute',
                        right: '0',
                        top: '0',
                        background: '#4caf50',
                        color: 'white',
                        fontSize: '10px',
                        padding: '2px 8px',
                        borderBottomLeftRadius: '8px',
                        fontWeight: 600
                      }}>ACTIVE</div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: '20px' }}>
              <button
                disabled={!selectedTemplate || loading}
                onClick={handleRunAnalysis}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: selectedTemplate ? 'var(--primary-color, #2e7d32)' : '#e0e0e0',
                  color: selectedTemplate ? 'white' : '#9e9e9e',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: selectedTemplate ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  transition: 'background 0.2s'
                }}
              >
                {loading ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin"></i> Processing...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-play"></i> Run Analysis
                  </>
                )}
              </button>
            </div>

            {error && (
              <div className="error-message" style={{ marginTop: '16px' }}>
                <i className="fa-solid fa-circle-exclamation"></i>
                {error}
              </div>
            )}
            
            {showResults && displayTemplate && (
              <div className="analysis-results" style={{ marginTop: '24px', animation: 'fadeIn 0.3s ease-in-out' }}>
                <div className="section-header" style={{ 
                  fontSize: '12px', 
                  fontWeight: 600, 
                  color: '#888', 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.5px',
                  marginBottom: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span>Analysis Results</span>
                  <span style={{ fontSize: '10px', background: displayTemplate.color, color: 'white', padding: '2px 6px', borderRadius: '4px' }}>{displayTemplate.subtitle}</span>
                </div>
                
                <div style={{ background: '#f8f9fa', borderRadius: '8px', padding: '16px', border: '1px solid #eee' }}>
                   <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                      <div style={{ background: 'white', padding: '10px', borderRadius: '6px', border: '1px solid #eee', textAlign: 'center' }}>
                        <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Mean Value</div>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: displayTemplate.color }}>{displayTemplate.stats.mean}</div>
                      </div>
                      <div style={{ background: 'white', padding: '10px', borderRadius: '6px', border: '1px solid #eee', textAlign: 'center' }}>
                        <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Interpretation</div>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#444' }}>{displayTemplate.stats.label}</div>
                      </div>
                   </div>

                   <div style={{ marginBottom: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666', marginBottom: '4px' }}>
                        <span>Min: {displayTemplate.stats.min}</span>
                        <span>Max: {displayTemplate.stats.max}</span>
                      </div>
                      <div style={{ height: '6px', background: '#e0e0e0', borderRadius: '3px', overflow: 'hidden', position: 'relative' }}>
                        <div style={{ 
                          position: 'absolute', 
                          left: '20%', 
                          width: '60%', 
                          height: '100%', 
                          background: displayTemplate.color, 
                          borderRadius: '3px' 
                        }}></div>
                      </div>
                   </div>
                </div>
              </div>
            )}

          </>
        )}
      </div>
    </div>
  );
};
