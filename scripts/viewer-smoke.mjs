/** Headless Chrome/Edge smoke using Node's built-in DevTools WebSocket. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assert, waitUntil, writeJson } from './lib/process.mjs';

export function browserPath() {
  if (process.env.BROWSER_BIN) return process.env.BROWSER_BIN;
  const paths = process.platform === 'win32' ? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ] : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  const executable = paths.find((path) => existsSync(path));
  assert(executable, 'Install Chrome/Edge/Chromium or set BROWSER_BIN to run browser acceptance');
  return executable;
}

class DevTools {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.networkFailures = [];
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const waiting = this.pending.get(message.id);
        if (!waiting) return;
        this.pending.delete(message.id);
        clearTimeout(waiting.timer);
        if (message.error) waiting.reject(new Error(message.error.message));
        else waiting.resolve(message.result);
      } else if (message.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(message.params.exceptionDetails);
      } else if (message.method === 'Network.loadingFailed') {
        this.networkFailures.push(message.params);
      }
    });
    socket.addEventListener('close', () => {
      for (const waiting of this.pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error('Browser DevTools disconnected'));
      }
      this.pending.clear();
    });
  }

  async send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools command timed out: ${method}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async screenshot(path) {
    const result = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path, Buffer.from(result.data, 'base64'));
  }
}

export async function browserSmoke({ base, out, timeout = 120_000, legacy = false, evidenceRun }) {
  let origin = new URL(base);
  assert(['127.0.0.1', 'localhost'].includes(origin.hostname), 'Browser smoke only accepts the local demo');
  await mkdir(out, { recursive: true });
  const profile = join(out, `chrome-profile-${Date.now()}`);
  await mkdir(profile);
  const child = spawn(browserPath(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--enable-unsafe-swiftshader', '--window-size=1440,1000', 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  let launchError;
  child.on('error', (error) => { launchError = error; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let client;
  let proxy;
  let originUnavailable = false;
  const report = { schema_version: 1, base_url: base, status: 'running', checks: [] };
  const checks = (name) => report.checks.push({ name, status: 'pass' });
  try {
    if (evidenceRun) {
      // Cut access to the local origin for both the page and its service worker.
      // DevTools network emulation on the page alone does not govern worker fetches.
      const upstream = origin;
      proxy = createServer((incoming, outgoing) => {
        if (originUnavailable) {
          incoming.socket.destroy();
          return;
        }
        const forwarded = request(upstream, {
          path: incoming.url, method: incoming.method, headers: incoming.headers,
        }, (response) => {
          outgoing.writeHead(response.statusCode, response.headers);
          response.pipe(outgoing);
        });
        forwarded.on('error', () => outgoing.destroy());
        incoming.pipe(forwarded);
      });
      await new Promise((resolve, reject) => {
        proxy.once('error', reject);
        proxy.listen(0, '127.0.0.1', resolve);
      });
      origin = new URL(`http://127.0.0.1:${proxy.address().port}`);
    }
    const text = await waitUntil(async () => {
      if (launchError) throw launchError;
      return readFile(join(profile, 'DevToolsActivePort'), 'utf8');
    }, (value) => value.includes('\n'), { timeout: 20_000, name: 'headless browser launch' });
    const debug = `http://127.0.0.1:${Number(text.split('\n')[0])}`;
    const target = await (await fetch(`${debug}/json/new?about:blank`, { method: 'PUT' })).json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    client = new DevTools(socket);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
    });
    if (!legacy) {
      await client.send('Page.navigate', { url: origin.href });
      const evaluate = (expression) => client.evaluate(expression);
      await waitUntil(() => evaluate(`Boolean(document.querySelector('#map canvas') &&
        document.querySelector('#scenario-list')?.value &&
        document.querySelector('#height-slider:not(:disabled)') &&
        document.documentElement.lang === 'en')`), Boolean, { timeout, name: 'React viewer bootstrap' });
      checks('React viewer loaded a real result in English');
      await client.screenshot(join(out, 'scene-overview.png'));
      if (evidenceRun) {
        await evaluate(`(() => {
          const select = document.querySelector('#scenario-list');
          select.value = ${JSON.stringify(evidenceRun)};
          select.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
        for (const [index, metres] of [[0, 1], [7, 15]]) {
          await evaluate(`(() => {
            const slider = document.querySelector('#height-slider');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '${index}');
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
          })()`);
          await waitUntil(() => evaluate(`document.querySelector('#scenario-list')?.value === ${JSON.stringify(evidenceRun)} &&
            document.querySelector('#height-value')?.textContent.includes('${metres}') &&
            Boolean(document.querySelector('#map canvas'))`), Boolean, { name: `Evidence run layer ${metres} m` });
          await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          await client.screenshot(join(out, `map-${metres}m.png`));
        }
        report.evidence_run_id = evidenceRun;
        checks('Same production run photographed at 1 m and 15 m');
      }
      const initial = await evaluate(`(() => {
        document.querySelector('#height-marks button[data-index="12"]').click();
        return document.querySelector('#scenario-list').value;
      })()`);
      await waitUntil(() => evaluate(`document.querySelector('#height-slider').value === '12'`),
        Boolean, { name: '25 m layer' });
      await evaluate(`document.querySelector('.lang-switch button[lang="vi"]').click()`);
      await waitUntil(() => evaluate(`document.documentElement.lang === 'vi' &&
        document.querySelector('#scenario-list').value === ${JSON.stringify(initial)} &&
        document.querySelector('#height-slider').value === '12'`), Boolean, { name: 'Vietnamese and retained result' });
      checks('Changing language retains the run and 25 m layer');
      await evaluate(`document.querySelector('[data-tool-panel="analysis"]').click()`);
      for (const mode of ['region', 'transect', 'compare', 'corridor']) {
        await evaluate(`document.getElementById('analysis-${mode}-mode').click()`);
        await waitUntil(() => evaluate(`!document.getElementById('analysis-mode-${mode}').hidden`),
          Boolean, { name: `Analysis mode ${mode}` });
      }
      checks('All four analysis modes open in the live workspace');
      await evaluate(`document.querySelector('#corridor-road-list input[type="checkbox"]').click()`);
      await waitUntil(() => evaluate(`Boolean(document.querySelector('#corridor-query:not(:disabled)'))`),
        Boolean, { name: 'road corridor ready' });
      await evaluate(`document.querySelector('#corridor-query').click()`);
      await waitUntil(() => evaluate(`Boolean(document.querySelector('#corridor-result:modal')) &&
        document.querySelectorAll('#corridor-result tbody tr').length > 0`),
      Boolean, { name: 'server-backed road corridor result' });
      checks('Road corridor renders real PostGIS results');
      await client.screenshot(join(out, 'analysis-desktop.png'));
      await evaluate(`document.querySelector('#corridor-close').click()`);
      await waitUntil(() => evaluate(`!document.querySelector('#corridor-result:modal')`),
        Boolean, { name: 'corridor result closed' });
      await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: out });
      await evaluate(`document.querySelector('[data-tool-panel="map-options"]').click()`);
      await waitUntil(() => evaluate(`Boolean(document.querySelector('#export-data:not(:disabled)'))`),
        Boolean, { name: 'CSV export ready' });
      assert(await evaluate(`!document.querySelector('#result-info-content') &&
        Boolean(document.querySelector('#export-metadata:not(:disabled)'))`),
        'Downloads remain available with the result information card removed');
      await evaluate(`document.querySelector('#export-data').click()`);
      const csv = await waitUntil(async () => {
        const names = await readdir(out);
        return names.find((name) => name.endsWith('.csv'));
      }, Boolean, { name: 'browser CSV downloaded' });
      assert((await readFile(join(out, csv), 'utf8')).trim().split(/\r?\n/).length > 1, 'CSV is empty');
      checks('Browser downloaded a populated CSV');
      await evaluate(`document.querySelector('#toggle-3d').click()`);
      await waitUntil(() => evaluate(`document.querySelector('#toggle-3d').getAttribute('aria-pressed') === 'false'`),
        Boolean, { name: '2D camera' });
      checks('Camera switches to 2D');
      assert(await evaluate(`document.querySelector('#camera-rotation').hidden &&
        !document.querySelector('.maplibregl-ctrl-compass')`), 'Secondary camera controls should start hidden');
      const bearing = await evaluate(`document.querySelector('#reset-camera').dataset.bearing`);
      await evaluate(`document.querySelector('#camera-rotation-toggle').click();
        document.querySelector('#rotate-right').click()`);
      await waitUntil(() => evaluate(`!document.querySelector('#camera-rotation').hidden &&
        document.querySelector('#reset-camera').dataset.bearing !== ${JSON.stringify(bearing)}`),
        Boolean, { name: 'rotation controls move the camera' });
      await evaluate(`document.querySelector('#camera-rotation-toggle').click();
        document.querySelector('[data-tool-panel="simulation"]').click()`);
      assert(await evaluate(`document.querySelector('#camera-rotation').hidden &&
        !document.querySelector('#simulation-options').hidden`), 'Camera disclosure closes and Simulation restores the run form');
      assert(await evaluate(`(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const form = rect('#simulation-options');
        const result = rect('.control-card');
        document.querySelector('#camera-rotation-toggle').click();
        const rotation = rect('#camera-rotation');
        const interaction = rect('.map-interaction');
        const wind = rect('#wind-hud');
        document.querySelector('#camera-rotation-toggle').click();
        return form.top >= result.bottom + 8 && interaction.left >= rect('#panel').right &&
          (!wind.height || (wind.top >= rect('.camera-rotate-actions').bottom && wind.bottom <= rotation.bottom));
      })()`), 'Sidebar cards and map controls should not overlap');
      assert(await evaluate(`document.querySelector('#camera-rotation[hidden] #wind-hud') !== null`),
        'Wind belongs to the closed map options disclosure');
      checks('Wind is inside map options, below the rotation buttons');
      checks('Rotation is disclosed on demand and Simulation shows the run form');
      const clickMap = async (x, y) => {
        for (const type of ['mousePressed', 'mouseReleased']) {
          await client.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
        }
      };
      await evaluate(`document.querySelector('#map-cell-mode').click()`);
      await waitUntil(() => evaluate(`document.querySelector('#map-cell-mode').getAttribute('aria-pressed') === 'true'`),
        Boolean, { name: 'pick cell mode selected' });
      await clickMap(740, 490);
      await waitUntil(() => evaluate(`document.querySelector('.map-interaction-dock #cell-info:not([hidden]) strong')?.textContent`),
        Boolean, { name: 'compact selected cell reading is visible' });
      await evaluate(`document.querySelector('#map-pan-mode').click()`);
      await waitUntil(() => evaluate(`document.querySelector('#cell-info').hidden`), Boolean, { name: 'Pan clears cell selection' });
      checks('Picking a cell shows a compact reading and Pan clears it');
      await evaluate(`document.querySelector('[data-tool-panel="analysis"]').click()`);
      await evaluate(`document.querySelector('#analysis-transect-mode').click()`);
      await waitUntil(() => evaluate(`document.querySelector('#analysis-transect-mode').getAttribute('aria-pressed') === 'true'`),
        Boolean, { name: 'vertical section tool is active' });
      await evaluate(`document.querySelector('#transect-draw').click()`);
      await clickMap(740, 490);
      await clickMap(790, 515);
      await waitUntil(() => evaluate(`!document.querySelector('#transect-finish').disabled`),
        Boolean, { name: 'two points accepted on the map' });
      await evaluate(`document.querySelector('#transect-finish').click()`);
      await waitUntil(() => evaluate(`!document.querySelector('#transect-settings').hidden`), Boolean, { name: 'line settings are shown' });
      await evaluate(`document.querySelector('#transect-query').click()`);
      await waitUntil(() => evaluate(`Boolean(document.querySelector('#transect-result:modal'))`),
        Boolean, { name: 'server-backed vertical section is a modal' });
      await client.screenshot(join(out, 'transect-modal.png'));
      if (evidenceRun) {
        const filename = `transect-${evidenceRun}.csv`;
        await evaluate(`document.querySelector('#transect-export').click()`);
        const contents = await waitUntil(() => readFile(join(out, filename), 'utf8'),
          (text) => text.trim().split(/\r?\n/).length > 1, { name: 'Transect CSV downloaded by browser' });
        assert(contents.trim().split(/\r?\n/).slice(1).every((row) => row.startsWith(`"${evidenceRun}",`)),
          'Browser transect CSV must belong to the evidence run');
        checks('Browser downloaded a populated transect CSV for the evidence run');
      }
      await clickMap(10, 12);
      assert(await evaluate(`!document.querySelector('#transect-result:modal')`), 'Clicking the backdrop should close the modal');
      checks('Vertical section opens above the map and closes on backdrop click');
      await evaluate(`document.querySelector('#analysis-region-mode').click()`);
      await waitUntil(() => evaluate(`document.querySelector('#analysis-region-mode').getAttribute('aria-pressed') === 'true'`),
        Boolean, { name: 'region tool is active' });
      await evaluate(`document.querySelector('#region-draw').click()`);
      await clickMap(740, 490);
      await clickMap(790, 515);
      await clickMap(755, 540);
      await waitUntil(() => evaluate(`!document.querySelector('#region-finish').hidden`),
        Boolean, { name: 'three region points accepted' });
      await evaluate(`document.querySelector('#region-finish').click()`);
      await waitUntil(() => evaluate(`!document.querySelector('#region-settings').hidden`),
        Boolean, { name: 'region settings are shown' });
      await evaluate(`document.querySelector('#region-query').click()`);
      await waitUntil(() => evaluate(`Boolean(document.querySelector('#region-result:modal'))`),
        Boolean, { name: 'server-backed region result is a modal' });
      await client.screenshot(join(out, 'region-modal.png'));
      await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await waitUntil(() => evaluate(`!document.querySelector('#region-result:modal')`),
        Boolean, { name: 'region result closes on Escape' });
      checks('Region opens above the map and closes on Escape');
      await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), 'Mobile viewport has horizontal overflow');
      await evaluate(`document.querySelector('[data-tool-panel="analysis"]').click()`);
      await evaluate(`document.querySelector('#analysis-corridor-mode').click()`);
      for (const width of [390, 320]) {
        await client.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
        await waitUntil(() => evaluate(`innerWidth === ${width} &&
          [...document.querySelectorAll('.analysis-switch button')].every(button => button.clientWidth > 0 &&
            button.scrollWidth <= button.clientWidth + 1 && button.querySelector('span').getClientRects().length === 1)`),
          Boolean, { name: `Analysis controls fit at ${width}px` });
        await evaluate(`document.querySelector('.analysis-heading').scrollIntoView({block: 'start'})`);
        await client.screenshot(join(out, `analysis-${width}.png`));
      }
      checks('Analysis controls fit at 390 px and 320 px');
      await client.screenshot(join(out, 'mobile-layout.png'));
      checks('Mobile viewport fits without horizontal overflow');
      if (evidenceRun) {
        // Use browser network emulation so navigator.onLine and real network requests both change.
        await waitUntil(() => evaluate(`(async () => Boolean(navigator.serviceWorker.controller &&
          await caches.match(new URL('offline-art', location.href))))()`),
          Boolean, { name: 'Offline illustration saved by service worker' });
        const network = (offline) => client.send('Network.emulateNetworkConditions', {
          offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
        });
        const mapVisible = `Boolean(document.querySelector('#map canvas') &&
          document.querySelector('#scenario-list')?.value)`;
        const started = await evaluate('performance.timeOrigin');
        await network(true);
        await waitUntil(() => evaluate(`!navigator.onLine && !document.querySelector('#map canvas') &&
          Boolean(document.querySelector('.connection-screen__art img')?.naturalWidth) &&
          Boolean(document.querySelector('.connection-screen__loader')?.naturalWidth)`),
          Boolean, { name: 'Offline screen replaces the map and both illustrations load' });
        await client.screenshot(join(out, 'offline.png'));
        await network(false);
        await waitUntil(() => evaluate(`navigator.onLine && ${mapVisible} &&
          performance.timeOrigin === ${started} &&
          document.querySelector('#scenario-list').value === ${JSON.stringify(evidenceRun)} &&
          document.querySelector('#height-slider').value === '12'`),
          Boolean, { name: 'Map, run and height return without navigating' });
        checks('Disconnect and reconnect restore the same live document, run and height');
        originUnavailable = true;
        await client.send('Page.reload');
        await waitUntil(() => evaluate(`document.querySelector('#offline-title')?.textContent &&
          Boolean(document.querySelector('.art')?.naturalWidth) && !document.querySelector('#map canvas')`),
          Boolean, { name: 'Cached fallback after reloading offline' });
        await client.screenshot(join(out, 'offline-cached.png'));
        originUnavailable = false;
        await waitUntil(() => evaluate(`navigator.onLine && ${mapVisible}`),
          Boolean, { name: 'Cached fallback automatically reopens the map' });
        checks('After a reload while the origin is unreachable, cached artwork gives way to the map');
      }
      assert(client.exceptions.length === 0, `Viewer JS exceptions: ${JSON.stringify(client.exceptions)}`);
      report.exceptions = client.exceptions;
      report.network_failures = client.networkFailures;
      report.status = 'pass';
      return report;
    }
    await client.send('Page.navigate', { url: new URL('/legacy/', origin).href });
    await waitUntil(() => client.evaluate(`Boolean(document.querySelector('canvas') &&
      document.getElementById('scenario-list')?.options.length >= 2 &&
      !document.getElementById('height-slider').disabled &&
      document.getElementById('run-evidence')?.textContent.includes('kiểm tra đạt'))`),
    Boolean, { timeout, name: 'viewer scene and result bootstrap' });
    checks('Scene canvas and two successful runs loaded');
    await client.screenshot(join(out, 'scene-overview.png'));
    const runs = await client.evaluate(`Array.from(document.getElementById('scenario-list').options).map(o=>o.value).filter(Boolean)`);
    for (const [index, id] of runs.slice(0, 2).entries()) {
      await client.evaluate(`document.getElementById('scenario-list').value=${JSON.stringify(id)};
        document.getElementById('scenario-list').dispatchEvent(new Event('change'));`);
      await waitUntil(() => client.evaluate(`document.getElementById('run-evidence').textContent.includes(${JSON.stringify(id)}) &&
        document.getElementById('run-evidence').textContent.includes('kiểm tra đạt')`), Boolean,
      { timeout: 60_000, name: `run ${id} dashboard` });
      await client.evaluate(`document.getElementById('height-slider').value='7';
        document.getElementById('height-slider').dispatchEvent(new Event('input'));`);
      await waitUntil(() => client.evaluate(`document.getElementById('height-value').textContent.includes('15')`),
        Boolean, { name: 'height slider 15m' });
      await client.evaluate(`const mapTools=document.querySelector('[data-tool-panel="map-options"]');
        if(mapTools.getAttribute('aria-expanded')!=='true') mapTools.click();
        const info=document.querySelector('[data-disclosure="result-info-content"]');
        if(info.getAttribute('aria-expanded')!=='true') info.click();
        document.getElementById('run-evidence').scrollIntoView({block:'center'});`);
      await client.screenshot(join(out, `run-${index + 1}-evidence.png`));
      checks(`Run ${id}: exact evidence and 15m layer`);
    }
    await client.evaluate(`document.querySelector('[data-tool-panel="analysis-details"]').click();
      document.querySelector('[data-disclosure="cell-picker-content"]').click();
      document.getElementById('cell-i').value='0';
      document.getElementById('cell-j').value='0';
      document.getElementById('cell-picker-form').dispatchEvent(new Event('submit',{cancelable:true}));`);
    await waitUntil(() => client.evaluate(`!document.getElementById('cell-info').hidden &&
      Boolean(queryCache.get('profile:'+state.scenario+':0:0')?.levels.length===50) &&
      !document.getElementById('cell-info').textContent.includes('Đang truy vấn')`), Boolean,
      { name: 'selected cell exact profile response' });
    checks('Coordinate picker loads exact profile');
    await client.screenshot(join(out, 'selected-cell.png'));
    await client.evaluate(`document.getElementById('toggle-3d').click()`);
    await waitUntil(() => client.evaluate(`document.getElementById('toggle-3d').getAttribute('aria-pressed')==='false'`),
      Boolean, { name: '2D camera toggle' });
    checks('Camera switches to 2D');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await client.screenshot(join(out, 'mobile-layout.png'));
    checks('Mobile viewport screenshot captured (not an FPS benchmark)');
    assert(client.exceptions.length === 0, `Viewer JS exceptions: ${JSON.stringify(client.exceptions)}`);
    report.runs = runs;
    report.exceptions = client.exceptions;
    report.network_failures = client.networkFailures;
    report.status = 'pass';
    return report;
  } catch (error) {
    report.status = 'fail';
    report.error = error.message;
    if (client) {
      report.exceptions = client.exceptions;
      report.network_failures = client.networkFailures;
      await client.screenshot(join(out, 'failure.png')).catch(() => {});
      report.page_text = await client.evaluate('document.body.innerText').catch(() => '');
    }
    throw error;
  } finally {
    client?.socket.close();
    child.kill();
    proxy?.close();
    proxy?.closeAllConnections();
    await writeFile(join(out, 'chrome.log'), stderr);
    await writeJson(join(out, 'browser-report.json'), report);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    base: { type: 'string', default: 'http://127.0.0.1:3001' },
    out: { type: 'string', default: 'artifacts/week7/browser' },
    legacy: { type: 'boolean', default: false },
    'evidence-run': { type: 'string' },
  } });
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  browserSmoke({ base: values.base, out: resolve(root, values.out), legacy: values.legacy,
    evidenceRun: values['evidence-run'] })
    .then((report) => console.log(`Browser ${report.status}: ${report.checks.length} checks`))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
