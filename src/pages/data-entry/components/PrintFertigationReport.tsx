import React, { useMemo } from 'react';
import '../EC.css';

interface FertigationEntry {
  id: number;
  site: string;
  project: string;
  block: string;
  date: string;
  time: string;
  country?: string;
  location?: string;
  fertilizerType?: string;
  concentration?: string;
  status?: string;
  flowRate: string;
  durationHours: string;
  cycles: string;
  totalVolume: string;
}

interface PrintFertigationReportProps {
  entries: FertigationEntry[];
}

export const PrintFertigationReport: React.FC<PrintFertigationReportProps> = ({ entries }) => {
  const stats = useMemo(() => {
    if (entries.length === 0) return null;

    let totalVolume = 0;
    let totalDuration = 0;
    
    entries.forEach(e => {
      totalVolume += parseFloat(e.totalVolume || '0') || 0;
      totalDuration += (parseFloat(e.durationHours || '0') || 0) * (parseFloat(e.cycles || '0') || 0);
    });

    const count = entries.length;

    // Calculate Date Range
    const dates = entries.map(e => new Date(e.date).getTime()).filter(t => !isNaN(t));
    const minDate = dates.length > 0 ? new Date(Math.min(...dates)).toLocaleDateString() : 'N/A';
    const maxDate = dates.length > 0 ? new Date(Math.max(...dates)).toLocaleDateString() : 'N/A';
    
    return {
      count,
      dateRange: `${minDate} - ${maxDate}`,
      totalVolume: totalVolume.toFixed(2),
      avgVolume: count ? (totalVolume / count).toFixed(2) : '0.00'
    };
  }, [entries]);

  if (!entries || entries.length === 0 || !stats) return null;

  return (
    <div className="ec-print-container">
      
      {/* 1. Summary Statistics */}
      <div className="ec-print-section">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px'}}>
           <h3 className="ec-print-heading" style={{margin: 0}}>Fertigation Plan Summary</h3>
           <span style={{fontSize: '13px', color: '#64748b', fontWeight: 600}}>{stats.dateRange}</span>
        </div>
        <div className="ec-print-summary-grid">
          <div className="ec-print-stat-card">
            <span className="ec-print-stat-label">Total Plans</span>
            <span className="ec-print-stat-value">{stats.count}</span>
          </div>
          <div className="ec-print-stat-card">
            <span className="ec-print-stat-label">Total Volume (m³)</span>
            <span className="ec-print-stat-value" style={{color: '#059669'}}>{stats.totalVolume}</span>
          </div>
          <div className="ec-print-stat-card">
            <span className="ec-print-stat-label">Avg Volume / Plan</span>
            <span className="ec-print-stat-value">{stats.avgVolume}</span>
          </div>
        </div>
      </div>

      {/* 2. Data Table */}
      <div className="ec-print-section">
        <h3 className="ec-print-heading">Fertigation Plans & Schedules</h3>
        <table className="ec-print-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th>Country</th>
              <th>Site</th>
              <th>Project</th>
              <th>Location</th>
              <th>Block</th>
              <th>Fertilizer</th>
              <th>Conc. (ppm)</th>
              <th>Status</th>
              <th>Flow Rate (m³/h)</th>
              <th>Duration (h)</th>
              <th>Cycles</th>
              <th>Total Vol (m³)</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (
              <tr key={entry.id || index}>
                <td>{entry.date}</td>
                <td>{entry.time}</td>
                <td>{entry.country || '-'}</td>
                <td>{entry.site}</td>
                <td>{entry.project}</td>
                <td>{entry.location || '-'}</td>
                <td>{entry.block}</td>
                <td>{entry.fertilizerType || '-'}</td>
                <td>{entry.concentration || '-'}</td>
                <td>
                  <span style={{
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: entry.status === 'Completed' ? '#dcfce7' : entry.status === 'In Progress' ? '#dbeafe' : '#f1f5f9',
                    color: entry.status === 'Completed' ? '#166534' : entry.status === 'In Progress' ? '#1e40af' : '#475569',
                    fontSize: '11px',
                    fontWeight: 600
                  }}>
                    {entry.status || 'Scheduled'}
                  </span>
                </td>
                <td>{entry.flowRate}</td>
                <td>{entry.durationHours}</td>
                <td>{entry.cycles}</td>
                <td style={{fontWeight: 'bold', color: '#059669'}}>{entry.totalVolume}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 3. Footer */}
      <div className="ec-print-footer">
        Generated on {new Date().toLocaleString()}
      </div>

    </div>
  );
};
