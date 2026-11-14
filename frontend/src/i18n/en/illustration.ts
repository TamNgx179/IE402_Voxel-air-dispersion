/** Copy for the illustration panel (src/panels/illustration). */
const illustration = {
  toolLabel: 'Illustration',
  title: 'Adjust illustration',
  helpLabel: 'Explain the illustration adjustments',
  help: 'Only changes the illustrative concentration on the map; it does not rerun the solver or change the original query data.',
  multiplier: 'Source factor',
  multiplierEdgar: '× 1 (EDGAR)',
  background: 'Background concentration (µg/m³)',
  reset: 'Back to original data',
} as const;
export default illustration;
