import {
  Bookmark,
  BookmarkRepository,
  ConflictRecord,
  Collection,
  conflictFields,
  CURRENT_SCHEMA_VERSION,
  hasBookmarkConflict,
  migrateBookmark,
  migrateCollection,
  SyncMetadata,
  urlKey,
} from '../../domain/src/index';

export { conflictFields, hasBookmarkConflict };

export interface SyncManifest {
  format: 'lumamark-sync';
  schemaVersion: 1 | typeof CURRENT_SCHEMA_VERSION;
  generatedAt: string;
  deviceId: string;
  bookmarks: Bookmark[];
  collections: Collection[];
  /**
   * Bookmark ids emptied from Trash. The id stays so another device cannot
   * upload the old title, URL, or notes again. Content stays in local storage.
   */
  purged?: string[];
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
  /** A concurrent remote write can be retried without turning auto sync off. */
  retryable?: boolean;
  lastSyncAt?: string;
}

export type ConflictResolution = 'local' | 'remote' | 'merged';

function preconditionFailed(error: unknown): boolean {
  return (error as { status?: number } | undefined)?.status === 412
    || (error instanceof Error && error.message === 'WebDAV write failed (412)');
}

function bookmarkSignature(bookmark: Bookmark): string {
  const item = migrateBookmark(bookmark);
  // Permanent deletes match on id alone. A compact remote id and the local
  // content-free record are the same delete, so sync does not rewrite them.
  if (item.purgedAt) return JSON.stringify([item.id, 'purged']);
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
    item.purgedAt ?? null,
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

function newerBookmark(left: Bookmark, right: Bookmark, collections?: ReadonlyMap<string, Collection>): Bookmark {
  const normalizedLeft = migrateBookmark(left);
  const normalizedRight = migrateBookmark(right);
  if (normalizedLeft.purgedAt || normalizedRight.purgedAt) {
    return (normalizedRight.purgedAt ?? '') > (normalizedLeft.purgedAt ?? '') ? normalizedRight : normalizedLeft;
  }
  if (Boolean(normalizedLeft.deletedAt) !== Boolean(normalizedRight.deletedAt)) {
    return normalizedLeft.deletedAt ? normalizedLeft : normalizedRight;
  }
  let winner: Bookmark;
  if (normalizedRight.revision !== normalizedLeft.revision) {
    winner = normalizedRight.revision > normalizedLeft.revision ? normalizedRight : normalizedLeft;
  } else if (normalizedRight.updatedAt !== normalizedLeft.updatedAt) {
    winner = normalizedRight.updatedAt > normalizedLeft.updatedAt ? normalizedRight : normalizedLeft;
  } else {
    winner = bookmarkSignature(normalizedRight) > bookmarkSignature(normalizedLeft) ? normalizedRight : normalizedLeft;
  }
  const other = winner === normalizedLeft ? normalizedRight : normalizedLeft;
  if (collections && winner.collectionId && other.collectionId && winner.collectionId !== other.collectionId) {
    const winnerFolder = collections.get(winner.collectionId);
    const otherFolder = collections.get(other.collectionId);
    if (winnerFolder?.deletedAt && otherFolder && !otherFolder.deletedAt) {
      return { ...winner, collectionId: other.collectionId };
    }
  }
  return winner;
}

export async function pruneNonConflicts(repository: SyncRepository): Promise<ConflictRecord[]> {
  const openConflicts = await repository.listConflicts();
  if (!openConflicts.length) return [];
  const active: ConflictRecord[] = [];
  let pruned = false;
  const resolvedAt = new Date().toISOString();
  for (const conflict of openConflicts) {
    const fields = conflictFields(conflict.local, conflict.remote);
    if (!fields.length) {
      pruned = true;
      await repository.putConflict({ ...conflict, resolvedAt, resolution: 'merged' });
      continue;
    }
    active.push(JSON.stringify(conflict.fields) === JSON.stringify(fields) ? conflict : { ...conflict, fields });
  }
  if (pruned) {
    const metadata = await repository.getSyncMetadata();
    await repository.setSyncMetadata({
      ...metadata,
      status: active.length ? 'conflict' : metadata.status === 'conflict' ? 'idle' : metadata.status,
      pendingChanges: active.length,
      error: active.length ? metadata.error : undefined,
    });
  }
  return active;
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

/** Bookmark id list, ignoring blanks and duplicates. */
function sortedPurgedIds(ids: readonly string[] | undefined): string[] {
  return [...new Set((ids ?? []).filter((id) => typeof id === 'string' && id))].sort();
}

function purgedBookmark(id: string, purgedAt: string): Bookmark {
  return {
    id,
    url: 'https://deleted.invalid/',
    title: '',
    domain: '',
    notes: '',
    tags: [],
    favorite: false,
    position: 0,
    createdAt: purgedAt,
    updatedAt: purgedAt,
    deletedAt: purgedAt,
    purgedAt,
    revision: 1,
  };
}

/**
 * Rebuild permanent deletes from a compact id list. An inline tombstone is kept
 * as-is so an older file still merges. A live record with the same id loses.
 */
export function expandSyncBookmarks(bookmarks: readonly Bookmark[] = [], purged: readonly string[] = []): Bookmark[] {
  const byId = new Map<string, Bookmark>();
  for (const item of bookmarks) {
    if (item?.id) byId.set(item.id, migrateBookmark(item));
  }
  for (const id of sortedPurgedIds(purged)) {
    const existing = byId.get(id);
    if (existing?.purgedAt) continue;
    byId.set(id, purgedBookmark(id, existing?.updatedAt || '1970-01-01T00:00:00.000Z'));
  }
  return [...byId.values()];
}

/** Move permanent deletes out of `bookmarks` so the file keeps ids, not contents. */
export function compactSyncManifest(manifest: SyncManifest): SyncManifest {
  const bookmarks: Bookmark[] = [];
  const purged: string[] = [...(manifest.purged ?? [])];
  for (const item of manifest.bookmarks) {
    if (item.purgedAt) purged.push(item.id);
    else bookmarks.push(item);
  }
  const ids = sortedPurgedIds(purged);
  const next: SyncManifest = { ...manifest, bookmarks };
  if (ids.length) next.purged = ids;
  else delete next.purged;
  return next;
}

function encodingMatches(remote: SyncManifest | undefined, compacted: SyncManifest): boolean {
  if (!remote || remote.schemaVersion !== CURRENT_SCHEMA_VERSION) return false;
  if (remote.bookmarks.some((item) => item.purgedAt)) return false;
  const left = sortedPurgedIds(remote.purged);
  const right = sortedPurgedIds(compacted.purged);
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function conflictIndexes(conflicts: readonly ConflictRecord[]): {
  unresolvedByBookmark: Map<string, ConflictRecord>;
  resolvedByBookmark: Map<string, ConflictRecord>;
} {
  const unresolvedByBookmark = new Map<string, ConflictRecord>();
  const resolvedByBookmark = new Map<string, ConflictRecord>();
  for (const conflict of conflicts) {
    if (!conflict.resolvedAt) {
      unresolvedByBookmark.set(conflict.bookmarkId, conflict);
      continue;
    }
    const previous = resolvedByBookmark.get(conflict.bookmarkId);
    if (!previous || conflict.resolvedAt >= (previous.resolvedAt ?? '')) {
      resolvedByBookmark.set(conflict.bookmarkId, conflict);
    }
  }
  return { unresolvedByBookmark, resolvedByBookmark };
}

export class WebDavSyncEngine {
  public constructor(
    private readonly repository: SyncRepository,
    private readonly client: WebDavClient,
  ) {}

  /** Resolve one persisted conflict and leave the next sync to publish the choice. */
  async resolveConflict(conflictId: string, resolution: ConflictResolution, merged?: Bookmark): Promise<ConflictRecord> {
    const [resolved] = await this.resolveConflicts([{ id: conflictId, resolution, merged }]);
    return resolved;
  }

  /** Resolve one or more persisted conflicts in a single batch and update sync metadata. */
  async resolveConflicts(
    entries: ReadonlyArray<{ id: string; resolution: ConflictResolution; merged?: Bookmark }>,
  ): Promise<ConflictRecord[]> {
    if (!entries.length) return [];
    const openConflicts = await this.repository.listConflicts();
    const byId = new Map(openConflicts.map((item) => [item.id, item]));
    const planned = entries.map((entry) => {
      const conflict = byId.get(entry.id);
      if (!conflict) throw new Error('Conflict not found');
      const chosen = entry.resolution === 'local' ? conflict.local : entry.resolution === 'remote' ? conflict.remote : entry.merged;
      if (!chosen || chosen.id !== conflict.bookmarkId) throw new Error('Merged bookmark is required for this conflict');
      return { conflict, chosen, resolution: entry.resolution };
    });

    const resolvedAt = new Date().toISOString();
    const results: ConflictRecord[] = [];
    for (const { conflict, chosen, resolution } of planned) {
      // Lift the choice above both revisions so the next sync can publish it.
      // Do not move lastSyncAt: that baseline still covers every unresolved edit.
      const selected: Bookmark = {
        ...chosen,
        updatedAt: resolvedAt,
        revision: Math.max(conflict.local.revision, conflict.remote.revision, chosen.revision) + 1,
      };
      await this.repository.put(selected);
      const resolved: ConflictRecord = { ...conflict, resolvedAt, resolution };
      await this.repository.putConflict(resolved);
      results.push(resolved);
    }
    const remainingConflicts = await pruneNonConflicts(this.repository);
    const metadata = await this.repository.getSyncMetadata();
    await this.repository.setSyncMetadata({
      ...metadata,
      status: remainingConflicts.length ? 'conflict' : 'idle',
      pendingChanges: remainingConflicts.length,
      error: undefined,
    });
    return results;
  }

  async sync(): Promise<SyncResult> {
    const before = await this.repository.getSyncMetadata();
    const syncing: SyncMetadata = { ...before, status: 'syncing', error: undefined };
    await this.repository.setSyncMetadata(syncing);
    return this.syncAttempt(before, 0);
  }

  private async syncAttempt(before: SyncMetadata, attempt: number): Promise<SyncResult> {
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
      const remote = expandSyncBookmarks(remoteSnapshot.manifest?.bookmarks ?? [], remoteSnapshot.manifest?.purged ?? []);
      const remoteCollections = (remoteSnapshot.manifest?.collections ?? []).map((item) => migrateCollection(item));
      const byId = new Map(local.map((item) => [item.id, item]));
      const remoteById = new Map(remote.map((item) => [item.id, item]));
      const merged = new Map<string, Bookmark>();
      const conflicts: ConflictRecord[] = [];
      const pendingBookmarks: Bookmark[] = [];
      const pendingCollections: Collection[] = [];
      const { unresolvedByBookmark, resolvedByBookmark } = conflictIndexes(await this.repository.listConflicts(true));
      const ids = new Set([...byId.keys(), ...remoteById.keys()]);
      const mergedCollections = new Map<string, Collection>(localCollections.map((item) => [item.id, item]));
      for (const collection of remoteCollections) {
        const localCollection = mergedCollections.get(collection.id);
        if (!localCollection) {
          mergedCollections.set(collection.id, collection);
          pendingCollections.push(collection);
          continue;
        }
        if (equalCollection(localCollection, collection)) continue;

        // Collection conflicts use the same monotonic revision/tombstone rule as
        // bookmarks. The newer version wins so edits and deletes converge even
        // though ConflictRecord currently models bookmark fields only.
        const selected = newerCollection(localCollection, collection);
        mergedCollections.set(collection.id, selected);
        if (selected !== localCollection) pendingCollections.push(selected);
      }

      const liveIdsByFolderUrl = new Map<string, Set<string>>();
      for (const id of ids) {
        const localItem = byId.get(id);
        const remoteItem = remoteById.get(id);
        const liveCandidate = (!localItem?.deletedAt && !remoteItem?.deletedAt) ? (localItem ?? remoteItem) : undefined;
        if (!liveCandidate) continue;
        const key = `${liveCandidate.collectionId ?? ''}::${urlKey(liveCandidate.url)}`;
        let group = liveIdsByFolderUrl.get(key);
        if (!group) {
          group = new Set<string>();
          liveIdsByFolderUrl.set(key, group);
        }
        group.add(id);
      }
      const liveSameUrlKeysFor = (id: string): Set<string> => {
        const keys = new Set<string>();
        for (const [key, group] of liveIdsByFolderUrl) {
          if (group.size > 1 || (group.size === 1 && !group.has(id))) keys.add(key);
        }
        return keys;
      };

      for (const id of ids) {
        const localItem = byId.get(id);
        const remoteItem = remoteById.get(id);
        const unresolved = unresolvedByBookmark.get(id);
        if (!localItem && remoteItem) {
          merged.set(id, remoteItem);
          pendingBookmarks.push(remoteItem);
          continue;
        }
        if (localItem && !remoteItem) {
          merged.set(id, localItem);
          continue;
        }
        if (!localItem || !remoteItem) continue;
        if (equalBookmark(localItem, remoteItem)) {
          if (unresolved) {
            await this.repository.putConflict({ ...unresolved, resolvedAt: new Date().toISOString(), resolution: 'merged' });
          }
          merged.set(id, localItem);
          continue;
        }

        const fields = conflictFields(localItem, remoteItem, {
          collections: mergedCollections,
          liveSameUrlKeys: liveSameUrlKeysFor(id),
        });
        if (!fields.length) {
          if (unresolved) {
            await this.repository.putConflict({ ...unresolved, resolvedAt: new Date().toISOString(), resolution: 'merged' });
          }
          const selected = newerBookmark(localItem, remoteItem, mergedCollections);
          merged.set(id, selected);
          if (!equalBookmark(selected, localItem)) pendingBookmarks.push(selected);
          continue;
        }

        const localChanged = changedSince(localItem, before.lastSyncAt);
        const remoteChanged = changedSince(remoteItem, before.lastSyncAt);
        const resolved = resolvedByBookmark.get(id);
        // The stored remote snapshot is the version already considered. A matching
        // remote is the choice waiting to be published, not a new conflict.
        const remoteMatchesResolved = resolved !== undefined && equalBookmark(remoteItem, resolved.remote);
        if (unresolved || (localChanged && remoteChanged && !remoteMatchesResolved)) {
          if (unresolved) {
            const nextConflict: ConflictRecord = JSON.stringify(unresolved.fields) === JSON.stringify(fields)
              ? unresolved
              : { ...unresolved, fields };
            if (nextConflict !== unresolved) await this.repository.putConflict(nextConflict);
            conflicts.push(nextConflict);
            merged.set(id, localItem);
            continue;
          }
          const conflict: ConflictRecord = {
            id: crypto.randomUUID(),
            bookmarkId: id,
            local: localItem,
            remote: remoteItem,
            fields,
            createdAt: new Date().toISOString(),
          };
          conflicts.push(conflict);
          await this.repository.putConflict(conflict);
          merged.set(id, localItem);
        } else if (localItem.revision >= remoteItem.revision) {
          merged.set(id, localItem);
        } else {
          merged.set(id, remoteItem);
          pendingBookmarks.push(remoteItem);
        }
      }

      const now = new Date().toISOString();
      const manifest = compactSyncManifest(manifestFor(
        before.deviceId,
        [...merged.values()].map((item) => migrateBookmark(item)),
        [...mergedCollections.values()].map((item) => migrateCollection(item)),
        now,
      ));
      // A rejected WebDAV write must not change local titles or deletedAt.
      const persistAdopted = async (): Promise<void> => {
        for (const item of pendingCollections) await this.repository.putCollection(item);
        for (const item of pendingBookmarks) await this.repository.put(item);
      };
      if (!conflicts.length) {
        const remoteAlreadyMatches = remoteSnapshot.manifest?.schemaVersion === CURRENT_SCHEMA_VERSION
          && !pendingBookmarks.length && !pendingCollections.length
          && remote.length === merged.size && remoteCollections.length === mergedCollections.size
          && remote.every((item) => equalBookmark(item, merged.get(item.id)!))
          && remoteCollections.every((item) => equalCollection(item, mergedCollections.get(item.id)!))
          && encodingMatches(remoteSnapshot.manifest, manifest);
        if (!remoteAlreadyMatches) await this.client.write(manifest, remoteSnapshot.etag);
        await persistAdopted();
        const metadata: SyncMetadata = {
          ...before,
          status: 'idle',
          lastSyncAt: now,
          pendingChanges: 0,
          error: undefined,
        };
        await this.repository.setSyncMetadata(metadata);
        return { status: 'idle', mergedCount: merged.size, conflicts: [], lastSyncAt: now };
      }

      // Bookmark conflicts are not published. Unrelated remote records still converge locally.
      await persistAdopted();
      await this.repository.setSyncMetadata({
        ...before,
        status: 'conflict',
        pendingChanges: conflicts.length,
        error: undefined,
      });
      return { status: 'conflict', mergedCount: merged.size, conflicts };
    } catch (error) {
      const retryable = preconditionFailed(error);
      // Rebuild the merge from a fresh snapshot and ETag. Never resend the old
      // manifest or remove its precondition: that could overwrite another device.
      if (retryable && attempt < 2) return this.syncAttempt(before, attempt + 1);
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.setSyncMetadata({
        ...before,
        status: 'error',
        autoSync: retryable ? before.autoSync : false,
        error: message,
      });
      return { status: 'error', mergedCount: 0, conflicts: [], error: message, retryable };
    }
  }
}

