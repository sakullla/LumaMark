import { describe, expect, it } from 'vitest';
import { makeBookmark, type Bookmark, type Collection } from '../../packages/domain/src/index';
import { collectionOptions, defaultLibraryFilters, renderBookmarkCard, renderFolderTree, renderScopeNav } from '../../apps/extension/src/ui/index';
import { bookmarkCountLabel, copyFor, fillCount } from '../../apps/extension/src/ui/copy';
import { renderMenuEntries } from '../../apps/extension/src/ui/context-menu';
import {
  domainCounts,
  duplicateGroups,
  extraDuplicateIds,
  folderDescendants,
  folderFootprint,
  folderPaths,
  folderTrail,
  isLockedFolder,
  isUnfiled,
  moveTargets,
  paletteResults,
  parseTags,
  placeMenu,
  typedUrl,
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

describe('folder management', () => {
  const stamp = '2026-01-01T00:00:00.000Z';
  const item = (id: string, extra: Partial<Collection> = {}): Collection => ({ id, name: id, position: 0, toolbar: false, createdAt: stamp, updatedAt: stamp, revision: 1, ...extra });
  const tree = [item('top'), item('kid', { parentId: 'top' }), item('leaf', { parentId: 'kid' }), item('side'), item('gone', { deletedAt: stamp })];
  const mark = (id: string, collectionId?: string, extra: Partial<Bookmark> = {}) => ({ ...makeBookmark({ url: `https://${id}.example/`, title: id, collectionId }), ...extra });

  it('counts everything a delete would touch, skipping what is already gone', () => {
    const footprint = folderFootprint([mark('a', 'top'), mark('b', 'leaf'), mark('c', 'side'), mark('d', 'kid', { deletedAt: stamp })], tree, 'top');
    expect(footprint.subfolders).toBe(2);
    expect(footprint.bookmarkIds).toHaveLength(2);
    expect([...footprint.folderIds].sort()).toEqual(['kid', 'leaf', 'top']);
  });

  it('never offers a folder as a destination inside itself', () => {
    expect(moveTargets(tree, 'kid').map((folder) => folder.id)).toEqual(['top', 'side']);
    expect(moveTargets(tree, undefined).map((folder) => folder.id)).toEqual(['top', 'kid', 'leaf', 'side']);
  });

  it('walks a breadcrumb and survives a loop in stored data', () => {
    expect(folderTrail(tree, 'leaf').map((folder) => folder.id)).toEqual(['top', 'kid', 'leaf']);
    expect(folderTrail([item('x', { parentId: 'y' }), item('y', { parentId: 'x' })], 'x')).toHaveLength(2);
  });

  it('locks the bar and the browser roots', () => {
    expect(isLockedFolder(item('bar', { toolbar: true }))).toBe(true);
    expect(isLockedFolder(item('root-menu'))).toBe(true);
    expect(isLockedFolder(item('plain'))).toBe(false);
  });

  it('keeps a floating menu on screen', () => {
    const view = { width: 800, height: 600 };
    expect(placeMenu({ x: 100, y: 100 }, { width: 200, height: 300 }, view)).toEqual({ left: 100, top: 100 });
    expect(placeMenu({ x: 790, y: 590 }, { width: 200, height: 300 }, view)).toEqual({ left: 590, top: 290 });
    expect(placeMenu({ x: 5, y: 5 }, { width: 900, height: 700 }, view).left).toBe(8);
  });

  it('completes a bare domain and leaves everything else to validation', () => {
    expect(typedUrl(' example.org/a ')).toBe('https://example.org/a');
    expect(typedUrl('http://example.org')).toBe('http://example.org');
    expect(typedUrl('just words')).toBe('just words');
    expect(typedUrl('')).toBe('');
  });

  it('finds folders, tags, bookmarks and commands, with every word having to match', () => {
    const source = {
      bookmarks: [mark('rust-book', 'kid', { tags: ['rust'] })],
      collections: [item('rust-notes', { name: 'Rust notes' })],
      scopes: [{ scope: { kind: 'all' } as const, label: 'All bookmarks' }],
      commands: [{ id: 'theme', label: 'Switch theme' }],
    };
    expect(paletteResults('', source).map((hit) => hit.kind)).toEqual(['command', 'scope']);
    expect(paletteResults('rust', source).map((hit) => hit.kind)).toEqual(['folder', 'tag', 'bookmark']);
    expect(paletteResults('rust zzz', source)).toEqual([]);
    expect(paletteResults('theme', source).map((hit) => hit.kind)).toEqual(['command']);
  });

  it('gives every folder row a menu and an add button, and marks disabled and dangerous entries', () => {
    const html = renderFolderTree([item('top')], null);
    expect(html).toContain('data-folder-menu="top"');
    expect(html).toContain('data-folder-add="top"');
    const menu = renderMenuEntries([{ id: 'a', label: 'A & B', run() {} }, 'separator', { id: 'b', label: 'Gone', danger: true, disabled: true, hint: 'Del', run() {} }]);
    expect(menu).toContain('A &amp; B');
    expect(menu).toContain('role="separator"');
    expect(menu).toContain('context-item is-danger" data-menu-item="b" disabled');
    expect(menu).toContain('<kbd>Del</kbd>');
  });
});
