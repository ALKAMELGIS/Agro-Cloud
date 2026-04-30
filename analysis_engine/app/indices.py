import xarray as xr

def calculate_ndvi(nir: xr.DataArray, red: xr.DataArray) -> xr.DataArray:
    """Normalized Difference Vegetation Index"""
    return (nir - red) / (nir + red)

def calculate_ndwi(green: xr.DataArray, nir: xr.DataArray) -> xr.DataArray:
    """Normalized Difference Water Index (McFeeters)"""
    return (green - nir) / (green + nir)

def calculate_ndmi(nir: xr.DataArray, swir: xr.DataArray) -> xr.DataArray:
    """Normalized Difference Moisture Index"""
    return (nir - swir) / (nir + swir)

def calculate_savi(nir: xr.DataArray, red: xr.DataArray, L: float = 0.5) -> xr.DataArray:
    """Soil Adjusted Vegetation Index"""
    return ((nir - red) / (nir + red + L)) * (1 + L)

def calculate_bsi(swir: xr.DataArray, red: xr.DataArray, nir: xr.DataArray, blue: xr.DataArray) -> xr.DataArray:
    """Bare Soil Index"""
    # Formula: ((SWIR + Red) - (NIR + Blue)) / ((SWIR + Red) + (NIR + Blue))
    return ((swir + red) - (nir + blue)) / ((swir + red) + (nir + blue))

def calculate_indices(ds: xr.Dataset, index_name: str) -> xr.DataArray:
    """
    Calculate spectral index from xarray Dataset containing Sentinel-2 bands.
    Expected band names: 'B02' (Blue), 'B03' (Green), 'B04' (Red), 'B08' (NIR), 'B11' (SWIR1)
    """
    index = index_name.upper()
    
    if index == 'NDVI':
        return calculate_ndvi(ds['B08'], ds['B04'])
    elif index == 'NDWI':
        return calculate_ndwi(ds['B03'], ds['B08'])
    elif index == 'NDMI':
        return calculate_ndmi(ds['B08'], ds['B11'])
    elif index == 'SAVI':
        return calculate_savi(ds['B08'], ds['B04'])
    elif index == 'SOIL':
        # Using BSi as proxy for soil
        return calculate_bsi(ds['B11'], ds['B04'], ds['B08'], ds['B02'])
    else:
        raise ValueError(f"Unknown index: {index}")
