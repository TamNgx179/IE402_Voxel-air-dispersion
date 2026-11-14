/**
 * Copy owned by the stats panel (src/panels/stats). The vi file must mirror every
 * key (enforced by the Messages<typeof en> type).
 */
const stats = {
  toolLabel: 'Statistics',
  panelLabel: 'Statistics and selected cell',
  title: 'Concentration at the current level',
  helpLabel: 'How to read the concentration statistics',
  help: 'Figures belong to the level being viewed. The mean is taken over air cells with data; the maximum is the largest value in the level.',
  context: 'Level {min}–{max} m',
  contextAdjusted: 'Level {min}–{max} m · Illustration',
  mean: 'Mean',
  max: 'Maximum',

  thresholdTitle: 'Highlight cells above a threshold',
  thresholdHelpLabel: 'How to view cells above a threshold',
  thresholdHelp: 'Choose a threshold to highlight the cells above it on the map. 24-hour thresholds are for reference only; simulated figures do not replace monitoring.',
  thresholdToggle: 'Highlight cells above {label}: {value} µg/m³',
  thresholdNone: 'No data yet.',
  thresholdLoading: 'Loading data…',
  thresholdFailed: 'The figures could not be loaded.',
  thresholdZero: 'No cell at this level is above {value} µg/m³.',
  thresholdArea: '{area} m² above the threshold at this level.',

  cellTitle: 'Selected cell',
  cellSectionLabel: 'Individual cells',
  cellHelpLabel: 'How to inspect a cell',
  cellHelp: 'Click a cell on the map to see its concentration at each height level.',
  profileLoading: 'Loading data by height…',
  profileFailed: 'The data by height could not be loaded.',
  profileSourceExact: 'Queried data',
  profileSourceAdjusted: 'Adjusted estimate (illustration)',
  profileChartLabel: 'Concentration profile by height at cell {i}, {j}',
  profileAxisX: 'Concentration (µg/m³, log)',
  profileAxisY: 'Height (m)',
  profileSummary: 'Cell {i}, {j} · maximum {max} µg/m³',
  profileTableToggle: 'Show the values as a table',
  profileTableCaption: 'Concentration by level at cell {i}, {j}',
  profileColLevel: 'Level',
  profileColHeight: 'Height (m)',
  profileColValue: 'Concentration (µg/m³)',
  profileSolid: 'Building',
  profileCurrent: '(current level)',
} as const;
export default stats;
