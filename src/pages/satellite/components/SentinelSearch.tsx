import React, { useState } from 'react';
import './SentinelSearch.css';

interface StacItem {
  id: string;
  properties: {
    datetime: string;
    'eo:cloud_cover': number;
    platform: string;
  };
  assets: {
    visual: { href: string };
    thumbnail?: { href: string };
    rendered_preview?: { href: string };
    tilejson?: { href: string };
  };
  bbox: number[];
  collection: string;
}

interface SentinelSearchProps {
  onSelectImage: (item: StacItem, visualization?: any) => void;
  onAddLayer?: (item: StacItem, visualization?: any) => void;
  getMapBounds: () => number[] | null; // Returns [minLon, minLat, maxLon, maxLat]
  aoiGeometry?: any | null; // GeoJSON object
  showHeader?: boolean;
}

export const SentinelSearch: React.FC<SentinelSearchProps> = ({ 
  onSelectImage, 
  onAddLayer,
  getMapBounds, 
  aoiGeometry,
  showHeader = true
}) => {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<StacItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  
  const [collection, setCollection] = useState('sentinel-2-l2a');
  const [startDate, setStartDate] = useState(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [endDate, setEndDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [cloudCover, setCloudCover] = useState(20);
  const [visualization, setVisualization] = useState('visual');
  const [analysisType, setAnalysisType] = useState('ndvi');

  const VISUALIZATIONS = [
    { label: 'Natural Color', value: 'visual', assets: 'visual', params: {} },
    { label: 'Color Infrared', value: 'color_infrared', assets: 'B08,B04,B03', params: { color_formula: 'gamma R 2.5, gamma G 2.5, gamma B 2.5, sigmoidal R 15 0.35' } },
    { label: 'Short Wave Infrared', value: 'swir', assets: 'B12,B8A,B04', params: {} },
    { label: 'Agriculture', value: 'agriculture', assets: 'B11,B08,B02', params: {} },
    { label: 'Vegetation Health (NDVI)', value: 'ndvi', expression: '((B08/10000)-(B04/10000))/((B08/10000)+(B04/10000))', colormap: 'rdylgn', rescale: '-1,1' },
    { label: 'Water Content (NDWI)', value: 'ndwi', expression: '((B03/10000)-(B08/10000))/((B03/10000)+(B08/10000))', colormap: 'Blues', rescale: '-1,1' },
    { label: 'Moisture Index (NDMI)', value: 'ndmi', expression: '((B08/10000)-(B11/10000))/((B08/10000)+(B11/10000))', colormap: 'YlGnBu', rescale: '-1,1' },
    { label: 'Enhanced Vegetation (EVI)', value: 'evi', expression: '2.5 * ((B08/10000 - B04/10000) / (B08/10000 + 6 * B04/10000 - 7.5 * B02/10000 + 1))', colormap: 'Greens', rescale: '-1,1' },
    { label: 'Enhanced Vegetation 2 (EVI2)', value: 'evi2', expression: '2.5 * ((B08/10000 - B04/10000) / (B08/10000 + 2.4 * B04/10000 + 1))', colormap: 'Greens', rescale: '-1,1' },
    { label: 'Soil Adjusted (SAVI)', value: 'savi', expression: '((B08/10000 - B04/10000) / (B08/10000 + B04/10000 + 0.5)) * 1.5', colormap: 'YlOrBr', rescale: '-1,1' },
    { label: 'Bare Soil Index (BSI)', value: 'bsi', expression: '((B11/10000 + B04/10000) - (B08/10000 + B02/10000)) / ((B11/10000 + B04/10000) + (B08/10000 + B02/10000))', colormap: 'YlOrBr', rescale: '-1,1' },
    { label: 'Burn Ratio (NBR)', value: 'nbr', expression: '((B08/10000) - (B12/10000)) / ((B08/10000) + (B12/10000))', colormap: 'Reds', rescale: '-1,1' },
    { label: 'Atmospheric Penetration', value: 'atmospheric', assets: 'B12,B11,B8A', params: {} }
  ];

  const handleSearch = async (vizMode?: string) => {
    if (vizMode) {
      setVisualization(vizMode);
    }
    
    // Priority: AOI Geometry -> Map Bounds
    let searchBody: any = {
      collections: [collection],
      datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
      query: {
        'eo:cloud_cover': { lt: cloudCover }
      },
      limit: 20
    };

    if (aoiGeometry) {
      searchBody.intersects = aoiGeometry;
    } else {
      const bounds = getMapBounds();
      if (!bounds) {
        setError("Map is not ready or bounds unavailable.");
        return;
      }
      searchBody.bbox = bounds;
    }

    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const response = await fetch('/api/stac/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(searchBody)
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      const data = await response.json();
      setResults(data.features || []);
      
      if (data.features.length === 0) {
        setError("No images found for this area/criteria.");
      }

    } catch (err: any) {
      setError(err.message || "An error occurred during search.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sentinel-search-panel">
      
      <div className="search-form">
        {/* 1. Collection */}
        <div className="search-field-group full-width" style={{ marginBottom: '16px' }}>
          <label className="search-field-label">
            <i className="fa-solid fa-layer-group"></i> Collection
          </label>
          <select
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
            className="search-select"
          >
            <option value="sentinel-2-l2a">Sentinel-2 Level-2A</option>
            <option value="landsat-c2-l2">Landsat Collection 2</option>
            <option value="naip">NAIP (USA)</option>
          </select>
        </div>

        {/* 2. Date Range */}
        <div className="search-row two-col" style={{ marginBottom: '16px' }}>
          <div className="search-field-group">
            <label className="search-field-label">Start Date</label>
            <input 
              type="date" 
              className="search-date-input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="search-field-group">
            <label className="search-field-label">End Date</label>
            <input 
              type="date" 
              className="search-date-input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        {/* 3. Cloud Cover */}
        <div className="search-field-group" style={{ marginBottom: '20px' }}>
          <div className="cloud-header">
            <label className="search-field-label">
              <i className="fa-solid fa-cloud"></i> Max Cloud Cover
            </label>
            <span className="cloud-value">{cloudCover}%</span>
          </div>
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={cloudCover} 
            onChange={(e) => setCloudCover(parseInt(e.target.value))}
            className="styled-slider"
            style={{backgroundSize: `${cloudCover}% 100%`}}
          />
        </div>

        {/* Option 1: Search Imagery */}
        <button 
          className="search-btn-primary"
          onClick={() => handleSearch('visual')}
          disabled={loading}
        >
          {loading && visualization === 'visual' ? (
            <><i className="fa-solid fa-spinner fa-spin"></i> Searching...</>
          ) : (
            <><i className="fa-solid fa-magnifying-glass"></i> Search Imagery</>
          )}
        </button>

        {/* Divider */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          margin: '16px 0', 
          color: '#94a3b8', 
          fontSize: '11px', 
          fontWeight: 700,
          letterSpacing: '0.5px'
        }}>
          <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }}></div>
          <span style={{ padding: '0 8px' }}>ANALYSIS TOOLS</span>
          <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }}></div>
        </div>

        {/* Option 2: Run Analysis */}
        <div className="search-field-group full-width">
          <label className="search-field-label">
            <i className="fa-solid fa-chart-line"></i> Select Index
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <select
              value={analysisType}
              onChange={(e) => setAnalysisType(e.target.value)}
              className="search-select"
              style={{ flex: 1 }}
            >
              {VISUALIZATIONS.filter(v => v.value !== 'visual').map(v => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
            <button 
              className="search-btn-primary analysis-mode"
              style={{ width: 'auto', padding: '0 16px', whiteSpace: 'nowrap' }}
              onClick={() => handleSearch(analysisType)}
              disabled={loading}
            >
              {loading && visualization !== 'visual' ? (
                <i className="fa-solid fa-spinner fa-spin"></i>
              ) : (
                <><i className="fa-solid fa-bolt"></i> Run Analysis</>
              )}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="error-msg">
          <i className="fa-solid fa-circle-exclamation"></i> {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="results-container">
          <div className="results-header">
            <div className="results-title">
              <i className="fa-solid fa-list-check"></i>
              Results Found
            </div>
            <span className="results-count">
              {results.length}
            </span>
          </div>
          <div className="results-list">
            {results.map(item => (
              <div 
                key={item.id} 
                className={`result-card ${expandedId === item.id ? 'expanded' : ''}`}
                onClick={() => {
                  onSelectImage(item, VISUALIZATIONS.find(v => v.value === visualization));
                  setExpandedId(item.id === expandedId ? null : item.id);
                }}
              >
                <div className="result-thumb">
                  {item.assets.rendered_preview?.href || item.assets.thumbnail?.href ? (
                    <img src={item.assets.rendered_preview?.href || item.assets.thumbnail?.href} alt="Thumbnail" />
                  ) : (
                    <i className="fa-regular fa-image" style={{ color: '#cbd5e1', fontSize: '24px' }}></i>
                  )}
                </div>
                
                <div className="result-details">
                  <div className="result-date">
                    {new Date(item.properties.datetime).toLocaleDateString('en-GB', { 
                      day: 'numeric', month: 'short', year: 'numeric' 
                    })}
                  </div>
                  
                  <div className="result-meta">
                    <div className="meta-tag" title="Cloud Cover">
                      <i className="fa-solid fa-cloud" style={{ fontSize: '10px' }}></i>
                      {item.properties['eo:cloud_cover'].toFixed(1)}%
                    </div>
                    <div className="meta-tag">
                      {item.properties.platform.replace('sentinel-2', 'Sentinel-2').replace('landsat', 'Landsat').replace('naip', 'NAIP')}
                    </div>
                  </div>

                  {expandedId === item.id && (
                    <div className="result-actions">
                      <div className="action-buttons">
                        <button 
                          className="download-btn" 
                          title="Download Image"
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            // Try to open the visual asset or preview
                            const href = item.assets.visual?.href || item.assets.rendered_preview?.href;
                            if (href) {
                              window.open(href, '_blank');
                            } else {
                              alert('Direct download not available for this item. Please use the map view.');
                            }
                          }}
                        >
                           <i className="fa-solid fa-download"></i> Download
                        </button>
                      </div>

                      <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
                        <button
                          className={`add-btn ${visualization !== 'visual' ? 'analysis-btn' : ''}`}
                          style={{ marginLeft: 0 }}
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            const viz = VISUALIZATIONS.find(v => v.value === visualization);
                            if (onAddLayer) {
                              onAddLayer(item, viz);
                            } else {
                              onSelectImage(item, viz);
                            }
                          }}
                        >
                          {visualization === 'visual' ? (
                            <><i className="fa-solid fa-plus"></i> Add to Map</>
                          ) : (
                            <><i className="fa-solid fa-bolt"></i> Add Map</>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
