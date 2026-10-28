import { IndexedDbRepository } from '../../../../packages/storage/src/index';
import { BookmarkService } from '../../../../packages/domain/src/index';
import { notifySaveResult, registerSaveEntrypoints, resolveExtensionApi, saveActivePage } from '../../../../packages/browser/src/index';

export function startBackground(api = resolveExtensionApi()): void {
  const repository = new IndexedDbRepository();
  const service = new BookmarkService(repository);
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
      void repository.list({ includeDeleted: false }).then((items) => sendResponse({ ok: true, items }));
      return;
    }
  });
}

if (typeof globalThis !== 'undefined') {
  try { startBackground(); } catch { /* popup/tests can inject a fake API */ }
}

