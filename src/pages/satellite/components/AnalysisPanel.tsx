import React from 'react';

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
  return (
    <div className="tool-panel">
      <div className="tool-header">
        <h3>Satellite Intelligence</h3>
      </div>
      <div className="tool-content">
        {!hasAOI && (
          <div className="info-box warning">
            <i className="fa-solid fa-exclamation-triangle"></i>
            Please define an Area of Interest (AOI) first using the Sketch tool.
          </div>
        )}

        <div className="analysis-grid">
          {(Object.keys(activeIndices) as IndexType[]).map((index) => (
            <div 
              key={index}
              className={`analysis-card ${activeIndices[index] ? 'active' : ''}`}
              onClick={() => hasAOI && onToggleIndex(index)}
              style={{ opacity: hasAOI ? 1 : 0.6, cursor: hasAOI ? 'pointer' : 'not-allowed' }}
            >
              <div className="card-header">
                <span className="index-name">{index}</span>
                {activeIndices[index] && <i className="fa-solid fa-check-circle"></i>}
              </div>
            </div>
          ))}
        </div>

        {loading && (
          <div className="loading-indicator">
            <i className="fa-solid fa-spinner fa-spin"></i>
            Processing satellite imagery...
          </div>
        )}

        {error && (
          <div className="error-message">
            <i className="fa-solid fa-circle-exclamation"></i>
            {error}
          </div>
        )}
        
        {hasAOI && aoiArea > 0 && (
            <div className="aoi-stats">
                <span>AOI Area: {aoiArea.toFixed(2)} ha</span>
            </div>
        )}
      </div>
    </div>
  );
};
// End of component
