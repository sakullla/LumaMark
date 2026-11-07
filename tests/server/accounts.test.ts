import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const cliPath = join(root, 'apps/server/cli.mjs');
const serverPath = join(root, 'apps/server/server.mjs');
const children = new Set<ChildProcess>();
const directories: string[] = [];

interface LoginBody {
  username?: string;
  token?: string;
  error?: string;
}

interface ManifestBody {
  format?: string;
  bookmarks?: { title?: string; url?: string; notes?: string; html?: string }[];
  collections?: unknown[];
  searchUrl?: string;
  theme?: string;
  purged?: string[];
}

afterEach(async () => {
  await Promise.all([...children].map((child) => stopProcess(child)));
  children.clear();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('account server', () => {
  it('keeps the account and bookmark after the data directory is reopened', async () => {
    const dataDir = await makeDir();
    await createAccount(dataDir, 'ada', 'correct-horse');
    const first = await startServer(dataDir);
    const loggedIn = await login(first.url, 'ada', 'correct-horse');
    expect(loggedIn.response.status).toBe(200);
    expect(loggedIn.body.token).toEqual(expect.any(String));
    expect(loggedIn.response.headers.get('set-cookie')).toMatch(/lumamark_session=.+; HttpOnly/i);

    const before = await getManifest(first.url, loggedIn.body.token ?? '');
    expect(before.response.status).toBe(200);
    expect(before.etag).toMatch(/^"[0-9a-f]{64}"$/);
    const write = await putManifest(first.url, loggedIn.body.token ?? '', manifestOf([bookmark('Kept')]), before.etag ?? undefined);
    expect(write.response.status).toBe(200);

    await stopProcess(first.child);
    const second = await startServer(dataDir);
    const again = await login(second.url, 'ada', 'correct-horse');
    expect(again.response.status).toBe(200);
    const loaded = await getManifest(second.url, again.body.token ?? '');
    expect(loaded.body.bookmarks).toEqual([expect.objectContaining({ title: 'Kept', url: 'https://example.com/Kept' })]);
    const accounts = await readFile(join(dataDir, 'accounts.json'), 'utf8');
    expect(accounts).toContain('"algorithm":"scrypt"');
    expect(accounts).not.toContain('correct-horse');
  }, 30000);

  it('does not create a session for a wrong password', async () => {
    const dataDir = await makeDir();
    await createAccount(dataDir, 'ada', 'correct-horse');
    const server = await startServer(dataDir);
    const good = await login(server.url, 'ada', 'correct-horse');
    const before = await getManifest(server.url, good.body.token ?? '');
    const saved = await putManifest(server.url, good.body.token ?? '', manifestOf([bookmark('Stable')]), before.etag ?? undefined);
    expect(saved.response.status).toBe(200);

    const wrong = await login(server.url, 'ada', 'wrong-password');
    expect(wrong.response.status).toBe(401);
    expect(wrong.body).toEqual({ error: 'unauthorized' });
    expect(wrong.body.token).toBeUndefined();
    expect(wrong.response.headers.get('set-cookie')).toBeNull();
    const anonymous = await fetch(`${server.url}/api/manifest`);
    expect(anonymous.status).toBe(401);
    const missing = await login(server.url, 'nobody', 'correct-horse');
    expect(missing.response.status).toBe(401);
    expect(missing.response.headers.get('set-cookie')).toBeNull();

    const cookie = good.response.headers.get('set-cookie')?.split(';')[0] ?? '';
    const withCookie = await fetch(`${server.url}/api/manifest`, { headers: { Cookie: cookie } });
    expect(withCookie.status).toBe(200);
    const after = await getManifest(server.url, good.body.token ?? '');
    expect(after.body.bookmarks).toEqual([expect.objectContaining({ title: 'Stable' })]);
  }, 30000);

  it('keeps one account session from reading or changing another account', async () => {
    const dataDir = await makeDir();
    await createAccount(dataDir, 'ada', 'ada-password');
    await createAccount(dataDir, 'bea', 'bea-password');
    const server = await startServer(dataDir);
    const ada = await login(server.url, 'ada', 'ada-password');
    const bea = await login(server.url, 'bea', 'bea-password');
    const adaInitial = await getManifest(server.url, ada.body.token ?? '');
    const beaInitial = await getManifest(server.url, bea.body.token ?? '');
    expect((await putManifest(server.url, ada.body.token ?? '', manifestOf([bookmark('Only Ada')]), adaInitial.etag ?? undefined)).response.status).toBe(200);
    expect((await putManifest(server.url, bea.body.token ?? '', manifestOf([bookmark('Only Bea')]), beaInitial.etag ?? undefined)).response.status).toBe(200);

    const adaLoaded = await getManifest(server.url, ada.body.token ?? '');
    const beaLoaded = await getManifest(server.url, bea.body.token ?? '');
    expect(adaLoaded.body.bookmarks?.map((item) => item.title)).toEqual(['Only Ada']);
    expect(beaLoaded.body.bookmarks?.map((item) => item.title)).toEqual(['Only Bea']);
    const stale = await putManifest(server.url, bea.body.token ?? '', manifestOf([bookmark('Only Ada')]), adaInitial.etag ?? undefined);
    expect(stale.response.status).toBe(412);
    const adaAfter = await getManifest(server.url, ada.body.token ?? '');
    expect(adaAfter.body.bookmarks?.map((item) => item.title)).toEqual(['Only Ada']);
  }, 30000);

  it('has no registration route on the page or the HTTP API', async () => {
    const dataDir = await makeDir();
    const server = await startServer(dataDir);
    const page = await fetch(server.url);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    const html = await page.text();
    expect(html).toContain('不能注册');
    expect(html).toContain('>登录<');
    expect(html).not.toContain('/api/register');
    expect(html).not.toContain('/api/signup');
    expect(html).not.toContain('/api/accounts');
    expect(html).not.toMatch(/<button[^>]*>\s*注册\s*<\/button>/);

    for (const path of ['/api/register', '/api/signup', '/api/accounts', '/register', '/signup', '/api/users']) {
      const created = await fetch(`${server.url}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'intruder', password: 'intruder-pass' }),
      });
      expect(created.status).toBe(404);
      const read = await fetch(`${server.url}${path}`);
      expect(read.status).toBe(404);
    }
    const disguised = await fetch(`${server.url}/api/session?register=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'intruder', password: 'intruder-pass', register: true }),
    });
    expect(disguised.status).toBe(401);
    expect((await disguised.json() as LoginBody).token).toBeUndefined();
    expect((await login(server.url, 'intruder', 'intruder-pass')).response.status).toBe(401);
  }, 30000);

  it('rejects a manifest write that does not name the current etag', async () => {
    const dataDir = await makeDir();
    await createAccount(dataDir, 'ada', 'correct-horse');
    const server = await startServer(dataDir);
    const loggedIn = await login(server.url, 'ada', 'correct-horse');
    const token = loggedIn.body.token ?? '';
    const current = await getManifest(server.url, token);
    const blind = await putManifest(server.url, token, manifestOf([bookmark('Blind')]));
    expect(blind.response.status).toBe(428);
    const starred = await putManifest(server.url, token, manifestOf([bookmark('Star')]), '*');
    expect(starred.response.status).toBe(412);
    const mismatch = await putManifest(server.url, token, manifestOf([bookmark('Other')]), '"not-the-current-version"');
    expect(mismatch.response.status).toBe(412);
    const unchanged = await getManifest(server.url, token);
    expect(unchanged.etag).toBe(current.etag);
    expect(unchanged.body.bookmarks).toEqual([]);

    const noisy = manifestOf([bookmark('Kept', 'keep-me')]);
    noisy.searchUrl = 'https://search.example/?q=%s';
    noisy.theme = 'dark';
    noisy.bookmarks[0].html = '<p>page body</p>';
    const written = await putManifest(server.url, token, noisy, current.etag ?? undefined);
    expect(written.response.status).toBe(200);
    const stored = await getManifest(server.url, token);
    expect(stored.body.searchUrl).toBeUndefined();
    expect(stored.body.theme).toBeUndefined();
    expect(stored.body.bookmarks).toEqual([expect.objectContaining({ title: 'Kept', notes: 'keep-me' })]);
    expect(stored.body.bookmarks?.[0].html).toBeUndefined();
    expect(JSON.stringify(stored.body)).not.toContain('page body');
    expect(JSON.stringify(stored.body)).not.toContain('search.example');
  }, 30000);
});

interface WrittenBookmark {
  id: string;
  url: string;
  title: string;
  domain: string;
  notes: string;
  tags: string[];
  position: number;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  revision: number;
  html?: string;
}

interface WrittenManifest {
  format: string;
  schemaVersion: number;
  generatedAt: string;
  deviceId: string;
  bookmarks: WrittenBookmark[];
  collections: unknown[];
  searchUrl?: string;
  theme?: string;
}

function bookmark(title: string, notes = ''): WrittenBookmark {
  return {
    id: title.toLowerCase().replace(/\s+/g, '-'),
    url: `https://example.com/${encodeURIComponent(title)}`,
    title,
    domain: 'example.com',
    notes,
    tags: [],
    position: 0,
    favorite: false,
    createdAt: '2026-11-07T00:00:00.000Z',
    updatedAt: '2026-11-07T00:00:00.000Z',
    revision: 1,
  };
}

function manifestOf(bookmarks: WrittenBookmark[]): WrittenManifest {
  return {
    format: 'lumamark-sync',
    schemaVersion: 2,
    generatedAt: '2026-11-07T00:00:00.000Z',
    deviceId: 'test',
    bookmarks,
    collections: [],
  };
}

async function makeDir() {
  const dir = await mkdtemp(join(tmpdir(), 'lumamark-server-'));
  directories.push(dir);
  return dir;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function createAccount(dataDir: string, username: string, password: string) {
  const result = await run(process.execPath, [cliPath, 'create-account', '--data', dataDir, '--username', username, '--password', password], process.env);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || 'create-account failed');
}

async function startServer(dataDir: string) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: root,
    env: { ...process.env, LUMAMARK_DATA: dataDir, HOST: '127.0.0.1', PORT: '0' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stdout = '';
  let stderr = '';
  const url = await new Promise<string>((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not listen\n${stderr}`)), 10000);
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      const match = stdout.match(/listening (http:\/\/127\.0\.0\.1:\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolveUrl(match[1]);
    });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}\n${stderr}\n${stdout}`));
    });
  });
  return { child, url };
}

function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolveStop) => {
    const timer = setTimeout(() => {
      child.kill();
      resolveStop();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveStop();
    });
    child.kill();
  });
}

async function login(url: string, username: string, password: string) {
  const response = await fetch(`${url}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json() as LoginBody;
  return { response, body };
}

async function getManifest(url: string, token: string) {
  const response = await fetch(`${url}/api/manifest`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const body = await response.json() as ManifestBody;
  return { response, body, etag: response.headers.get('etag') };
}

async function putManifest(url: string, token: string, body: unknown, etag?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (etag !== undefined) headers['If-Match'] = etag;
  const response = await fetch(`${url}/api/manifest`, { method: 'PUT', headers, body: JSON.stringify(body) });
  const text = await response.text();
  return { response, text };
}
