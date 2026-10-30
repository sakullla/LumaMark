import { describe, expect, it } from 'vitest';
import { makeBookmark, type Collection } from '../../packages/domain/src/index';
import { defaultLibraryFilters, filterBookmarks, homeDocument, libraryDocument, popupDocument, renderBookmarkCard, renderEmptyState, settingsDocument, toBookmarkQuery } from '../../apps/extension/src/ui/index';
import { popupRuntimeMessage, popupStatus } from '../../apps/extension/src/pages/popup';
import { settingsStatusMessage } from '../../apps/extension/src/pages/settings';

const first = makeBookmark({ url: 'https://example.com/one', title: 'One', notes: 'alpha note', tags: ['work'], favorite: true }, '2024-01-01T00:00:00.000Z');
const second = makeBookmark({ url: 'https://other.test/two', title: 'Two', notes: 'beta note', tags: ['read'] }, '2024-02-01T00:00:00.000Z');

describe('LumaMark UI state and documents', () => {
  it('combines text, tag, domain and favorite filters', () => {
    const filters = { ...defaultLibraryFilters(), text: 'alpha', tag: 'work', domain: 'example.com', favoriteOnly: true };
    expect(filterBookmarks([first, second], filters).map((item) => item.id)).toEqual([first.id]);
    expect(toBookmarkQuery(filters)).toMatchObject({ text: 'alpha', tag: 'work', domain: 'example.com', favorite: true });
  });

  it('renders actionable empty state when filters exclude all records', () => {
    const html = renderEmptyState({ ...defaultLibraryFilters(), text: 'missing' });
    expect(html).toContain('No matching bookmarks');
    expect(html).toContain('clear-filters');
  });

  it('renders bookmark card actions as labelled SVG icon buttons', () => {
    const html = renderBookmarkCard(first);
    expect(html).toContain('class="bookmark-card"');
    expect(html).toContain('class="bookmark-actions"');
    expect(html).toContain('data-action="favorite"');
    expect(html).toContain('aria-label="Remove from favorites"');
    expect(html).toContain('data-action="edit"');
    expect(html).toContain('aria-label="Edit"');
    expect(html).toContain('data-action="delete"');
    expect(html).toContain('aria-label="Delete"');
    expect(html).toContain('<svg');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('★');
    expect(html).not.toContain('☆');
    expect(renderBookmarkCard(second)).toContain('aria-label="Add to favorites"');
  });

  it('provides accessible popup, library and settings landmarks', () => {
    const collection: Collection = { id: 'c', name: 'Work', position: 0, toolbar: false, createdAt: '2024-01-01', updatedAt: '2024-01-01', revision: 1 };
    expect(popupDocument()).toContain('aria-live');
    expect(libraryDocument([collection])).toContain('Search title, URL, tags, or notes');
    expect(settingsDocument()).toContain('WebDAV URL');
  });

  it('grades popup actions and keeps every mount hook after the reshuffle', () => {
    const popup = popupDocument();
    expect(popup).toContain('<details id="more">');
    expect(popup).toContain('id="saved-editor" class="form-grid"');
    expect(popup).toContain('id="save-edits" class="primary"');
    expect(popup).toContain('id="delete-saved" class="danger"');
    expect(popup).toContain('id="undo" class="ghost"');
    expect(popup).toContain('id="open-existing" class="secondary"');
    expect(popup).toContain('id="update-existing" class="primary"');
    expect(popup).toContain('id="copy-existing" class="ghost"');
    expect(popup).toContain('id="save" class="primary"');
    for (const hook of ['id="page-preview"', 'id="page-icon"', 'id="page-fallback"', 'id="page-title"', 'id="page-url"', 'id="save-tags"', 'id="save-notes"', 'id="edit-title"', 'id="edit-folder"', 'id="existing-note"', 'id="status"', 'id="open-home"', 'id="open-library"']) {
      expect(popup).toContain(hook);
    }
    expect(popup).toContain('<svg');
  });

  it('gives the home search hero and empty bar a layered structure', () => {
    const home = homeDocument();
    expect(home).toContain('id="search-form" role="search"');
    expect(home).toContain('id="search" type="search"');
    expect(home).toContain('class="empty-icon"');
    expect(home).toContain('id="save-current" class="primary"');
    expect(home).toContain('id="import-html" class="secondary"');
    expect(home).toContain('id="bar-empty" class="empty-state" hidden');
    expect(home).toContain('id="sync-line"');
    expect(home).toContain('<svg');
  });

  it('collects library filters behind the search row and moves collection tools into the sidebar', () => {
    const library = libraryDocument();
    expect(library.indexOf('id="search"')).toBeLessThan(library.indexOf('<details id="more-filters">'));
    expect(library.indexOf('id="folder-tree"')).toBeLessThan(library.indexOf('id="new-collection"'));
    expect(library.indexOf('id="new-collection"')).toBeLessThan(library.indexOf('id="filters"'));
    expect(library).toContain('id="batch-actions" hidden');
    expect(library).toContain('id="batch-move" class="secondary"');
    expect(library).toContain('id="batch-delete" class="danger"');
    expect(library).toContain('id="create-collection" class="secondary"');
    expect(library).toContain('id="delete-folder" class="danger"');
    expect(library).toContain('id="editor" class="form-grid"');
    expect(library).toContain('id="decision-confirm" class="danger"');
    expect(library).toContain('id="decision-cancel" class="secondary"');
    for (const name of ['name="text"', 'name="tag"', 'name="domain"', 'name="from"', 'name="to"', 'name="favoriteOnly"', 'name="title"', 'name="url"', 'name="folder"', 'name="tags"', 'name="notes"', 'name="favorite"']) {
      expect(library).toContain(name);
    }
    for (const id of ['id="tag"', 'id="domain"', 'id="from"', 'id="to"', 'id="favorite"', 'id="batch-collection"', 'id="results"', 'id="editor-title"', 'id="editor-url"', 'id="editor-folder"', 'id="editor-tags"', 'id="editor-notes"', 'id="editor-favorite"', 'id="editor-error"', 'id="editor-cancel"', 'id="decision"', 'id="decision-text"', 'id="library-status"', 'id="new-collection"']) {
      expect(library).toContain(id);
    }
  });

  it('cards the settings groups with aligned grids and graded action rows', () => {
    const settings = settingsDocument();
    expect(settings).toContain('id="sync-form" class="form-grid"');
    expect(settings).toContain('id="sync-now" class="secondary"');
    expect(settings).toContain('id="export" class="secondary"');
    expect(settings).toContain('id="save-toolbar" class="primary"');
    expect(settings).toContain('id="import-html" class="secondary"');
    expect(settings).toContain('class="check-line"');
    for (const id of ['id="toolbar-folder"', 'id="save-toolbar"', 'id="search-url"', 'id="save-search"', 'id="home-status"', 'id="webdav-url"', 'id="webdav-path"', 'id="webdav-user"', 'id="webdav-password"', 'id="auto-sync"', 'id="sync-status"', 'id="sync-metadata"', 'id="conflicts"', 'id="import-action"', 'id="import-html"', 'id="import-json"', 'id="export"', 'id="data-status"']) {
      expect(settings).toContain(id);
    }
  });

  it('exposes runtime actions and clear status for save, duplicate, undo and errors', () => {
    expect(popupRuntimeMessage('open-library')).toEqual({ type: 'lumamark-open-library' });
    expect(popupRuntimeMessage('update-existing', { id: first.id })).toEqual({ type: 'lumamark-update-existing', payload: { id: first.id } });
    expect(popupStatus('existing')).toContain('already saved');
    expect(popupStatus('undone')).toContain('undone');
    expect(settingsStatusMessage('error')).toContain('Local data is still available');
    expect(settingsStatusMessage('saving', '', 'zh')).toContain('正在保存');
    expect(settingsStatusMessage('syncing', '', 'zh')).toContain('正在同步');
    expect(settingsStatusMessage('synced', '', 'zh')).toContain('已同步');
    expect(settingsStatusMessage('error', '', 'zh')).toContain('同步失败');
    expect(settingsStatusMessage('conflict', '', 'zh')).toContain('需要选择');
    expect(settingsStatusMessage('synced', '', 'zh')).not.toContain('Synced');
  });

  it('includes bookmarks saved on the selected end date', () => {
    const day = makeBookmark({ url: 'https://day.example/a', title: 'Day' }, '2024-01-02T12:00:00.000Z');
    const earlier = makeBookmark({ url: 'https://day.example/b', title: 'Earlier' }, '2024-01-01T12:00:00.000Z');
    const range = { ...defaultLibraryFilters(), from: '2024-01-02', to: '2024-01-02' };
    expect(filterBookmarks([day, earlier], range).map((item) => item.id)).toEqual([day.id]);
    expect(filterBookmarks([day], { ...defaultLibraryFilters(), to: '2024-01-02' }).map((item) => item.id)).toEqual([day.id]);
    expect(filterBookmarks([day], { ...defaultLibraryFilters(), from: '2024-01-03' })).toEqual([]);
  });
});
