/**
 * Sentinel-2 GEE Web Application
 * 
 * This script is designed for the Google Earth Engine Code Editor.
 * It implements cloud masking, spectral indices calculation, and UI components.
 */

// 1. Cloud Masking Function
function maskS2clouds(image) {
  var qa = image.select('QA60');

  // Bits 10 and 11 are clouds and cirrus, respectively.
  var cloudBitMask = 1 << 10;
  var cirrusBitMask = 1 << 11;

  // Both flags should be set to zero, indicating clear conditions.
  var mask = qa.bitwiseAnd(cloudBitMask).eq(0)
      .and(qa.bitwiseAnd(cirrusBitMask).eq(0));

  return image.updateMask(mask).divide(10000);
}

// 2. Index Calculation Functions
var addIndices = function(image) {
  var ndvi = image.normalizedDifference(['B8', 'B4']).rename('NDVI');
  var ndmi = image.normalizedDifference(['B8', 'B11']).rename('NDMI');
  var ndwi = image.normalizedDifference(['B3', 'B8']).rename('NDWI');
  
  // SAVI Calculation: ((B8 - B4) / (B8 + B4 + 0.5)) * (1.5)
  var savi = image.expression(
    '((NIR - RED) / (NIR + RED + 0.5)) * 1.5', {
      'NIR': image.select('B8'),
      'RED': image.select('B4')
    }).rename('SAVI');

  return image.addBands([ndvi, ndmi, ndwi, savi]);
};

// 3. UI Panel Construction
var panel = ui.Panel({
  style: {width: '300px', padding: '10px', backgroundColor: '#f0f0f0'}
});
ui.root.insert(0, panel);

panel.add(ui.Label({
  value: 'Sentinel-2 Analysis Tool',
  style: {fontWeight: 'bold', fontSize: '20px', margin: '10px 0'}
}));

// 4. Widgets and Event Handlers

// Date Range
var startDate = ui.Textbox({placeholder: 'YYYY-MM-DD', value: '2023-01-01'});
var endDate = ui.Textbox({placeholder: 'YYYY-MM-DD', value: '2023-12-31'});
panel.add(ui.Label('Date Range:'));
panel.add(ui.Panel([startDate, endDate], ui.Panel.Layout.flow('horizontal')));

// Cloud Cover Slider
var cloudSlider = ui.Slider({
  min: 0,
  max: 100,
  value: 20,
  step: 1,
  style: {width: '200px'}
});
panel.add(ui.Label('Max Cloud Cover (%):'));
panel.add(cloudSlider);

// Layer Selector
var layerSelect = ui.Select({
  items: ['RGB', 'NDVI', 'NDMI', 'NDWI', 'SAVI'],
  value: 'RGB',
  onChange: updateMap
});
panel.add(ui.Label('Select Layer:'));
panel.add(layerSelect);

// Index Threshold Slider (for classification)
var thresholdSlider = ui.Slider({
  min: -1,
  max: 1,
  value: 0.2,
  step: 0.1,
  style: {width: '200px'}
});
panel.add(ui.Label('Index Threshold (for mask):'));
panel.add(thresholdSlider);

// Run Button
var runBtn = ui.Button({
  label: 'Run Analysis',
  onClick: updateMap
});
panel.add(runBtn);

// Statistics Panel
var statsLabel = ui.Label('Statistics: Run analysis to see results.');
panel.add(statsLabel);

// 5. Map Layer Management
function updateMap() {
  var start = startDate.getValue();
  var end = endDate.getValue();
  var cloudMax = cloudSlider.getValue();
  var layer = layerSelect.getValue();
  
  var dataset = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                  .filterDate(start, end)
                  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloudMax))
                  .map(maskS2clouds)
                  .map(addIndices);
                  
  var image = dataset.median();
  
  Map.clear();
  Map.setCenter(55.5, 25.0, 10); // Example: UAE/RAK region
  
  var visParams = {};
  var layerName = layer;
  
  if (layer === 'RGB') {
    visParams = {min: 0.0, max: 0.3, bands: ['B4', 'B3', 'B2']};
  } else if (layer === 'NDVI') {
    visParams = {min: -1, max: 1, palette: ['blue', 'white', 'green']};
    image = image.select('NDVI');
  } else if (layer === 'NDMI') {
    visParams = {min: -1, max: 1, palette: ['red', 'white', 'blue']};
    image = image.select('NDMI');
  } else if (layer === 'NDWI') {
    visParams = {min: -1, max: 1, palette: ['brown', 'white', 'blue']};
    image = image.select('NDWI');
  } else if (layer === 'SAVI') {
    visParams = {min: -1, max: 1, palette: ['brown', 'yellow', 'green']};
    image = image.select('SAVI');
  }
  
  Map.addLayer(image, visParams, layerName);
  
  // 6. Chart Generation (Time Series)
  var region = Map.getBounds(true);
  
  var chart = ui.Chart.image.series({
    imageCollection: dataset.select(['NDVI', 'NDMI']),
    region: region,
    reducer: ee.Reducer.mean(),
    scale: 20
  }).setOptions({
    title: 'Spectral Indices Over Time',
    vAxis: {title: 'Index Value'},
    hAxis: {title: 'Date'}
  });
  
  // Update Stats
  var meanDict = image.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: region,
    scale: 20,
    maxPixels: 1e9
  });
  
  meanDict.evaluate(function(stats) {
    statsLabel.setValue('Mean Value: ' + JSON.stringify(stats));
  });
  
  // Add chart to panel (remove old if exists)
  // Simplified for this script: just print chart to console or add to separate panel
  print(chart);
}

// Initial Run
updateMap();

// Tooltips
cloudSlider.setDisabled(false); // Enable interactions
