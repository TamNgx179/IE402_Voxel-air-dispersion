/**
 * Copy owned by the compare analysis sub-mode (src/panels/). Add keys here; the vi file must
 * mirror every key (enforced by the Messages<typeof en> type).
 */
const compare = {
  modeLabel: 'Compare results',
  title: 'Compare results',
  helpLabel: 'How to compare results',
  help: 'Choose a second result to see the difference at the same height. Wind and the statistics outside this section still belong to the baseline result.',

  baseline: 'Baseline: {label}',
  noBaseline: 'There is no baseline result yet.',
  run: 'Comparison result',
  runPlaceholder: 'Choose a comparison result',
  view: 'Show on the map',
  'view.off': 'Normal map',
  'view.baseline': 'Baseline · exact data',
  'view.comparison': 'Comparison · exact data',
  'view.delta': 'Difference · comparison − baseline',
  retry: 'Update comparison',

  'note.modified': 'Turn off the illustrative factor/background (×1, background 0) to analyse the original data.',
  'note.choose': 'Choose a comparison result.',
  'note.loading': 'Loading figures…',
  'note.off': 'Choose a map view to turn on the comparison.',
  'note.loaded': '{cells} air cells · {z} m',
  'note.noAir': 'This layer has no shared air cells.',

  'summary.deltaScale': 'ΔC: {min} → 0 → {max} µg/m³ · comparison − baseline',
  'summary.linearScale': '0 → {max} µg/m³ · shared linear scale',
  'summary.meanBaseline': 'Mean · baseline',
  'summary.meanComparison': 'Mean · comparison',
  'summary.meanDelta': 'Mean difference',
  'summary.noShared': 'There are no shared air cells to compare.',
  'summary.same': 'Both results have the same mean concentration at this layer.',
  'summary.higher': 'The comparison result is {value} µg/m³ higher than the baseline at this layer.',
  'summary.lower': 'The comparison result is {value} µg/m³ lower than the baseline at this layer.',
  'summary.barBaseline': 'Baseline',
  'summary.barComparison': 'Comparison',
  noData: 'No data',

  waitForComparison: 'Wait for the comparison to finish loading, then try again.',
  'report.baseline': 'Baseline result',
  'report.comparison': 'Comparison result',
  'report.delta': 'Difference: comparison − baseline',
} as const;
export default compare;
