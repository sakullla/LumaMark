import {
  Bookmark,
  BookmarkRepository,
  ConflictRecord,
  Collection,
  CURRENT_SCHEMA_VERSION,
  migrateBookmark,
  migrateCollection,
  SyncMetadata,
} from '../../domain/src/index';

export interface SyncManifest {
  format: 'lumamark-sync';
  schemaVersion: 1 | typeof CURRENT_SCHEMA_VERSION;
  generatedAt: string;
  deviceId: string;
  bookmarks: Bookmark[];
  collections: Collection[];
}

export interface RemoteSnapshot {
  manifest?: SyncManifest;
  etag?: string;
}

export interface WebDavClient {
  read(): Promise<RemoteSnapshot>;
  write(manifest: SyncManifest, etag?: string): Promise<{ etag?: string }>;
}

export interface SyncRepository extends BookmarkRepository {
  listCollections: () => Promise<Collection[]>;
  putCollection: (collection: Collection) => Promise<void>;
  getSyncMetadata(): Promise<SyncMetadata>;
  setSyncMetadata(metadata: SyncMetadata): Promise<void>;
  putConflict(conflict: ConflictRecord): Promise<void>;
  listConflicts(includeResolved?: boolean): Promise<ConflictRecord[]>;
}

export interface SyncResult {
  status: 'idle' | 'conflict' | 'error';
  mergedCount: number;
  conflicts: ConflictRecord[];
  error?: string;
  lastSyncAt?: string;
}

export type ConflictResolution = 'local' | 'remote' | 'merged';

function bookmarkSignature(bookmark: Bookmark): string {
  const item = migrateBookmark(bookmark);
  return JSON.stringify([
    item.id,
    item.url,
    item.title,
    item.domain,
    item.faviconUrl ?? null,
    item.notes,
    item.tags,
    item.collectionId ?? null,
    item.position,
    item.favorite,
    item.createdAt,
    item.updatedAt,
    item.deletedAt ?? null,
    item.revision,
  ]);
}

function equalBookmark(left: Bookmark, right: Bookmark): boolean {
  return bookmarkSignature(left) === bookmarkSignature(right);
}

function changedSince(bookmark: Bookmark, lastSyncAt?: string): boolean {
  return !lastSyncAt || bookmark.updatedAt > lastSyncAt;
}

function collectionSignature(collection: Collection): string {
  const item = migrateCollection(collection);
  return JSON.stringify([
    item.id,
    item.name,
    item.parentId ?? null,
    item.position,
    item.toolbar,
    item.createdAt,
    item.updatedAt,
    item.deletedAt ?? null,
    item.revision,
  ]);
}

function equalCollection(left: Collection, right: Collection): boolean {
  return collectionSignature(left) === collectionSignature(right);
}

function newerCollection(left: Collection, right: Collection): Collection {
  const normalizedLeft = migrateCollection(left);
  const normalizedRight = migrateCollection(right);
  if (normalizedRight.revision !== normalizedLeft.revision) return normalizedRight.revision > normalizedLeft.revision ? normalizedRight : normalizedLeft;
  if (normalizedRight.updatedAt !== normalizedLeft.updatedAt) return normalizedRight.updatedAt > normalizedLeft.updatedAt ? normalizedRight : normalizedLeft;
  // Deterministic tie-breaker keeps both devices convergent when clocks collide.
  return collectionSignature(normalizedRight) > collectionSignature(normalizedLeft) ? normalizedRight : normalizedLeft;
}

function manifestFor(deviceId: string, bookmarks: Bookmark[], collections: Collection[], now = new Date().toISOString()): SyncManifest {
  return {
    format: 'lumamark-sync',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    generatedAt: now,
    deviceId,
    bookmarks,
    collections,
  };
}

export class WebDavSyncEngine {
  public constructor(
    private readonly repository: SyncRepository,
    private readonly client: WebDavClient,
  ) {}

  /** Resolve one persisted conflict and leave the next sync to publish the choice. */
  async resolveConflict(conflictId: string, resolution: ConflictResolution, merged?: Bookmark): Promise<ConflictRecord> {
    const conflict = (await this.repository.listConflicts()).find((item) => item.id === conflictId);
    if (!conflict) throw new Error('Conflict not found');
    const selected = resolution === 'local' ? conflict.local : resolution === 'remote' ? conflict.remote : merged;
    if (!selected || selected.id !== conflict.bookmarkId) throw new Error('Merged bookmark is required for this conflict');
    await this.repository.put(selected);
    const resolvedAt = new Date().toISOString();
    const syncBaseline = [resolvedAt, conflict.local.updatedAt, conflict.remote.updatedAt, selected.updatedAt].sort().at(-1)!;
    const resolved: ConflictRecord = { ...conflict, resolvedAt, resolution };
    await this.repository.putConflict(resolved);
    const remainingConflicts = await this.repository.listConflicts();
    const metadata = await this.repository.getSyncMetadata();
    await this.repository.setSyncMetadata({
      ...metadata,
      status: remainingConflicts.length ? 'conflict' : 'idle',
      // Establish a new sync baseline so the selected version is not
      // considered a second simultaneous edit on the next sync.
      lastSyncAt: syncBaseline,
      pendingChanges: remainingConflicts.length,
      error: undefined,
    });
    return resolved;
  }

  async sync(): Promise<SyncResult> {
    const before = await this.repository.getSyncMetadata();
    const syncing: SyncMetadata = { ...before, status: 'syncing', error: undefined };
    await this.repository.setSyncMetadata(syncing);
    try {
      const local = (await this.repository.list({ includeDeleted: true })).map((item) => migrateBookmark(item));
      const localCollections = (await this.repository.listCollections()).map((item) => migrateCollection(item));
      let remoteSnapshot: RemoteSnapshot;
      try {
        remoteSnapshot = await this.client.read();
      } catch (error) {
        // A missing WebDAV resource is the normal first-sync state. Treat it
        // as an empty remote manifest so local data can initialize the file.
        const status = (error as { status?: number }).status;
        const message = error instanceof Error ? error.message : String(error);
        if (status !== 404 && !/\b404\b|not found/i.test(message)) throw error;
        remoteSnapshot = {};
      }
      const remote = (remoteSnapshot.manifest?.bookmarks ?? []).map((item) => migrateBookmark(item));
      const remoteCollections = (remoteSnapshot.manifest?.collections ?? []).map((item) => migrateCollection(item));
      const byId = new Map(local.map((item) => [item.id, item]));
      const remoteById = new Map(remote.map((item) => [item.id, item]));
      const merged = new Map<string, Bookmark>();
      const conflicts: ConflictRecord[] = [];
      const unresolvedByBookmark = new Map((await this.repository.listConflicts()).map((item) => [item.bookmarkId, item]));
      const ids = new Set([...byId.keys(), ...remoteById.keys()]);
      const mergedCollections = new Map<string, Collection>(localCollections.map((item) => [item.id, item]));
      for (const collection of remoteCollections) {
        const localCollection = mergedCollections.get(collection.id);
        if (!localCollection) {
          mergedCollections.set(collection.id, collection);
          await this.repository.putCollection(collection);
          continue;
        }
        if (equalCollection(localCollection, collection)) continue;

        // Collection conflicts use the same monotonic revision/tombstone rule as
        // bookmarks. The newer version wins so edits and deletes converge even
        // though ConflictRecord currently models bookmark fields only.
        const selected = newerCollection(localCollection, collection);
        mergedCollections.set(collection.id, selected);
        if (selected !== localCollection) {
          await this.repository.putCollection(selected);
        }
      }

      for (const id of ids) {
        const localItem = byId.get(id);
        const remoteItem = remoteById.get(id);
        if (!localItem && remoteItem) {
          merged.set(id, remoteItem);
          await this.repository.put(remoteItem);
          continue;
        }
        if (localItem && !remoteItem) {
          merged.set(id, localItem);
          continue;
        }
        if (!localItem || !remoteItem) continue;
        if (equalBookmark(localItem, remoteItem)) {
          merged.set(id, localItem);
          continue;
        }

        const localChanged = changedSince(localItem, before.lastSyncAt);
        const remoteChanged = changedSince(remoteItem, before.lastSyncAt);
        if (localChanged && remoteChanged) {
          const existingConflict = unresolvedByBookmark.get(id);
          if (existingConflict) {
            conflicts.push(existingConflict);
            merged.set(id, localItem);
            continue;
          }
          const conflict: ConflictRecord = {
            id: crypto.randomUUID(),
            bookmarkId: id,
            local: localItem,
            remote: remoteItem,
            fields: ['url', 'title', 'notes', 'tags', 'collectionId', 'position', 'favorite', 'deletedAt'],
            createdAt: new Date().toISOString(),
          };
          conflicts.push(conflict);
          await this.repository.putConflict(conflict);
          merged.set(id, localItem);
        } else if (localItem.revision >= remoteItem.revision) {
          merged.set(id, localItem);
        } else {
          merged.set(id, remoteItem);
          await this.repository.put(remoteItem);
        }
      }

      const now = new Date().toISOString();
      const manifest = manifestFor(
        before.deviceId,
        [...merged.values()].map((item) => migrateBookmark(item)),
        [...mergedCollections.values()].map((item) => migrateCollection(item)),
        now,
      );
      if (!conflicts.length) {
        const written = await this.client.write(manifest, remoteSnapshot.etag);
        const metadata: SyncMetadata = {
          ...before,
          status: 'idle',
          lastSyncAt: now,
          pendingChanges: 0,
          error: undefined,
        };
        await this.repository.setSyncMetadata(metadata);
        return { status: 'idle', mergedCount: merged.size, conflicts: [], lastSyncAt: written.etag ? now : now };
      }

      await this.repository.setSyncMetadata({
        ...before,
        status: 'conflict',
        pendingChanges: conflicts.length,
        error: undefined,
      });
      return { status: 'conflict', mergedCount: merged.size, conflicts };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.setSyncMetadata({
        ...before,
        status: 'error',
        autoSync: false,
        error: message,
      });
      return { status: 'error', mergedCount: 0, conflicts: [], error: message };
    }
  }
}

