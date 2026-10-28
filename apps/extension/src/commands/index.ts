import { BookmarkService } from '../../../../packages/domain/src/index';
import { WebExtensionApi, notifySaveResult, saveActivePage } from '../../../../packages/browser/src/index';

export function registerCommandHandlers(api: WebExtensionApi, service: BookmarkService): void {
  api.commands?.onCommand?.addListener((command) => {
    if (command === 'save-current-page') {
      void saveActivePage(api, service).then((result) => notifySaveResult(api, result, {
        openLibrary: async () => { await api.tabs.create?.({ url: api.runtime?.getURL?.('library.html') ?? 'library.html' }); },
        undo: async () => { if (result.kind === 'saved') await service.remove(result.bookmark.id); },
        openExisting: async () => { await api.tabs.create?.({ url: api.runtime?.getURL?.('library.html') ?? 'library.html' }); },
        updateExisting: async () => { if (result.kind === 'existing') await service.save({ url: result.existing.url, title: result.existing.title }, 'update'); },
        copyExisting: async () => { if (result.kind === 'existing') await service.save({ url: result.existing.url, title: result.existing.title }, 'copy'); },
      }));
    }
  });
}

