// Ported from web/tests/viewer-api.test.cjs.
import { describe, expect, test } from 'vitest';
import { ApiError, AppError, errorMessage, request, type Fetcher } from './client';
import { translate } from '../i18n';

describe('API client', () => {
  test('preserves successful empty lists', async () => {
    expect(await request(async () => new Response('[]'), '/api/runs')).toEqual([]);
  });

  test('identifies server, conflict, permission, validation and not-found failures', async () => {
    for (const [status, kind] of [
      [503, 'server'],
      [409, 'conflict'],
      [403, 'permission'],
      [401, 'permission'],
      [400, 'validation'],
      [404, 'not-found'],
    ] as const) {
      const error = await request(async () => new Response('{"message":"failure"}', { status }), '/api/runs').catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).kind).toBe(kind);
      expect((error as ApiError).status).toBe(status);
    }
  });

  test('network failure never retries a simulation POST', async () => {
    let calls = 0;
    const error = await request(
      async () => {
        calls++;
        throw new TypeError('offline');
      },
      '/api/runs',
      { method: 'POST' },
    ).catch((e: unknown) => e);
    expect((error as ApiError).kind).toBe('network');
    expect(calls).toBe(1);
  });

  test('malformed payload is not rendered as a success', async () => {
    const error = await request(async () => new Response('<html>wrong app</html>'), '/api/runs').catch((e: unknown) => e);
    expect((error as ApiError).kind).toBe('invalid');
  });

  test('a failed response with a non-JSON body is classified by its status', async () => {
    for (const [status, kind] of [
      [502, 'server'],
      [504, 'server'],
      [404, 'not-found'],
      [403, 'permission'],
      [409, 'conflict'],
      [400, 'validation'],
    ] as const) {
      const error = await request(
        async () => new Response('<html>Gateway Timeout</html>', { status, headers: { 'Content-Type': 'text/html' } }),
        '/api/runs',
        { method: 'POST' },
      ).catch((e: unknown) => e);
      expect((error as ApiError).kind).toBe(kind);
      expect((error as ApiError).status).toBe(status);
      expect((error as ApiError).detail).toBe('');
    }
  });

  test('request timeout is recoverable', async () => {
    const fetcher: Fetcher = (_, options) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response('{}')), 50);
        options?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(options.signal?.reason);
          },
          { once: true },
        );
      });
    const error = await request(fetcher, '/api/runs', { timeoutMs: 5 }).catch((e: unknown) => e);
    expect((error as ApiError).kind).toBe('timeout');
  });

  test('server internals stay out of visible copy in both languages', async () => {
    const error = (await request(
      async () =>
        new Response(JSON.stringify({ message: 'Polygon must be valid with positive area (no self intersections)' }), {
          status: 400,
        }),
      '/api/runs/x/region',
    ).catch((e: unknown) => e)) as ApiError;
    expect(error.detail).toMatch(/self intersections/);
    const { key } = errorMessage(error);
    expect(translate('vi', key)).toMatch(/Thông tin chưa hợp lệ/);
    expect(translate('en', key)).toMatch(/not valid/);
    expect(translate('en', key)).not.toMatch(/Polygon|self intersections/);

    const sql = (await request(
      async () => new Response(JSON.stringify({ message: 'SELECT secret FROM private_table' }), { status: 500 }),
      '/api/runs',
    ).catch((e: unknown) => e)) as ApiError;
    expect(sql.kind).toBe('server');
    expect(translate('en', errorMessage(sql).key)).not.toContain('SELECT');
  });

  test('text responses and array messages', async () => {
    expect(await request(async () => new Response('a,b\r\n'), '/x', { responseType: 'text' })).toBe('a,b\r\n');
    const error = (await request(
      async () => new Response(JSON.stringify({ message: ['one', 'two'] }), { status: 422 }),
      '/x',
    ).catch((e: unknown) => e)) as ApiError;
    expect(error.detail).toBe('one; two');
  });

  test('unknown errors map to a generic key; AppError keeps params', () => {
    expect(errorMessage(new Error('boom')).key).toBe('errors.unknown');
    const e = new AppError('errors.runNotFound', { id: 'abc' });
    expect(translate('en', e.messageKey, e.params)).toBe('Result abc was not found.');
  });
});
