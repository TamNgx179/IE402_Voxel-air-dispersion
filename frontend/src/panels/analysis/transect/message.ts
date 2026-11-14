/**
 * Keyed UI messages for the transect / corridor sub-modes. State holds keys and raw
 * numbers (never translated text), so switching language re-renders every note,
 * error and status in the new language without losing it.
 */
import type { TranslationKey } from '../../../i18n';
import type { ErrorMessage } from '../../../lib/analysis';

export interface Msg {
  key: TranslationKey;
  params?: Record<string, string | number>;
  /** Nested message inserted as the `{reason}` placeholder (e.g. CSV failure reason). */
  reason?: Msg;
}

export type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;
export type FormatNumber = (value: number | null | undefined, options?: Intl.NumberFormatOptions) => string;

/** Numbers in params are formatted in the UI locale (5 significant digits, legacy `number`). */
export function renderMsg(msg: Msg | null | undefined, t: Translate, format: FormatNumber): string {
  if (!msg) return '';
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(msg.params ?? {}))
    params[name] = typeof value === 'number' ? format(value, { maximumSignificantDigits: 5 }) : value;
  if (msg.reason) params.reason = renderMsg(msg.reason, t, format);
  return t(msg.key, params);
}

export function fromError(error: ErrorMessage): Msg {
  return error.params ? { key: error.key, params: error.params } : { key: error.key };
}
