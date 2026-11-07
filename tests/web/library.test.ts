import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { makeBookmark } from '../../packages/domain/src/index';
import { exportLumaMarkJson, parseBookmarksHtml, parseLumaMarkJson } from '../../packages/import-export/src/index';
import type { SyncManifest } from '../../packages/sync/src/index';
import { bindWebApp, createWebApp, type PageEvent, type PageRoot, type WebApp } from '../../apps/web/src/app';
import { startWebApp } from '../../apps/web/src/main';

const root = fileURLToPath(new URL('../..', import.meta.url));
const password = 'correct-horse';

interface StoredBookmark {
  id: string;
  title: string;
  url: string;
  notes?: string;
  tags?: string[];
  favorite?: boolean;
  collectionId?: string;
  deletedAt?: string;
  domain?: string;
}

interface StoredManifest {
  bookmarks: StoredBookmark[];
  collections: Array<{ id: string; name: string }>;
  purged?: string[];
}

class MemoryAccounts {
  putAttempts = 0;
  offline = false;
  failNextWrite: number | undefined;
  private readonly sessions = new Map<string, string>();
  private readonly accounts = new Map<string, { password: string; manifest: SyncManifest; etag: string }>();
  private version = 1;

  constructor(users: readonly string[]) {
    for (const username of users) {
      this.accounts.set(username, { password, manifest: emptyManifest(), etag: this.nextEtag() });
    }
  }

  owner(token: string | undefined): string | undefined {
    return token ? this.sessions.get(token) : undefined;
  }

  manifest(username: string): StoredManifest {
    const account = this.accounts.get(username);
    if (!account) throw new Error(`missing ${username}`);
    return JSON.parse(JSON.stringify(account.manifest)) as StoredManifest;
  }

  replaceManifest(username: string, manifest: SyncManifest): void {
    const account = this.accounts.get(username);
    if (!account) throw new Error(`missing ${username}`);
    account.manifest = JSON.parse(JSON.stringify(manifest)) as SyncManifest;
    account.etag = this.nextEtag();
  }

  readonly fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    if (this.offline) throw new Error('offline');
    const path = new URL(input, 'http://library.test').pathname;
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const token = /^Bearer\s+(\S+)$/i.exec(headers.get('authorization') ?? '')?.[1];
    if (method === 'POST' && path === '/api/session') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { username?: string; password?: string };
      const account = body.username ? this.accounts.get(body.username) : undefined;
      if (!account || body.password !== account.password || !body.username) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      const session = `session-${crypto.randomUUID()}`;
      this.sessions.set(session, body.username);
      return Response.json({ username: body.username, token: session }, { status: 200 });
    }
    if (method === 'DELETE' && path === '/api/session') {
      if (token) this.sessions.delete(token);
      return new Response(null, { status: 204 });
    }
    const username = token ? this.sessions.get(token) : undefined;
    const account = username ? this.accounts.get(username) : undefined;
    if (!account) return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (method === 'GET' && path === '/api/manifest') {
      return Response.json(account.manifest, { status: 200, headers: { ETag: account.etag } });
    }
    if (method === 'PUT' && path === '/api/manifest') {
      this.putAttempts += 1;
      if (this.failNextWrite) {
        const status = this.failNextWrite;
        this.failNextWrite = undefined;
        return Response.json({ error: 'internal_error' }, { status });
      }
      const ifMatch = headers.get('if-match');
      if (!ifMatch) return Response.json({ error: 'precondition_required' }, { status: 428 });
      if (ifMatch !== account.etag) return Response.json({ error: 'conflict' }, { status: 412 });
      account.manifest = JSON.parse(String(init?.body ?? '{}')) as SyncManifest;
      account.etag = this.nextEtag();
      return Response.json({ etag: account.etag }, { status: 200, headers: { ETag: account.etag } });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  };

  private nextEtag(): string {
    const etag = `"${this.version}"`;
    this.version += 1;
    return etag;
  }
}

function emptyManifest(): SyncManifest {
  return {
    format: 'lumamark-sync',
    schemaVersion: 2,
    generatedAt: '2026-11-07T00:00:00.000Z',
    deviceId: 'lumamark-server',
    bookmarks: [],
    collections: [],
  };
}

function appFor(server: MemoryAccounts): WebApp {
  return createWebApp({ fetchImpl: server.fetch });
}

function titles(server: MemoryAccounts, username: string): string[] {
  return server.manifest(username).bookmarks.map((bookmark) => bookmark.title);
}

describe('web bookmark library', () => {
  it('adds, finds, edits, exports, and keeps a failed write off the account', async () => {
    const server = new MemoryAccounts(['甲']);
    const app = appFor(server);
    await app.login('甲', password);
    expect(app.render()).toContain('这个账号还没有书签');
    expect(app.render()).toContain('新增书签');
    expect(app.render()).toContain('>标题 <');
    expect(app.render()).toContain('>网址 <');
    expect(app.render()).toContain('>文件夹 <');
    expect(app.render()).toContain('>标签 <');
    expect(app.render()).toContain('>备注 <');
    expect(app.render()).toContain('>收藏 <');

    await app.addBookmark({
      title: '星标阅读',
      url: 'https://example.com/read',
      folder: '资料',
      tags: ['阅读', '稍后'],
      notes: '周末看',
      favorite: true,
    });
    await app.addBookmark({ title: '普通页面', url: 'https://example.com/plain' });
    const stored = server.manifest('甲').bookmarks.find((bookmark) => bookmark.title === '星标阅读');
    expect(stored).toMatchObject({
      url: 'https://example.com/read',
      notes: '周末看',
      tags: ['稍后', '阅读'],
      favorite: true,
      domain: 'example.com',
    });
    expect(server.manifest('甲').collections.map((collection) => collection.name)).toEqual(['资料']);
    expect(stored?.collectionId).toBe(server.manifest('甲').collections[0].id);
    app.search('星标');
    expect(app.visibleBookmarks().map((bookmark) => bookmark.title)).toEqual(['星标阅读']);
    app.search('');
    app.setFavoritesOnly(true);
    expect(app.visibleBookmarks().map((bookmark) => bookmark.title)).toEqual(['星标阅读']);
    const attempts = server.putAttempts;
    expect(app.exportJson()).toContain('星标阅读');
    expect(parseLumaMarkJson(app.exportJson()).bookmarks.some((bookmark) => bookmark.title === '星标阅读' && bookmark.notes === '周末看')).toBe(true);
    expect(app.exportHtml()).toContain('星标阅读');
    expect(parseBookmarksHtml(app.exportHtml()).bookmarks.some((bookmark) => bookmark.title === '星标阅读')).toBe(true);
    expect(server.putAttempts).toBe(attempts);

    app.setFavoritesOnly(false);
    await app.updateBookmark(stored?.id ?? '', {
      title: '新标题',
      url: 'https://example.com/next',
      folder: '新文件夹',
      tags: ['改过'],
      notes: '新备注',
      favorite: false,
    });
    expect(server.manifest('甲').bookmarks.find((bookmark) => bookmark.id === stored?.id)).toMatchObject({
      title: '新标题',
      url: 'https://example.com/next',
      domain: 'example.com',
      notes: '新备注',
      tags: ['改过'],
      favorite: false,
    });
    expect(server.manifest('甲').collections.map((collection) => collection.name)).toContain('新文件夹');

    server.failNextWrite = 500;
    await expect(app.updateBookmark(stored?.id ?? '', { title: '失败标题' })).rejects.toThrow(/没有保存成/);
    expect(server.manifest('甲').bookmarks.find((bookmark) => bookmark.id === stored?.id)?.title).toBe('新标题');
    expect(app.render()).toContain('新标题');
    expect(app.render()).toContain('账号保持原样');
    expect(app.render()).not.toContain('失败标题');
  });

  it('moves a bookmark through trash and refuses restore after emptying it', async () => {
    const server = new MemoryAccounts(['甲']);
    const app = appFor(server);
    await app.login('甲', password);
    await app.addBookmark({ title: '留下', url: 'https://example.com/keep', folder: '资料' });
    await app.addBookmark({ title: '丢掉', url: 'https://example.com/drop', folder: '资料' });
    const drop = server.manifest('甲').bookmarks.find((bookmark) => bookmark.title === '丢掉');
    expect(drop?.collectionId).toBeTruthy();
    await app.deleteBookmark(drop?.id ?? '');
    const trashed = server.manifest('甲').bookmarks.find((bookmark) => bookmark.id === drop?.id);
    expect(trashed?.deletedAt).toEqual(expect.any(String));
    expect(trashed?.collectionId).toBe(drop?.collectionId);
    expect(app.visibleBookmarks().map((bookmark) => bookmark.title)).not.toContain('丢掉');
    app.showTrash(true);
    expect(app.visibleBookmarks().map((bookmark) => bookmark.title)).toEqual(['丢掉']);
    expect(app.render()).toContain('恢复');
    expect(app.render()).toContain('清空回收站');
    await app.restoreBookmark(drop?.id ?? '');
    const restored = server.manifest('甲').bookmarks.find((bookmark) => bookmark.id === drop?.id);
    expect(restored?.deletedAt).toBeUndefined();
    expect(restored?.collectionId).toBe(drop?.collectionId);
    app.showTrash(false);
    expect(app.visibleBookmarks().map((bookmark) => bookmark.title)).toContain('丢掉');
    await app.deleteBookmark(drop?.id ?? '');
    await app.emptyTrash();
    expect(server.manifest('甲').purged).toContain(drop?.id);
    expect(server.manifest('甲').bookmarks.map((bookmark) => bookmark.title)).toEqual(['留下']);
    const attempts = server.putAttempts;
    await expect(app.restoreBookmark(drop?.id ?? '')).rejects.toThrow(/不能再恢复/);
    expect(server.putAttempts).toBe(attempts);
    expect(server.manifest('甲').purged).toContain(drop?.id);
  });

  it('imports HTML and JSON, and leaves the account unchanged until a duplicate choice', async () => {
    const server = new MemoryAccounts(['甲']);
    const app = appFor(server);
    await app.login('甲', password);
    const json = exportLumaMarkJson([makeBookmark({
      url: 'https://example.com/json',
      title: 'JSON书签',
      notes: '来自备份',
      tags: ['备份'],
      favorite: true,
    })], []);
    expect(await app.beginImport(json, 'json')).toBe('applied');
    expect(server.manifest('甲').bookmarks.find((bookmark) => bookmark.title === 'JSON书签')).toMatchObject({
      url: 'https://example.com/json',
      notes: '来自备份',
      favorite: true,
    });
    expect(await app.beginImport('<DL><p><DT><H3>资料</H3><DL><p><DT><A HREF="https://example.com/imported-html">导入的网页书签</A></DL></DL>', 'html')).toBe('applied');
    expect(titles(server, '甲')).toContain('导入的网页书签');
    expect(server.manifest('甲').collections.map((collection) => collection.name)).toContain('资料');

    const attempts = server.putAttempts;
    expect(await app.beginImport('{', 'json')).toBe('rejected');
    expect(server.putAttempts).toBe(attempts);
    expect(app.render()).toContain('账号保持不变');

    await app.addBookmark({ title: '已有', url: 'https://example.com/same', notes: '原来的备注' });
    const held = server.putAttempts;
    expect(await app.beginImport('<DL><p><DT><A HREF="https://example.com/same">另一标题</A></DL>', 'html')).toBe('awaiting-choice');
    expect(server.putAttempts).toBe(held);
    expect(server.manifest('甲').bookmarks.filter((bookmark) => bookmark.url === 'https://example.com/same')).toEqual([
      expect.objectContaining({ title: '已有', notes: '原来的备注' }),
    ]);
    const page = app.render();
    expect(page).toContain('尚未选择重复项处理方式，账号保持不变。');
    expect(page).toContain('跳过重复');
    expect(page).toContain('更新已有记录');
    expect(page).toContain('另存一份');
    expect(page).not.toContain('另一标题');
    app.cancelImport();
    expect(server.putAttempts).toBe(held);
    expect(app.snapshot().mode).toBe('library');
  });

  it('applies skip, update, and copy only after that choice', async () => {
    const html = '<DL><p><DT><A HREF="https://example.com/same">另一标题</A></DL>';
    const skip = new MemoryAccounts(['甲']);
    const skipApp = appFor(skip);
    await skipApp.login('甲', password);
    await skipApp.addBookmark({ title: '已有', url: 'https://example.com/same' });
    const skipAttempts = skip.putAttempts;
    await skipApp.beginImport(html, 'html');
    await skipApp.chooseImport('skip');
    expect(skip.putAttempts).toBe(skipAttempts);
    expect(titles(skip, '甲')).toEqual(['已有']);

    const update = new MemoryAccounts(['甲']);
    const updateApp = appFor(update);
    await updateApp.login('甲', password);
    await updateApp.addBookmark({ title: '已有', url: 'https://example.com/same' });
    await updateApp.beginImport(html, 'html');
    await updateApp.chooseImport('update');
    expect(titles(update, '甲')).toEqual(['另一标题']);

    const copy = new MemoryAccounts(['甲']);
    const copyApp = appFor(copy);
    await copyApp.login('甲', password);
    await copyApp.addBookmark({ title: '已有', url: 'https://example.com/same' });
    await copyApp.beginImport(html, 'html');
    await copyApp.chooseImport('copy');
    expect(titles(copy, '甲').sort()).toEqual(['另一标题', '已有']);
  });

  it('shows both titles after a 412 and writes the chosen one', async () => {
    const server = new MemoryAccounts(['甲']);
    const app = appFor(server);
    await app.login('甲', password);
    await app.addBookmark({ title: '原标题', url: 'https://example.com/conflict' });
    const current = server.manifest('甲');
    current.bookmarks[0].title = '服务标题';
    server.replaceManifest('甲', current as SyncManifest);
    await app.updateBookmark(current.bookmarks[0].id, { title: '网页标题' });
    expect(server.manifest('甲').bookmarks[0].title).toBe('服务标题');
    const html = app.render();
    expect(html).toContain('<p data-title-source="local">网页标题</p>');
    expect(html).toContain('<p data-title-source="remote">服务标题</p>');
    expect(app.snapshot().mode).toBe('conflict');
    await app.chooseConflict(current.bookmarks[0].id, 'local');
    expect(server.manifest('甲').bookmarks[0].title).toBe('网页标题');
    expect(JSON.stringify(server.manifest('甲'))).not.toContain('服务标题');

    const remote = new MemoryAccounts(['甲']);
    const other = appFor(remote);
    await other.login('甲', password);
    await other.addBookmark({ title: '原标题', url: 'https://example.com/conflict' });
    const stored = remote.manifest('甲');
    stored.bookmarks[0].title = '服务标题';
    remote.replaceManifest('甲', stored as SyncManifest);
    await other.updateBookmark(stored.bookmarks[0].id, { title: '网页标题' });
    await other.chooseConflict(stored.bookmarks[0].id, 'remote');
    expect(remote.manifest('甲').bookmarks[0].title).toBe('服务标题');
    expect(JSON.stringify(remote.manifest('甲'))).not.toContain('网页标题');
  });

  it('waits for a choice when a 412 changes notes or favorite but not the title', async () => {
    const server = new MemoryAccounts(['甲']);
    const app = appFor(server);
    await app.login('甲', password);
    await app.addBookmark({ title: '同一标题', url: 'https://example.com/same-title', notes: '原来的备注', favorite: false });
    const current = server.manifest('甲');
    current.bookmarks[0].notes = '服务备注';
    current.bookmarks[0].favorite = true;
    server.replaceManifest('甲', current as SyncManifest);
    const attempts = server.putAttempts;
    await app.updateBookmark(current.bookmarks[0].id, { notes: '网页新备注' });
    expect(server.putAttempts).toBe(attempts + 1);
    expect(server.manifest('甲').bookmarks[0]).toMatchObject({ title: '同一标题', notes: '服务备注', favorite: true });
    expect(app.snapshot().mode).toBe('conflict');
    const html = app.render();
    expect(html).toContain('选择完成前不会写回账号');
    expect(html).toContain('<p data-title-source="local">同一标题</p>');
    expect(html).toContain('<p data-title-source="remote">同一标题</p>');
    expect(html).toContain('<p data-field="notes" data-side="local">网页新备注</p>');
    expect(html).toContain('<p data-field="notes" data-side="remote">服务备注</p>');
    expect(html).toContain('<p data-field="favorite" data-side="local">未收藏</p>');
    expect(html).toContain('<p data-field="favorite" data-side="remote">已收藏</p>');
    expect(html).toContain('保留网页版本');
    expect(html).toContain('保留服务版本');
    expect(html).toContain('合并两边');
    await app.chooseConflict(current.bookmarks[0].id, 'merged', { notes: '合并备注' });
    expect(server.putAttempts).toBe(attempts + 2);
    expect(server.manifest('甲').bookmarks[0]).toMatchObject({ title: '同一标题', notes: '合并备注', favorite: false });
  });

  it('keeps a failed login offline state from looking like an empty library', async () => {
    const server = new MemoryAccounts(['甲']);
    const app = appFor(server);
    await expect(app.login('甲', 'wrong-password')).rejects.toThrow(/登录信息不正确/);
    expect(app.snapshot().mode).toBe('login');
    expect(app.sessionToken()).toBeUndefined();
    expect(app.render()).toContain('登录信息不正确，没有进入账号。');
    expect(app.render()).not.toContain('这个账号还没有书签');
    expect(server.owner(undefined)).toBeUndefined();

    server.offline = true;
    await expect(app.login('甲', password)).rejects.toThrow(/连不上服务/);
    expect(app.snapshot().mode).toBe('offline');
    expect(app.render()).toContain('连不上服务，没有显示书签库。');
    expect(app.render()).not.toContain('这个账号还没有书签');
    expect(app.render()).not.toContain('id="bookmarks"');
  });

  it('switches only the web session and does not touch browser bookmarks', async () => {
    const server = new MemoryAccounts(['甲', '乙']);
    const extension = appFor(server);
    const web = appFor(server);
    const calls: string[] = [];
    const browserApi = {
      bookmarks: new Proxy({}, { get: () => () => { calls.push('bookmarks'); } }),
      commands: new Proxy({}, { get: () => () => { calls.push('commands'); } }),
      contextMenus: new Proxy({}, { get: () => () => { calls.push('contextMenus'); } }),
    };
    const globalRef = globalThis as { chrome?: unknown; browser?: unknown };
    globalRef.chrome = browserApi;
    globalRef.browser = browserApi;
    try {
      await extension.login('甲', password);
      await extension.addBookmark({ title: '甲的书签', url: 'https://example.com/jia' });
      await web.login('甲', password);
      await web.login('乙', password);
      expect(web.snapshot().username).toBe('乙');
      expect(web.render()).toContain('这个账号还没有书签');
      expect(web.render()).not.toContain('甲的书签');
      expect(extension.snapshot().username).toBe('甲');
      expect(server.owner(extension.sessionToken())).toBe('甲');
      expect(server.owner(web.sessionToken())).toBe('乙');
      await extension.refresh();
      expect(extension.visibleBookmarks().map((bookmark) => bookmark.title)).toEqual(['甲的书签']);
      await web.logout();
      expect(web.snapshot().mode).toBe('login');
      expect(web.render()).not.toContain('甲的书签');
      expect(web.render()).not.toContain('乙的书签');
      await extension.refresh();
      expect(extension.snapshot().username).toBe('甲');
      expect(titles(server, '甲')).toEqual(['甲的书签']);
      expect(calls).toEqual([]);
    } finally {
      delete globalRef.chrome;
      delete globalRef.browser;
    }
  });

  it('has no save-page or browser-bookmark controls on the page', async () => {
    const source = await readTree(join(root, 'apps/web'));
    expect(source).not.toContain('保存当前页');
    expect(source).not.toContain('书签栏');
    expect(source).not.toContain('快捷键');
    expect(source).not.toMatch(/chrome\.bookmarks|browser\.bookmarks|contextMenus|chrome\.commands|browser\.commands|bookmarks\.create|bookmarks\.getTree/);
    const matrix = await readFile(join(root, 'docs/support-matrix.md'), 'utf8');
    expect(matrix).toContain('可登录整理账号书签');
    expect(matrix).toContain('不保存当前页');
    expect(matrix).toContain('不读写浏览器书签栏');
    const page = await readFile(join(root, 'apps/web/index.html'), 'utf8');
    expect(page).toContain('不能注册');
    expect(page).toContain('./src/main.ts');
    startWebApp();
    const server = new MemoryAccounts(['甲']);
    const app = appFor(server);
    const rootNode = fakeRoot();
    bindWebApp(rootNode, app);
    expect(rootNode.innerHTML).toContain('>登录<');
    expect(rootNode.innerHTML).not.toContain('保存当前页');
    await app.login('甲', password);
    expect(app.render()).not.toContain('保存当前页');
    expect(app.render()).not.toMatch(/chrome\.bookmarks|browser\.bookmarks/);
  });
});

function fakeRoot(): PageRoot & { fire(type: 'submit' | 'click' | 'change', event: PageEvent): void } {
  const listeners: Record<string, Array<(event: PageEvent) => void>> = {};
  return {
    innerHTML: '',
    addEventListener(type, listener) {
      (listeners[type] ??= []).push(listener);
    },
    fire(type, event) {
      for (const listener of listeners[type] ?? []) listener(event);
    },
  };
}

async function readTree(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  const chunks: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    chunks.push(entry.isDirectory() ? await readTree(path) : await readFile(path, 'utf8'));
  }
  return chunks.join('\n');
}

const children = new Set<ChildProcess>();
const directories: string[] = [];

afterEach(async () => {
  await Promise.all([...children].map((child) => stopProcess(child)));
  children.clear();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('web client against the account server', () => {
  it('serves a browser library page that calls startWebApp and its script', async () => {
    const dataDir = await makeDir();
    const server = await startServer(dataDir);
    const page = await fetch(`${server.url}/`);
    const index = await fetch(`${server.url}/index.html`);
    expect(page.status).toBe(200);
    expect(index.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    const html = await page.text();
    expect(await index.text()).toBe(html);
    expect(html).toContain('startWebApp()');
    expect(html).toContain("from '/web.js'");
    expect(html).not.toContain('main.ts');
    expect(html).toContain('不能注册');
    expect(html).toContain('>登录<');
    const script = await fetch(`${server.url}/web.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toMatch(/javascript/);
    const source = await script.text();
    expect(source).toContain('startWebApp');
    expect(source).toContain('新增书签');
    expect(source).toContain('回收站');
    expect(source).toContain('搜索');
    expect(source).toContain('导入');
    expect(source).toContain('导出 JSON');
    expect(source).not.toContain('interface PageRoot');
    expect(source).not.toContain("from './src/main.ts'");
    expect((await fetch(`${server.url}/src/main.ts`)).status).toBe(404);
    expect((await fetch(`${server.url}/apps/web/src/app.ts`)).status).toBe(404);
  }, 30000);

  it('writes through manifest preconditions and keeps the other session', async () => {
    const dataDir = await makeDir();
    await createAccount(dataDir, 'jia', 'jia-password');
    await createAccount(dataDir, 'yi', 'yi-password');
    const server = await startServer(dataDir);
    const web = createWebApp({ fetchImpl: fetch, baseUrl: server.url });
    const extension = createWebApp({ fetchImpl: fetch, baseUrl: server.url });
    await web.login('jia', 'jia-password');
    await web.addBookmark({
      title: '星标阅读',
      url: 'https://example.com/read',
      folder: '资料',
      tags: ['阅读', '稍后'],
      notes: '周末看',
      favorite: true,
    });
    await web.addBookmark({ title: '丢掉', url: 'https://example.com/drop', folder: '资料' });
    const drop = web.visibleBookmarks().find((bookmark) => bookmark.title === '丢掉');
    await web.deleteBookmark(drop?.id ?? '');
    web.showTrash(true);
    expect(web.visibleBookmarks().map((bookmark) => bookmark.title)).toEqual(['丢掉']);
    await web.restoreBookmark(drop?.id ?? '');
    web.showTrash(false);
    await web.deleteBookmark(drop?.id ?? '');
    await web.emptyTrash();
    await expect(web.restoreBookmark(drop?.id ?? '')).rejects.toThrow(/不能再恢复/);

    web.search('星标');
    expect(web.visibleBookmarks().map((bookmark) => bookmark.title)).toEqual(['星标阅读']);
    const id = web.visibleBookmarks()[0]?.id ?? '';
    web.search('');
    web.setFavoritesOnly(true);
    expect(web.visibleBookmarks().map((bookmark) => bookmark.title)).toEqual(['星标阅读']);
    await web.updateBookmark(id, {
      title: '新标题',
      url: 'https://example.com/next',
      folder: '新文件夹',
      tags: ['改过'],
      notes: '新备注',
      favorite: false,
    });
    expect(web.exportJson()).toContain('新标题');
    expect(web.exportHtml()).toContain('新标题');
    await extension.login('jia', 'jia-password');
    expect(extension.visibleBookmarks()[0]).toMatchObject({ title: '新标题', url: 'https://example.com/next', notes: '新备注', favorite: false });
    await extension.updateBookmark(id, { title: '服务标题' });
    await web.updateBookmark(id, { title: '网页标题' });
    expect(web.render()).toContain('<p data-title-source="local">网页标题</p>');
    expect(web.render()).toContain('<p data-title-source="remote">服务标题</p>');
    await extension.refresh();
    expect(extension.visibleBookmarks()[0]?.title).toBe('服务标题');
    await web.chooseConflict(id, 'local');
    await extension.refresh();
    expect(extension.visibleBookmarks().map((bookmark) => bookmark.title)).toEqual(['网页标题']);
    const json = exportLumaMarkJson([makeBookmark({
      url: 'https://example.com/json',
      title: 'JSON书签',
      notes: '来自备份',
      tags: ['备份'],
      favorite: true,
    })], []);
    expect(await web.beginImport(json, 'json')).toBe('applied');
    expect(await web.beginImport('<DL><p><DT><H3>导入目录</H3><DL><p><DT><A HREF="https://example.com/imported-html">导入的网页书签</A></DL></DL>', 'html')).toBe('applied');
    await extension.refresh();
    expect(extension.visibleBookmarks().map((bookmark) => bookmark.title).sort()).toEqual(['JSON书签', '导入的网页书签', '网页标题']);
    expect(extension.visibleBookmarks().find((bookmark) => bookmark.title === 'JSON书签')).toMatchObject({ notes: '来自备份', favorite: true });
    expect(extension.render()).toContain('导入目录');

    expect(await web.beginImport('<DL><p><DT><A HREF="https://example.com/next">另一标题</A></DL>', 'html')).toBe('awaiting-choice');
    await extension.refresh();
    expect(extension.visibleBookmarks().map((bookmark) => bookmark.title).sort()).toEqual(['JSON书签', '导入的网页书签', '网页标题']);
    expect(extension.visibleBookmarks().map((bookmark) => bookmark.title)).not.toContain('另一标题');
    await web.login('yi', 'yi-password');
    expect(web.snapshot().username).toBe('yi');
    expect(web.render()).toContain('这个账号还没有书签');
    expect(web.render()).not.toContain('网页标题');
    await extension.refresh();
    expect(extension.snapshot().username).toBe('jia');
    expect(extension.visibleBookmarks().map((bookmark) => bookmark.title).sort()).toEqual(['JSON书签', '导入的网页书签', '网页标题']);
    await web.logout();
    expect(web.render()).not.toContain('网页标题');
    await extension.refresh();
    expect(extension.visibleBookmarks().map((bookmark) => bookmark.title).sort()).toEqual(['JSON书签', '导入的网页书签', '网页标题']);
  }, 40000);
});

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lumamark-web-'));
  directories.push(dir);
  return dir;
}

function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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

async function createAccount(dataDir: string, username: string, accountPassword: string): Promise<void> {
  const result = await run(process.execPath, [join(root, 'apps/server/cli.mjs'), 'create-account', '--data', dataDir, '--username', username, '--password', accountPassword]);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || 'create-account failed');
}

async function startServer(dataDir: string): Promise<{ child: ChildProcess; url: string }> {
  const child = spawn(process.execPath, [join(root, 'apps/server/server.mjs')], {
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

function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveStop) => {
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
