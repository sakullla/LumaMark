import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { IndexedDbRepository } from '../../packages/storage/src/index';
import { makeBookmark, BookmarkService, Collection } from '../../packages/domain/src/index';

const repositories: IndexedDbRepository[] = [];
afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.close()));
});

describe('IndexedDbRepository', () => {
  it('stores permanent deletes without placeholder fields or URL index entries', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const repository = new IndexedDbRepository(name);
    repositories.push(repository);
    const item = { ...makeBookmark({ url: 'https://secret.example/', notes: 'Private note' }), deletedAt: '2026-01-01T00:00:00.000Z' };
    await repository.put(item);
    const service = new BookmarkService(repository);
    const purged = await service.purge(item.id);
    expect(await repository.findById(item.id)).toEqual(purged);
    expect(await repository.findByUrl(item.url)).toBeUndefined();
    expect(await repository.findByUrl(purged.url)).toBeUndefined();
    expect(await repository.list()).toEqual([]);
    expect(await repository.list({ includeDeleted: true, text: 'Private' })).toEqual([]);
    expect(await repository.list({ includeDeleted: true })).toEqual([purged]);
    await expect(service.restore(item.id)).rejects.toThrow('permanently deleted');
    await repository.close();
    const raw = await new Promise<any>((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('bookmarks');
        const read = tx.objectStore('bookmarks').get(item.id);
        tx.oncomplete = () => { open.result.close(); resolve(read.result); };
      };
    });
    expect(Object.keys(raw).sort()).toEqual(['createdAt', 'deletedAt', 'id', 'purgedAt', 'revision', 'updatedAt']);
    expect(JSON.stringify(raw).length).toBeLessThan(JSON.stringify(purged).length * 0.75);
  });

  it('migrates existing full tombstones without changing live or recoverable Trash records', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const stamp = '2026-01-01T00:00:00.000Z';
    const live = makeBookmark({ url: 'https://live.example/' });
    const trash = { ...makeBookmark({ url: 'https://trash.example/' }), deletedAt: stamp };
    const purged = { ...makeBookmark({ url: 'https://secret.example/', notes: 'Private note' }), deletedAt: stamp, purgedAt: stamp };
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(name, 2);
      open.onerror = () => reject(open.error);
      open.onupgradeneeded = () => {
        const store = open.result.createObjectStore('bookmarks', { keyPath: 'id' });
        for (const key of ['url', 'updatedAt', 'collectionId']) store.createIndex(key, key);
        for (const item of [live, trash, purged]) store.put(item);
      };
      open.onsuccess = () => { open.result.close(); resolve(); };
    });
    const repository = new IndexedDbRepository(name);
    repositories.push(repository);
    expect(await repository.findById(live.id)).toEqual(live);
    expect(await repository.findById(trash.id)).toEqual(trash);
    expect(await repository.findById(purged.id)).toMatchObject({ id: purged.id, purgedAt: stamp, notes: '', url: 'https://deleted.invalid/' });
    expect(await repository.findByUrl(purged.url)).toBeUndefined();
    expect(await repository.findByUrl('https://deleted.invalid/')).toBeUndefined();
    await repository.close();
    expect(await repository.findById(purged.id)).toMatchObject({ purgedAt: stamp, notes: '' });
  });

  it('persists and queries bookmarks with combined filters and pagination', async () => {
    const repository = new IndexedDbRepository(`test-${crypto.randomUUID()}`);
    repositories.push(repository);
    const first = makeBookmark({ url: 'https://example.com/a', title: 'Alpha', tags: ['work'], favorite: true });
    const second = makeBookmark({ url: 'https://example.org/b', title: 'Beta', tags: ['home'] });
    await repository.put(first);
    await repository.put(second);
    expect((await repository.list({ text: 'alpha', favorite: true })).map((item) => item.id)).toEqual([first.id]);
    expect((await repository.list({ domain: 'example.org', limit: 1 })).map((item) => item.id)).toEqual([second.id]);
  });

  it('keeps deleted tombstones out of normal lists and exposes them when requested', async () => {
    const repository = new IndexedDbRepository(`test-${crypto.randomUUID()}`);
    repositories.push(repository);
    const item = { ...makeBookmark({ url: 'https://example.com' }), deletedAt: '2026-01-01T00:00:00.000Z' };
    await repository.put(item);
    expect(await repository.list()).toEqual([]);
    expect((await repository.list({ includeDeleted: true })).length).toBe(1);
  });

  it('stores sync metadata and conflicts locally without a network', async () => {
    const repository = new IndexedDbRepository(`test-${crypto.randomUUID()}`);
    repositories.push(repository);
    const metadata = await repository.getSyncMetadata();
    expect(metadata.status).toBe('offline');
    expect((await repository.getSyncMetadata()).deviceId).toBe(metadata.deviceId);
    await repository.setSyncMetadata({ ...metadata, status: 'idle', pendingChanges: 2 });
    expect((await repository.getSyncMetadata()).pendingChanges).toBe(2);
    const local = makeBookmark({ url: 'https://example.com', title: 'Local' });
    const remote = { ...local, title: 'Remote', revision: 2 };
    await repository.putConflict({ id: 'c1', bookmarkId: local.id, local, remote, fields: ['title'], createdAt: new Date().toISOString() });
    expect((await repository.listConflicts()).map((item) => item.id)).toEqual(['c1']);
  });

  it('persists collection hierarchy for sync consumers', async () => {
    const repository = new IndexedDbRepository(`test-${crypto.randomUUID()}`);
    repositories.push(repository);
    const parent: Collection = {
      id: 'parent', name: 'Parent', position: 0, toolbar: false,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1,
    };
    const child: Collection = {
      id: 'child', name: 'Child', parentId: parent.id, position: 0, toolbar: false,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1,
    };
    await repository.putCollection(parent);
    await repository.putCollection(child);
    expect((await repository.listCollections()).sort((a, b) => a.id.localeCompare(b.id))).toEqual([child, parent]);
  });
});
