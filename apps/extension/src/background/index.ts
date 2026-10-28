import { IndexedDbRepository } from '../../../../packages/storage/src/index';
import { BookmarkService } from '../../../../packages/domain/src/index';
import { notifySaveResult, registerSaveEntrypoints, resolveExtensionApi, saveActivePage } from '../../../../packages/browser/src/index';

export function startBackground(api = resolveExtensionApi()): void {
  const repository = new IndexedDbRepository();
  const service = new BookmarkService(repository);
  const save = async () => {
    const result = await saveActivePage(api, service);
    await notifySaveResult(api, result);
  };
  registerSaveEntrypoints(api, save);
}

if (typeof globalThis !== 'undefined') {
  try { startBackground(); } catch { /* popup/tests can inject a fake API */ }
}

