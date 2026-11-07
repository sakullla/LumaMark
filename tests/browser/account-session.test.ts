import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { makeBookmark, type Bookmark, type Collection, type ConflictRecord, type SyncMetadata } from '../../packages/domain/src/index';
import { WebDavSyncEngine, type SyncManifest, type SyncRepository } from '../../packages/sync/src/index';
import { IndexedDbRepository } from '../../packages/storage/src/index';
import { startBackground } from '../../apps/extension/src/background/index';
import {
  ACCOUNT_DATABASE,
  AccountFlow,
  GUEST_DATABASE,
  accountManifestClient,
  browserSkipsNativeBookmarks,
  openAccountLibrary,
  markUnsynced,
  showsSynced,
  type AccountLibrary,
  type AccountSession,
} from '../../apps/extension/src/background/account';

const NOW = '2024-06-01T00:00:00.000Z';
const SERVER = 'https://bookmarks.example';

function bookmark(id: string, title: string, url: string, collectionId?: string, when = NOW): Bookmark {
  return makeBookmark({ id, url, title, collectionId }, when);
}

function folder(id: string, name: string): Collection {
  return { id, name, position: 0, toolbar: false, createdAt: NOW, updatedAt: NOW, revision: 1 };
}

function manifest(bookmarks: Bookmark[] = [], collections: Collection[] = [], purged?: string[]): SyncManifest {
  const next: SyncManifest = {
    format: 'lumamark-sync',
    schemaVersion: 2,
    generatedAt: NOW,
    deviceId: 'server',
    bookmarks,
    collections,
  };
  if (purged?.length) next.purged = purged;
  return next;
}

function memoryLibrary(deviceId = 'device'): AccountLibrary {
  const bookmarks = new Map<string, Bookmark>();
  const collections = new Map<string, Collection>();
  const conflicts: ConflictRecord[] = [];
  let metadata: SyncMetadata = { key: 'sync', deviceId, pendingChanges: 0, status: 'offline', autoSync: false };
  const store: AccountLibrary = {
    async list(query = {}) {
      const items = [...bookmarks.values()];
      return query.includeDeleted ? items : items.filter((item) => !item.deletedAt);
    },
    async findById(id) { return bookmarks.get(id); },
    async findByUrl(url) { return [...bookmarks.values()].find((item) => item.url === url); },
    async put(item) { bookmarks.set(item.id, { ...item, tags: [...item.tags] }); },
    async remove(id) { bookmarks.delete(id); },
    async listCollections() { return [...collections.values()]; },
    async putCollection(item) { collections.set(item.id, { ...item }); },
    async getSyncMetadata() { return { ...metadata }; },
    async setSyncMetadata(next) { metadata = { ...next }; },
    async putConflict(conflict) {
      const index = conflicts.findIndex((item) => item.id === conflict.id);
      if (index >= 0) conflicts[index] = conflict;
      else conflicts.push(conflict);
    },
    async listConflicts(includeResolved = false) {
      return conflicts.filter((item) => includeResolved || !item.resolvedAt).map((item) => ({ ...item }));
    },
    async reset() {
      bookmarks.clear();
      collections.clear();
      conflicts.length = 0;
      metadata = { key: 'sync', deviceId: metadata.deviceId, pendingChanges: 0, status: 'offline', autoSync: false };
    },
  };
  return store;
}

async function liveTitles(store: SyncRepository): Promise<string[]> {
  return (await store.list()).filter((item) => !item.deletedAt && !item.purgedAt).map((item) => item.title).sort();
}

async function signature(store: SyncRepository): Promise<string> {
  return JSON.stringify({
    bookmarks: await store.list({ includeDeleted: true }),
    collections: await store.listCollections(),
  });
}

function quotedEtag(n: number): string {
  return `"${n.toString(16).padStart(64, '0')}"`;
}

interface ServerAccount { password: string; manifest: SyncManifest; etag: string }

function fakeServer() {
  const accounts = new Map<string, ServerAccount>();
  const sessions = new Map<string, string>();
  const calls: Array<{ url: string; method: string; ifMatch?: string | null; body?: string }> = [];
  let seq = 1;
  let failPuts = 0;
  let holdPut: (() => Promise<void>) | undefined;
  let down = false;
  const create = (username: string, password: string, body: SyncManifest = manifest()) => {
    accounts.set(username, { password, manifest: body, etag: quotedEtag(seq++) });
  };
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const ifMatch = headers.get('If-Match');
    const body = init?.body === undefined ? undefined : String(init.body);
    calls.push({ url, method, ifMatch, body });
    if (down && url.includes('/api/manifest')) throw new TypeError('Failed to fetch');
    if (/\/api\/(register|signup|accounts)$/.test(url)) return new Response('{}', { status: 404 });
    if (url.endsWith('/api/session') && method === 'POST') {
      const parsed = JSON.parse(body ?? '{}') as { username?: string; password?: string };
      const account = parsed.username ? accounts.get(parsed.username) : undefined;
      if (!account || account.password !== parsed.password) return Response.json({ error: 'unauthorized' }, { status: 401 });
      const token = `token-${parsed.username}-${seq++}`;
      sessions.set(token, parsed.username);
      return Response.json({ username: parsed.username, token });
    }
    if (url.endsWith('/api/session') && method === 'DELETE') {
      const token = (headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      sessions.delete(token);
      return new Response(null, { status: 204 });
    }
    const token = (headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const username = sessions.get(token);
    if (!username || !accounts.has(username)) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const account = accounts.get(username)!;
    if (url.endsWith('/api/manifest') && method === 'GET') {
      return new Response(JSON.stringify(account.manifest), { status: 200, headers: { ETag: account.etag, 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/api/manifest') && method === 'PUT') {
      if (holdPut) await holdPut();
      if (failPuts > 0) {
        failPuts -= 1;
        return new Response('{}', { status: 500 });
      }
      if (!ifMatch) return Response.json({ error: 'precondition required' }, { status: 428 });
      if (ifMatch === '*' || ifMatch !== account.etag) return Response.json({ error: 'precondition failed' }, { status: 412 });
      account.manifest = JSON.parse(body ?? '{}') as SyncManifest;
      account.etag = quotedEtag(seq++);
      return new Response(JSON.stringify({ etag: account.etag }), { status: 200, headers: { ETag: account.etag, 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };
  return {
    accounts, sessions, calls, create, fetchImpl,
    failNextPut(count = 1) { failPuts = count; },
    holdNextPut() {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => { release = resolve; });
      holdPut = () => gate;
      return () => { holdPut = undefined; release(); };
    },
    setDown(value: boolean) { down = value; },
  };
}

function harness(options: { rewrite?: boolean; failBar?: 'account' | 'guest' | 'second-account' } = {}) {
  const guest = memoryLibrary('guest-device');
  const account = memoryLibrary('account-device');
  const server = fakeServer();
  const saved: { session?: AccountSession } = {};
  const bar: string[] = [];
  const rewrites: string[] = [];
  let accountRewrites = 0;
  const flow = new AccountFlow({
    guest,
    account,
    fetch: server.fetchImpl,
    now: () => NOW,
    rewriteEnabled: async () => Boolean(options.rewrite),
    rewriteBar: async (which) => {
      rewrites.push(which);
      if (which === 'account') accountRewrites += 1;
      const fail = options.failBar === 'second-account' ? which === 'account' && accountRewrites === 2 : options.failBar === which;
      if (fail) throw new Error('bar failed');
      const titles = await liveTitles(which === 'account' ? account : guest);
      bar.splice(0, bar.length, ...titles);
    },
    sessionStore: {
      async load() { return saved.session; },
      async save(session) { saved.session = session; },
    },
  });
  return { guest, account, server, flow, bar, rewrites, saved };
}

async function seedGuest(guest: SyncRepository, items: Bookmark[], folders: Collection[] = []): Promise<void> {
  for (const item of folders) await guest.putCollection(item);
  for (const item of items) await guest.put(item);
}

describe('account manifest client', () => {
  it('sends the GET ETag unchanged and rejects a missing, starred, or stale If-Match', async () => {
    const server = fakeServer();
    server.create('alice', 'secret', manifest([bookmark('a', 'Alpha', 'https://alpha.example/')]));
    const session = { serverUrl: SERVER, username: 'alice', token: '' };
    const opened = await (await server.fetchImpl(`${SERVER}/api/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'secret' }),
    })).json() as { token: string };
    session.token = opened.token;
    const client = accountManifestClient(session, server.fetchImpl);
    const remote = await client.read();
    expect(remote.etag).toBe(server.accounts.get('alice')?.etag);
    expect(remote.etag?.startsWith('"')).toBe(true);
    expect(remote.etag?.endsWith('"')).toBe(true);
    const before = JSON.stringify(server.accounts.get('alice')?.manifest);
    await expect(client.write(remote.manifest!, undefined)).rejects.toMatchObject({ status: 428 });
    await expect(client.write(remote.manifest!, '*')).rejects.toMatchObject({ status: 412 });
    await expect(client.write(remote.manifest!, '"stale"')).rejects.toMatchObject({ status: 412 });
    expect(JSON.stringify(server.accounts.get('alice')?.manifest)).toBe(before);
    const written = await client.write(remote.manifest!, remote.etag);
    const sent = server.calls.filter((call) => call.method === 'PUT').at(-1);
    expect(sent?.ifMatch).toBe(remote.etag);
    expect(sent?.ifMatch).not.toBe(`"${remote.etag}"`);
    expect(written.etag).toBe(server.accounts.get('alice')?.etag);
    expect(server.calls.some((call) => /\/api\/(register|signup|accounts)$/.test(call.url))).toBe(false);
  });
});

describe('signing in, out, and switching', () => {
  it('keeps the unsigned library and the bar when the password is wrong', async () => {
    const { guest, server, flow, rewrites } = harness({ rewrite: true });
    const kept = bookmark('guest', 'Guest', 'https://guest.example/');
    await seedGuest(guest, [kept]);
    server.create('alice', 'secret');
    const before = await signature(guest);
    const result = await flow.login({ serverUrl: SERVER, username: 'alice', password: 'nope' });
    expect(result).toMatchObject({ ok: false, status: 'failed' });
    expect(flow.active).toBe('guest');
    expect(flow.session).toBeUndefined();
    expect(server.sessions.size).toBe(0);
    expect(await signature(guest)).toBe(before);
    expect(rewrites).toEqual([]);
    expect(server.calls.some((call) => call.url.endsWith('/api/manifest'))).toBe(false);
  });

  it('copies an empty account only after the server write, and leaves the unsigned library in place', async () => {
    const { guest, account, server, flow, bar, saved } = harness({ rewrite: true });
    const work = folder('work', 'Work');
    const kept = bookmark('guest', 'Guest', 'https://guest.example/', 'work');
    await seedGuest(guest, [kept], [work]);
    server.create('alice', 'secret', manifest([], [], ['purged-id']));
    await guest.put({ ...bookmark('purged-id', 'Gone', 'https://gone.example/'), purgedAt: NOW, deletedAt: NOW });
    const before = await signature(guest);
    const release = server.holdNextPut();
    const pending = flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    await vi.waitFor(() => expect(server.calls.some((call) => call.method === 'PUT')).toBe(true));
    expect(flow.active).toBe('guest');
    expect(await liveTitles(account)).toEqual([]);
    expect(server.accounts.get('alice')?.manifest.bookmarks).toEqual([]);
    release();
    expect(await pending).toMatchObject({ ok: true, status: 'signed-in', username: 'alice' });
    expect(flow.active).toBe('account');
    expect(saved.session?.token).toBeTruthy();
    expect(await liveTitles(account)).toEqual(['Guest']);
    expect((await account.list()).find((item) => item.id === 'guest')?.collectionId).toBe('work');
    expect((await account.listCollections()).some((item) => item.id === 'work' && item.name === 'Work')).toBe(true);
    expect((await account.list()).some((item) => item.id === 'purged-id' && !item.purgedAt)).toBe(false);
    expect(server.accounts.get('alice')?.manifest.bookmarks?.some((item) => item.id === 'guest')).toBe(true);
    expect(server.accounts.get('alice')?.manifest.purged).toContain('purged-id');
    expect(await signature(guest)).toBe(before);
    expect(bar).toEqual(['Guest']);
    const metadata = await account.getSyncMetadata();
    expect(showsSynced(metadata)).toBe(true);
    const put = server.calls.find((call) => call.method === 'PUT');
    expect(put?.body).not.toContain('searchUrl');
    expect(put?.body).not.toContain('lumamark-theme');
  });

  it('stays unsigned and leaves the account empty when the copy cannot be written', async () => {
    const { guest, account, server, flow, bar, rewrites } = harness({ rewrite: true });
    await seedGuest(guest, [bookmark('guest', 'Guest', 'https://guest.example/')]);
    server.create('alice', 'secret');
    const before = await signature(guest);
    server.failNextPut();
    const result = await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    expect(result.ok).toBe(false);
    expect(flow.active).toBe('guest');
    expect(flow.session).toBeUndefined();
    expect(await liveTitles(account)).toEqual([]);
    expect(server.accounts.get('alice')?.manifest.bookmarks).toEqual([]);
    expect(await signature(guest)).toBe(before);
    expect(bar).toEqual([]);
    expect(rewrites).toEqual([]);
  });

  it('discards the copy and restores the bar when the bookmark bar rewrite fails', async () => {
    const { guest, account, server, flow, bar, rewrites } = harness({ rewrite: true, failBar: 'account' });
    await seedGuest(guest, [bookmark('guest', 'Guest', 'https://guest.example/')]);
    server.create('alice', 'secret');
    const before = await signature(guest);
    const result = await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    expect(result.ok).toBe(false);
    expect(flow.active).toBe('guest');
    expect(flow.session).toBeUndefined();
    expect(await liveTitles(account)).toEqual([]);
    expect(server.accounts.get('alice')?.manifest.bookmarks ?? []).toEqual([]);
    expect(await signature(guest)).toBe(before);
    expect(rewrites).toEqual(['account', 'guest']);
    expect(bar).toEqual(['Guest']);
  });

  it('asks before replacing a populated account, and closing the choice writes nothing', async () => {
    const { guest, account, server, flow, rewrites } = harness({ rewrite: true });
    await seedGuest(guest, [bookmark('guest', 'Guest', 'https://guest.example/')]);
    server.create('alice', 'secret', manifest([bookmark('remote', 'Alpha', 'https://alpha.example/')]));
    const before = await signature(guest);
    const remote = JSON.stringify(server.accounts.get('alice')?.manifest);
    expect(await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' })).toMatchObject({ ok: true, status: 'choice' });
    expect(flow.active).toBe('guest');
    expect(server.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
    expect(await flow.choose('cancel')).toMatchObject({ ok: true, status: 'cancelled' });
    expect(flow.active).toBe('guest');
    expect(flow.session).toBeUndefined();
    expect(await liveTitles(account)).toEqual([]);
    expect(JSON.stringify(server.accounts.get('alice')?.manifest)).toBe(remote);
    expect(await signature(guest)).toBe(before);
    expect(rewrites).toEqual([]);
    expect(server.sessions.size).toBe(0);
  });

  it('overwrite installs the server library and does not upload unsigned-only bookmarks', async () => {
    const { guest, account, server, flow, bar } = harness({ rewrite: true });
    await seedGuest(guest, [bookmark('guest', 'Guest only', 'https://guest.example/')]);
    server.create('alice', 'secret', manifest([bookmark('remote', 'Alpha', 'https://alpha.example/')]));
    const before = await signature(guest);
    const remote = JSON.stringify(server.accounts.get('alice')?.manifest);
    expect(await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' })).toMatchObject({ status: 'choice' });
    expect(await flow.choose('overwrite')).toMatchObject({ ok: true, status: 'signed-in' });
    expect(await liveTitles(account)).toEqual(['Alpha']);
    expect(server.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
    expect(JSON.stringify(server.accounts.get('alice')?.manifest)).toBe(remote);
    expect(await signature(guest)).toBe(before);
    expect(bar).toEqual(['Alpha']);
    expect(bar).not.toContain('Guest only');
  });

  it('rolls back to the unsigned library when overwrite cannot finish the bar', async () => {
    const { guest, account, server, flow, bar } = harness({ rewrite: true, failBar: 'account' });
    await seedGuest(guest, [bookmark('guest', 'Guest only', 'https://guest.example/')]);
    server.create('alice', 'secret', manifest([bookmark('remote', 'Alpha', 'https://alpha.example/')]));
    const before = await signature(guest);
    const remote = JSON.stringify(server.accounts.get('alice')?.manifest);
    await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    expect((await flow.choose('overwrite')).ok).toBe(false);
    expect(flow.active).toBe('guest');
    expect(await liveTitles(account)).toEqual([]);
    expect(JSON.stringify(server.accounts.get('alice')?.manifest)).toBe(remote);
    expect(await signature(guest)).toBe(before);
    expect(bar).toEqual(['Guest only']);
  });

  it('merges by folder name and url, writes that result, and keeps the unsigned original', async () => {
    const { guest, account, server, flow, bar } = harness({ rewrite: true });
    await seedGuest(guest, [
      bookmark('guest-shared', 'Guest title', 'https://same.example/item', 'guest-work'),
      bookmark('guest-only', 'Guest only', 'https://guest.example/'),
    ], [folder('guest-work', 'Work')]);
    server.create('alice', 'secret', manifest([
      bookmark('account-shared', 'Account title', 'https://same.example/item', 'account-work'),
      bookmark('account-only', 'Alpha', 'https://alpha.example/'),
    ], [folder('account-work', 'Work')]));
    const before = await signature(guest);
    await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    expect(await flow.choose('merge')).toMatchObject({ ok: true, status: 'signed-in' });
    const titles = await liveTitles(account);
    expect(titles).toEqual(['Account title', 'Alpha', 'Guest only']);
    const shared = (await account.list()).filter((item) => item.url === 'https://same.example/item' && !item.deletedAt);
    expect(shared).toHaveLength(1);
    expect(shared[0]?.id).toBe('account-shared');
    expect(shared[0]?.title).toBe('Account title');
    const stored = server.accounts.get('alice')?.manifest.bookmarks ?? [];
    expect(stored.filter((item) => item.url === 'https://same.example/item')).toHaveLength(1);
    expect(stored.some((item) => item.id === 'guest-only')).toBe(true);
    expect(await signature(guest)).toBe(before);
    expect(bar).toEqual(titles);
  });

  it('leaves the populated account and the bar untouched when the merge write fails', async () => {
    const { guest, account, server, flow, bar, rewrites } = harness({ rewrite: true });
    await seedGuest(guest, [bookmark('guest-only', 'Guest only', 'https://guest.example/')]);
    server.create('alice', 'secret', manifest([bookmark('remote', 'Alpha', 'https://alpha.example/')]));
    const before = await signature(guest);
    const remote = JSON.stringify(server.accounts.get('alice')?.manifest);
    await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    server.failNextPut();
    expect((await flow.choose('merge')).ok).toBe(false);
    expect(flow.active).toBe('guest');
    expect(await liveTitles(account)).toEqual([]);
    expect(JSON.stringify(server.accounts.get('alice')?.manifest)).toBe(remote);
    expect(await signature(guest)).toBe(before);
    expect(bar).toEqual([]);
    expect(rewrites).toEqual([]);
  });

  it('restores the previous account and bar when merge is written but the bar fails', async () => {
    const { guest, server, flow, bar } = harness({ rewrite: true, failBar: 'account' });
    await seedGuest(guest, [bookmark('guest-only', 'Guest only', 'https://guest.example/')]);
    server.create('alice', 'secret', manifest([bookmark('remote', 'Alpha', 'https://alpha.example/')]));
    const remote = JSON.stringify(server.accounts.get('alice')?.manifest);
    await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    expect((await flow.choose('merge')).ok).toBe(false);
    expect(flow.active).toBe('guest');
    expect(JSON.stringify(server.accounts.get('alice')?.manifest)).toBe(remote);
    expect(bar).toEqual(['Guest only']);
  });

  it('returns to the unsigned library only after the bar is restored', async () => {
    const { guest, account, server, flow, bar, saved } = harness({ rewrite: true });
    await seedGuest(guest, [bookmark('guest', 'Guest', 'https://guest.example/')]);
    server.create('alice', 'secret');
    await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    expect(await flow.logout()).toMatchObject({ ok: true, status: 'signed-out' });
    expect(flow.active).toBe('guest');
    expect(flow.session).toBeUndefined();
    expect(saved.session).toBeUndefined();
    expect(await liveTitles(account)).toEqual([]);
    expect(await liveTitles(guest)).toEqual(['Guest']);
    expect(bar).toEqual(['Guest']);
    expect(server.sessions.size).toBe(0);
  });

  it('stays on the account when the bar cannot be restored on sign-out', async () => {
    const { guest, account, server, flow, saved } = harness({ rewrite: true, failBar: 'guest' });
    await seedGuest(guest, [bookmark('guest', 'Guest', 'https://guest.example/')]);
    server.create('alice', 'secret');
    await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    const token = saved.session?.token;
    expect((await flow.logout()).ok).toBe(false);
    expect(flow.active).toBe('account');
    expect(flow.session?.token).toBe(token);
    expect(await liveTitles(account)).toEqual(['Guest']);
    expect(server.sessions.has(token ?? '')).toBe(true);
  });

  it('does not call the bookmark bar when rewrite is off', async () => {
    const { guest, server, flow, rewrites } = harness({ rewrite: false });
    await seedGuest(guest, [bookmark('guest', 'Guest', 'https://guest.example/')]);
    server.create('alice', 'secret');
    await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    expect(flow.active).toBe('account');
    expect(rewrites).toEqual([]);
    await flow.logout();
    expect(rewrites).toEqual([]);
    expect(flow.active).toBe('guest');
  });

  it('writes the current account back before loading the next one, and does not merge them', async () => {
    const { guest, account, server, flow, bar } = harness({ rewrite: true });
    await seedGuest(guest, [bookmark('guest', 'Guest', 'https://guest.example/')]);
    const guestBefore = await signature(guest);
    server.create('alice', 'secret', manifest([bookmark('alpha', 'Alpha', 'https://alpha.example/')]));
    server.create('betty', 'secret', manifest([bookmark('beta', 'Beta', 'https://beta.example/')]));
    await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    await flow.choose('overwrite');
    const current = (await account.findById('alpha'))!;
    await account.put({ ...current, title: 'Alpha edited', updatedAt: '2024-07-01T00:00:00.000Z', revision: 3 });
    await account.setSyncMetadata({ ...(await account.getSyncMetadata()), pendingChanges: 1, status: 'idle' });
    expect(await flow.switchAccount({ serverUrl: SERVER, username: 'betty', password: 'secret' })).toMatchObject({ ok: true, username: 'betty' });
    expect(await liveTitles(account)).toEqual(['Beta']);
    expect(server.accounts.get('alice')?.manifest.bookmarks?.find((item) => item.id === 'alpha')?.title).toBe('Alpha edited');
    expect(server.accounts.get('betty')?.manifest.bookmarks?.some((item) => item.title === 'Alpha edited')).toBe(false);
    expect(await signature(guest)).toBe(guestBefore);
    expect(bar).toEqual(['Beta']);
  });

  it('does not copy the unsigned library into an empty account during a switch', async () => {
    const { guest, account, server, flow } = harness({ rewrite: true });
    await seedGuest(guest, [bookmark('guest', 'Guest', 'https://guest.example/')]);
    server.create('alice', 'secret', manifest([bookmark('alpha', 'Alpha', 'https://alpha.example/')]));
    server.create('betty', 'secret');
    await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    await flow.choose('overwrite');
    expect(await flow.switchAccount({ serverUrl: SERVER, username: 'betty', password: 'secret' })).toMatchObject({ ok: true });
    expect(await liveTitles(account)).toEqual([]);
    expect(server.accounts.get('betty')?.manifest.bookmarks ?? []).toEqual([]);
    expect(await liveTitles(guest)).toEqual(['Guest']);
  });

  it('stays on the current account when its write-back fails', async () => {
    const { account, server, flow, bar } = harness({ rewrite: true });
    server.create('alice', 'secret', manifest([bookmark('alpha', 'Alpha', 'https://alpha.example/')]));
    server.create('betty', 'secret', manifest([bookmark('beta', 'Beta', 'https://beta.example/')]));
    await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    await flow.choose('overwrite');
    const current = (await account.findById('alpha'))!;
    await account.put({ ...current, title: 'Alpha edited', updatedAt: '2024-07-01T00:00:00.000Z', revision: 3 });
    await account.setSyncMetadata({ ...(await account.getSyncMetadata()), pendingChanges: 1 });
    server.failNextPut();
    const sessions = server.sessions.size;
    expect((await flow.switchAccount({ serverUrl: SERVER, username: 'betty', password: 'secret' })).ok).toBe(false);
    expect(flow.session?.username).toBe('alice');
    expect(await liveTitles(account)).toEqual(['Alpha edited']);
    expect(server.sessions.size).toBe(sessions);
    expect(server.accounts.get('betty')?.manifest.bookmarks?.map((item) => item.title)).toEqual(['Beta']);
    expect(bar).toEqual(['Alpha']);
  });

  it('returns to the previous account and bar when loading the next account fails', async () => {
    const { account, server, flow, bar } = harness({ rewrite: true, failBar: 'second-account' });
    server.create('alice', 'secret', manifest([bookmark('alpha', 'Alpha', 'https://alpha.example/')]));
    server.create('betty', 'secret', manifest([bookmark('beta', 'Beta', 'https://beta.example/')]));
    await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    await flow.choose('overwrite');
    expect((await flow.switchAccount({ serverUrl: SERVER, username: 'betty', password: 'secret' })).ok).toBe(false);
    expect(flow.session?.username).toBe('alice');
    expect(await liveTitles(account)).toEqual(['Alpha']);
    expect(server.accounts.get('alice')?.manifest.bookmarks?.map((item) => item.id)).toEqual(['alpha']);
    expect(server.accounts.get('betty')?.manifest.bookmarks?.map((item) => item.id)).toEqual(['beta']);
    expect(bar).toEqual(['Alpha']);
  });

  it('reuses the signed-in server when a switch leaves the address blank', async () => {
    const { account, server, flow } = harness({ rewrite: true });
    server.create('alice', 'secret', manifest([bookmark('alpha', 'Alpha', 'https://alpha.example/')]));
    server.create('betty', 'secret', manifest([bookmark('beta', 'Beta', 'https://beta.example/')]));
    await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    await flow.choose('overwrite');
    expect(await flow.switchAccount({ serverUrl: '   ', username: 'betty', password: 'secret' })).toMatchObject({ ok: true, username: 'betty' });
    expect(flow.session?.serverUrl).toBe(SERVER);
    expect(await liveTitles(account)).toEqual(['Beta']);
    expect(server.accounts.get('alice')?.manifest.bookmarks?.map((item) => item.id)).toEqual(['alpha']);
    expect(server.accounts.get('betty')?.manifest.bookmarks?.map((item) => item.id)).toEqual(['beta']);
  });

  it('writes an unfinished account edit back before signing out', async () => {
    const { account, server, flow, bar } = harness({ rewrite: true });
    server.create('alice', 'secret', manifest([bookmark('alpha', 'Alpha', 'https://alpha.example/')]));
    await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    await flow.choose('overwrite');
    const current = (await account.findById('alpha'))!;
    await account.put({ ...current, title: 'Alpha edited', updatedAt: '2024-07-01T00:00:00.000Z', revision: 3 });
    await account.setSyncMetadata({ ...(await account.getSyncMetadata()), pendingChanges: 1, status: 'idle' });
    expect(await flow.logout()).toMatchObject({ ok: true, status: 'signed-out' });
    expect(flow.active).toBe('guest');
    expect(flow.session).toBeUndefined();
    expect(server.accounts.get('alice')?.manifest.bookmarks?.find((item) => item.id === 'alpha')?.title).toBe('Alpha edited');
    expect(await liveTitles(account)).toEqual([]);
    expect(bar).toEqual([]);
  });

  it('stays on the account when sign-out cannot write the unfinished edit back', async () => {
    const { account, server, flow, bar, rewrites, saved } = harness({ rewrite: true });
    server.create('alice', 'secret', manifest([bookmark('alpha', 'Alpha', 'https://alpha.example/')]));
    await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    await flow.choose('overwrite');
    const current = (await account.findById('alpha'))!;
    await account.put({ ...current, title: 'Alpha edited', updatedAt: '2024-07-01T00:00:00.000Z', revision: 3 });
    await account.setSyncMetadata({ ...(await account.getSyncMetadata()), pendingChanges: 1, status: 'idle' });
    const token = saved.session?.token;
    server.setDown(true);
    expect((await flow.logout()).ok).toBe(false);
    expect(flow.active).toBe('account');
    expect(flow.session?.username).toBe('alice');
    expect(flow.session?.token).toBe(token);
    expect(await liveTitles(account)).toEqual(['Alpha edited']);
    expect(server.accounts.get('alice')?.manifest.bookmarks?.find((item) => item.id === 'alpha')?.title).toBe('Alpha');
    expect(server.sessions.has(token ?? '')).toBe(true);
    expect(rewrites).toEqual(['account']);
    expect(bar).toEqual(['Alpha']);
  });

  it('signs out without a write when nothing is waiting, even if the server is down', async () => {
    const { server, flow } = harness({ rewrite: true });
    server.create('alice', 'secret', manifest([bookmark('alpha', 'Alpha', 'https://alpha.example/')]));
    await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    await flow.choose('overwrite');
    const puts = server.calls.filter((call) => call.method === 'PUT').length;
    server.setDown(true);
    expect(await flow.logout()).toMatchObject({ ok: true, status: 'signed-out' });
    expect(flow.active).toBe('guest');
    expect(server.calls.filter((call) => call.method === 'PUT').length).toBe(puts);
    expect(server.accounts.get('alice')?.manifest.bookmarks?.find((item) => item.id === 'alpha')?.title).toBe('Alpha');
  });

  it('keeps a local edit unsynced while the server cannot be reached, then publishes the chosen title', async () => {
    const { account, server, flow } = harness();
    const original = bookmark('same', 'Original', 'https://same.example/');
    server.create('alice', 'secret', manifest([original]));
    await flow.login({ serverUrl: SERVER, username: 'alice', password: 'secret' });
    await flow.choose('overwrite');
    server.setDown(true);
    const edited = { ...original, title: 'Offline', updatedAt: '2024-08-01T00:00:00.000Z', revision: 4 };
    await account.put(edited);
    const engine = new WebDavSyncEngine(account, accountManifestClient(flow.session!, server.fetchImpl));
    const failed = await engine.sync();
    expect(failed.status).toBe('error');
    expect((await account.findById('same'))?.title).toBe('Offline');
    expect(showsSynced(await account.getSyncMetadata())).toBe(false);
    server.setDown(false);
    server.accounts.get('alice')!.manifest = manifest([{ ...original, title: 'Remote', updatedAt: '2024-08-01T00:00:00.000Z', revision: 4 }]);
    const conflicted = await engine.sync();
    expect(conflicted.status).toBe('conflict');
    expect(conflicted.conflicts[0]?.fields).toContain('title');
    expect(showsSynced(await account.getSyncMetadata())).toBe(false);
    await engine.resolveConflict(conflicted.conflicts[0]!.id, 'local');
    await markUnsynced(account);
    expect(showsSynced(await account.getSyncMetadata())).toBe(false);
    expect(server.accounts.get('alice')?.manifest.bookmarks?.find((item) => item.id === 'same')?.title).not.toBe('Offline');
    expect((await engine.sync()).status).toBe('idle');
    expect(server.accounts.get('alice')?.manifest.bookmarks?.find((item) => item.id === 'same')?.title).toBe('Offline');
    expect(showsSynced(await account.getSyncMetadata())).toBe(true);

    const afterLocal = new Date(Date.parse((await account.getSyncMetadata()).lastSyncAt!) + 60_000).toISOString();
    server.accounts.get('alice')!.manifest = manifest([{ ...original, title: 'From server', updatedAt: afterLocal, revision: 8 }]);
    await account.put({ ...(await account.findById('same'))!, title: 'From browser', updatedAt: afterLocal, revision: 8 });
    const again = await engine.sync();
    expect(again.status).toBe('conflict');
    await engine.resolveConflict(again.conflicts[0]!.id, 'remote');
    await markUnsynced(account);
    expect(showsSynced(await account.getSyncMetadata())).toBe(false);
    await engine.sync();
    expect((await account.findById('same'))?.title).toBe('From server');

    const afterRemote = new Date(Date.parse((await account.getSyncMetadata()).lastSyncAt!) + 60_000).toISOString();
    server.accounts.get('alice')!.manifest = manifest([{ ...original, title: 'Remote mix', updatedAt: afterRemote, revision: 12 }]);
    const local = { ...(await account.findById('same'))!, title: 'Local mix', updatedAt: afterRemote, revision: 12 };
    await account.put(local);
    const mixed = await engine.sync();
    expect(mixed.status).toBe('conflict');
    const chosen = { ...local, title: 'Mixed' };
    await engine.resolveConflict(mixed.conflicts[0]!.id, 'merged', chosen);
    await markUnsynced(account);
    expect(showsSynced(await account.getSyncMetadata())).toBe(false);
    await engine.sync();
    expect(server.accounts.get('alice')?.manifest.bookmarks?.find((item) => item.id === 'same')?.title).toBe('Mixed');
    expect(showsSynced(await account.getSyncMetadata())).toBe(true);
  });
});

describe('browser kind', () => {
  it('skips Safari and rewrites Chrome, Edge, and Firefox', () => {
    expect(browserSkipsNativeBookmarks({ extensionUrl: 'safari-web-extension://id/background.js' })).toBe(true);
    expect(browserSkipsNativeBookmarks({ userAgent: 'Mozilla/5.0 Version/17.0 Safari/605.1.15' })).toBe(true);
    expect(browserSkipsNativeBookmarks({ userAgent: 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36' })).toBe(false);
    expect(browserSkipsNativeBookmarks({ userAgent: 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0' })).toBe(false);
    expect(browserSkipsNativeBookmarks({ userAgent: 'Mozilla/5.0 Firefox/128.0' })).toBe(false);
    expect(GUEST_DATABASE).toBe('lumamark');
    expect(ACCOUNT_DATABASE).toBe('lumamark-account');
  });
});

function storage(local: Record<string, unknown>) {
  return {
    get: async (key: string) => ({ [key]: local[key] }),
    set: async (items: Record<string, unknown>) => { Object.assign(local, items); },
  };
}

function messageApi(local: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  let listener: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => void) | undefined;
  const api = {
    tabs: { query: async () => [] },
    runtime: {
      getURL: (path: string) => `chrome-extension://lumamark/${path}`,
      onMessage: { addListener: (callback: typeof listener) => { listener = callback; } },
    },
    storage: { local: storage(local) },
    ...extra,
  };
  const send = (message: unknown) => new Promise<any>((resolve) => listener?.(message, {}, resolve));
  return { api, send };
}

describe('extension account session', () => {
  it('keeps WebDAV on the unsigned library and the account on the server', async () => {
    const guestName = `lumamark-${crypto.randomUUID()}`;
    const accountDbName = `lumamark-account-${crypto.randomUUID()}`;
    const guest = new IndexedDbRepository(guestName);
    const account = openAccountLibrary(accountDbName);
    const deleted: string[] = [];
    const originalDelete = indexedDB.deleteDatabase.bind(indexedDB);
    vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation((name) => {
      deleted.push(String(name));
      return originalDelete(name);
    });
    const kept = bookmark('guest', 'Guest', 'https://guest.example/');
    await guest.put(kept);
    await guest.setSyncConfig({ key: 'sync-config', url: 'https://dav.example', path: 'lumamark.json', autoSync: false });
    let webdav: SyncManifest = manifest([kept]);
    const server = fakeServer();
    server.create('alice', 'secret');
    const local: Record<string, unknown> = { searchUrl: 'https://search.example/?q={query}', 'lumamark-theme': 'dark' };
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('dav.example')) {
        if ((init?.method ?? 'GET') === 'PUT') webdav = JSON.parse(String(init?.body));
        return new Response(JSON.stringify(webdav), { status: 200, headers: { ETag: '"webdav-etag"' } });
      }
      return server.fetchImpl(url, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { api, send } = messageApi(local);
      startBackground(api as never, guest, account);
      const signedIn = await send({ type: 'lumamark-account-login', payload: { serverUrl: SERVER, username: 'alice', password: 'secret' } });
      expect(signedIn).toMatchObject({ ok: true, status: 'signed-in' });
      expect(await send({ type: 'lumamark-list' })).toMatchObject({ items: [expect.objectContaining({ title: 'Guest' })] });
      expect(await guest.findById('guest')).toMatchObject({ title: 'Guest', url: 'https://guest.example/' });
      expect(deleted).toContain(accountDbName);
      expect(deleted).not.toContain(guestName);
      expect(deleted).not.toContain('lumamark');
      expect(JSON.stringify(webdav)).toBe(JSON.stringify(manifest([kept])));
      expect(local.searchUrl).toBe('https://search.example/?q={query}');
      expect(local['lumamark-theme']).toBe('dark');
      const added = await send({ type: 'lumamark-add', payload: { url: 'https://account.example/', title: 'Account only' } });
      expect(added.ok).toBe(true);
      const synced = await send({ type: 'lumamark-sync' });
      expect(synced.status).toBe('idle');
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('dav.example'))).toBe(false);
      expect(server.accounts.get('alice')?.manifest.bookmarks?.some((item) => item.url === 'https://account.example/')).toBe(true);
      expect(JSON.stringify(webdav)).not.toContain('account.example');
      webdav = manifest([kept, bookmark('web', 'From WebDAV', 'https://webdav.example/')]);
      await send({ type: 'lumamark-sync' });
      const accountItems = await send({ type: 'lumamark-list' });
      expect(accountItems.items.some((item: Bookmark) => item.url === 'https://webdav.example/')).toBe(false);
      expect(showsSynced(await account.getSyncMetadata())).toBe(true);
      const signedOut = await send({ type: 'lumamark-account-logout' });
      expect(signedOut).toMatchObject({ ok: true, status: 'signed-out' });
      expect((await send({ type: 'lumamark-list' })).items.map((item: Bookmark) => item.title)).toEqual(['Guest']);
      const guestSync = await send({ type: 'lumamark-sync' });
      expect(guestSync.status).toBe('idle');
      expect((await guest.list()).map((item) => item.url).sort()).toEqual(['https://guest.example/', 'https://webdav.example/']);
      expect(JSON.stringify(webdav)).not.toContain('account.example');
      expect(await send({ type: 'lumamark-get-search-engine' })).toMatchObject({ url: 'https://search.example/?q={query}' });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('follows the active library on Chrome and leaves the browser bar alone on Safari or when sync is off', async () => {
    const guestBookmark = bookmark('guest', 'Guest', 'https://guest.example/');
    const run = async (kind: 'chrome' | 'safari' | 'off') => {
      const guest = new IndexedDbRepository(`lumamark-${crypto.randomUUID()}`);
      const account = openAccountLibrary(`lumamark-account-${crypto.randomUUID()}`);
      await guest.put(guestBookmark);
      const bookmarks = new TinyBookmarks();
      const local: Record<string, unknown> = kind === 'off' ? { nativeSync: false } : {};
      const server = fakeServer();
      server.create('alice', 'secret', manifest([bookmark('remote', 'Alpha', 'https://alpha.example/')]));
      vi.stubGlobal('fetch', server.fetchImpl);
      try {
        const { api, send } = messageApi(local, { bookmarks });
        if (kind === 'safari') api.runtime.getURL = (path: string) => `safari-web-extension://lumamark/${path}`;
        startBackground(api as never, guest, account);
        await new Promise((resolve) => setTimeout(resolve, 30));
        const before = bookmarks.calls.length;
        const signedIn = await send({ type: 'lumamark-account-login', payload: { serverUrl: SERVER, username: 'alice', password: 'secret' } });
        if (signedIn.status === 'choice') await send({ type: 'lumamark-account-choose', payload: { choice: 'overwrite' } });
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { calls: bookmarks.calls.slice(before), active: (await send({ type: 'lumamark-list' })).items.map((item: Bookmark) => item.title) };
      } finally {
        vi.unstubAllGlobals();
      }
    };
    const chrome = await run('chrome');
    expect(chrome.calls).toContain('getTree');
    expect(chrome.active).toEqual(['Alpha']);
    const safari = await run('safari');
    expect(safari.calls).toEqual([]);
    expect(safari.active).toEqual(['Alpha']);
    const off = await run('off');
    expect(off.calls).toEqual([]);
    expect(off.active).toEqual(['Alpha']);
  });
});

class TinyBookmarks {
  calls: string[] = [];
  private nodes = new Map<string, { id: string; parentId?: string; title: string; url?: string; children: string[] }>();
  private next = 10;
  onCreated = { addListener() {} };
  onRemoved = this.onCreated;
  onChanged = this.onCreated;
  onMoved = this.onCreated;

  constructor() {
    this.nodes.set('0', { id: '0', title: '', children: ['1', '2'] });
    this.nodes.set('1', { id: '1', parentId: '0', title: 'Bookmarks bar', children: [] });
    this.nodes.set('2', { id: '2', parentId: '0', title: 'Other bookmarks', children: [] });
  }

  async getTree(): Promise<Array<{ id: string; title: string; children?: unknown[] }>> {
    this.calls.push('getTree');
    const build = (id: string, index: number): { id: string; parentId?: string; index: number; title: string; url?: string; children?: unknown[] } => {
      const node = this.nodes.get(id)!;
      const base = { id, parentId: node.parentId, index, title: node.title, url: node.url };
      if (node.url) return base;
      return { ...base, children: node.children.map((child, position) => build(child, position)) };
    };
    return [build('0', 0)];
  }

  async create(input: { parentId: string; title?: string; url?: string }): Promise<{ id: string; title: string; url?: string }> {
    this.calls.push('create');
    const parent = this.nodes.get(input.parentId);
    if (!parent) throw new Error('missing parent');
    const id = String(this.next++);
    parent.children.push(id);
    this.nodes.set(id, { id, parentId: input.parentId, title: input.title ?? '', url: input.url, children: [] });
    return { id, title: input.title ?? '', url: input.url };
  }

  async update(id: string, changes: { title?: string; url?: string }): Promise<{ id: string; title: string; url?: string }> {
    this.calls.push('update');
    const node = this.nodes.get(id);
    if (!node) throw new Error('missing node');
    if (changes.title !== undefined) node.title = changes.title;
    if (changes.url !== undefined) node.url = changes.url;
    return { id, title: node.title, url: node.url };
  }

  async move(id: string, destination: { parentId?: string }): Promise<{ id: string; title: string }> {
    this.calls.push('move');
    const node = this.nodes.get(id);
    if (!node?.parentId) throw new Error('missing node');
    const from = this.nodes.get(node.parentId);
    if (from) from.children = from.children.filter((child) => child !== id);
    const parentId = destination.parentId ?? node.parentId;
    node.parentId = parentId;
    this.nodes.get(parentId)?.children.push(id);
    return { id, title: node.title };
  }

  async remove(id: string): Promise<void> {
    this.calls.push('remove');
    const node = this.nodes.get(id);
    if (!node?.parentId) throw new Error('missing node');
    if (node.children.length) throw new Error('not empty');
    const parent = this.nodes.get(node.parentId);
    if (parent) parent.children = parent.children.filter((child) => child !== id);
    this.nodes.delete(id);
  }

  async removeTree(id: string): Promise<void> {
    this.calls.push('removeTree');
    const drop = (nodeId: string) => {
      const node = this.nodes.get(nodeId);
      if (!node) return;
      for (const child of [...node.children]) drop(child);
      const parent = node.parentId ? this.nodes.get(node.parentId) : undefined;
      if (parent) parent.children = parent.children.filter((child) => child !== nodeId);
      this.nodes.delete(nodeId);
    };
    drop(id);
  }
}
