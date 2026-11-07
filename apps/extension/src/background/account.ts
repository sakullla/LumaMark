import { CURRENT_SCHEMA_VERSION, type Bookmark, type Collection, type ConflictRecord, type SyncMetadata } from '../../../../packages/domain/src/index';
import { IndexedDbRepository } from '../../../../packages/storage/src/index';
import {
  compactSyncManifest,
  expandSyncBookmarks,
  WebDavSyncEngine,
  type SyncManifest,
  type SyncRepository,
  type WebDavClient,
} from '../../../../packages/sync/src/index';
import {
  copyUnauthenticatedLibrary,
  isEmptyAccount,
  mergeLoginLibraries,
  type LoginLibrary,
  type LoginMergeResult,
} from '../../../../packages/sync/src/login-merge';
import type { NativeBookmarksApi } from '../../../../packages/browser/src/index';
import { reconcileNativeBookmarks, type BridgeRepository, type BridgeStateStore } from './native';

/** Unauthenticated bookmarks always live in this IndexedDB. Login never deletes it. */
export const GUEST_DATABASE = 'lumamark';
/** The one library that holds whichever account is signed in. */
export const ACCOUNT_DATABASE = 'lumamark-account';
export const ACCOUNT_SESSION_KEY = 'lumamarkAccountSession';

export interface AccountSession {
  serverUrl: string;
  username: string;
  token: string;
}

export interface AccountSessionStore {
  load(): Promise<AccountSession | undefined>;
  save(session: AccountSession | undefined): Promise<void>;
}

export interface AccountLibrary extends SyncRepository {
  reset(): Promise<void>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type AccountLibraryName = 'guest' | 'account';

export interface AccountResult {
  ok: boolean;
  status: 'signed-in' | 'choice' | 'cancelled' | 'signed-out' | 'failed';
  username?: string;
  error?: string;
}

/**
 * Safari does not rewrite the browser's own bookmarks.
 * Chrome, Edge, and Firefox do, and so does a test runtime that is not Safari.
 */
export function browserSkipsNativeBookmarks(input: { userAgent?: string; extensionUrl?: string } = {}): boolean {
  if (/safari-web-extension:/i.test(input.extensionUrl ?? '')) return true;
  const agent = input.userAgent ?? '';
  return /safari/i.test(agent) && !/chrome|chromium|edg\//i.test(agent);
}

/** Synced only after a write has finished and nothing newer is waiting. */
export function showsSynced(metadata: Pick<SyncMetadata, 'status' | 'pendingChanges' | 'lastSyncAt'> | undefined): boolean {
  return Boolean(metadata && metadata.status === 'idle' && (metadata.pendingChanges ?? 0) === 0 && metadata.lastSyncAt);
}

export async function markUnsynced(store: Pick<SyncRepository, 'getSyncMetadata' | 'setSyncMetadata'>): Promise<void> {
  const metadata = await store.getSyncMetadata();
  const pending = Math.max(metadata.pendingChanges ?? 0, 1);
  if (metadata.pendingChanges === pending && metadata.status !== 'idle') return;
  await store.setSyncMetadata({ ...metadata, pendingChanges: pending });
}

export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/$/, '');
  const url = new URL(trimmed);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Server address must be http or https');
  return trimmed;
}

/** Bearer client for the account manifest. If-Match is the ETag bytes from GET, quotes included once. */
export function accountManifestClient(session: Pick<AccountSession, 'serverUrl' | 'token'>, fetchImpl: FetchLike = fetch): WebDavClient {
  const root = normalizeServerUrl(session.serverUrl);
  const auth = { Authorization: `Bearer ${session.token}` };
  return {
    async read() {
      const response = await fetchImpl(`${root}/api/manifest`, {
        cache: 'no-store',
        headers: { ...auth, 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) throw Object.assign(new Error(`Account read failed (${response.status})`), { status: response.status });
      const manifest = await response.json() as SyncManifest;
      return { manifest, etag: response.headers.get('etag') ?? undefined };
    },
    async write(manifest, etag) {
      const headers: Record<string, string> = { ...auth, 'Content-Type': 'application/json' };
      if (etag !== undefined) headers['If-Match'] = etag;
      const response = await fetchImpl(`${root}/api/manifest`, { method: 'PUT', headers, body: JSON.stringify(manifest) });
      if (!response.ok) throw Object.assign(new Error(`Account write failed (${response.status})`), { status: response.status });
      const header = response.headers.get('etag');
      let bodyEtag: string | undefined;
      const text = await response.text();
      if (text) {
        try {
          const body = JSON.parse(text) as { etag?: unknown };
          if (typeof body.etag === 'string') bodyEtag = body.etag;
        } catch { /* the header is the version the next write must send */ }
      }
      return { etag: header || bodyEtag };
    },
  };
}

export async function openAccountSession(
  input: { serverUrl: string; username: string; password: string },
  fetchImpl: FetchLike = fetch,
): Promise<AccountSession> {
  const serverUrl = normalizeServerUrl(input.serverUrl);
  const response = await fetchImpl(`${serverUrl}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: input.username, password: input.password }),
  });
  if (!response.ok) throw Object.assign(new Error(`Account sign-in failed (${response.status})`), { status: response.status });
  const body = await response.json() as { username?: unknown; token?: unknown };
  if (typeof body.token !== 'string' || !body.token) throw Object.assign(new Error('Account sign-in failed (401)'), { status: 401 });
  return { serverUrl, username: typeof body.username === 'string' && body.username ? body.username : input.username.trim(), token: body.token };
}

export async function closeAccountSession(session: AccountSession, fetchImpl: FetchLike = fetch): Promise<void> {
  const response = await fetchImpl(`${normalizeServerUrl(session.serverUrl)}/api/session`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (!response.ok && response.status !== 401) throw Object.assign(new Error(`Account sign-out failed (${response.status})`), { status: response.status });
}

export async function resetIndexedRepository(repository: IndexedDbRepository, name: string): Promise<void> {
  await repository.close();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Unable to reset the account library'));
    request.onblocked = () => resolve();
  });
}

export function openAccountLibrary(name = ACCOUNT_DATABASE): IndexedDbRepository & { reset(): Promise<void> } {
  const repository = new IndexedDbRepository(name);
  return Object.assign(repository, { reset: () => resetIndexedRepository(repository, name) });
}

interface LibrarySnapshot {
  bookmarks: Bookmark[];
  collections: Collection[];
  metadata: SyncMetadata;
  conflicts: ConflictRecord[];
}

async function captureLibrary(store: SyncRepository): Promise<LibrarySnapshot> {
  const [bookmarks, collections, metadata, conflicts] = await Promise.all([
    store.list({ includeDeleted: true }),
    store.listCollections(),
    store.getSyncMetadata(),
    store.listConflicts(true),
  ]);
  return { bookmarks, collections, metadata, conflicts };
}

async function installSnapshot(store: AccountLibrary, snapshot: LibrarySnapshot): Promise<void> {
  await store.reset();
  for (const bookmark of snapshot.bookmarks) await store.put(bookmark);
  for (const collection of snapshot.collections) await store.putCollection(collection);
  await store.setSyncMetadata(snapshot.metadata);
  for (const conflict of snapshot.conflicts) await store.putConflict(conflict);
}

async function installManifest(store: AccountLibrary, manifest: SyncManifest, syncedAt: string): Promise<void> {
  const previous = await store.getSyncMetadata();
  const bookmarks = expandSyncBookmarks(manifest.bookmarks ?? [], manifest.purged ?? []);
  const collections = manifest.collections ?? [];
  await store.reset();
  for (const bookmark of bookmarks) await store.put(bookmark);
  for (const collection of collections) await store.putCollection(collection);
  await store.setSyncMetadata({
    key: 'sync',
    deviceId: previous.deviceId,
    lastSyncAt: syncedAt,
    pendingChanges: 0,
    status: 'idle',
    autoSync: false,
    error: undefined,
  });
}

function libraryFromManifest(manifest: SyncManifest | undefined): LoginLibrary {
  const purged = [...(manifest?.purged ?? [])];
  return {
    bookmarks: expandSyncBookmarks(manifest?.bookmarks ?? [], purged),
    collections: manifest?.collections ?? [],
    purged,
  };
}

function manifestFromLibrary(result: LoginMergeResult, deviceId: string, now: string): SyncManifest {
  return compactSyncManifest({
    format: 'lumamark-sync',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    generatedAt: now,
    deviceId,
    bookmarks: result.bookmarks.map((item) => ({ ...item, tags: [...item.tags] })),
    collections: result.collections.map((item) => ({ ...item })),
    purged: [...result.purged],
  });
}

function emptyManifest(deviceId: string, now: string): SyncManifest {
  return {
    format: 'lumamark-sync',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    generatedAt: now,
    deviceId,
    bookmarks: [],
    collections: [],
  };
}

/** Empty the browser bar, then let the existing bridge create the active library. Does not touch the other library. */
export async function replaceBrowserBookmarks(
  native: NativeBookmarksApi,
  repository: BridgeRepository,
  bridge: BridgeStateStore,
): Promise<void> {
  const tree = await native.getTree();
  for (const root of tree[0]?.children ?? []) {
    for (const child of [...(root.children ?? [])]) {
      if (child.unmodifiable) continue;
      if (child.url || child.type === 'separator') await native.remove(child.id);
      else await native.removeTree(child.id);
    }
  }
  await bridge.save({ version: 1, links: [], orders: {} });
  const report = await reconcileNativeBookmarks(native, repository, bridge);
  if (report.errors.length) throw new Error(report.errors.join('; '));
}

interface PendingLogin {
  session: AccountSession;
  manifest: SyncManifest;
  etag?: string;
}

export interface AccountPorts {
  guest: SyncRepository;
  account: AccountLibrary;
  fetch: FetchLike;
  now?: () => string;
  rewriteEnabled: () => boolean | Promise<boolean>;
  rewriteBar: (which: AccountLibraryName) => Promise<void>;
  sessionStore?: AccountSessionStore;
}

/**
 * Sign-in, overwrite, merge, sign-out, and account switch.
 * Login merge uses login-merge.ts. Later edits of the same id still use WebDavSyncEngine.
 */
export class AccountFlow {
  active: AccountLibraryName = 'guest';
  session?: AccountSession;
  private pending?: PendingLogin;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly ports: AccountPorts) {}

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work);
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  private now(): string {
    return this.ports.now?.() ?? new Date().toISOString();
  }

  private failed(error: unknown): AccountResult {
    return { ok: false, status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }

  adopt(session: AccountSession): void {
    this.session = session;
    this.active = 'account';
    this.pending = undefined;
  }

  /** Publish local account edits. Conflict or a failed write leaves the account unsigned-out state unchanged. */
  async writeBack(): Promise<AccountResult> {
    return this.enqueue(() => this.writeBackNow());
  }

  private async writeBackNow(): Promise<AccountResult> {
    if (this.active !== 'account' || !this.session) return { ok: true, status: 'signed-in' };
    const engine = new WebDavSyncEngine(this.ports.account, accountManifestClient(this.session, this.ports.fetch));
    const result = await engine.sync();
    if (result.status === 'error') return { ok: false, status: 'failed', error: result.error ?? 'Account write failed' };
    if (result.status === 'conflict') return { ok: false, status: 'failed', error: 'Resolve sync conflicts before switching accounts' };
    return { ok: true, status: 'signed-in', username: this.session.username };
  }

  async login(input: { serverUrl: string; username: string; password: string }): Promise<AccountResult> {
    return this.enqueue(() => this.loginNow(input));
  }

  private async loginNow(input: { serverUrl: string; username: string; password: string }): Promise<AccountResult> {
    if (this.active === 'account') return { ok: false, status: 'failed', error: 'Already signed in' };
    await this.discardPending();
    let session: AccountSession;
    try {
      session = await openAccountSession(input, this.ports.fetch);
    } catch (error) {
      return this.failed(error);
    }
    try {
      const remote = await accountManifestClient(session, this.ports.fetch).read();
      const manifest = remote.manifest ?? emptyManifest((await this.ports.guest.getSyncMetadata()).deviceId, this.now());
      if (!isEmptyAccount(libraryFromManifest(manifest))) {
        this.pending = { session, manifest, etag: remote.etag };
        return { ok: true, status: 'choice', username: session.username };
      }
      return await this.finishEmpty(session, manifest, remote.etag);
    } catch (error) {
      await this.dropToken(session);
      return this.failed(error);
    }
  }

  async choose(choice: 'overwrite' | 'merge' | 'cancel'): Promise<AccountResult> {
    return this.enqueue(() => this.chooseNow(choice));
  }

  private async chooseNow(choice: 'overwrite' | 'merge' | 'cancel'): Promise<AccountResult> {
    const pending = this.pending;
    if (!pending || this.active === 'account') return { ok: false, status: 'failed', error: 'Nothing to choose' };
    if (choice === 'cancel') {
      this.pending = undefined;
      await this.dropToken(pending.session);
      return { ok: true, status: 'cancelled' };
    }
    this.pending = undefined;
    try {
      if (choice === 'overwrite') return await this.finishInstalled(pending.session, pending.manifest, false);
      const guest = await this.readGuest();
      const merged = mergeLoginLibraries(libraryFromManifest(pending.manifest), guest);
      const manifest = manifestFromLibrary(merged, (await this.ports.guest.getSyncMetadata()).deviceId, this.now());
      return await this.finishWritten(pending.session, pending.manifest, pending.etag, manifest);
    } catch (error) {
      await this.dropToken(pending.session);
      return this.failed(error);
    }
  }

  async logout(): Promise<AccountResult> {
    return this.enqueue(() => this.logoutNow());
  }

  private async logoutNow(): Promise<AccountResult> {
    if (this.active !== 'account' || !this.session) return { ok: true, status: 'signed-out' };
    const session = this.session;
    if (await this.ports.rewriteEnabled()) {
      try {
        await this.ports.rewriteBar('guest');
      } catch (error) {
        return this.failed(error);
      }
    }
    try {
      await this.ports.sessionStore?.save(undefined);
      await this.ports.account.reset();
    } catch (error) {
      this.session = session;
      this.active = 'account';
      try { await this.ports.sessionStore?.save(session); } catch { /* the in-memory session is still this account */ }
      if (await this.ports.rewriteEnabled()) {
        try { await this.ports.rewriteBar('account'); } catch { /* sign-out already failed */ }
      }
      return this.failed(error);
    }
    this.session = undefined;
    this.active = 'guest';
    try { await closeAccountSession(session, this.ports.fetch); } catch { /* the extension session is already gone */ }
    return { ok: true, status: 'signed-out' };
  }

  async switchAccount(input: { serverUrl: string; username: string; password: string }): Promise<AccountResult> {
    return this.enqueue(() => this.switchNow(input));
  }

  private async switchNow(input: { serverUrl: string; username: string; password: string }): Promise<AccountResult> {
    if (this.active !== 'account' || !this.session) return { ok: false, status: 'failed', error: 'Not signed in' };
    const current = this.session;
    const written = await this.writeBackNow();
    if (!written.ok) return written;
    let next: AccountSession;
    try {
      next = await openAccountSession(input, this.ports.fetch);
    } catch (error) {
      return this.failed(error);
    }
    let remote: { manifest?: SyncManifest; etag?: string };
    try {
      remote = await accountManifestClient(next, this.ports.fetch).read();
    } catch (error) {
      await this.dropToken(next);
      return this.failed(error);
    }
    const snapshot = await captureLibrary(this.ports.account);
    const manifest = remote.manifest ?? emptyManifest(snapshot.metadata.deviceId, this.now());
    let barStarted = false;
    try {
      await installManifest(this.ports.account, manifest, this.now());
      this.session = next;
      if (await this.ports.rewriteEnabled()) {
        barStarted = true;
        await this.ports.rewriteBar('account');
      }
      await this.ports.sessionStore?.save(next);
    } catch (error) {
      this.session = current;
      this.active = 'account';
      try { await installSnapshot(this.ports.account, snapshot); } catch { /* restore failed; reported below */ }
      if (barStarted) {
        try { await this.ports.rewriteBar('account'); } catch { /* the switch already failed */ }
      }
      await this.dropToken(next);
      try { await this.ports.sessionStore?.save(current); } catch { /* memory still holds the previous session */ }
      return this.failed(error);
    }
    try { await closeAccountSession(current, this.ports.fetch); } catch { /* the new session is the one in use */ }
    return { ok: true, status: 'signed-in', username: next.username };
  }

  private async readGuest(): Promise<LoginLibrary> {
    const bookmarks = await this.ports.guest.list({ includeDeleted: true });
    const collections = await this.ports.guest.listCollections();
    const purged = bookmarks.filter((item) => item.purgedAt).map((item) => item.id);
    return { bookmarks, collections, purged };
  }

  private async finishEmpty(session: AccountSession, remote: SyncManifest, etag?: string): Promise<AccountResult> {
    const copied = copyUnauthenticatedLibrary(libraryFromManifest(remote), await this.readGuest());
    const manifest = manifestFromLibrary(copied, (await this.ports.guest.getSyncMetadata()).deviceId, this.now());
    return this.finishWritten(session, remote, etag, manifest);
  }

  /** Write the account first. Switch only after the server accepts it. */
  private async finishWritten(session: AccountSession, previous: SyncManifest, etag: string | undefined, manifest: SyncManifest): Promise<AccountResult> {
    const client = accountManifestClient(session, this.ports.fetch);
    let wrote: { etag?: string } | undefined;
    try {
      wrote = await client.write(manifest, etag);
    } catch (error) {
      await this.dropToken(session);
      return this.failed(error);
    }
    const installed = await this.finishInstalled(session, manifest, true);
    if (installed.ok) return installed;
    try {
      const match = wrote.etag ?? (await client.read()).etag;
      if (match) await client.write(previous, match);
    } catch { /* the local library was not switched */ }
    await this.dropToken(session);
    return installed;
  }

  /** Put a manifest into the account library, then move the bar. Leave the unsigned library alone. */
  private async finishInstalled(session: AccountSession, manifest: SyncManifest, written: boolean): Promise<AccountResult> {
    let switched = false;
    try {
      await installManifest(this.ports.account, manifest, this.now());
      this.session = session;
      this.active = 'account';
      switched = true;
      if (await this.ports.rewriteEnabled()) await this.ports.rewriteBar('account');
      await this.ports.sessionStore?.save(session);
      return { ok: true, status: 'signed-in', username: session.username };
    } catch (error) {
      const restoreBar = switched && await this.ports.rewriteEnabled();
      this.session = undefined;
      this.active = 'guest';
      if (restoreBar) {
        try { await this.ports.rewriteBar('guest'); } catch { /* still unsigned, bar restore failed */ }
      }
      try { await this.ports.account.reset(); } catch { /* the active library is already the unsigned one */ }
      if (!written) await this.dropToken(session);
      try { await this.ports.sessionStore?.save(undefined); } catch { /* nothing was adopted */ }
      return this.failed(error);
    }
  }

  private async discardPending(): Promise<void> {
    const pending = this.pending;
    this.pending = undefined;
    if (pending) await this.dropToken(pending.session);
  }

  private async dropToken(session: AccountSession): Promise<void> {
    try { await closeAccountSession(session, this.ports.fetch); } catch { /* local state never adopted this token */ }
  }
}
