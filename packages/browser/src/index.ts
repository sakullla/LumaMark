import { BookmarkService, CreateBookmarkInput, normalizeUrl, SaveBookmarkResult } from '../../domain/src/index';

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

export interface SaveMenuInfo {
  menuItemId: string;
  linkUrl?: string;
  linkText?: string;
  selectionText?: string;
  pageUrl?: string;
}

export function sameLinkUrl(left: string, right: string): boolean {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return left === right;
  }
}

/** Prefer the browser link text, then text supplied by the page. An empty page title means the URL. */
export function titleForSavedLink(info: SaveMenuInfo, hintedTitle?: string): string {
  const linkText = info.linkText?.trim();
  if (linkText) return linkText;
  if (hintedTitle !== undefined) return hintedTitle.trim() || info.linkUrl || '';
  return info.selectionText?.trim() || info.linkUrl || '';
}

export interface ExtensionContextMenus {
  create(properties: { id: string; title: string; contexts: string[] }): void | Promise<void>;
  onClicked?: { addListener(listener: (info: SaveMenuInfo, tab?: ActiveTab) => void): void };
}

export interface ExtensionCommands {
  onCommand?: { addListener(listener: (command: string) => void): void };
}

export interface ExtensionRuntime {
  getURL?(path: string): string;
  onMessage?: { addListener(listener: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void): void };
}

export interface ExtensionStorage {
  local: {
    get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
  };
}

export interface ExtensionI18n {
  getUILanguage?: () => string;
}

export interface ExtensionAlarm {
  name: string;
}

export interface ExtensionAlarms {
  create(name: string, alarmInfo: { delayInMinutes?: number; periodInMinutes?: number }): void | Promise<void>;
  get?(name: string): Promise<ExtensionAlarm | undefined>;
  clear(name: string): void | Promise<boolean | void>;
  onAlarm?: { addListener(listener: (alarm: ExtensionAlarm) => void): void };
}

export interface NativeNode {
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url?: string;
  type?: string;
  folderType?: string;
  unmodifiable?: string;
  dateAdded?: number;
  children?: NativeNode[];
}

interface NativeEvent { addListener(listener: (...args: any[]) => void): void }

/** The parts of chrome.bookmarks / browser.bookmarks that LumaMark uses. */
export interface NativeBookmarksApi {
  getTree(): Promise<NativeNode[]>;
  create(input: { parentId: string; index?: number; title?: string; url?: string; type?: 'bookmark' | 'folder' | 'separator' }): Promise<NativeNode>;
  update(id: string, changes: { title?: string; url?: string }): Promise<NativeNode>;
  move(id: string, destination: { parentId?: string; index?: number }): Promise<NativeNode>;
  remove(id: string): Promise<void>;
  removeTree(id: string): Promise<void>;
  onCreated?: NativeEvent;
  onRemoved?: NativeEvent;
  onChanged?: NativeEvent;
  onMoved?: NativeEvent;
  onChildrenReordered?: NativeEvent;
  onImportEnded?: NativeEvent;
}

export interface WebExtensionApi {
  tabs: ExtensionTabs;
  notifications?: ExtensionNotifications;
  contextMenus?: ExtensionContextMenus;
  commands?: ExtensionCommands;
  runtime?: ExtensionRuntime;
  storage?: ExtensionStorage;
  i18n?: ExtensionI18n;
  alarms?: ExtensionAlarms;
  /** Missing on Safari; LumaMark then keeps only its own store. */
  bookmarks?: NativeBookmarksApi;
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

export function isSavablePageUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    normalizeUrl(value);
    return true;
  } catch {
    return false;
  }
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
  handler: (info?: SaveMenuInfo) => Promise<void>,
  title = 'Save to LumaMark',
): void {
  if (api.contextMenus) {
    void api.contextMenus.create({ id: 'lumamark-save-page', title, contexts: ['page', 'link'] });
    api.contextMenus.onClicked?.addListener((info) => {
      if (info.menuItemId === 'lumamark-save-page') void handler(info);
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

export interface SaveNoticeCopy {
  savedTitle?: string;
  savedMessage?: string;
  existingTitle?: string;
  existingMessage?: string;
  actionTitles?: Partial<Record<SaveAction['id'], string>>;
}

let noticeSequence = 0;

// Chrome rejects a basic notification that has no iconUrl, which used to fail the save after the bookmark was written.
const NOTIFICATION_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function notificationIconUrl(api: WebExtensionApi): string {
  const resource = api.runtime?.getURL?.('assets/icon.png');
  if (resource && /^(chrome-extension:|moz-extension:|safari-web-extension:)/.test(resource)) return resource;
  return NOTIFICATION_ICON_DATA_URL;
}

export async function notifyMessage(
  api: WebExtensionApi,
  title: string,
  message: string,
  buttons: Array<{ title: string; onClick?: () => void }> = [],
): Promise<string | undefined> {
  if (!api.notifications?.create) return undefined;
  const notificationId = `lumamark-${Date.now()}-${noticeSequence++}`;
  try {
    await api.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: notificationIconUrl(api),
      title,
      message,
      buttons: buttons.map((button) => ({ title: button.title })),
    });
  } catch {
    return undefined;
  }
  if (buttons.length) {
    api.notifications.onButtonClicked?.addListener((id, index) => {
      if (id !== notificationId) return;
      buttons[index]?.onClick?.();
    });
  }
  return notificationId;
}

export async function notifySaveResult(api: WebExtensionApi, result: SaveBookmarkResult, handlers: SaveActionHandlers = {}, copy: SaveNoticeCopy = {}): Promise<string | undefined> {
  const actions = saveActionsForResult(result).map((action) => ({ ...action, title: copy.actionTitles?.[action.id] ?? action.title }));
  const saved = result.kind === 'saved';
  return notifyMessage(
    api,
    saved ? (copy.savedTitle ?? 'Bookmark saved') : (copy.existingTitle ?? 'Already saved'),
    saved ? (copy.savedMessage ?? 'Saved. Open the library or undo this save.') : (copy.existingMessage ?? 'Already saved. Choose an action.'),
    actions.map((action) => ({
      title: action.title,
      onClick: () => {
        const handlerKey = action.id === 'open-library' ? 'openLibrary'
          : action.id === 'open-existing' ? 'openExisting'
            : action.id === 'update-existing' ? 'updateExisting'
              : action.id === 'copy-existing' ? 'copyExisting' : 'undo';
        const handler = handlers[handlerKey];
        if (handler) void handler();
      },
    })),
  );
}

