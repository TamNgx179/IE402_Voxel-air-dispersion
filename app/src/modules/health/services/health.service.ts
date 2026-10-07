import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../config/env.validation.js';
import { DatabaseService } from '../../../database/database.service.js';
import type {
  ArtifactDirectoryHealth,
  HealthReportSchema,
  PythonRuntimeHealth,
} from '../schemas/health-report.schema.js';

const require = createRequire(import.meta.url);
const APP_VERSION = (require('../../../../package.json') as { version: string })
  .version;

const PYTHON_TIMEOUT_MS = 5_000;

@Injectable()
export class HealthService {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly database: DatabaseService,
  ) {}

  async check(): Promise<HealthReportSchema> {
    const [artifactDir, python, database] = await Promise.all([
      this.checkArtifactDir(),
      this.checkPython(),
      this.database.status(),
    ]);
    // An unset DATABASE_URL is a deliberate mode (viewer only); an
    // unreachable configured database is not.
    const healthy =
      artifactDir.exists &&
      artifactDir.writable &&
      python.ok &&
      database.status !== 'down';
    return {
      status: healthy ? 'ok' : 'degraded',
      app: { version: APP_VERSION },
      artifactDir,
      python,
      database,
    };
  }

  private async checkArtifactDir(): Promise<ArtifactDirectoryHealth> {
    const path = this.config.get('ARTIFACT_DIR', { infer: true });
    let exists = false;
    let writable = false;
    try {
      exists = (await stat(path)).isDirectory();
    } catch {
      exists = false;
    }
    if (exists) {
      try {
        await access(path, constants.W_OK);
        writable = true;
      } catch {
        writable = false;
      }
    }
    return { path, exists, writable };
  }

  /** Runs `PYTHON_BIN --version` without a shell (argument array, 5 s timeout). */
  private checkPython(): Promise<PythonRuntimeHealth> {
    const bin = this.config.get('PYTHON_BIN', { infer: true });
    return new Promise((resolve) => {
      execFile(
        bin,
        ['--version'],
        { timeout: PYTHON_TIMEOUT_MS, windowsHide: true, shell: false },
        (error, stdout, stderr) => {
          if (error) {
            const reason = error.killed
              ? `timed out after ${PYTHON_TIMEOUT_MS} ms`
              : error.message;
            resolve({ bin, ok: false, error: reason });
            return;
          }
          // Very old Pythons print the version on stderr.
          const version = (stdout || stderr).trim();
          resolve({ bin, ok: true, version });
        },
      );
    });
  }
}
