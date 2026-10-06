import { NotImplementedException } from '@nestjs/common';

/**
 * Thrown by skeleton endpoints that are declared in the API contract
 * (docs/spec.md) but not implemented yet. Responds with HTTP 501.
 */
export function notImplemented(endpoint: string, task?: string): never {
  throw new NotImplementedException(
    `${endpoint} is not implemented yet${task ? ` (roadmap ${task})` : ''}`,
  );
}
