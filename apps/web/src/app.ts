import { applyBookmarkUpdate, domainFromUrl, normalizeBookmarkUrl, urlKey, type Bookmark, type ConflictField } from '../../../packages/domain/src/index';
import type { DuplicateImportAction, ImportResult } from '../../../packages/import-export/src/index';
import { AccountClient, WebRequestError, type FetchLike, type ManagedAccount } from './client';
import { starSvg, webIcon, webLogo, type WebIconName } from './icons';
import {
  addBookmark,
  applyImport,
  cleanDuplicatesInLibrary,
  countDuplicateImports,
  createCollectionInLibrary,
  deleteBookmark,
  deleteBookmarksBatch,
  deleteCollectionInLibrary,
  emptyTrash,
  escapeHtml,
  extraDuplicateIdsOf,
  exportHtml,
  exportJson,
  favoriteBookmarksBatch,
  folderFor,
  folderName,
  folderPathName,
  folderPathsOf,
  folderTreeOf,
  formatRelativeTime,
  isHttpBookmarkUrl,
  libraryFromManifest,
  librarySignature,
  liveBookmarksOf,
  manifestFromLibrary,
  mergeTitleChoices,
  moveBookmarksBatch,
  parseImport,
  purgeBookmarksBatch,
  renameCollectionInLibrary,
  restoreBookmark,
  restoreBookmarksBatch,
  scopeCountsOf,
  tagBookmarksBatch,
  tagCountsOf,
  tileHueFor,
  titleConflicts,
  titleInitialFor,
  trashedBookmarksOf,
  updateBookmark,
  visibleBookmarks,
  type BookmarkFilter,
  type BookmarkInput,
  type BookmarkPatch,
  type ConflictChoice,
  type ConflictKeep,
  type FolderTreeNode,
  type LibraryModel,
  type SortField,
  type TitleConflict,
} from './library';

export type { BookmarkInput, BookmarkPatch, TitleConflict };
export { WebRequestError };

export type WebScope = 'all' | 'favorites' | 'recent' | 'unfiled' | 'duplicates' | 'trash' | 'folder' | 'tag';
export type WebView = 'list' | 'compact' | 'grid';
export type WebPanel = 'none' | 'add' | 'import' | 'export';
export type WebModal = 'add' | 'edit' | 'accounts';
export type ThemeChoice = 'light' | 'dark';
export type AccentChoice = 'iris' | 'ember' | 'rose' | 'ocean' | 'jade' | 'graphite';
export const ACCENT_CHOICES: readonly AccentChoice[] = ['iris', 'ember', 'rose', 'ocean', 'jade', 'graphite'];

export interface WebAppearance {
  theme: ThemeChoice;
  accent: AccentChoice;
}

export interface WebSnapshot {
  mode: 'login' | 'offline' | 'library' | 'import-choice' | 'conflict';
  message: string;
  username?: string;
  admin?: boolean;
  importPending: boolean;
  conflicts: TitleConflict[];
}

export interface WebApp {
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  restoreSession(): Promise<boolean>;
  search(query: string): void;
  setFavoritesOnly(value: boolean): void;
  showTrash(value: boolean): void;
  setScope(scope: WebScope, value?: string): void;
  setSort(value: string): void;
  setView(view: WebView): void;
  setPanel(panel: WebPanel, toggle?: boolean): void;
  setAppearance(appearance: Partial<WebAppearance>): void;
  appearance(): WebAppearance;
  showMore(): void;
  startEdit(id: string | undefined): void;
  toggleSelected(id: string, value?: boolean): void;
  selectAll(value: boolean): void;
  clearSelection(): void;
  armConfirm(key: string | undefined): boolean;
  setFolderDraft(draft: FolderDraft | undefined): void;
  dismissToast(): void;
  goToLogin(): void;
  closeModal(): void;
  modalOpen(): WebModal | undefined;
  openAccounts(): Promise<void>;
  createAccount(username: string, password: string): Promise<void>;
  resetAccountPassword(username: string, password: string): Promise<void>;
  deleteAccount(username: string): Promise<void>;
  setResetTarget(username: string | undefined): void;
  dismissAccountNotice(): void;
  addBookmark(input: BookmarkInput, force?: boolean): Promise<void>;
  updateBookmark(id: string, patch: BookmarkPatch): Promise<void>;
  toggleFavorite(id: string): Promise<void>;
  deleteBookmark(id: string): Promise<void>;
  restoreBookmark(id: string): Promise<void>;
  restoreMany(ids: readonly string[]): Promise<void>;
  emptyTrash(): Promise<void>;
  purgeMany(ids: readonly string[]): Promise<void>;
  deleteMany(ids: readonly string[]): Promise<void>;
  favoriteMany(ids: readonly string[], favorite: boolean): Promise<void>;
  moveMany(ids: readonly string[], folder: string): Promise<void>;
  tagMany(ids: readonly string[], tags: readonly string[]): Promise<void>;
  cleanDuplicates(): Promise<void>;
  createFolder(name: string, parentId?: string): Promise<void>;
  renameFolder(id: string, name: string): Promise<void>;
  deleteFolder(id: string): Promise<void>;
  beginImport(text: string, format: 'html' | 'json'): Promise<'applied' | 'awaiting-choice' | 'rejected'>;
  chooseImport(action: DuplicateImportAction): Promise<void>;
  cancelImport(): void;
  exportJson(): string;
  exportHtml(): string;
  notify(text: string): void;
  chooseConflict(bookmarkId: string, keep: ConflictKeep, patch?: BookmarkPatch & { deleted?: boolean }): Promise<void>;
  visibleBookmarks(): Bookmark[];
  selectedIds(): string[];
  render(): string;
  snapshot(): WebSnapshot;
  sessionToken(): string | undefined;
}

export interface FolderDraft {
  mode: 'create' | 'rename';
  id?: string;
  parentId?: string;
}

export interface PageTarget {
  id?: string;
  value?: string;
  checked?: boolean;
  name?: string;
  type?: string;
  files?: ArrayLike<{ name: string; text(): Promise<string> }> | null;
  getAttribute?(name: string): string | null;
  closest?(selector: string): PageTarget | null;
  elements?: Record<string, { value?: string; checked?: boolean } | undefined>;
  focus?(): void;
}

export interface PageEvent {
  preventDefault(): void;
  target: PageTarget | null;
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}

export interface PageRoot {
  innerHTML: string;
  addEventListener(type: 'submit' | 'click' | 'change' | 'input' | 'keydown', listener: (event: PageEvent) => void): void;
  querySelector?(selector: string): unknown;
  querySelectorAll?(selector: string): Iterable<unknown>;
}

export interface WebAppOptions {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  now?: () => string;
  appearance?: Partial<WebAppearance>;
  preferences?: Partial<WebPreferences>;
}

export interface WebPreferences {
  view: WebView;
  sort: string;
}

interface PendingConflict {
  attempted: LibraryModel;
  remote: LibraryModel;
  etag: string;
  choices: Map<string, ConflictChoice>;
  conflicts: TitleConflict[];
}

interface Toast {
  text: string;
  undo?: { kind: 'restore'; ids: string[] };
}

const OFFLINE = '连不上服务，没有显示书签库。';
const EMPTY = '这个账号还没有书签。';
const NO_MATCH = '没有符合条件的书签。';
const UNSAVED = '没有保存成。账号保持原样。';
const INVALID_URL = '网址无效：请填写 http:// 或 https:// 开头的网址。账号保持原样。';
const PAGE_SIZE = 200;
const SORTS: Record<string, { label: string; field: SortField; direction: 'asc' | 'desc' }> = {
  'updatedAt:desc': { label: '最近修改', field: 'updatedAt', direction: 'desc' },
  'createdAt:desc': { label: '最新添加', field: 'createdAt', direction: 'desc' },
  'createdAt:asc': { label: '最早添加', field: 'createdAt', direction: 'asc' },
  'title:asc': { label: '标题 A→Z', field: 'title', direction: 'asc' },
  'domain:asc': { label: '按网站', field: 'domain', direction: 'asc' },
};
const SCOPES: Array<{ scope: Exclude<WebScope, 'folder' | 'tag'>; label: string; icon: WebIconName }> = [
  { scope: 'all', label: '全部书签', icon: 'layers' },
  { scope: 'favorites', label: '收藏', icon: 'star' },
  { scope: 'recent', label: '最近 30 天', icon: 'clock' },
  { scope: 'unfiled', label: '未归类', icon: 'inbox' },
  { scope: 'duplicates', label: '重复网址', icon: 'copy' },
  { scope: 'trash', label: '回收站', icon: 'trash' },
];

export function createWebApp(options: WebAppOptions = {}): WebApp {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  return new WebController(
    new AccountClient(fetchImpl, options.baseUrl),
    options.now ?? (() => new Date().toISOString()),
    { theme: 'light', accent: 'iris', ...options.appearance },
    { view: 'list', sort: 'updatedAt:desc', ...options.preferences },
  );
}

function splitTags(value: string): string[] {
  return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
}

function detectFormat(text: string, chosen: string): 'html' | 'json' {
  if (chosen === 'html' || chosen === 'json') return chosen;
  return /^\s*[{[]/.test(text) ? 'json' : 'html';
}

interface BrowserLike {
  document?: {
    activeElement?: unknown;
    documentElement?: { dataset?: Record<string, string> };
    createElement?(tag: string): { href: string; download: string; click(): void; remove?(): void };
    body?: { append?(node: unknown): void };
  };
  localStorage?: { setItem(key: string, value: string): void };
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  URL?: { createObjectURL?(blob: unknown): string; revokeObjectURL?(url: string): void };
  Blob?: new (parts: string[], options: { type: string }) => unknown;
}

const host = () => globalThis as unknown as BrowserLike;

function downloadText(name: string, content: string, type: string): boolean {
  const { document, URL: url, Blob: BlobCtor } = host();
  if (!document?.createElement || !url?.createObjectURL || !BlobCtor) return false;
  const href = url.createObjectURL(new BlobCtor([content], { type }));
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  document.body?.append?.(link);
  link.click();
  link.remove?.();
  url.revokeObjectURL?.(href);
  return true;
}

export function applyAppearanceToDocument(appearance: WebAppearance): void {
  const dataset = host().document?.documentElement?.dataset;
  if (!dataset) return;
  dataset.theme = appearance.theme;
  dataset.accent = appearance.accent;
}

function remember(key: string, value: string): void {
  try { host().localStorage?.setItem(key, value); } catch { /* the choice lasts for this page only */ }
}

interface FocusMemory { selector: string; start?: number | null; end?: number | null }

function focusSelector(element: unknown): FocusMemory | undefined {
  const el = element as { id?: string; name?: string; form?: { id?: string; getAttribute?(n: string): string | null } | null; selectionStart?: number | null; selectionEnd?: number | null; tagName?: string } | null;
  if (!el || !el.tagName || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return undefined;
  const caret = { start: el.selectionStart, end: el.selectionEnd };
  if (el.id) return { selector: `#${el.id}`, ...caret };
  if (!el.name || !el.form) return undefined;
  if (el.form.id) return { selector: `#${el.form.id} [name="${el.name}"]`, ...caret };
  const bookmark = el.form.getAttribute?.('data-bookmark-id');
  const action = el.form.getAttribute?.('data-action');
  if (bookmark && action) return { selector: `form[data-action="${action}"][data-bookmark-id="${bookmark}"] [name="${el.name}"]`, ...caret };
  return undefined;
}

const PASSWORD_CHARS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomPassword(length = 14): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => PASSWORD_CHARS[byte % PASSWORD_CHARS.length]).join('');
}

interface FieldNode {
  name?: string;
  type?: string;
  value: string;
  defaultValue?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  form?: { id?: string; getAttribute?(name: string): string | null } | null;
}

function fieldKey(field: FieldNode): string | undefined {
  if (!field.name || !field.form || field.type === 'file' || field.type === 'hidden' || field.type === 'password') return undefined;
  const form = field.form.id || `${field.form.getAttribute?.('data-action') ?? ''}:${field.form.getAttribute?.('data-bookmark-id') ?? ''}`;
  return `${form}|${field.name}`;
}

/** Values the user typed but has not submitted yet, so a repaint does not throw them away. */
function unsavedFields(root: PageRoot): Map<string, FieldNode> {
  const kept = new Map<string, FieldNode>();
  for (const field of (root.querySelectorAll?.('form input, form textarea, form select') ?? []) as Iterable<FieldNode>) {
    const key = fieldKey(field);
    const edited = field.type === 'checkbox' ? field.checked !== field.defaultChecked : field.defaultValue !== undefined && field.value !== field.defaultValue;
    if (key && edited) kept.set(key, field);
  }
  return kept;
}

function restoreFields(root: PageRoot, kept: Map<string, FieldNode>): void {
  if (!kept.size) return;
  for (const field of (root.querySelectorAll?.('form input, form textarea, form select') ?? []) as Iterable<FieldNode>) {
    const key = fieldKey(field);
    const old = key ? kept.get(key) : undefined;
    if (!old) continue;
    if (field.type === 'checkbox') field.checked = old.checked;
    else field.value = old.value;
  }
}

export function bindWebApp(root: PageRoot, app: WebApp): void {
  let toastTimer: unknown;
  let opener: string | undefined;
  let lastAutofocus: string | undefined;
  type Focusable = { focus?(): void; contains?(node: unknown): boolean; querySelector?(s: string): Focusable | null };
  const paint = (keepTyping = true) => {
    const memory = focusSelector(host().document?.activeElement);
    const kept = keepTyping ? unsavedFields(root) : new Map<string, FieldNode>();
    const hadModal = Boolean(root.querySelector?.('.modal'));
    root.innerHTML = app.render();
    restoreFields(root, kept);
    const modal = root.querySelector?.('.modal') as Focusable | null | undefined;
    const autofocus = modal?.querySelector?.('[data-autofocus]') as (Focusable & { id?: string; name?: string }) | null | undefined;
    const autofocusKey = autofocus ? `${autofocus.id ?? ''}|${autofocus.name ?? ''}` : undefined;
    const freshAutofocus = Boolean(autofocusKey && autofocusKey !== lastAutofocus);
    lastAutofocus = autofocusKey;
    if (keepTyping && memory && root.querySelector && !freshAutofocus) {
      try {
        const next = root.querySelector(memory.selector) as { focus?(): void; setSelectionRange?(a: number, b: number): void } | null;
        next?.focus?.();
        if (memory.start != null && memory.end != null) next?.setSelectionRange?.(memory.start, memory.end);
      } catch { /* the field went away with the change */ }
    }
    if (host().document) {
      const active = host().document?.activeElement;
      if (modal) {
        if (freshAutofocus || !modal.contains?.(active)) (autofocus ?? modal.querySelector?.('input:not([type=hidden]), textarea') ?? modal.querySelector?.('button'))?.focus?.();
      } else if (hadModal && opener) {
        (root.querySelector?.(opener) as Focusable | null | undefined)?.focus?.();
        opener = undefined;
      }
    }
    const { setTimeout: later, clearTimeout: cancel } = host();
    if (later) {
      if (toastTimer !== undefined) cancel?.(toastTimer);
      toastTimer = undefined;
      if (root.innerHTML.includes('id="toast"')) {
        toastTimer = later(() => { toastTimer = undefined; app.dismissToast(); paint(); }, 6000);
      }
    }
  };
  const finish = (result: Promise<unknown>) => {
    paint();
    void result.then(() => paint(false), () => paint());
  };
  const closest = (target: PageTarget | null, selector: string): PageTarget | null => {
    if (!target) return null;
    if (target.closest) return target.closest(selector);
    return target.getAttribute ? target : null;
  };
  const attr = (target: PageTarget | null, name: string) => target?.getAttribute?.(name) ?? '';

  root.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    if (!form?.elements) return;
    const value = (name: string) => form.elements?.[name]?.value ?? '';
    const checked = (name: string) => Boolean(form.elements?.[name]?.checked);
    const action = form.getAttribute?.('data-action');
    if (form.id === 'login') {
      finish(app.login(value('username'), value('password')));
      return;
    }
    if (form.id === 'search') {
      app.search(value('query'));
      paint();
      return;
    }
    if (form.id === 'add') {
      finish(app.addBookmark({
        title: value('title'),
        url: value('url'),
        folder: value('folder'),
        tags: splitTags(value('tags')),
        notes: value('notes'),
        favorite: checked('favorite'),
      }, value('force') === '1'));
      return;
    }
    if (form.id === 'import') {
      const content = value('content');
      finish(app.beginImport(content, detectFormat(content, value('format'))));
      return;
    }
    if (form.id === 'folder-form') {
      const id = form.getAttribute?.('data-folder-id') ?? '';
      const parent = form.getAttribute?.('data-parent-id') ?? '';
      finish(id ? app.renameFolder(id, value('name')) : app.createFolder(value('name'), parent || undefined));
      return;
    }
    if (form.id === 'account-create') {
      finish(app.createAccount(value('username'), value('password')));
      return;
    }
    if (action === 'account-reset') {
      finish(app.resetAccountPassword(form.getAttribute?.('data-username') ?? '', value('password')));
      return;
    }
    if (form.id === 'batch-move') {
      finish(app.moveMany(app.selectedIds(), value('folder')));
      return;
    }
    if (form.id === 'batch-tag') {
      finish(app.tagMany(app.selectedIds(), splitTags(value('tags'))));
      return;
    }
    if (action === 'update') {
      finish(app.updateBookmark(form.getAttribute?.('data-bookmark-id') ?? '', {
        title: value('title'),
        url: value('url'),
        folder: value('folder'),
        tags: splitTags(value('tags')),
        notes: value('notes'),
        favorite: checked('favorite'),
      }));
      return;
    }
    if (action === 'merge-conflict') {
      const deleted = form.elements?.deleted;
      finish(app.chooseConflict(form.getAttribute?.('data-bookmark-id') ?? '', 'merged', {
        title: value('title'),
        url: value('url'),
        folder: value('folder'),
        tags: splitTags(value('tags')),
        notes: value('notes'),
        favorite: checked('favorite'),
        ...(deleted ? { deleted: Boolean(deleted.checked) } : {}),
      }));
    }
  });

  root.addEventListener('click', (event) => {
    const raw = event.target;
    if (raw?.getAttribute?.('data-modal-backdrop') != null) {
      app.closeModal();
      paint();
      return;
    }
    const target = closest(raw, 'button, a[data-action], [data-tag-link]');
    if (!target?.getAttribute || target.getAttribute('type') === 'submit') return;
    const importAction = target.getAttribute('data-import-action');
    if (importAction === 'skip' || importAction === 'update' || importAction === 'copy') {
      finish(app.chooseImport(importAction));
      return;
    }
    const keep = target.getAttribute('data-keep');
    if (keep === 'local' || keep === 'remote') {
      finish(app.chooseConflict(target.getAttribute('data-bookmark-id') ?? '', keep));
      return;
    }
    const scope = target.getAttribute('data-scope');
    if (scope) {
      app.setScope(scope as WebScope, attr(target, 'data-scope-value') || undefined);
      paint();
      return;
    }
    const tagLink = target.getAttribute('data-tag-link');
    if (tagLink) {
      app.setScope('tag', tagLink);
      paint();
      return;
    }
    const view = target.getAttribute('data-view');
    if (view === 'list' || view === 'compact' || view === 'grid') {
      app.setView(view);
      remember('lumamark-web-view', view);
      paint();
      return;
    }
    const accent = target.getAttribute('data-accent-choice') as AccentChoice | null;
    if (accent && ACCENT_CHOICES.includes(accent)) {
      app.setAppearance({ accent });
      applyAppearanceToDocument(app.appearance());
      remember('lumamark-accent', accent);
      paint();
      return;
    }
    const action = target.getAttribute('data-action');
    const id = target.getAttribute('data-bookmark-id') ?? '';
    const confirmed = (key: string) => {
      if (app.armConfirm(key)) return true;
      paint();
      return false;
    };
    switch (action) {
      case 'delete': finish(app.deleteBookmark(id)); break;
      case 'restore': finish(app.restoreBookmark(id)); break;
      case 'favorite': finish(app.toggleFavorite(id)); break;
      case 'edit': opener = `[data-action="edit"][data-bookmark-id="${id}"]`; app.startEdit(id); paint(); break;
      case 'cancel-edit': app.startEdit(undefined); paint(); break;
      case 'close-modal': app.closeModal(); paint(); break;
      case 'open-accounts': opener = '[data-action="open-accounts"]'; finish(app.openAccounts()); break;
      case 'account-reset': app.setResetTarget(attr(target, 'data-username')); paint(); break;
      case 'account-delete': {
        const name = attr(target, 'data-username');
        if (confirmed(`account-delete:${name}`)) finish(app.deleteAccount(name));
        break;
      }
      case 'dismiss-account-notice': app.dismissAccountNotice(); paint(); break;
      case 'generate-password': {
        const field = root.querySelector?.(attr(target, 'data-target')) as { value: string; focus?(): void; select?(): void } | null | undefined;
        if (field) {
          field.value = randomPassword();
          field.focus?.();
          field.select?.();
        }
        break;
      }
      case 'copy-text': {
        const text = attr(target, 'data-text');
        const clipboard = (globalThis as { navigator?: { clipboard?: { writeText(text: string): Promise<void> } } }).navigator?.clipboard;
        if (clipboard && text) {
          void clipboard.writeText(text).then(() => {
            const label = (target as { querySelector?(s: string): { textContent: string } | null }).querySelector?.('span');
            if (label) label.textContent = '已复制';
          }, () => undefined);
        }
        break;
      }
      case 'copy-link': {
        const url = attr(target, 'data-url');
        const clipboard = (globalThis as { navigator?: { clipboard?: { writeText(text: string): Promise<void> } } }).navigator?.clipboard;
        if (clipboard && url) void clipboard.writeText(url).then(() => { app.notify('链接已复制'); paint(); }, () => undefined);
        break;
      }
      case 'empty-trash': if (confirmed('empty-trash')) finish(app.emptyTrash()); break;
      case 'restore-all': finish(app.restoreMany(app.visibleBookmarks().map((item) => item.id))); break;
      case 'clean-duplicates': if (confirmed('clean-duplicates')) finish(app.cleanDuplicates()); break;
      case 'logout': finish(app.logout()); break;
      case 'retry': finish(app.refresh()); break;
      case 'to-login': app.goToLogin(); paint(); break;
      case 'cancel-import': app.cancelImport(); paint(); break;
      case 'toggle-panel': {
        const panel = attr(target, 'data-panel') as WebPanel;
        if (panel === 'add') opener = '.top-tools [data-panel="add"]';
        app.setPanel(panel || 'none');
        paint();
        break;
      }
      case 'export-json': {
        const content = app.exportJson();
        app.notify(downloadText('lumamark-export.json', content, 'application/json') ? '已下载 LumaMark JSON 备份' : '导出内容已准备好');
        paint();
        break;
      }
      case 'export-html': {
        const content = app.exportHtml();
        app.notify(downloadText('lumamark-bookmarks.html', content, 'text/html') ? '已下载 HTML 书签文件，可导入任何浏览器' : '导出内容已准备好');
        paint();
        break;
      }
      case 'show-trash': app.showTrash(true); paint(); break;
      case 'show-library': app.showTrash(false); paint(); break;
      case 'show-more': app.showMore(); paint(); break;
      case 'clear-selection': app.clearSelection(); paint(); break;
      case 'batch-delete': finish(app.deleteMany(app.selectedIds())); break;
      case 'batch-restore': finish(app.restoreMany(app.selectedIds())); break;
      case 'batch-purge': if (confirmed('batch-purge')) finish(app.purgeMany(app.selectedIds())); break;
      case 'batch-favorite': finish(app.favoriteMany(app.selectedIds(), true)); break;
      case 'batch-unfavorite': finish(app.favoriteMany(app.selectedIds(), false)); break;
      case 'undo': finish(app.restoreMany(splitTags(attr(target, 'data-ids')))); break;
      case 'dismiss-toast': app.dismissToast(); paint(); break;
      case 'clear-search': app.search(''); paint(); break;
      case 'theme-toggle': {
        app.setAppearance({ theme: app.appearance().theme === 'dark' ? 'light' : 'dark' });
        applyAppearanceToDocument(app.appearance());
        remember('lumamark-theme', app.appearance().theme);
        paint();
        break;
      }
      case 'new-folder': app.setFolderDraft({ mode: 'create', parentId: attr(target, 'data-parent-id') || undefined }); paint(); break;
      case 'rename-folder': app.setFolderDraft({ mode: 'rename', id: attr(target, 'data-folder-id') }); paint(); break;
      case 'cancel-folder': app.setFolderDraft(undefined); paint(); break;
      case 'delete-folder': {
        const folderId = attr(target, 'data-folder-id');
        if (confirmed(`delete-folder:${folderId}`)) finish(app.deleteFolder(folderId));
        break;
      }
      default: break;
    }
  });

  root.addEventListener('change', (event) => {
    const target = event.target;
    if (!target) return;
    if (target.id === 'favorites-only') {
      app.setFavoritesOnly(Boolean(target.checked));
      paint();
      return;
    }
    if (target.id === 'sort') {
      app.setSort(target.value ?? '');
      remember('lumamark-web-sort', target.value ?? '');
      paint();
      return;
    }
    if (target.id === 'select-all') {
      app.selectAll(Boolean(target.checked));
      paint();
      return;
    }
    const selectId = target.getAttribute?.('data-select');
    if (selectId) {
      app.toggleSelected(selectId, Boolean(target.checked));
      paint();
      return;
    }
    if (target.id === 'import-file') {
      const file = target.files?.[0];
      if (!file) return;
      void file.text().then((text) => {
        finish(app.beginImport(text, detectFormat(text, /\.json$/i.test(file.name) ? 'json' : /\.html?$/i.test(file.name) ? 'html' : 'auto')));
      }, () => { app.notify('读不了这个文件，账号保持不变。'); paint(); });
    }
  });

  root.addEventListener('input', (event) => {
    const target = event.target;
    if (target?.name !== 'query' || target.id !== 'query') return;
    app.search(target.value ?? '');
    paint();
  });

  const onKey = (event: PageEvent) => {
    if (event.isComposing || app.snapshot().mode !== 'library') return;
    const target = event.target;
    const typing = Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
    const modal = root.querySelector?.('.modal') as { contains?(node: unknown): boolean; querySelectorAll?(s: string): ArrayLike<{ focus(): void }> } | null | undefined;
    if (modal) {
      if (event.key === 'Escape') {
        event.preventDefault();
        app.closeModal();
        paint();
        return;
      }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        const form = target?.closest?.('form') as { requestSubmit?(): void } | null | undefined;
        if (form?.requestSubmit) {
          event.preventDefault();
          form.requestSubmit();
        }
        return;
      }
      if (event.key === 'Tab') {
        const items = Array.from(modal.querySelectorAll?.('button:not([disabled]), input:not([type="hidden"]):not([disabled]), textarea, select, a[href]') ?? []);
        if (!items.length) return;
        const active = host().document?.activeElement;
        const index = items.indexOf(active as { focus(): void });
        if (!modal.contains?.(active) || (event.shiftKey && index === 0) || (!event.shiftKey && index === items.length - 1)) {
          event.preventDefault();
          items[event.shiftKey ? items.length - 1 : 0].focus();
        }
      }
      return;
    }
    if (event.key === 'Escape') {
      if (target?.id === 'query' && target.value) { app.search(''); paint(); return; }
      app.startEdit(undefined);
      app.setFolderDraft(undefined);
      app.clearSelection();
      app.armConfirm(undefined);
      paint();
      return;
    }
    if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '/') {
      const search = root.querySelector?.('#query') as { focus?(): void } | null | undefined;
      if (search?.focus) { event.preventDefault(); search.focus(); }
    } else if (event.key === 'n') {
      event.preventDefault();
      opener = '.top-tools [data-panel="add"]';
      app.setPanel('add', false);
      paint();
    }
  };
  const page = host().document as { addEventListener?(type: 'keydown', listener: (event: PageEvent) => void): void } | undefined;
  if (page?.addEventListener) page.addEventListener('keydown', onKey);
  else root.addEventListener('keydown', onKey);
  paint();
  finish(app.restoreSession());
}

class WebController implements WebApp {
  private library: LibraryModel | undefined;
  private etag: string | undefined;
  private username: string | undefined;
  private loginName = '';
  private mode: WebSnapshot['mode'] = 'login';
  private message = '';
  private query = '';
  private favoritesOnly = false;
  private scope: WebScope = 'all';
  private lastScope: WebScope = 'all';
  private folderId: string | undefined;
  private tag: string | undefined;
  private limit = PAGE_SIZE;
  private panel: WebPanel = 'none';
  private editingId: string | undefined;
  private readonly selection = new Set<string>();
  private confirmKey: string | undefined;
  private folderDraft: FolderDraft | undefined;
  private addDraft: (BookmarkInput & { duplicateOf?: string }) | undefined;
  private addError: string | undefined;
  private editError: string | undefined;
  private modal: WebModal | undefined;
  private admin = false;
  private accounts: ManagedAccount[] | undefined;
  private accountsLoading = false;
  private accountsError: string | undefined;
  private accountNotice: { kind: 'created' | 'reset' | 'deleted'; username: string; password?: string } | undefined;
  private resetTarget: string | undefined;
  private toast: Toast | undefined;
  private busy = false;
  private importDraft: ImportResult | undefined;
  private pending: PendingConflict | undefined;

  constructor(
    private readonly client: AccountClient,
    private readonly now: () => string,
    private look: WebAppearance,
    private prefs: WebPreferences,
  ) {
    if (!SORTS[this.prefs.sort]) this.prefs.sort = 'updatedAt:desc';
  }

  async login(username: string, password: string): Promise<void> {
    this.loginName = username;
    this.busy = true;
    try {
      const session = await this.client.login(username, password);
      this.username = session.username;
      this.admin = session.admin === true;
    } catch (error) {
      if (error instanceof WebRequestError && error.status === 401) {
        if (this.library) this.message = '登录信息不正确，没有切换账号。';
        else {
          this.mode = 'login';
          this.message = '登录信息不正确，没有进入账号。';
        }
      } else if (this.library) this.message = '连不上服务，没有切换账号。';
      else this.showOffline();
      throw error;
    } finally {
      this.busy = false;
    }
    try {
      await this.reload();
    } catch (error) {
      this.failRead();
      throw error;
    }
  }

  async restoreSession(): Promise<boolean> {
    if (this.username || this.library) return false;
    const session = await this.client.checkSession();
    if (!session || this.username || this.library || this.mode !== 'login') return false;
    this.username = session.username;
    this.admin = session.admin;
    try {
      await this.reload();
      return true;
    } catch {
      this.username = undefined;
      this.mode = 'login';
      this.message = '';
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.client.logout();
    } catch (error) {
      this.message = '没有退出。仍显示当前账号。';
      throw error;
    }
    this.clearSession();
  }

  async refresh(): Promise<void> {
    if (!this.username) {
      this.goToLogin();
      return;
    }
    this.busy = true;
    try {
      await this.reload();
    } catch (error) {
      this.failRead();
      throw error;
    } finally {
      this.busy = false;
    }
  }

  goToLogin(): void {
    this.clearSession();
  }

  search(query: string): void {
    this.query = query;
    this.limit = PAGE_SIZE;
    this.refreshMessage();
  }

  setFavoritesOnly(value: boolean): void {
    this.favoritesOnly = value;
    this.refreshMessage();
  }

  showTrash(value: boolean): void {
    if (value) {
      if (this.scope !== 'trash') this.lastScope = this.scope;
      this.setScope('trash');
    } else this.setScope(this.lastScope === 'trash' ? 'all' : this.lastScope, this.lastScope === 'folder' ? this.folderId : this.tag);
  }

  setScope(scope: WebScope, value?: string): void {
    if (!SCOPES.some((item) => item.scope === scope) && scope !== 'folder' && scope !== 'tag') return;
    this.scope = scope;
    this.folderId = scope === 'folder' ? value : undefined;
    this.tag = scope === 'tag' ? value : undefined;
    this.limit = PAGE_SIZE;
    this.selection.clear();
    this.editingId = undefined;
    this.confirmKey = undefined;
    this.refreshMessage();
  }

  setSort(value: string): void {
    if (SORTS[value]) this.prefs.sort = value;
  }

  setView(view: WebView): void {
    this.prefs.view = view;
  }

  setPanel(panel: WebPanel, toggle = true): void {
    if (panel === 'add') {
      if (this.modal === 'add' && toggle) this.closeModal();
      else {
        this.closeModal();
        this.modal = 'add';
      }
      return;
    }
    this.panel = toggle && this.panel === panel ? 'none' : panel;
  }

  modalOpen(): WebModal | undefined {
    return this.mode === 'library' ? this.modal : undefined;
  }

  closeModal(): void {
    this.modal = undefined;
    this.editingId = undefined;
    this.editError = undefined;
    this.addDraft = undefined;
    this.addError = undefined;
    this.resetTarget = undefined;
    this.accountNotice = undefined;
    this.accountsError = undefined;
    this.confirmKey = undefined;
  }

  async openAccounts(): Promise<void> {
    if (!this.admin) return;
    this.closeModal();
    this.modal = 'accounts';
    await this.loadAccounts();
  }

  private async loadAccounts(): Promise<void> {
    this.accountsLoading = true;
    try {
      this.accounts = await this.client.listAccounts();
    } catch (error) {
      this.accountsError = error instanceof Error ? error.message : '连不上服务';
    } finally {
      this.accountsLoading = false;
    }
  }

  private async accountStep(step: () => Promise<void>): Promise<void> {
    this.accountsError = undefined;
    this.accountNotice = undefined;
    this.busy = true;
    try {
      await step();
    } catch (error) {
      this.accountsError = error instanceof Error ? error.message : '连不上服务，账号没有改动';
      throw error;
    } finally {
      this.busy = false;
    }
    await this.loadAccounts();
  }

  async createAccount(username: string, password: string): Promise<void> {
    await this.accountStep(async () => {
      if (password.length < 8) throw new Error('密码至少 8 个字符');
      const created = await this.client.createAccount(username, password);
      this.accountNotice = { kind: 'created', username: created, password };
    });
  }

  async resetAccountPassword(username: string, password: string): Promise<void> {
    await this.accountStep(async () => {
      if (password.length < 8) throw new Error('密码至少 8 个字符');
      await this.client.resetPassword(username, password);
      this.resetTarget = undefined;
      this.accountNotice = { kind: 'reset', username, password };
    });
  }

  async deleteAccount(username: string): Promise<void> {
    await this.accountStep(async () => {
      await this.client.deleteAccount(username);
      this.accountNotice = { kind: 'deleted', username };
    });
  }

  setResetTarget(username: string | undefined): void {
    this.resetTarget = this.resetTarget === username ? undefined : username;
    this.accountsError = undefined;
  }

  dismissAccountNotice(): void {
    this.accountNotice = undefined;
  }

  setAppearance(appearance: Partial<WebAppearance>): void {
    this.look = { ...this.look, ...appearance };
  }

  appearance(): WebAppearance {
    return { ...this.look };
  }

  showMore(): void {
    this.limit += PAGE_SIZE;
  }

  startEdit(id: string | undefined): void {
    if (!id) {
      if (this.modal === 'edit') this.closeModal();
      return;
    }
    this.closeModal();
    this.modal = 'edit';
    this.editingId = id;
  }

  toggleSelected(id: string, value = !this.selection.has(id)): void {
    if (value) this.selection.add(id);
    else this.selection.delete(id);
    this.confirmKey = undefined;
  }

  selectAll(value: boolean): void {
    this.selection.clear();
    if (value) for (const bookmark of this.visibleBookmarks()) this.selection.add(bookmark.id);
  }

  clearSelection(): void {
    this.selection.clear();
  }

  selectedIds(): string[] {
    const visible = new Set(this.visibleBookmarks().map((item) => item.id));
    return [...this.selection].filter((id) => visible.has(id));
  }

  /** Destructive steps ask twice: the first click arms the button, the second one acts. */
  armConfirm(key: string | undefined): boolean {
    if (key && this.confirmKey === key) {
      this.confirmKey = undefined;
      return true;
    }
    this.confirmKey = key;
    return false;
  }

  setFolderDraft(draft: FolderDraft | undefined): void {
    this.folderDraft = draft;
  }

  dismissToast(): void {
    this.toast = undefined;
  }

  notify(text: string): void {
    this.toast = { text };
  }

  async addBookmark(input: BookmarkInput, force = false): Promise<void> {
    const library = this.requireLibrary();
    const url = this.typedUrl(input.url);
    let model: LibraryModel;
    try {
      const normalized = normalizeBookmarkUrl(url);
      if (!isHttpBookmarkUrl(normalized)) throw new Error('not http');
      const existing = liveBookmarksOf(library).find((item) => urlKey(item.url) === urlKey(normalized));
      if (existing && !force) {
        this.addDraft = { ...input, url: normalized, duplicateOf: existing.id };
        this.addError = `这个网址已经保存过：「${existing.title || existing.url}」。可以修改后再保存，或仍然另存一份。`;
        return;
      }
      model = addBookmark(library, { ...input, url: normalized }, this.now());
    } catch (error) {
      this.addDraft = { ...input };
      this.addError = INVALID_URL;
      throw error;
    }
    this.addDraft = { ...input };
    this.addError = undefined;
    try {
      await this.persist(model, `已保存「${input.title?.trim() || domainFromUrl(url)}」`);
    } catch (error) {
      this.addError = UNSAVED;
      throw error;
    }
    if (this.mode === 'library' && this.modal === 'add') this.closeModal();
    else if (this.mode === 'conflict') this.closeModal();
    else this.addDraft = undefined;
  }

  async updateBookmark(id: string, patch: BookmarkPatch): Promise<void> {
    let model: LibraryModel;
    try {
      model = updateBookmark(this.requireLibrary(), id, patch.url === undefined ? patch : { ...patch, url: this.typedUrl(patch.url) }, this.now());
    } catch (error) {
      this.message = patch.url !== undefined ? INVALID_URL : UNSAVED;
      this.editError = this.message;
      throw error;
    }
    try {
      await this.persist(model, '修改已保存');
    } catch (error) {
      this.editError = UNSAVED;
      throw error;
    }
    if (this.modal === 'edit') this.closeModal();
    this.editingId = undefined;
  }

  async toggleFavorite(id: string): Promise<void> {
    const bookmark = this.requireLibrary().bookmarks.find((item) => item.id === id);
    if (!bookmark) return;
    await this.persist(favoriteBookmarksBatch(this.requireLibrary(), [id], !bookmark.favorite, this.now()), bookmark.favorite ? '已取消收藏' : '已加入收藏');
  }

  async deleteBookmark(id: string): Promise<void> {
    await this.persist(deleteBookmark(this.requireLibrary(), id, this.now()), { text: '已移到回收站', undo: { kind: 'restore', ids: [id] } });
    if (this.editingId === id) this.closeModal();
  }

  async restoreBookmark(id: string): Promise<void> {
    await this.persist(restoreBookmark(this.requireLibrary(), id, this.now()), '已恢复');
  }

  async restoreMany(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    await this.persist(restoreBookmarksBatch(this.requireLibrary(), ids, this.now()), `已恢复 ${ids.length} 个书签`);
    this.selection.clear();
  }

  async emptyTrash(): Promise<void> {
    const count = trashedBookmarksOf(this.requireLibrary()).length;
    await this.persist(emptyTrash(this.requireLibrary()), count ? `已彻底删除 ${count} 个书签` : undefined);
  }

  async purgeMany(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    await this.persist(purgeBookmarksBatch(this.requireLibrary(), ids), `已彻底删除 ${ids.length} 个书签`);
    this.selection.clear();
  }

  async deleteMany(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    await this.persist(deleteBookmarksBatch(this.requireLibrary(), ids, this.now()), { text: `已把 ${ids.length} 个书签移到回收站`, undo: { kind: 'restore', ids: [...ids] } });
    this.selection.clear();
  }

  async favoriteMany(ids: readonly string[], favorite: boolean): Promise<void> {
    if (!ids.length) return;
    await this.persist(favoriteBookmarksBatch(this.requireLibrary(), ids, favorite, this.now()), favorite ? `已收藏 ${ids.length} 个书签` : `已取消收藏 ${ids.length} 个书签`);
  }

  async moveMany(ids: readonly string[], folder: string): Promise<void> {
    if (!ids.length) return;
    await this.persist(moveBookmarksBatch(this.requireLibrary(), ids, folder, this.now()), folder.trim() ? `已移到「${folder.trim()}」` : '已移到未归类');
    this.selection.clear();
  }

  async tagMany(ids: readonly string[], tags: readonly string[]): Promise<void> {
    if (!ids.length || !tags.length) return;
    await this.persist(tagBookmarksBatch(this.requireLibrary(), ids, tags, [], this.now()), `已给 ${ids.length} 个书签加上标签`);
  }

  async cleanDuplicates(): Promise<void> {
    const ids = extraDuplicateIdsOf(this.requireLibrary());
    const result = cleanDuplicatesInLibrary(this.requireLibrary(), this.now());
    if (!result.removed) return;
    await this.persist(result.model, { text: `已把 ${result.removed} 个多余副本移到回收站`, undo: { kind: 'restore', ids } });
  }

  async createFolder(name: string, parentId?: string): Promise<void> {
    if (!name.trim()) { this.folderDraft = undefined; return; }
    await this.persist(createCollectionInLibrary(this.requireLibrary(), name, parentId, this.now()), `已新建文件夹「${name.trim()}」`);
    this.folderDraft = undefined;
  }

  async renameFolder(id: string, name: string): Promise<void> {
    if (!name.trim()) { this.folderDraft = undefined; return; }
    await this.persist(renameCollectionInLibrary(this.requireLibrary(), id, name, this.now()), '文件夹已改名');
    this.folderDraft = undefined;
  }

  async deleteFolder(id: string): Promise<void> {
    await this.persist(deleteCollectionInLibrary(this.requireLibrary(), id, this.now()), '文件夹已删除，里面的书签移到了未归类');
    if (this.scope === 'folder' && this.folderId === id) this.setScope('all');
  }

  async beginImport(text: string, format: 'html' | 'json'): Promise<'applied' | 'awaiting-choice' | 'rejected'> {
    const library = this.requireLibrary();
    const parsed = parseImport(text, format);
    if (!parsed.bookmarks.length && !parsed.purgedIds.length) {
      this.message = '没有导入书签，账号保持不变。';
      return 'rejected';
    }
    if (countDuplicateImports(library, parsed) > 0) {
      this.importDraft = parsed;
      this.mode = 'import-choice';
      this.message = '尚未选择重复项处理方式，账号保持不变。';
      return 'awaiting-choice';
    }
    await this.persist(applyImport(library, parsed, 'skip', this.now()), `已导入 ${parsed.bookmarks.length} 个书签`);
    this.panel = 'none';
    return 'applied';
  }

  async chooseImport(action: DuplicateImportAction): Promise<void> {
    if (action !== 'skip' && action !== 'update' && action !== 'copy') throw new Error('未知的重复项处理方式');
    if (!this.library || !this.importDraft) throw new Error('还没有需要选择的重复项');
    await this.persist(applyImport(this.library, this.importDraft, action, this.now()), '导入完成');
    this.panel = 'none';
  }

  cancelImport(): void {
    this.importDraft = undefined;
    if (!this.library) return;
    this.mode = 'library';
    this.refreshMessage();
  }

  exportJson(): string {
    return exportJson(this.requireLibrary(), this.now());
  }

  exportHtml(): string {
    return exportHtml(this.requireLibrary());
  }

  async chooseConflict(bookmarkId: string, keep: ConflictKeep, patch?: BookmarkPatch & { deleted?: boolean }): Promise<void> {
    if (!this.pending) throw new Error('没有需要选择的版本');
    const conflict = this.pending.conflicts.find((item) => item.bookmarkId === bookmarkId);
    if (!conflict) throw new Error('没有这条书签的冲突');
    if (keep === 'merged' && !patch) throw new Error('合并需要给出要保留的内容');
    const choice: ConflictChoice = keep === 'merged'
      ? { keep, bookmark: this.bookmarkForMerge(conflict.local, patch ?? {}) }
      : { keep };
    this.pending.choices.set(bookmarkId, choice);
    if (this.pending.conflicts.some((item) => !this.pending?.choices.has(item.bookmarkId))) return;
    const merged = mergeTitleChoices(this.pending.attempted, this.pending.remote, this.pending.choices, this.now());
    const etag = this.pending.etag;
    try {
      await this.writeModel(merged, etag);
      this.toast = { text: '已按你的选择保存' };
    } catch (error) {
      if (error instanceof WebRequestError && error.status === 412) {
        await this.noteConflict(merged);
        return;
      }
      this.message = UNSAVED;
      throw error;
    }
  }

  visibleBookmarks(): Bookmark[] {
    if (!this.library) return [];
    return visibleBookmarks(this.library, this.filter());
  }

  snapshot(): WebSnapshot {
    return {
      mode: this.mode,
      message: this.message,
      username: this.username,
      admin: this.admin,
      importPending: this.mode === 'import-choice',
      conflicts: this.pending?.conflicts.map((conflict) => ({ ...conflict })) ?? [],
    };
  }

  sessionToken(): string | undefined {
    return this.client.sessionToken();
  }

  render(): string {
    if (this.mode === 'offline') return this.renderOffline();
    if (this.mode === 'login' || !this.library || !this.username) return this.renderLogin();
    return this.renderWorkspace();
  }

  // ── State plumbing ──

  private typedUrl(value: string): string {
    const trimmed = value.trim();
    if (!trimmed || /^[a-z][\w+.-]*:/i.test(trimmed)) return trimmed;
    return /^[^\s/]+\.[^\s/]+/.test(trimmed) ? `https://${trimmed}` : trimmed;
  }

  private requireLibrary(): LibraryModel {
    if (!this.library || !this.etag) throw new WebRequestError('没有进入账号', 401);
    return this.library;
  }

  private filter(): BookmarkFilter {
    const sort = SORTS[this.prefs.sort] ?? SORTS['updatedAt:desc'];
    return {
      query: this.query,
      favoritesOnly: this.favoritesOnly,
      trash: this.scope === 'trash',
      scope: this.scope,
      folderId: this.folderId,
      tag: this.tag,
      sort: this.scope === 'duplicates' ? undefined : sort.field,
      direction: sort.direction,
    };
  }

  private async reload(): Promise<void> {
    const snapshot = await this.client.readManifest();
    this.library = libraryFromManifest(snapshot.manifest);
    this.etag = snapshot.etag;
    this.mode = 'library';
    this.pending = undefined;
    this.importDraft = undefined;
    this.query = '';
    this.favoritesOnly = false;
    this.scope = 'all';
    this.folderId = undefined;
    this.tag = undefined;
    this.selection.clear();
    this.closeModal();
    this.panel = 'none';
    this.limit = PAGE_SIZE;
    this.refreshMessage();
  }

  private async persist(model: LibraryModel, done?: string | Toast): Promise<void> {
    const current = this.requireLibrary();
    this.confirmKey = undefined;
    if (librarySignature(model) === librarySignature(current)) {
      this.mode = 'library';
      this.importDraft = undefined;
      this.refreshMessage();
      return;
    }
    this.busy = true;
    try {
      await this.writeModel(model, this.etag ?? '');
      if (done) this.toast = typeof done === 'string' ? { text: done } : done;
    } catch (error) {
      if (error instanceof WebRequestError && error.status === 412) {
        await this.noteConflict(model);
        return;
      }
      this.message = UNSAVED;
      throw error;
    } finally {
      this.busy = false;
    }
  }

  private async writeModel(model: LibraryModel, etag: string): Promise<void> {
    const nextEtag = await this.client.writeManifest(manifestFromLibrary(model, this.now()), etag);
    this.library = model;
    this.etag = nextEtag;
    this.mode = 'library';
    this.pending = undefined;
    this.importDraft = undefined;
    const alive = new Set(this.visibleBookmarks().map((item) => item.id));
    for (const id of [...this.selection]) if (!alive.has(id)) this.selection.delete(id);
    this.refreshMessage();
  }

  private async noteConflict(attempted: LibraryModel): Promise<void> {
    let remote;
    try {
      remote = await this.client.readManifest();
    } catch {
      this.message = '连不上服务，没有写入这次修改。账号保持原样。';
      return;
    }
    const remoteModel = libraryFromManifest(remote.manifest);
    const conflicts = titleConflicts(attempted, remoteModel);
    if (!conflicts.length) {
      try {
        await this.writeModel(mergeTitleChoices(attempted, remoteModel, new Map(), this.now()), remote.etag);
      } catch (error) {
        if (error instanceof WebRequestError && error.status === 412) this.message = UNSAVED;
        throw error;
      }
      return;
    }
    this.mode = 'conflict';
    this.message = '同一条书签两边都改过，选择要保留的版本。选择完成前不会写回账号。';
    this.pending = { attempted, remote: remoteModel, etag: remote.etag, choices: new Map(), conflicts };
  }

  private bookmarkForMerge(base: Bookmark, patch: BookmarkPatch & { deleted?: boolean }): Bookmark {
    const library = this.pending?.attempted;
    let collectionId = patch.folder === undefined ? undefined : null as string | null;
    if (patch.folder !== undefined && library && this.pending) {
      const placed = folderFor(library, patch.folder, this.now());
      this.pending.attempted = placed.model;
      collectionId = placed.collectionId ?? null;
    }
    let bookmark = applyBookmarkUpdate(base, {
      title: patch.title,
      notes: patch.notes,
      tags: patch.tags,
      favorite: patch.favorite,
      collectionId,
    }, this.now());
    if (patch.url !== undefined) {
      const url = normalizeBookmarkUrl(patch.url);
      bookmark = { ...bookmark, url, domain: domainFromUrl(url) };
    }
    if (patch.deleted === true) bookmark = { ...bookmark, deletedAt: this.now() };
    else if (patch.deleted === false) delete bookmark.deletedAt;
    else if (base.deletedAt) bookmark = { ...bookmark, deletedAt: base.deletedAt };
    else delete bookmark.deletedAt;
    return { ...bookmark, id: base.id };
  }

  private showOffline(): void {
    this.mode = 'offline';
    this.library = undefined;
    this.etag = undefined;
    this.pending = undefined;
    this.importDraft = undefined;
    this.message = OFFLINE;
  }

  private failRead(): void {
    this.showOffline();
    this.username = undefined;
  }

  private clearSession(): void {
    this.library = undefined;
    this.etag = undefined;
    this.username = undefined;
    this.pending = undefined;
    this.importDraft = undefined;
    this.query = '';
    this.favoritesOnly = false;
    this.scope = 'all';
    this.folderId = undefined;
    this.tag = undefined;
    this.selection.clear();
    this.closeModal();
    this.admin = false;
    this.accounts = undefined;
    this.folderDraft = undefined;
    this.toast = undefined;
    this.panel = 'none';
    this.mode = 'login';
    this.message = '';
  }

  private refreshMessage(): void {
    if (!this.library || this.mode !== 'library') return;
    const visible = visibleBookmarks(this.library, this.filter());
    if (this.query.trim() || this.favoritesOnly || this.scope !== 'all') {
      this.message = visible.length || this.scope !== 'all' && !this.query.trim() && !this.favoritesOnly ? '' : NO_MATCH;
      return;
    }
    this.message = this.liveCount() ? '' : EMPTY;
  }

  private liveCount(): number {
    return this.library ? liveBookmarksOf(this.library).length : 0;
  }

  // ── Rendering ──

  private renderNotice(): string {
    if (!this.message || this.message === EMPTY || this.message === NO_MATCH) return '<p id="notice" role="status"></p>';
    const tone = /连不上|不正确|没有保存成|没有写入|没有退出|没有切换|网址无效/.test(this.message) ? 'danger'
      : /尚未选择|两边都改过|没有导入|已经保存过/.test(this.message) ? 'warning' : 'info';
    const icon = tone === 'info' ? '' : webIcon('alert');
    return `<p id="notice" role="status" data-tone="${tone}">${icon}<span>${escapeHtml(this.message)}</span></p>`;
  }

  private renderLogin(): string {
    return `<div data-mode="login" class="auth-page"><section class="auth-card" aria-labelledby="auth-title">` +
      `<header class="auth-head"><p class="auth-brand" id="auth-title">${webLogo(34)}<span>LumaMark</span></p>` +
      `<p class="auth-sub">登录你自己部署的书签服务，在任何电脑上整理同一份书签。</p></header>` +
      this.renderNotice() +
      `<form id="login" class="auth-form"><label><span>用户名</span><input name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required value="${escapeHtml(this.loginName)}"${this.loginName ? '' : ' autofocus'}></label>` +
      `<label><span>密码</span><input name="password" type="password" autocomplete="current-password" required${this.loginName ? ' autofocus' : ''}></label>` +
      `<button type="submit" class="primary"${this.busy ? ' disabled aria-busy="true"' : ''}>登录</button></form>` +
      `<p class="auth-foot">账号由管理员创建，此页面不能注册。</p></section></div>`;
  }

  private renderOffline(): string {
    return `<div data-mode="offline" class="auth-page"><section class="auth-card"><header class="auth-head">` +
      `<span class="empty-badge" aria-hidden="true">${webIcon('alert')}</span><h1 class="auth-brand">暂时连不上服务</h1>` +
      `<p class="auth-sub">书签都还在服务器上，只是这台电脑现在访问不到。检查网络或服务是否在运行后再试。</p></header>` +
      this.renderNotice() +
      `<div class="drawer-foot"><button type="button" class="ghost" data-action="to-login">返回登录</button>` +
      `<button type="button" class="primary" data-action="retry">${webIcon('sync')}<span>重新连接</span></button></div></section></div>`;
  }

  private scopeTitle(): string {
    const library = this.library;
    if (this.scope === 'folder' && library) return folderName(library, this.folderId) || '文件夹';
    if (this.scope === 'tag') return `#${this.tag ?? ''}`;
    return SCOPES.find((item) => item.scope === this.scope)?.label ?? '全部书签';
  }

  private renderWorkspace(): string {
    const library = this.library as LibraryModel;
    const readonly = this.mode !== 'library';
    const visible = this.visibleBookmarks();
    const account = `<span class="account-pill" data-account="${escapeHtml(this.username ?? '')}" title="当前账号：${escapeHtml(this.username ?? '')}"><span class="account-avatar" aria-hidden="true">${escapeHtml(titleInitialFor(this.username ?? ''))}</span><span class="account-name">${escapeHtml(this.username ?? '')}</span></span>`;
    let body = '';
    if (this.mode === 'conflict' && this.pending) body = this.renderConflicts();
    else if (this.mode === 'import-choice') body = importChoice(this.importDraft ? countDuplicateImports(library, this.importDraft) : 0);
    const shellAttrs = `data-mode="${this.mode}" data-bookmark-count="${readonly ? this.liveCount() : visible.length}"${this.busy ? ' aria-busy="true"' : ''}`;
    return `<div class="web-shell" ${shellAttrs}>` +
      this.renderSidebar(library, account, readonly) +
      `<main class="web-main">${this.renderTop(visible.length, readonly)}` +
      `<div class="web-body">${this.renderNotice()}${body}${readonly ? '' : this.renderScopeBanner(visible.length)}${this.renderList(visible, readonly)}</div></main>` +
      (readonly ? '' : this.renderBatchDock()) +
      this.renderToast() +
      this.renderModal() +
      `</div>`;
  }

  private renderSidebar(library: LibraryModel, account: string, readonly: boolean): string {
    const counts = scopeCountsOf(library);
    const navButton = (scope: WebScope, label: string, icon: string, count: number, value?: string) => {
      const pressed = this.scope === scope && (scope !== 'folder' || this.folderId === value) && (scope !== 'tag' || this.tag === value);
      return `<button type="button" class="nav-btn" data-scope="${scope}"${value ? ` data-scope-value="${escapeHtml(value)}"` : ''} aria-pressed="${pressed}"${readonly ? ' disabled' : ''}>` +
        `<span class="nav-icon" aria-hidden="true">${icon}</span><span class="nav-label">${escapeHtml(label)}</span>${count ? `<span class="nav-count">${count.toLocaleString()}</span>` : ''}</button>`;
    };
    const scopes = SCOPES
      .filter((item) => item.scope !== 'duplicates' || counts.duplicates || this.scope === 'duplicates')
      .map((item) => navButton(item.scope, item.label, webIcon(item.icon), counts[item.scope as keyof typeof counts] ?? 0)).join('');
    const draftForm = (draft: FolderDraft, initial = '') => `<form id="folder-form" class="folder-inline-form"${draft.id ? ` data-folder-id="${escapeHtml(draft.id)}"` : ''}${draft.parentId ? ` data-parent-id="${escapeHtml(draft.parentId)}"` : ''}>` +
      `<input id="folder-name" name="name" value="${escapeHtml(initial)}" placeholder="文件夹名称" aria-label="文件夹名称" autocomplete="off" autofocus required>` +
      `<button type="submit" class="primary">${draft.mode === 'rename' ? '改名' : '新建'}</button><button type="button" class="icon-btn" data-action="cancel-folder" aria-label="取消">${webIcon('x')}</button></form>`;
    const folderNode = (node: FolderTreeNode): string => {
      if (this.folderDraft?.mode === 'rename' && this.folderDraft.id === node.id) {
        return `<div class="folder-node">${draftForm(this.folderDraft, node.name)}${node.children.length ? `<div class="folder-children">${node.children.map(folderNode).join('')}</div>` : ''}</div>`;
      }
      const deleteArmed = this.confirmKey === `delete-folder:${node.id}`;
      const tools = readonly ? '' : `<span class="folder-tools">` +
        `<button type="button" class="folder-tool" data-action="new-folder" data-parent-id="${escapeHtml(node.id)}" title="新建子文件夹" aria-label="在「${escapeHtml(node.name)}」里新建文件夹">${webIcon('plus')}</button>` +
        `<button type="button" class="folder-tool" data-action="rename-folder" data-folder-id="${escapeHtml(node.id)}" title="改名" aria-label="给「${escapeHtml(node.name)}」改名">${webIcon('pencil')}</button>` +
        `<button type="button" class="folder-tool danger${deleteArmed ? ' is-armed' : ''}" data-action="delete-folder" data-folder-id="${escapeHtml(node.id)}" title="${deleteArmed ? '再点一次确认删除' : '删除文件夹'}" aria-label="${deleteArmed ? '再点一次确认删除' : `删除「${escapeHtml(node.name)}」`}">${deleteArmed ? webIcon('check') : webIcon('trash')}</button></span>`;
      const childDraft = this.folderDraft?.mode === 'create' && this.folderDraft.parentId === node.id ? draftForm(this.folderDraft) : '';
      const children = node.children.length || childDraft ? `<div class="folder-children">${node.children.map(folderNode).join('')}${childDraft}</div>` : '';
      return `<div class="folder-node"><div class="folder-row">${navButton('folder', node.name, webIcon('folder'), node.totalCount, node.id)}${tools}</div>${children}</div>`;
    };
    const tree = folderTreeOf(library);
    const rootDraft = this.folderDraft?.mode === 'create' && !this.folderDraft.parentId ? draftForm(this.folderDraft) : '';
    const folders = `<div class="side-group"><div class="side-section-head"><span>文件夹</span>${readonly ? '' : `<button type="button" class="icon-btn" data-action="new-folder" title="新建文件夹" aria-label="新建文件夹">${webIcon('folderPlus')}</button>`}</div>` +
      (tree.length || rootDraft ? tree.map(folderNode).join('') + rootDraft : `<p class="side-empty">还没有文件夹。新增书签时填写文件夹名，会自动创建。</p>`) + `</div>`;
    const tags = tagCountsOf(library).slice(0, 40);
    const tagCloud = tags.length ? `<div class="side-group"><div class="side-section-head"><span>标签</span></div><div class="tag-cloud">` +
      tags.map((tag) => `<button type="button" class="tag-pill" data-scope="tag" data-scope-value="${escapeHtml(tag.name)}" aria-pressed="${this.scope === 'tag' && this.tag === tag.name}"${readonly ? ' disabled' : ''}><span>${escapeHtml(tag.name)}</span><span class="tag-pill-count">${tag.count}</span></button>`).join('') +
      `</div></div>` : '';
    const swatches = ACCENT_CHOICES.map((accent) => `<button type="button" class="swatch-btn" data-accent-choice="${accent}" aria-pressed="${this.look.accent === accent}" aria-label="强调色 ${accent}" title="强调色"></button>`).join('');
    return `<aside class="web-side"><div class="side-brand-row"><span class="side-brand">${webLogo(26)}<span>LumaMark</span></span><span class="side-badge">网页版</span></div>` +
      `<div class="side-scroll"><nav class="side-group" aria-label="书签库">${scopes}</nav>${folders}${tagCloud}</div>` +
      `<footer class="side-foot"><div class="theme-popover"><div class="swatch-row" role="group" aria-label="强调色">${swatches}</div>` +
      `<button type="button" class="icon-btn" data-action="theme-toggle" title="${this.look.theme === 'dark' ? '切换到浅色' : '切换到深色'}" aria-label="${this.look.theme === 'dark' ? '切换到浅色' : '切换到深色'}">${webIcon(this.look.theme === 'dark' ? 'sun' : 'moon')}</button></div>` +
      `<div class="account-bar">${account}<span class="side-foot-actions">` +
      (this.admin ? `<button type="button" class="icon-btn" data-action="open-accounts" aria-haspopup="dialog" title="账号管理" aria-label="账号管理">${webIcon('user')}</button>` : '') +
      `<button type="button" class="icon-btn" data-action="retry" title="从服务器重新读取" aria-label="从服务器重新读取">${webIcon('sync')}</button>` +
      `<button type="button" class="icon-btn" data-action="logout" title="退出" aria-label="退出">${webIcon('logout')}</button></span></div></footer></aside>`;
  }

  private renderTop(count: number, readonly: boolean): string {
    const viewButton = (view: WebView, label: string, icon: WebIconName) => `<button type="button" data-view="${view}" aria-pressed="${this.prefs.view === view}" title="${label}" aria-label="${label}">${webIcon(icon)}</button>`;
    const panelButton = (panel: WebPanel, label: string, icon: WebIconName, cls: string) => `<button type="button" class="${cls}" data-action="toggle-panel" data-panel="${panel}" aria-expanded="${this.panel === panel}"${readonly ? ' disabled' : ''}>${webIcon(icon)}<span>${label}</span></button>`;
    const sortOptions = Object.entries(SORTS).map(([value, sort]) => `<option value="${value}"${value === this.prefs.sort ? ' selected' : ''}>${sort.label}</option>`).join('');
    const tools = readonly ? '' : `<div class="search-toolbar"><form id="search" role="search"><div class="search-box"><span class="search-glyph" aria-hidden="true">${webIcon('search')}</span>` +
      `<label class="sr-only" for="query">搜索书签</label><input id="query" name="query" type="search" autocomplete="off" placeholder="搜索标题、网址、标签、备注或文件夹（按 / 聚焦）" value="${escapeHtml(this.query)}">` +
      `<button type="submit" class="ghost search-submit">搜索</button></div></form>` +
      `<div class="filter-controls"><label class="check-chip"><input id="favorites-only" type="checkbox"${this.favoritesOnly ? ' checked' : ''}> 只看收藏</label>` +
      `<label class="sr-only" for="sort">排序</label><select id="sort" class="sort-select">${sortOptions}</select>` +
      `<div class="view-switcher" role="group" aria-label="显示方式">${viewButton('list', '列表', 'list')}${viewButton('compact', '紧凑', 'rows')}${viewButton('grid', '卡片', 'grid')}</div></div></div>`;
    return `<header class="web-top"><div class="top-head"><div class="title-group"><h1>${escapeHtml(this.scopeTitle())}</h1><span class="count-pill">${count.toLocaleString()} 个</span></div>` +
      `<div class="top-tools">${panelButton('import', '导入', 'upload', 'ghost')}${panelButton('export', '导出', 'download', 'ghost')}` +
      `<button type="button" class="primary" data-action="toggle-panel" data-panel="add" aria-haspopup="dialog" title="新增书签（N）"${readonly ? ' disabled' : ''}>${webIcon('plus')}<span>新增书签</span></button></div></div>` +
      tools + (readonly ? '' : this.renderPanel()) + `</header>`;
  }

  private renderPanel(): string {
    if (this.panel === 'import') {
      return `<form id="import" class="drawer-panel"><div class="drawer-head"><h2>${webIcon('upload')}导入书签</h2><button type="button" class="icon-btn" data-action="toggle-panel" data-panel="import" aria-label="收起">${webIcon('x')}</button></div>` +
        `<p class="form-hint">选择浏览器导出的 HTML 书签文件或 LumaMark JSON 备份。遇到已有网址时会先问你怎么处理。</p>` +
        `<label class="file-drop"><span>${webIcon('upload')} 选择文件</span><input id="import-file" type="file" accept=".html,.htm,.json,text/html,application/json"></label>` +
        `<label><span>或者粘贴内容</span><textarea name="content" rows="5" placeholder="&lt;!DOCTYPE NETSCAPE-Bookmark-file-1&gt; 或 { &quot;format&quot;: &quot;lumamark&quot; … }"></textarea></label>` +
        `<div class="drawer-foot"><label class="inline-select"><span>格式</span><select name="format"><option value="auto">自动识别</option><option value="html">HTML</option><option value="json">LumaMark JSON</option></select></label>` +
        `<button type="submit" class="primary">导入</button></div></form>`;
    }
    if (this.panel === 'export') {
      return `<section class="drawer-panel" aria-label="导出"><div class="drawer-head"><h2>${webIcon('download')}导出书签</h2><button type="button" class="icon-btn" data-action="toggle-panel" data-panel="export" aria-label="收起">${webIcon('x')}</button></div>` +
        `<div class="export-grid"><button type="button" class="secondary export-card" data-action="export-json">${webIcon('download')}<strong>导出 JSON</strong><small>完整备份：含文件夹、标签、备注和回收站，可再导入 LumaMark。</small></button>` +
        `<button type="button" class="secondary export-card" data-action="export-html">${webIcon('download')}<strong>导出 HTML</strong><small>通用书签文件，可导入 Chrome、Edge、Firefox、Safari。</small></button></div></section>`;
    }
    return '';
  }

  private renderScopeBanner(count: number): string {
    const library = this.library as LibraryModel;
    if (this.scope === 'duplicates') {
      const extra = scopeCountsOf(library).duplicates;
      if (!extra) return '';
      const armed = this.confirmKey === 'clean-duplicates';
      return `<div class="scope-banner"><div class="scope-banner-text"><strong>有 ${extra} 个多余副本</strong><p>每组保留收藏过、有备注或标签、最近改过的那一条，其余移到回收站，可以恢复。</p></div>` +
        `<button type="button" class="${armed ? 'danger' : 'primary'}" data-action="clean-duplicates">${armed ? '再点一次确认' : '一键清理'}</button></div>`;
    }
    if (this.scope === 'trash' && count) {
      const armed = this.confirmKey === 'empty-trash';
      return `<div class="scope-banner"><div class="scope-banner-text"><strong>回收站里的书签可以恢复</strong><p>清空后会从账号里彻底删除，其他设备同步后也不会再出现。</p></div>` +
        `<div class="drawer-foot"><button type="button" class="secondary" data-action="restore-all">${webIcon('undo')}<span>全部恢复</span></button>` +
        `<button type="button" class="danger${armed ? ' is-armed' : ''}" data-action="empty-trash">${armed ? '再点一次确认清空' : '清空回收站'}</button></div></div>`;
    }
    return '';
  }

  private renderEmpty(): string {
    const query = this.query.trim();
    if (query || this.favoritesOnly) {
      return emptyBox('search', '没有符合条件的书签', query ? `没有找到包含「${query}」的书签。换个关键词，或在全部书签里搜索。` : '当前范围里没有收藏的书签。',
        `${query ? '<button type="button" class="secondary" data-action="clear-search">清除搜索</button>' : ''}${this.scope !== 'all' ? '<button type="button" class="ghost" data-scope="all">查看全部书签</button>' : ''}`);
    }
    if (this.scope === 'trash') return emptyBox('trash', '回收站是空的', '删除的书签会先放在这里，可以随时恢复。');
    if (this.scope === 'favorites') return emptyBox('star', '还没有收藏', '点书签右侧的星标，常用的网址就会出现在这里。');
    if (this.scope === 'recent') return emptyBox('clock', '最近 30 天没有新书签', '新保存的书签会先出现在这里。');
    if (this.scope === 'unfiled') return emptyBox('inbox', '所有书签都已归类', '没有放进文件夹的书签会出现在这里。');
    if (this.scope === 'duplicates') return emptyBox('copy', '没有重复的网址', '同一个网址保存了多次时，会在这里集中处理。');
    if (this.scope === 'folder') return emptyBox('folder', '这个文件夹是空的', '新增书签时选择这个文件夹，或者在列表里勾选书签后批量移进来。', '<button type="button" class="primary" data-action="toggle-panel" data-panel="add">新增书签</button>');
    if (this.scope === 'tag') return emptyBox('tag', '这个标签下没有书签', '标签可以在编辑书签时添加。');
    const box = emptyBox('bookmark', EMPTY.replace('。', ''), '在下面填入网址保存第一条书签，或者导入浏览器导出的 HTML 书签文件。',
      '<button type="button" class="secondary" data-action="toggle-panel" data-panel="import">导入书签</button>');
    if (this.modal === 'add') return box;
    return `${box}<form id="add" class="drawer-panel empty-add">${this.addFormBody()}` +
      `<div class="drawer-foot"><span class="form-hint">只填网址也可以，标题默认用网站名。</span><button type="submit" class="primary"${this.busy ? ' disabled' : ''}>${this.addDraft?.duplicateOf ? '仍然另存一份' : '保存书签'}</button></div></form>`;
  }

  private datalists(): string {
    const library = this.library as LibraryModel;
    return `<datalist id="folder-options">${folderPathsOf(library).map((path) => `<option value="${escapeHtml(path)}"></option>`).join('')}</datalist>` +
      `<datalist id="tag-options">${tagCountsOf(library).slice(0, 60).map((tag) => `<option value="${escapeHtml(tag.name)}"></option>`).join('')}</datalist>`;
  }

  private addFormBody(): string {
    const library = this.library as LibraryModel;
    const draft = this.addDraft;
    const fields = bookmarkFields({
      title: draft?.title ?? '',
      url: draft?.url ?? '',
      folder: draft?.folder ?? (this.scope === 'folder' ? folderPathName(library, this.folderId) : ''),
      tags: (draft?.tags ?? (this.scope === 'tag' && this.tag ? [this.tag] : [])).join(', '),
      notes: draft?.notes ?? '',
      favorite: draft?.favorite ?? this.scope === 'favorites',
    }, true);
    const force = draft?.duplicateOf ? '<input type="hidden" name="force" value="1">' : '';
    return `${fields}${force}${this.datalists()}${formAlert(this.addError, draft?.duplicateOf ? 'warning' : 'danger')}`;
  }

  private renderModal(): string {
    const modal = this.modalOpen();
    if (!modal) return '';
    const close = `<button type="button" class="icon-btn modal-close" data-action="close-modal" title="关闭（Esc）" aria-label="关闭">${webIcon('x')}</button>`;
    const wrap = (inner: string) => `<div class="modal-backdrop" data-modal-backdrop>${inner}</div>`;
    const busy = this.busy ? ' disabled aria-busy="true"' : '';
    if (modal === 'add') {
      return wrap(`<form id="add" class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">` +
        `<header class="modal-head"><span class="modal-icon" aria-hidden="true">${webIcon('bookmarkPlus')}</span><div class="modal-title-group"><h2 id="modal-title">新增书签</h2><p class="modal-sub">只填网址也可以，标题默认用网站名。</p></div>${close}</header>` +
        `<div class="modal-body">${this.addFormBody()}</div>` +
        `<footer class="modal-foot"><span class="form-hint">Ctrl + Enter 保存</span><button type="button" class="ghost" data-action="close-modal">取消</button>` +
        `<button type="submit" class="primary"${busy}>${this.addDraft?.duplicateOf ? '仍然另存一份' : '保存书签'}</button></footer></form>`);
    }
    if (modal === 'edit') {
      const library = this.library as LibraryModel;
      const bookmark = library.bookmarks.find((item) => item.id === this.editingId && !item.deletedAt);
      if (!bookmark) return '';
      const id = escapeHtml(bookmark.id);
      const nowMs = Date.parse(this.now()) || Date.now();
      const fields = bookmarkFields({ title: bookmark.title, url: bookmark.url, folder: folderPathName(library, bookmark.collectionId), tags: bookmark.tags.join(', '), notes: bookmark.notes, favorite: bookmark.favorite }, false);
      return wrap(`<form class="modal" data-action="update" data-bookmark-id="${id}" role="dialog" aria-modal="true" aria-labelledby="modal-title">` +
        `<header class="modal-head"><span class="bm-tile" style="--tile-hue:${tileHueFor(bookmark.domain || bookmark.title)}" aria-hidden="true">${escapeHtml(titleInitialFor(bookmark.title, bookmark.url))}</span>` +
        `<div class="modal-title-group"><h2 id="modal-title">编辑书签</h2><p class="modal-sub">${escapeHtml(bookmark.domain || bookmark.url)} · 添加于 ${escapeHtml(formatRelativeTime(bookmark.createdAt, nowMs))} · 修改于 ${escapeHtml(formatRelativeTime(bookmark.updatedAt, nowMs))}</p></div>${close}</header>` +
        `<div class="modal-body">${fields}${this.datalists()}${formAlert(this.editError, 'danger')}</div>` +
        `<footer class="modal-foot"><button type="button" class="ghost danger modal-delete" data-action="delete" data-bookmark-id="${id}">${webIcon('trash')}<span>移到回收站</span></button>` +
        `<button type="button" class="ghost" data-action="close-modal">取消</button><button type="submit" class="primary"${busy}>保存修改</button></footer></form>`);
    }
    return wrap(`<section class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="modal-title">` +
      `<header class="modal-head"><span class="modal-icon" aria-hidden="true">${webIcon('user')}</span><div class="modal-title-group"><h2 id="modal-title">账号管理</h2>` +
      `<p class="modal-sub">管理员账号由服务器环境变量提供；其他人的账号在这里创建。每个账号有自己独立的书签库。</p></div>${close}</header>` +
      `<div class="modal-body">${this.renderAccountNotice()}${formAlert(this.accountsError, 'danger')}` +
      `<form id="account-create" class="account-create"><div class="account-create-fields">` +
      `<label><span>用户名</span><input name="username" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64" required${this.resetTarget ? '' : ' data-autofocus'}></label>` +
      `<label><span>初始密码</span><span class="password-field"><input id="account-create-password" name="password" type="text" autocomplete="off" spellcheck="false" minlength="8" required placeholder="至少 8 个字符">` +
      `<button type="button" class="ghost" data-action="generate-password" data-target="#account-create-password">生成</button></span></label></div>` +
      `<button type="submit" class="primary"${busy}>${webIcon('plus')}<span>创建账号</span></button></form>` +
      this.renderAccountList() + `</div></section>`);
  }

  private renderAccountNotice(): string {
    const notice = this.accountNotice;
    if (!notice) return '';
    const name = escapeHtml(notice.username);
    const dismiss = `<button type="button" class="icon-btn" data-action="dismiss-account-notice" aria-label="关闭提示">${webIcon('x')}</button>`;
    if (notice.kind === 'deleted') return `<div class="account-notice">${webIcon('check')}<p>已删除账号 <strong>${name}</strong> 和它的书签。</p>${dismiss}</div>`;
    const password = escapeHtml(notice.password ?? '');
    const lead = notice.kind === 'created' ? `已创建账号 <strong>${name}</strong>。把下面的信息交给对方，对方用它登录网页或扩展：` : `已重置 <strong>${name}</strong> 的密码，它在其他地方的登录已经失效：`;
    const credentials = notice.kind === 'created' ? `用户名：${notice.username}\n密码：${notice.password ?? ''}` : (notice.password ?? '');
    return `<div class="account-notice">${webIcon('check')}<div class="account-notice-body"><p>${lead}</p>` +
      `<dl class="credential-list">${notice.kind === 'created' ? `<dt>用户名</dt><dd><code>${name}</code></dd>` : ''}<dt>密码</dt><dd><code>${password}</code></dd></dl>` +
      `<button type="button" class="secondary" data-action="copy-text" data-text="${escapeHtml(credentials)}">${webIcon('copy')}<span>复制</span></button></div>${dismiss}</div>`;
  }

  private renderAccountList(): string {
    if (this.accountsLoading && !this.accounts) return '<p class="account-empty">正在读取账号…</p>';
    const accounts = this.accounts ?? [];
    if (!accounts.length) return '<p class="account-empty">还没有其他账号。</p>';
    const nowMs = Date.parse(this.now()) || Date.now();
    const rows = accounts.map((account) => {
      const name = escapeHtml(account.username);
      const badges = (account.admin ? '<span class="side-badge">管理员</span>' : '') + (account.username === this.username ? '<span class="count-pill">当前登录</span>' : '');
      const armed = this.confirmKey === `account-delete:${account.username}`;
      const remove = account.admin ? '' : `<button type="button" class="${armed ? 'danger is-armed' : 'ghost danger'}" data-action="account-delete" data-username="${name}">${armed ? '再点一次删除' : '删除'}</button>`;
      const reset = account.admin ? '' : `<button type="button" class="ghost" data-action="account-reset" data-username="${name}" aria-expanded="${this.resetTarget === account.username}">重置密码</button>`;
      const resetForm = this.resetTarget === account.username
        ? `<form class="account-reset" data-action="account-reset" data-username="${name}"><span class="password-field"><input id="account-reset-password" name="password" type="text" autocomplete="off" spellcheck="false" minlength="8" required placeholder="新密码，至少 8 个字符" aria-label="${name} 的新密码" data-autofocus>` +
          `<button type="button" class="ghost" data-action="generate-password" data-target="#account-reset-password">生成</button></span>` +
          `<button type="button" class="ghost" data-action="account-reset" data-username="${name}">取消</button><button type="submit" class="primary">保存新密码</button></form>`
        : '';
      return `<li class="account-row"><div class="account-row-main"><span class="account-avatar" aria-hidden="true">${escapeHtml(titleInitialFor(account.username))}</span>` +
        `<div class="account-row-text"><p class="account-row-name">${name}${badges}</p><p class="account-row-meta">${account.admin ? '来自环境变量，密码在服务器上修改' : account.createdAt ? `创建于 ${escapeHtml(formatRelativeTime(account.createdAt, nowMs))}` : ''}</p></div>` +
        `<div class="account-row-actions">${reset}${remove}</div></div>${resetForm}</li>`;
    }).join('');
    return `<div class="account-list-head"><span>已有账号</span><span class="count-pill">${accounts.length}</span></div><ul class="account-list">${rows}</ul>`;
  }

  private renderList(visible: Bookmark[], readonly: boolean): string {
    if (!visible.length) return `<ul id="bookmarks" data-view="${this.prefs.view}"></ul>${readonly ? '' : this.renderEmpty()}`;
    const shown = visible.slice(0, this.limit);
    const selected = this.selectedIds().length;
    const all = selected > 0 && selected === visible.length;
    const subbar = readonly ? '' : `<div class="list-subbar"><label class="check-line"><input id="select-all" type="checkbox"${all ? ' checked' : ''} aria-label="全选当前列表"> ${selected ? `已选 ${selected} 个` : '全选'}</label>` +
      `<span>${visible.length > shown.length ? `显示 ${shown.length} / ${visible.length}` : `${visible.length} 个书签`}</span></div>`;
    const more = visible.length > shown.length ? `<button type="button" class="secondary show-more" data-action="show-more">再显示 ${Math.min(PAGE_SIZE, visible.length - shown.length)} 个</button>` : '';
    const nowMs = Date.parse(this.now()) || Date.now();
    return `${subbar}<ul id="bookmarks" data-view="${this.prefs.view}">${shown.map((bookmark) => this.renderBookmark(bookmark, readonly, nowMs)).join('')}</ul>${more}`;
  }

  private renderBookmark(bookmark: Bookmark, readonly: boolean, nowMs: number): string {
    const library = this.library as LibraryModel;
    const id = escapeHtml(bookmark.id);
    const folder = folderPathName(library, bookmark.collectionId);
    const selected = this.selection.has(bookmark.id);
    const editing = !readonly && this.editingId === bookmark.id && !bookmark.deletedAt;
    const hue = tileHueFor(bookmark.domain || bookmark.title);
    const url = escapeHtml(bookmark.url);
    const title = escapeHtml(bookmark.title || bookmark.url);
    const titleNode = isHttpBookmarkUrl(bookmark.url)
      ? `<a class="bm-title-link" href="${url}" target="_blank" rel="noreferrer noopener" title="${url}">${title}</a>`
      : `<span class="bm-title-link" title="${url}">${title}</span>`;
    const stamp = bookmark.deletedAt ?? bookmark.updatedAt;
    const meta = `<p class="bm-meta"><span class="bm-url">${escapeHtml(bookmark.domain || bookmark.url)}</span>` +
      (folder ? `<span class="bm-folder-pill">${webIcon('folder')}${escapeHtml(folder)}</span>` : '') +
      `<time datetime="${escapeHtml(stamp)}">${bookmark.deletedAt ? '删除于 ' : ''}${escapeHtml(formatRelativeTime(stamp, nowMs))}</time></p>`;
    const tags = bookmark.tags.length ? `<p class="bm-tags">${bookmark.tags.map((tag) => readonly
      ? `<span class="bm-tag">#${escapeHtml(tag)}</span>`
      : `<button type="button" class="bm-tag" data-tag-link="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join('')}</p>` : '';
    const notes = bookmark.notes ? `<p class="bm-notes">${escapeHtml(bookmark.notes)}</p>` : '';
    const iconBtn = (action: string, label: string, icon: string, extra = '') => `<button type="button" class="icon-btn${extra}" data-action="${action}" data-bookmark-id="${id}" title="${label}" aria-label="${label}">${icon}</button>`;
    let actions = '';
    if (!readonly) {
      actions = bookmark.deletedAt
        ? `<div class="bm-actions"><button type="button" class="secondary" data-action="restore" data-bookmark-id="${id}">${webIcon('undo')}<span>恢复</span></button></div>`
        : `<div class="bm-actions">${iconBtn('favorite', bookmark.favorite ? '取消收藏' : '收藏', starSvg(bookmark.favorite), bookmark.favorite ? ' is-on' : '')}` +
          `<button type="button" class="icon-btn" data-action="copy-link" data-url="${url}" title="复制链接" aria-label="复制链接">${webIcon('link')}</button>` +
          `${iconBtn('edit', '编辑', webIcon('pencil'))}${iconBtn('delete', '删除', webIcon('trash'), ' danger')}</div>`;
    }
    const check = readonly ? '' : `<label class="bm-check"><input type="checkbox" data-select="${id}"${selected ? ' checked' : ''} aria-label="选择 ${title}"></label>`;
    const classes = `bm-item${selected ? ' is-selected' : ''}${editing ? ' is-editing' : ''}`;
    return `<li class="${classes}" data-bookmark-id="${id}"><div class="bm-row">${check}<span class="bm-tile" style="--tile-hue:${hue}" aria-hidden="true">${escapeHtml(titleInitialFor(bookmark.title, bookmark.url))}</span>` +
      `<div class="bm-main"><div class="bm-title-line">${titleNode}${bookmark.favorite ? '<span class="bm-star-badge" aria-label="已收藏">★</span>' : ''}</div>${meta}${notes}${tags}</div>${actions}</div></li>`;
  }

  private renderBatchDock(): string {
    const ids = this.selectedIds();
    if (!ids.length) return '';
    const head = `<span class="batch-count">已选 ${ids.length} 个</span><button type="button" class="icon-btn" data-action="clear-selection" title="取消选择（Esc）" aria-label="取消选择">${webIcon('x')}</button>`;
    if (this.scope === 'trash') {
      const armed = this.confirmKey === 'batch-purge';
      return `<div class="batch-dock" role="toolbar" aria-label="批量操作">${head}<button type="button" class="primary" data-action="batch-restore">${webIcon('undo')}<span>恢复</span></button>` +
        `<button type="button" class="danger" data-action="batch-purge">${armed ? '再点一次彻底删除' : '彻底删除'}</button></div>`;
    }
    const library = this.library as LibraryModel;
    const allFavorite = ids.every((id) => library.bookmarks.find((item) => item.id === id)?.favorite);
    return `<div class="batch-dock" role="toolbar" aria-label="批量操作">${head}` +
      `<form id="batch-move" class="batch-form"><input name="folder" list="folder-options" placeholder="移到文件夹…" aria-label="目标文件夹（留空为未归类）" autocomplete="off"><button type="submit" class="secondary">${webIcon('move')}<span>移动</span></button></form>` +
      `<form id="batch-tag" class="batch-form"><input name="tags" list="tag-options" placeholder="加标签…" aria-label="要添加的标签" autocomplete="off"><button type="submit" class="secondary">${webIcon('tag')}<span>加标签</span></button></form>` +
      `<button type="button" class="ghost" data-action="${allFavorite ? 'batch-unfavorite' : 'batch-favorite'}">${starSvg(allFavorite)}<span>${allFavorite ? '取消收藏' : '收藏'}</span></button>` +
      `<button type="button" class="danger" data-action="batch-delete">${webIcon('trash')}<span>删除</span></button>` +
      `<datalist id="folder-options">${folderPathsOf(library).map((path) => `<option value="${escapeHtml(path)}"></option>`).join('')}</datalist>` +
      `<datalist id="tag-options">${tagCountsOf(library).slice(0, 60).map((tag) => `<option value="${escapeHtml(tag.name)}"></option>`).join('')}</datalist></div>`;
  }

  private renderToast(): string {
    if (!this.toast || this.mode !== 'library') return '';
    const undo = this.toast.undo?.ids.length
      ? `<button type="button" data-action="undo" data-ids="${escapeHtml(this.toast.undo.ids.join(','))}">撤销</button>` : '';
    return `<div id="toast" class="toast" role="status">${webIcon('check')}<span>${escapeHtml(this.toast.text)}</span>${undo}<button type="button" class="toast-close" data-action="dismiss-toast" aria-label="关闭提示">${webIcon('x')}</button></div>`;
  }

  private renderConflicts(): string {
    const localLibrary = this.pending?.attempted;
    const remoteLibrary = this.pending?.remote;
    const conflicts = this.pending?.conflicts ?? [];
    const done = conflicts.filter((item) => this.pending?.choices.has(item.bookmarkId)).length;
    const items = conflicts.map((conflict) => {
      const chosen = this.pending?.choices.get(conflict.bookmarkId);
      const localFolder = localLibrary ? folderName(localLibrary, conflict.local.collectionId) : '';
      const remoteFolder = remoteLibrary ? folderName(remoteLibrary, conflict.remote.collectionId) : '';
      const side = (which: 'local' | 'remote') => {
        const record = which === 'local' ? conflict.local : conflict.remote;
        const folder = which === 'local' ? localFolder : remoteFolder;
        const titleText = which === 'local' ? conflict.localTitle : conflict.remoteTitle;
        const fields = conflict.fields.filter((field) => field !== 'title').map((field) => (
          `<div class="conflict-field"><span class="conflict-field-name">${FIELD_NAMES[field]}</span><p data-field="${field}" data-side="${which}">${escapeHtml(conflictValue(record, field, folder))}</p></div>`
        )).join('');
        return `<div class="conflict-box${chosen?.keep === which ? ' is-chosen' : ''}"><span class="conflict-box-head">${which === 'local' ? '这个网页里的版本' : '服务器上的版本'}</span>` +
          `<div class="conflict-field"><span class="conflict-field-name">标题</span><p data-title-source="${which}">${escapeHtml(titleText)}</p></div>${fields}` +
          `<button type="button" class="${which === 'local' ? 'primary' : 'secondary'}" data-keep="${which}" data-bookmark-id="${escapeHtml(conflict.bookmarkId)}">${which === 'local' ? '保留网页版本' : '保留服务版本'}</button></div>`;
      };
      const deleted = conflict.fields.includes('deletedAt')
        ? `<label class="check-inline"><input name="deleted" type="checkbox"${conflict.local.deletedAt ? ' checked' : ''}> 删除</label>`
        : '';
      return `<article class="conflict-card" data-bookmark-id="${escapeHtml(conflict.bookmarkId)}">` +
        `<h2>选择要保留的版本${chosen ? ' <span class="count-pill">已选择</span>' : ''}</h2>` +
        `<div class="conflict-compare">${side('local')}${side('remote')}</div>` +
        `<details class="conflict-merge"><summary>都不对？手动合并两边</summary><form data-action="merge-conflict" data-bookmark-id="${escapeHtml(conflict.bookmarkId)}">` +
        `${bookmarkFields({ title: conflict.local.title, url: conflict.local.url, folder: localFolder, tags: conflict.local.tags.join(', '), notes: conflict.local.notes, favorite: conflict.local.favorite }, false)}${deleted}` +
        `<div class="drawer-foot"><button type="submit" class="primary">合并两边</button></div></form></details></article>`;
    }).join('');
    return `<section id="conflicts"><div class="drawer-head"><h2>${webIcon('alert')}有 ${conflicts.length} 条书签在别处也改过</h2><span class="count-pill">${done} / ${conflicts.length}</span></div>${items}</section>`;
  }
}

const FIELD_NAMES: Record<ConflictField, string> = {
  title: '标题',
  url: '网址',
  notes: '备注',
  tags: '标签',
  collectionId: '文件夹',
  favorite: '收藏',
  deletedAt: '回收站',
};

function conflictValue(bookmark: Bookmark, field: ConflictField, folder: string): string {
  if (field === 'url') return bookmark.url;
  if (field === 'title') return bookmark.title;
  if (field === 'notes') return bookmark.notes;
  if (field === 'tags') return bookmark.tags.join(', ');
  if (field === 'collectionId') return folder || '未分类';
  if (field === 'favorite') return bookmark.favorite ? '已收藏' : '未收藏';
  return bookmark.deletedAt ? '已删除' : '未删除';
}

function importChoice(count: number): string {
  return `<section id="import-choice"><div class="drawer-head"><h2>${webIcon('copy')}重复网址处理</h2></div>` +
    `<p class="form-hint">要导入的内容里有 ${count} 个网址已经在书签库中。选择处理方式后才会写入账号。</p>` +
    `<div class="choice-grid"><button type="button" class="secondary choice-card" data-import-action="skip"><strong>跳过重复</strong><small>已有的书签保持原样，只导入新的网址。</small></button>` +
    `<button type="button" class="secondary choice-card" data-import-action="update"><strong>更新已有记录</strong><small>用导入内容覆盖已有书签的标题、标签和备注。</small></button>` +
    `<button type="button" class="secondary choice-card" data-import-action="copy"><strong>另存一份</strong><small>两份都保留，之后可以在“重复网址”里清理。</small></button></div>` +
    `<div class="drawer-foot"><button type="button" class="ghost" data-action="cancel-import">取消</button></div></section>`;
}

function formAlert(text: string | undefined, tone: 'warning' | 'danger'): string {
  return text ? `<p class="form-alert" role="alert" data-tone="${tone}">${webIcon('alert')}<span>${escapeHtml(text)}</span></p>` : '';
}

function emptyBox(icon: WebIconName, title: string, text: string, actions = ''): string {
  return `<section class="empty-box" role="status"><span class="empty-badge" aria-hidden="true">${webIcon(icon)}</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p>${actions ? `<div class="drawer-foot">${actions}</div>` : ''}</section>`;
}

function bookmarkFields(values: { title: string; url: string; folder: string; tags: string; notes: string; favorite: boolean }, autofocus: boolean): string {
  return `<div class="field-grid">` +
    `<label class="span-2"><span>网址 </span><input name="url" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://example.com" value="${escapeHtml(values.url)}"${autofocus ? ' required' : ''}></label>` +
    `<label><span>标题 </span><input name="title" autocomplete="off" placeholder="留空则使用网站名" value="${escapeHtml(values.title)}"></label>` +
    `<label><span>文件夹 </span><input name="folder" list="folder-options" autocomplete="off" placeholder="未归类；用 / 分隔子文件夹" value="${escapeHtml(values.folder)}"></label>` +
    `<label><span>标签 </span><input name="tags" list="tag-options" autocomplete="off" placeholder="用逗号分隔" value="${escapeHtml(values.tags)}"></label>` +
    `<label class="check-inline"><input name="favorite" type="checkbox"${values.favorite ? ' checked' : ''}><span>收藏 </span></label>` +
    `<label class="span-2"><span>备注 </span><textarea name="notes" rows="2">${escapeHtml(values.notes)}</textarea></label></div>`;
}
