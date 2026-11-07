import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const image = 'lumamark-server:verify';
const username = 'verifier';
const password = 'verify-password';
const bookmarkTitle = 'docker-restart-bookmark';

function run(command, args) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolveRun(result);
    };
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish({ code: 127, stdout, stderr: `${stderr}${error.message}` }));
    child.on('exit', (code) => finish({ code: code ?? 1, stdout, stderr }));
  });
}

function tail(result) {
  return `${result.stderr}\n${result.stdout}`.trim().slice(-4000);
}

async function runChecked(command, args) {
  const result = await run(command, args);
  if (result.code !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.code})\n${tail(result)}`);
  return result;
}

async function dockerReady() {
  const result = await run('docker', ['info', '-f', '{{.ServerVersion}}']);
  return result.code === 0 && result.stdout.trim().length > 0;
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForOk(url) {
  const deadline = Date.now() + 60000;
  let last = 'not started';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`timed out waiting for ${url}: ${last}`);
}

function bookmarkManifest() {
  return {
    format: 'lumamark-sync',
    schemaVersion: 2,
    generatedAt: '2026-11-07T00:00:00.000Z',
    deviceId: 'docker-verify',
    bookmarks: [{
      id: 'docker-restart-bookmark',
      url: 'https://example.com/docker-restart',
      title: bookmarkTitle,
      domain: 'example.com',
      notes: '',
      tags: [],
      position: 0,
      favorite: false,
      createdAt: '2026-11-07T00:00:00.000Z',
      updatedAt: '2026-11-07T00:00:00.000Z',
      revision: 1,
    }],
    collections: [],
  };
}

async function login(base) {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json();
  if (!response.ok || !body.token) throw new Error(`login failed (${response.status})`);
  return body.token;
}

async function verifyContainer(base) {
  const token = await login(base);
  const current = await fetch(`${base}/api/manifest`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!current.ok) throw new Error(`manifest read failed (${current.status})`);
  const etag = current.headers.get('etag');
  if (!etag) throw new Error('manifest response did not include an etag');
  const write = await fetch(`${base}/api/manifest`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': etag },
    body: JSON.stringify(bookmarkManifest()),
  });
  if (!write.ok) throw new Error(`manifest write failed (${write.status}) ${await write.text()}`);

  await runChecked('docker', ['restart', containerName]);
  await waitForOk(`${base}/`);
  const restarted = await login(base);
  const loaded = await fetch(`${base}/api/manifest`, { headers: { Authorization: `Bearer ${restarted}` }, cache: 'no-store' });
  if (!loaded.ok) throw new Error(`manifest read after restart failed (${loaded.status})`);
  const manifest = await loaded.json();
  const found = Array.isArray(manifest.bookmarks) && manifest.bookmarks.some((item) => item.title === bookmarkTitle && item.url === 'https://example.com/docker-restart');
  if (!found) throw new Error('bookmark was not present after the container restarted');
}

let containerName = '';
let dataDir = '';

if (!(await dockerReady())) {
  console.log('Docker is not available; skipped server container verification.');
} else {
  try {
    containerName = `lumamark-server-verify-${Date.now()}`;
    dataDir = await mkdtemp(join(tmpdir(), 'lumamark-docker-'));
    const port = await freePort();
    await runChecked('docker', ['build', '-t', image, root]);
    await runChecked('docker', ['run', '-d', '--name', containerName, '-p', `${port}:8787`, '-v', `${dataDir}:/data`, '-e', 'LUMAMARK_DATA=/data', image]);
    const base = `http://127.0.0.1:${port}`;
    await waitForOk(`${base}/`);
    await runChecked('docker', ['exec', '-e', `LUMAMARK_PASSWORD=${password}`, '-e', 'LUMAMARK_DATA=/data', containerName, 'node', 'apps/server/cli.mjs', 'create-account', '--username', username]);
    await verifyContainer(base);
    console.log('Verified: the account bookmark is still present after a container restart.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    if (containerName) await run('docker', ['rm', '-f', containerName]);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  }
}
