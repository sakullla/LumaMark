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

export interface SaveAction {
  id: 'open-library' | 'undo' | 'open-existing' | 'update-existing' | 'copy-existing';
  title: string;
}

export interface ExtensionNotifications {
  create?(id: string, options: { type: 'basic'; title: string; message: string; iconUrl?: string; buttons?: Array<{ title: string }> }): Promise<string>;
  onButtonClicked?: { addListener(listener: (id: string, buttonIndex: number) => void): void };
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

export interface SaveActionHandlers {
  openLibrary?: () => Promise<void> | void;
  undo?: () => Promise<void> | void;
  openExisting?: () => Promise<void> | void;
  updateExisting?: () => Promise<void> | void;
  copyExisting?: () => Promise<void> | void;
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

export function saveActionsForResult(result: SaveBookmarkResult): SaveAction[] {
  if (result.kind === 'existing') {
    return [
      { id: 'open-existing', title: 'Open existing' },
      { id: 'update-existing', title: 'Update metadata' },
      { id: 'copy-existing', title: 'Save copy' },
    ];
  }
  return [
    { id: 'open-library', title: 'Open library' },
    { id: 'undo', title: 'Undo' },
  ];
}

export async function notifySaveResult(api: WebExtensionApi, result: SaveBookmarkResult, handlers: SaveActionHandlers = {}): Promise<void> {
  if (!api.notifications?.create) return;
  const notificationId = `lumamark-${Date.now()}`;
  const actions = saveActionsForResult(result);
  const message = result.kind === 'existing' ? 'Already saved. Choose an action.' : 'Saved. Open the library or undo this save.';
  await api.notifications.create(notificationId, {
    type: 'basic',
    title: result.kind === 'existing' ? 'Already saved' : 'Bookmark saved',
    message,
    buttons: actions.map((action) => ({ title: action.title })),
  });
  api.notifications.onButtonClicked?.addListener((id, index) => {
    if (id !== notificationId) return;
    const action = actions[index];
    if (!action) return;
    const handlerKey = action.id === 'open-library' ? 'openLibrary'
      : action.id === 'open-existing' ? 'openExisting'
        : action.id === 'update-existing' ? 'updateExisting'
          : action.id === 'copy-existing' ? 'copyExisting' : 'undo';
    const handler = handlers[handlerKey];
    if (handler) void handler();
  });
}

