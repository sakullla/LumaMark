import { describe, expect, it } from 'vitest';
import { Bookmark, BookmarkRepository, BookmarkService, makeBookmark } from '../../packages/domain/src/index';

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
  });
});
