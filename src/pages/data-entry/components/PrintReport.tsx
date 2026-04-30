import React, { useMemo } from 'react';
import '../EC.css';

interface Entry {
  id: number;
  date: string;
  time: string;
  valve: string;
  ecIn: string;
  ecOut: string;
  phIn: string;
  phOut: string;
  dripVolume: string; // Raw Drip Vol
  dripVolume12: string; // Calculated 12 Drip
  drainVolume: string; // Raw Drain Vol
  drainPercent: string; // Calculated %
  waterQty: string; // Manual Water
  country: string;
  site: string;
  totalWaterQty: string;
  totalWaterQtyDrip: string; // Calculated Water M3
}

interface PrintReportProps {
  entries: Entry[];
}

export const PrintReport: React.FC<PrintReportProps> = ({ entries }) => {
  const stats = useMemo(() => {
    if (entries.length === 0) return null;

    let totalWaterDrip = 0;
    
    entries.forEach(e => {
      totalWaterDrip += parseFloat(e.totalWaterQtyDrip || '0') || 0;
    });

    const count = entries.length;

    const dates = entries.map(e => new Date(e.date).getTime()).filter(t => !isNaN(t));
    const minDate = dates.length > 0 ? new Date(Math.min(...dates)).toLocaleDateString() : 'N/A';
    const maxDate = dates.length > 0 ? new Date(Math.max(...dates)).toLocaleDateString() : 'N/A';
    
    return {
      count,
      dateRange: `${minDate} - ${maxDate}`,
      totalWaterDrip: totalWaterDrip.toFixed(2)
    };
  }, [entries]);

  const analysis = useMemo(() => {
    return null;
  }, [stats]);

  if (!entries || entries.length === 0) return null;

  return (
    <div className="ec-print-container">

      <div className="ec-print-section">
        <table className="ec-print-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th>Valve</th>
              <th>EC In</th>
              <th>EC Out</th>
              <th>pH In</th>
              <th>pH Out</th>
              <th>Drip Vol (ml)</th>
              <th>Drain Vol (ml)</th>
              <th>Drain %</th>
              <th>Water (M³)</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (
              <tr key={entry.id || index}>
                <td>{entry.date}</td>
                <td>{entry.time}</td>
                <td>{entry.valve}</td>
                <td>{entry.ecIn}</td>
                <td>{entry.ecOut}</td>
                <td>{entry.phIn}</td>
                <td>{entry.phOut}</td>
                <td>{entry.dripVolume}</td>
                <td>{entry.drainVolume}</td>
                <td style={{fontWeight: 'bold'}}>{entry.drainPercent}</td>
                <td>{entry.totalWaterQtyDrip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
};
