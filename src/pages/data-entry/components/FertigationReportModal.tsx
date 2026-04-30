import React, { useRef, useState, useMemo, useEffect } from 'react';
import { useReactToPrint } from 'react-to-print';
import { PrintFertigationReport } from './PrintFertigationReport';
import './ReportModal.css';

interface FertigationReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  records: any[];
}

export const FertigationReportModal: React.FC<FertigationReportModalProps> = ({
  isOpen,
  onClose,
  records,
}) => {
  const componentRef = useRef<HTMLDivElement>(null);
  const [filterSite, setFilterSite] = useState('');
  const [dateRange, setDateRange] = useState('all');
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => setIsVisible(true), 10);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: 'Fertigation_Report',
  });

  const uniqueSites = useMemo(() => {
    const sites = records.map((r) => r.site).filter(Boolean);
    return [...new Set(sites)];
  }, [records]);

  const filteredRecords = useMemo(() => {
    let data = [...records];

    if (filterSite) {
      data = data.filter((r) => r.site === filterSite);
    }

    const now = new Date();
    const today = now.toISOString().split('T')[0];

    if (dateRange === 'today') {
      data = data.filter((r) => r.date === today);
    } else if (dateRange === 'week') {
      const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      data = data.filter((r) => new Date(r.date) >= lastWeek);
    } else if (dateRange === 'month') {
      const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      data = data.filter((r) => new Date(r.date) >= lastMonth);
    }

    return data;
  }, [records, filterSite, dateRange]);

  if (!isOpen) return null;

  return (
    <div className={`report-modal-overlay ${isVisible ? 'open' : ''}`} onClick={onClose}>
      <div 
        className="report-modal-container" 
        onClick={(e) => e.stopPropagation()}
        style={{ width: '900px', maxWidth: '95vw', height: '85vh' }}
      >
        {/* Header */}
        <div className="report-modal-header">
           <div className="report-modal-title">
             <div style={{
               width: '48px', height: '48px', borderRadius: '14px', 
               background: 'rgba(16, 185, 129, 0.1)', 
               display: 'flex', alignItems: 'center', justifyContent: 'center',
               color: '#10b981', fontSize: '1.25rem'
             }}>
               <i className="fa-solid fa-chart-pie"></i>
             </div>
             <div>
               Fertigation Report
               <div className="report-modal-subtitle" style={{ marginLeft: 0 }}>
                 Generate and print comprehensive reports
               </div>
             </div>
           </div>
           <button onClick={onClose} className="report-close-btn" aria-label="Close">
             <i className="fa-solid fa-xmark"></i>
           </button>
        </div>

        {/* Body */}
        <div className="report-modal-body">
          
          {/* Filters */}
          <div className="report-filters-section">
             <div className="report-section-label">Report Configuration</div>
             <div className="report-filters-grid">
                <div className="report-filter-group">
                  <label htmlFor="report-date-range">Date Range</label>
                  <select
                    id="report-date-range"
                    className="report-select"
                    value={dateRange}
                    onChange={(e) => setDateRange(e.target.value)}
                  >
                    <option value="all">All Time</option>
                    <option value="today">Today</option>
                    <option value="week">Last 7 Days</option>
                    <option value="month">Last 30 Days</option>
                  </select>
                </div>
                
                <div className="report-filter-group">
                  <label htmlFor="report-site-filter">Filter by Site</label>
                  <select
                    id="report-site-filter"
                    className="report-select"
                    value={filterSite}
                    onChange={(e) => setFilterSite(e.target.value)}
                  >
                    <option value="">All Sites</option>
                    {uniqueSites.map((site) => (
                      <option key={site} value={site}>
                        {site}
                      </option>
                    ))}
                  </select>
                </div>
             </div>
          </div>

          {/* Preview Area */}
          <div className="report-preview-section" style={{ display: 'block' }}>
             <div className="report-section-label" style={{ marginBottom: '1rem' }}>Report Preview</div>
             <div style={{ overflowX: 'auto' }}>
                <div ref={componentRef}>
                    {filteredRecords.length > 0 ? (
                      <PrintFertigationReport entries={filteredRecords} />
                    ) : (
                      <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#64748b' }}>
                        <i className="fa-solid fa-file-circle-xmark" style={{ fontSize: '2.5rem', marginBottom: '1rem', display: 'block', opacity: 0.5 }}></i>
                        <div style={{ fontSize: '1.1rem', fontWeight: 500 }}>No Records Found</div>
                        <div style={{ fontSize: '0.9rem', marginTop: '0.5rem', opacity: 0.8 }}>Try adjusting your filters</div>
                      </div>
                    )}
                </div>
             </div>
          </div>

        </div>

        {/* Footer */}
        <div className="report-modal-footer">
          <div className="report-footer-info">
             {filteredRecords.length} records found
          </div>
          <div className="report-footer-actions">
            <button 
              onClick={onClose} 
              className="ec-btn ec-btn-ghost"
              style={{ fontWeight: 600, color: '#64748b' }}
            >
              Cancel
            </button>
            <button 
              onClick={handlePrint} 
              className="ec-btn ec-btn-primary"
              style={{ 
                background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: '12px'
              }}
            >
              <i className="fa-solid fa-print" style={{ marginRight: '8px' }}></i>
              Print Report
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
