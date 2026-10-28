import { IndexedDbRepository } from '../../../../packages/storage/src/index';
import { BookmarkService } from '../../../../packages/domain/src/index';
import { notifySaveResult, registerSaveEntrypoints, resolveExtensionApi, saveActivePage } from '../../../../packages/browser/src/index';

export function startBackground(api = resolveExtensionApi()): void {
  const repository = new IndexedDbRepository();
  const service = new BookmarkService(repository);
  const openLibrary = async () => {
    const url = api.runtime?.getURL?.('library.html') ?? 'library.html';
    await api.tabs.create?.({ url });
  };
  const save = async () => {
    const result = await saveActivePage(api, service);
    await notifySaveResult(api, result, {
      openLibrary,
      undo: async () => { if (result.kind === 'saved') await service.remove(result.bookmark.id); },
      openExisting: openLibrary,
      updateExisting: async () => { if (result.kind === 'existing') await service.save({ url: result.existing.url, title: result.existing.title }, 'update'); },
      copyExisting: async () => { if (result.kind === 'existing') await service.save({ url: result.existing.url, title: result.existing.title }, 'copy'); },
    });
  };
  registerSaveEntrypoints(api, save);
}

if (typeof globalThis !== 'undefined') {
  try { startBackground(); } catch { /* popup/tests can inject a fake API */ }
}

