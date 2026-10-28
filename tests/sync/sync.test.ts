import { describe, expect, it } from 'vitest';
import { Bookmark, BookmarkRepository, Collection, SyncMetadata } from '../../packages/domain/src/index';
import { SyncRepository, SyncManifest, WebDavClient, WebDavSyncEngine } from '../../packages/sync/src/index';

function bookmark(id: string, title: string, revision = 1, updatedAt = '2024-01-01T00:00:00.000Z'): Bookmark {
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
  async putConflict(value: any): Promise<void> { this.conflicts.push(value); }
  async listConflicts(): Promise<any[]> { return this.conflicts; }
}

class MemoryClient implements WebDavClient {
  public snapshot: { manifest?: SyncManifest; etag?: string } = {};
  public fail = false;
  async read() { if (this.fail) throw new Error('network unavailable'); return this.snapshot; }
  async write(manifest: SyncManifest, etag?: string) { if (this.fail) throw new Error('remote is read-only'); this.snapshot = { manifest, etag: etag ?? 'etag-1' }; return { etag: 'etag-2' }; }
}

describe('WebDavSyncEngine', () => {
  const collection = (id: string, name: string): Collection => ({
    id, name, position: 0, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', revision: 1,
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
});

