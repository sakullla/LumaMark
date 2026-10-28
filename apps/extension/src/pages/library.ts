import type { Bookmark, Collection } from '../../../../packages/domain/src/index';
import { defaultLibraryFilters, filterBookmarks, libraryDocument, renderBookmarkCard, renderEmptyState, type LibraryFilters, viewClass } from '../ui/index';

export interface LibraryRenderState { bookmarks: Bookmark[]; collections: Collection[]; filters: LibraryFilters }

export function renderLibrary(state: LibraryRenderState): string {
  const filtered = filterBookmarks(state.bookmarks, state.filters);
  const body = filtered.length ? filtered.map(renderBookmarkCard).join('') : renderEmptyState(state.filters);
  return `<section id="results" class="${viewClass(state.filters.view)}" aria-live="polite">${body}</section>`;
}

export function initialLibraryState(bookmarks: Bookmark[] = [], collections: Collection[] = []): LibraryRenderState {
  return { bookmarks, collections, filters: defaultLibraryFilters() };
}

export { libraryDocument };
