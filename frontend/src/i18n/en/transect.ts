/**
 * Copy owned by the transect analysis sub-mode (src/panels/). Add keys here; the vi file must
 * mirror every key (enforced by the Messages<typeof en> type).
 */
const transect = {
  modeLabel: 'Vertical section',
  title: 'Vertical section',
  helpLabel: 'How to draw a section line',
  help: 'Click at least 2 points on the map, then Finish line to see concentration by distance and height.',
  draw: 'Draw line',
  redraw: 'Redraw line',
  finish: 'Finish line',
  cancel: 'Cancel line',
  clear: 'Clear line',
  min: 'Start height (m)',
  max: 'End height (m)',
  query: 'View section',
  queryAgain: 'View section again',
  querying: 'Fetching section…',
  notePickTwo: 'Choose at least 2 points.',
  noteOne: '1 of 2 points chosen.',
  noteCount: '{count} points · ready to finish.',
  noteChosen: 'Line selected · {count} points.',
  noteKept: 'Keeping the previously selected line.',
  loading: 'Fetching data along the line…',
  refresh: 'Press View section to update.',
  illustration: 'Illustration is applied. Go to Illustration → Back to original data to analyse.',
  csvDone: 'Section table downloaded.',
  currentResult: 'Selected result',
  resultTitle: 'Concentration section',
  resultHelpLabel: 'How to read the section',
  resultHelp:
    'Horizontal: distance. Vertical: height above flat ground. Select a cell or use the arrow keys to read the value at the cell centre, without interpolation.',
  context: '{run} · line {length} m · height {min}–{max} m',
  empty:
    'This line and height range have no air samples. Draw another line or widen the height range; an empty cell does not mean zero concentration.',
  chartLabel:
    'Vertical section: the horizontal axis is distance, the vertical axis is height. Click a cell or use the arrow keys to read its value.',
  chartFallback: 'The section data can be downloaded as CSV.',
  scale: '0 → {max} µg/m³ · linear',
  legendSolid: 'Building',
  legendNoData: 'Missing data',
  axisZ: 'Height (m)',
  axisDistance: 'Distance from line start (m)',
  download: 'Download CSV',
  downloading: 'Downloading…',
  close: 'Close section',
} as const;
export default transect;
