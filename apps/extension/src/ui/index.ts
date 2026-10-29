import type { Bookmark, BookmarkQuery, Collection } from '../../../../packages/domain/src/index';
import { folderTree, isHttpUrl, titleInitial, type FolderNode, type HomeSyncPhrase } from './bar';
import { copyFor, type UiLanguage } from './copy';
import { escapeHtml } from './html';

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
  const alive = bookmarks.some((bookmark) => !bookmark.deletedAt);
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

export function renderFolderTree(collections: Collection[], selected: string | null, language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  const walk = (nodes: FolderNode[]): string => nodes.map((node) => {
    const mark = node.toolbar ? ` <span class="toolbar-mark">${escapeHtml(text.toolbarMark)}</span>` : '';
    const children = node.children.length ? `<div class="tree-children" role="group">${walk(node.children)}</div>` : '';
    return `<div class="tree-node"><button type="button" class="tree-button" data-select-folder="${escapeHtml(node.id)}" aria-pressed="${node.id === selected ? 'true' : 'false'}">${escapeHtml(node.name)}${mark}</button>${children}</div>`;
  }).join('');
  const unfiled = `<button type="button" class="tree-button" data-select-folder="" aria-pressed="${selected === null ? 'true' : 'false'}">${escapeHtml(text.unfiled)}</button>`;
  return unfiled + walk(folderTree(collections));
}

export function renderBookmarkCard(bookmark: Bookmark, language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  const initial = escapeHtml(titleInitial(bookmark.title));
  const icon = bookmark.faviconUrl
    ? `<span class="item-icon"><img src="${escapeHtml(bookmark.faviconUrl)}" alt="" data-initial="${initial}"><span class="item-fallback" hidden>${initial}</span></span>`
    : `<span class="item-fallback" aria-hidden="true">${initial}</span>`;
  const favoriteLabel = bookmark.favorite ? text.unfavorite : text.favorite;
  return `<article class="bookmark-card" data-bookmark-id="${escapeHtml(bookmark.id)}" tabindex="0">` +
    `<label class="bookmark-select"><input type="checkbox" data-select-bookmark="${escapeHtml(bookmark.id)}" aria-label="${escapeHtml(text.select)} ${escapeHtml(bookmark.title)}"></label>` +
    `${icon}<a class="bookmark-title" href="${escapeHtml(bookmark.url)}">${escapeHtml(bookmark.title)}</a>` +
    `<p class="bookmark-domain">${escapeHtml(bookmark.domain)}</p>` +
    `<div class="bookmark-actions" role="group" aria-label="${escapeHtml(text.actions)}">` +
    `<button type="button" data-action="favorite" aria-label="${escapeHtml(favoriteLabel)}">${bookmark.favorite ? '★' : '☆'}</button>` +
    `<button type="button" data-action="edit">${escapeHtml(text.edit)}</button><button type="button" data-action="delete">${escapeHtml(text.delete)}</button>` +
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
    return `<section class="empty-state" role="status"><h2>${escapeHtml(text.noMatches)}</h2><p>${escapeHtml(text.noMatchesHelp)}</p>` +
      `<button type="button" data-action="clear-filters">${escapeHtml(text.clearFilters)}</button></section>`;
  }
  return `<section class="empty-state" role="status"><h2>${escapeHtml(text.noBookmarks)}</h2><p>${escapeHtml(text.emptyLibraryHelp)}</p>` +
    `<label for="empty-import-action">${escapeHtml(text.duplicateRule)}</label><select id="empty-import-action">${duplicateOptions(language)}</select>` +
    `<button type="button" data-action="save-page">${escapeHtml(text.saveCurrent)}</button>` +
    `<button type="button" data-action="import-html">${escapeHtml(text.importHtml)}</button></section>`;
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
  if (phrase !== 'needs-attention') return escapeHtml(label);
  return `${escapeHtml(label)} <a href="settings.html">${escapeHtml(text.openSettings)}</a>`;
}

export type RuntimeAction = 'save' | 'undo' | 'open-library' | 'open-home' | 'open-existing' | 'capture' | 'list' | 'list-collections' | 'update-existing' | 'copy-existing' | 'update' | 'delete' | 'restore' | 'favorite' | 'sync' | 'sync-configure' | 'export' | 'import' | 'list-conflicts' | 'resolve-conflict' | 'collection-create' | 'collection-delete' | 'collection-restore' | 'sync-status' | 'reorder' | 'set-toolbar' | 'get-search-engine' | 'set-search-engine' | 'get-sync-config' | 'set-auto-sync';

export interface RuntimeMessage { type: `lumamark-${RuntimeAction}`; payload?: unknown }

function pageShell(language: UiLanguage, title: string, body: string): string {
  const lang = language === 'zh' ? 'zh' : 'en';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body>${body}</body></html>`;
}

export function popupDocument(language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  return pageShell(language, 'LumaMark', `<main class="popup-shell"><header class="page-header"><p class="brand">LumaMark</p><h1>${escapeHtml(text.saveCurrent)}</h1></header>` +
    `<article id="page-preview" class="page-preview"><span class="item-icon"><img id="page-icon" alt="" hidden><span id="page-fallback" class="item-fallback" hidden></span></span><h2 id="page-title"></h2><p id="page-url"></p></article>` +
    `<p id="unsavable" class="form-note" hidden>${escapeHtml(text.cannotSave)}</p>` +
    `<button id="save" class="primary" type="button">${escapeHtml(text.saveCurrent)}</button>` +
    `<details id="more"><summary>${escapeHtml(text.more)}</summary><label for="save-tags">${escapeHtml(text.tags)}</label><input id="save-tags" type="text"><label for="save-notes">${escapeHtml(text.notes)}</label><textarea id="save-notes" rows="2"></textarea></details>` +
    `<section id="saved-editor" hidden><label for="edit-title">${escapeHtml(text.titleLabel)}</label><input id="edit-title" type="text"><label for="edit-folder">${escapeHtml(text.folder)}</label><select id="edit-folder"><option value="">${escapeHtml(text.topLevel)}</option></select><button id="save-edits" type="button">${escapeHtml(text.saveChanges)}</button><button id="delete-saved" type="button">${escapeHtml(text.delete)}</button><button id="undo" type="button">${escapeHtml(text.undoLastSave)}</button></section>` +
    `<div id="existing-actions" hidden><p id="existing-note">${escapeHtml(text.alreadySaved)}</p><button id="open-existing" type="button">${escapeHtml(text.open)}</button><button id="update-existing" type="button">${escapeHtml(text.update)}</button><button id="copy-existing" type="button">${escapeHtml(text.saveCopy)}</button></div>` +
    `<p id="status" role="status" aria-live="polite"></p><p class="page-links"><a id="open-home" href="home.html">${escapeHtml(text.openHome)}</a><a id="open-library" href="library.html">${escapeHtml(text.library)}</a></p></main>`);
}

export function libraryDocument(collections: Collection[] = [], language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  return pageShell(language, 'LumaMark', `<main class="library-shell"><header class="page-header"><p class="brand">LumaMark</p><h1>${escapeHtml(text.libraryTitle)}</h1></header><div class="library-layout">` +
    `<nav id="folder-tree" aria-label="${escapeHtml(text.folders)}">${renderFolderTree(collections, null, language)}</nav>` +
    `<div class="library-main"><form id="filters" aria-label="${escapeHtml(text.searchLibrary)}"><label for="search">${escapeHtml(text.searchLibrary)}</label><input id="search" name="text" type="search" autocomplete="off">` +
    `<details id="more-filters"><summary>${escapeHtml(text.filters)}</summary><label for="tag">${escapeHtml(text.tags)}</label><input id="tag" name="tag" type="search"><label for="domain">${escapeHtml(text.domain)}</label><input id="domain" name="domain" type="search">` +
    `<label for="from">${escapeHtml(text.savedAfter)}</label><input id="from" name="from" type="date"><label for="to">${escapeHtml(text.savedBefore)}</label><input id="to" name="to" type="date">` +
    `<label><input id="favorite" name="favoriteOnly" type="checkbox"> ${escapeHtml(text.favoritesOnly)}</label><button type="reset">${escapeHtml(text.clearFilters)}</button></details></form>` +
    `<div class="batch-actions" id="batch-actions" hidden><select id="batch-collection" aria-label="${escapeHtml(text.moveSelected)}"><option value="">${escapeHtml(text.chooseFolder)}</option>${collectionOptions(collections, '', language)}</select><button type="button" id="batch-move">${escapeHtml(text.moveSelected)}</button><button type="button" id="batch-delete">${escapeHtml(text.deleteSelected)}</button></div>` +
    `<nav class="view-switcher" aria-label="${escapeHtml(text.view)}"><button type="button" data-view="list" aria-pressed="true">${escapeHtml(text.list)}</button><button type="button" data-view="grid">${escapeHtml(text.grid)}</button></nav>` +
    `<section id="results" class="bookmark-view bookmark-view-list" aria-live="polite"></section>` +
    `<form id="editor" hidden><label for="editor-title">${escapeHtml(text.titleLabel)}</label><input id="editor-title" name="title" type="text"><label for="editor-url">${escapeHtml(text.urlLabel)}</label><input id="editor-url" name="url" type="url">` +
    `<label for="editor-folder">${escapeHtml(text.folder)}</label><select id="editor-folder" name="folder"><option value="">${escapeHtml(text.topLevel)}</option>${collectionOptions(collections, '', language)}</select>` +
    `<label for="editor-tags">${escapeHtml(text.tags)}</label><input id="editor-tags" name="tags" type="text"><label for="editor-notes">${escapeHtml(text.notes)}</label><textarea id="editor-notes" name="notes" rows="2"></textarea>` +
    `<label><input id="editor-favorite" name="favorite" type="checkbox"> ${escapeHtml(text.favorite)}</label><p id="editor-error" role="status"></p><button type="submit">${escapeHtml(text.saveChanges)}</button><button type="button" id="editor-cancel">${escapeHtml(text.cancel)}</button></form>` +
    `<div id="decision" hidden role="alertdialog" aria-modal="true"><p id="decision-text"></p><button type="button" id="decision-confirm">${escapeHtml(text.delete)}</button><button type="button" id="decision-cancel">${escapeHtml(text.cancel)}</button></div>` +
    `<p id="library-status" role="status" aria-live="polite"></p>` +
    `<section class="collection-tools" aria-label="${escapeHtml(text.folders)}"><input id="new-collection" type="text" placeholder="${escapeHtml(text.newFolder)}"><button type="button" id="create-collection">${escapeHtml(text.createFolder)}</button><button type="button" id="delete-folder">${escapeHtml(text.deleteFolder)}</button></section>` +
    `<p class="page-links"><a href="home.html">${escapeHtml(text.home)}</a><a href="settings.html">${escapeHtml(text.settings)}</a></p></div></div></main>`);
}

export function settingsDocument(language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  return pageShell(language, 'LumaMark', `<main class="settings-shell"><header class="page-header"><p class="brand">LumaMark</p><h1>${escapeHtml(text.settingsTitle)}</h1></header>` +
    `<section aria-labelledby="home-heading"><h2 id="home-heading">${escapeHtml(text.homeGroup)}</h2><label for="toolbar-folder">${escapeHtml(text.toolbarFolderLabel)}</label><select id="toolbar-folder"></select><button id="save-toolbar" type="button">${escapeHtml(text.save)}</button>` +
    `<label for="search-url">${escapeHtml(text.searchAddress)}</label><input id="search-url" type="url" inputmode="url" autocomplete="off"><button id="save-search" type="button">${escapeHtml(text.saveSearch)}</button><p id="home-status" role="status"></p></section>` +
    `<section aria-labelledby="sync-heading"><h2 id="sync-heading">${escapeHtml(text.syncGroup)}</h2><p>${escapeHtml(text.syncExplain)}</p><form id="sync-form">` +
    `<label for="webdav-url">${escapeHtml(text.webdavUrl)}</label><input id="webdav-url" name="webdav-url" type="url" autocomplete="url">` +
    `<label for="webdav-path">${escapeHtml(text.remotePath)}</label><input id="webdav-path" name="webdav-path" type="text">` +
    `<label for="webdav-user">${escapeHtml(text.username)}</label><input id="webdav-user" name="webdav-user" type="text" autocomplete="username">` +
    `<label for="webdav-password">${escapeHtml(text.password)}</label><input id="webdav-password" name="webdav-password" type="password" autocomplete="current-password">` +
    `<label><input id="auto-sync" name="auto-sync" type="checkbox"> ${escapeHtml(text.autoSync)}</label><button type="submit">${escapeHtml(text.saveSync)}</button><button type="button" id="sync-now">${escapeHtml(text.syncNow)}</button></form>` +
    `<p id="sync-status" role="status" aria-live="polite"></p><p id="sync-metadata"></p><section id="conflicts" aria-live="polite" aria-label="${escapeHtml(text.conflictTitle)}"></section></section>` +
    `<section aria-labelledby="data-heading"><h2 id="data-heading">${escapeHtml(text.dataGroup)}</h2><p>${escapeHtml(text.dataExplain)}</p>` +
    `<label for="import-action">${escapeHtml(text.duplicateRule)}</label><select id="import-action">${duplicateOptions(language)}</select>` +
    `<button id="import-html" type="button">${escapeHtml(text.importHtml)}</button><button id="import-json" type="button">${escapeHtml(text.importJson)}</button><button id="export" type="button">${escapeHtml(text.exportData)}</button>` +
    `<p id="data-status" role="status" aria-live="polite"></p></section></main>`);
}

export function homeDocument(language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  return pageShell(language, 'LumaMark', `<main class="home-shell">` +
    `<div id="bar-region" class="bar-region"><nav id="bookmark-bar" class="bookmark-bar" aria-label="${escapeHtml(text.barLabel)}"></nav>` +
    `<section id="bar-empty" class="empty-state" hidden><p>${escapeHtml(text.emptyBar)}</p><button id="save-current" class="primary" type="button">${escapeHtml(text.saveCurrent)}</button>` +
    `<label for="import-action">${escapeHtml(text.duplicateRule)}</label><select id="import-action">${duplicateOptions(language)}</select><button id="import-html" type="button">${escapeHtml(text.importHtml)}</button></section></div>` +
    `<header class="page-header"><p class="brand">LumaMark</p><p id="sync-line" role="status"></p></header>` +
    `<form id="search-form" role="search"><label for="search">${escapeHtml(text.searchLabel)}</label><input id="search" type="search" autocomplete="off" placeholder="${escapeHtml(text.searchPlaceholder)}"></form>` +
    `<ul id="search-results" role="listbox"></ul><p id="search-note" role="status"></p>` +
    `<p class="page-links"><a href="library.html">${escapeHtml(text.library)}</a> <a href="settings.html">${escapeHtml(text.settings)}</a></p></main>`);
}
