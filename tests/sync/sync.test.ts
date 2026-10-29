import { describe, expect, it } from 'vitest';
import { Bookmark, BookmarkRepository, Collection, SyncMetadata } from '../../packages/domain/src/index';
import { SyncRepository, SyncManifest, WebDavClient, WebDavSyncEngine } from '../../packages/sync/src/index';

function bookmark(id: string, title: string, revision = 1, updatedAt = '2024-01-01T00:00:00.000Z', position = 0): Bookmark {
  return {
    id,
    url: `https://example.com/${id}`,
    title,
    domain: 'example.com',
    notes: '',
    tags: [],
    favorite: false,
    createdAt: updatedAt,
    updatedAt,
    revision,
    position,
  };
}

class MemoryRepository implements SyncRepository {
  public values = new Map<string, Bookmark>();
  public collections = new Map<string, Collection>();
  public conflicts: any[] = [];
  public metadata: SyncMetadata = { key: 'sync', deviceId: 'device-a', status: 'idle', pendingChanges: 0, autoSync: false };
  async list(): Promise<Bookmark[]> { return [...this.values.values()]; }
  async findById(id: string): Promise<Bookmark | undefined> { return this.values.get(id); }
  async findByUrl(url: string): Promise<Bookmark | undefined> { return [...this.values.values()].find((item) => item.url === url); }
  async put(value: Bookmark): Promise<void> { this.values.set(value.id, value); }
  async remove(id: string): Promise<void> { this.values.delete(id); }
  async listCollections(): Promise<Collection[]> { return [...this.collections.values()]; }
  async putCollection(value: Collection): Promise<void> { this.collections.set(value.id, value); }
  async getSyncMetadata(): Promise<SyncMetadata> { return this.metadata; }
  async setSyncMetadata(value: SyncMetadata): Promise<void> { this.metadata = value; }
  async putConflict(value: any): Promise<void> {
    const index = this.conflicts.findIndex((item) => item.id === value.id);
    if (index >= 0) this.conflicts[index] = value;
    else this.conflicts.push(value);
  }
  async listConflicts(includeResolved = false): Promise<any[]> {
    return includeResolved ? [...this.conflicts] : this.conflicts.filter((item) => !item.resolvedAt);
  }
}

class MemoryClient implements WebDavClient {
  public snapshot: { manifest?: SyncManifest; etag?: string } = {};
  public fail = false;
  public notFound = false;
  async read() {
    if (this.fail) throw new Error('network unavailable');
    if (this.notFound) throw new Error('WebDAV read failed (404)');
    return this.snapshot;
  }
  async write(manifest: SyncManifest, etag?: string) { if (this.fail) throw new Error('remote is read-only'); this.snapshot = { manifest, etag: etag ?? 'etag-1' }; return { etag: 'etag-2' }; }
}

describe('WebDavSyncEngine', () => {
  const collection = (
    id: string,
    name: string,
    revision = 1,
    updatedAt = '2024-01-01T00:00:00.000Z',
    deletedAt?: string,
    extras: { position?: number; toolbar?: boolean; parentId?: string } = {},
  ): Collection => ({
    id,
    name,
    position: extras.position ?? 0,
    toolbar: extras.toolbar ?? false,
    ...(extras.parentId ? { parentId: extras.parentId } : {}),
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt,
    revision,
    ...(deletedAt ? { deletedAt } : {}),
  });

  it('uploads local changes and imports remote-only records', async () => {
    const repository = new MemoryRepository();
    await repository.put(bookmark('local', 'Local'));
    await repository.putCollection(collection('local-folder', 'Local folder'));
    const client = new MemoryClient();
    client.snapshot.manifest = {
      format: 'lumamark-sync', schemaVersion: 1, generatedAt: '2024-01-01T00:00:00.000Z', deviceId: 'device-b',
      bookmarks: [bookmark('remote', 'Remote')], collections: [collection('remote-folder', 'Remote folder')],
    };
    const result = await new WebDavSyncEngine(repository, client).sync();
    expect(result.status).toBe('idle');
    expect((await repository.list()).map((item) => item.id).sort()).toEqual(['local', 'remote']);
    expect(client.snapshot.manifest?.bookmarks).toHaveLength(2);
    expect(client.snapshot.manifest?.collections.map((item) => item.id).sort()).toEqual(['local-folder', 'remote-folder']);
    expect((await repository.listCollections()).map((item) => item.id)).toContain('remote-folder');
  });

  it('keeps local data and reports errors when WebDAV fails', async () => {
    const repository = new MemoryRepository();
    repository.metadata.autoSync = true;
    await repository.put(bookmark('local', 'Local'));
    const client = new MemoryClient();
    client.fail = true;
    const result = await new WebDavSyncEngine(repository, client).sync();
    expect(result.status).toBe('error');
    expect(repository.metadata.status).toBe('error');
    expect(repository.metadata.autoSync).toBe(false);
    expect(await repository.findById('local')).toBeTruthy();
  });

  it('creates a visible conflict when both sides changed since last sync', async () => {
    const repository = new MemoryRepository();
    repository.metadata.lastSyncAt = '2024-01-01T00:00:00.000Z';
    await repository.put(bookmark('same', 'Local', 2, '2024-01-02T00:00:00.000Z'));
    const client = new MemoryClient();
    client.snapshot.manifest = {
      format: 'lumamark-sync', schemaVersion: 1, generatedAt: '2024-01-02T00:00:00.000Z', deviceId: 'device-b',
      bookmarks: [bookmark('same', 'Remote', 2, '2024-01-03T00:00:00.000Z')], collections: [],
    };
    const result = await new WebDavSyncEngine(repository, client).sync();
    expect(result.status).toBe('conflict');
    expect(result.conflicts[0].bookmarkId).toBe('same');
    expect(repository.metadata.status).toBe('conflict');
  });

  it('keeps one unresolved conflict visible and resolves the remote choice', async () => {
    const repository = new MemoryRepository();
    repository.metadata.lastSyncAt = '2024-01-01T00:00:00.000Z';
    const local = bookmark('same', 'Local', 2, '2024-01-02T00:00:00.000Z');
    const remote = bookmark('same', 'Remote', 2, '2024-01-03T00:00:00.000Z');
    await repository.put(local);
    const client = new MemoryClient();
    client.snapshot.manifest = {
      format: 'lumamark-sync', schemaVersion: 1, generatedAt: '2024-01-02T00:00:00.000Z', deviceId: 'device-b',
      bookmarks: [remote], collections: [],
    };
    const engine = new WebDavSyncEngine(repository, client);
    const first = await engine.sync();
    expect(first.status).toBe('conflict');
    expect(repository.conflicts).toHaveLength(1);
    await engine.sync();
    expect(repository.conflicts).toHaveLength(1);

    const resolved = await engine.resolveConflict(repository.conflicts[0].id, 'remote');
    expect(resolved.resolution).toBe('remote');
    expect(resolved.resolvedAt).toBeTruthy();
    expect((await repository.findById('same'))?.title).toBe('Remote');
    expect((await repository.listConflicts()).find((item) => item.id === resolved.id)).toBeUndefined();
    expect(repository.metadata.status).toBe('idle');
    expect(repository.metadata.pendingChanges).toBe(0);
  });

  it('does not recreate a conflict after resolving the local choice', async () => {
    const repository = new MemoryRepository();
    repository.metadata.lastSyncAt = '2024-01-01T00:00:00.000Z';
    await repository.put(bookmark('same', 'Local', 2, '2024-01-02T00:00:00.000Z'));
    const client = new MemoryClient();
    client.snapshot.manifest = {
      format: 'lumamark-sync', schemaVersion: 1, generatedAt: '2024-01-02T00:00:00.000Z', deviceId: 'device-b',
      bookmarks: [bookmark('same', 'Remote', 2, '2024-01-03T00:00:00.000Z')], collections: [],
    };
    const engine = new WebDavSyncEngine(repository, client);
    await engine.sync();
    await engine.resolveConflict(repository.conflicts[0].id, 'local');
    const result = await engine.sync();
    expect(result.status).toBe('idle');
    expect(result.conflicts).toEqual([]);
    expect(client.snapshot.manifest?.bookmarks[0].title).toBe('Local');
  });

  it('keeps conflict status while other conflicts remain unresolved', async () => {
    const repository = new MemoryRepository();
    repository.metadata.lastSyncAt = '2024-01-01T00:00:00.000Z';
    await repository.put(bookmark('one', 'Local one', 2, '2024-01-02T00:00:00.000Z'));
    await repository.put(bookmark('two', 'Local two', 2, '2024-01-02T00:00:00.000Z'));
    const client = new MemoryClient();
    client.snapshot.manifest = {
      format: 'lumamark-sync', schemaVersion: 1, generatedAt: '2024-01-02T00:00:00.000Z', deviceId: 'device-b',
      bookmarks: [bookmark('one', 'Remote one', 2, '2024-01-03T00:00:00.000Z'), bookmark('two', 'Remote two', 2, '2024-01-03T00:00:00.000Z')],
      collections: [],
    };
    const engine = new WebDavSyncEngine(repository, client);
    const result = await engine.sync();
    expect(result.status).toBe('conflict');
    expect(repository.metadata.pendingChanges).toBe(2);
    await engine.resolveConflict(repository.conflicts[0].id, 'local');
    expect(repository.metadata.status).toBe('conflict');
    expect(repository.metadata.pendingChanges).toBe(1);
    expect((await repository.listConflicts()).length).toBe(1);
  });

  it('initializes a missing remote manifest on the first sync', async () => {
    const repository = new MemoryRepository();
    await repository.put(bookmark('local', 'Local'));
    const client = new MemoryClient();
    client.notFound = true;
    const result = await new WebDavSyncEngine(repository, client).sync();
    expect(result.status).toBe('idle');
    expect(client.snapshot.manifest?.format).toBe('lumamark-sync');
    expect(client.snapshot.manifest?.schemaVersion).toBe(2);
    expect(client.snapshot.manifest?.bookmarks.map((item) => item.id)).toEqual(['local']);
    expect(await repository.findById('local')).toBeTruthy();
  });

  it('converges edited and deleted collections by newer revision', async () => {
    const repository = new MemoryRepository();
    await repository.putCollection(collection('folder', 'Local name', 1));
    const client = new MemoryClient();
    client.snapshot.manifest = {
      format: 'lumamark-sync', schemaVersion: 1, generatedAt: '2024-01-03T00:00:00.000Z', deviceId: 'device-b',
      bookmarks: [],
      collections: [collection('folder', 'Remote name', 2, '2024-01-02T00:00:00.000Z')],
    };

    await new WebDavSyncEngine(repository, client).sync();
    expect((await repository.listCollections())[0].name).toBe('Remote name');
    expect(client.snapshot.manifest?.collections[0].name).toBe('Remote name');

    client.snapshot.manifest = {
      ...client.snapshot.manifest!,
      generatedAt: '2024-01-04T00:00:00.000Z',
      collections: [collection('folder', 'Remote name', 3, '2024-01-03T00:00:00.000Z', '2024-01-03T00:00:00.000Z')],
    };
    await new WebDavSyncEngine(repository, client).sync();
    expect((await repository.listCollections())[0].deletedAt).toBe('2024-01-03T00:00:00.000Z');
    expect(client.snapshot.manifest?.collections[0].deletedAt).toBe('2024-01-03T00:00:00.000Z');
  });

  it('reads schema 1 manifests that omit position and toolbar, then writes schema 2', async () => {
    const repository = new MemoryRepository();
    await repository.put(bookmark('local', 'Local'));
    const client = new MemoryClient();
    client.snapshot.manifest = {
      format: 'lumamark-sync',
      schemaVersion: 1,
      generatedAt: '2024-01-01T00:00:00.000Z',
      deviceId: 'device-b',
      bookmarks: [{
        id: 'remote',
        url: 'https://example.com/remote',
        title: 'Remote',
        domain: 'example.com',
        notes: '',
        tags: [],
        favorite: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        revision: 1,
      }],
      collections: [{
        id: 'remote-folder',
        name: 'Remote folder',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        revision: 1,
      }],
    } as unknown as SyncManifest;
    const result = await new WebDavSyncEngine(repository, client).sync();
    expect(result.status).toBe('idle');
    expect((await repository.list()).map((item) => item.id).sort()).toEqual(['local', 'remote']);
    expect((await repository.findById('remote'))?.position).toBe(0);
    expect((await repository.listCollections())[0]).toMatchObject({ id: 'remote-folder', name: 'Remote folder', position: 0, toolbar: false });
    expect(client.snapshot.manifest?.schemaVersion).toBe(2);
    expect(client.snapshot.manifest?.bookmarks).toHaveLength(2);
    expect(client.snapshot.manifest?.bookmarks.every((item) => item.position === 0)).toBe(true);
    expect(client.snapshot.manifest?.collections[0].toolbar).toBe(false);
  });

  it('keeps both sides of a position-only bookmark conflict until one is chosen', async () => {
    const repository = new MemoryRepository();
    repository.metadata.lastSyncAt = '2024-01-01T00:00:00.000Z';
    await repository.put(bookmark('same', 'Same', 2, '2024-01-02T00:00:00.000Z', 1));
    const client = new MemoryClient();
    client.snapshot.manifest = {
      format: 'lumamark-sync',
      schemaVersion: 2,
      generatedAt: '2024-01-03T00:00:00.000Z',
      deviceId: 'device-b',
      bookmarks: [bookmark('same', 'Same', 2, '2024-01-03T00:00:00.000Z', 5)],
      collections: [],
    };
    const engine = new WebDavSyncEngine(repository, client);
    const result = await engine.sync();
    expect(result.status).toBe('conflict');
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].local.position).toBe(1);
    expect(result.conflicts[0].remote.position).toBe(5);
    expect(result.conflicts[0].fields).toContain('position');
    expect((await repository.findById('same'))?.position).toBe(1);
    expect(client.snapshot.manifest?.bookmarks[0].position).toBe(5);
    await engine.resolveConflict(result.conflicts[0].id, 'remote');
    expect((await repository.findById('same'))?.position).toBe(5);
    expect((await repository.findById('same'))?.title).toBe('Same');
  });

  it('lets the newer folder record win toolbar and position', async () => {
    const repository = new MemoryRepository();
    await repository.putCollection(collection('folder', 'Folder', 1, '2024-01-01T00:00:00.000Z', undefined, { position: 1, toolbar: false }));
    const client = new MemoryClient();
    client.snapshot.manifest = {
      format: 'lumamark-sync',
      schemaVersion: 2,
      generatedAt: '2024-01-03T00:00:00.000Z',
      deviceId: 'device-b',
      bookmarks: [],
      collections: [collection('folder', 'Folder', 3, '2024-01-02T00:00:00.000Z', undefined, { position: 4, toolbar: true })],
    };
    await new WebDavSyncEngine(repository, client).sync();
    expect((await repository.listCollections())[0]).toMatchObject({ position: 4, toolbar: true, revision: 3 });
    expect(client.snapshot.manifest?.collections[0]).toMatchObject({ position: 4, toolbar: true });

    await repository.putCollection(collection('folder', 'Folder', 3, '2024-01-02T00:00:00.000Z', undefined, { position: 4, toolbar: true }));
    client.snapshot.manifest = {
      ...client.snapshot.manifest!,
      collections: [collection('folder', 'Folder', 3, '2024-01-04T00:00:00.000Z', undefined, { position: 8, toolbar: false })],
    };
    await new WebDavSyncEngine(repository, client).sync();
    expect((await repository.listCollections())[0]).toMatchObject({ position: 8, toolbar: false });
    expect(client.snapshot.manifest?.collections[0]).toMatchObject({ position: 8, toolbar: false });
  });

  it('propagates bookmark and folder tombstones so the other side stays deleted', async () => {
    const repository = new MemoryRepository();
    repository.metadata.lastSyncAt = '2024-01-01T00:00:00.000Z';
    await repository.put({ ...bookmark('gone', 'Gone', 2, '2024-01-02T00:00:00.000Z'), deletedAt: '2024-01-02T00:00:00.000Z' });
    await repository.putCollection(collection('gone-folder', 'Gone folder', 2, '2024-01-02T00:00:00.000Z', '2024-01-02T00:00:00.000Z'));
    const client = new MemoryClient();
    client.snapshot.manifest = {
      format: 'lumamark-sync',
      schemaVersion: 2,
      generatedAt: '2024-01-01T00:00:00.000Z',
      deviceId: 'device-b',
      bookmarks: [bookmark('gone', 'Gone', 1, '2024-01-01T00:00:00.000Z')],
      collections: [collection('gone-folder', 'Gone folder', 1, '2024-01-01T00:00:00.000Z')],
    };
    const result = await new WebDavSyncEngine(repository, client).sync();
    expect(result.status).toBe('idle');
    expect(client.snapshot.manifest?.schemaVersion).toBe(2);
    expect(client.snapshot.manifest?.bookmarks[0].deletedAt).toBe('2024-01-02T00:00:00.000Z');
    expect(client.snapshot.manifest?.collections[0].deletedAt).toBe('2024-01-02T00:00:00.000Z');

    const other = new MemoryRepository();
    other.metadata.lastSyncAt = '2024-01-01T00:00:00.000Z';
    await other.put(bookmark('gone', 'Gone', 1, '2024-01-01T00:00:00.000Z'));
    await other.putCollection(collection('gone-folder', 'Gone folder', 1, '2024-01-01T00:00:00.000Z'));
    const follow = new MemoryClient();
    follow.snapshot = { manifest: client.snapshot.manifest, etag: client.snapshot.etag };
    await new WebDavSyncEngine(other, follow).sync();
    expect((await other.findById('gone'))?.deletedAt).toBe('2024-01-02T00:00:00.000Z');
    expect((await other.listCollections())[0].deletedAt).toBe('2024-01-02T00:00:00.000Z');
    expect((await other.findById('gone'))?.title).toBe('Gone');
  });
});

