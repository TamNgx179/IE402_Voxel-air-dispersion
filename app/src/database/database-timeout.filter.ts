import { type ArgumentsHost, Catch } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/** Hide SQL/connection details and keep a cancelled request retryable. */
@Catch()
export class DatabaseTimeoutFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const code =
      exception !== null && typeof exception === 'object' && 'code' in exception
        ? exception.code
        : undefined;
    if (code === '57014' || code === '55P03') {
      this.applicationRef!.reply(
        host.switchToHttp().getResponse(),
        {
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'The database is busy. Please try again.',
        },
        503,
      );
      return;
    }
    super.catch(exception, host);
  }
}
