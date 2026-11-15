/** Rendering of keyed analysis messages (client validation, API errors, notes). */
import { useCallback } from 'react';
import { useI18n, type TranslationKey, type TranslationParams } from '../../i18n';
import type { ErrorMessage } from '../../lib/analysis';

/** A message shown in a note/feedback line: an i18n key, params and an optional nested reason. */
export interface PanelMessage {
  key: TranslationKey;
  params?: TranslationParams;
  /** Rendered and passed as the `{reason}` param (e.g. "Could not download … {reason}"). */
  reason?: ErrorMessage;
}

/** Translates a message; numeric params are formatted in the UI locale (legacy `number`). */
export function useRenderMessage(): (message: PanelMessage | ErrorMessage | null | undefined) => string {
  const { t, formatNumber } = useI18n();
  return useCallback(
    function render(message: PanelMessage | ErrorMessage | null | undefined): string {
      if (!message) return '';
      const params: TranslationParams = {};
      for (const [name, value] of Object.entries(message.params ?? {}))
        params[name] = typeof value === 'number' ? formatNumber(value, { maximumSignificantDigits: 5 }) : value;
      if ('reason' in message && message.reason) params.reason = render(message.reason);
      return t(message.key, params);
    },
    [t, formatNumber],
  );
}
