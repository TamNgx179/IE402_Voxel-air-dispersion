import type { ComponentType } from 'react';
import type { TranslationKey } from '../i18n';

export interface PanelProps {
  /** True while this panel is the open tool. Panels stay mounted when closed (state is kept). */
  active: boolean;
}

export interface PanelDefinition {
  /** Stable id used by `dispatch({ type: 'panel/open', id })`. */
  id: string;
  /** Bootstrap icon name without the `bi-` prefix, e.g. `'play-fill'`. */
  icon: string;
  /** Tool button label. */
  labelKey: TranslationKey;
  /** Panel body, rendered inside `<section class="tool-panel" hidden={!active}>`. */
  Component: ComponentType<PanelProps>;
  /** DOM id of the panel section (keeps legacy CSS hooks). Defaults to `panel-<id>`. */
  elementId?: string;
  /**
   * Optional always-visible content rendered below the tool panels in the sidebar,
   * e.g. the simulation progress note that must stay visible while the panel is closed.
   */
  Persistent?: ComponentType;
}
