import shp from 'shpjs';
import JSZip from 'jszip';
import Papa from 'papaparse';
import * as toGeoJSON from '@tmcw/togeojson';

export interface ParsedData {
  type: 'geojson' | 'table';
  data: any;
  filename: string;
}

type ParseOptions = {
  signal?: AbortSignal;
  onProgress?: (pct: number) => void;
};

function readAsArrayBuffer(file: File, opts?: ParseOptions): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const signal = opts?.signal;

    const abort = () => {
      try {
        reader.abort();
      } catch {}
      reject(new DOMException('Aborted', 'AbortError'));
    };

    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });

    reader.onprogress = (e) => {
      if (!opts?.onProgress) return;
      if (!e.lengthComputable) return;
      const pct = e.total > 0 ? Math.max(0, Math.min(100, (e.loaded / e.total) * 100)) : 0;
      opts.onProgress(pct);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

function readAsText(file: File, opts?: ParseOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const signal = opts?.signal;

    const abort = () => {
      try {
        reader.abort();
      } catch {}
      reject(new DOMException('Aborted', 'AbortError'));
    };

    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });

    reader.onprogress = (e) => {
      if (!opts?.onProgress) return;
      if (!e.lengthComputable) return;
      const pct = e.total > 0 ? Math.max(0, Math.min(100, (e.loaded / e.total) * 100)) : 0;
      opts.onProgress(pct);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(file);
  });
}

export const parseFile = async (file: File, opts?: ParseOptions): Promise<ParsedData> => {
  const filename = file.name;
  const extension = filename.split('.').pop()?.toLowerCase();

  if (extension === 'zip') {
    // Shapefile or other zipped data
    try {
      const arrayBuffer = await readAsArrayBuffer(file, opts);
      // Try shpjs first (it handles .zip containing .shp)
      const geojson = await shp(arrayBuffer);
      return { type: 'geojson', data: geojson, filename };
    } catch (e) {
      console.error("SHP parsing failed, trying KMZ/generic zip", e);
      // Fallback for KMZ (which is a zip)
      return parseKmz(file, opts);
    }
  } else if (extension === 'kmz') {
    return parseKmz(file, opts);
  } else if (extension === 'kml') {
    const text = await readAsText(file, opts);
    const dom = new DOMParser().parseFromString(text, 'text/xml');
    const geojson = toGeoJSON.kml(dom);
    return { type: 'geojson', data: geojson, filename };
  } else if (extension === 'gpx') {
    const text = await readAsText(file, opts);
    const dom = new DOMParser().parseFromString(text, 'text/xml');
    const geojson = (toGeoJSON as any).gpx(dom);
    return { type: 'geojson', data: geojson, filename };
  } else if (extension === 'json' || extension === 'geojson') {
    const text = await readAsText(file, opts);
    const json = JSON.parse(text);
    return { type: 'geojson', data: json, filename };
  } else if (extension === 'csv') {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (results) => {
          const rows = results.data as any[];
          if (rows.length === 0) {
             resolve({ type: 'table', data: [], filename });
             return;
          }

          // Check for lat/lon columns to determine if it's geospatial
          // Common variations: lat, latitude, y | lon, lng, longitude, x
          const keys = Object.keys(rows[0]).map(k => k.toLowerCase());
          const hasLat = keys.some(k => k === 'lat' || k === 'latitude' || k === 'y');
          const hasLon = keys.some(k => k === 'lon' || k === 'lng' || k === 'longitude' || k === 'x');

          if (hasLat && hasLon) {
             // It has coordinates, convert to GeoJSON
             // We need to identify the exact key names
             const latKey = Object.keys(rows[0]).find(k => ['lat', 'latitude', 'y'].includes(k.toLowerCase()));
             const lonKey = Object.keys(rows[0]).find(k => ['lon', 'lng', 'longitude', 'x'].includes(k.toLowerCase()));
             
             if (latKey && lonKey) {
                const features = rows.map((row: any) => {
                  const lat = parseFloat(row[latKey]);
                  const lon = parseFloat(row[lonKey]);
                  if (isNaN(lat) || isNaN(lon)) return null;
                  return {
                    type: 'Feature',
                    geometry: {
                      type: 'Point',
                      coordinates: [lon, lat]
                    },
                    properties: row
                  };
                }).filter(f => f !== null);

                resolve({ 
                  type: 'geojson', 
                  data: { type: 'FeatureCollection', features }, 
                  filename 
                });
                return;
             }
          }
          
          // Default to table if no valid coords found
          resolve({ type: 'table', data: rows, filename });
        },
        error: (err: any) => reject(err)
      });
    });
  } else if (extension === 'xlsx' || extension === 'xls') {
    throw new Error("Excel upload is not supported here. Please convert to CSV.");
  } else if (extension === 'shp') {
    throw new Error("Please compress your Shapefile (.shp, .shx, .dbf) into a .zip file before uploading.");
  } else {
    throw new Error(`Unsupported file type: .${extension}`);
  }
};
// Removed duplicated code

const parseKmz = async (file: File, opts?: ParseOptions): Promise<ParsedData> => {
  const ab = await readAsArrayBuffer(file, opts);
  const zip = await JSZip.loadAsync(ab);
  // Find the first .kml file
  const kmlFile = Object.values(zip.files).find(f => f.name.toLowerCase().endsWith('.kml'));
  if (kmlFile) {
    const text = await kmlFile.async('string');
    const dom = new DOMParser().parseFromString(text, 'text/xml');
    const geojson = toGeoJSON.kml(dom);
    return { type: 'geojson', data: geojson, filename: file.name };
  }
  throw new Error("No KML file found in KMZ/Zip");
};
