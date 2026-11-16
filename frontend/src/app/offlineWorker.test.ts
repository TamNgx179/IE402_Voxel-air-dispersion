import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, test, vi } from 'vitest';

test('offline worker caches only the art fallback and only serves it for navigation', async () => {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const stored = new Map<string, Response>();
  const fetch = vi.fn().mockRejectedValue(new TypeError('Offline'));
  const scope = 'http://127.0.0.1:5176/';
  runInNewContext(readFileSync('public/offline-worker.js', 'utf8'), {
    self: {
      registration: { scope },
      addEventListener: (name: string, listener: (event: Record<string, unknown>) => void) => handlers.set(name, listener),
    },
    caches: {
      open: async () => ({ put: (key: string, response: Response) => stored.set(key, response), match: (key: string) => stored.get(key) }),
    },
    fetch, URL, Response,
  });

  let done: Promise<unknown> | undefined;
  handlers.get('message')?.({
    data: { type: 'cache-offline-art', artwork: 'data:image/webp;base64,UklGRg==',
      loader: 'data:image/webp;base64,UklGRw==', locale: 'vi' },
    source: { url: scope },
    waitUntil: (work: Promise<unknown>) => { done = work; },
  });
  await done;
  expect([...stored.keys()]).toEqual([scope + 'offline-art']);

  const respondWith = vi.fn<(response: Promise<Response>) => void>();
  for (const request of [
    { url: scope + 'api/runs', mode: 'cors', method: 'GET' },
    { url: 'https://tile.openstreetmap.org/1/2/3.png', mode: 'no-cors', method: 'GET' },
    { url: scope + 'api/health', mode: 'navigate', method: 'GET' },
  ]) handlers.get('fetch')?.({ request, respondWith });
  expect(respondWith).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();

  handlers.get('fetch')?.({ request: { url: scope, mode: 'navigate', method: 'GET' }, respondWith });
  const offline = await respondWith.mock.calls[0][0];
  const html = await offline.text();
  expect(html).toContain('data:image/webp;base64,UklGRg==');
  expect(html).toContain('data:image/webp;base64,UklGRw==');
  expect(html).toContain('Đang chờ kết nối');
  const reconnectScript = html.match(/<script>([\s\S]+)<\/script>/)?.[1];
  expect(reconnectScript).toBeDefined();
  const probe = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'degraded' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ok' }) });
  const replace = vi.fn();
  const schedule = vi.fn<(callback: () => Promise<void>, delay: number) => number>(() => 1);
  await runInNewContext(reconnectScript!, {
    fetch: probe, navigator: { onLine: true }, AbortSignal,
    window: { addEventListener: vi.fn() },
    location: { href: scope, replace },
    setTimeout: schedule, clearTimeout: vi.fn(),
  });
  expect(replace).not.toHaveBeenCalled();
  expect(schedule.mock.calls[0][1]).toBe(4000);
  await schedule.mock.calls[0][0]();
  expect(replace).toHaveBeenCalledTimes(1);
  expect(replace).toHaveBeenCalledWith(scope);
  expect(stored.size).toBe(1);
});
