import { IndexedDbRepository } from '../../../../packages/storage/src/index';
import { BookmarkService, Collection } from '../../../../packages/domain/src/index';
import { exportLumaMarkJson, parseBookmarksHtml, parseLumaMarkJson } from '../../../../packages/import-export/src/index';
import { WebDavSyncEngine, type WebDavClient, type SyncManifest } from '../../../../packages/sync/src/index';
import { notifySaveResult, registerSaveEntrypoints, resolveExtensionApi, saveActivePage } from '../../../../packages/browser/src/index';

interface SyncConfig { url: string; path: string; username?: string; password?: string; autoSync: boolean }

function webDavClient(config: SyncConfig): WebDavClient {
  const endpoint = `${config.url.replace(/\/$/, '')}/${config.path.replace(/^\//, '')}`;
  const headers = () => {
    const value = config.username ? `${config.username}:${config.password ?? ''}` : '';
    return value ? { Authorization: `Basic ${btoa(value)}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
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

export function startBackground(api = resolveExtensionApi()): void {
  const repository = new IndexedDbRepository();
  const service = new BookmarkService(repository);
  let syncConfig: SyncConfig | undefined;
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
  };
  registerSaveEntrypoints(api, save);
  api.runtime?.onMessage?.addListener((message: unknown, _sender: unknown, sendResponse) => {
    const type = typeof message === 'object' && message !== null && 'type' in message
      ? (message as { type?: string }).type : undefined;
    if (type === 'lumamark-save') { void save(); sendResponse({ ok: true }); return; }
    if (type === 'lumamark-open-library') { void openLibrary(); sendResponse({ ok: true }); return; }
    if (type === 'lumamark-undo') { void lastUndo(); sendResponse({ ok: true }); return; }
    if (type === 'lumamark-list') {
      const payload = (message as { payload?: { text?: string; includeDeleted?: boolean } }).payload;
      void repository.list({ includeDeleted: payload?.includeDeleted ?? false, text: payload?.text }).then((items) => sendResponse({ ok: true, items }));
      return;
    }
    const payload = (message as { payload?: any }).payload ?? {};
    if (type === 'lumamark-list-collections') { void repository.listCollections().then((items) => sendResponse({ ok: true, items })); return; }
    if (type === 'lumamark-favorite') {
      void (async () => {
        const current = await repository.findById(payload.id);
        if (!current) throw new Error('Bookmark not found');
        return service.update(payload.id, { favorite: payload.favorite ?? !current.favorite });
      })().then((item) => sendResponse({ ok: true, item })).catch((error) => sendResponse({ ok: false, error: String(error) })); return;
    }
    if (type === 'lumamark-update') {
      const ids = Array.isArray(payload.ids) ? payload.ids : [payload.id];
      void Promise.all(ids.filter(Boolean).map((id: string) => service.update(id, payload.update ?? {}))).then((items) => sendResponse({ ok: true, items })).catch((error) => sendResponse({ ok: false, error: String(error) })); return;
    }
    if (type === 'lumamark-delete') {
      const ids = Array.isArray(payload.ids) ? payload.ids : [payload.id];
      let removed: string[] = [];
      void Promise.all(ids.filter(Boolean).map((id: string) => service.remove(id))).then((items) => {
        removed = items.map((item) => item.id);
        lastUndo = async () => { for (const id of removed) await service.restore(id); };
        sendResponse({ ok: true, items });
      }).catch((error) => sendResponse({ ok: false, error: String(error) })); return;
    }
    if (type === 'lumamark-restore') { void service.restore(payload.id).then((item) => sendResponse({ ok: true, item })).catch((error) => sendResponse({ ok: false, error: String(error) })); return; }
    if (type === 'lumamark-sync-configure') {
      syncConfig = { url: String(payload.url ?? ''), path: String(payload.path ?? 'lumamark.json'), username: payload.username ? String(payload.username) : undefined, password: payload.password ? String(payload.password) : undefined, autoSync: Boolean(payload.autoSync) };
      void repository.getSyncMetadata().then((metadata) => repository.setSyncMetadata({ ...metadata, autoSync: syncConfig!.autoSync, status: 'idle', error: undefined })).then(() => sendResponse({ ok: true })); return;
    }
    if (type === 'lumamark-sync') {
      if (!syncConfig?.url) { sendResponse({ ok: false, status: 'error', error: 'WebDAV is not configured' }); return; }
      void new WebDavSyncEngine(repository, webDavClient(syncConfig)).sync().then((result) => sendResponse(result)); return;
    }
    if (type === 'lumamark-export') {
      void Promise.all([repository.list({ includeDeleted: true }), repository.listCollections()]).then(([bookmarks, collections]) => sendResponse({ ok: true, content: exportLumaMarkJson(bookmarks, collections) })); return;
    }
    if (type === 'lumamark-import') {
      void (async () => {
        const parsed = payload.format === 'html' ? parseBookmarksHtml(String(payload.content ?? '')) : parseLumaMarkJson(String(payload.content ?? ''));
        for (const bookmark of parsed.bookmarks) await repository.put(bookmark);
        for (const collection of parsed.collections as Collection[]) await repository.putCollection(collection);
        sendResponse({ ok: true, issues: parsed.issues, imported: parsed.bookmarks.length });
      })().catch((error) => sendResponse({ ok: false, error: String(error) })); return;
    }
  });
}

if (typeof globalThis !== 'undefined') {
  try { startBackground(); } catch { /* popup/tests can inject a fake API */ }
}

