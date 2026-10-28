import type { Bookmark, BookmarkQuery, Collection } from '../../../../packages/domain/src/index';

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
  view: LibraryView;
  sort: SortField;
  direction: 'asc' | 'desc';
}

export const defaultLibraryFilters = (): LibraryFilters => ({
  text: '', collectionId: '', tag: '', domain: '', from: '', to: '', favoriteOnly: false,
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
  return bookmarks
    .filter((bookmark) => {
      if (bookmark.deletedAt) return false;
      if (query.collectionId && bookmark.collectionId !== query.collectionId) return false;
      if (query.tag && !bookmark.tags.includes(query.tag)) return false;
      if (query.domain && bookmark.domain !== query.domain) return false;
      if (query.favorite !== undefined && bookmark.favorite !== query.favorite) return false;
      if (query.from && bookmark.updatedAt < query.from) return false;
      if (query.to && bookmark.updatedAt > query.to) return false;
      if (query.text) {
        const haystack = [bookmark.title, bookmark.url, bookmark.domain, bookmark.notes, ...bookmark.tags].join(' ').toLowerCase();
        if (!haystack.includes(query.text)) return false;
      }
      return true;
    })
    .sort((left, right) => {
      const field = query.sort ?? 'updatedAt';
      const comparison = String(left[field] ?? '').localeCompare(String(right[field] ?? ''));
      return query.direction === 'asc' ? comparison : -comparison;
    });
}

export function viewClass(view: LibraryView): string {
  return `bookmark-view bookmark-view-${view}`;
}

export function collectionOptions(collections: Collection[], selected = ''): string {
  return collections
    .filter((collection) => !collection.deletedAt)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((collection) => `<option value="${escapeHtml(collection.id)}"${collection.id === selected ? ' selected' : ''}>${escapeHtml(collection.name)}</option>`)
    .join('');
}

export function renderBookmarkCard(bookmark: Bookmark): string {
  const tags = bookmark.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
  const favoriteLabel = bookmark.favorite ? 'Remove from favorites' : 'Add to favorites';
  return `<article class="bookmark-card" data-bookmark-id="${escapeHtml(bookmark.id)}">` +
    `<a class="bookmark-title" href="${escapeHtml(bookmark.url)}" target="_blank" rel="noreferrer">${escapeHtml(bookmark.title)}</a>` +
    `<p class="bookmark-domain">${escapeHtml(bookmark.domain)}</p>` +
    (bookmark.notes ? `<p class="bookmark-notes">${escapeHtml(bookmark.notes)}</p>` : '') +
    `<div class="bookmark-tags" aria-label="Tags">${tags}</div>` +
    `<div class="bookmark-actions" role="group" aria-label="Bookmark actions">` +
    `<button type="button" data-action="favorite" aria-label="${favoriteLabel}">${bookmark.favorite ? '★' : '☆'}</button>` +
    `<button type="button" data-action="edit">Edit</button><button type="button" data-action="delete">Delete</button>` +
    `</div></article>`;
}

export function renderEmptyState(filters: LibraryFilters): string {
  const constrained = Boolean(filters.text || filters.collectionId || filters.tag || filters.domain || filters.from || filters.to || filters.favoriteOnly);
  return `<section class="empty-state" role="status"><h2>${constrained ? 'No matching bookmarks' : 'No bookmarks yet'}</h2>` +
    `<p>${constrained ? 'Clear a filter or try another search.' : 'Save a page from the extension popup to get started.'}</p>` +
    `<button type="button" data-action="clear-filters">${constrained ? 'Clear search and filters' : 'Save a page'}</button></section>`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
}

export type RuntimeAction = 'save' | 'undo' | 'open-library' | 'list' | 'update-existing' | 'copy-existing' | 'sync';

export interface RuntimeMessage { type: `lumamark-${RuntimeAction}`; payload?: unknown }

export function popupDocument(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LumaMark</title></head><body><main class="popup-shell"><header><h1>LumaMark</h1><p>Save and find links quickly.</p></header><button id="save" type="button">Save current page</button><button id="undo" type="button" disabled>Undo last save</button><label for="quick-search">Search recent bookmarks</label><input id="quick-search" type="search" autocomplete="off"><ol id="recent" aria-live="polite"></ol><p id="status" role="status" aria-live="polite"></p><a id="open-library" href="library.html">Open full library</a></main></body></html>`;
}

export function libraryDocument(collections: Collection[] = []): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LumaMark Library</title></head><body><main class="library-shell"><header><h1>Bookmark library</h1><p id="sync-status" role="status">Local data is available offline.</p></header><form id="filters" aria-label="Search and filter bookmarks"><label for="search">Search title, URL, tags, or notes</label><input id="search" name="text" type="search" autocomplete="off"><label for="collection">Collection</label><select id="collection" name="collectionId"><option value="">All collections</option>${collectionOptions(collections)}</select><label for="tag">Tag</label><input id="tag" name="tag" type="search"><label for="domain">Domain</label><input id="domain" name="domain" type="search"><label for="from">Saved after</label><input id="from" name="from" type="date"><label for="to">Saved before</label><input id="to" name="to" type="date"><label><input id="favorite" name="favoriteOnly" type="checkbox"> Favorites only</label><button type="reset">Clear filters</button></form><nav class="view-switcher" aria-label="View"><button type="button" data-view="grid">Grid</button><button type="button" data-view="list" aria-pressed="true">List</button><button type="button" data-view="compact">Compact</button></nav><section id="results" class="bookmark-view bookmark-view-list" aria-live="polite"><p class="loading-state" role="status">Loading bookmarks…</p></section><a href="settings.html">Settings, import and export</a></main></body></html>`;
}

export function settingsDocument(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LumaMark Settings</title></head><body><main class="settings-shell"><h1>Settings</h1><section aria-labelledby="sync-heading"><h2 id="sync-heading">WebDAV sync</h2><form id="sync-form"><label for="webdav-url">WebDAV URL</label><input id="webdav-url" type="url" autocomplete="url"><label for="webdav-path">Remote path</label><input id="webdav-path" type="text"><label for="webdav-user">Username</label><input id="webdav-user" type="text" autocomplete="username"><label for="webdav-password">Password</label><input id="webdav-password" type="password" autocomplete="current-password"><label><input id="auto-sync" type="checkbox"> Enable automatic sync</label><button type="submit">Save sync settings</button><button type="button" id="sync-now">Sync now</button></form><p id="sync-status" role="status" aria-live="polite">Not configured</p></section><section aria-labelledby="data-heading"><h2 id="data-heading">Your data</h2><p>Bookmarks stay local unless you configure WebDAV. LumaMark saves links and metadata, not page content.</p><button id="import-html" type="button">Import browser HTML</button><button id="import-json" type="button">Restore LumaMark JSON</button><button id="export" type="button">Export all data</button><p id="data-status" role="status" aria-live="polite"></p></section><section aria-labelledby="support-heading"><h2 id="support-heading">Browser support</h2><p id="support-matrix">Chrome, Edge and Firefox use the shared WebExtension package. Safari macOS uses an Xcode-wrapped Safari Web Extension. Mobile Safari, account sync, S3 and collaboration are not part of the first release.</p></section></main></body></html>`;
}
