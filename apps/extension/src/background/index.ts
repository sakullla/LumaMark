import { IndexedDbRepository } from '../../../../packages/storage/src/index';
import { BookmarkService, Collection, type BookmarkRepository, type SyncConfig } from '../../../../packages/domain/src/index';
import { exportLumaMarkJson, parseBookmarksHtml, parseLumaMarkJson, planImport, type DuplicateImportAction, type ImportPlan } from '../../../../packages/import-export/src/index';
import { WebDavSyncEngine, type WebDavClient, type SyncManifest } from '../../../../packages/sync/src/index';
import { notifySaveResult, registerSaveEntrypoints, resolveExtensionApi, saveActivePage } from '../../../../packages/browser/src/index';

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
        favorite: entry.bookmark.favorite,
      });
    } else {
      await repository.put(entry.bookmark);
    }
  }
  return plan.entries.length;
}

export function startBackground(api = resolveExtensionApi()): void {
  const repository = new IndexedDbRepository();
  const service = new BookmarkService(repository);
  let syncConfig: SyncConfig | undefined;
  let autoSyncTimer: ReturnType<typeof setTimeout> | undefined;
  let lastUndo: () => Promise<void> = async () => undefined;
  const openLibrary = async () => {
    const url = api.runtime?.getURL?.('library.html') ?? 'library.html';
    await api.tabs.create?.({ url });
  };
  const save = async () => {
    const result = await saveActivePage(api, service);
    lastUndo = result.kind === 'saved'
      ? async () => { await service.remove(result.bookmark.id); }
      : async () => undefined;
    await notifySaveResult(api, result, {
      openLibrary,
      undo: lastUndo,
      openExisting: openLibrary,
      updateExisting: async () => { if (result.kind === 'existing') await service.save({ url: result.existing.url, title: result.existing.title }, 'update'); },
      copyExisting: async () => { if (result.kind === 'existing') await service.save({ url: result.existing.url, title: result.existing.title }, 'copy'); },
    });
    return result;
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
  registerSaveEntrypoints(api, async () => { await save(); });
  api.runtime?.onMessage?.addListener((message: unknown, _sender: unknown, sendResponse) => {
    const type = typeof message === 'object' && message !== null && 'type' in message
      ? (message as { type?: string }).type : undefined;
    if (type === 'lumamark-save') { void save().then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: String(error) })); return true; }
    if (type === 'lumamark-open-library') { void openLibrary().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: String(error) })); return true; }
    if (type === 'lumamark-undo') { void lastUndo().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: String(error) })); return true; }
    if (type === 'lumamark-list') {
      const payload = (message as { payload?: { text?: string; includeDeleted?: boolean } }).payload;
      void repository.list({ includeDeleted: payload?.includeDeleted ?? false, text: payload?.text }).then((items) => sendResponse({ ok: true, items }));
      return true;
    }
    const payload = (message as { payload?: any }).payload ?? {};
    if (type === 'lumamark-list-collections') { void repository.listCollections().then((items) => sendResponse({ ok: true, items })); return true; }
    if (type === 'lumamark-favorite') {
      void (async () => {
        const current = await repository.findById(payload.id);
        if (!current) throw new Error('Bookmark not found');
        return service.update(payload.id, { favorite: payload.favorite ?? !current.favorite });
      })().then((item) => sendResponse({ ok: true, item })).catch((error) => sendResponse({ ok: false, error: String(error) })); return true;
    }
    if (type === 'lumamark-update') {
      const ids = Array.isArray(payload.ids) ? payload.ids : [payload.id];
      void Promise.all(ids.filter(Boolean).map((id: string) => service.update(id, payload.update ?? {}))).then((items) => sendResponse({ ok: true, items })).catch((error) => sendResponse({ ok: false, error: String(error) })); return true;
    }
    if (type === 'lumamark-delete') {
      const ids = Array.isArray(payload.ids) ? payload.ids : [payload.id];
      let removed: string[] = [];
      void Promise.all(ids.filter(Boolean).map((id: string) => service.remove(id))).then((items) => {
        removed = items.map((item) => item.id);
        lastUndo = async () => { for (const id of removed) await service.restore(id); };
        sendResponse({ ok: true, items });
      }).catch((error) => sendResponse({ ok: false, error: String(error) })); return true;
    }
    if (type === 'lumamark-restore') { void service.restore(payload.id).then((item) => sendResponse({ ok: true, item })).catch((error) => sendResponse({ ok: false, error: String(error) })); return true; }
    if (type === 'lumamark-sync-configure') {
      syncConfig = { key: 'sync-config', url: String(payload.url ?? ''), path: String(payload.path ?? 'lumamark.json'), username: payload.username ? String(payload.username) : undefined, password: payload.password ? String(payload.password) : undefined, autoSync: Boolean(payload.autoSync) };
      void repository.setSyncConfig(syncConfig).then(() => repository.getSyncMetadata()).then((metadata) => repository.setSyncMetadata({ ...metadata, autoSync: syncConfig!.autoSync, status: 'idle', error: undefined })).then(() => { scheduleAutoSync(); sendResponse({ ok: true }); }).catch((error) => sendResponse({ ok: false, error: String(error) })); return true;
    }
    if (type === 'lumamark-sync') {
      void (async () => {
        const config = syncConfig ?? await loadSyncConfig();
        if (!config?.url) { sendResponse({ ok: false, status: 'error', error: 'WebDAV is not configured' }); return; }
        const result = await new WebDavSyncEngine(repository, webDavClient(config)).sync();
        if (result.status === 'error' && config.autoSync) {
          syncConfig = { ...config, autoSync: false };
          await repository.setSyncConfig(syncConfig);
          const metadata = await repository.getSyncMetadata();
          await repository.setSyncMetadata({ ...metadata, autoSync: false });
        }
        sendResponse(result);
      })(); return true;
    }
    if (type === 'lumamark-export') {
      void Promise.all([repository.list({ includeDeleted: true }), repository.listCollections()]).then(([bookmarks, collections]) => sendResponse({ ok: true, content: exportLumaMarkJson(bookmarks, collections) })).catch((error) => sendResponse({ ok: false, error: String(error) })); return true;
    }
    if (type === 'lumamark-import') {
      void (async () => {
        const parsed = payload.format === 'html' ? parseBookmarksHtml(String(payload.content ?? '')) : parseLumaMarkJson(String(payload.content ?? ''));
        const existing = await repository.list({ includeDeleted: true });
        const action = (['skip', 'update', 'copy'] as const).includes(payload.action) ? payload.action as DuplicateImportAction : 'skip';
        const plan = planImport(parsed, existing, action);
        await applyImportPlan(plan, service, repository);
        for (const collection of parsed.collections as Collection[]) await repository.putCollection(collection);
        sendResponse({ ok: true, issues: plan.issues, imported: plan.entries.length, duplicateAction: action, choices: plan.issues.filter((issue) => issue.kind === 'duplicate').length });
      })().catch((error) => sendResponse({ ok: false, error: String(error) })); return true;
    }
  });
}

if (typeof globalThis !== 'undefined') {
  try { startBackground(); } catch { /* popup/tests can inject a fake API */ }
}

