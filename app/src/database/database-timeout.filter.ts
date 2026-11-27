import {
  type ArgumentsHost,
  Catch,
  HttpException,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/** SQLSTATEs after which the same request may succeed when simply retried. */
const RETRYABLE_SQLSTATES = new Set([
  '57014', // query_canceled (statement_timeout)
  '55P03', // lock_not_available (lock_timeout)
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '53300', // too_many_connections
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (server starting up)
]);

/** pg-pool's message when every pooled connection stays busy past connectionTimeoutMillis. */
const POOL_TIMEOUT_MESSAGE = 'timeout exceeded when trying to connect';

/** Retry hint, seconds, sent with every 503. */
export const RETRY_AFTER_S = 1;

/**
 * Classifies an error as a transient database failure, returning a short
 * reason for the log (never SQL or connection details), or undefined.
 * Follows `cause` a few levels so wrapped driver errors are still recognised.
 */
export function transientDatabaseFailure(err: unknown): string | undefined {
  // A deliberate HTTP answer keeps its status even if it wraps a driver error.
  if (err instanceof HttpException) return undefined;
  for (let depth = 0; depth < 4; depth++) {
    if (err === null || typeof err !== 'object') return undefined;
    const { code, message } = err as { code?: unknown; message?: unknown };
    if (typeof code === 'string') {
      if (RETRYABLE_SQLSTATES.has(code) || code.startsWith('08'))
        return `SQLSTATE ${code}`;
      if (code === 'ECONNREFUSED' || code === 'ECONNRESET') return code;
    }
    if (err instanceof Error && message === POOL_TIMEOUT_MESSAGE)
      return 'connection pool exhausted';
    err = (err as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Hide SQL/connection details and keep a cancelled request retryable. */
@Catch()
export class DatabaseTimeoutFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('DatabaseTimeoutFilter');

  override catch(exception: unknown, host: ArgumentsHost): void {
    const reason = transientDatabaseFailure(exception);
    if (reason === undefined) {
      super.catch(exception, host);
      return;
    }
    this.logger.warn(
      `answered 503 after transient database failure (${reason})`,
    );
    const adapter = this.applicationRef!;
    const response = host.switchToHttp().getResponse();
    // Part of the body already went out: the only safe thing is to end it.
    if (adapter.isHeadersSent(response)) {
      adapter.end(response);
      return;
    }
    adapter.setHeader(response, 'Retry-After', String(RETRY_AFTER_S));
    adapter.reply(
      response,
      {
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'The database is busy. Please try again.',
      },
      503,
    );
  }
}
