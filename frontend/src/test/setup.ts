import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Node >= 25 ships its own experimental Web Storage global, which can shadow jsdom's
// window.localStorage with an unusable object. Install a small in-memory Storage.
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
}
for (const name of ['localStorage', 'sessionStorage'] as const) {
  let usable = false;
  try {
    usable = typeof window[name]?.setItem === 'function';
  } catch {
    usable = false;
  }
  if (!usable) Object.defineProperty(window, name, { configurable: true, value: new MemoryStorage() });
}

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* storage may be unavailable */
  }
});

// jsdom has no matchMedia; components read prefers-reduced-motion and mobile breakpoints.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
