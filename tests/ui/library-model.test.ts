import { describe, expect, it } from 'vitest';
import { makeBookmark, type Bookmark, type Collection } from '../../packages/domain/src/index';
import { collectionOptions, defaultLibraryFilters, renderBookmarkCard, renderFolderTree, renderScopeNav } from '../../apps/extension/src/ui/index';
import { bookmarkCountLabel, copyFor, fillCount } from '../../apps/extension/src/ui/copy';
import {
  domainCounts,
  duplicateGroups,
  extraDuplicateIds,
  folderDescendants,
  folderPaths,
  isUnfiled,
  parseTags,
  planReplace,
  rangeIds,
  scopedBookmarks,
  scopeKey,
  tagChanges,
  tagCounts,
  undoChanges,
} from '../../apps/extension/src/ui/library-model';

const stamp = '2026-01-01T00:00:00.000Z';
const folder = (id: string, extra: Partial<Collection> = {}): Collection => ({ id, name: id, position: 0, toolbar: false, createdAt: stamp, updatedAt: stamp, revision: 1, ...extra });
const mark = (title: string, extra: Partial<Bookmark> = {}, url = `https://${title.toLowerCase().replace(/\W+/g, '-')}.example/`): Bookmark => ({ ...makeBookmark({ url, title }, stamp), ...extra });

describe('library scopes', () => {
  const collections = [folder('top'), folder('child', { parentId: 'top' }), folder('grandchild', { parentId: 'child' }), folder('gone', { deletedAt: stamp })];
  const inTop = mark('Alpha', { collectionId: 'top', favorite: true });
  const inChild = mark('Beta', { collectionId: 'child', tags: ['work'] });
  const orphan = mark('Gamma', { collectionId: 'gone' });
  const loose = mark('Delta');
  const trashed = mark('Epsilon', { deletedAt: stamp });
  const all = [inTop, inChild, orphan, loose, trashed];
  const ids = (scope: Parameters<typeof scopedBookmarks>[1], filters = defaultLibraryFilters(), extra = {}) =>
    scopedBookmarks(all, scope, filters, { collections, ...extra }).map((item) => item.title).sort();

  it('shows every live bookmark in All, and deleted ones only in Trash', () => {
    expect(ids({ kind: 'all' })).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
    expect(ids({ kind: 'trash' })).toEqual(['Epsilon']);
    expect(ids({ kind: 'favorites' })).toEqual(['Alpha']);
    expect(ids({ kind: 'tag', tag: 'work' })).toEqual(['Beta']);
  });

  it('keeps bookmarks of a deleted folder reachable under Unfiled', () => {
    expect(ids({ kind: 'unfiled' })).toEqual(['Delta', 'Gamma']);
    expect(isUnfiled(orphan, new Set(['top']))).toBe(true);
    expect(isUnfiled(inTop, new Set(['top']))).toBe(false);
  });

  it('searches across folders unless asked to stay inside one, and includes subfolders when it does', () => {
    const search = { ...defaultLibraryFilters(), text: 'beta' };
    expect(ids({ kind: 'folder', id: 'top' })).toEqual(['Alpha']);
    expect(ids({ kind: 'folder', id: 'grandchild' }, search)).toEqual(['Beta']);
    expect(ids({ kind: 'folder', id: 'grandchild' }, search, { searchWithinFolder: true })).toEqual([]);
    expect(ids({ kind: 'folder', id: 'top' }, search, { searchWithinFolder: true })).toEqual(['Beta']);
  });

  it('limits Recent to the last 30 days', () => {
    const now = Date.parse('2026-03-01T00:00:00.000Z');
    const fresh = mark('Fresh', { createdAt: '2026-02-20T00:00:00.000Z' });
    expect(scopedBookmarks([fresh, inTop], { kind: 'recent' }, defaultLibraryFilters(), { collections, now }).map((item) => item.title)).toEqual(['Fresh']);
  });

  it('names folders by path and walks descendants without looping on bad parents', () => {
    expect(folderPaths(collections).get('grandchild')).toBe('top / child / grandchild');
    expect(folderPaths(collections).has('gone')).toBe(false);
    expect([...folderDescendants(collections, 'top')].sort()).toEqual(['child', 'grandchild', 'top']);
    const loop = [folder('a', { parentId: 'b' }), folder('b', { parentId: 'a' })];
    expect(folderPaths(loop).size).toBe(2);
    expect(scopeKey({ kind: 'tag', tag: 'x' })).toBe('tag:x');
  });
});

describe('bulk edits', () => {
  it('selects inclusive ranges in either direction and survives a missing anchor', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(rangeIds(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(order, undefined, 'c')).toEqual(['c']);
    expect(rangeIds(order, 'gone', 'c')).toEqual(['c']);
    expect(rangeIds(order, 'a', 'gone')).toEqual([]);
  });

  it('counts tags and websites from live bookmarks only', () => {
    const items = [mark('A', { tags: ['x', 'y'], domain: 'a.test' }), mark('B', { tags: ['x'], domain: 'a.test' }), mark('C', { tags: ['z'], deletedAt: stamp })];
    expect(tagCounts(items)).toEqual([{ name: 'x', count: 2 }, { name: 'y', count: 1 }]);
    expect(domainCounts(items)).toEqual([{ name: 'a.test', count: 2 }]);
    expect(parseTags('Work, #read，  ,later')).toEqual(['work', 'read', 'later']);
  });

  it('adds, removes and merges tags without touching bookmarks that would not change', () => {
    const tagged = mark('A', { tags: ['old', 'keep'] });
    const plain = mark('B', { tags: ['new'] });
    expect(tagChanges([tagged, plain], ['new'], ['old'])).toEqual([{ id: tagged.id, update: { tags: ['keep', 'new'] } }]);
    expect(tagChanges([plain], ['new'], [])).toEqual([]);
  });

  it('records what undo needs, including the way back to no folder', () => {
    const loose = mark('A', { favorite: true });
    expect(undoChanges([loose], ['collectionId', 'favorite'])).toEqual([{ id: loose.id, update: { collectionId: null, favorite: true } }]);
  });

  it('keeps the most valuable copy of each duplicate and ignores deleted ones', () => {
    const plain = mark('Plain', { updatedAt: '2026-05-01T00:00:00.000Z' }, 'https://same.example/');
    const starred = mark('Starred', { favorite: true }, 'https://same.example/');
    const noted = mark('Noted', { notes: 'keep me' }, 'https://noted.example/');
    const bare = mark('Bare', { updatedAt: '2026-05-01T00:00:00.000Z' }, 'https://noted.example/');
    const deleted = mark('Deleted', { deletedAt: stamp }, 'https://solo.example/');
    const twin = mark('Twin', {}, 'https://solo.example/');
    const groups = duplicateGroups([plain, starred, noted, bare, deleted, twin]);
    expect(groups).toHaveLength(2);
    expect(extraDuplicateIds(groups).sort()).toEqual([plain.id, bare.id].sort());
  });

  it('plans literal find and replace, case rules, and refuses results that would break a bookmark', () => {
    const items = [mark('Docs | MDN'), mark('docs | mdn'), mark('Other')];
    expect(planReplace(items, { field: 'title', find: ' | MDN', replace: '', matchCase: false }).edits.map((edit) => edit.after)).toEqual(['Docs', 'docs']);
    expect(planReplace(items, { field: 'title', find: ' | MDN', replace: '', matchCase: true }).edits).toHaveLength(1);
    expect(planReplace(items, { field: 'title', find: 'a.b', replace: 'x', matchCase: false }).edits).toEqual([]);
    expect(planReplace(items, { field: 'title', find: '', replace: 'x', matchCase: false }).edits).toEqual([]);
    expect(planReplace([mark('A|A', {}, 'https://pipe.example/')], { field: 'title', find: 'a', replace: 'bb', matchCase: false }).edits[0]?.after).toBe('bb|bb');
    const web = mark('Site', {}, 'http://old.example/page');
    expect(planReplace([web], { field: 'url', find: 'http://old.example', replace: 'https://new.example', matchCase: true }).edits[0]?.after).toBe('https://new.example/page');
    expect(planReplace([web], { field: 'url', find: 'http://', replace: '', matchCase: true })).toEqual({ edits: [], invalid: 1 });
    expect(planReplace([mark('Only')], { field: 'title', find: 'Only', replace: '', matchCase: true })).toEqual({ edits: [], invalid: 1 });
  });

  it('pluralizes counts in English and groups large numbers', () => {
    expect(fillCount(copyFor('en').movedCount, 1)).toBe('Moved 1 bookmark.');
    expect(fillCount(copyFor('en').movedCount, 2)).toBe('Moved 2 bookmarks.');
    expect(fillCount(copyFor('zh').movedCount, 2)).toBe('已移动 2 个书签。');
    expect(bookmarkCountLabel(1200)).toMatch(/^1.200 bookmarks$/);
  });
});

describe('library markup', () => {
  it('marks selection, opens links in a new tab and offers Restore in Trash', () => {
    const bookmark = mark('Page', { tags: ['a', 'b', 'c', 'd', 'e'] });
    const card = renderBookmarkCard(bookmark, 'en', { selected: true, path: 'Top / Child' });
    expect(card).toContain('bookmark-card is-selected');
    expect(card).toContain(' checked');
    expect(card).toContain('target="_blank"');
    expect(card).toContain('Top / Child');
    expect(card).toContain('+2');
    expect(renderBookmarkCard({ ...bookmark, deletedAt: stamp })).toContain('data-action="restore"');
    expect(renderBookmarkCard({ ...bookmark, deletedAt: stamp })).not.toContain('data-action="edit"');
  });

  it('shows Duplicates only when there are some, and folds folders shut', () => {
    const counts = { all: 3, favorites: 0, recent: 1, unfiled: 0, duplicates: 0, trash: 0 };
    expect(renderScopeNav('all', counts)).not.toContain('data-scope="duplicates"');
    expect(renderScopeNav('all', { ...counts, duplicates: 2 })).toContain('data-scope="duplicates"');
    const collections = [folder('top'), folder('child', { parentId: 'top' })];
    expect(renderFolderTree(collections, null)).toContain('data-select-folder="child"');
    const shut = renderFolderTree(collections, null, 'en', {}, new Set(['top']));
    expect(shut).not.toContain('data-select-folder="child"');
    expect(shut).toContain('aria-expanded="false"');
  });

  it('does not repeat the bar label when the folder is already called that', () => {
    expect(collectionOptions([folder('bar', { name: 'Bookmarks bar', toolbar: true })])).toContain('>Bookmarks bar<');
    expect(collectionOptions([folder('bar', { name: 'Daily', toolbar: true })])).toContain('>Daily (Bookmarks bar)<');
  });
});
