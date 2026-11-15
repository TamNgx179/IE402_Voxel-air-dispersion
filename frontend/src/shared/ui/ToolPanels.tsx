/** Tool navigation and the host that renders every registered panel (src/panels/index.ts). */
import { Fragment } from 'react';
import { useI18n } from '../../i18n';
import type { PanelDefinition } from '../../features/types';
import { useViewer, useViewerDispatch } from '../../store/store';
import { ToolButton } from './ToolButton';

export const panelElementId = (panel: PanelDefinition) => panel.elementId ?? `panel-${panel.id}`;

const simulationId = 'simulation';

export function ToolNav({ panels }: { panels: readonly PanelDefinition[] }) {
  const { t } = useI18n();
  const dispatch = useViewerDispatch();
  const active = useViewer((s) => s.activePanel);
  return (
    <nav className="sidebar-nav" aria-label={t('viewer.toolsLabel')}>
      <ToolButton
        icon="map"
        className="tool-button"
        data-tool-panel={simulationId}
        aria-controls="simulation-options"
        aria-expanded={active === null || active === simulationId}
        onClick={() => dispatch({ type: 'panel/open', id: null })}
      >
        {t('simulation.toolLabel')}
      </ToolButton>
      {panels.filter((panel) => panel.id !== simulationId).map((panel) => {
        const open = active === panel.id;
        return (
          <ToolButton
            key={panel.id}
            icon={panel.icon}
            className="tool-button"
            data-tool-panel={panel.id}
            aria-controls={panelElementId(panel)}
            aria-expanded={open}
            onClick={() => dispatch({ type: 'panel/open', id: panel.id })}
          >
            {t(panel.labelKey)}
          </ToolButton>
        );
      })}
    </nav>
  );
}

/** Every panel stays mounted; closed panels are `hidden` so their state survives tool switches. */
export function PanelHost({ panels }: { panels: readonly PanelDefinition[] }) {
  const { t } = useI18n();
  const active = useViewer((s) => s.activePanel);
  return (
    <>
      {panels.map((panel) => {
        const { Component } = panel;
        const open = active === panel.id || (active === null && panel.id === simulationId);
        return (
          <section key={panel.id} className="tool-panel" id={panelElementId(panel)} aria-label={t(panel.ariaLabelKey ?? panel.labelKey)} hidden={!open}>
            <Component active={open} />
          </section>
        );
      })}
      {panels.map((panel) => (panel.Persistent ? <Fragment key={panel.id}>{<panel.Persistent />}</Fragment> : null))}
    </>
  );
}
