/** Human-readable export copy (report title/mode/notice/legend). Field names in metadata are never translated. */
const exportCopy = {
  noRun: 'Choose a result that has finished loading.',
  finishDrawing: 'Finish or cancel drawing before exporting.',
  modeOriginal: 'Original result',
  modeAdjusted: 'Adjusted illustration',
  notice: 'Model illustration; does not replace the original CSV data or monitoring. {wind} Illustrative windows.',
  windHidden: 'Wind hidden.',
  windPaused: 'Wind paused.',
  windMoving: 'Wind shown ×6.',
  legendTitle: 'Concentration (µg/m³, log scale)',
  thresholdLegendTitle: 'Exceedance areas (µg/m³)',
  thresholdNotice: ' Areas are coloured by threshold; areas below it are faded.',
  defaultAttribution: 'OpenStreetMap contributors; OpenFreeMap/OpenMapTiles',
} as const;
export default exportCopy;
