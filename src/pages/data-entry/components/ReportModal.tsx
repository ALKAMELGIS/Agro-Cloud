import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import './ReportModal.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

interface Entry {
  date: string;
  ecIn: string;
  ecOut: string;
  phIn: string;
  phOut: string;
  drainPercent: string;
  totalWaterQtyDrip: string; // M3
  totalWaterQty: string; // Manual
  country?: string;
  site?: string;
  project?: string;
  location?: string;
  valve?: string;
  id?: number;
}

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: Entry[];
}

export const ReportModal: React.FC<ReportModalProps> = React.memo(({ isOpen, onClose, data }) => {
  const [isReady, setIsReady] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // New Filter States
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedSite, setSelectedSite] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedValve, setSelectedValve] = useState('');

  // Handle Opening Animation & Performance
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.body.classList.add('report-modal-open');
      // Small delay to allow modal open animation to play smoothly before heavy rendering
      const timer = setTimeout(() => setIsReady(true), 300);
      return () => clearTimeout(timer);
    } else {
      document.body.style.overflow = '';
      document.body.classList.remove('report-modal-open');
      setIsReady(false);
    }
  }, [isOpen]);

  // Extract Unique Options (Memoized)
  const options = useMemo(() => {
    // Only calculate when modal is fully open and ready (prevents UI freeze on trigger)
    if (!isReady) return { countries: [], sites: [], projects: [], locations: [], valves: [] };
    
    const getUnique = (key: keyof Entry) => 
      Array.from(new Set(data.map(d => d[key]).filter(Boolean) as string[])).sort();
    
    return {
      countries: getUnique('country'),
      sites: getUnique('site'),
      projects: getUnique('project'),
      locations: getUnique('location'),
      valves: getUnique('valve')
    };
  }, [data, isReady]);

  // Filter Data (Memoized)
  const filteredData = useMemo(() => {
    if (!isReady) return [];

    return data.filter(d => {
      // Date Filter
      const date = new Date(d.date);
      const start = startDate ? new Date(startDate) : new Date('1970-01-01');
      const end = endDate ? new Date(endDate) : new Date('2099-12-31');
      const dateMatch = date >= start && date <= end;

      // Dropdown Filters
      const countryMatch = !selectedCountry || d.country === selectedCountry;
      const siteMatch = !selectedSite || d.site === selectedSite;
      const projectMatch = !selectedProject || d.project === selectedProject;
      const locationMatch = !selectedLocation || d.location === selectedLocation;
      const valveMatch = !selectedValve || d.valve === selectedValve;

      return dateMatch && countryMatch && siteMatch && projectMatch && locationMatch && valveMatch;
    });
  }, [data, startDate, endDate, selectedCountry, selectedSite, selectedProject, selectedLocation, selectedValve, isReady]);

  // Calculate Stats
  const stats = useMemo(() => {
    if (!filteredData.length) return null;

    let totalWater = 0;
    let totalEcIn = 0;
    let totalEcOut = 0;
    let totalPhIn = 0;
    let totalPhOut = 0;
    let totalDrain = 0;
    let count = filteredData.length;

    filteredData.forEach(d => {
      totalWater += parseFloat(d.totalWaterQtyDrip || '0');
      totalEcIn += parseFloat(d.ecIn || '0');
      totalEcOut += parseFloat(d.ecOut || '0');
      totalPhIn += parseFloat(d.phIn || '0');
      totalPhOut += parseFloat(d.phOut || '0');
      totalDrain += parseFloat(d.drainPercent?.replace('%', '') || '0');
    });

    return {
      count,
      totalWater: totalWater.toFixed(2),
      avgEcIn: count ? (totalEcIn / count).toFixed(2) : '0.00',
      avgEcOut: count ? (totalEcOut / count).toFixed(2) : '0.00',
      avgPhIn: count ? (totalPhIn / count).toFixed(2) : '0.00',
      avgPhOut: count ? (totalPhOut / count).toFixed(2) : '0.00',
      avgDrain: count ? (totalDrain / count).toFixed(2) : '0.00',
    };
  }, [filteredData]);

  // Detailed Analysis Generation
  const analysis = useMemo(() => {
    if (!stats) return null;

    const drain = parseFloat(stats.avgDrain);
    const ecIn = parseFloat(stats.avgEcIn);
    const ecOut = parseFloat(stats.avgEcOut);
    const phOut = parseFloat(stats.avgPhOut);

    const result = {
      drainage: { status: '', text: '', color: '' },
      ec: { status: '', text: '', color: '' },
      ph: { status: '', text: '', color: '' },
      recommendations: [] as string[]
    };

    // Drainage Analysis
    if (drain < 10) {
      result.drainage.status = 'Critically Low';
      result.drainage.text = `Current drainage (${drain}%) is below the recommended minimum of 10%. This indicates insufficient leaching, which poses a high risk of salt accumulation in the root zone.`;
      result.drainage.color = '#dc2626'; // Red
      result.recommendations.push('Increase irrigation volume to achieve at least 10% drainage to prevent salt buildup.');
      result.recommendations.push('Check for clogged drippers or irrigation system issues.');
    } else if (drain > 30) {
      result.drainage.status = 'High';
      result.drainage.text = `Current drainage (${drain}%) is above the recommended maximum of 30%. This suggests over-irrigation, leading to water and nutrient wastage.`;
      result.drainage.color = '#f59e0b'; // Amber
      result.recommendations.push('Reduce irrigation volume to minimize waste and prevent nutrient leaching.');
    } else {
      result.drainage.status = 'Optimal';
      result.drainage.text = `Drainage levels are within the optimal range (${drain}%), indicating effective irrigation management and salt balance.`;
      result.drainage.color = '#10b981'; // Green
    }

    // EC Analysis
    if (ecOut > ecIn * 1.25) {
      result.ec.status = 'Salt Accumulation';
      result.ec.text = `EC Out (${ecOut}) is significantly higher than EC In (${ecIn}), indicating salt accumulation in the root zone. Leaching is required to restore balance.`;
      result.ec.color = '#dc2626';
      result.recommendations.push('Perform flush irrigation cycle to leach excess salts.');
    } else if (ecOut < ecIn * 0.8) {
      result.ec.status = 'Nutrient Depletion';
      result.ec.text = `EC Out (${ecOut}) is lower than expected relative to EC In (${ecIn}), suggesting rapid nutrient uptake or excessive leaching.`;
      result.ec.color = '#f59e0b';
      result.recommendations.push('Verify fertilizer injection rates and check for over-irrigation.');
    } else {
      result.ec.status = 'Balanced';
      result.ec.text = `EC levels are balanced. EC Out (${ecOut}) is comparable to EC In (${ecIn}), indicating stable root zone conditions.`;
      result.ec.color = '#10b981';
    }

    // pH Analysis
    if (phOut < 5.5) {
      result.ph.status = 'Acidic';
      result.ph.text = `pH Out (${phOut}) is too low (acidic), which may cause micronutrient toxicity or root damage.`;
      result.ph.color = '#dc2626';
      result.recommendations.push('Reduce acid injection and monitor pH levels closely.');
    } else if (phOut > 6.8) {
      result.ph.status = 'Alkaline';
      result.ph.text = `pH Out (${phOut}) is too high (alkaline), which may lead to nutrient lockout (especially iron and manganese).`;
      result.ph.color = '#f59e0b';
      result.recommendations.push('Increase acid injection to lower pH to the optimal range.');
    } else {
      result.ph.status = 'Optimal';
      result.ph.text = `pH Out (${phOut}) is within the optimal range for nutrient uptake.`;
      result.ph.color = '#10b981';
    }

    return result;
  }, [stats]);

  // Chart Data (Memoized)
  const chartData = useMemo(() => {
    if (!filteredData.length || !stats) return null;

    // Sort by date for proper trending
    const sortedData = [...filteredData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    // Limit to last 30 points for readability if dataset is huge, otherwise use all
    const displayData = sortedData.length > 30 ? sortedData.slice(-30) : sortedData;
    const labels = displayData.map(d => d.date);
    
    // Common Chart Options
    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top' as const,
          align: 'end' as const,
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            font: {
              family: "'Inter', sans-serif",
              size: 11,
              weight: 500
            },
            color: '#64748b'
          }
        },
        tooltip: {
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          titleColor: '#0f172a',
          bodyColor: '#334155',
          borderColor: '#e2e8f0',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          titleFont: { family: "'Inter', sans-serif", size: 13, weight: 600 },
          bodyFont: { family: "'Inter', sans-serif", size: 12 },
          displayColors: true,
          boxPadding: 4
        }
      },
      scales: {
        x: {
          grid: {
            display: false,
            drawBorder: false
          },
          ticks: {
            font: { family: "'Inter', sans-serif", size: 10 },
            color: '#94a3b8',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12
          },
          border: { display: false }
        },
        y: {
          grid: {
            color: '#f1f5f9',
            drawBorder: false
          },
          ticks: {
            font: { family: "'Inter', sans-serif", size: 10 },
            color: '#94a3b8',
            padding: 8
          },
          border: { display: false },
          beginAtZero: false
        }
      },
      interaction: {
        mode: 'index' as const,
        intersect: false,
      },
    };

    return {
      ec: {
        labels,
        datasets: [
          {
            label: 'EC In',
            data: displayData.map(d => parseFloat(d.ecIn || '0')),
            borderColor: '#10b981', // Emerald 500
            backgroundColor: (context: any) => {
              const ctx = context.chart.ctx;
              const gradient = ctx.createLinearGradient(0, 0, 0, 300);
              gradient.addColorStop(0, 'rgba(16, 185, 129, 0.2)');
              gradient.addColorStop(1, 'rgba(16, 185, 129, 0)');
              return gradient;
            },
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointBackgroundColor: '#10b981',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            borderWidth: 2
          },
          {
            label: 'EC Out',
            data: displayData.map(d => parseFloat(d.ecOut || '0')),
            borderColor: '#f59e0b', // Amber 500
            backgroundColor: (context: any) => {
              const ctx = context.chart.ctx;
              const gradient = ctx.createLinearGradient(0, 0, 0, 300);
              gradient.addColorStop(0, 'rgba(245, 158, 11, 0.2)');
              gradient.addColorStop(1, 'rgba(245, 158, 11, 0)');
              return gradient;
            },
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointBackgroundColor: '#f59e0b',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            borderWidth: 2
          },
        ],
        options: commonOptions
      },
      water: {
        labels,
        datasets: [
          {
            label: 'Water Volume (M³)',
            data: displayData.map(d => parseFloat(d.totalWaterQtyDrip || '0')),
            backgroundColor: '#3b82f6', // Blue 500
            borderRadius: 4,
            hoverBackgroundColor: '#2563eb',
            barThickness: 20,
            maxBarThickness: 40
          },
        ],
        options: {
          ...commonOptions,
          scales: {
            ...commonOptions.scales,
            y: { ...commonOptions.scales.y, beginAtZero: true }
          }
        }
      },
      drainage: {
        labels: ['Drainage', 'Retention'],
        datasets: [
          {
            data: [parseFloat(stats.avgDrain), 100 - parseFloat(stats.avgDrain)],
            backgroundColor: ['#3b82f6', '#f1f5f9'],
            borderWidth: 0,
            hoverOffset: 4
          },
        ],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '75%',
          plugins: {
            legend: {
              position: 'right' as const,
              labels: {
                usePointStyle: true,
                boxWidth: 8,
                font: { family: "'Inter', sans-serif", size: 12 },
                color: '#64748b'
              }
            },
            tooltip: commonOptions.plugins.tooltip
          }
        }
      }
    };
  }, [filteredData, stats]);

  const handleReset = useCallback(() => {
    setStartDate('');
    setEndDate('');
    setSelectedCountry('');
    setSelectedSite('');
    setSelectedProject('');
    setSelectedLocation('');
    setSelectedValve('');
  }, []);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  if (!isOpen) return null;

  return (
    <div className={`report-modal-overlay ${isOpen ? 'active' : ''}`} onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="report-modal-container" id="report-content">
         
         {/* 
           ISOLATION MECHANISM: ANALYSIS REPORT CONTENT
           Target Content: Interpretation Narrative, Print-Specific Layouts
           Visibility Condition: strictly limited to this Modal and Print media query.
           Quality Standard: Content must NOT be renderable outside this component context.
         */}

         {/* Print Header (Visible only in print) */}
         <div className="print-report-header">
           <div className="print-logo-section">
             <div className="print-logo-icon">
               <i className="fa-solid fa-leaf"></i>
             </div>
             <div className="print-org-info">
               <h1>Agro Cloud System</h1>
               <p>Advanced Agricultural Monitoring</p>
             </div>
           </div>
           <div className="print-report-meta">
             <div className="meta-item">
               <span className="meta-label">Report Date:</span>
               <span className="meta-value">{new Date().toLocaleDateString()}</span>
             </div>
             <div className="meta-item">
               <span className="meta-label">Period:</span>
               <span className="meta-value">
                 {startDate ? new Date(startDate).toLocaleDateString() : 'All Time'} - {endDate ? new Date(endDate).toLocaleDateString() : 'Present'}
               </span>
             </div>
             <div className="meta-item">
               <span className="meta-label">Generated By:</span>
               <span className="meta-value">System Admin</span>
             </div>
           </div>
         </div>
 
         {/* Header (Screen only) */}
         <div className="report-modal-header screen-only">
           <div className="report-title-group">
             <div className="report-icon-box">
               <i className="fa-solid fa-chart-pie"></i>
             </div>
             <div className="report-title">
               <h2>Analysis Report</h2>
               <p>Performance analysis & insights</p>
             </div>
           </div>
           <div className="header-actions">
             <button className="ec-btn ec-btn-secondary" onClick={onClose}>
               Close
             </button>
             <button className="ec-btn ec-btn-primary" onClick={handlePrint}>
               Print / Save PDF
             </button>
           </div>
         </div>
 
         {/* Body */}
         <div className="report-modal-body">
           
           {/* Filters (Screen only) */}
           <div className="report-filters screen-only">
             <div className="filters-grid">
               <div className="filter-group">
                 <label>Country</label>
                 <select className="filter-select" value={selectedCountry} onChange={e => setSelectedCountry(e.target.value)}>
                   <option value="">All Countries</option>
                   {options.countries.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                 </select>
               </div>
               <div className="filter-group">
                 <label>Site</label>
                 <select className="filter-select" value={selectedSite} onChange={e => setSelectedSite(e.target.value)}>
                   <option value="">All Sites</option>
                   {options.sites.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                 </select>
               </div>
               <div className="filter-group">
                 <label>Project</label>
                 <select className="filter-select" value={selectedProject} onChange={e => setSelectedProject(e.target.value)}>
                   <option value="">All Projects</option>
                   {options.projects.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                 </select>
               </div>
               <div className="filter-group">
                 <label>Location</label>
                 <select className="filter-select" value={selectedLocation} onChange={e => setSelectedLocation(e.target.value)}>
                   <option value="">All Locations</option>
                   {options.locations.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                 </select>
               </div>
               <div className="filter-group">
                 <label>Start Date</label>
                 <input type="date" className="filter-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
               </div>
               <div className="filter-group">
                 <label>End Date</label>
                 <input type="date" className="filter-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
               </div>
             </div>
             <div className="filter-actions">
               <button className="reset-btn" onClick={handleReset}>
                 <i className="fa-solid fa-rotate-right"></i> Reset Filters
               </button>
             </div>
           </div>
 
           {/* Loading State */}
           {!isReady && (
             <div className="report-loading">
               <div className="spinner"></div>
               <div>Generating analysis...</div>
             </div>
           )}
 
           {/* Dashboard Content */}
           {isReady && stats && analysis && chartData && (
             <div className="report-dashboard-grid ec-animate-in">
               
               {/* Stat Cards */}
               <div className="print-section-header print-only">
                 <h3>Summary Statistics</h3>
                 <span className="print-date-range">
                   {startDate ? new Date(startDate).toLocaleDateString() : 'All Time'} - {endDate ? new Date(endDate).toLocaleDateString() : 'Present'}
                 </span>
               </div>
               <div className="report-stats-row">
                 <div className="dashboard-card stat-card-modern">
                   <div className="stat-icon-wrapper">
                     <i className="fa-solid fa-list-ol"></i>
                   </div>
                   <div className="stat-content">
                     <div className="stat-value-modern">{stats.count}</div>
                     <div className="stat-label-modern">Total Records</div>
                   </div>
                 </div>
 
                 <div className="dashboard-card stat-card-modern">
                   <div className="stat-icon-wrapper">
                     <i className="fa-solid fa-droplet"></i>
                   </div>
                   <div className="stat-content">
                     <div className="stat-value-modern">{stats.totalWater}</div>
                     <div className="stat-label-modern">Total Water (M³)</div>
                   </div>
                 </div>
 
                 <div className="dashboard-card stat-card-modern">
                   <div className="stat-icon-wrapper" style={{color: analysis.drainage.color, background: `${analysis.drainage.color}15`}}>
                     <i className="fa-solid fa-percent"></i>
                   </div>
                   <div className="stat-content">
                     <div className="stat-value-modern" style={{color: analysis.drainage.color}}>{stats.avgDrain}%</div>
                     <div className="stat-label-modern">Avg Drainage</div>
                   </div>
                 </div>
               </div>
 
               {/* Data Table (Screen Only - Hidden in Print Summary) */}
               <div className="dashboard-card chart-full-width data-table-card screen-only">
                 <div className="card-title">
                   Detailed Data Records
                 </div>
                 <div className="table-responsive">
                   <table className="report-data-table">
                     <thead>
                       <tr>
                         <th>Date</th>
                         <th>Location</th>
                         <th>Water (m³)</th>
                         <th>EC In</th>
                         <th>EC Out</th>
                         <th>pH Out</th>
                         <th>Drainage</th>
                       </tr>
                     </thead>
                     <tbody>
                       {filteredData.slice(0, 100).map((row, idx) => (
                         <tr key={idx}>
                           <td>{row.date}</td>
                           <td>{row.location || '-'}</td>
                           <td>{row.totalWaterQtyDrip}</td>
                           <td>{row.ecIn}</td>
                           <td>{row.ecOut}</td>
                           <td>{row.phOut}</td>
                           <td>{row.drainPercent}</td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 </div>
               </div>
 
               {/* 
                  ISOLATED PRINT NARRATIVE 
                  Strictly for the physical/PDF report.
               */}
               <div className="print-only print-narrative-section">
                 <div className="print-section-header">
                   <h3>Interpretation Analysis</h3>
                 </div>
                 
                 <div className="print-narrative-content">
                   <div className="print-narrative-item">
                     <span className="print-narrative-label">Drainage Analysis:</span>
                     <span className="print-narrative-text"> {analysis.drainage.text}</span>
                   </div>
                   
                   <div className="print-narrative-item">
                     <span className="print-narrative-label">EC Balance:</span>
                     <span className="print-narrative-text"> {analysis.ec.text}</span>
                   </div>
                   
                   <div className="print-narrative-item">
                     <span className="print-narrative-label">pH Levels:</span>
                     <span className="print-narrative-text"> {analysis.ph.text}</span>
                   </div>
 
                   {analysis.recommendations.length > 0 && (
                     <div className="print-narrative-item recommendations-item">
                       <span className="print-narrative-label">Recommended Actions:</span>
                       <ul className="print-narrative-list">
                         {analysis.recommendations.map((rec, idx) => (
                           <li key={idx}>{rec}</li>
                         ))}
                       </ul>
                     </div>
                   )}
                 </div>
               </div>
 
               {/* Print Only: Compact Data Table */}
               <div className="print-only print-table-section">
                 <div className="print-section-header">
                   <h3>Data Records</h3>
                 </div>
                 <div className="print-table-wrapper">
                   <table className="print-data-table">
                     <thead>
                       <tr>
                         <th>Date</th>
                         <th>Location</th>
                         <th>Water (m³)</th>
                         <th>EC In</th>
                         <th>EC Out</th>
                         <th>pH Out</th>
                         <th>Drainage</th>
                       </tr>
                     </thead>
                     <tbody>
                       {filteredData.slice(0, 50).map((row, idx) => (
                         <tr key={idx}>
                           <td>{row.date}</td>
                           <td>{row.location || '-'}</td>
                           <td>{row.totalWaterQtyDrip}</td>
                           <td>{row.ecIn}</td>
                           <td>{row.ecOut}</td>
                           <td>{row.phOut}</td>
                           <td>{row.drainPercent}</td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 </div>
               </div>
 
               {/* Screen Only: Detailed Analysis Cards */}
               <div className="print-section-header print-only" style={{marginTop: '20px', display: 'none'}}>
                 <h3>Interpretation Analysis</h3>
               </div>
               <div className="screen-only report-analysis-row">
                 <div className="dashboard-card analysis-card" style={{borderLeftColor: analysis.drainage.color}}>
                   <div className="card-title">
                     <i className="fa-solid fa-clipboard-check" style={{color: analysis.drainage.color}}></i>
                     Drainage Analysis
                     <span className="analysis-status-badge" style={{background: `${analysis.drainage.color}20`, color: analysis.drainage.color}}>
                       {analysis.drainage.status}
                     </span>
                   </div>
                   <div className="analysis-text">{analysis.drainage.text}</div>
                 </div>
 
                 <div className="dashboard-card analysis-card" style={{borderLeftColor: analysis.ec.color}}>
                   <div className="card-title">
                     <i className="fa-solid fa-clipboard-check" style={{color: analysis.ec.color}}></i>
                     EC Balance
                     <span className="analysis-status-badge" style={{background: `${analysis.ec.color}20`, color: analysis.ec.color}}>
                       {analysis.ec.status}
                     </span>
                   </div>
                   <div className="analysis-text">{analysis.ec.text}</div>
                 </div>
 
                 <div className="dashboard-card analysis-card" style={{borderLeftColor: analysis.ph.color}}>
                   <div className="card-title">
                     <i className="fa-solid fa-clipboard-check" style={{color: analysis.ph.color}}></i>
                     pH Levels
                     <span className="analysis-status-badge" style={{background: `${analysis.ph.color}20`, color: analysis.ph.color}}>
                       {analysis.ph.status}
                     </span>
                   </div>
                   <div className="analysis-text">{analysis.ph.text}</div>
                 </div>
               </div>
 
               {/* Recommendations (Screen Only) */}
               {analysis.recommendations.length > 0 && (
                 <div className="screen-only contents-display">
                   <div className="dashboard-card chart-full-width recommendation-card">
                     <div className="card-title" style={{color: '#0369a1'}}>
                       <i className="fa-solid fa-lightbulb"></i> Recommended Actions
                     </div>
                     <ul className="recommendation-list">
                       {analysis.recommendations.map((rec, idx) => (
                         <li key={idx}>{rec}</li>
                       ))}
                     </ul>
                   </div>
                 </div>
               )}
 
               {/* Charts - Print Layout (Redesigned for A4) */}
               <div className="print-only print-charts-section">
                 <div className="print-chart-row full-width-row">
                   <div className="dashboard-card chart-container-card">
                     <div className="card-title">EC Trends (In vs Out)</div>
                     <div style={{height: '180px'}}>
                        <Line 
                         data={chartData.ec} 
                         options={chartData.ec.options} 
                        />
                     </div>
                   </div>
                 </div>
 
                 <div className="print-chart-row split-row">
                   <div className="dashboard-card chart-container-card">
                     <div className="card-title">Water Volume</div>
                     <div style={{height: '160px'}}>
                        <Bar 
                         data={chartData.water} 
                         options={chartData.water.options} 
                        />
                     </div>
                   </div>
 
                   <div className="dashboard-card chart-container-card">
                     <div className="card-title">Drainage Ratio</div>
                     <div style={{height: '160px', display: 'flex', justifyContent: 'center'}}>
                         <Doughnut 
                           data={chartData.drainage}
                           options={chartData.drainage.options}
                         />
                      </div>
                   </div>
                 </div>
               </div>
 
               {/* Charts - Screen Layout (Grid Items) */}
               <div className="screen-only contents-display">
                 <div className="dashboard-card chart-container-card chart-full-width">
                   <div className="card-title">EC Trends (In vs Out)</div>
                   <div style={{height: '300px'}}>
                      <Line 
                       data={chartData.ec} 
                       options={chartData.ec.options} 
                      />
                   </div>
                 </div>
 
                 <div className="dashboard-card chart-container-card">
                   <div className="card-title">Water Volume</div>
                   <div style={{height: '250px'}}>
                      <Bar 
                       data={chartData.water} 
                       options={chartData.water.options} 
                      />
                   </div>
                 </div>
 
                 <div className="dashboard-card chart-container-card">
                   <div className="card-title">Drainage Ratio</div>
                   <div style={{height: '220px', display: 'flex', justifyContent: 'center'}}>
                       <Doughnut 
                         data={chartData.drainage}
                         options={chartData.drainage.options}
                       />
                    </div>
                 </div>
               </div>
 
               {/* Print Footer */}
               <div className="print-footer print-only">
                 <div className="footer-left">
                   Generated on {new Date().toLocaleString()}
                 </div>
                 <div className="footer-right">
                   <i className="fa-solid fa-leaf" style={{color: '#16a34a', marginRight: '8px'}}></i>
                  <strong>Agro Cloud</strong>
                   <span style={{color: '#64748b', fontSize: '10px', marginLeft: '4px'}}>Agricultural Data Monitoring</span>
                 </div>
               </div>
             </div>
           )}
 
           {/* Empty State */}
           {isReady && (!stats || stats.count === 0) && (
             <div className="report-loading">
               <i className="fa-solid fa-folder-open" style={{fontSize: '48px', marginBottom: '16px', opacity: 0.3}}></i>
               <div>No records found for the selected filters.</div>
             </div>
           )}
           
         </div>
       </div>
    </div>
  );
});
