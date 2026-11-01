/** A10: read-only demo checks. A pass here is not final release acceptance. */
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname, platform, release, arch } from 'node:os';
import { parseArgs } from 'node:util';
import { command, writeJson } from './lib/process.mjs';
import { modelFiles } from './lib/model-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Resolve symlinks as well as '..' before reading a manifest-controlled path.
async function inside(base, name) {
  if (isAbsolute(name)) throw new Error('Đường dẫn manifest không hợp lệ.');
  const target = await realpath(resolve(base, name));
  const rel = relative(await realpath(base), target);
  if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel))
    throw new Error('Đường dẫn manifest nằm ngoài thư mục dữ liệu.');
  return target;
}

export async function verifyScene(projectRoot) {
  const sceneDir = resolve(projectRoot, 'db/seeds/scene');
  const bytes = await readFile(resolve(sceneDir, 'scene_manifest.json'));
  const manifest = JSON.parse(bytes);
  const files = Object.entries(manifest.files || {});
  if (!files.length) throw new Error('Scene thiếu danh sách checksum.');
  for (const [name, expected] of files) {
    const actual = sha256(await readFile(await inside(sceneDir, name)));
    if (actual !== expected) throw new Error(`Checksum scene không khớp: ${name}`);
  }
  return { manifest_sha256: sha256(bytes), file_count: files.length,
    grid: manifest.grid, counts: manifest.counts };
}

export async function verifyApi(base, fetcher = fetch, expectedScene) {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('URL ứng dụng phải là HTTP(S), không chứa mật khẩu hoặc query.');
  async function get(path) {
    let response;
    try {
      response = await fetcher(new URL(path, url), {
        method: 'GET', signal: AbortSignal.timeout(10_000), redirect: 'error',
      });
    } catch {
      throw new Error('Không kết nối được ứng dụng. Kiểm tra URL, cổng và trạng thái khởi động.');
    }
    if (!response.ok) throw new Error(`Ứng dụng trả HTTP ${response.status}.`);
    return response.json();
  }
  const health = await get('/api/health');
  // Health deliberately returns HTTP 200 even without a configured database.
  if (health.status !== 'ok' || health.database?.status !== 'up' || !health.python?.ok ||
      !health.artifactDir?.exists || !health.artifactDir?.writable)
    throw new Error('Ứng dụng chưa sẵn sàng: kiểm tra DB, Python và thư mục kết quả.');
  const areas = await get('/api/study-areas');
  const scenarios = await get('/api/scenarios');
  if (!Array.isArray(areas) || !areas.length || !Array.isArray(scenarios) || !scenarios.length)
    throw new Error('Chưa có khu vực hoặc kịch bản. Chạy migration và seed trước demo.');
  if (expectedScene) {
    const area = areas.find((area) => area.provenance?.scene_manifest_sha256 === expectedScene.manifest_sha256);
    if (!area || Object.entries(expectedScene.grid).some(([key, value]) => area.grid?.[key] !== value))
      throw new Error('Scene hoặc lưới trong DB không khớp bộ demo tại checkout này.');
    const scene = await get(`/api/study-areas/${encodeURIComponent(area.id)}/scene`);
    for (const layer of ['buildings', 'roads', 'water', 'green']) {
      const features = scene[layer]?.features;
      if (!Array.isArray(features) || features.length !== expectedScene.counts[layer])
        throw new Error(`Lớp ${layer} trong DB chưa khớp số lượng của bộ demo.`);
    }
  }
  // Copy only non-secret fields: health can contain local paths and connection errors.
  return { status: 'ok', database: 'up', python: health.python.version,
    study_area_count: areas.length, scenario_count: scenarios.length };
}

export async function preflight({ projectRoot = root, python = 'python', base, requireClean = false } = {}) {
  const report = { schema_version: 1, purpose: 'demo-preflight',
    created_at: new Date().toISOString(), release_accepted: false,
    environment: { host: hostname(), os: platform(), os_release: release(), arch: arch(), node: process.version },
    checks: [] };
  async function check(name, action, severity = 'fail') {
    try { report.checks.push({ name, status: 'pass', details: await action() }); }
    catch (error) { report.checks.push({ name, status: severity, message: error.message }); }
  }
  await check('source', async () => {
    const run = (args) => command('git', args, { cwd: projectRoot, timeout: 10_000 });
    report.source_revision = (await run(['rev-parse', 'HEAD'])).stdout.trim();
    const tracked = (await run(['diff', '--name-only', 'HEAD'])).stdout.trim().split(/\r?\n/).filter(Boolean);
    const untracked = (await run(['ls-files', '--others', '--exclude-standard'])).stdout.trim().split(/\r?\n/)
      .filter((name) => /^(app|web|src|tests|scripts|db|config|deploy|docs)\//.test(name) || /^(README\.md|Dockerfile|docker-compose\.yml|requirements.*\.txt|pyproject\.toml)$/.test(name));
    report.source_changes = [...tracked, ...untracked];
    if (report.source_changes.length) throw new Error('Checkout còn thay đổi sản phẩm; chưa thể chốt revision demo.');
    return { tracked_product_clean: true };
  }, requireClean ? 'fail' : 'warning');
  await check('scene', () => verifyScene(projectRoot));
  await check('input_bundle', async () => {
    // Reuse ZIP/member/size/hash validation. Never install or overwrite local inputs.
    const result = await command(python, ['-m', 'src.demo_bundle', 'verify'], {
      cwd: projectRoot, timeout: 30_000,
    });
    return JSON.parse(result.stdout);
  });
  await check('runtime_inventory', async () => {
    const tracked = await command('git', ['ls-files', '-z'], { cwd: projectRoot, timeout: 10_000 });
    const names = tracked.stdout.split('\0').filter((name) => /^(src|config|db|deploy|app\/src|web|scripts)\//.test(name) ||
      /^(Dockerfile|docker-compose\.yml|pyproject\.toml|requirements.*\.txt|app\/(package(-lock)?\.json))$/.test(name));
    report.runtime_files = {};
    for (const name of names) report.runtime_files[name] = sha256(await readFile(await inside(projectRoot, name)));
    return { file_count: names.length };
  });
  await check('historical_freeze', async () => {
    const freeze = JSON.parse(await readFile(resolve(projectRoot, 'deploy/model-freeze.json'), 'utf8'));
    if (freeze.schema_version !== 1 || !freeze.files) throw new Error('Freeze không đúng schema hiện hành.');
    const names = await modelFiles(projectRoot);
    const changed = names.filter((name) => report.runtime_files?.[name] !== freeze.files?.[name]);
    const removed = Object.keys(freeze.files || {}).filter((name) => !names.includes(name));
    report.historical_freeze_changes = { changed, removed };
    if (changed.length || removed.length) throw new Error(
      `Freeze B7 chưa khớp phiên bản này (${changed.length} tệp khác, ${removed.length} tệp đã bỏ). Cần B10.1 review và chạy lại trước khi chốt lock.`);
    return { status: 'matches_historical_candidate' };
  }, 'warning');
  if (base) await check('api', () => {
    const scene = report.checks.find((item) => item.name === 'scene' && item.status === 'pass');
    if (!scene) throw new Error('Chưa đối chiếu được DB vì bộ scene local chưa hợp lệ.');
    return verifyApi(base, fetch, scene.details);
  });
  else report.checks.push({ name: 'api', status: 'not_checked', message: 'Chưa kiểm ứng dụng đang chạy; dùng --url sau khi khởi động.' });
  report.status = report.checks.some((check) => check.status === 'fail') ? 'fail'
    : report.checks.some((check) => check.status === 'warning' || check.status === 'not_checked') ? 'warning' : 'pass';
  return report;
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { url: { type: 'string' }, python: { type: 'string', default: 'python' },
      out: { type: 'string', default: 'artifacts/demo/preflight.json' }, 'require-clean': { type: 'boolean', default: false } } });
    const out = resolve(root, values.out);
    const rel = relative(resolve(root, 'artifacts'), out);
    if (!rel || rel === '..' || rel.startsWith('..') || isAbsolute(rel)) throw new Error('--out phải nằm trong artifacts/.');
    const report = await preflight({ python: values.python, base: values.url, requireClean: values['require-clean'] });
    await writeJson(out, report);
    for (const check of report.checks) console.log(`[${check.status}] ${check.name}${check.message ? ': ' + check.message : ''}`);
    console.log(`Kết quả: ${report.status}. Báo cáo: ${relative(root, out)}`);
    process.exitCode = report.status === 'fail' ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
