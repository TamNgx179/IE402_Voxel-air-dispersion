/** Tool navigation and the host that renders every registered panel (src/panels/index.ts). */
import { Fragment } from 'react';
import { useI18n } from '../i18n';
import type { PanelDefinition } from '../panels/types';
import { useViewer, useViewerDispatch } from '../store/store';

export const panelElementId = (panel: PanelDefinition) => panel.elementId ?? `panel-${panel.id}`;

export function ToolNav({ panels }: { panels: readonly PanelDefinition[] }) {
  const { t } = useI18n();
  const dispatch = useViewerDispatch();
  const active = useViewer((s) => s.activePanel);
  return (
    <nav className="sidebar-nav" aria-label={t('viewer.toolsLabel')}>
      {panels.map((panel) => {
        const open = active === panel.id;
        return (
          <button
            key={panel.id}
            type="button"
            className="tool-button"
            data-tool-panel={panel.id}
            aria-controls={panelElementId(panel)}
            aria-expanded={open}
            onClick={() => dispatch({ type: 'panel/open', id: open ? null : panel.id })}
          >
            <i className={`bi bi-${panel.icon}`} aria-hidden="true" />
            <span>{t(panel.labelKey)}</span>
          </button>
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
        return (
          <section key={panel.id} className="tool-panel" id={panelElementId(panel)} aria-label={t(panel.labelKey)} hidden={active !== panel.id}>
            <Component active={active === panel.id} />
          </section>
        );
      })}
      {panels.map((panel) => (panel.Persistent ? <Fragment key={panel.id}>{<panel.Persistent />}</Fragment> : null))}
    </>
  );
}
