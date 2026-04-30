# Agri-Analysis Engine

A scalable, production-ready remote sensing backend for agricultural analysis using Sentinel-2 and Landsat data via STAC-compatible providers.

## Features

- **Indices Calculation**: NDVI, NDWI, NDMI, SAVI, Soil Index.
- **Time Series Analysis**: Generate time-series data for a given Area of Interest (AOI).
- **Cloud Filtering**: Automatic cloud masking using Scene Classification Layer (SCL).
- **Open Source**: Built entirely on open-source tools (xarray, stackstac, FastAPI).
- **No GEE**: Does not require Google Earth Engine.

## Stack

- **Python 3.10**
- **FastAPI**: High-performance API framework.
- **xarray & stackstac**: For multi-dimensional raster processing.
- **Dask**: For parallel, lazy computing.

## Setup

### Prerequisites

- Docker and Docker Compose
- Or Python 3.10+ with GDAL installed

### Running with Docker

1. Build the image:
   ```bash
   docker build -t agri-analysis-engine .
   ```

2. Run the container:
   ```bash
   docker run -p 8000:8000 agri-analysis-engine
   ```

3. Access API docs at `http://localhost:8000/docs`.

### Local Development

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Run server:
   ```bash
   uvicorn app.main:app --reload
   ```

## API Usage

### Endpoint: `/analyze` (POST)

**Request Body:**

```json
{
  "aoi": {
    "type": "Polygon",
    "coordinates": [
      [
        [55.1, 25.1],
        [55.2, 25.1],
        [55.2, 25.2],
        [55.1, 25.2],
        [55.1, 25.1]
      ]
    ]
  },
  "start_date": "2023-01-01",
  "end_date": "2023-12-31",
  "indices": ["NDVI", "NDWI"],
  "cloud_cover": 20.0
}
```

**Response:**

```json
{
  "metadata": { ... },
  "results": {
    "NDVI": {
      "timeseries": [
        { "date": "2023-01-05", "value": 0.42 },
        ...
      ],
      "statistics": {
        "mean": 0.45,
        "max": 0.60,
        ...
      }
    }
  }
}
```
