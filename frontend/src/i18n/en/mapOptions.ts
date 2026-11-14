/**
 * Copy owned by the mapOptions panel (src/panels/map-options). The vi file must
 * mirror every key (enforced by the Messages<typeof en> type). PNG footer text
 * follows the UI language; CSV/JSON field names never do.
 */
const mapOptions = {
  toolLabel: 'Map',
  title: 'Map layers',
  helpLabel: 'Explain the map layers',
  help: 'Turn display layers on or off. These options do not change the simulation data.',
  gridSize: 'Cell {dx} × {dy} m · grid {nx} × {ny}',

  basemap: 'Basemap',
  basemapVector: 'Light basemap',
  basemapRaster: 'OSM streets',

  buildings: 'Buildings',
  facades: 'Facade detail',
  facadesHelpLabel: 'Explain facade detail',
  facadesHelp: 'Windows and materials are illustrative. Building footprints and heights come from GIS data.',
  buildingSelected: 'Selected building · {height} m',
  roads: 'Roads',
  wind: 'Moving wind',
  windHelpLabel: 'Explain moving wind',
  windHelp: 'Trails follow the simulated wind field, shown 6× faster for readability; they are not pollution smoke.',
  windLoading: 'Loading the wind field of the result.',
  windMissing: 'No wind data for this result.',

  resultInfo: 'Result information',
  resultInfoHelpLabel: 'Explain the model and times',
  resultInfoHelp:
    'Compute time: how long the machine ran. Simulated time: how much time passes inside the model. Flat-roofed buildings on ground at elevation 0; illustrative windows.',

  exportLabel: 'Export results',
  exportTitle: 'Download results',
  exportPng: 'Image',
  exportPngLabel: 'Download the map image (PNG)',
  exportCsv: 'CSV',
  exportCsvLabel: 'Download the data (CSV)',
  exportJson: 'JSON',
  exportJsonLabel: 'Download the result information (JSON)',
  exportPreparing: 'Preparing the file…',
  exportDone: 'File downloaded.',
  exportFailed: 'Export failed: {message}',

  'error.mapBusy': 'Wait for the map to finish loading and stop moving, then try again.',
  'error.mapNotReady': 'The map is not ready yet.',
  'error.captureTimeout': 'Could not capture a frame. Please try again.',
  'error.changed': 'The selection changed. Please export again.',

  'png.title': 'PM2.5 · {title}',
  'png.layer': 'Level {min}–{max} m · centre {centre} m · {mode}',
  'png.run': 'Run: {run}',
  'png.comparisonRun': ' | Comparison: {run}',
  'png.model': 'Model: {model} | Input: {input}',
  'png.comparisonModel': 'Comparison model: {model} | Input: {input}',
  'png.source': 'Source: {attribution}',
  'png.exported': 'Exported: {time} | GIS LoD1, flat ground z=0 | Camera: {camera}',
} as const;
export default mapOptions;
