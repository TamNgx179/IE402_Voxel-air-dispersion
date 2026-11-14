/**
 * Vertical profile of the selected cell: an SVG chart (role="img") plus the same
 * values as a table, so the profile is readable without the chart.
 *
 * Exact mode reads the API profile cached in the store under `<run>:<i>:<j>`.
 * The controller only fetches it and stores it by cell, so a late response for a
 * previously selected cell never shows here: this view only reads the key of the
 * cell that is selected now.
 */
import { useMemo } from 'react';
import { useI18n } from '../../i18n';
import { colourScale, thresholdColour } from '../../lib/concentration';
import { selectCurrentRun, selectExact, selectGrid, selectSelectedProfile, selectThresholds } from '../../store/selectors';
import { useViewer } from '../../store/store';
import { profileChart, profileValues } from './profile';

export function ProfileView({ i, j }: { i: number; j: number }) {
  const { t, formatNumber } = useI18n();
  const run = useViewer(selectCurrentRun);
  const grid = useViewer(selectGrid);
  const thresholds = useViewer(selectThresholds);
  const display = useViewer((s) => s.display);
  const layer = useViewer((s) => s.layer);
  const exact = useViewer(selectExact);
  const profile = useViewer(selectSelectedProfile);
  const failed = useViewer((s) => s.queries.status === 'error');

  const values = useMemo(
    () => (run && grid ? profileValues({ exact, profile, volume: run.volume, grid, display, i, j }) : null),
    [run, grid, exact, profile, display, i, j],
  );
  const chart = useMemo(() => {
    if (!values || !run || !grid) return null;
    return profileChart({
      values,
      zCentres: grid.z_centres_m,
      dz: grid.dz_m,
      nz: grid.nz,
      scale: colourScale(run.volume.scale, display),
      thresholds: Object.entries(thresholds ?? {}).map(([key, th]) => ({ key, value: th.value })),
      layer,
    });
  }, [values, run, grid, display, thresholds, layer]);

  if (!grid) return <div id="profile" className="profile" />;
  if (!values || !chart) {
    return (
      <div id="profile" className="profile" role="status">
        {exact && failed ? t('stats.profileFailed') : t('stats.profileLoading')}
      </div>
    );
  }

  const { width: W, height: H, pad } = chart;
  const tick = (e: number) => (Math.abs(e) > 3 ? `10^${e}` : formatNumber(10 ** e));
  return (
    <div id="profile" className="profile">
      <p className="note profile-source" data-exact={exact}>
        {t(exact ? 'stats.profileSourceExact' : 'stats.profileSourceAdjusted')}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('stats.profileChartLabel', { i, j })}>
        <g fill="#253039" fontSize="14" fontFamily="system-ui, sans-serif">
          {chart.xTicks.map(({ x, exponent }) => (
            <text key={exponent} x={x} y={H - pad.b + 14} textAnchor="middle">
              {tick(exponent)}
            </text>
          ))}
          {chart.yTicks.map(({ y, value }) => (
            <text key={value} x={pad.l - 6} y={y + 3} textAnchor="end">
              {formatNumber(value)}
            </text>
          ))}
          <text x={(pad.l + W - pad.r) / 2} y={H - 9} textAnchor="middle" fontWeight="600">
            {t('stats.profileAxisX')}
          </text>
          <text transform={`translate(16 ${(pad.t + H - pad.b) / 2}) rotate(-90)`} textAnchor="middle" fontWeight="600">
            {t('stats.profileAxisY')}
          </text>
        </g>
        <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="none" stroke="#879ba7" />
        {chart.solids.map((band, n) => (
          <rect key={n} x={pad.l} y={band.y} width={W - pad.l - pad.r} height={band.height} fill="rgba(148,163,184,0.25)" />
        ))}
        {chart.thresholds.map(({ key, x }) => (
          <line key={key} x1={x} x2={x} y1={pad.t} y2={H - pad.b} stroke={`rgb(${thresholdColour(key).join(',')})`} strokeDasharray="4 3" />
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={chart.currentY} y2={chart.currentY} stroke="rgba(79,107,93,0.5)" />
        {chart.path && <path d={chart.path} fill="none" stroke="#4f6b5d" strokeWidth={2} />}
      </svg>
      <p className="note profile-summary">{t('stats.profileSummary', { i, j, max: formatNumber(chart.max) })}</p>
      <details className="profile-table">
        <summary>{t('stats.profileTableToggle')}</summary>
        <table>
          <caption className="sr-only">{t('stats.profileTableCaption', { i, j })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('stats.profileColLevel')}</th>
              <th scope="col">{t('stats.profileColHeight')}</th>
              <th scope="col">{t('stats.profileColValue')}</th>
            </tr>
          </thead>
          <tbody>
            {values.map((v, k) => (
              <tr key={k} aria-current={k === layer ? 'true' : undefined}>
                <th scope="row">
                  {k}
                  {k === layer && <span className="sr-only"> {t('stats.profileCurrent')}</span>}
                </th>
                <td>{formatNumber(grid.z_centres_m[k])}</td>
                <td>{Number.isNaN(v) ? t('stats.profileSolid') : formatNumber(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
