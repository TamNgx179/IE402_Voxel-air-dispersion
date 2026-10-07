import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigValidationError, validate } from './env.validation.js';

describe('validate (env config)', () => {
  let repoRoot: string;
  let appRoot: string;

  beforeAll(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'voxel-cfg-'));
    appRoot = join(repoRoot, 'app');
  });

  afterAll(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('applies defaults relative to the app directory', () => {
    const cfg = validate({}, { appRoot, platform: 'linux' });
    expect(cfg.PORT).toBe(3000);
    expect(cfg.REPO_ROOT).toBe(resolve(repoRoot));
    expect(cfg.PROJECT_CONFIG_PATH).toBe(
      resolve(repoRoot, 'config', 'project.yaml'),
    );
    expect(cfg.ARTIFACT_DIR).toBe(resolve(repoRoot, 'artifacts'));
    expect(cfg.PYTHON_BIN).toBe(resolve(repoRoot, '.venv', 'bin', 'python'));
    expect(cfg.DATABASE_URL).toBeUndefined();
  });

  it('uses the Windows venv layout on win32', () => {
    const cfg = validate({}, { appRoot, platform: 'win32' });
    expect(cfg.PYTHON_BIN).toBe(
      resolve(repoRoot, '.venv', 'Scripts', 'python.exe'),
    );
  });

  it('accepts explicit valid values', () => {
    const cfg = validate(
      {
        PORT: '8080',
        REPO_ROOT: repoRoot,
        ARTIFACT_DIR: 'out',
        PYTHON_BIN: 'python3',
        DATABASE_URL: 'postgresql://user:pw@localhost:5432/voxel',
      },
      { appRoot },
    );
    expect(cfg.PORT).toBe(8080);
    expect(cfg.ARTIFACT_DIR).toBe(resolve(appRoot, 'out'));
    expect(cfg.PYTHON_BIN).toBe('python3');
    expect(cfg.DATABASE_URL).toMatch(/^postgresql:/);
  });

  it.each(['abc', '0', '70000', '3000.5', '-1'])(
    'rejects invalid PORT %s',
    (port) => {
      expect(() => validate({ PORT: port }, { appRoot })).toThrow(
        /PORT must be an integer between 1 and 65535/,
      );
    },
  );

  it('rejects a REPO_ROOT that does not exist', () => {
    expect(() =>
      validate({ REPO_ROOT: join(repoRoot, 'missing') }, { appRoot }),
    ).toThrow(/REPO_ROOT must be an existing directory/);
  });

  it('rejects an explicit PROJECT_CONFIG_PATH that is not a file', () => {
    expect(() =>
      validate({ PROJECT_CONFIG_PATH: join(repoRoot, 'missing.yaml') }, { appRoot }),
    ).toThrow(/PROJECT_CONFIG_PATH must be an existing file/);
  });

  it('rejects a non-postgres DATABASE_URL without echoing it', () => {
    try {
      validate({ DATABASE_URL: 'mysql://secret@host/db' }, { appRoot });
      expect.unreachable('validate should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      expect((err as Error).message).toMatch(/DATABASE_URL must be/);
      expect((err as Error).message).not.toContain('secret');
    }
  });

  it('reports every problem at once', () => {
    try {
      validate({ PORT: 'x', DATABASE_URL: 'nope' }, { appRoot });
      expect.unreachable('validate should have thrown');
    } catch (err) {
      expect((err as ConfigValidationError).problems).toHaveLength(2);
    }
  });
  it('defaults the solver and executor settings', () => {
    const cfg = validate({}, { appRoot, platform: 'linux' });
    expect(cfg.SOLVER_MODE).toBe('mock');
    expect(cfg.SOLVER_MOCK_FAIL).toBeUndefined();
    expect(cfg.SOLVER_TIMEOUT_S).toBe(900);
    expect(cfg.SOLVER_CMD).toEqual([cfg.PYTHON_BIN, '-m', 'src.solver']);
    expect(cfg.EXECUTOR_ENABLED).toBe(true);
    expect(cfg.EXECUTOR_POLL_MS).toBe(1000);
  });

  it('accepts explicit solver and executor settings', () => {
    const cfg = validate(
      {
        SOLVER_MODE: 'mock',
        SOLVER_MOCK_FAIL: 'model',
        SOLVER_TIMEOUT_S: '2.5',
        SOLVER_CMD: '["node", "fake.mjs"]',
        EXECUTOR_ENABLED: 'false',
        EXECUTOR_POLL_MS: '100',
      },
      { appRoot },
    );
    expect(cfg).toMatchObject({
      SOLVER_MODE: 'mock',
      SOLVER_MOCK_FAIL: 'model',
      SOLVER_TIMEOUT_S: 2.5,
      SOLVER_CMD: ['node', 'fake.mjs'],
      EXECUTOR_ENABLED: false,
      EXECUTOR_POLL_MS: 100,
    });
  });

  it.each([
    [{ SOLVER_MODE: 'fast' }, /SOLVER_MODE/],
    [{ SOLVER_MOCK_FAIL: 'disk' }, /SOLVER_MOCK_FAIL must be/],
    [
      { SOLVER_MODE: 'real', SOLVER_MOCK_FAIL: 'model' },
      /only allowed with SOLVER_MODE=mock/,
    ],
    [{ SOLVER_TIMEOUT_S: '0' }, /SOLVER_TIMEOUT_S/],
    [{ SOLVER_CMD: 'python -m src.solver' }, /SOLVER_CMD must be a JSON array/],
    [{ SOLVER_CMD: '[]' }, /SOLVER_CMD must be a JSON array/],
    [{ EXECUTOR_ENABLED: 'maybe' }, /EXECUTOR_ENABLED/],
    [{ EXECUTOR_POLL_MS: '5' }, /EXECUTOR_POLL_MS/],
  ])('rejects %j', (env, message) => {
    expect(() => validate(env, { appRoot })).toThrow(message);
  });
});
