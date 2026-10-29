import {
  applyBookmarkUpdate,
  applyCollectionUpdate,
  Bookmark,
  Collection,
  migrateBookmark,
  migrateCollection,
  orderedSiblings,
} from '../../../../packages/domain/src/index';

export interface PlaceRepository {
  list(query?: { includeDeleted?: boolean }): Promise<Bookmark[]>;
  put(bookmark: Bookmark): Promise<void>;
  listCollections(): Promise<Collection[]>;
  putCollection(collection: Collection): Promise<void>;
}

export interface PlaceMove {
  kind: 'bookmark' | 'folder';
  id: string;
  parentId?: string;
  beforeId?: string;
}

function containsFolder(collections: readonly Collection[], ancestorId: string, maybeChildId: string): boolean {
  let current: string | undefined = maybeChildId;
  const seen = new Set<string>();
  while (current) {
    if (current === ancestorId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = collections.find((collection) => collection.id === current)?.parentId;
  }
  return false;
}

/** Reorder siblings or move a bookmark/folder. Only changed records gain a revision. */
export async function placeItem(repository: PlaceRepository, move: PlaceMove): Promise<void> {
  const bookmarks = (await repository.list({ includeDeleted: true })).map((bookmark) => migrateBookmark(bookmark));
  const collections = (await repository.listCollections()).map((collection) => migrateCollection(collection));
  const bookmarkOriginals = new Map(bookmarks.map((bookmark) => [bookmark.id, { ...bookmark }]));
  const collectionOriginals = new Map(collections.map((collection) => [collection.id, { ...collection }]));
  const parentId = move.parentId || undefined;

  if (move.kind === 'folder') {
    const moving = collections.find((collection) => collection.id === move.id && !collection.deletedAt);
    if (!moving) throw new Error('Folder not found');
    if (parentId && containsFolder(collections, move.id, parentId)) throw new Error('Cannot move a folder into itself');
    moving.parentId = parentId;
  } else {
    const moving = bookmarks.find((bookmark) => bookmark.id === move.id && !bookmark.deletedAt);
    if (!moving) throw new Error('Bookmark not found');
    moving.collectionId = parentId;
  }

  const siblings = orderedSiblings(parentId, bookmarks, collections);
  const currentIndex = siblings.findIndex((item) => item.record.id === move.id);
  if (currentIndex < 0) throw new Error('Item is not in the destination folder');
  const [moved] = siblings.splice(currentIndex, 1);
  let insertAt = siblings.length;
  if (move.beforeId) {
    const beforeIndex = siblings.findIndex((item) => item.record.id === move.beforeId);
    if (beforeIndex >= 0) insertAt = beforeIndex;
  }
  siblings.splice(insertAt, 0, moved!);

  for (let index = 0; index < siblings.length; index += 1) {
    const entry = siblings[index];
    if (entry.kind === 'bookmark') {
      const original = bookmarkOriginals.get(entry.record.id);
      if (!original) continue;
      const nextParent = entry.record.id === move.id && move.kind === 'bookmark' ? parentId : original.collectionId;
      if (original.position === index && (original.collectionId ?? undefined) === (nextParent ?? undefined)) continue;
      await repository.put(applyBookmarkUpdate(original, { position: index, collectionId: nextParent ?? null }));
    } else {
      const original = collectionOriginals.get(entry.record.id);
      if (!original) continue;
      const nextParent = entry.record.id === move.id && move.kind === 'folder' ? parentId : original.parentId;
      if (original.position === index && (original.parentId ?? undefined) === (nextParent ?? undefined)) continue;
      await repository.putCollection(applyCollectionUpdate(original, { position: index, parentId: nextParent ?? null }));
    }
  }
}
