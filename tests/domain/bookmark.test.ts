import { describe, expect, it } from 'vitest';
import {
  Bookmark,
  BookmarkRepository,
  BookmarkService,
  Collection,
  applyBookmarkUpdate,
  applyCollectionUpdate,
  assignToolbar,
  makeBookmark,
  migrateExport,
  orderedSiblings,
} from '../../packages/domain/src/index';

class MemoryRepository implements BookmarkRepository {
  items = new Map<string, Bookmark>();
  async list() { return [...this.items.values()]; }
  async findById(id: string) { return this.items.get(id); }
  async findByUrl(url: string) { return [...this.items.values()].find((item) => item.url === url); }
  async put(bookmark: Bookmark) { this.items.set(bookmark.id, bookmark); }
  async remove(id: string) { this.items.delete(id); }
}

describe('BookmarkService', () => {
  it('normalizes URL and provides a domain title when metadata is unavailable', async () => {
    const repository = new MemoryRepository();
    const service = new BookmarkService(repository);
    const result = await service.save({ url: 'https://Example.com/path#fragment' });
    expect(result.kind).toBe('saved');
    if (result.kind === 'saved') {
      expect(result.bookmark.url).toBe('https://example.com/path#fragment');
      expect(result.bookmark.title).toBe('example.com');
    }
  });

  it('returns existing records rather than silently duplicating them', async () => {
    const repository = new MemoryRepository();
    const service = new BookmarkService(repository);
    await service.save({ url: 'https://example.com' });
    const result = await service.save({ url: 'https://example.com' });
    expect(result.kind).toBe('existing');
  });

  it('supports explicit copy, update and tombstone restore', async () => {
    const repository = new MemoryRepository();
    const service = new BookmarkService(repository);
    const original = await service.save({ url: 'https://example.com', title: 'Old' });
    if (original.kind !== 'saved') throw new Error('expected saved');
    const updated = await service.save({ url: 'https://example.com', title: 'New' }, 'update');
    expect(updated.kind).toBe('saved');
    const copy = await service.save({ url: 'https://example.com', title: 'Copy' }, 'copy');
    expect(copy.kind).toBe('saved');
    expect(copy.kind === 'saved' && copy.bookmark.id).not.toBe(original.bookmark.id);
    await service.remove(original.bookmark.id);
    expect((await service.list()).every((item) => !item.deletedAt)).toBe(true);
    await service.restore(original.bookmark.id);
    expect((await repository.findById(original.bookmark.id))?.deletedAt).toBeUndefined();
  });

  it('creates deterministic normalized bookmark values', () => {
    const bookmark = makeBookmark({ url: 'https://example.com', tags: [' Work ', 'work', 'Home'] }, '2026-01-01T00:00:00.000Z');
    expect(bookmark.tags).toEqual(['home', 'work']);
    expect(bookmark.revision).toBe(1);
    expect(bookmark.position).toBe(0);
  });

  it('increases revision when position or parent folder changes', async () => {
    const repository = new MemoryRepository();
    const service = new BookmarkService(repository);
    const saved = await service.save({ url: 'https://example.com/item', position: 1, collectionId: 'old' });
    if (saved.kind !== 'saved') throw new Error('expected saved');
    const repositioned = await service.update(saved.bookmark.id, { position: 4 });
    expect(repositioned.position).toBe(4);
    expect(repositioned.collectionId).toBe('old');
    expect(repositioned.revision).toBe(saved.bookmark.revision + 1);
    const moved = applyBookmarkUpdate(repositioned, { collectionId: null }, '2026-03-01T00:00:00.000Z');
    expect(moved.collectionId).toBeUndefined();
    expect(moved.revision).toBe(repositioned.revision + 1);

    const folder: Collection = {
      id: 'folder', name: 'Folder', position: 1, toolbar: false, parentId: 'parent',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 2,
    };
    const repositionedFolder = applyCollectionUpdate(folder, { position: 6 }, '2026-04-01T00:00:00.000Z');
    expect(repositionedFolder.position).toBe(6);
    expect(repositionedFolder.revision).toBe(3);
    const reparented = applyCollectionUpdate(folder, { parentId: null }, '2026-04-01T00:00:00.000Z');
    expect(reparented.parentId).toBeUndefined();
    expect(reparented.revision).toBe(3);
    expect(applyCollectionUpdate(folder, { position: 1, toolbar: false }).revision).toBe(folder.revision);
  });

  it('orders child folders and bookmarks by position, then id', () => {
    const bookmarks = [
      makeBookmark({ id: 'b', url: 'https://b.example', position: 2, collectionId: 'parent' }, '2026-01-01T00:00:00.000Z'),
      makeBookmark({ id: 'a', url: 'https://a.example', position: 0, collectionId: 'parent' }, '2026-01-01T00:00:00.000Z'),
      makeBookmark({ id: 'gone', url: 'https://gone.example', position: 0, collectionId: 'parent' }, '2026-01-01T00:00:00.000Z'),
      makeBookmark({ id: 'other', url: 'https://other.example', position: 0 }, '2026-01-01T00:00:00.000Z'),
    ];
    bookmarks[2] = { ...bookmarks[2], deletedAt: '2026-02-01T00:00:00.000Z' };
    const collections: Collection[] = [
      { id: 'parent', name: 'Parent', position: 0, toolbar: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1 },
      { id: 'e', name: 'Earlier', parentId: 'parent', position: 0, toolbar: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1 },
      { id: 'f', name: 'Folder', parentId: 'parent', position: 1, toolbar: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1 },
      { id: 'deleted-folder', name: 'Deleted', parentId: 'parent', position: 1, toolbar: false, deletedAt: '2026-02-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 2 },
    ];
    expect(orderedSiblings('parent', bookmarks, collections).map((item) => item.record.id)).toEqual(['a', 'e', 'f', 'b']);
    const marked = assignToolbar(collections, 'f', '2026-05-01T00:00:00.000Z');
    expect(marked.find((item) => item.id === 'f')).toMatchObject({ toolbar: true, revision: 2 });
    expect(marked.find((item) => item.id === 'parent')).toMatchObject({ toolbar: false, revision: 2 });
    expect(marked.find((item) => item.id === 'e')?.revision).toBe(1);
  });

  it('keeps schema 1 records and fills missing order and toolbar', () => {
    const migrated = migrateExport({
      format: 'lumamark',
      schemaVersion: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      bookmarks: [{
        id: 'b', url: 'https://example.com/a', title: 'A', domain: 'example.com', notes: '', tags: ['one'], favorite: false,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1,
      }],
      collections: [{
        id: 'c', name: 'Folder', position: 2, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1,
      }],
    });
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.bookmarks).toHaveLength(1);
    expect(migrated.bookmarks[0]).toMatchObject({ id: 'b', title: 'A', position: 0 });
    expect(migrated.collections).toHaveLength(1);
    expect(migrated.collections[0]).toMatchObject({ id: 'c', name: 'Folder', position: 2, toolbar: false });
  });
});
