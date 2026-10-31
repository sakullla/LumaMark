import { isSeparator, type Bookmark, type BookmarkQuery, type Collection } from '../../../../packages/domain/src/index';
import { folderTree, isHttpUrl, tileHue, titleInitial, type FolderNode, type HomeSyncPhrase } from './bar';
import { copyFor, fill, relativeTime, type UiLanguage } from './copy';
import { escapeHtml } from './html';
import { faviconSource, folderIcon, logoMark, pencilIcon, searchIcon, starIcon, trashIcon, uiIcon, type UiIconName } from './icons';
import { ACCENTS, type AccentChoice } from './theme';

export type { UiLanguage } from './copy';
export { escapeHtml } from './html';
export { isHttpUrl, tileHue };

export type LibraryView = 'grid' | 'list' | 'compact';
export type SortField = 'updatedAt' | 'createdAt' | 'title' | 'domain';

export interface LibraryFilters {
  text: string;
  collectionId: string;
  tag: string;
  domain: string;
  from: string;
  to: string;
  favoriteOnly: boolean;
  includeDeleted: boolean;
  view: LibraryView;
  sort: SortField;
  direction: 'asc' | 'desc';
}

export const defaultLibraryFilters = (): LibraryFilters => ({
  text: '', collectionId: '', tag: '', domain: '', from: '', to: '', favoriteOnly: false, includeDeleted: false,
  view: 'list', sort: 'updatedAt', direction: 'desc',
});

export function toBookmarkQuery(filters: LibraryFilters): BookmarkQuery {
  return {
    text: filters.text.trim() || undefined,
    collectionId: filters.collectionId || undefined,
    tag: filters.tag.trim().toLowerCase() || undefined,
    domain: filters.domain.trim().toLowerCase() || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    favorite: filters.favoriteOnly ? true : undefined,
    sort: filters.sort,
    direction: filters.direction,
  };
}

const textOrder = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function filterBookmarks(bookmarks: Bookmark[], filters: LibraryFilters): Bookmark[] {
  const query = toBookmarkQuery(filters);
  const needle = query.text?.toLowerCase();
  return bookmarks
    .filter((bookmark) => {
      if (isSeparator(bookmark)) return false;
      if (bookmark.deletedAt && !filters.includeDeleted) return false;
      if (query.collectionId && bookmark.collectionId !== query.collectionId) return false;
      if (query.tag && !bookmark.tags.includes(query.tag)) return false;
      if (query.domain && bookmark.domain !== query.domain) return false;
      if (query.favorite !== undefined && bookmark.favorite !== query.favorite) return false;
      if (query.from && bookmark.updatedAt < inclusiveTimeBound(query.from, 'start')) return false;
      if (query.to && bookmark.updatedAt > inclusiveTimeBound(query.to, 'end')) return false;
      if (needle) {
        const haystack = [bookmark.title, bookmark.url, bookmark.domain, bookmark.notes, ...bookmark.tags].join(' ').toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    })
    .sort((left, right) => {
      const field = query.sort ?? 'updatedAt';
      const a = String(left[field] ?? '');
      const b = String(right[field] ?? '');
      const comparison = field === 'title' || field === 'domain' ? textOrder.compare(a, b) : a < b ? -1 : a > b ? 1 : 0;
      return query.direction === 'asc' ? comparison : -comparison;
    });
}

export function bookmarksInFolder(bookmarks: Bookmark[], folderId: string | null, filters: LibraryFilters): Bookmark[] {
  const scoped = bookmarks.filter((bookmark) => (bookmark.collectionId ?? null) === folderId && !bookmark.deletedAt);
  return filterBookmarks(scoped, { ...filters, collectionId: '', includeDeleted: false });
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function inclusiveTimeBound(value: string, edge: 'start' | 'end'): string {
  if (!DATE_ONLY.test(value)) return value;
  return edge === 'start' ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`;
}

export function libraryHasActiveFilters(filters: LibraryFilters): boolean {
  return Boolean(filters.text.trim() || filters.tag.trim() || filters.domain.trim() || filters.from || filters.to || filters.favoriteOnly || filters.includeDeleted);
}

export function renderLibraryResults(bookmarks: Bookmark[], folderId: string | null, filters: LibraryFilters, language: UiLanguage = 'en'): string {
  const visible = bookmarksInFolder(bookmarks, folderId, filters);
  if (visible.length) return visible.map((bookmark) => renderBookmarkCard(bookmark, language)).join('');
  const alive = bookmarks.some((bookmark) => !bookmark.deletedAt && !isSeparator(bookmark));
  if (!alive && !libraryHasActiveFilters(filters)) return renderEmptyState(defaultLibraryFilters(), language);
  if (libraryHasActiveFilters(filters)) return renderEmptyState(filters, language);
  return `<section class="empty-state" role="status"><p>${escapeHtml(copyFor(language).emptyFolder)}</p></section>`;
}

export function searchBookmarks(bookmarks: Bookmark[], text: string): Bookmark[] {
  if (!text.trim()) return [];
  return filterBookmarks(bookmarks.filter((bookmark) => !bookmark.deletedAt), { ...defaultLibraryFilters(), text });
}

export function viewClass(view: LibraryView): string {
  return `bookmark-view bookmark-view-${view}`;
}

export function collectionOptions(collections: Collection[], selected = '', language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  const lines: string[] = [];
  const walk = (nodes: FolderNode[], depth: number) => {
    for (const node of nodes) {
      const prefix = depth ? `${'· '.repeat(depth)}` : '';
      const mark = node.toolbar && node.name !== text.toolbarMark ? ` (${text.toolbarMark})` : '';
      lines.push(`<option value="${escapeHtml(node.id)}"${node.id === selected ? ' selected' : ''}>${escapeHtml(prefix + node.name + mark)}</option>`);
      walk(node.children, depth + 1);
    }
  };
  walk(folderTree(collections), 0);
  return lines.join('');
}

type LibraryScopeKind = 'all' | 'favorites' | 'recent' | 'unfiled' | 'duplicates' | 'trash';

/** Direct bookmark counts per folder id ('' = unfiled). */
export type FolderCounts = Record<string, number>;

export function folderCounts(bookmarks: Bookmark[]): FolderCounts {
  const counts: FolderCounts = {};
  for (const bookmark of bookmarks) {
    if (bookmark.deletedAt || isSeparator(bookmark)) continue;
    const key = bookmark.collectionId ?? '';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function treeButton(id: string, label: string, icon: string, selected: boolean, count: number | undefined, extra = ''): string {
  const badge = count ? `<span class="tree-count">${count}</span>` : '';
  return `<button type="button" class="tree-button" data-select-folder="${escapeHtml(id)}" data-drop="folder:${escapeHtml(id)}" aria-pressed="${selected ? 'true' : 'false'}">` +
    `<span class="tree-icon" aria-hidden="true">${icon}</span><span class="tree-label">${escapeHtml(label)}${extra}</span>${badge}</button>`;
}

/** The folder tree. Folders with children get a twisty; `collapsed` holds the ids folded shut. */
export function renderFolderTree(collections: Collection[], selected: string | null, language: UiLanguage = 'en', counts: FolderCounts = {}, collapsed: ReadonlySet<string> = new Set()): string {
  const text = copyFor(language);
  const walk = (nodes: FolderNode[]): string => nodes.map((node) => {
    const mark = node.toolbar ? ` <span class="toolbar-mark">${escapeHtml(text.toolbarMark)}</span>` : '';
    const open = !collapsed.has(node.id);
    const children = node.children.length && open ? `<div class="tree-children" role="group">${walk(node.children)}</div>` : '';
    const twisty = node.children.length
      ? `<button type="button" class="tree-twisty" data-toggle-folder="${escapeHtml(node.id)}" aria-expanded="${open}" aria-label="${escapeHtml(text.toggleFolder)}">${uiIcon(open ? 'chevronDown' : 'chevronRight')}</button>`
      : '';
    const icon = node.toolbar ? uiIcon('bookmark') : folderIcon();
    const tools = `<span class="tree-tools"><button type="button" class="tree-tool" data-folder-add="${escapeHtml(node.id)}" title="${escapeHtml(text.newSubfolder)}" aria-label="${escapeHtml(fill(text.addSubfolderTo, { v: node.name }))}">${uiIcon('plus')}</button>` +
      `<button type="button" class="tree-tool" data-folder-menu="${escapeHtml(node.id)}" title="${escapeHtml(text.folderMenu)}" aria-haspopup="menu" aria-label="${escapeHtml(fill(text.moreActions, { v: node.name }))}">${uiIcon('more')}</button></span>`;
    return `<div class="tree-node" data-folder-node="${escapeHtml(node.id)}" draggable="true"><div class="tree-row">${twisty}${treeButton(node.id, node.name, icon, node.id === selected, counts[node.id], mark)}${tools}</div>${children}</div>`;
  }).join('');
  return walk(folderTree(collections));
}

export interface ScopeCounts { all: number; favorites: number; recent: number; unfiled: number; duplicates: number; trash: number }

/** Smart views at the top of the sidebar. Duplicates and Trash appear only when they hold something. */
export function renderScopeNav(active: string, counts: ScopeCounts, language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  const row = (key: LibraryScopeKind, label: string, icon: UiIconName, count: number, drop = '') =>
    `<button type="button" class="tree-button" data-scope="${key}"${drop ? ` data-drop="${drop}"` : ''} aria-pressed="${active === key ? 'true' : 'false'}">` +
    `<span class="tree-icon" aria-hidden="true">${uiIcon(icon)}</span><span class="tree-label">${escapeHtml(label)}</span>${count ? `<span class="tree-count">${count.toLocaleString()}</span>` : ''}</button>`;
  return row('all', text.allBookmarks, 'layers', counts.all) +
    row('favorites', text.favorites, 'star', counts.favorites, 'favorites') +
    row('recent', text.recent, 'clock', counts.recent) +
    row('unfiled', text.unfiled, 'inbox', counts.unfiled, 'unfiled') +
    (counts.duplicates || active === 'duplicates' ? row('duplicates', text.duplicates, 'copy', counts.duplicates) : '') +
    row('trash', text.trash, 'trash', counts.trash, 'trash');
}

export function renderTagList(tags: ReadonlyArray<{ name: string; count: number }>, active: string | undefined, limit = Number.POSITIVE_INFINITY): string {
  const shown = tags.filter((tag, index) => index < limit || tag.name === active);
  return shown.map(({ name, count }) => `<button type="button" class="tag-pill" data-select-tag="${escapeHtml(name)}" data-drop="tag:${escapeHtml(name)}" aria-pressed="${name === active ? 'true' : 'false'}">` +
    `<span>${escapeHtml(name)}</span><span class="tag-pill-count">${count}</span></button>`).join('');
}

/** Site icon, with a letter tile waiting behind it in case the image fails. */
export function siteIcon(url: string, title: string, seed: string, faviconUrl?: string): string {
  const initial = escapeHtml(titleInitial(title));
  const hue = tileHue(seed || title);
  const source = faviconSource(url, faviconUrl);
  return source
    ? `<span class="item-icon"><img src="${escapeHtml(source)}" alt="" loading="lazy" data-initial="${initial}"><span class="item-fallback" style="--tile-hue:${hue}" hidden>${initial}</span></span>`
    : `<span class="item-fallback" style="--tile-hue:${hue}" aria-hidden="true">${initial}</span>`;
}

export interface CardOptions { path?: string; selected?: boolean; now?: number }

const MAX_ROW_TAGS = 3;

export function renderBookmarkCard(bookmark: Bookmark, language: UiLanguage = 'en', options: CardOptions = {}): string {
  const text = copyFor(language);
  const favoriteLabel = bookmark.favorite ? text.unfavorite : text.favorite;
  const url = escapeHtml(bookmark.url);
  // Bookmarklets and browser pages cannot be opened from an extension page; show them without a live link.
  const titleLink = isHttpUrl(bookmark.url)
    ? `<a class="bookmark-title" href="${url}" target="_blank" rel="noreferrer" title="${url}">${escapeHtml(bookmark.title)}</a>`
    : `<span class="bookmark-title" title="${url}">${escapeHtml(bookmark.title)}</span>`;
  const shown = bookmark.tags.slice(0, MAX_ROW_TAGS);
  const hiddenTags = bookmark.tags.length - shown.length;
  const tags = bookmark.tags.length
    ? `<p class="bookmark-tags">${shown.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join('')}${hiddenTags ? `<span class="tag tag-more">+${hiddenTags}</span>` : ''}</p>`
    : '';
  const notes = bookmark.notes ? `<p class="bookmark-notes">${escapeHtml(bookmark.notes)}</p>` : '';
  const path = options.path ? `<span class="bookmark-path">${escapeHtml(options.path)}</span>` : '';
  const stamp = bookmark.deletedAt ?? bookmark.updatedAt;
  const actions = bookmark.deletedAt
    ? `<button type="button" class="icon-button" data-action="restore" aria-label="${escapeHtml(text.restore)}" title="${escapeHtml(text.restore)}">${uiIcon('undo')}</button>`
    : `<button type="button" class="icon-button${bookmark.favorite ? ' is-on' : ''}" data-action="favorite" aria-label="${escapeHtml(favoriteLabel)}" title="${escapeHtml(favoriteLabel)}">${starIcon(bookmark.favorite)}</button>` +
      `<button type="button" class="icon-button" data-action="edit" aria-label="${escapeHtml(text.edit)}" title="${escapeHtml(text.edit)}">${pencilIcon()}</button>` +
      `<button type="button" class="icon-button danger" data-action="delete" aria-label="${escapeHtml(text.delete)}" title="${escapeHtml(text.delete)}">${trashIcon()}</button>` +
      `<button type="button" class="icon-button" data-action="more" aria-haspopup="menu" aria-label="${escapeHtml(text.bookmarkMenu)}" title="${escapeHtml(text.bookmarkMenu)}">${uiIcon('more')}</button>`;
  return `<article class="bookmark-card${options.selected ? ' is-selected' : ''}" data-bookmark-id="${escapeHtml(bookmark.id)}" data-favorite="${bookmark.favorite ? 'true' : 'false'}" style="--tile-hue:${tileHue(bookmark.domain || bookmark.title)}" draggable="true" tabindex="-1">` +
    `<label class="bookmark-select"><input type="checkbox" data-select-bookmark="${escapeHtml(bookmark.id)}"${options.selected ? ' checked' : ''} aria-label="${escapeHtml(text.select)} ${escapeHtml(bookmark.title)}"></label>` +
    `<span class="bookmark-band" aria-hidden="true"></span>${siteIcon(bookmark.url, bookmark.title, bookmark.domain, bookmark.faviconUrl)}<div class="bookmark-body">${titleLink}` +
    `<p class="bookmark-domain"><span>${escapeHtml(bookmark.domain || bookmark.url)}</span>${path}</p>${notes}</div>${tags}` +
    `<time class="bookmark-date" datetime="${escapeHtml(stamp)}">${escapeHtml(relativeTime(stamp, language, options.now))}</time>` +
    `<div class="bookmark-actions" role="group" aria-label="${escapeHtml(text.actions)}">${actions}</div></article>`;
}

function duplicateOptions(language: UiLanguage): string {
  const text = copyFor(language);
  return `<option value="skip">${escapeHtml(text.skip)}</option><option value="update">${escapeHtml(text.updateExisting)}</option><option value="copy">${escapeHtml(text.copyDuplicate)}</option>`;
}

/** A quiet note for a view that is empty for a good reason. */
export function renderNotice(icon: UiIconName, title: string, help: string, action?: { id: string; label: string }): string {
  const button = action ? `<div class="empty-actions"><button type="button" class="primary" data-action="${escapeHtml(action.id)}">${uiIcon('plus')}<span>${escapeHtml(action.label)}</span></button></div>` : '';
  return `<section class="empty-state" role="status"><span class="empty-icon" aria-hidden="true">${uiIcon(icon)}</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(help)}</p>${button}</section>`;
}

export function renderEmptyState(filters: LibraryFilters, language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  const constrained = Boolean(filters.text || filters.collectionId || filters.tag || filters.domain || filters.from || filters.to || filters.favoriteOnly || filters.includeDeleted);
  if (constrained) {
    return `<section class="empty-state" role="status"><span class="empty-icon" aria-hidden="true">${searchIcon()}</span>` +
      `<h2>${escapeHtml(text.noMatches)}</h2><p>${escapeHtml(text.noMatchesHelp)}</p>` +
      `<div class="empty-actions"><button type="button" class="secondary" data-action="clear-filters">${escapeHtml(text.clearFilters)}</button></div></section>`;
  }
  return `<section class="empty-state" role="status"><span class="empty-icon" aria-hidden="true">${folderIcon()}</span>` +
    `<h2>${escapeHtml(text.noBookmarks)}</h2><p>${escapeHtml(text.emptyLibraryHelp)}</p>` +
    `<div class="empty-actions"><button type="button" class="primary" data-action="import-html">${uiIcon('upload')}<span>${escapeHtml(text.importHtml)}</span></button>` +
    `<button type="button" class="secondary" data-action="save-page">${escapeHtml(text.saveCurrent)}</button></div>` +
    `<div class="empty-option"><label for="empty-import-action">${escapeHtml(text.duplicateRule)}</label><select id="empty-import-action">${duplicateOptions(language)}</select></div></section>`;
}

export function libraryFailureMessage(language: UiLanguage = 'en'): string {
  return `<p class="load-error" role="status">${escapeHtml(copyFor(language).loadFailed)}</p>`;
}

export function renderConflicts(items: Array<{ id: string; local?: Pick<Bookmark, 'title' | 'url' | 'notes'>; remote?: Pick<Bookmark, 'title' | 'url' | 'notes'> }>, language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  if (!items.length) return '';
  const side = (label: string, record: Pick<Bookmark, 'title' | 'url' | 'notes'> | undefined, resolution: 'local' | 'remote', action: string) =>
    `<div class="conflict-side"><h4>${escapeHtml(label)}</h4><p class="conflict-title">${escapeHtml(record?.title ?? '')}</p><p class="conflict-url">${escapeHtml(record?.url ?? '')}</p>` +
    `${record?.notes ? `<p>${escapeHtml(record.notes)}</p>` : ''}<button type="button" class="secondary" data-resolution="${resolution}">${escapeHtml(action)}</button></div>`;
  return `<h3>${escapeHtml(text.conflictTitle)}</h3>` + items.map((item) => `<article data-conflict-id="${escapeHtml(item.id)}">` +
    `${side(text.localVersion, item.local, 'local', text.keepThis)}${side(text.otherVersion, item.remote, 'remote', text.keepOther)}</article>`).join('');
}

export function renderSyncLine(phrase: HomeSyncPhrase, language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  const label = phrase === 'local-only' ? text.syncLocal : phrase === 'aligned' ? text.syncAligned : phrase === 'waiting-network' ? text.syncWaiting : text.syncNeeds;
  const dot = phrase === 'needs-attention' ? 'sync-dot danger' : phrase === 'aligned' ? 'sync-dot ok' : 'sync-dot';
  const status = `<span class="${dot}" aria-hidden="true"></span><span class="sync-text">${escapeHtml(label)}</span>`;
  if (phrase !== 'needs-attention') return status;
  return `${status} <a href="settings.html">${escapeHtml(text.openSettings)}</a>`;
}

export type RuntimeAction = 'native-status' | 'set-native-sync' | 'save' | 'undo' | 'open-library' | 'open-home' | 'open-settings' | 'open-existing' | 'capture' | 'list' | 'list-collections' | 'update-existing' | 'copy-existing' | 'update' | 'delete' | 'restore' | 'favorite' | 'sync' | 'sync-configure' | 'export' | 'import' | 'list-conflicts' | 'resolve-conflict' | 'collection-create' | 'collection-update' | 'collection-delete' | 'collection-restore' | 'add' | 'sync-status' | 'reorder' | 'set-toolbar' | 'get-search-engine' | 'set-search-engine' | 'get-sync-config' | 'set-auto-sync';

export interface RuntimeMessage { type: `lumamark-${RuntimeAction}`; payload?: unknown }

function pageShell(language: UiLanguage, title: string, body: string): string {
  const lang = language === 'zh' ? 'zh' : 'en';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body>${body}</body></html>`;
}

/** Brand and page switcher at the top of the sidebar on full-page surfaces. */
function appHeader(language: UiLanguage, current: 'library' | 'settings'): string {
  const text = copyFor(language);
  const link = (page: 'home' | 'library' | 'settings', label: string, icon: UiIconName) =>
    `<a href="${page}.html"${page === current ? ' aria-current="page"' : ''} title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${uiIcon(icon)}</a>`;
  return `<header class="app-header"><a class="app-brand" href="home.html">${logoMark(26)}<span>${escapeHtml(text.brand)}</span></a>` +
    `<nav class="app-nav" aria-label="${escapeHtml(text.navLabel)}">${link('home', text.home, 'home')}${link('library', text.library, 'library')}${link('settings', text.settings, 'settings')}</nav></header>`;
}

/** Modifier as this platform writes it, for shortcut hints. */
const MOD_KEY = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform ?? '') ? '⌘' : 'Ctrl ';

const KEY_HINT = (keys: string[]) => keys.map((key) => `<kbd>${escapeHtml(key)}</kbd>`).join('');

export function popupDocument(language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  const iconLink = (id: string, page: string, label: string, icon: UiIconName) =>
    `<a id="${id}" class="icon-link" href="${page}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${uiIcon(icon)}</a>`;
  return pageShell(language, 'LumaMark', `<main class="popup-shell"><header class="popup-header"><p class="brand">${logoMark(22)}<span>${escapeHtml(text.brand)}</span></p>` +
    `<nav class="header-actions" aria-label="${escapeHtml(text.navLabel)}">${iconLink('open-home', 'home.html', text.openHome, 'home')}${iconLink('open-library', 'library.html', text.library, 'library')}${iconLink('open-settings', 'settings.html', text.settings, 'settings')}</nav></header>` +
    `<h1 class="sr-only">${escapeHtml(text.saveCurrent)}</h1>` +
    `<article id="page-preview" class="page-preview"><span class="item-icon"><img id="page-icon" alt="" hidden><span id="page-fallback" class="item-fallback" hidden></span></span><div class="preview-text"><h2 id="page-title"></h2><p id="page-url"></p></div></article>` +
    `<p id="unsavable" class="form-note notice" hidden>${uiIcon('info')}<span>${escapeHtml(text.cannotSave)}</span></p>` +
    `<div id="save-folder-row" class="field-row"><label for="save-folder">${escapeHtml(text.saveTo)}</label><select id="save-folder"></select><div id="recent-folders" class="folder-chips" role="group" aria-label="${escapeHtml(text.recentFolders)}" hidden></div></div>` +
    `<details id="more"><summary>${uiIcon('tag')}<span>${escapeHtml(text.tagsAndNotes)}</span></summary><div class="form-grid"><label for="save-tags">${escapeHtml(text.tags)}</label><input id="save-tags" type="text" placeholder="work, reading"><div id="tag-suggestions" class="tag-suggestions" hidden></div><label for="save-notes">${escapeHtml(text.notes)}</label><textarea id="save-notes" rows="2"></textarea></div></details>` +
    `<button id="save" class="primary" type="button">${uiIcon('bookmarkPlus')}<span>${escapeHtml(text.saveCurrent)}</span></button>` +
    `<p class="popup-hint" id="save-hint"><kbd>${escapeHtml(text.keyboardSave)}</kbd><span>${escapeHtml(text.saveHint)}</span></p>` +
    `<section id="saved-editor" class="form-grid" hidden><p class="saved-headline"><span class="saved-check" aria-hidden="true">${uiIcon('check')}</span><span id="saved-text">${escapeHtml(text.savedHeadline)}</span></p><label for="edit-title">${escapeHtml(text.titleLabel)}</label><input id="edit-title" type="text"><label for="edit-folder">${escapeHtml(text.folder)}</label><select id="edit-folder"><option value="">${escapeHtml(text.topLevel)}</option></select>` +
    `<div class="button-row"><button id="save-edits" class="primary" type="button">${escapeHtml(text.saveChanges)}</button><button id="undo" class="ghost" type="button">${uiIcon('undo')}<span>${escapeHtml(text.undo)}</span></button><button id="delete-saved" class="danger" type="button">${escapeHtml(text.delete)}</button></div></section>` +
    `<div id="existing-actions" hidden><p id="existing-note">${uiIcon('bookmark')}<span id="existing-text">${escapeHtml(text.alreadySaved)}</span></p><div class="button-row"><button id="open-existing" class="secondary" type="button">${escapeHtml(text.editInLibrary)}</button><button id="update-existing" class="primary" type="button">${escapeHtml(text.update)}</button><button id="copy-existing" class="ghost" type="button">${escapeHtml(text.saveCopy)}</button></div></div>` +
    `<p id="status" role="status" aria-live="polite"></p></main>`);
}

function dialogFrame(id: string, labelledBy: string, body: string, extra = ''): string {
  return `<dialog id="${id}" class="dialog" aria-labelledby="${labelledBy}"${extra}>${body}</dialog>`;
}

export function libraryDocument(collections: Collection[] = [], language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  const viewButton = (view: LibraryView, label: string, icon: UiIconName, pressed = false) =>
    `<button type="button" data-view="${view}" aria-pressed="${pressed}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${uiIcon(icon)}</button>`;
  const sortOption = (value: string, label: string) => `<option value="${value}">${escapeHtml(label)}</option>`;
  const shortcut = (keys: string[], label: string) => `<div class="shortcut"><dt>${escapeHtml(label)}</dt><dd>${KEY_HINT(keys)}</dd></div>`;
  return pageShell(language, `${text.libraryTitle} · LumaMark`, `<main class="library-shell">` +
    `<aside class="library-side">${appHeader(language, 'library')}` +
    `<div class="side-actions"><button type="button" id="add-bookmark" class="primary">${uiIcon('plus')}<span>${escapeHtml(text.addNew)}</span></button><button type="button" id="open-palette" class="palette-trigger" title="${escapeHtml(text.commandHint)}" aria-label="${escapeHtml(text.commandHint)}">${searchIcon()}<kbd>${MOD_KEY}K</kbd></button></div>` +
    `<div class="side-scroll"><nav id="scope-nav" class="side-group" aria-label="${escapeHtml(text.library)}"></nav>` +
    `<div class="side-folders" id="side-folders"><div class="side-title" data-tree-root><span>${escapeHtml(text.folders)}</span><button type="button" id="show-new-folder" class="icon-button" title="${escapeHtml(text.newFolderHere)}" aria-label="${escapeHtml(text.newFolderHere)}">${uiIcon('plus')}</button></div>` +
    `<nav id="folder-tree" class="side-group" aria-label="${escapeHtml(text.folders)}">${renderFolderTree(collections, null, language)}</nav></div>` +
    `<div id="tags-group" hidden><div class="side-title"><span>${escapeHtml(text.tagsHeading)}</span></div><nav id="tag-list" class="tag-cloud" aria-label="${escapeHtml(text.tagsHeading)}"></nav><button type="button" id="tags-toggle" class="side-more" hidden></button></div>` +
    `</div><footer class="side-foot"><p id="sync-line" role="status"></p><span class="side-foot-tools"><button type="button" id="toggle-theme" class="icon-button" title="${escapeHtml(text.themeToggle)}" aria-label="${escapeHtml(text.themeToggle)}">${uiIcon('moon')}</button><button type="button" id="show-shortcuts" class="icon-button" title="${escapeHtml(text.shortcuts)}" aria-label="${escapeHtml(text.shortcuts)}">${uiIcon('keyboard')}</button></span></footer></aside>` +

    `<div class="library-main"><div class="library-top"><div class="library-head"><div class="library-title-block"><nav id="folder-trail" class="folder-trail" aria-label="${escapeHtml(text.folder)}" hidden></nav><div class="library-heading"><h1 id="folder-heading">${escapeHtml(text.allBookmarks)}</h1><p id="folder-count" class="folder-count"></p><button type="button" id="scope-more" class="icon-button" aria-haspopup="menu" title="${escapeHtml(text.menuLabel)}" aria-label="${escapeHtml(text.menuLabel)}" hidden>${uiIcon('more')}</button></div></div>` +
    `<div class="head-actions"><button type="button" id="open-replace" class="secondary tool-button" title="${escapeHtml(text.replaceAction)}">${uiIcon('replace')}<span>${escapeHtml(text.replaceAction)}</span></button>` +
    `<label class="select-field" title="${escapeHtml(text.sort)}"><span class="sr-only">${escapeHtml(text.sort)}</span><select id="sort">${sortOption('updatedAt:desc', text.sortUpdated)}${sortOption('createdAt:desc', text.sortNewest)}${sortOption('createdAt:asc', text.sortOldest)}${sortOption('title:asc', text.sortTitleAsc)}${sortOption('title:desc', text.sortTitleDesc)}${sortOption('domain:asc', text.sortDomain)}</select></label>` +
    `<div class="view-switcher" role="group" aria-label="${escapeHtml(text.view)}">${viewButton('list', text.list, 'list', true)}${viewButton('compact', text.compact, 'rows')}${viewButton('grid', text.grid, 'library')}</div></div></div>` +

    `<form id="filters" aria-label="${escapeHtml(text.searchLibrary)}"><div class="search-field"><label for="search" class="search-icon" title="${escapeHtml(text.searchLibrary)}"><span aria-hidden="true">${searchIcon()}</span><span class="sr-only">${escapeHtml(text.searchLibrary)}</span></label><input id="search" name="text" type="search" autocomplete="off" placeholder="${escapeHtml(text.searchLibrary)}"><kbd class="search-kbd" title="${escapeHtml(text.searchHint)}">/</kbd></div>` +
    `<details id="more-filters" class="menu"><summary>${uiIcon('filter')}<span>${escapeHtml(text.filters)}</span><span id="filter-count" class="count-badge" hidden></span></summary><div class="menu-panel filter-panel"><div class="form-grid">` +
    `<label for="tag">${escapeHtml(text.tags)}</label><input id="tag" name="tag" type="search" list="tag-options" autocomplete="off"><datalist id="tag-options"></datalist><label for="domain">${escapeHtml(text.domain)}</label><input id="domain" name="domain" type="search" list="domain-options" autocomplete="off"><datalist id="domain-options"></datalist>` +
    `<label for="from">${escapeHtml(text.savedAfter)}</label><input id="from" name="from" type="date"><label for="to">${escapeHtml(text.savedBefore)}</label><input id="to" name="to" type="date">` +
    `<label class="check-line" for="favorite"><input id="favorite" name="favoriteOnly" type="checkbox"> ${escapeHtml(text.favoritesOnly)}</label>` +
    `<div class="button-row"><button type="reset" class="secondary">${escapeHtml(text.clearFilters)}</button></div>` +
    `</div></div></details></form>` +
    `<div id="filter-row" class="filter-row" hidden><div id="search-scope" class="segmented" role="group" aria-label="${escapeHtml(text.searchScope)}" hidden></div><div id="active-filters" class="chip-row"></div></div></div>` +

    `<div class="library-content"><div id="scope-banner" class="scope-banner" hidden></div><div id="subfolders" class="subfolder-row" hidden></div>` +
    `<div class="results-head"><label class="check-line"><input id="select-all" type="checkbox"><span>${escapeHtml(text.selectAll)}</span></label></div>` +
    `<section id="results" class="bookmark-view bookmark-view-list" aria-live="polite"><div class="loading-state" aria-hidden="true"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div></section><div id="load-more" aria-hidden="true"></div></div>` +

    `<div class="batch-actions" id="batch-actions" hidden role="toolbar" aria-label="${escapeHtml(text.actions)}"><div class="batch-lead"><button type="button" id="batch-clear" class="icon-button" title="${escapeHtml(text.clearSelection)}" aria-label="${escapeHtml(text.clearSelection)}">${uiIcon('x')}</button><span id="batch-count" class="batch-count"></span><button type="button" id="batch-all" class="link-button"></button></div>` +
    `<div class="batch-group" data-batch="live"><button type="button" id="batch-move" class="secondary">${uiIcon('move')}<span>${escapeHtml(text.moveTo)}</span></button><button type="button" id="batch-tags" class="ghost" title="${escapeHtml(text.tagSelected)}">${uiIcon('tag')}<span>${escapeHtml(text.tagSelected)}</span></button>` +
    `<button type="button" id="batch-favorite" class="icon-button" title="${escapeHtml(text.favoriteSelected)}" aria-label="${escapeHtml(text.favoriteSelected)}">${uiIcon('star')}</button>` +
    `<button type="button" id="batch-replace" class="icon-button" title="${escapeHtml(text.replaceAction)}" aria-label="${escapeHtml(text.replaceAction)}">${uiIcon('replace')}</button>` +
    `<button type="button" id="batch-open" class="icon-button" title="${escapeHtml(text.openSelected)}" aria-label="${escapeHtml(text.openSelected)}">${uiIcon('external')}</button>` +
    `<button type="button" id="batch-delete" class="danger">${uiIcon('trash')}<span>${escapeHtml(text.deleteSelected)}</span></button></div>` +
    `<div class="batch-group" data-batch="trash" hidden><button type="button" id="batch-restore" class="primary">${escapeHtml(text.restore)}</button></div></div></div>` +

    `<form id="editor" class="form-grid" hidden aria-labelledby="editor-heading"><div class="editor-head"><span id="editor-icon" class="editor-icon" aria-hidden="true"></span><h2 id="editor-heading" class="dialog-title">${escapeHtml(text.editBookmark)}</h2><a id="editor-open" class="icon-link" target="_blank" rel="noreferrer" title="${escapeHtml(text.openPage)}" aria-label="${escapeHtml(text.openPage)}">${uiIcon('external')}</a><button type="button" id="editor-close" class="icon-button" title="${escapeHtml(text.close)}" aria-label="${escapeHtml(text.close)}">${uiIcon('x')}</button></div>` +
    `<label for="editor-title">${escapeHtml(text.titleLabel)}</label><input id="editor-title" name="title" type="text"><label for="editor-url">${escapeHtml(text.urlLabel)}</label><input id="editor-url" name="url" type="url">` +
    `<label for="editor-folder">${escapeHtml(text.folder)}</label><select id="editor-folder" name="folder"><option value="">${escapeHtml(text.topLevel)}</option>${collectionOptions(collections, '', language)}</select>` +
    `<label for="editor-tags">${escapeHtml(text.tags)}</label><input id="editor-tags" name="tags" type="text" autocomplete="off"><div id="editor-tag-suggestions" class="tag-suggestions" hidden></div><label for="editor-notes">${escapeHtml(text.notes)}</label><textarea id="editor-notes" name="notes" rows="4"></textarea>` +
    `<label class="check-line" for="editor-favorite"><input id="editor-favorite" name="favorite" type="checkbox"> ${escapeHtml(text.favorite)}</label><p id="editor-error" role="status"></p><p id="editor-meta" class="editor-meta"></p>` +
    `<div class="button-row dialog-actions"><button type="button" id="editor-delete" class="danger">${escapeHtml(text.delete)}</button><span class="spacer"></span><button type="button" id="editor-cancel" class="ghost">${escapeHtml(text.cancel)}</button><button type="submit" class="primary">${escapeHtml(text.saveChanges)}</button></div></form>` +

    `<dialog id="decision" class="dialog dialog-small" role="alertdialog" aria-modal="true" aria-labelledby="decision-heading"><h2 id="decision-heading" class="dialog-title">${escapeHtml(text.confirmTitle)}</h2><p id="decision-text"></p><div class="button-row dialog-actions"><button type="button" id="decision-cancel" class="secondary">${escapeHtml(text.cancel)}</button><button type="button" id="decision-alt" class="danger" hidden></button><button type="button" id="decision-confirm" class="danger">${escapeHtml(text.delete)}</button></div></dialog>` +

    dialogFrame('name-dialog', 'name-heading', `<form id="name-form" method="dialog"><h2 id="name-heading" class="dialog-title"></h2><label for="name-input">${escapeHtml(text.nameLabel)}</label><input id="name-input" type="text" autocomplete="off"><div class="button-row dialog-actions"><button type="button" id="name-cancel" class="ghost">${escapeHtml(text.cancel)}</button><button type="submit" class="primary">${escapeHtml(text.save)}</button></div></form>`, ' data-size="small"') +

    dialogFrame('add-dialog', 'add-heading', `<form id="add-form" method="dialog"><h2 id="add-heading" class="dialog-title">${escapeHtml(text.addBookmark)}</h2><p class="form-note">${escapeHtml(text.addBookmarkHelp)}</p><label for="add-url">${escapeHtml(text.urlLabel)}</label><input id="add-url" type="text" inputmode="url" autocomplete="off" placeholder="https://"><label for="add-title">${escapeHtml(text.titleLabel)}</label><input id="add-title" type="text" autocomplete="off"><label for="add-folder">${escapeHtml(text.folder)}</label><select id="add-folder"></select><label for="add-tags">${escapeHtml(text.tags)}</label><input id="add-tags" type="text" list="tag-options" autocomplete="off" placeholder="work, reading"><p id="add-error" class="form-error" role="status"></p><div class="button-row dialog-actions"><button type="button" id="add-cancel" class="ghost">${escapeHtml(text.cancel)}</button><button type="submit" class="primary">${escapeHtml(text.save)}</button></div></form>`) +

    `<dialog id="move-dialog" class="dialog dialog-list" aria-labelledby="move-heading"><h2 id="move-heading" class="dialog-title"></h2><div class="list-search">${searchIcon()}<input id="move-search" type="text" role="combobox" aria-expanded="true" aria-controls="move-list" autocomplete="off" placeholder="${escapeHtml(text.searchFolders)}"></div><div id="move-list" class="pick-list" role="listbox" aria-label="${escapeHtml(text.folders)}"></div></dialog>` +

    `<dialog id="palette" class="dialog dialog-list dialog-palette" aria-label="${escapeHtml(text.commandHint)}"><div class="list-search">${searchIcon()}<input id="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" autocomplete="off" placeholder="${escapeHtml(text.commandPlaceholder)}"><kbd>Esc</kbd></div><div id="palette-list" class="pick-list" role="listbox" aria-label="${escapeHtml(text.commandHint)}"></div></dialog>` +

    dialogFrame('tag-dialog', 'tag-heading', `<form id="tag-form" method="dialog"><h2 id="tag-heading" class="dialog-title"></h2><label for="tag-add">${escapeHtml(text.tagAdd)}</label><input id="tag-add" type="text" list="tag-options" autocomplete="off" placeholder="work, reading"><p class="form-note">${escapeHtml(text.tagAddHint)}</p><div id="tag-existing-group"><p class="field-label">${escapeHtml(text.tagRemove)}</p><div id="tag-existing" class="chip-row"></div></div><div class="button-row dialog-actions"><button type="button" id="tag-cancel" class="ghost">${escapeHtml(text.cancel)}</button><button type="submit" class="primary">${escapeHtml(text.apply)}</button></div></form>`) +

    dialogFrame('replace-dialog', 'replace-heading', `<form id="replace-form" method="dialog"><h2 id="replace-heading" class="dialog-title"></h2><p class="form-note">${escapeHtml(text.replaceHelp)}</p><div class="segmented" role="group" aria-label="${escapeHtml(text.replaceField)}"><label><input type="radio" name="replace-field" value="title" checked><span>${escapeHtml(text.titleLabel)}</span></label><label><input type="radio" name="replace-field" value="url"><span>${escapeHtml(text.urlLabel)}</span></label></div>` +
    `<div class="replace-fields"><div><label for="replace-find">${escapeHtml(text.replaceFind)}</label><input id="replace-find" type="text" autocomplete="off"></div><div><label for="replace-with">${escapeHtml(text.replaceWith)}</label><input id="replace-with" type="text" autocomplete="off"></div></div>` +
    `<label class="check-line" for="replace-case"><input id="replace-case" type="checkbox"> ${escapeHtml(text.matchCase)}</label><div id="replace-preview" class="replace-preview"></div><div class="button-row dialog-actions"><button type="button" id="replace-cancel" class="ghost">${escapeHtml(text.cancel)}</button><button type="submit" id="replace-apply" class="primary" disabled>${escapeHtml(text.apply)}</button></div></form>`) +

    dialogFrame('shortcut-dialog', 'shortcut-heading', `<div class="dialog-head"><h2 id="shortcut-heading" class="dialog-title">${escapeHtml(text.shortcuts)}</h2><button type="button" id="shortcut-close" class="icon-button" title="${escapeHtml(text.close)}" aria-label="${escapeHtml(text.close)}">${uiIcon('x')}</button></div><dl class="shortcut-list">` +
    `${shortcut(['Ctrl', 'K'], text.shortcutPalette)}${shortcut(['/'], text.shortcutSearch)}${shortcut(['N'], text.shortcutNew)}${shortcut(['J', 'K'], text.shortcutMove)}${shortcut(['X'], text.shortcutSelect)}${shortcut(['Shift', '↑↓'], text.shortcutRange)}${shortcut(['Ctrl', 'A'], text.shortcutAll)}${shortcut(['Enter'], text.shortcutOpen)}${shortcut(['E'], text.shortcutEdit)}${shortcut(['F'], text.shortcutFavorite)}${shortcut(['F2'], text.shortcutRename)}${shortcut(['Shift', 'F10'], text.shortcutMenu)}${shortcut(['Del'], text.shortcutDelete)}${shortcut(['Ctrl', 'Z'], text.shortcutUndo)}${shortcut(['Esc'], text.shortcutClear)}${shortcut(['?'], text.shortcutHelp)}</dl>`) +

    `<p id="library-status" class="toast" role="status" aria-live="polite"></p></main>`);
}

function cardHead(id: string, title: string, explain: string): string {
  return `<div class="card-head"><div><h2 id="${id}">${escapeHtml(title)}</h2><p>${escapeHtml(explain)}</p></div></div>`;
}

const SEARCH_PRESETS = [
  { name: 'Google', url: 'https://www.google.com/search?q={query}' },
  { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}' },
  { name: 'Bing', url: 'https://www.bing.com/search?q={query}' },
  { name: 'Kagi', url: 'https://kagi.com/search?q={query}' },
];

export function settingsDocument(language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  const section = (id: string, label: string, icon: UiIconName) => `<a href="#${id}" data-section-link="${id}">${uiIcon(icon)}<span>${escapeHtml(label)}</span></a>`;
  const radio = (name: string, value: string, label: string, icon?: UiIconName) => `<label><input type="radio" name="${name}" value="${value}"><span>${icon ? uiIcon(icon) : ''}${escapeHtml(label)}</span></label>`;
  const actionCard = (id: string, icon: UiIconName, label: string, help: string) => `<button id="${id}" class="secondary action-card" type="button">${uiIcon(icon)}<span>${escapeHtml(label)}</span><small>${escapeHtml(help)}</small></button>`;
  const accentNames: Record<AccentChoice, string> = { iris: text.accentIris, ember: text.accentEmber, rose: text.accentRose, ocean: text.accentOcean, jade: text.accentJade, graphite: text.accentGraphite };
  const swatches = ACCENTS.map((accent) => `<label class="swatch" data-swatch="${accent}" title="${escapeHtml(accentNames[accent])}"><input type="radio" name="accent" value="${accent}" aria-label="${escapeHtml(accentNames[accent])}"><span aria-hidden="true"></span></label>`).join('');
  return pageShell(language, `${text.settingsTitle} · LumaMark`, `<main class="settings-shell"><aside class="library-side settings-side">${appHeader(language, 'settings')}` +
    `<nav class="section-nav" aria-label="${escapeHtml(text.settingsSections)}">${section('native-section', text.nativeGroup, 'bookmark')}${section('sync-section', text.syncGroup, 'cloud')}${section('home-section', text.homeGroup, 'home')}${section('appearance-section', text.appearance, 'palette')}${section('data-section', text.dataGroup, 'file')}</nav></aside>` +
    `<div class="settings-scroll"><div class="settings-main"><header class="settings-intro"><h1 class="settings-title">${escapeHtml(text.settingsTitle)}</h1><p class="settings-lead">${escapeHtml(text.settingsLead)}</p></header>` +
    `<section id="native-section" class="settings-card" aria-labelledby="native-heading">${cardHead('native-heading', text.nativeGroup, text.nativeExplain)}` +
    `<label class="check-line switch-line" for="native-sync"><input id="native-sync" type="checkbox" role="switch"> <span>${escapeHtml(text.nativeToggle)}</span></label><p id="native-status" role="status" aria-live="polite"></p></section>` +
    `<section id="sync-section" class="settings-card" aria-labelledby="sync-heading">${cardHead('sync-heading', text.syncGroup, text.syncExplain)}` +
    `<div class="status-row"><div id="sync-summary" class="status-strip" data-state="idle"><span class="sync-dot" aria-hidden="true"></span><span id="sync-summary-text">${escapeHtml(text.syncNotSetUp)}</span></div><button type="button" id="sync-now" class="secondary">${uiIcon('sync')}<span>${escapeHtml(text.syncNow)}</span></button></div>` +
    `<p id="sync-metadata"></p>` +
    `<form id="sync-form" class="form-grid">` +
    `<label for="webdav-url">${escapeHtml(text.webdavUrl)}</label><input id="webdav-url" name="webdav-url" type="url" autocomplete="url" placeholder="https://dav.example.com/remote.php/dav/files/me">` +
    `<label for="webdav-path">${escapeHtml(text.remotePath)}</label><input id="webdav-path" name="webdav-path" type="text" placeholder="lumamark/bookmarks.json">` +
    `<label for="webdav-user">${escapeHtml(text.username)}</label><input id="webdav-user" name="webdav-user" type="text" autocomplete="username">` +
    `<label for="webdav-password">${escapeHtml(text.password)}</label><input id="webdav-password" name="webdav-password" type="password" autocomplete="current-password">` +
    `<label class="check-line" for="auto-sync"><input id="auto-sync" name="auto-sync" type="checkbox"> ${escapeHtml(text.autoSync)}</label>` +
    `<div class="button-row"><button type="submit" class="primary">${escapeHtml(text.saveSync)}</button></div></form>` +
    `<p id="sync-status" role="status" aria-live="polite"></p><section id="conflicts" aria-live="polite" aria-label="${escapeHtml(text.conflictTitle)}"></section></section>` +
    `<section id="home-section" class="settings-card" aria-labelledby="home-heading">${cardHead('home-heading', text.homeGroup, text.homeExplain)}<div class="form-grid">` +
    `<label for="toolbar-folder">${escapeHtml(text.toolbarFolderLabel)}</label><div class="field-with-action"><select id="toolbar-folder"></select><button id="save-toolbar" class="primary" type="button">${escapeHtml(text.save)}</button></div>` +
    `<label for="search-url">${escapeHtml(text.searchAddress)}</label><div class="field-with-action"><input id="search-url" type="url" inputmode="url" autocomplete="off"><button id="save-search" class="secondary" type="button">${escapeHtml(text.saveSearch)}</button></div>` +
    `<div class="preset-row" role="group" aria-label="${escapeHtml(text.searchPresets)}">${SEARCH_PRESETS.map((preset) => `<button type="button" class="chip" data-search-preset="${escapeHtml(preset.url)}">${escapeHtml(preset.name)}</button>`).join('')}</div>` +
    `<p id="home-status" role="status"></p></div></section>` +
    `<section id="appearance-section" class="settings-card" aria-labelledby="appearance-heading">${cardHead('appearance-heading', text.appearance, text.appearanceExplain)}<div class="pref-list">` +
    `<div class="pref-row"><span class="pref-label" id="theme-label">${escapeHtml(text.theme)}</span><div class="segmented" role="radiogroup" aria-labelledby="theme-label">${radio('theme', 'system', text.themeSystem, 'monitor')}${radio('theme', 'light', text.themeLight, 'sun')}${radio('theme', 'dark', text.themeDark, 'moon')}</div></div>` +
    `<div class="pref-row"><span class="pref-label" id="accent-label">${escapeHtml(text.accent)}</span><div class="swatches" role="radiogroup" aria-labelledby="accent-label">${swatches}</div></div></div></section>` +
    `<section id="data-section" class="settings-card" aria-labelledby="data-heading">${cardHead('data-heading', text.dataGroup, text.dataExplain)}<div class="form-grid">` +
    `<label for="import-action">${escapeHtml(text.duplicateRule)}</label><select id="import-action">${duplicateOptions(language)}</select>` +
    `<div class="action-grid">${actionCard('import-html', 'upload', text.importHtml, text.importHtmlHelp)}${actionCard('import-json', 'file', text.importJson, text.importJsonHelp)}${actionCard('export', 'download', text.exportData, text.exportHelp)}</div>` +
    `<p id="data-status" role="status" aria-live="polite"></p></div></section></div></div></main>`);
}

export function homeDocument(language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  const section = (id: string, title: string, link = '', card = true) => `<section id="${id}" class="home-section" hidden><div class="home-section-head"><h2>${escapeHtml(title)}</h2>${link}</div><div class="home-section-body${card ? ' home-card' : ''}"></div></section>`;
  const viewAll = (scope: string) => `<a href="library.html?scope=${scope}">${escapeHtml(text.viewAll)}</a>`;
  return pageShell(language, 'LumaMark', `<div id="bar-region" class="bar-region"><nav id="bookmark-bar" class="bookmark-bar" aria-label="${escapeHtml(text.barLabel)}"></nav></div>` +
    `<main class="home-shell"><header class="home-top"><p class="brand">${logoMark(24)}<span>LumaMark</span></p><div class="home-top-side"><p id="sync-line" role="status"></p>` +
    `<nav class="page-links" aria-label="${escapeHtml(text.navLabel)}"><a href="library.html">${uiIcon('library')}<span>${escapeHtml(text.library)}</span></a><a href="settings.html">${uiIcon('settings')}<span>${escapeHtml(text.settings)}</span></a></nav></div></header>` +
    `<section class="home-hero"><div class="home-greeting"><h1 id="home-greeting"></h1><p id="home-summary"></p></div><div class="home-search"><form id="search-form" role="search"><label for="search"><span class="search-glyph" aria-hidden="true">${searchIcon()}</span><span class="sr-only">${escapeHtml(text.searchLabel)}</span></label><input id="search" type="search" role="combobox" aria-expanded="false" aria-controls="search-results" aria-autocomplete="list" autocomplete="off" placeholder="${escapeHtml(text.searchPlaceholder)}"><kbd class="search-kbd" title="${escapeHtml(text.searchHint)}">/</kbd></form>` +
    `<ul id="search-results" role="listbox" aria-label="${escapeHtml(text.searchLabel)}" hidden></ul></div><p id="search-note" role="status"></p></section>` +
    `<section id="bar-empty" class="empty-state" hidden><span class="empty-icon" aria-hidden="true">${folderIcon()}</span><h2>${escapeHtml(text.homeEmptyTitle)}</h2><p>${escapeHtml(text.emptyBar)}</p>` +
    `<div class="empty-actions"><button id="save-current" class="primary" type="button">${escapeHtml(text.saveCurrent)}</button><button id="import-html" class="secondary" type="button">${escapeHtml(text.importHtml)}</button></div>` +
    `<div class="empty-option"><label for="import-action">${escapeHtml(text.duplicateRule)}</label><select id="import-action">${duplicateOptions(language)}</select></div></section>` +
    `<div class="home-grid">${section('home-favorites', text.homeFavorites, viewAll('favorites'), false)}${section('home-recent', text.homeRecent, viewAll('recent'))}${section('home-folders', text.homeFolders, `<a href="library.html">${escapeHtml(text.viewAll)}</a>`)}</div></main>`);
}
