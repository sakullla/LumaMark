import {
  applyBookmarkUpdate,
  type Bookmark,
  type Collection,
  type ConflictField,
  conflictFields,
  CURRENT_SCHEMA_VERSION,
  domainFromUrl,
  makeBookmark,
  migrateBookmark,
  migrateCollection,
  normalizeBookmarkUrl,
} from '../../../packages/domain/src/index';
import {
  exportLumaMarkJson,
  parseBookmarksHtml,
  parseLumaMarkJson,
  planImport,
  type DuplicateImportAction,
  type ImportResult,
} from '../../../packages/import-export/src/index';
import { compactSyncManifest, expandSyncBookmarks, type SyncManifest } from '../../../packages/sync/src/index';

export interface LibraryModel {
  deviceId: string;
  bookmarks: Bookmark[];
  collections: Collection[];
  purged: string[];
}

export interface BookmarkInput {
  title?: string;
  url: string;
  folder?: string;
  tags?: string[];
  notes?: string;
  favorite?: boolean;
}

export interface BookmarkPatch {
  title?: string;
  url?: string;
  folder?: string;
  tags?: string[];
  notes?: string;
  favorite?: boolean;
}

export interface BookmarkFilter {
  query: string;
  favoritesOnly: boolean;
  trash: boolean;
}

export interface TitleConflict {
  bookmarkId: string;
  localTitle: string;
  remoteTitle: string;
  fields: ConflictField[];
  local: Bookmark;
  remote: Bookmark;
}

export type ConflictKeep = 'local' | 'remote' | 'merged';

export interface ConflictChoice {
  keep: ConflictKeep;
  bookmark?: Bookmark;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
}

export function libraryFromManifest(manifest: SyncManifest): LibraryModel {
  const purged = [...new Set((manifest.purged ?? []).filter((id) => id.length > 0))].sort();
  const gone = new Set(purged);
  const bookmarks = expandSyncBookmarks(manifest.bookmarks ?? [], purged)
    .filter((bookmark) => !bookmark.purgedAt && !gone.has(bookmark.id))
    .map((bookmark) => ({ ...migrateBookmark(bookmark), tags: [...bookmark.tags] }));
  return {
    deviceId: manifest.deviceId,
    bookmarks,
    collections: (manifest.collections ?? []).map((collection) => ({ ...migrateCollection(collection) })),
    purged,
  };
}

export function manifestFromLibrary(model: LibraryModel, now: string): SyncManifest {
  const gone = new Set(model.purged);
  return compactSyncManifest({
    format: 'lumamark-sync',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    generatedAt: now,
    deviceId: model.deviceId || 'lumamark-web',
    bookmarks: model.bookmarks.filter((bookmark) => !bookmark.purgedAt && !gone.has(bookmark.id)),
    collections: model.collections,
    purged: [...gone].sort(),
  });
}

export function librarySignature(model: LibraryModel): string {
  const bookmarks = [...model.bookmarks].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const collections = [...model.collections].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return JSON.stringify({ bookmarks, collections, purged: [...model.purged].sort() });
}

export function visibleBookmarks(model: LibraryModel, filter: BookmarkFilter): Bookmark[] {
  const gone = new Set(model.purged);
  const query = filter.query.trim().toLowerCase();
  return model.bookmarks.filter((bookmark) => {
    if (bookmark.purgedAt || gone.has(bookmark.id)) return false;
    if (Boolean(bookmark.deletedAt) !== filter.trash) return false;
    if (filter.favoritesOnly && !bookmark.favorite) return false;
    if (query && !bookmark.title.toLowerCase().includes(query)) return false;
    return true;
  });
}

export function folderName(model: LibraryModel, collectionId: string | undefined): string {
  if (!collectionId) return '';
  return model.collections.find((collection) => collection.id === collectionId)?.name ?? '';
}

export function folderFor(model: LibraryModel, name: string | undefined, now: string): { model: LibraryModel; collectionId?: string } {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) return { model, collectionId: undefined };
  const existing = model.collections.find((collection) => !collection.deletedAt && !collection.parentId && collection.name === trimmed);
  if (existing) return { model, collectionId: existing.id };
  const collection: Collection = {
    id: crypto.randomUUID(),
    name: trimmed,
    position: model.collections.filter((item) => !item.parentId).length,
    toolbar: false,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
  return { model: { ...model, collections: [...model.collections, collection] }, collectionId: collection.id };
}

export function addBookmark(model: LibraryModel, input: BookmarkInput, now: string): LibraryModel {
  const ensured = folderFor(model, input.folder, now);
  const bookmark = makeBookmark({
    url: input.url,
    title: input.title,
    notes: input.notes,
    tags: input.tags,
    favorite: input.favorite,
    collectionId: ensured.collectionId,
    position: ensured.model.bookmarks.filter((item) => !item.deletedAt && item.collectionId === ensured.collectionId).length,
  }, now);
  if (ensured.model.purged.includes(bookmark.id)) throw new Error('清空后不能再恢复');
  return { ...ensured.model, bookmarks: [...ensured.model.bookmarks, bookmark] };
}

export function updateBookmark(model: LibraryModel, id: string, patch: BookmarkPatch, now: string): LibraryModel {
  const current = model.bookmarks.find((bookmark) => bookmark.id === id);
  if (!current || current.purgedAt || model.purged.includes(id)) throw new Error('Bookmark not found');
  if (current.deletedAt) throw new Error('Bookmark is in trash');
  const ensured = patch.folder === undefined ? { model, collectionId: current.collectionId } : folderFor(model, patch.folder, now);
  let updated = applyBookmarkUpdate(current, {
    title: patch.title,
    notes: patch.notes,
    tags: patch.tags,
    favorite: patch.favorite,
    collectionId: patch.folder === undefined ? undefined : ensured.collectionId ?? null,
  }, now);
  if (patch.url !== undefined) {
    const url = normalizeBookmarkUrl(patch.url);
    updated = { ...updated, url, domain: domainFromUrl(url) };
  }
  return {
    ...ensured.model,
    bookmarks: ensured.model.bookmarks.map((bookmark) => bookmark.id === id ? updated : bookmark),
  };
}

export function deleteBookmark(model: LibraryModel, id: string, now: string): LibraryModel {
  const current = model.bookmarks.find((bookmark) => bookmark.id === id);
  if (!current || current.purgedAt || model.purged.includes(id)) throw new Error('Bookmark not found');
  if (current.deletedAt) throw new Error('Bookmark is in trash');
  const deleted: Bookmark = { ...current, deletedAt: now, updatedAt: now, revision: current.revision + 1 };
  return { ...model, bookmarks: model.bookmarks.map((bookmark) => bookmark.id === id ? deleted : bookmark) };
}

export function restoreBookmark(model: LibraryModel, id: string, now: string): LibraryModel {
  if (model.purged.includes(id)) throw new Error('清空后不能再恢复');
  const current = model.bookmarks.find((bookmark) => bookmark.id === id);
  if (!current || current.purgedAt) throw new Error('清空后不能再恢复');
  if (!current.deletedAt) throw new Error('Bookmark is not in trash');
  const restored: Bookmark = { ...current, updatedAt: now, revision: current.revision + 1 };
  delete restored.deletedAt;
  return { ...model, bookmarks: model.bookmarks.map((bookmark) => bookmark.id === id ? restored : bookmark) };
}

export function emptyTrash(model: LibraryModel): LibraryModel {
  const purged = new Set(model.purged);
  const bookmarks: Bookmark[] = [];
  for (const bookmark of model.bookmarks) {
    if (bookmark.deletedAt || bookmark.purgedAt) purged.add(bookmark.id);
    else bookmarks.push(bookmark);
  }
  return { ...model, bookmarks, purged: [...purged].sort() };
}

export function parseImport(text: string, format: 'html' | 'json'): ImportResult {
  return format === 'html' ? parseBookmarksHtml(text) : parseLumaMarkJson(text);
}

export function countDuplicateImports(model: LibraryModel, parsed: ImportResult): number {
  const existing = model.bookmarks.filter((bookmark) => !bookmark.purgedAt && !model.purged.includes(bookmark.id));
  return planImport(parsed, existing, 'skip').issues.filter((issue) => issue.kind === 'duplicate').length;
}

function collectionsFor(bookmarks: readonly Bookmark[], available: readonly Collection[], existing: readonly Collection[]): Collection[] {
  const byId = new Map(available.map((collection) => [collection.id, collection]));
  const have = new Set(existing.map((collection) => collection.id));
  const extra: Collection[] = [];
  const seen = new Set<string>();
  for (const bookmark of bookmarks) {
    let current = bookmark.collectionId;
    const guard = new Set<string>();
    while (current && !guard.has(current)) {
      guard.add(current);
      if (!have.has(current) && !seen.has(current)) {
        const collection = byId.get(current);
        if (collection) {
          extra.push({ ...collection });
          seen.add(current);
        }
      }
      current = byId.get(current)?.parentId;
    }
  }
  return extra;
}

function purgeKnown(model: LibraryModel, ids: readonly string[]): LibraryModel {
  const purged = new Set(model.purged);
  let bookmarks = model.bookmarks;
  for (const id of ids) {
    if (!bookmarks.some((bookmark) => bookmark.id === id) && !purged.has(id)) continue;
    purged.add(id);
    bookmarks = bookmarks.filter((bookmark) => bookmark.id !== id);
  }
  return { ...model, bookmarks, purged: [...purged].sort() };
}

export function applyImport(model: LibraryModel, parsed: ImportResult, action: DuplicateImportAction, now: string): LibraryModel {
  const existing = model.bookmarks.filter((bookmark) => !bookmark.purgedAt && !model.purged.includes(bookmark.id));
  const plan = planImport(parsed, existing, action);
  const referenced = plan.entries.map((entry) => entry.action === 'update' && entry.existing
    ? { ...entry.existing, collectionId: entry.bookmark.collectionId }
    : entry.bookmark);
  const collections = [...model.collections, ...collectionsFor(referenced, parsed.collections, model.collections)];
  const bookmarks = [...model.bookmarks];
  for (const entry of plan.entries) {
    if (entry.action === 'update' && entry.existing) {
      const index = bookmarks.findIndex((bookmark) => bookmark.id === entry.existing?.id);
      if (index < 0) continue;
      bookmarks[index] = applyBookmarkUpdate(bookmarks[index], {
        title: entry.bookmark.title,
        notes: entry.bookmark.notes,
        tags: entry.bookmark.tags,
        favorite: entry.bookmark.favorite,
        collectionId: entry.bookmark.collectionId ?? null,
        position: entry.bookmark.position,
        faviconUrl: entry.bookmark.faviconUrl,
      }, now);
      continue;
    }
    if (model.purged.includes(entry.bookmark.id) || bookmarks.some((bookmark) => bookmark.id === entry.bookmark.id)) continue;
    bookmarks.push(entry.bookmark);
  }
  return purgeKnown({ ...model, bookmarks, collections }, parsed.purgedIds);
}

export function exportJson(model: LibraryModel, now: string): string {
  const gone = new Set(model.purged);
  const bookmarks = model.bookmarks.filter((bookmark) => !bookmark.purgedAt && !gone.has(bookmark.id));
  return exportLumaMarkJson(bookmarks, model.collections, now);
}

export function exportHtml(model: LibraryModel): string {
  const gone = new Set(model.purged);
  const collections = model.collections.filter((collection) => !collection.deletedAt);
  const bookmarks = model.bookmarks.filter((bookmark) => !bookmark.deletedAt && !bookmark.purgedAt && !gone.has(bookmark.id));
  const children = (parentId: string | undefined): string => {
    let html = '';
    for (const folder of collections.filter((collection) => (collection.parentId ?? undefined) === parentId)) {
      const toolbar = folder.toolbar ? ' PERSONAL_TOOLBAR_FOLDER="true"' : '';
      html += `<DT><H3${toolbar}>${escapeHtml(folder.name)}</H3>\n<DL><p>\n${children(folder.id)}</DL><p>\n`;
    }
    for (const bookmark of bookmarks.filter((bookmark) => (bookmark.collectionId ?? undefined) === parentId)) {
      html += `<DT><A HREF="${escapeHtml(bookmark.url)}">${escapeHtml(bookmark.title)}</A>\n`;
    }
    return html;
  };
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${children(undefined)}</DL><p>\n`;
}

function collectionMap(local: LibraryModel, remote: LibraryModel): Map<string, Collection> {
  const collections = new Map<string, Collection>();
  for (const collection of [...local.collections, ...remote.collections]) collections.set(collection.id, collection);
  return collections;
}

export function titleConflicts(local: LibraryModel, remote: LibraryModel): TitleConflict[] {
  const remoteById = new Map(remote.bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const collections = collectionMap(local, remote);
  const conflicts: TitleConflict[] = [];
  for (const bookmark of local.bookmarks) {
    const other = remoteById.get(bookmark.id);
    if (!other) continue;
    const fields = conflictFields(bookmark, other, { collections });
    if (!fields.length) continue;
    conflicts.push({
      bookmarkId: bookmark.id,
      localTitle: bookmark.title,
      remoteTitle: other.title,
      fields: [...fields],
      local: bookmark,
      remote: other,
    });
  }
  return conflicts;
}

export function mergeTitleChoices(
  local: LibraryModel,
  remote: LibraryModel,
  choices: ReadonlyMap<string, ConflictChoice>,
  now: string,
): LibraryModel {
  const conflicts = titleConflicts(local, remote);
  if (conflicts.some((conflict) => !choices.has(conflict.bookmarkId))) throw new Error('未选择要保留的版本');
  const chosenIds = new Set(conflicts.map((conflict) => conflict.bookmarkId));
  const localById = new Map(local.bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const remoteById = new Map(remote.bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const remotePurged = new Set(remote.purged);
  const purged = new Set([...local.purged, ...remote.purged]);
  const bookmarks: Bookmark[] = [];
  for (const id of new Set([...localById.keys(), ...remoteById.keys()])) {
    if (remotePurged.has(id)) {
      purged.add(id);
      continue;
    }
    const left = localById.get(id);
    const right = remoteById.get(id);
    if (left && right && chosenIds.has(id)) {
      const choice = choices.get(id);
      const chosen = choice?.keep === 'remote' ? right : choice?.keep === 'merged' ? choice.bookmark : left;
      if (!choice || !chosen || chosen.id !== id) throw new Error('合并需要这条书签');
      bookmarks.push({
        ...chosen,
        id,
        tags: [...chosen.tags],
        updatedAt: now,
        revision: Math.max(left.revision, right.revision, chosen.revision) + 1,
      });
      continue;
    }
    if (left && right) {
      const winner = left.revision > right.revision || (left.revision === right.revision && left.updatedAt >= right.updatedAt) ? left : right;
      bookmarks.push({ ...winner, tags: [...winner.tags] });
      continue;
    }
    const only = left ?? right;
    if (only) bookmarks.push({ ...only, tags: [...only.tags] });
  }
  const collections = new Map<string, Collection>();
  for (const collection of [...remote.collections, ...local.collections]) {
    const previous = collections.get(collection.id);
    if (!previous || collection.revision >= previous.revision) collections.set(collection.id, { ...collection });
  }
  return {
    deviceId: remote.deviceId || local.deviceId,
    bookmarks: bookmarks.filter((bookmark) => !purged.has(bookmark.id) && !bookmark.purgedAt),
    collections: [...collections.values()],
    purged: [...purged].sort(),
  };
}
