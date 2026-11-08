import {
  applyBookmarkUpdate,
  applyCollectionUpdate,
  type Bookmark,
  type Collection,
  type ConflictField,
  conflictFields,
  CURRENT_SCHEMA_VERSION,
  domainFromUrl,
  isSeparator,
  makeBookmark,
  migrateBookmark,
  migrateCollection,
  normalizeBookmarkUrl,
  urlKey,
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

export type SortField = 'updatedAt' | 'createdAt' | 'title' | 'domain';
export type SortDirection = 'asc' | 'desc';

export interface BookmarkFilter {
  query: string;
  favoritesOnly: boolean;
  trash: boolean;
  scope?: 'all' | 'favorites' | 'recent' | 'unfiled' | 'duplicates' | 'trash' | 'folder' | 'tag';
  folderId?: string;
  tag?: string;
  domain?: string;
  sort?: SortField;
  direction?: SortDirection;
  now?: number;
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

const textOrder = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const RECENT_DAYS = 30;

export interface FolderTreeNode {
  id: string;
  name: string;
  path: string;
  parentId?: string;
  directCount: number;
  totalCount: number;
  children: FolderTreeNode[];
}

export interface ScopeCounts {
  all: number;
  favorites: number;
  recent: number;
  unfiled: number;
  duplicates: number;
  trash: number;
}

export function isHttpBookmarkUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

export function tileHueFor(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 360;
}

export function titleInitialFor(title: string, url = ''): string {
  const source = (title || domainFromUrl(url) || url).trim();
  const match = source.match(/[\p{L}\p{N}]/u);
  return (match ? match[0] : '★').toUpperCase();
}

export function formatRelativeTime(iso: string | undefined, nowMs = Date.now()): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const diffSec = Math.max(0, Math.floor((nowMs - time) / 1000));
  if (diffSec < 60) return '刚刚';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} 天前`;
  return iso.slice(0, 10);
}

export function liveBookmarksOf(model: LibraryModel): Bookmark[] {
  const gone = new Set(model.purged);
  return model.bookmarks.filter((bookmark) => !bookmark.deletedAt && !bookmark.purgedAt && !gone.has(bookmark.id) && !isSeparator(bookmark));
}

export function trashedBookmarksOf(model: LibraryModel): Bookmark[] {
  const gone = new Set(model.purged);
  return model.bookmarks.filter((bookmark) => Boolean(bookmark.deletedAt) && !bookmark.purgedAt && !gone.has(bookmark.id) && !isSeparator(bookmark));
}

export function aliveFolderIdsOf(collections: readonly Collection[]): Set<string> {
  return new Set(collections.filter((collection) => !collection.deletedAt).map((collection) => collection.id));
}

export function scopeCountsOf(model: LibraryModel, nowMs = Date.now()): ScopeCounts {
  const live = liveBookmarksOf(model);
  const trashed = trashedBookmarksOf(model);
  const aliveFolders = aliveFolderIdsOf(model.collections);
  const since = new Date(nowMs - RECENT_DAYS * 86_400_000).toISOString();
  return {
    all: live.length,
    favorites: live.filter((item) => item.favorite).length,
    recent: live.filter((item) => item.createdAt >= since).length,
    unfiled: live.filter((item) => !item.collectionId || !aliveFolders.has(item.collectionId)).length,
    duplicates: extraDuplicateIdsOf(model).length,
    trash: trashed.length,
  };
}

export function folderTreeOf(model: LibraryModel): FolderTreeNode[] {
  const alive = model.collections.filter((item) => !item.deletedAt);
  const aliveIds = new Set(alive.map((item) => item.id));
  const directCounts = new Map<string, number>();
  for (const bookmark of liveBookmarksOf(model)) {
    if (bookmark.collectionId && aliveIds.has(bookmark.collectionId)) {
      directCounts.set(bookmark.collectionId, (directCounts.get(bookmark.collectionId) ?? 0) + 1);
    }
  }
  const byParent = new Map<string | undefined, Collection[]>();
  for (const folder of alive) {
    const parentKey = folder.parentId && aliveIds.has(folder.parentId) ? folder.parentId : undefined;
    const list = byParent.get(parentKey);
    if (list) list.push(folder);
    else byParent.set(parentKey, [folder]);
  }
  for (const list of byParent.values()) {
    list.sort((left, right) => (left.position - right.position) || textOrder.compare(left.name, right.name));
  }
  const visited = new Set<string>();
  const build = (parentId: string | undefined, prefix: string): FolderTreeNode[] => {
    const items = byParent.get(parentId) ?? [];
    const nodes: FolderTreeNode[] = [];
    for (const item of items) {
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      const path = prefix ? `${prefix} / ${item.name}` : item.name;
      const children = build(item.id, path);
      const directCount = directCounts.get(item.id) ?? 0;
      const totalCount = directCount + children.reduce((sum, child) => sum + child.totalCount, 0);
      nodes.push({
        id: item.id,
        name: item.name,
        path,
        parentId: item.parentId && aliveIds.has(item.parentId) ? item.parentId : undefined,
        directCount,
        totalCount,
        children,
      });
    }
    return nodes;
  };
  return build(undefined, '');
}

export function folderPathsOf(model: LibraryModel): string[] {
  const paths: string[] = [];
  const walk = (nodes: readonly FolderTreeNode[]) => {
    for (const node of nodes) {
      paths.push(node.path);
      walk(node.children);
    }
  };
  walk(folderTreeOf(model));
  return paths;
}

export function tagCountsOf(model: LibraryModel): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const bookmark of liveBookmarksOf(model)) {
    for (const raw of bookmark.tags) {
      const tag = raw.trim();
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => (right.count - left.count) || textOrder.compare(left.name, right.name));
}

export function domainCountsOf(model: LibraryModel): Array<{ domain: string; count: number }> {
  const counts = new Map<string, number>();
  for (const bookmark of liveBookmarksOf(model)) {
    const domain = bookmark.domain?.trim();
    if (!domain) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((left, right) => (right.count - left.count) || textOrder.compare(left.domain, right.domain));
}

export function duplicateGroupsOf(bookmarks: readonly Bookmark[]): Bookmark[][] {
  const groups = new Map<string, Bookmark[]>();
  for (const bookmark of bookmarks) {
    if (bookmark.deletedAt || bookmark.purgedAt || isSeparator(bookmark)) continue;
    const key = urlKey(bookmark.url);
    const group = groups.get(key);
    if (group) group.push(bookmark);
    else groups.set(key, [bookmark]);
  }
  return [...groups.values()].filter((group) => group.length > 1).sort((left, right) => right.length - left.length);
}

const keepScore = (bookmark: Bookmark) => (bookmark.favorite ? 4 : 0) + (bookmark.notes ? 2 : 0) + (bookmark.tags.length ? 1 : 0);

export function extraDuplicateIdsOf(model: LibraryModel): string[] {
  const alive = aliveFolderIdsOf(model.collections);
  const groups = duplicateGroupsOf(liveBookmarksOf(model));
  return groups.flatMap((group) => {
    const ordered = [...group].sort((left, right) => keepScore(right) - keepScore(left)
      || Number(Boolean(right.collectionId && alive.has(right.collectionId))) - Number(Boolean(left.collectionId && alive.has(left.collectionId)))
      || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
    return ordered.slice(1).map((bookmark) => bookmark.id);
  });
}

export function cleanDuplicatesInLibrary(model: LibraryModel, now: string): { model: LibraryModel; removed: number } {
  const ids = new Set(extraDuplicateIdsOf(model));
  if (!ids.size) return { model, removed: 0 };
  const bookmarks = model.bookmarks.map((bookmark) => (ids.has(bookmark.id) && !bookmark.deletedAt
    ? { ...bookmark, deletedAt: now, updatedAt: now, revision: bookmark.revision + 1 }
    : bookmark));
  return { model: { ...model, bookmarks }, removed: ids.size };
}

export function visibleBookmarks(model: LibraryModel, filter: BookmarkFilter): Bookmark[] {
  const gone = new Set(model.purged);
  const query = filter.query.trim().toLowerCase();
  const aliveFolders = aliveFolderIdsOf(model.collections);
  const isTrash = filter.trash || filter.scope === 'trash';

  let candidates = model.bookmarks.filter((bookmark) => {
    if (bookmark.purgedAt || gone.has(bookmark.id) || isSeparator(bookmark)) return false;
    if (Boolean(bookmark.deletedAt) !== isTrash) return false;
    return true;
  });

  if (!isTrash) {
    if (filter.scope === 'favorites') {
      candidates = candidates.filter((bookmark) => bookmark.favorite);
    } else if (filter.scope === 'recent') {
      const since = new Date((filter.now ?? Date.now()) - RECENT_DAYS * 86_400_000).toISOString();
      candidates = candidates.filter((bookmark) => bookmark.createdAt >= since);
    } else if (filter.scope === 'unfiled') {
      candidates = candidates.filter((bookmark) => !bookmark.collectionId || !aliveFolders.has(bookmark.collectionId));
    } else if (filter.scope === 'duplicates') {
      const dupIds = new Set(duplicateGroupsOf(candidates).flat().map((item) => item.id));
      candidates = candidates.filter((bookmark) => dupIds.has(bookmark.id));
    } else if (filter.scope === 'folder' && filter.folderId) {
      candidates = candidates.filter((bookmark) => bookmark.collectionId === filter.folderId);
    } else if (filter.scope === 'tag' && filter.tag) {
      const tagLower = filter.tag.toLowerCase();
      candidates = candidates.filter((bookmark) => bookmark.tags.some((t) => t.toLowerCase() === tagLower));
    }
  }

  const filtered = candidates.filter((bookmark) => {
    if (filter.favoritesOnly && !bookmark.favorite) return false;
    if (filter.domain && bookmark.domain.toLowerCase() !== filter.domain.toLowerCase()) return false;
    if (query) {
      const folder = folderPathName(model, bookmark.collectionId).toLowerCase();
      const haystack = [bookmark.title, bookmark.url, bookmark.domain, bookmark.notes, folder, ...bookmark.tags].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  if (filter.sort) {
    const field = filter.sort;
    const dir = filter.direction === 'asc' ? 1 : -1;
    filtered.sort((left, right) => {
      const a = String(left[field] ?? '');
      const b = String(right[field] ?? '');
      const cmp = field === 'title' || field === 'domain' ? textOrder.compare(a, b) : a < b ? -1 : a > b ? 1 : 0;
      return cmp * dir;
    });
  } else if (filter.scope === 'duplicates') {
    filtered.sort((left, right) => urlKey(left.url).localeCompare(urlKey(right.url)));
  }

  return filtered;
}

export function folderName(model: LibraryModel, collectionId: string | undefined): string {
  if (!collectionId) return '';
  return model.collections.find((collection) => collection.id === collectionId && !collection.deletedAt)?.name
    ?? model.collections.find((collection) => collection.id === collectionId)?.name
    ?? '';
}

export function folderPathName(model: LibraryModel, collectionId: string | undefined): string {
  if (!collectionId) return '';
  const byId = new Map(model.collections.filter((item) => !item.deletedAt).map((item) => [item.id, item]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(collectionId) ?? model.collections.find((item) => item.id === collectionId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join(' / ');
}

export function folderFor(model: LibraryModel, name: string | undefined, now: string): { model: LibraryModel; collectionId?: string } {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) return { model, collectionId: undefined };
  const parts = trimmed.split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { model, collectionId: undefined };
  if (parts.length === 1) {
    const single = parts[0];
    const topMatch = model.collections.find((collection) => !collection.deletedAt && !collection.parentId && collection.name === single);
    if (topMatch) return { model, collectionId: topMatch.id };
    const anyMatch = model.collections.find((collection) => !collection.deletedAt && collection.name === single);
    if (anyMatch) return { model, collectionId: anyMatch.id };
  }
  let nextModel = model;
  let parentId: string | undefined;
  for (const part of parts) {
    const existing = nextModel.collections.find((collection) => !collection.deletedAt && (collection.parentId ?? undefined) === parentId && collection.name === part);
    if (existing) {
      parentId = existing.id;
      continue;
    }
    const collection: Collection = {
      id: crypto.randomUUID(),
      name: part,
      parentId,
      position: nextModel.collections.filter((item) => !item.deletedAt && (item.parentId ?? undefined) === parentId).length,
      toolbar: false,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    nextModel = { ...nextModel, collections: [...nextModel.collections, collection] };
    parentId = collection.id;
  }
  return { model: nextModel, collectionId: parentId };
}

export function createCollectionInLibrary(model: LibraryModel, name: string, parentId: string | undefined, now: string): LibraryModel {
  const trimmed = name.trim();
  if (!trimmed) return model;
  const existing = model.collections.find((item) => !item.deletedAt && (item.parentId ?? undefined) === parentId && item.name === trimmed);
  if (existing) return model;
  const collection: Collection = {
    id: crypto.randomUUID(),
    name: trimmed,
    parentId,
    position: model.collections.filter((item) => !item.deletedAt && (item.parentId ?? undefined) === parentId).length,
    toolbar: false,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
  return { ...model, collections: [...model.collections, collection] };
}

export function renameCollectionInLibrary(model: LibraryModel, id: string, name: string, now: string): LibraryModel {
  const trimmed = name.trim();
  if (!trimmed) return model;
  const current = model.collections.find((item) => item.id === id && !item.deletedAt);
  if (!current) return model;
  const updated = applyCollectionUpdate(current, { name: trimmed }, now);
  return { ...model, collections: model.collections.map((item) => item.id === id ? updated : item) };
}

export function deleteCollectionInLibrary(model: LibraryModel, id: string, now: string): LibraryModel {
  const descendants = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of model.collections) {
      if (!item.deletedAt && item.parentId && descendants.has(item.parentId) && !descendants.has(item.id)) {
        descendants.add(item.id);
        grew = true;
      }
    }
  }
  const collections = model.collections.map((item) => (descendants.has(item.id) && !item.deletedAt
    ? { ...item, deletedAt: now, updatedAt: now, revision: item.revision + 1 }
    : item));
  const bookmarks = model.bookmarks.map((bookmark) => (bookmark.collectionId && descendants.has(bookmark.collectionId) && !bookmark.deletedAt
    ? applyBookmarkUpdate(bookmark, { collectionId: null }, now)
    : bookmark));
  return { ...model, collections, bookmarks };
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

export function deleteBookmarksBatch(model: LibraryModel, ids: readonly string[], now: string): LibraryModel {
  const target = new Set(ids);
  const bookmarks = model.bookmarks.map((bookmark) => {
    if (!target.has(bookmark.id) || bookmark.deletedAt || bookmark.purgedAt || model.purged.includes(bookmark.id)) return bookmark;
    return { ...bookmark, deletedAt: now, updatedAt: now, revision: bookmark.revision + 1 };
  });
  return { ...model, bookmarks };
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

export function restoreBookmarksBatch(model: LibraryModel, ids: readonly string[], now: string): LibraryModel {
  const target = new Set(ids);
  const bookmarks = model.bookmarks.map((bookmark) => {
    if (!target.has(bookmark.id) || !bookmark.deletedAt || bookmark.purgedAt || model.purged.includes(bookmark.id)) return bookmark;
    const restored: Bookmark = { ...bookmark, updatedAt: now, revision: bookmark.revision + 1 };
    delete restored.deletedAt;
    return restored;
  });
  return { ...model, bookmarks };
}

export function purgeBookmarksBatch(model: LibraryModel, ids: readonly string[]): LibraryModel {
  const target = new Set(ids);
  const purged = new Set(model.purged);
  const bookmarks: Bookmark[] = [];
  for (const bookmark of model.bookmarks) {
    if (target.has(bookmark.id)) purged.add(bookmark.id);
    else bookmarks.push(bookmark);
  }
  return { ...model, bookmarks, purged: [...purged].sort() };
}

export function moveBookmarksBatch(model: LibraryModel, ids: readonly string[], folder: string, now: string): LibraryModel {
  const ensured = folderFor(model, folder, now);
  const target = new Set(ids);
  const bookmarks = ensured.model.bookmarks.map((bookmark) => {
    if (!target.has(bookmark.id) || bookmark.deletedAt || bookmark.purgedAt) return bookmark;
    if ((bookmark.collectionId ?? undefined) === ensured.collectionId) return bookmark;
    return applyBookmarkUpdate(bookmark, { collectionId: ensured.collectionId ?? null }, now);
  });
  return { ...ensured.model, bookmarks };
}

export function favoriteBookmarksBatch(model: LibraryModel, ids: readonly string[], favorite: boolean, now: string): LibraryModel {
  const target = new Set(ids);
  const bookmarks = model.bookmarks.map((bookmark) => {
    if (!target.has(bookmark.id) || bookmark.deletedAt || bookmark.purgedAt || bookmark.favorite === favorite) return bookmark;
    return applyBookmarkUpdate(bookmark, { favorite }, now);
  });
  return { ...model, bookmarks };
}

export function tagBookmarksBatch(model: LibraryModel, ids: readonly string[], addTags: readonly string[], removeTags: readonly string[], now: string): LibraryModel {
  const target = new Set(ids);
  const dropped = new Set(removeTags.map((t) => t.toLowerCase()));
  const added = addTags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  const bookmarks = model.bookmarks.map((bookmark) => {
    if (!target.has(bookmark.id) || bookmark.deletedAt || bookmark.purgedAt) return bookmark;
    const nextTags = [...new Set([...bookmark.tags.filter((t) => !dropped.has(t.toLowerCase())), ...added])].sort();
    if (nextTags.join('\n') === [...bookmark.tags].sort().join('\n')) return bookmark;
    return applyBookmarkUpdate(bookmark, { tags: nextTags }, now);
  });
  return { ...model, bookmarks };
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
