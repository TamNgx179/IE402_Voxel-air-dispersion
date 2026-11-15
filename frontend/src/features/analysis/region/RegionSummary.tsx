/**
 * Region result (legacy `regionSummary`). Only formats the volume-weighted
 * statistics computed by the server; nothing is derived from map colours.
 */
import { useI18n } from '../../../i18n';
import { Metrics, useAnalysisNumber } from '../Metrics';

export interface RegionLayer {
  z_center_m: number;
  mean_ug_m3: number | null;
  max_ug_m3: number | null;
}

/** POST /runs/:id/region response. */
export interface RegionResult {
  z_min_m: number;
  z_max_m: number;
  area_m2?: number | null;
  air_volume_m3: number | null;
  mean_ug_m3: number | null;
  max_ug_m3: number | null;
  threshold_ug_m3: number;
  exceedance_volume_m3: number | null;
  layers?: RegionLayer[];
}

export function RegionSummary({ result, runLabel }: { result: RegionResult; runLabel: string }) {
  const { t } = useI18n();
  const number = useAnalysisNumber('region.noData');
  const context = (
    <p className="result-context">
      {t('region.summary.context', { run: runLabel, min: number(result.z_min_m), max: number(result.z_max_m) })}
    </p>
  );
  const air = result.air_volume_m3 ?? 0;
  if (!(air > 0))
    return (
      <>
        {context}
        <p className="result-insight">{t('region.summary.noAir')}</p>
        <p className="note">{t('region.summary.noAirNote')}</p>
      </>
    );
  const exceedance = result.exceedance_volume_m3 ?? 0;
  const percent = (exceedance / air) * 100;
  return (
    <>
      {context}
      <Metrics
        format={number}
        entries={[
          { label: t('region.summary.mean'), value: result.mean_ug_m3, unit: 'µg/m³' },
          { label: t('region.summary.max'), value: result.max_ug_m3, unit: 'µg/m³' },
          { label: t('region.summary.exceedance'), value: percent, unit: '%' },
          { label: t('region.summary.airVolume'), value: result.air_volume_m3, unit: 'm³' },
        ]}
      />
      <p className="result-insight">
        {exceedance > 0
          ? t('region.summary.exceeds', {
              percent: number(percent),
              threshold: number(result.threshold_ug_m3),
              volume: number(exceedance),
            })
          : t('region.summary.noExceedance', { threshold: number(result.threshold_ug_m3) })}
      </p>
      {typeof result.area_m2 === 'number' && Number.isFinite(result.area_m2) && (
        <p className="note">{t('region.summary.area', { area: number(result.area_m2) })}</p>
      )}
      {result.layers && result.layers.length > 0 && (
        <>
          <h4>{t('region.summary.layersTitle')}</h4>
          <div className="result-table-scroll" tabIndex={0} role="region" aria-label={t('region.summary.tableLabel')}>
            <table className="result-table">
              <caption>{t('region.summary.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('region.summary.colCentre')}</th>
                  <th scope="col">{t('region.summary.colMean')}</th>
                  <th scope="col">{t('region.summary.colMax')}</th>
                </tr>
              </thead>
              <tbody>
                {result.layers.map((layer) => (
                  <tr key={layer.z_center_m}>
                    <td>{number(layer.z_center_m)}</td>
                    <td>{number(layer.mean_ug_m3)}</td>
                    <td>{number(layer.max_ug_m3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
