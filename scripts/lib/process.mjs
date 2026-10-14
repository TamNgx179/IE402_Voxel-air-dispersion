import { spawn } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}

export async function command(executable, args, options = {}) {
  const { cwd, env, log, timeout = 600_000, allowFailure = false } = options;
  const child = spawn(executable, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const chunks = [];
  child.stdout.on('data', (chunk) => { stdout += chunk; chunks.push(chunk); });
  child.stderr.on('data', (chunk) => { stderr += chunk; chunks.push(chunk); });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  }).finally(() => clearTimeout(timer));
  if (log) {
    await mkdir(dirname(log), { recursive: true });
    await appendFile(log, Buffer.concat(chunks));
  }
  if (timedOut) throw new Error(`${executable} exceeded ${timeout / 1000}s; inspect ${log || 'command log'}`);
  if (!allowFailure && result.code !== 0) {
    throw new Error(`${executable} ${args[0] || ''} exited ${result.code}: ${stderr.slice(-3000)}`);
  }
  return result;
}

export async function waitUntil(read, accept, options = {}) {
  const { timeout = 120_000, interval = 1000, name = 'condition', onProgress } = options;
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = await read();
      if (accept(value)) return value;
      onProgress?.(value);
    } catch (error) {
      lastError = error;
    }
    await delay(interval);
  }
  throw new Error(`Timed out waiting for ${name}${lastError ? `: ${lastError.message}` : ''}`);
}

export async function request(base, path, options = {}) {
  const { expected = 200, method = 'GET', body, timeout = 30_000 } = options;
  const response = await fetch(new URL(path, base), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  assert(response.status === expected, `${method} ${path}: HTTP ${response.status}, expected ${expected}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export function numericClose(actual, expected, name, relative = 1e-5, absolute = 1e-9) {
  assert(Number.isFinite(actual) && Number.isFinite(expected), `${name}: expected finite numbers`);
  assert(Math.abs(actual - expected) <= Math.max(absolute, Math.abs(expected) * relative),
    `${name}: ${actual} differs from ${expected}`);
}
