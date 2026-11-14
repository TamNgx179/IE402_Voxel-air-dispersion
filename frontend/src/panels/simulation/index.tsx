/**
 * Simulation panel (legacy #simulation-options + #run-note/#run-progress/#run-error/#run-retry).
 *
 * The panel body chooses a scenario and an emission preset and creates a run; the
 * progress block is `Persistent` so it stays visible while the panel is closed.
 * Creation/tracking logic lives in ./tracker.ts (one tracker per viewer store).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { HelpTrigger } from '../../components/Help';
import { useI18n, type TranslationKey } from '../../i18n';
import { seasonKey } from '../../lib/labels';
import { useApi, useViewerActions } from '../../store/controller';
import { useViewer, useViewerStore } from '../../store/store';
import type { PanelDefinition, PanelProps } from '../types';
import { EMISSION_MULTIPLIERS, trackerFor, type EmissionMultiplier, type Message, type SimulationTracker, type TrackerState } from './tracker';

const EMISSION_KEYS: Record<EmissionMultiplier, TranslationKey> = {
  1: 'simulation.emissionBaseline',
  0.8: 'simulation.emissionReduced20',
  0.6: 'simulation.emissionReduced40',
};

function useTracker(): [SimulationTracker, TrackerState] {
  const tracker = trackerFor(useViewerStore(), useApi());
  const state = useSyncExternalStore(tracker.subscribe, tracker.getState, tracker.getState);
  return [tracker, state];
}

/** Render a stored message; numeric params go through the locale formatter. */
function useMessageText() {
  const { t, formatInteger } = useI18n();
  return (message: Message | null): string => {
    if (!message) return '';
    const params: Record<string, string> = {};
    for (const [name, value] of Object.entries(message.params ?? {})) params[name] = typeof value === 'number' ? formatInteger(value) : value;
    if (message.state) params.state = t(`simulation.state.${message.state}` as TranslationKey);
    return t(message.key, params);
  };
}

function SimulationPanel(_props: PanelProps) {
  const { t, formatNumber } = useI18n();
  const [tracker, run] = useTracker();
  const { addCompletedRun } = useViewerActions();
  const bootstrap = useViewer((s) => s.bootstrap);
  const scenarios = bootstrap.data?.scenarios ?? [];
  const [scenarioChoice, setScenarioChoice] = useState('');
  const [emission, setEmission] = useState<EmissionMultiplier>(1);
  const scenarioId = scenarios.some((s) => s.id === scenarioChoice) ? scenarioChoice : (scenarios[0]?.id ?? '');
  const busy = run.creating || run.tracking || Boolean(run.activeRunId);
  const disabled = bootstrap.status !== 'ready' || !scenarioId || busy;

  return (
    <>
      <div className="section-heading">
        <h2 id="run-title" className="tool-panel-title">
          {t('simulation.title')}
        </h2>
        <HelpTrigger label={t('simulation.helpLabel')} text={t('simulation.help')} />
      </div>
      <label htmlFor="new-run-emission">{t('simulation.emission')}</label>
      <select
        id="new-run-emission"
        value={String(emission)}
        onChange={(event) => setEmission(Number(event.target.value) as EmissionMultiplier)}
      >
        {EMISSION_MULTIPLIERS.map((m) => (
          <option key={m} value={String(m)}>
            {t(EMISSION_KEYS[m])}
          </option>
        ))}
      </select>
      <label htmlFor="new-run-scenario">{t('simulation.scenario')}</label>
      <div className="run-form">
        <select id="new-run-scenario" value={scenarioId} disabled={!scenarios.length} onChange={(event) => setScenarioChoice(event.target.value)}>
          {scenarios.length ? (
            scenarios.map((scenario) => {
              const season = seasonKey(scenario.id);
              return (
                <option key={scenario.id} value={scenario.id}>
                  {t('simulation.scenarioOption', {
                    name: season ? t(season) : scenario.name,
                    speed: formatNumber(scenario.wind_speed_m_s),
                  })}
                </option>
              );
            })
          ) : (
            <option value="">{t('simulation.noScenarios')}</option>
          )}
        </select>
        <button
          id="run-button"
          className="primary-button"
          type="button"
          disabled={disabled}
          title={busy ? t('simulation.runBusy') : undefined}
          aria-describedby="run-note"
          onClick={() => void tracker.create({ scenario_id: scenarioId, emission_multiplier: emission }, addCompletedRun)}
        >
          <i className="bi bi-play-fill" aria-hidden="true" />
          <span>{t('simulation.run')}</span>
        </button>
      </div>
    </>
  );
}

/** Always-visible run note, progress bar, error disclosure and "keep tracking". */
function SimulationProgress() {
  const { t } = useI18n();
  const text = useMessageText();
  const [tracker, run] = useTracker();
  const { addCompletedRun } = useViewerActions();
  const bootstrapStatus = useViewer((s) => s.bootstrap.status);
  const hasRuns = useViewer((s) => s.runs.length > 0);
  const [open, setOpen] = useState(false);
  const contentId = 'run-error-content';

  // Resume tracking a run left active before a reload, once the app data is loaded.
  useEffect(() => {
    if (bootstrapStatus === 'ready') tracker.resume(addCompletedRun);
  }, [bootstrapStatus, tracker, addCompletedRun]);

  // A new error starts collapsed.
  useEffect(() => setOpen(false), [run.error]);

  let note = text(run.note);
  if (!run.note) {
    // A bootstrap failure is already announced (with retry) by the status box.
    if (bootstrapStatus === 'loading') note = t('viewer.statusConnecting');
    else if (bootstrapStatus === 'ready' && !hasRuns && !run.activeRunId) note = t('viewer.statusNoResults');
  }

  return (
    <>
      <p id="run-note" className="note" role="status" aria-live="polite">
        {note}
      </p>
      <progress
        id="run-progress"
        max={100}
        value={run.progress ?? 0}
        hidden={run.progress === null}
        aria-label={t('simulation.progressLabel')}
        aria-valuetext={run.progress === null ? undefined : note}
      />
      <div id="run-error" className="run-error" hidden={!run.error}>
        <button type="button" className="text-button" aria-controls={contentId} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {t('simulation.errorDetails')}
        </button>
        <div id={contentId} hidden={!open}>
          <p id="run-error-detail">
            {text(run.error)}
          </p>
        </div>
      </div>
      <button
        id="run-retry"
        type="button"
        hidden={!run.canResume}
        onClick={() => {
          if (run.activeRunId) void tracker.track(run.activeRunId, addCompletedRun);
        }}
      >
        {t('simulation.keepTracking')}
      </button>
    </>
  );
}

export const simulationPanel: PanelDefinition = {
  id: 'simulation',
  icon: 'play-fill',
  labelKey: 'simulation.toolLabel',
  elementId: 'simulation-options',
  Component: SimulationPanel,
  Persistent: SimulationProgress,
};
