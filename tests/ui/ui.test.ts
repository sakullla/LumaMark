import { describe, expect, it } from 'vitest';
import { makeBookmark, type Collection } from '../../packages/domain/src/index';
import { defaultLibraryFilters, filterBookmarks, libraryDocument, popupDocument, renderEmptyState, settingsDocument, toBookmarkQuery } from '../../apps/extension/src/ui/index';
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

  it('provides accessible popup, library and settings landmarks', () => {
    const collection: Collection = { id: 'c', name: 'Work', position: 0, toolbar: false, createdAt: '2024-01-01', updatedAt: '2024-01-01', revision: 1 };
    expect(popupDocument()).toContain('aria-live');
    expect(libraryDocument([collection])).toContain('Search title, URL, tags, or notes');
    expect(settingsDocument()).toContain('WebDAV URL');
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
