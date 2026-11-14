/**
 * Shared help tooltip (port of web/viewer-help.js). One bubble outside the
 * scrolling panel; hover/focus shows it, click pins it (touch), Escape closes it
 * first without cancelling drawing underneath.
 *
 *   <HelpTrigger label={t('x.helpLabel')} text={t('x.help')} />
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface HelpApi {
  show(button: HTMLButtonElement, text: string): void;
  leave(): void;
  focus(button: HTMLButtonElement, text: string): void;
  close(): void;
  toggle(button: HTMLButtonElement, text: string): void;
  current: HTMLButtonElement | null;
}

const HelpContext = createContext<HelpApi | null>(null);
const BUBBLE_ID = 'viewer-help-tooltip';

export function HelpProvider({ children }: { children: ReactNode }) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<string | null>(null);
  const state = useRef({ current: null as HTMLButtonElement | null, pinned: false, focused: false, timer: 0 as unknown as ReturnType<typeof setTimeout> });

  const position = useCallback((button: HTMLButtonElement) => {
    const bubble = bubbleRef.current;
    if (!bubble) return;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    bubble.style.maxWidth = `${Math.min(280, vw - 24)}px`;
    const anchor = button.getBoundingClientRect();
    const size = bubble.getBoundingClientRect();
    bubble.style.left = `${Math.max(12, Math.min(anchor.right - size.width, vw - size.width - 12))}px`;
    const below = anchor.bottom + 8;
    const above = anchor.top - size.height - 8;
    // Prefer above so the bubble does not cover the action buttons under a heading.
    bubble.style.top = `${Math.max(12, above >= 12 ? above : Math.min(below, vh - size.height - 12))}px`;
  }, []);

  const close = useCallback(() => {
    const s = state.current;
    clearTimeout(s.timer);
    s.current?.removeAttribute('aria-describedby');
    s.current = null;
    s.pinned = false;
    s.focused = false;
    setText(null);
  }, []);

  const show = useCallback((button: HTMLButtonElement, value: string) => {
    const s = state.current;
    clearTimeout(s.timer);
    if (s.current && s.current !== button) {
      s.current.removeAttribute('aria-describedby');
      s.pinned = false;
      s.focused = false;
    }
    s.current = button;
    button.setAttribute('aria-describedby', BUBBLE_ID);
    setText(value);
  }, []);

  // Position after the text has rendered.
  useEffect(() => {
    if (text !== null && state.current.current) position(state.current.current);
  }, [text, position]);

  const api = useRef<HelpApi>({
    show,
    close,
    leave: () => {
      const s = state.current;
      if (!s.pinned && !s.focused) s.timer = setTimeout(close, 140);
    },
    focus: (button, value) => {
      show(button, value);
      state.current.focused = true;
    },
    toggle: (button, value) => {
      const s = state.current;
      if (s.current === button && s.pinned) close();
      else {
        show(button, value);
        s.pinned = true;
      }
    },
    get current() {
      return state.current.current;
    },
  }).current;

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const s = state.current;
      const target = event.target as Node;
      if (s.current && !s.current.contains(target) && !bubbleRef.current?.contains(target)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && state.current.current) {
        close();
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [close]);

  return (
    <HelpContext.Provider value={api}>
      {children}
      <div
        id={BUBBLE_ID}
        ref={bubbleRef}
        className="help-tooltip"
        role="tooltip"
        hidden={text === null}
        onPointerEnter={() => clearTimeout(state.current.timer)}
        onPointerLeave={api.leave}
      >
        {text}
      </div>
    </HelpContext.Provider>
  );
}

/** An (i) button with an accessible label whose explanation appears in the shared tooltip. */
export function HelpTrigger({ label, text }: { label: string; text: string }) {
  const api = useContext(HelpContext);
  const ref = useRef<HTMLButtonElement>(null);
  // Keep an open bubble in sync when the language changes.
  useEffect(() => {
    if (api && ref.current && api.current === ref.current) api.show(ref.current, text);
  }, [api, text]);
  return (
    <button
      ref={ref}
      type="button"
      className="help-trigger"
      aria-label={label}
      data-help={text}
      onPointerEnter={(e) => api?.show(e.currentTarget, text)}
      onPointerLeave={() => api?.leave()}
      onFocus={(e) => api?.focus(e.currentTarget, text)}
      onBlur={() => api?.close()}
      onClick={(e) => api?.toggle(e.currentTarget, text)}
    >
      <i className="bi bi-info-circle" aria-hidden="true" />
    </button>
  );
}
