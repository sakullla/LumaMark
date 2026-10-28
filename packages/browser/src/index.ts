import { BookmarkService, CreateBookmarkInput, SaveBookmarkResult } from '../../domain/src/index';

export interface ActiveTab {
  id?: number;
  url?: string;
  title?: string;
  favIconUrl?: string;
}

export interface ExtensionTabs {
  query(queryInfo: Record<string, unknown>): Promise<ActiveTab[]>;
  create?(properties: { url: string }): Promise<unknown>;
}

export interface ExtensionNotifications {
  create?(id: string, options: { type: 'basic'; title: string; message: string; iconUrl?: string }): Promise<string>;
}

export interface ExtensionContextMenus {
  create(properties: { id: string; title: string; contexts: string[] }): void | Promise<void>;
  onClicked?: { addListener(listener: (info: { menuItemId: string }, tab?: ActiveTab) => void): void };
}

export interface ExtensionCommands {
  onCommand?: { addListener(listener: (command: string) => void): void };
}

export interface ExtensionRuntime {
  getURL?(path: string): string;
  onMessage?: { addListener(listener: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => void): void };
}

export interface WebExtensionApi {
  tabs: ExtensionTabs;
  notifications?: ExtensionNotifications;
  contextMenus?: ExtensionContextMenus;
  commands?: ExtensionCommands;
  runtime?: ExtensionRuntime;
}

export interface CapturedPage {
  url: string;
  title?: string;
  faviconUrl?: string;
}

export function resolveExtensionApi(root: unknown = globalThis): WebExtensionApi {
  const scope = root as { browser?: WebExtensionApi; chrome?: WebExtensionApi };
  const api = scope.browser ?? scope.chrome;
  if (!api?.tabs) throw new Error('WebExtension API is unavailable');
  return api;
}

export async function captureActivePage(api: WebExtensionApi): Promise<CapturedPage> {
  const tabs = await api.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  if (!tab?.url) throw new Error('Unable to read the active page URL');
  return { url: tab.url, title: tab.title, faviconUrl: tab.favIconUrl };
}

export async function saveActivePage(
  api: WebExtensionApi,
  service: BookmarkService,
  duplicateAction: 'existing' | 'update' | 'copy' = 'existing',
): Promise<SaveBookmarkResult> {
  const page = await captureActivePage(api);
  const input: CreateBookmarkInput = { url: page.url, title: page.title, faviconUrl: page.faviconUrl };
  return service.save(input, duplicateAction);
}

export function registerSaveEntrypoints(
  api: WebExtensionApi,
  handler: () => Promise<void>,
): void {
  if (api.contextMenus) {
    void api.contextMenus.create({ id: 'lumamark-save-page', title: 'Save page to LumaMark', contexts: ['page', 'link'] });
    api.contextMenus.onClicked?.addListener((info) => {
      if (info.menuItemId === 'lumamark-save-page') void handler();
    });
  }
  api.commands?.onCommand?.addListener((command) => {
    if (command === 'save-current-page') void handler();
  });
}

export async function notifySaveResult(api: WebExtensionApi, result: SaveBookmarkResult): Promise<void> {
  if (!api.notifications?.create) return;
  const message = result.kind === 'existing' ? 'This URL is already saved. Open or update it from the library.' : 'Saved to LumaMark. You can open the library or undo this save.';
  await api.notifications.create(`lumamark-${Date.now()}`, {
    type: 'basic',
    title: result.kind === 'existing' ? 'Already saved' : 'Bookmark saved',
    message,
  });
}

