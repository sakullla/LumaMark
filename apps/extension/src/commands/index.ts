import { BookmarkService } from '../../../../packages/domain/src/index';
import { WebExtensionApi, notifySaveResult, saveActivePage } from '../../../../packages/browser/src/index';

export function registerCommandHandlers(api: WebExtensionApi, service: BookmarkService): void {
  api.commands?.onCommand?.addListener((command) => {
    if (command === 'save-current-page') {
      void saveActivePage(api, service).then((result) => notifySaveResult(api, result));
    }
  });
}

