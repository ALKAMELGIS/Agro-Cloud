
// Utility to convert LocationMaster data to GeoJSON FeatureCollection

export interface LocationMaster {
  id: string;
  country: string;
  site: string;
  project: string;
  location: string;
  zoneId: string;
  codeId: string;
  projectId: string;
  date: string;
  wkt: string;
  type: 'Point' | 'Polygon' | 'LineString';
  area?: number;
  length?: number;
}

export const generateGeoJSON = (locations: LocationMaster[]) => {
  const features = locations.map(loc => {
    let geometry: any = null;

    // Parse WKT to GeoJSON Geometry
    try {
      if (loc.type === 'Point') {
        const match = loc.wkt.match(/POINT\(([\d.-]+)\s([\d.-]+)\)/);
        if (match) {
          geometry = {
            type: 'Point',
            coordinates: [parseFloat(match[1]), parseFloat(match[2])] // GeoJSON is [lng, lat]
          };
        }
      } else if (loc.type === 'Polygon') {
        const match = loc.wkt.match(/POLYGON\(\((.*)\)\)/);
        if (match) {
          const coords = match[1].split(',').map(pair => {
            const [lng, lat] = pair.trim().split(' ');
            return [parseFloat(lng), parseFloat(lat)];
          });
          geometry = {
            type: 'Polygon',
            coordinates: [coords]
          };
        }
      } else if (loc.type === 'LineString') {
        const match = loc.wkt.match(/LINESTRING\((.*)\)/);
        if (match) {
          const coords = match[1].split(',').map(pair => {
            const [lng, lat] = pair.trim().split(' ');
            return [parseFloat(lng), parseFloat(lat)];
          });
          geometry = {
            type: 'LineString',
            coordinates: coords
          };
        }
      }
    } catch (e) {
      console.warn('Failed to parse WKT for GeoJSON', loc.wkt);
    }

    if (!geometry) return null;

    return {
      type: 'Feature',
      properties: {
        id: loc.id,
        country: loc.country,
        site: loc.site,
        project: loc.project,
        zoneId: loc.zoneId,
        codeId: loc.codeId,
        projectId: loc.projectId,
        date: loc.date,
        area: loc.area,
        length: loc.length
      },
      geometry
    };
  }).filter(f => f !== null);

  return {
    type: 'FeatureCollection',
    features
  };
};

// Mock API Endpoint function
export const getLocationsGeoJSON = () => {
  const saved = localStorage.getItem('locations_master');
  const locations = saved ? JSON.parse(saved) : [];
  return generateGeoJSON(locations);
};
