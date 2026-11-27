import {
  type ArgumentsHost,
  ConflictException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DatabaseTimeoutFilter,
  transientDatabaseFailure,
} from './database-timeout.filter.js';

const pgError = (code: string) =>
  Object.assign(new Error('canceling statement due to statement timeout'), {
    code,
  });

describe('transientDatabaseFailure', () => {
  it.each(['57014', '55P03', '40001', '40P01', '53300', '57P01', '08006'])(
    'treats SQLSTATE %s as retryable',
    (code) => {
      expect(transientDatabaseFailure(pgError(code))).toBe(`SQLSTATE ${code}`);
    },
  );

  it('recognises an unreachable server and an exhausted pool', () => {
    expect(transientDatabaseFailure(pgError('ECONNREFUSED'))).toBe(
      'ECONNREFUSED',
    );
    expect(
      transientDatabaseFailure(
        new Error('timeout exceeded when trying to connect'),
      ),
    ).toBe('connection pool exhausted');
  });

  it('follows the cause chain of wrapped driver errors', () => {
    const wrapped = new Error('persist failed', {
      cause: new Error('step', { cause: pgError('57014') }),
    });
    expect(transientDatabaseFailure(wrapped)).toBe('SQLSTATE 57014');
  });

  it.each([
    ['a unique violation', pgError('23505')],
    ['a missing file', pgError('ENOENT')],
    ['a numeric code', Object.assign(new Error('x'), { code: 57014 })],
    ['a plain error', new Error('boom')],
    ['a string', '57014'],
    ['null', null],
    [
      'a deliberate HTTP answer',
      new ConflictException('taken', { cause: pgError('40001') }),
    ],
  ])('ignores %s', (_label, err) => {
    expect(transientDatabaseFailure(err)).toBeUndefined();
  });

  it('stops on a cyclic cause chain', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b', { cause: a });
    a.cause = b;
    expect(transientDatabaseFailure(a)).toBeUndefined();
  });
});

function harness(headersSent = false) {
  const adapter = {
    isHeadersSent: vi.fn(() => headersSent),
    setHeader: vi.fn(),
    reply: vi.fn(),
    end: vi.fn(),
  };
  const response = { res: true };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
    getArgByIndex: () => response,
  } as unknown as ArgumentsHost;
  const filter = new DatabaseTimeoutFilter(adapter as never);
  return { adapter, response, host, filter };
}

describe('DatabaseTimeoutFilter', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('answers a cancelled statement with a retryable 503 and no SQL', () => {
    const { adapter, response, host, filter } = harness();
    filter.catch(pgError('57014'), host);
    expect(adapter.setHeader).toHaveBeenCalledWith(
      response,
      'Retry-After',
      '1',
    );
    expect(adapter.reply).toHaveBeenCalledWith(
      response,
      {
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'The database is busy. Please try again.',
      },
      503,
    );
  });

  it('only ends a response whose headers were already sent', () => {
    const { adapter, response, host, filter } = harness(true);
    filter.catch(pgError('55P03'), host);
    expect(adapter.reply).not.toHaveBeenCalled();
    expect(adapter.end).toHaveBeenCalledWith(response);
  });

  it('leaves HTTP exceptions to the default handler', () => {
    const { adapter, response, host, filter } = harness();
    filter.catch(new ServiceUnavailableException('not configured'), host);
    expect(adapter.setHeader).not.toHaveBeenCalled();
    expect(adapter.reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({ statusCode: 503, message: 'not configured' }),
      503,
    );
  });

  it('keeps other database errors a generic 500', () => {
    const { adapter, response, host, filter } = harness();
    filter.catch(pgError('23505'), host);
    expect(adapter.reply).toHaveBeenCalledWith(
      response,
      { statusCode: 500, message: 'Internal server error' },
      500,
    );
  });
});
