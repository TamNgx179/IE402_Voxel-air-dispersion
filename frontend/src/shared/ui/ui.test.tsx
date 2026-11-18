import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { I18nProvider, LOCALE_STORAGE_KEY } from '../../i18n';
import { HelpProvider, HelpTrigger } from './Help';
import { LanguageSwitch } from './LanguageSwitch';
import { ToolButton } from './ToolButton';

afterEach(() => {
  vi.useRealTimers();
});

const bubble = () => document.getElementById('viewer-help-tooltip')!;

function helpFixture() {
  render(
    <HelpProvider>
      <HelpTrigger label="About height" text="Height above flat ground." />
      <HelpTrigger label="About wind" text="Wind is drawn from the solver." />
      <button type="button">Outside</button>
    </HelpProvider>,
  );
  return {
    height: screen.getByRole('button', { name: 'About height' }),
    wind: screen.getByRole('button', { name: 'About wind' }),
    outside: screen.getByRole('button', { name: 'Outside' }),
  };
}

describe('help tooltip', () => {
  test('hover shows one shared bubble and links it to the trigger; leaving hides it after a delay', () => {
    vi.useFakeTimers();
    const { height } = helpFixture();
    expect(bubble()).not.toBeVisible();

    fireEvent.pointerEnter(height);
    expect(bubble()).toBeVisible();
    expect(bubble()).toHaveTextContent('Height above flat ground.');
    expect(bubble()).toHaveAttribute('role', 'tooltip');
    expect(height).toHaveAttribute('aria-describedby', 'viewer-help-tooltip');

    fireEvent.pointerLeave(height);
    // The delay lets the pointer travel into the bubble without it closing.
    act(() => vi.advanceTimersByTime(100));
    expect(bubble()).toBeVisible();
    act(() => vi.advanceTimersByTime(50));
    expect(bubble()).not.toBeVisible();
    expect(height).not.toHaveAttribute('aria-describedby');
  });

  test('moving into the bubble cancels the pending close', () => {
    vi.useFakeTimers();
    const { height } = helpFixture();
    fireEvent.pointerEnter(height);
    fireEvent.pointerLeave(height);
    fireEvent.pointerEnter(bubble());
    act(() => vi.advanceTimersByTime(500));
    expect(bubble()).toBeVisible();
  });

  test('keyboard focus keeps the bubble open on pointer leave and blur closes it', () => {
    vi.useFakeTimers();
    const { height } = helpFixture();
    fireEvent.focus(height);
    fireEvent.pointerLeave(height);
    act(() => vi.advanceTimersByTime(500));
    expect(bubble()).toBeVisible();
    fireEvent.blur(height);
    expect(bubble()).not.toBeVisible();
  });

  test('a click pins the bubble for touch, a second click closes it', () => {
    vi.useFakeTimers();
    const { height } = helpFixture();
    fireEvent.click(height);
    fireEvent.pointerLeave(height);
    act(() => vi.advanceTimersByTime(500));
    expect(bubble()).toBeVisible();
    fireEvent.click(height);
    expect(bubble()).not.toBeVisible();
  });

  test('switching triggers moves the description to the new trigger', () => {
    const { height, wind } = helpFixture();
    fireEvent.pointerEnter(height);
    fireEvent.pointerEnter(wind);
    expect(bubble()).toHaveTextContent('Wind is drawn from the solver.');
    expect(wind).toHaveAttribute('aria-describedby', 'viewer-help-tooltip');
    expect(height).not.toHaveAttribute('aria-describedby');
  });

  test('Escape closes the bubble first without reaching other key handlers', () => {
    const { height } = helpFixture();
    const drawingCancel = vi.fn();
    document.addEventListener('keydown', drawingCancel);
    try {
      fireEvent.pointerEnter(height);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(bubble()).not.toBeVisible();
      expect(drawingCancel).not.toHaveBeenCalled();
      // With no bubble open, Escape reaches the drawing tools again.
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(drawingCancel).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', drawingCancel);
    }
  });

  test('a pointer press elsewhere, scrolling or resizing closes the bubble', () => {
    const { height, outside } = helpFixture();
    fireEvent.click(height);
    fireEvent.pointerDown(height);
    expect(bubble()).toBeVisible();
    fireEvent.pointerDown(outside);
    expect(bubble()).not.toBeVisible();

    fireEvent.click(height);
    fireEvent.scroll(document);
    expect(bubble()).not.toBeVisible();

    fireEvent.click(height);
    fireEvent(window, new Event('resize'));
    expect(bubble()).not.toBeVisible();
  });

  test('an open bubble follows a text change such as a language switch', () => {
    function Switchable() {
      const [text, setText] = useState('Height above flat ground.');
      return (
        <HelpProvider>
          <HelpTrigger label="About height" text={text} />
          <button type="button" onClick={() => setText('Độ cao so với mặt đất phẳng.')}>
            Translate
          </button>
        </HelpProvider>
      );
    }
    render(<Switchable />);
    fireEvent.click(screen.getByRole('button', { name: 'About height' }));
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    expect(bubble()).toHaveTextContent('Độ cao so với mặt đất phẳng.');
  });

  test('a trigger outside the provider renders and does nothing', () => {
    render(<HelpTrigger label="Orphan" text="No provider" />);
    const trigger = screen.getByRole('button', { name: 'Orphan' });
    expect(() => fireEvent.click(trigger)).not.toThrow();
    expect(trigger).toHaveAttribute('data-help', 'No provider');
  });
});

describe('language switch', () => {
  test('marks the active language, switches it, stores it and updates the document', () => {
    render(
      <I18nProvider initialLocale="en">
        <LanguageSwitch />
      </I18nProvider>,
    );
    const group = screen.getByRole('group', { name: 'Language' });
    const en = screen.getByRole('button', { name: 'Switch language to English' });
    const vi = screen.getByRole('button', { name: 'Switch language to Vietnamese' });
    expect(group).toContainElement(en);
    expect(en).toHaveAttribute('aria-pressed', 'true');
    expect(vi).toHaveAttribute('aria-pressed', 'false');
    expect(vi).toHaveAttribute('lang', 'vi');

    fireEvent.click(vi);
    expect(document.documentElement.lang).toBe('vi');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('vi');
    // Labels are now Vietnamese; the pressed state moved to VI.
    expect(screen.getByText('VI').closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('EN').closest('button')).toHaveAttribute('aria-pressed', 'false');
  });

  test('restores the stored language on the next start', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'vi');
    render(
      <I18nProvider>
        <LanguageSwitch />
      </I18nProvider>,
    );
    expect(screen.getByText('VI').closest('button')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('tool button', () => {
  test('is always a non-submitting button with a hidden icon and forwards attributes', () => {
    const onClick = vi.fn();
    render(
      <form onSubmit={() => onClick('submitted')}>
        <ToolButton icon="play-fill" type="submit" aria-pressed="true" className="tool" onClick={() => onClick('clicked')}>
          Simulate
        </ToolButton>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Simulate' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('tool');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button.querySelector('i')).toHaveClass('bi', 'bi-play-fill');
    expect(button.querySelector('i')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(button);
    expect(onClick.mock.calls).toEqual([['clicked']]);
  });
});
