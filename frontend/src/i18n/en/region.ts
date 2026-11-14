/**
 * Copy owned by the region analysis sub-mode (src/panels/). Add keys here; the vi file must
 * mirror every key (enforced by the Messages<typeof en> type).
 */
const region = {
  modeLabel: 'Region',
  title: 'Region analysis',
  helpLabel: 'How to draw an analysis region',
  help: 'Click at least 3 points on the map, then Finish. Choose a height range to compute concentrations inside the region.',

  draw: 'Draw region',
  redraw: 'Redraw region',
  finish: 'Finish',
  cancel: 'Cancel drawing',
  clear: 'Clear region',

  'note.selected': 'Region selected · {count} vertices.',
  'note.keptPrevious': 'The previously selected region is kept.',
  'note.runChanged': 'The region is kept; analyse again to see the new result.',
  'note.noRun': 'Choose a simulation result before drawing a region.',
  'note.start': 'Choose at least 3 points.',
  'note.maxVertices': 'At most {max} vertices.',
  'note.progress': '{count}/3 points selected.',
  'note.ready': '{count} points · you can finish.',
  'note.inputChanged': 'Click Analyse region to update.',

  heightTitle: 'Height range',
  min: 'Height from (m)',
  max: 'Up to height (m)',
  threshold: 'Reference threshold (µg/m³)',
  thresholdHelpLabel: 'About the reference threshold',
  thresholdHelp:
    'Computes the share of air volume above this level. Model reference only; it does not assess real air quality.',

  query: 'Analyse region',
  requery: 'Analyse again',
  querying: 'Analysing…',

  'feedback.illustration': 'An illustration is applied. Go to Illustration → Back to original data to analyse.',
  'feedback.loading': 'Computing statistics inside the region…',
  'feedback.csvDone': 'CSV table downloaded.',

  resultLabel: 'Region analysis result',
  resultTitle: 'Result inside the region',
  resultHelpLabel: 'How to read the region result',
  resultHelp:
    'Means are weighted by air volume, excluding solid and missing cells. These are not real air measurements.',
  export: 'Download CSV',
  exporting: 'Downloading CSV…',

  'summary.context': '{run} · {min}–{max} m',
  'summary.runFallback': 'Selected result',
  'summary.noAir':
    'There is no air data inside this region and height range. Try another region or widen the height range.',
  'summary.noAirNote': 'No data does not mean a concentration of 0.',
  'summary.mean': 'Mean concentration',
  'summary.max': 'Maximum concentration',
  'summary.exceedance': 'Volume above threshold',
  'summary.airVolume': 'Air volume',
  'summary.exceeds': '{percent}% of the air volume exceeds {threshold} µg/m³ ({volume} m³).',
  'summary.noExceedance': 'No air inside the selected region exceeds {threshold} µg/m³.',
  'summary.area': 'Area: {area} m².',
  'summary.layersTitle': 'Concentration by height',
  'summary.tableLabel': 'Concentration by height table, scroll to see the layers',
  'summary.caption': 'Concentration per layer (µg/m³); only the part inside the selected height range is counted',
  'summary.colCentre': 'Layer centre (m)',
  'summary.colMean': 'Mean',
  'summary.colMax': 'Maximum',
  noData: 'No data',
} as const;
export default region;
