from typing import Dict, Any, List
import xarray as xr
import pandas as pd
import numpy as np
from .stac import get_sentinel2_data
from .indices import calculate_indices

async def generate_timeseries(
    aoi_geojson: dict,
    start_date: str,
    end_date: str,
    indices: List[str],
    cloud_cover: float = 20.0
) -> Dict[str, Any]:
    
    # 1. Fetch Data
    ds = get_sentinel2_data(aoi_geojson, start_date, end_date, cloud_cover)
    
    if ds is None:
        return {"error": "No satellite imagery found for the specified criteria."}

    results = {}
    
    # 2. Calculate Indices & Aggregate
    for index_name in indices:
        try:
            # Calculate index (lazy dask array)
            idx_da = calculate_indices(ds, index_name)
            
            # Spatial aggregation (mean over lat/lon)
            # Skip NaNs (clouds/masked pixels)
            ts_mean = idx_da.mean(dim=['x', 'y'], skipna=True)
            
            # Compute values (trigger dask computation)
            values = ts_mean.values
            dates = pd.to_datetime(ts_mean.time.values)
            
            # Format timeseries
            ts_data = []
            for date, val in zip(dates, values):
                if not np.isnan(val):
                    ts_data.append({
                        "date": date.strftime("%Y-%m-%d"),
                        "value": float(val)
                    })
            
            # Sort by date
            ts_data.sort(key=lambda x: x['date'])
            
            # Calculate statistics
            valid_values = [d['value'] for d in ts_data]
            stats = {
                "mean": float(np.mean(valid_values)) if valid_values else 0,
                "median": float(np.median(valid_values)) if valid_values else 0,
                "min": float(np.min(valid_values)) if valid_values else 0,
                "max": float(np.max(valid_values)) if valid_values else 0,
                "count": len(valid_values)
            }
            
            results[index_name] = {
                "timeseries": ts_data,
                "statistics": stats
            }
            
        except Exception as e:
            results[index_name] = {"error": str(e)}
            
    return {
        "metadata": {
            "start_date": start_date,
            "end_date": end_date,
            "cloud_cover_max": cloud_cover,
            "satellite": "Sentinel-2 L2A"
        },
        "results": results
    }
