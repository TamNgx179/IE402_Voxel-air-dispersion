import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { I18nProvider, useI18n, type Locale } from '../../i18n';
import { HelpProvider } from '../../shared/ui/Help';
import { createViewerStore, ViewerStoreProvider, type ViewerStore } from '../../store/store';
import type { Display } from '../../store/types';
import { illustrationPanel } from '.';

const { Component: IllustrationPanel } = illustrationPanel;

/** Switches language from inside the provider, like the EN/VI header switch. */
function LocaleSwitch() {
  const { locale, setLocale } = useI18n();
  return (
    <button type="button" onClick={() => setLocale(locale === 'en' ? 'vi' : 'en')}>
      switch-locale
    </button>
  );
}

/** Render the panel on its own inside the store, I18n and help providers (no App, map or API). */
function renderPanel({ display, locale = 'en' }: { display?: Display; locale?: Locale } = {}) {
  const store: ViewerStore = createViewerStore(display ? { display } : {});
  const utils = render(
    <ViewerStoreProvider store={store}>
      <I18nProvider initialLocale={locale}>
        <HelpProvider>
          <LocaleSwitch />
          <section id="illustration-options">
            <IllustrationPanel active />
          </section>
        </HelpProvider>
      </I18nProvider>
    </ViewerStoreProvider>,
  );
  const panel = within(document.getElementById('illustration-options') as HTMLElement);
  return { store, panel, ...utils };
}

const multiplierSelect = () => screen.getByRole('combobox', { name: 'Source factor' }) as HTMLSelectElement;
const backgroundInput = () => screen.getByRole('spinbutton', { name: 'Background concentration (µg/m³)' }) as HTMLInputElement;
const resetButton = () => screen.queryByRole('button', { name: 'Back to original data' });

describe('illustration panel definition', () => {
  test('registers the stable id, icon, label key and legacy DOM id', () => {
    expect(illustrationPanel).toMatchObject({
      id: 'illustration',
      icon: 'sliders',
      labelKey: 'illustration.toolLabel',
      elementId: 'illustration-options',
    });
  });
});

describe('illustration panel controls', () => {
  test('renders a labelled heading, source factor select and background input with the original data', () => {
    const { panel } = renderPanel();
    expect(panel.getByRole('heading', { level: 2, name: 'Adjust illustration' })).toHaveAttribute('id', 'illustration-title');
    const select = multiplierSelect();
    expect(select.value).toBe('1');
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ['1', '× 1 (EDGAR)'],
      ['10', '× 10'],
      ['30', '× 30'],
      ['100', '× 100'],
      ['300', '× 300'],
    ]);
    const input = backgroundInput();
    expect(input.value).toBe('0');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '200');
    expect(input).toHaveAttribute('step', '1');
    expect(input).toHaveAttribute('inputmode', 'decimal');
  });

  test('every source factor option writes display.multiplier and leaves background alone', () => {
    const { store } = renderPanel({ display: { multiplier: 1, background: 4 } });
    for (const value of ['10', '30', '100', '300', '1']) {
      fireEvent.change(multiplierSelect(), { target: { value } });
      expect(store.getState().display).toEqual({ multiplier: Number(value), background: 4 });
      expect(multiplierSelect().value).toBe(value);
    }
  });

  test('controls follow display values set elsewhere in the store', () => {
    const { store } = renderPanel({ display: { multiplier: 100, background: 3 } });
    expect(multiplierSelect().value).toBe('100');
    expect(backgroundInput().value).toBe('3');
    act(() => store.dispatch({ type: 'display/set', display: { multiplier: 30, background: 12.5 } }));
    expect(multiplierSelect().value).toBe('30');
    expect(backgroundInput().value).toBe('12.5');
  });

  test('valid background text is committed while typing; the max attribute is only a hint', () => {
    const { store } = renderPanel();
    fireEvent.change(backgroundInput(), { target: { value: '0.25' } });
    expect(store.getState().display.background).toBe(0.25);
    fireEvent.change(backgroundInput(), { target: { value: '250' } });
    expect(store.getState().display.background).toBe(250);
    expect(backgroundInput().value).toBe('250');
  });

  test('text that already means the stored value is kept until blur normalises it', () => {
    const { store } = renderPanel();
    const listener = vi.fn();
    store.subscribe(listener);
    fireEvent.change(backgroundInput(), { target: { value: '2.50' } });
    expect(store.getState().display.background).toBe(2.5);
    expect(backgroundInput().value).toBe('2.50');
    expect(listener).toHaveBeenCalledTimes(1);
    // Same number written differently: no further store update.
    fireEvent.change(backgroundInput(), { target: { value: '2.5' } });
    fireEvent.change(backgroundInput(), { target: { value: '2.50' } });
    expect(listener).toHaveBeenCalledTimes(1);
    fireEvent.blur(backgroundInput());
    expect(backgroundInput().value).toBe('2.5');
    expect(store.getState().display.background).toBe(2.5);
  });

  test('Enter commits like blur: empty or negative text becomes 0', () => {
    const { store } = renderPanel({ display: { multiplier: 1, background: 9 } });
    fireEvent.change(backgroundInput(), { target: { value: '-3' } });
    expect(store.getState().display.background).toBe(9);
    expect(backgroundInput().value).toBe('-3');
    fireEvent.keyDown(backgroundInput(), { key: 'Enter' });
    expect(store.getState().display.background).toBe(0);
    expect(backgroundInput().value).toBe('0');

    fireEvent.change(backgroundInput(), { target: { value: '6' } });
    fireEvent.change(backgroundInput(), { target: { value: '' } });
    expect(store.getState().display.background).toBe(6);
    fireEvent.keyDown(backgroundInput(), { key: 'Enter' });
    expect(store.getState().display.background).toBe(0);
    expect(backgroundInput().value).toBe('0');
  });

  test('other keys do not commit the background text', () => {
    const { store } = renderPanel({ display: { multiplier: 1, background: 9 } });
    fireEvent.change(backgroundInput(), { target: { value: '' } });
    fireEvent.keyDown(backgroundInput(), { key: 'Tab' });
    expect(store.getState().display.background).toBe(9);
    expect(backgroundInput().value).toBe('');
  });
});

describe('back to original data', () => {
  test('is hidden while the display is exact and shown as soon as either value changes', () => {
    const { store } = renderPanel();
    expect(resetButton()).not.toBeInTheDocument();
    expect(document.getElementById('illustration-reset')).toHaveAttribute('hidden');

    fireEvent.change(multiplierSelect(), { target: { value: '10' } });
    expect(resetButton()).toBeVisible();
    fireEvent.change(multiplierSelect(), { target: { value: '1' } });
    expect(resetButton()).not.toBeInTheDocument();

    fireEvent.change(backgroundInput(), { target: { value: '1' } });
    expect(resetButton()).toBeVisible();
    act(() => store.dispatch({ type: 'display/set', display: { background: 0 } }));
    expect(resetButton()).not.toBeInTheDocument();
  });

  test('restores {multiplier: 1, background: 0}, resets both controls and hides itself', () => {
    const { store } = renderPanel({ display: { multiplier: 300, background: 40 } });
    const button = resetButton() as HTMLButtonElement;
    expect(button).toHaveAttribute('type', 'button');
    fireEvent.click(button);
    expect(store.getState().display).toEqual({ multiplier: 1, background: 0 });
    expect(multiplierSelect().value).toBe('1');
    expect(backgroundInput().value).toBe('0');
    expect(resetButton()).not.toBeInTheDocument();
  });

  test('replaces half-typed background text with 0', () => {
    const { store } = renderPanel({ display: { multiplier: 10, background: 5 } });
    fireEvent.change(backgroundInput(), { target: { value: '' } });
    expect(store.getState().display.background).toBe(5);
    fireEvent.click(resetButton() as HTMLButtonElement);
    expect(backgroundInput().value).toBe('0');
  });
});

describe('help tooltip', () => {
  test('focus shows the explanation in the shared tooltip and Escape closes it', () => {
    renderPanel();
    const trigger = screen.getByRole('button', { name: 'Explain the illustration adjustments' });
    const help =
      'Only changes the illustrative concentration on the map; it does not rerun the solver or change the original query data.';
    expect(trigger).toHaveAttribute('data-help', help);
    act(() => trigger.focus());
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent(help);
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);
    expect(trigger).toHaveAccessibleDescription(help);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(trigger).not.toHaveAttribute('aria-describedby');
  });
});

describe('languages', () => {
  test('renders Vietnamese labels', () => {
    const { panel } = renderPanel({ locale: 'vi', display: { multiplier: 10, background: 1 } });
    expect(panel.getByRole('heading', { level: 2, name: 'Điều chỉnh minh họa' })).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'Giải thích điều chỉnh minh họa' })).toHaveAttribute(
      'data-help',
      'Chỉ thay đổi nồng độ minh họa trên bản đồ; không chạy lại solver hoặc đổi dữ liệu truy vấn gốc.',
    );
    const select = panel.getByRole('combobox', { name: 'Hệ số nguồn' }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['× 1 (EDGAR)', '× 10', '× 30', '× 100', '× 300']);
    expect(panel.getByRole('spinbutton', { name: 'Nồng độ nền (µg/m³)' })).toHaveValue(1);
    expect(panel.getByRole('button', { name: 'Về dữ liệu gốc' })).toBeVisible();
  });

  test('switching language relabels the controls without losing typed text or display values', () => {
    const { store, panel } = renderPanel();
    fireEvent.change(multiplierSelect(), { target: { value: '30' } });
    fireEvent.change(backgroundInput(), { target: { value: '2.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'switch-locale' }));
    const select = panel.getByRole('combobox', { name: 'Hệ số nguồn' }) as HTMLSelectElement;
    const input = panel.getByRole('spinbutton', { name: 'Nồng độ nền (µg/m³)' }) as HTMLInputElement;
    expect(select.value).toBe('30');
    expect(input.value).toBe('2.50');
    expect(store.getState().display).toEqual({ multiplier: 30, background: 2.5 });
    fireEvent.click(panel.getByRole('button', { name: 'Về dữ liệu gốc' }));
    expect(store.getState().display).toEqual({ multiplier: 1, background: 0 });
  });

  test('an open help tooltip follows the language change', () => {
    renderPanel();
    act(() => screen.getByRole('button', { name: 'Explain the illustration adjustments' }).focus());
    // A synthetic click does not move focus, so the trigger stays focused and the bubble open.
    const switcher = screen.getByRole('button', { name: 'switch-locale' });
    act(() => switcher.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Chỉ thay đổi nồng độ minh họa trên bản đồ; không chạy lại solver hoặc đổi dữ liệu truy vấn gốc.',
    );
  });
});
