import os
import pystac_client
import stackstac
import xarray as xr
import geopandas as gpd
from shapely.geometry import shape
import numpy as np

STAC_API_URL = os.getenv("STAC_API_URL", "")

def get_sentinel2_data(
    aoi_geojson: dict,
    start_date: str,
    end_date: str,
    cloud_cover_max: float = 20.0
) -> xr.Dataset:
    """
    Fetch Sentinel-2 L2A data from a STAC API.
    Returns an xarray Dataset with relevant bands.
    """
    
    catalog = pystac_client.Client.open(STAC_API_URL)

    # Convert GeoJSON to shapely geometry for search
    aoi_shape = shape(aoi_geojson)
    bbox = aoi_shape.bounds

    # Search
    search = catalog.search(
        collections=["sentinel-2-l2a"],
        intersects=aoi_geojson,
        datetime=f"{start_date}/{end_date}",
        query={"eo:cloud_cover": {"lt": cloud_cover_max}},
    )

    items = search.item_collection()
    
    if len(items) == 0:
        return None

    # Stack items into xarray DataArray
    # Bands: B02(Blue), B03(Green), B04(Red), B08(NIR), B11(SWIR), SCL(Scene Classification)
    assets = ["B02", "B03", "B04", "B08", "B11", "SCL"]
    
    # Create DataArray using stackstac
    # bounds argument forces clipping to the AOI bounding box
    data = stackstac.stack(
        items,
        assets=assets,
        bounds_latlon=bbox,
        chunksize=2048,
        resolution=10, # Sentinel-2 resolution
        epsg=4326 # Reproject to WGS84 for consistency
    )

    # Convert to Dataset for easier band access
    ds = data.to_dataset(dim="band")
    
    # Mask clouds using SCL band (Scene Classification Layer)
    # 0: No Data, 1: Saturated, 3: Cloud Shadows, 8: Cloud Medium, 9: Cloud High, 10: Thin Cirrus
    # Good classes: 4 (Vegetation), 5 (Bare Soils), 6 (Water), 7 (Unclassified), 2 (Dark Area)
    scl = ds['SCL']
    mask = (scl == 4) | (scl == 5) | (scl == 6) | (scl == 7) | (scl == 2)
    
    # Apply mask (keep only good pixels)
    ds_masked = ds.where(mask)
    
    return ds_masked
