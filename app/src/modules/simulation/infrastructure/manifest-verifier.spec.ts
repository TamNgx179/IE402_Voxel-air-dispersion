import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { APP_ROOT } from '../../../config/env.validation.js';
import {
  compileManifestSchema,
  metricsRow,
  type RunManifest,
  verifyRunOutput,
} from './manifest-verifier.js';

const REPO_ROOT = resolve(APP_ROOT, '..');
const validate = compileManifestSchema(
  join(REPO_ROOT, 'config', 'manifest.schema.json'),
);
const EXAMPLE = JSON.parse(
  readFileSync(
    join(REPO_ROOT, 'tests', 'fixtures', 'manifest_v1_example.json'),
    'utf8',
  ),
) as RunManifest;
const RUN_ID = EXAMPLE.run_id;

const sha = (b: Buffer | string) =>
  createHash('sha256').update(b).digest('hex');

/** Writes the example's artifacts with real content and returns a matching manifest. */
function makeRun(dir: string): RunManifest {
  const manifest: RunManifest = structuredClone(EXAMPLE);
  manifest.artifacts = manifest.artifacts.map((a) => {
    const content = Buffer.from(`content of ${a.path}`);
    writeFileSync(join(dir, a.path), content);
    return { ...a, sha256: sha(content), size_bytes: content.length };
  });
  return manifest;
}

function write(dir: string, manifest: unknown) {
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

const verify = (
  dir: string,
  extra: Partial<Parameters<typeof verifyRunOutput>[0]> = {},
) =>
  verifyRunOutput({
    runDir: dir,
    runId: RUN_ID,
    model: 'fv',
    scenarioId: 'dry_nov_apr',
    validate,
    ...extra,
  });

describe('manifest schema', () => {
  it('accepts the v1 example fixture as is', () => {
    expect(validate(EXAMPLE)).toBe(true);
  });
});

describe('verifyRunOutput', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voxel-run-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('accepts a consistent run and adds the manifest itself as an artifact', async () => {
    const m = makeRun(dir);
    write(dir, m);
    const r = await verify(dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.artifacts.map((a) => a.kind).sort()).toEqual([
      'columns',
      'concentration',
      'config',
      'log',
      'manifest',
      'metrics',
      'wind',
    ]);
    const own = r.artifacts.find((a) => a.kind === 'manifest')!;
    expect(own.sha256).toBe(sha(readFileSync(join(dir, 'manifest.json'))));
  });

  it('rejects a missing manifest (system)', async () => {
    const r = await verify(dir);
    expect(r).toMatchObject({
      ok: false,
      kind: 'system',
      message: expect.stringMatching(/missing/),
    });
  });

  it('rejects invalid JSON (system)', async () => {
    writeFileSync(join(dir, 'manifest.json'), '{oops');
    expect(await verify(dir)).toMatchObject({
      ok: false,
      kind: 'system',
      message: expect.stringMatching(/not valid JSON/),
    });
  });

  it('rejects a schema violation (system)', async () => {
    const m = makeRun(dir) as any;
    m.unexpected = true;
    delete m.units;
    write(dir, m);
    expect(await verify(dir)).toMatchObject({
      ok: false,
      kind: 'system',
      message: expect.stringMatching(/manifest\.schema\.json/),
    });
  });

  it('rejects a manifest of another run (system)', async () => {
    write(dir, makeRun(dir));
    const r = await verify(dir, {
      runId: '00000000-0000-4000-8000-000000000000',
    });
    expect(r).toMatchObject({
      ok: false,
      kind: 'system',
      message: expect.stringMatching(/does not match run/),
    });
  });

  it('rejects a model or scenario mismatch (system)', async () => {
    write(dir, makeRun(dir));
    expect(await verify(dir, { model: 'gaussian' })).toMatchObject({
      ok: false,
      kind: 'system',
    });
    expect(await verify(dir, { scenarioId: 'wet_may_oct' })).toMatchObject({
      ok: false,
      kind: 'system',
    });
  });

  it('rejects a checksum mismatch (system)', async () => {
    const m = makeRun(dir);
    write(dir, m);
    writeFileSync(join(dir, 'wind.nc'), Buffer.from('CONTENT of wind.nc')); // same size
    expect(await verify(dir)).toMatchObject({
      ok: false,
      kind: 'system',
      message: expect.stringMatching(/wind.*checksum mismatch/),
    });
  });

  it('rejects a size mismatch (system)', async () => {
    const m = makeRun(dir);
    m.artifacts[1].size_bytes += 1;
    write(dir, m);
    expect(await verify(dir)).toMatchObject({
      ok: false,
      kind: 'system',
      message: expect.stringMatching(/size/),
    });
  });

  it('rejects a missing artifact file (system)', async () => {
    const m = makeRun(dir);
    rmSync(join(dir, 'columns.csv.gz'));
    write(dir, m);
    expect(await verify(dir)).toMatchObject({
      ok: false,
      kind: 'system',
      message: expect.stringMatching(/columns.*missing/),
    });
  });

  it.each(['..', '.'])(
    'rejects path traversal through "%s" (system)',
    async (path) => {
      const m = makeRun(dir);
      m.artifacts[0].path = path;
      write(dir, m);
      expect(await verify(dir)).toMatchObject({
        ok: false,
        kind: 'system',
        message: expect.stringMatching(/escapes/),
      });
    },
  );

  it('rejects separators via the schema (system)', async () => {
    const m = makeRun(dir);
    m.artifacts[0].path = '../outside.txt';
    write(dir, m);
    expect(await verify(dir)).toMatchObject({ ok: false, kind: 'system' });
  });

  it('rejects a symlinked artifact (system)', async (ctx) => {
    const m = makeRun(dir);
    const outside = join(tmpdir(), `voxel-outside-${Date.now()}.txt`);
    writeFileSync(outside, readFileSync(join(dir, 'wind.nc')));
    rmSync(join(dir, 'wind.nc'));
    try {
      symlinkSync(outside, join(dir, 'wind.nc'));
    } catch {
      rmSync(outside, { force: true });
      ctx.skip(); // creating symlinks needs Developer Mode/admin on Windows
      return;
    }
    write(dir, m);
    const r = await verify(dir);
    rmSync(outside, { force: true });
    expect(r).toMatchObject({
      ok: false,
      kind: 'system',
      message: expect.stringMatching(/not a regular file/),
    });
  });

  it('rejects a duplicated artifact kind (system)', async () => {
    const m = makeRun(dir);
    m.artifacts.push({ ...m.artifacts[1] });
    write(dir, m);
    expect(await verify(dir)).toMatchObject({
      ok: false,
      kind: 'system',
      message: expect.stringMatching(/twice/),
    });
  });

  it('rejects a manifest that omits a required artifact (system)', async () => {
    const m = makeRun(dir);
    m.artifacts = m.artifacts.filter((a) => a.kind !== 'columns');
    write(dir, m);
    expect(await verify(dir)).toMatchObject({
      ok: false,
      kind: 'system',
      message: expect.stringMatching(/columns/),
    });
  });

  it('rejects a config.yaml that differs from the monolith snapshot (system)', async () => {
    write(dir, makeRun(dir));
    expect(await verify(dir, { configSha256: 'f'.repeat(64) })).toMatchObject({
      ok: false,
      kind: 'system',
      message: expect.stringMatching(/config\.yaml/),
    });
  });

  it('rejects verification.status = fail (model) and names the failed check', async () => {
    const m = makeRun(dir);
    m.verification.status = 'fail';
    m.verification.checks.mass_balance.status = 'fail';
    write(dir, m);
    expect(await verify(dir)).toMatchObject({
      ok: false,
      kind: 'model',
      message: expect.stringMatching(/mass_balance/),
    });
  });

  it('rejects "pass" overall with a failing check (model)', async () => {
    const m = makeRun(dir);
    m.verification.checks.cfl.status = 'fail';
    write(dir, m);
    expect(await verify(dir)).toMatchObject({
      ok: false,
      kind: 'model',
      message: expect.stringMatching(/cfl/),
    });
  });
});

describe('metricsRow', () => {
  it('reads the flat metrics.json of the solver', () => {
    const row = metricsRow(
      {
        dt_s: 0.5,
        courant: 0.4,
        steps: 1200,
        simulated_s: 600,
        wall_clock_s: 3.2,
        emitted_kg: 1,
        remaining_kg: 0.4,
        escaped_kg: 0.6,
        correction_kg: 0,
        stopping_criterion: 'fixed_time',
      },
      EXAMPLE,
    );
    expect(row).toEqual({
      dt_s: 0.5,
      courant: 0.4,
      steps: 1200,
      simulated_s: 600,
      wall_clock_s: 3.2,
      emitted_kg: 1,
      remaining_kg: 0.4,
      escaped_kg: 0.6,
      correction_kg: 0,
      stopping_criterion: 'fixed_time',
    });
  });

  it('tolerates missing keys, nested ledgers and aliases, falling back to manifest.stopping', () => {
    const row = metricsRow(
      {
        dt: 0.25,
        mass_ledger: { emitted_kg: 2, positivity_correction_kg: 1e-6 },
      },
      EXAMPLE,
    );
    expect(row).toMatchObject({
      dt_s: 0.25,
      courant: null,
      emitted_kg: 2,
      correction_kg: 1e-6,
      steps: EXAMPLE.stopping.steps,
      simulated_s: EXAMPLE.stopping.simulated_s,
      stopping_criterion: 'fixed_time',
    });
  });

  it('survives a non-object metrics file', () => {
    expect(metricsRow(null, EXAMPLE).steps).toBe(EXAMPLE.stopping.steps);
    expect(metricsRow([1, 2], EXAMPLE).dt_s).toBeNull();
  });
});
