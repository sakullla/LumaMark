import { IndexedDbRepository } from '../../../../packages/storage/src/index';
import {
  applyBookmarkUpdate,
  assignToolbar,
  BookmarkService,
  Collection,
  domainFromUrl,
  normalizeUrl,
  type Bookmark,
  type BookmarkRepository,
  type CreateBookmarkInput,
  type DuplicateAction,
  type SyncConfig,
} from '../../../../packages/domain/src/index';
import { exportLumaMarkJson, parseBookmarksHtml, parseLumaMarkJson, planImport, type DuplicateImportAction, type ImportPlan } from '../../../../packages/import-export/src/index';
import { WebDavSyncEngine, type WebDavClient, type SyncManifest } from '../../../../packages/sync/src/index';
import {
  captureActivePage,
  isSavablePageUrl,
  notifyMessage,
  notifySaveResult,
  registerSaveEntrypoints,
  resolveExtensionApi,
  sameLinkUrl,
  titleForSavedLink,
  type SaveMenuInfo,
  type WebExtensionApi,
} from '../../../../packages/browser/src/index';
import { copyFor, languageFromApi, notificationCopy } from '../ui/copy';
import { DEFAULT_SEARCH_URL, nextSiblingPosition, normalizeSearchUrl, toolbarFolder } from '../ui/bar';
import { placeItem } from './place';
import { probeWebDav } from './probe';

function webDavClient(config: SyncConfig): WebDavClient {
  const endpoint = `${config.url.replace(/\/$/, '')}/${config.path.replace(/^\//, '')}`;
  const headers = (): Record<string, string> => {
    const value = config.username ? `${config.username}:${config.password ?? ''}` : '';
    const result: Record<string, string> = { 'Content-Type': 'application/json' };
    if (value) result.Authorization = `Basic ${btoa(value)}`;
    return result;
  };
  return {
    async read() {
      const response = await fetch(endpoint, { headers: headers() });
      if (!response.ok) throw new Error(`WebDAV read failed (${response.status})`);
      const manifest = await response.json() as SyncManifest;
      return { manifest, etag: response.headers.get('etag') ?? undefined };
    },
    async write(manifest, etag) {
      const response = await fetch(endpoint, { method: 'PUT', headers: { ...headers(), ...(etag ? { 'If-Match': etag } : {}) }, body: JSON.stringify(manifest) });
      if (!response.ok) throw new Error(`WebDAV write failed (${response.status})`);
      return { etag: response.headers.get('etag') ?? undefined };
    },
  };
}

/** Apply an import plan without turning an update into a second record. */
export async function applyImportPlan(plan: ImportPlan, service: BookmarkService, repository: BookmarkRepository): Promise<number> {
  for (const entry of plan.entries) {
    if (entry.action === 'update' && entry.existing) {
      await service.update(entry.existing.id, {
        title: entry.bookmark.title,
        faviconUrl: entry.bookmark.faviconUrl,
        notes: entry.bookmark.notes,
        tags: entry.bookmark.tags,
        collectionId: entry.bookmark.collectionId,
        position: entry.bookmark.position,
        favorite: entry.bookmark.favorite,
      });
    } else {
      await repository.put(entry.bookmark);
    }
  }
  return plan.entries.length;
}

const SEARCH_KEY = 'searchUrl';
const UNDO_KEY = 'undoRecords';

interface StoredUndo {
  token: string;
  op: 'remove' | 'restore';
  ids: string[];
  notificationId?: string;
}

function isStoredUndo(value: unknown): value is StoredUndo {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<StoredUndo>;
  return (item.op === 'remove' || item.op === 'restore')
    && typeof item.token === 'string'
    && Array.isArray(item.ids)
    && item.ids.every((id) => typeof id === 'string');
}

export function startBackground(api = resolveExtensionApi(), repository = new IndexedDbRepository()): void {
  const service = new BookmarkService(repository);
  let syncConfig: SyncConfig | undefined;
  let autoSyncTimer: ReturnType<typeof setTimeout> | undefined;
  let memorySearchUrl = DEFAULT_SEARCH_URL;
  let undoMemory: StoredUndo[] = [];
  let undoChain: Promise<void> = Promise.resolve();
  const linkTitles = new Map<string, string>();
  let lastSavePage: { url: string; title?: string; faviconUrl?: string } | undefined;
  let lastSaveOptions: { collectionId?: string; tags?: string[]; notes?: string } = {};
  const notices = () => notificationCopy(languageFromApi(api));
  const enqueueUndo = <T>(work: () => Promise<T>): Promise<T> => {
    const run = undoChain.then(work, work);
    undoChain = run.then(() => undefined, () => undefined);
    return run;
  };
  const readUndos = async (): Promise<StoredUndo[]> => {
    if (api.storage?.local) {
      try {
        const stored = await api.storage.local.get(UNDO_KEY);
        const value = stored?.[UNDO_KEY];
        if (Array.isArray(value)) {
          undoMemory = value.filter(isStoredUndo);
          return undoMemory;
        }
      } catch { /* this session keeps the in-memory list */ }
    }
    return undoMemory;
  };
  const writeUndos = async (records: StoredUndo[]): Promise<void> => {
    undoMemory = records;
    try {
      if (api.storage?.local) await api.storage.local.set({ [UNDO_KEY]: records });
    } catch { /* memory still serves this session */ }
  };
  const rememberUndo = (record: StoredUndo) => enqueueUndo(async () => {
    const records = (await readUndos()).filter((item) => item.token !== record.token);
    records.push(record);
    await writeUndos(records);
  });
  const performUndo = async (key: string): Promise<boolean> => {
    if (!key) return false;
    const record = await enqueueUndo(async () => {
      const records = await readUndos();
      const index = records.findIndex((item) => item.token === key || item.notificationId === key);
      if (index < 0) return undefined;
      const [found] = records.splice(index, 1);
      await writeUndos(records);
      return found;
    });
    if (!record) return false;
    for (const id of record.ids) {
      const current = await repository.findById(id);
      if (!current) continue;
      if (record.op === 'remove') {
        if (!current.deletedAt) await service.remove(id);
      } else if (current.deletedAt) {
        await service.restore(id);
      }
    }
    return true;
  };
  const rememberLinkTitle = (url: string, title: string) => {
    let key = url;
    try { key = new URL(url).href; } catch { /* keep the raw address */ }
    linkTitles.set(key, title);
    if (linkTitles.size <= 20) return;
    const oldest = linkTitles.keys().next().value;
    if (oldest) linkTitles.delete(oldest);
  };
  const hintedTitle = (url: string): string | undefined => {
    for (const [savedUrl, title] of linkTitles) {
      if (sameLinkUrl(savedUrl, url)) return title;
    }
    return undefined;
  };
  api.notifications?.onButtonClicked?.addListener((id, index) => {
    if (index !== 1) return;
    void performUndo(id);
  });
  const openExtensionPage = async (page: string) => {
    const url = api.runtime?.getURL?.(page) ?? page;
    await api.tabs.create?.({ url });
  };
  const notifyUnsavable = async () => {
    const copy = notices();
    await notifyMessage(api, copy.unsavableTitle, copy.unsavableMessage);
  };
  const notifyFailed = async () => {
    const copy = notices();
    await notifyMessage(api, copy.failedTitle, copy.failedMessage);
  };
  const defaultCollectionId = async () => toolbarFolder(await repository.listCollections())?.id;
  const readSearchUrl = async () => {
    try {
      const stored = await api.storage?.local.get(SEARCH_KEY);
      const value = stored?.[SEARCH_KEY];
      if (typeof value === 'string') memorySearchUrl = normalizeSearchUrl(value);
    } catch { /* keep the last address loaded on this browser */ }
    return memorySearchUrl;
  };
  const writeSearchUrl = async (value: string) => {
    memorySearchUrl = normalizeSearchUrl(value);
    if (api.storage?.local) await api.storage.local.set({ [SEARCH_KEY]: memorySearchUrl });
    return memorySearchUrl;
  };

  const saveTarget = async (
    input: { url: string; title?: string; faviconUrl?: string; tags?: string[]; notes?: string; collectionId?: string | null },
    duplicate: DuplicateAction = 'existing',
  ) => {
    if (!isSavablePageUrl(input.url)) {
      await notifyUnsavable();
      return { ok: false as const, unsavable: true };
    }
    lastSavePage = { url: input.url, title: input.title, faviconUrl: input.faviconUrl };
    lastSaveOptions = { tags: input.tags, notes: input.notes, collectionId: input.collectionId ?? undefined };
    try {
      const draft: CreateBookmarkInput = {
        url: input.url,
        title: input.title,
        faviconUrl: input.faviconUrl,
        notes: input.notes,
        tags: input.tags,
      };
      if (duplicate !== 'update') {
        draft.collectionId = input.collectionId === undefined ? await defaultCollectionId() : input.collectionId ?? undefined;
        draft.position = nextSiblingPosition(draft.collectionId, await repository.list({ includeDeleted: true }), await repository.listCollections());
      } else if (input.collectionId !== undefined) {
        draft.collectionId = input.collectionId ?? undefined;
      }
      const result = await service.save(draft, duplicate);
      const copy = notices();
      let undoToken: string | undefined;
      if (result.kind === 'saved' && duplicate !== 'update') {
        undoToken = crypto.randomUUID();
        await rememberUndo({ token: undoToken, op: 'remove', ids: [result.bookmark.id] });
      }
      const notificationId = await notifySaveResult(api, result, {
        openLibrary: () => openExtensionPage('library.html'),
        undo: () => { if (undoToken) void performUndo(undoToken); },
        openExisting: async () => { if (result.kind === 'existing') await api.tabs.create?.({ url: result.existing.url }); },
        updateExisting: async () => {
          if (result.kind === 'existing') await service.save({ url: input.url, title: input.title, faviconUrl: input.faviconUrl, notes: input.notes, tags: input.tags }, 'update');
        },
        copyExisting: async () => {
          if (result.kind !== 'existing') return;
          const collectionId = await defaultCollectionId();
          const position = nextSiblingPosition(collectionId, await repository.list({ includeDeleted: true }), await repository.listCollections());
          await service.save({ url: input.url, title: input.title, faviconUrl: input.faviconUrl, notes: input.notes, tags: input.tags, collectionId, position }, 'copy');
        },
      }, copy);
      if (undoToken && notificationId && result.kind === 'saved') {
        await rememberUndo({ token: undoToken, op: 'remove', ids: [result.bookmark.id], notificationId });
      }
      return { ok: true as const, result, ...(undoToken ? { undoToken } : {}) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/only http|url is required/i.test(message)) {
        await notifyUnsavable();
        return { ok: false as const, unsavable: true };
      }
      await notifyFailed();
      return { ok: false as const, error: message };
    }
  };

  const saveFromMenu = async (info?: SaveMenuInfo) => {
    if (info?.linkUrl) {
      const hinted = hintedTitle(info.linkUrl);
      await saveTarget({ url: info.linkUrl, title: titleForSavedLink(info, hinted) });
      return;
    }
    try {
      const page = await captureActivePage(api);
      await saveTarget(page);
    } catch {
      await notifyUnsavable();
    }
  };

  const loadSyncConfig = async () => {
    syncConfig = await repository.getSyncConfig();
    return syncConfig;
  };
  const scheduleAutoSync = () => {
    if (autoSyncTimer) clearTimeout(autoSyncTimer);
    if (!syncConfig?.autoSync || !syncConfig.url) return;
    autoSyncTimer = setTimeout(async () => {
      if (!syncConfig?.autoSync) return;
      const result = await new WebDavSyncEngine(repository, webDavClient(syncConfig)).sync();
      if (result.status === 'error') {
        syncConfig = { ...syncConfig, autoSync: false };
        await repository.setSyncConfig(syncConfig);
        const metadata = await repository.getSyncMetadata();
        await repository.setSyncMetadata({ ...metadata, autoSync: false });
      } else scheduleAutoSync();
    }, 5 * 60 * 1000);
  };
  void loadSyncConfig().then(scheduleAutoSync);
  registerSaveEntrypoints(api, saveFromMenu, copyFor(languageFromApi(api)).contextSave);

  api.runtime?.onMessage?.addListener((message: unknown, _sender: unknown, sendResponse) => {
    const type = typeof message === 'object' && message !== null && 'type' in message
      ? (message as { type?: string }).type : undefined;
    const payload = (message as { payload?: Record<string, any> }).payload ?? {};
    const accept = (work: () => Promise<unknown>) => {
      void work().then(sendResponse).catch((error) => {
        const messageText = error instanceof Error ? error.message : String(error);
        const unsavable = /only http|unable to read the active page|url is required/i.test(messageText);
        sendResponse({ ok: false, error: unsavable ? 'unsavable' : messageText, unsavable });
      });
      return true;
    };

    if (type === 'lumamark-link-context') {
      const url = typeof payload.url === 'string' ? payload.url : '';
      const title = typeof payload.title === 'string' ? payload.title : '';
      if (url) rememberLinkTitle(url, title);
      sendResponse({ ok: true });
      return true;
    }
    if (type === 'lumamark-save') return accept(async () => {
      try {
        const page = await captureActivePage(api);
        return await saveTarget({
          url: page.url,
          title: page.title,
          faviconUrl: page.faviconUrl,
          tags: Array.isArray(payload.tags) ? payload.tags : undefined,
          notes: payload.notes !== undefined ? String(payload.notes) : undefined,
          collectionId: payload.collectionId ? String(payload.collectionId) : undefined,
        });
      } catch {
        await notifyUnsavable();
        return { ok: false, unsavable: true };
      }
    });
    if (type === 'lumamark-capture') return accept(async () => {
      try {
        const page = await captureActivePage(api);
        lastSavePage = page;
        const savable = isSavablePageUrl(page.url);
        const found = savable ? await repository.findByUrl(normalizeUrl(page.url)) : undefined;
        return { ok: true, page, savable, existing: found && !found.deletedAt ? found : undefined };
      } catch {
        return { ok: true, page: {}, savable: false, unsavable: true };
      }
    });
    if (type === 'lumamark-open-library') return accept(async () => { await openExtensionPage('library.html'); return { ok: true }; });
    if (type === 'lumamark-open-home') return accept(async () => { await openExtensionPage('home.html'); return { ok: true }; });
    if (type === 'lumamark-open-existing') return accept(async () => {
      const url = typeof payload.url === 'string' && payload.url ? payload.url : lastSavePage?.url;
      if (!url || !isSavablePageUrl(url)) return { ok: false, unsavable: true };
      await api.tabs.create?.({ url });
      return { ok: true };
    });
    if (type === 'lumamark-undo') return accept(async () => {
      const token = typeof payload.token === 'string' ? payload.token : '';
      if (!token) return { ok: false };
      return { ok: await performUndo(token) };
    });
    if (type === 'lumamark-update-existing' || type === 'lumamark-copy-existing') return accept(async () => {
      if (!lastSavePage?.url) return { ok: false, unsavable: true };
      return saveTarget({
        url: lastSavePage.url,
        title: payload.title ? String(payload.title) : lastSavePage.title,
        faviconUrl: lastSavePage.faviconUrl,
        tags: Array.isArray(payload.tags) ? payload.tags : lastSaveOptions.tags,
        notes: payload.notes !== undefined ? String(payload.notes) : lastSaveOptions.notes,
        collectionId: payload.collectionId === undefined ? lastSaveOptions.collectionId : payload.collectionId,
      }, type === 'lumamark-update-existing' ? 'update' : 'copy');
    });
    if (type === 'lumamark-list') return accept(async () => {
      const items = await repository.list({ includeDeleted: payload.includeDeleted ?? false, text: payload.text });
      return { ok: true, items };
    });
    if (type === 'lumamark-list-collections') return accept(async () => ({ ok: true, items: await repository.listCollections() }));
    if (type === 'lumamark-collection-create') return accept(async () => {
      const now = new Date().toISOString();
      const collection: Collection = { id: crypto.randomUUID(), name: String(payload.name ?? '').trim() || 'New collection', position: Date.now(), toolbar: false, createdAt: now, updatedAt: now, revision: 1 };
      await repository.putCollection(collection);
      return { ok: true, item: collection };
    });
    if (type === 'lumamark-collection-delete') return accept(async () => {
      const items = await repository.listCollections();
      const current = items.find((item) => item.id === payload.id);
      if (!current) throw new Error('Collection not found');
      const deleted = { ...current, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: current.revision + 1 };
      await repository.putCollection(deleted);
      return { ok: true, item: deleted };
    });
    if (type === 'lumamark-collection-restore') return accept(async () => {
      const items = await repository.listCollections();
      const current = items.find((item) => item.id === payload.id);
      if (!current) throw new Error('Collection not found');
      const restored = { ...current, deletedAt: undefined, updatedAt: new Date().toISOString(), revision: current.revision + 1 };
      await repository.putCollection(restored);
      return { ok: true, item: restored };
    });
    if (type === 'lumamark-list-conflicts') return accept(async () => ({ ok: true, items: await repository.listConflicts() }));
    if (type === 'lumamark-sync-status') return accept(async () => ({ ok: true, metadata: await repository.getSyncMetadata() }));
    if (type === 'lumamark-resolve-conflict') return accept(async () => {
      const config = syncConfig ?? await loadSyncConfig();
      if (!config?.url) throw new Error('WebDAV is not configured');
      const item = await new WebDavSyncEngine(repository, webDavClient(config)).resolveConflict(String(payload.id), payload.resolution, payload.merged);
      return { ok: true, item };
    });
    if (type === 'lumamark-favorite') return accept(async () => {
      const current = await repository.findById(String(payload.id));
      if (!current) throw new Error('Bookmark not found');
      const item = await service.update(String(payload.id), { favorite: payload.favorite ?? !current.favorite });
      return { ok: true, item };
    });
    if (type === 'lumamark-update') return accept(async () => {
      const ids = (Array.isArray(payload.ids) ? payload.ids : [payload.id]).filter(Boolean).map(String);
      const update = payload.update ?? {};
      try {
        const url = update.url !== undefined ? normalizeUrl(String(update.url)) : undefined;
        const items: Bookmark[] = [];
        for (const id of ids) {
          const current = await repository.findById(id);
          if (!current) throw new Error('Bookmark not found');
          const next = applyBookmarkUpdate(current, {
            title: update.title,
            notes: update.notes,
            tags: update.tags,
            collectionId: update.collectionId,
            position: update.position,
            favorite: update.favorite,
            faviconUrl: update.faviconUrl,
          });
          const stored = { ...next, url: url ?? next.url, domain: domainFromUrl(url ?? next.url) };
          await repository.put(stored);
          items.push(stored);
        }
        return { ok: true, items };
      } catch (error) {
        const invalid = /only http|url is required/i.test(String(error));
        return { ok: false, error: invalid ? 'invalid-url' : String(error) };
      }
    });
    if (type === 'lumamark-delete') return accept(async () => {
      const ids = (Array.isArray(payload.ids) ? payload.ids : [payload.id]).filter(Boolean).map(String);
      const items = [];
      for (const id of ids) items.push(await service.remove(id));
      const undoToken = crypto.randomUUID();
      await rememberUndo({ token: undoToken, op: 'restore', ids: items.map((item) => item.id) });
      return { ok: true, items, undoToken };
    });
    if (type === 'lumamark-restore') return accept(async () => ({ ok: true, item: await service.restore(String(payload.id)) }));
    if (type === 'lumamark-reorder') return accept(async () => {
      await placeItem(repository, {
        kind: payload.kind === 'folder' ? 'folder' : 'bookmark',
        id: String(payload.id),
        parentId: payload.parentId ? String(payload.parentId) : undefined,
        beforeId: payload.beforeId ? String(payload.beforeId) : undefined,
      });
      return { ok: true };
    });
    if (type === 'lumamark-set-toolbar') return accept(async () => {
      const items = await repository.listCollections();
      const id = payload.id ? String(payload.id) : undefined;
      if (id && !items.some((item) => item.id === id && !item.deletedAt)) throw new Error('Folder not found');
      const next = assignToolbar(items, id);
      for (const collection of next) {
        const previous = items.find((item) => item.id === collection.id);
        if (!previous) continue;
        const before = previous.toolbar === true;
        if (before === collection.toolbar && previous.revision === collection.revision) continue;
        await repository.putCollection(collection);
      }
      return { ok: true };
    });
    if (type === 'lumamark-get-search-engine') return accept(async () => ({ ok: true, url: await readSearchUrl() }));
    if (type === 'lumamark-set-search-engine') return accept(async () => ({ ok: true, url: await writeSearchUrl(String(payload.url ?? '')) }));
    if (type === 'lumamark-get-sync-config') return accept(async () => {
      const config = syncConfig ?? await loadSyncConfig();
      return {
        ok: true,
        config: {
          url: config?.url ?? '',
          path: config?.path ?? '',
          username: config?.username ?? '',
          autoSync: Boolean(config?.autoSync),
          configured: Boolean(config?.url),
        },
      };
    });
    if (type === 'lumamark-set-auto-sync') return accept(async () => {
      const current = syncConfig ?? await loadSyncConfig();
      if (!current?.url) return { ok: true, autoSync: false };
      syncConfig = { ...current, autoSync: Boolean(payload.autoSync) };
      await repository.setSyncConfig(syncConfig);
      const metadata = await repository.getSyncMetadata();
      await repository.setSyncMetadata({ ...metadata, autoSync: syncConfig.autoSync });
      scheduleAutoSync();
      return { ok: true, autoSync: syncConfig.autoSync };
    });
    if (type === 'lumamark-sync-configure') return accept(async () => {
      const url = String(payload.url ?? '').trim();
      const path = String(payload.path ?? 'lumamark.json').trim() || 'lumamark.json';
      const username = payload.username ? String(payload.username) : undefined;
      const previous = syncConfig ?? await repository.getSyncConfig();
      // An empty field must not wipe the stored secret; the page never redisplays it.
      const password = payload.password ? String(payload.password) : previous?.password;
      if (!url) {
        syncConfig = { key: 'sync-config', url: '', path, username, password, autoSync: false };
        await repository.setSyncConfig(syncConfig);
        const metadata = await repository.getSyncMetadata();
        await repository.setSyncMetadata({ ...metadata, autoSync: false, status: 'idle', error: undefined });
        scheduleAutoSync();
        return { ok: true, probe: 'empty', autoSync: false };
      }
      const probe = await probeWebDav({ url, path, username, password });
      const autoSync = probe.kind === 'ok';
      syncConfig = { key: 'sync-config', url, path, username, password, autoSync };
      await repository.setSyncConfig(syncConfig);
      const metadata = await repository.getSyncMetadata();
      await repository.setSyncMetadata({
        ...metadata,
        autoSync,
        status: probe.kind === 'ok' ? 'idle' : probe.kind === 'unreachable' ? 'offline' : 'error',
        error: probe.kind === 'ok' ? undefined : probe.kind,
      });
      scheduleAutoSync();
      return { ok: true, probe: probe.kind, autoSync, status: probe.status };
    });
    if (type === 'lumamark-sync') return accept(async () => {
      const config = syncConfig ?? await loadSyncConfig();
      if (!config?.url) return { ok: false, status: 'error', error: 'WebDAV is not configured' };
      const result = await new WebDavSyncEngine(repository, webDavClient(config)).sync();
      if (result.status === 'error' && config.autoSync) {
        syncConfig = { ...config, autoSync: false };
        await repository.setSyncConfig(syncConfig);
        const metadata = await repository.getSyncMetadata();
        await repository.setSyncMetadata({ ...metadata, autoSync: false });
      }
      return result;
    });
    if (type === 'lumamark-export') return accept(async () => {
      const [bookmarks, collections] = await Promise.all([repository.list({ includeDeleted: true }), repository.listCollections()]);
      return { ok: true, content: exportLumaMarkJson(bookmarks, collections) };
    });
    if (type === 'lumamark-import') return accept(async () => {
      const parsed = payload.format === 'html' ? parseBookmarksHtml(String(payload.content ?? '')) : parseLumaMarkJson(String(payload.content ?? ''));
      const existing = await repository.list({ includeDeleted: true });
      const action = (['skip', 'update', 'copy'] as const).includes(payload.action) ? payload.action as DuplicateImportAction : 'skip';
      const plan = planImport(parsed, existing, action);
      await applyImportPlan(plan, service, repository);
      for (const collection of parsed.collections as Collection[]) await repository.putCollection(collection);
      return { ok: true, issues: plan.issues, imported: plan.entries.length, duplicateAction: action, choices: plan.issues.filter((issue) => issue.kind === 'duplicate').length };
    });
    return undefined;
  });
}

if (typeof globalThis !== 'undefined') {
  try { startBackground(); } catch { /* popup/tests can inject a fake API */ }
}
