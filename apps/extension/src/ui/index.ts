import { isSeparator, type Bookmark, type BookmarkQuery, type Collection } from '../../../../packages/domain/src/index';
import { folderTree, isHttpUrl, titleInitial, type FolderNode, type HomeSyncPhrase } from './bar';
import { copyFor, fill, type UiLanguage } from './copy';
import { escapeHtml } from './html';
import { folderIcon, logoMark, pencilIcon, searchIcon, starIcon, trashIcon, uiIcon } from './icons';

export type { UiLanguage } from './copy';
export { escapeHtml } from './html';
export { isHttpUrl };

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
      const comparison = String(left[field] ?? '').localeCompare(String(right[field] ?? ''));
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
      const mark = node.toolbar ? ` (${text.toolbarMark})` : '';
      lines.push(`<option value="${escapeHtml(node.id)}"${node.id === selected ? ' selected' : ''}>${escapeHtml(prefix + node.name + mark)}</option>`);
      walk(node.children, depth + 1);
    }
  };
  walk(folderTree(collections), 0);
  return lines.join('');
}

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
  return `<button type="button" class="tree-button" data-select-folder="${escapeHtml(id)}" aria-pressed="${selected ? 'true' : 'false'}">` +
    `<span class="tree-icon" aria-hidden="true">${icon}</span><span class="tree-label">${escapeHtml(label)}${extra}</span>${badge}</button>`;
}

export function renderFolderTree(collections: Collection[], selected: string | null, language: UiLanguage = 'en', counts: FolderCounts = {}): string {
  const text = copyFor(language);
  const walk = (nodes: FolderNode[]): string => nodes.map((node) => {
    const mark = node.toolbar ? ` <span class="toolbar-mark">${escapeHtml(text.toolbarMark)}</span>` : '';
    const children = node.children.length ? `<div class="tree-children" role="group">${walk(node.children)}</div>` : '';
    const icon = node.toolbar ? uiIcon('bookmark') : folderIcon();
    return `<div class="tree-node">${treeButton(node.id, node.name, icon, node.id === selected, counts[node.id], mark)}${children}</div>`;
  }).join('');
  const unfiled = treeButton('', text.unfiled, uiIcon('list'), selected === null, counts['']);
  return unfiled + walk(folderTree(collections));
}

/** Stable hue per site so letter tiles are easy to tell apart. */
export function tileHue(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return hash % 360;
}

export function renderBookmarkCard(bookmark: Bookmark, language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  const initial = escapeHtml(titleInitial(bookmark.title));
  const hue = tileHue(bookmark.domain || bookmark.title);
  const icon = bookmark.faviconUrl
    ? `<span class="item-icon"><img src="${escapeHtml(bookmark.faviconUrl)}" alt="" data-initial="${initial}"><span class="item-fallback" style="--tile-hue:${hue}" hidden>${initial}</span></span>`
    : `<span class="item-fallback" style="--tile-hue:${hue}" aria-hidden="true">${initial}</span>`;
  const favoriteLabel = bookmark.favorite ? text.unfavorite : text.favorite;
  // Bookmarklets and browser pages cannot be opened from an extension page; show them without a live link.
  const titleLink = isHttpUrl(bookmark.url)
    ? `<a class="bookmark-title" href="${escapeHtml(bookmark.url)}" title="${escapeHtml(bookmark.url)}">${escapeHtml(bookmark.title)}</a>`
    : `<span class="bookmark-title" title="${escapeHtml(bookmark.url)}">${escapeHtml(bookmark.title)}</span>`;
  const tags = bookmark.tags.length ? `<p class="bookmark-tags">${bookmark.tags.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join('')}</p>` : '';
  const notes = bookmark.notes ? `<p class="bookmark-notes">${escapeHtml(bookmark.notes)}</p>` : '';
  return `<article class="bookmark-card" data-bookmark-id="${escapeHtml(bookmark.id)}" data-favorite="${bookmark.favorite ? 'true' : 'false'}" tabindex="0">` +
    `<label class="bookmark-select"><input type="checkbox" data-select-bookmark="${escapeHtml(bookmark.id)}" aria-label="${escapeHtml(text.select)} ${escapeHtml(bookmark.title)}"></label>` +
    `${icon}<div class="bookmark-body">${titleLink}` +
    `<p class="bookmark-domain">${escapeHtml(bookmark.domain || bookmark.url)}</p>${tags}${notes}</div>` +
    `<div class="bookmark-actions" role="group" aria-label="${escapeHtml(text.actions)}">` +
    `<button type="button" class="icon-button${bookmark.favorite ? ' is-on' : ''}" data-action="favorite" aria-label="${escapeHtml(favoriteLabel)}" title="${escapeHtml(favoriteLabel)}">${starIcon(bookmark.favorite)}</button>` +
    `<button type="button" class="icon-button" data-action="edit" aria-label="${escapeHtml(text.edit)}" title="${escapeHtml(text.edit)}">${pencilIcon()}</button>` +
    `<button type="button" class="icon-button danger" data-action="delete" aria-label="${escapeHtml(text.delete)}" title="${escapeHtml(text.delete)}">${trashIcon()}</button>` +
    `</div></article>`;
}

function duplicateOptions(language: UiLanguage): string {
  const text = copyFor(language);
  return `<option value="skip">${escapeHtml(text.skip)}</option><option value="update">${escapeHtml(text.updateExisting)}</option><option value="copy">${escapeHtml(text.copyDuplicate)}</option>`;
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
    `<label for="empty-import-action">${escapeHtml(text.duplicateRule)}</label><select id="empty-import-action">${duplicateOptions(language)}</select>` +
    `<div class="empty-actions"><button type="button" class="primary" data-action="save-page">${escapeHtml(text.saveCurrent)}</button>` +
    `<button type="button" class="secondary" data-action="import-html">${escapeHtml(text.importHtml)}</button></div></section>`;
}

export function libraryFailureMessage(language: UiLanguage = 'en'): string {
  return `<p class="load-error" role="status">${escapeHtml(copyFor(language).loadFailed)}</p>`;
}

export function renderConflicts(items: Array<{ id: string; local?: Pick<Bookmark, 'title' | 'url' | 'notes'>; remote?: Pick<Bookmark, 'title' | 'url' | 'notes'> }>, language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  if (!items.length) return '';
  return `<h3>${escapeHtml(text.conflictTitle)}</h3>` + items.map((item) => `<article data-conflict-id="${escapeHtml(item.id)}">` +
    `<h4>${escapeHtml(text.localVersion)}</h4><p>${escapeHtml(item.local?.title ?? '')}</p><p>${escapeHtml(item.local?.url ?? '')}</p><p>${escapeHtml(item.local?.notes ?? '')}</p>` +
    `<h4>${escapeHtml(text.otherVersion)}</h4><p>${escapeHtml(item.remote?.title ?? '')}</p><p>${escapeHtml(item.remote?.url ?? '')}</p><p>${escapeHtml(item.remote?.notes ?? '')}</p>` +
    `<button type="button" data-resolution="local">${escapeHtml(text.keepThis)}</button>` +
    `<button type="button" data-resolution="remote">${escapeHtml(text.keepOther)}</button></article>`).join('');
}

export function renderSyncLine(phrase: HomeSyncPhrase, language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  const label = phrase === 'local-only' ? text.syncLocal : phrase === 'aligned' ? text.syncAligned : phrase === 'waiting-network' ? text.syncWaiting : text.syncNeeds;
  const dot = phrase === 'needs-attention' ? 'sync-dot danger' : 'sync-dot';
  const status = `<span class="${dot}" aria-hidden="true"></span><span class="sync-text">${escapeHtml(label)}</span>`;
  if (phrase !== 'needs-attention') return status;
  return `${status} <a href="settings.html">${escapeHtml(text.openSettings)}</a>`;
}

export type RuntimeAction = 'native-status' | 'set-native-sync' | 'save' | 'undo' | 'open-library' | 'open-home' | 'open-existing' | 'capture' | 'list' | 'list-collections' | 'update-existing' | 'copy-existing' | 'update' | 'delete' | 'restore' | 'favorite' | 'sync' | 'sync-configure' | 'export' | 'import' | 'list-conflicts' | 'resolve-conflict' | 'collection-create' | 'collection-delete' | 'collection-restore' | 'sync-status' | 'reorder' | 'set-toolbar' | 'get-search-engine' | 'set-search-engine' | 'get-sync-config' | 'set-auto-sync';

export interface RuntimeMessage { type: `lumamark-${RuntimeAction}`; payload?: unknown }

function pageShell(language: UiLanguage, title: string, body: string): string {
  const lang = language === 'zh' ? 'zh' : 'en';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body>${body}</body></html>`;
}

/** Shared header for the full-page surfaces: brand on the left, page switcher on the right. */
function appHeader(language: UiLanguage, current: 'library' | 'settings'): string {
  const text = copyFor(language);
  const link = (page: 'home' | 'library' | 'settings', label: string, icon: Parameters<typeof uiIcon>[0]) =>
    `<a href="${page}.html"${page === current ? ' aria-current="page"' : ''}>${uiIcon(icon)}<span>${escapeHtml(label)}</span></a>`;
  return `<header class="page-header app-header"><a class="app-brand" href="home.html">${logoMark(28)}<span>${escapeHtml(text.brand)}</span></a>` +
    `<nav class="app-nav page-links" aria-label="${escapeHtml(text.navLabel)}">${link('home', text.home, 'home')}${link('library', text.library, 'library')}${link('settings', text.settings, 'settings')}</nav></header>`;
}

export function popupDocument(language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  const iconLink = (id: string, page: string, label: string, icon: Parameters<typeof uiIcon>[0]) =>
    `<a id="${id}" class="icon-link" href="${page}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${uiIcon(icon)}</a>`;
  return pageShell(language, 'LumaMark', `<main class="popup-shell"><header class="page-header popup-header"><p class="brand">${logoMark(24)}<span>${escapeHtml(text.brand)}</span></p>` +
    `<nav class="header-actions page-links">${iconLink('open-home', 'home.html', text.openHome, 'home')}${iconLink('open-library', 'library.html', text.library, 'library')}</nav></header>` +
    `<h1 class="sr-only">${escapeHtml(text.saveCurrent)}</h1>` +
    `<article id="page-preview" class="page-preview"><span class="item-icon"><img id="page-icon" alt="" hidden><span id="page-fallback" class="item-fallback" hidden></span></span><div class="preview-text"><h2 id="page-title"></h2><p id="page-url"></p></div></article>` +
    `<p id="unsavable" class="form-note notice" hidden>${uiIcon('info')}<span>${escapeHtml(text.cannotSave)}</span></p>` +
    `<details id="more"><summary>${uiIcon('tag')}<span>${escapeHtml(text.tags)} · ${escapeHtml(text.notes)}</span></summary><div class="form-grid"><label for="save-tags">${escapeHtml(text.tags)}</label><input id="save-tags" type="text" placeholder="work, reading"><label for="save-notes">${escapeHtml(text.notes)}</label><textarea id="save-notes" rows="2"></textarea></div></details>` +
    `<button id="save" class="primary" type="button">${uiIcon('bookmarkPlus')}<span>${escapeHtml(text.saveCurrent)}</span></button>` +
    `<p class="popup-hint" id="save-hint"><span>${escapeHtml(text.saveHint)}</span><kbd>${escapeHtml(text.keyboardSave)}</kbd></p>` +
    `<section id="saved-editor" class="form-grid" hidden><p class="saved-headline">${uiIcon('check')}<span>${escapeHtml(text.savedHeadline)}</span></p><label for="edit-title">${escapeHtml(text.titleLabel)}</label><input id="edit-title" type="text"><label for="edit-folder">${escapeHtml(text.folder)}</label><select id="edit-folder"><option value="">${escapeHtml(text.topLevel)}</option></select>` +
    `<div class="button-row"><button id="save-edits" class="primary" type="button">${escapeHtml(text.saveChanges)}</button><button id="delete-saved" class="danger" type="button">${escapeHtml(text.delete)}</button><button id="undo" class="ghost" type="button">${uiIcon('undo')}<span>${escapeHtml(text.undoLastSave)}</span></button></div></section>` +
    `<div id="existing-actions" hidden><p id="existing-note">${uiIcon('bookmark')}<span>${escapeHtml(text.alreadySaved)}</span></p><div class="button-row"><button id="open-existing" class="secondary" type="button">${escapeHtml(text.open)}</button><button id="update-existing" class="primary" type="button">${escapeHtml(text.update)}</button><button id="copy-existing" class="ghost" type="button">${escapeHtml(text.saveCopy)}</button></div></div>` +
    `<p id="status" role="status" aria-live="polite"></p></main>`);
}

export function libraryDocument(collections: Collection[] = [], language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  return pageShell(language, `${text.libraryTitle} · LumaMark`, `<main class="library-shell">${appHeader(language, 'library')}<div class="library-layout">` +
    `<aside class="library-side"><p class="side-title">${escapeHtml(text.folders)}</p>` +
    `<nav id="folder-tree" aria-label="${escapeHtml(text.folders)}">${renderFolderTree(collections, null, language)}</nav>` +
    `<section class="collection-tools" aria-label="${escapeHtml(text.folderActions)}"><div class="inline-field"><input id="new-collection" type="text" placeholder="${escapeHtml(text.newFolder)}" aria-label="${escapeHtml(text.newFolder)}"><button type="button" id="create-collection" class="secondary" title="${escapeHtml(text.createFolder)}">${uiIcon('folderPlus')}<span>${escapeHtml(text.createFolder)}</span></button></div>` +
    `<button type="button" id="delete-folder" class="danger">${trashIcon()}<span>${escapeHtml(text.deleteFolder)}</span></button></section>` +
    `</aside>` +
    `<div class="library-main"><div class="library-head"><div class="library-heading"><h1 id="folder-heading">${escapeHtml(text.libraryTitle)}</h1><p id="folder-count" class="folder-count"></p></div>` +
    `<nav class="view-switcher" aria-label="${escapeHtml(text.view)}"><button type="button" data-view="list" aria-pressed="true" title="${escapeHtml(text.list)}">${uiIcon('list')}<span>${escapeHtml(text.list)}</span></button><button type="button" data-view="grid" title="${escapeHtml(text.grid)}">${uiIcon('library')}<span>${escapeHtml(text.grid)}</span></button></nav></div>` +
    `<form id="filters" aria-label="${escapeHtml(text.searchLibrary)}"><div class="search-field"><label for="search" class="search-icon" title="${escapeHtml(text.searchLibrary)}"><span aria-hidden="true">${searchIcon()}</span><span class="sr-only">${escapeHtml(text.searchLibrary)}</span></label><input id="search" name="text" type="search" autocomplete="off" placeholder="${escapeHtml(text.searchLibrary)}"><kbd class="search-kbd" title="${escapeHtml(text.searchHint)}">/</kbd></div>` +
    `<details id="more-filters"><summary>${uiIcon('filter')}<span>${escapeHtml(text.filters)}</span></summary><div class="form-grid">` +
    `<label for="tag">${escapeHtml(text.tags)}</label><input id="tag" name="tag" type="search"><label for="domain">${escapeHtml(text.domain)}</label><input id="domain" name="domain" type="search">` +
    `<label for="from">${escapeHtml(text.savedAfter)}</label><input id="from" name="from" type="date"><label for="to">${escapeHtml(text.savedBefore)}</label><input id="to" name="to" type="date">` +
    `<label class="check-line" for="favorite"><input id="favorite" name="favoriteOnly" type="checkbox"> ${escapeHtml(text.favoritesOnly)}</label>` +
    `<div class="button-row"><button type="reset" class="secondary">${escapeHtml(text.clearFilters)}</button></div>` +
    `</div></details></form>` +
    `<div class="batch-actions" id="batch-actions" hidden><span id="batch-count" class="batch-count"></span><select id="batch-collection" aria-label="${escapeHtml(text.moveSelected)}"><option value="">${escapeHtml(text.chooseFolder)}</option>${collectionOptions(collections, '', language)}</select><button type="button" id="batch-move" class="secondary">${escapeHtml(text.moveSelected)}</button><button type="button" id="batch-delete" class="danger">${escapeHtml(text.deleteSelected)}</button></div>` +
    `<section id="results" class="bookmark-view bookmark-view-list" aria-live="polite"><div class="loading-state" aria-hidden="true"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div></section>` +
    `<form id="editor" class="form-grid" hidden aria-labelledby="editor-heading"><h2 id="editor-heading" class="dialog-title">${escapeHtml(text.editBookmark)}</h2><label for="editor-title">${escapeHtml(text.titleLabel)}</label><input id="editor-title" name="title" type="text"><label for="editor-url">${escapeHtml(text.urlLabel)}</label><input id="editor-url" name="url" type="url">` +
    `<label for="editor-folder">${escapeHtml(text.folder)}</label><select id="editor-folder" name="folder"><option value="">${escapeHtml(text.topLevel)}</option>${collectionOptions(collections, '', language)}</select>` +
    `<label for="editor-tags">${escapeHtml(text.tags)}</label><input id="editor-tags" name="tags" type="text"><label for="editor-notes">${escapeHtml(text.notes)}</label><textarea id="editor-notes" name="notes" rows="3"></textarea>` +
    `<label class="check-line" for="editor-favorite"><input id="editor-favorite" name="favorite" type="checkbox"> ${escapeHtml(text.favorite)}</label><p id="editor-error" role="status"></p>` +
    `<div class="button-row dialog-actions"><button type="button" id="editor-cancel" class="ghost">${escapeHtml(text.cancel)}</button><button type="submit" class="primary">${escapeHtml(text.saveChanges)}</button></div></form>` +
    `<div id="decision" hidden role="alertdialog" aria-modal="true" aria-labelledby="decision-heading"><h2 id="decision-heading" class="dialog-title">${uiIcon('alert')}<span>${escapeHtml(text.confirmTitle)}</span></h2><p id="decision-text"></p><div class="button-row dialog-actions"><button type="button" id="decision-cancel" class="secondary">${escapeHtml(text.cancel)}</button><button type="button" id="decision-confirm" class="danger">${escapeHtml(text.delete)}</button></div></div>` +
    `<p id="library-status" class="toast" role="status" aria-live="polite"></p>` +
    `</div></div></main>`);
}

function cardHead(id: string, icon: Parameters<typeof uiIcon>[0], title: string, explain: string): string {
  return `<div class="card-head"><span class="card-icon" aria-hidden="true">${uiIcon(icon)}</span><div><h2 id="${id}">${escapeHtml(title)}</h2><p>${escapeHtml(explain)}</p></div></div>`;
}

export function settingsDocument(language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  return pageShell(language, `${text.settingsTitle} · LumaMark`, `<main class="settings-shell">${appHeader(language, 'settings')}<h1 class="settings-title">${escapeHtml(text.settingsTitle)}</h1>` +
    `<section class="settings-card" aria-labelledby="native-heading">${cardHead('native-heading', 'bookmark', text.nativeGroup, text.nativeExplain)}` +
    `<label class="check-line switch-line" for="native-sync"><input id="native-sync" type="checkbox" role="switch"> <span>${escapeHtml(text.nativeToggle)}</span></label><p id="native-status" role="status" aria-live="polite"></p></section>` +
    `<section class="settings-card" aria-labelledby="sync-heading">${cardHead('sync-heading', 'cloud', text.syncGroup, text.syncExplain)}` +
    `<div id="sync-summary" class="status-strip" data-state="idle"><span class="sync-dot" aria-hidden="true"></span><span id="sync-summary-text">${escapeHtml(text.syncNotSetUp)}</span></div>` +
    `<form id="sync-form" class="form-grid">` +
    `<label for="webdav-url">${escapeHtml(text.webdavUrl)}</label><input id="webdav-url" name="webdav-url" type="url" autocomplete="url" placeholder="https://dav.example.com/remote.php/dav/files/me">` +
    `<label for="webdav-path">${escapeHtml(text.remotePath)}</label><input id="webdav-path" name="webdav-path" type="text" placeholder="lumamark/bookmarks.json">` +
    `<label for="webdav-user">${escapeHtml(text.username)}</label><input id="webdav-user" name="webdav-user" type="text" autocomplete="username">` +
    `<label for="webdav-password">${escapeHtml(text.password)}</label><input id="webdav-password" name="webdav-password" type="password" autocomplete="current-password">` +
    `<label class="check-line" for="auto-sync"><input id="auto-sync" name="auto-sync" type="checkbox"> ${escapeHtml(text.autoSync)}</label>` +
    `<div class="button-row"><button type="submit" class="primary">${escapeHtml(text.saveSync)}</button><button type="button" id="sync-now" class="secondary">${uiIcon('sync')}<span>${escapeHtml(text.syncNow)}</span></button></div></form>` +
    `<p id="sync-status" role="status" aria-live="polite"></p><p id="sync-metadata"></p><section id="conflicts" aria-live="polite" aria-label="${escapeHtml(text.conflictTitle)}"></section></section>` +
    `<section class="settings-card" aria-labelledby="home-heading">${cardHead('home-heading', 'home', text.homeGroup, text.homeExplain)}<div class="form-grid">` +
    `<label for="toolbar-folder">${escapeHtml(text.toolbarFolderLabel)}</label><select id="toolbar-folder"></select>` +
    `<label for="search-url">${escapeHtml(text.searchAddress)}</label><input id="search-url" type="url" inputmode="url" autocomplete="off">` +
    `<div class="button-row"><button id="save-toolbar" class="primary" type="button">${escapeHtml(text.save)}</button><button id="save-search" class="secondary" type="button">${escapeHtml(text.saveSearch)}</button></div>` +
    `<p id="home-status" role="status"></p></div></section>` +
    `<section class="settings-card" aria-labelledby="data-heading">${cardHead('data-heading', 'file', text.dataGroup, text.dataExplain)}<div class="form-grid">` +
    `<label for="import-action">${escapeHtml(text.duplicateRule)}</label><select id="import-action">${duplicateOptions(language)}</select>` +
    `<div class="button-row"><button id="import-html" class="secondary" type="button">${uiIcon('upload')}<span>${escapeHtml(text.importHtml)}</span></button><button id="import-json" class="secondary" type="button">${uiIcon('upload')}<span>${escapeHtml(text.importJson)}</span></button><button id="export" class="secondary" type="button">${uiIcon('download')}<span>${escapeHtml(text.exportData)}</span></button></div>` +
    `<p id="data-status" role="status" aria-live="polite"></p></div></section></main>`);
}

export function homeDocument(language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  return pageShell(language, 'LumaMark', `<main class="home-shell">` +
    `<div id="bar-region" class="bar-region"><nav id="bookmark-bar" class="bookmark-bar" aria-label="${escapeHtml(text.barLabel)}"></nav>` +
    `<section id="bar-empty" class="empty-state" hidden><span class="empty-icon" aria-hidden="true">${folderIcon()}</span><p>${escapeHtml(text.emptyBar)}</p>` +
    `<div class="empty-actions"><button id="save-current" class="primary" type="button">${escapeHtml(text.saveCurrent)}</button><button id="import-html" class="secondary" type="button">${escapeHtml(text.importHtml)}</button></div>` +
    `<label for="import-action">${escapeHtml(text.duplicateRule)}</label><select id="import-action">${duplicateOptions(language)}</select></section></div>` +
    `<header class="page-header"><p class="brand">LumaMark</p><p id="sync-line" role="status"></p></header>` +
    `<form id="search-form" role="search"><label for="search"><span class="item-icon" aria-hidden="true">${searchIcon()}</span> ${escapeHtml(text.searchLabel)}</label><input id="search" type="search" autocomplete="off" placeholder="${escapeHtml(text.searchPlaceholder)}"></form>` +
    `<ul id="search-results" role="listbox"></ul><p id="search-note" role="status"></p>` +
    `<p class="page-links"><a href="library.html">${escapeHtml(text.library)}</a> <a href="settings.html">${escapeHtml(text.settings)}</a></p></main>`);
}
