export const CURRENT_SCHEMA_VERSION = 2 as const;

export type BookmarkId = string;
export type CollectionId = string;

export interface Bookmark {
  id: BookmarkId;
  url: string;
  title: string;
  domain: string;
  faviconUrl?: string;
  notes: string;
  tags: string[];
  collectionId?: CollectionId;
  position: number;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  revision: number;
}

export interface Collection {
  id: CollectionId;
  name: string;
  parentId?: CollectionId;
  position: number;
  toolbar: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  revision: number;
}

export interface SyncMetadata {
  key: 'sync';
  deviceId: string;
  lastSyncAt?: string;
  pendingChanges: number;
  status: 'idle' | 'syncing' | 'error' | 'conflict' | 'offline';
  error?: string;
  autoSync: boolean;
}

export interface SyncConfig {
  key: 'sync-config';
  url: string;
  path: string;
  username?: string;
  password?: string;
  autoSync: boolean;
}

export interface ConflictRecord {
  id: string;
  bookmarkId: BookmarkId;
  local: Bookmark;
  remote: Bookmark;
  fields: string[];
  createdAt: string;
  resolvedAt?: string;
  resolution?: 'local' | 'remote' | 'merged';
}

export interface LumaMarkExport {
  format: 'lumamark';
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  exportedAt: string;
  bookmarks: Bookmark[];
  collections: Collection[];
}

export interface CreateBookmarkInput {
  url: string;
  title?: string;
  faviconUrl?: string;
  notes?: string;
  tags?: string[];
  collectionId?: CollectionId;
  position?: number;
  favorite?: boolean;
  id?: BookmarkId;
}

export interface UpdateBookmarkInput {
  title?: string;
  notes?: string;
  tags?: string[];
  collectionId?: CollectionId | null;
  position?: number;
  favorite?: boolean;
  faviconUrl?: string;
}

export interface UpdateCollectionInput {
  name?: string;
  parentId?: CollectionId | null;
  position?: number;
  toolbar?: boolean;
}

export interface BookmarkQuery {
  text?: string;
  collectionId?: CollectionId;
  tag?: string;
  domain?: string;
  from?: string;
  to?: string;
  includeDeleted?: boolean;
  favorite?: boolean;
  sort?: 'createdAt' | 'updatedAt' | 'title' | 'domain';
  direction?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

export type DuplicateAction = 'existing' | 'update' | 'copy';

export interface ExistingBookmarkResult {
  kind: 'existing';
  existing: Bookmark;
}

export interface SavedBookmarkResult {
  kind: 'saved';
  bookmark: Bookmark;
  undoToken: string;
}

export type SaveBookmarkResult = ExistingBookmarkResult | SavedBookmarkResult;

export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('URL is required');
  const parsed = new URL(trimmed);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http(s) URLs can be saved');
  }
  return parsed.toString();
}

export function domainFromUrl(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return value;
  }
}

export function defaultTitleForUrl(value: string): string {
  return domainFromUrl(value) || value;
}

export function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();
}

export function validateBookmark(value: unknown): asserts value is Bookmark {
  if (!value || typeof value !== 'object') throw new Error('Invalid bookmark');
  const item = value as Partial<Bookmark>;
  if (typeof item.id !== 'string' || typeof item.url !== 'string' || typeof item.title !== 'string') {
    throw new Error('Invalid bookmark fields');
  }
  normalizeUrl(item.url);
  if (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== 'string')) {
    throw new Error('Invalid bookmark tags');
  }
  if (typeof item.position !== 'number' || !Number.isFinite(item.position)) throw new Error('Invalid bookmark position');
  if (typeof item.revision !== 'number' || item.revision < 1) throw new Error('Invalid bookmark revision');
}

export function isReadableSchemaVersion(value: unknown): value is 1 | typeof CURRENT_SCHEMA_VERSION {
  return value === 1 || value === CURRENT_SCHEMA_VERSION;
}

export function validateExport(value: unknown): asserts value is LumaMarkExport {
  if (!value || typeof value !== 'object') throw new Error('Invalid LumaMark export');
  const item = value as Partial<LumaMarkExport>;
  if (item.format !== 'lumamark' || item.schemaVersion !== CURRENT_SCHEMA_VERSION || !Array.isArray(item.bookmarks) || !Array.isArray(item.collections)) {
    throw new Error('Unsupported LumaMark export schema');
  }
  item.bookmarks.forEach(validateBookmark);
}

/** Accept schema 1 or 2. Missing order defaults to 0 and missing toolbar defaults to false. */
export function migrateExport(value: unknown): LumaMarkExport {
  if (!value || typeof value !== 'object') throw new Error('Invalid LumaMark export');
  const item = value as Partial<LumaMarkExport>;
  if (item.format !== 'lumamark' || !isReadableSchemaVersion(item.schemaVersion) || !Array.isArray(item.bookmarks) || !Array.isArray(item.collections)) {
    throw new Error('Unsupported LumaMark export schema');
  }
  const bookmarks = item.bookmarks.map((entry) => migrateBookmark(entry as Bookmark));
  bookmarks.forEach(validateBookmark);
  return {
    format: 'lumamark',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: typeof item.exportedAt === 'string' ? item.exportedAt : new Date().toISOString(),
    bookmarks,
    collections: item.collections.map((entry) => migrateCollection(entry as Collection)),
  };
}

export function migrateBookmark<T extends Partial<Bookmark>>(value: T): T & Pick<Bookmark, 'position'> {
  const position = typeof value?.position === 'number' && Number.isFinite(value.position) ? value.position : 0;
  if (value?.position === position) return value as T & Pick<Bookmark, 'position'>;
  return { ...value, position };
}

export function migrateCollection<T extends Partial<Collection>>(value: T): T & Pick<Collection, 'position' | 'toolbar'> {
  const position = typeof value?.position === 'number' && Number.isFinite(value.position) ? value.position : 0;
  const toolbar = value?.toolbar === true;
  if (value?.position === position && value?.toolbar === toolbar) return value as T & Pick<Collection, 'position' | 'toolbar'>;
  return { ...value, position, toolbar };
}

export function makeBookmark(input: CreateBookmarkInput, now = new Date().toISOString()): Bookmark {
  const url = normalizeUrl(input.url);
  return {
    id: input.id ?? crypto.randomUUID(),
    url,
    title: input.title?.trim() || defaultTitleForUrl(url),
    domain: domainFromUrl(url),
    faviconUrl: input.faviconUrl,
    notes: input.notes?.trim() ?? '',
    tags: normalizeTags(input.tags),
    collectionId: input.collectionId,
    position: input.position ?? 0,
    favorite: input.favorite ?? false,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
}

export function applyBookmarkUpdate(bookmark: Bookmark, update: UpdateBookmarkInput, now = new Date().toISOString()): Bookmark {
  const collectionId = update.collectionId === undefined ? bookmark.collectionId : update.collectionId ?? undefined;
  const position = update.position === undefined ? migrateBookmark(bookmark).position : update.position;
  return {
    ...bookmark,
    title: update.title === undefined ? bookmark.title : update.title.trim() || defaultTitleForUrl(bookmark.url),
    notes: update.notes === undefined ? bookmark.notes : update.notes.trim(),
    tags: update.tags === undefined ? bookmark.tags : normalizeTags(update.tags),
    collectionId,
    position,
    favorite: update.favorite === undefined ? bookmark.favorite : update.favorite,
    faviconUrl: update.faviconUrl === undefined ? bookmark.faviconUrl : update.faviconUrl,
    updatedAt: now,
    revision: bookmark.revision + 1,
    deletedAt: undefined,
  };
}

export function applyCollectionUpdate(collection: Collection, update: UpdateCollectionInput, now = new Date().toISOString()): Collection {
  const current = migrateCollection(collection);
  const name = update.name === undefined ? collection.name : update.name;
  const parentId = update.parentId === undefined ? collection.parentId : update.parentId ?? undefined;
  const position = update.position === undefined ? current.position : update.position;
  const toolbar = update.toolbar === undefined ? current.toolbar : update.toolbar;
  const changed = name !== collection.name || parentId !== collection.parentId || position !== current.position || toolbar !== current.toolbar;
  if (!changed) return current;
  return { ...current, name, parentId, position, toolbar, updatedAt: now, revision: collection.revision + 1 };
}

export function comparePositionThenId(left: { id: string; position?: number }, right: { id: string; position?: number }): number {
  const position = (left.position ?? 0) - (right.position ?? 0);
  if (position !== 0) return position;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

export function sortByPosition<T extends { id: string; position?: number }>(items: readonly T[]): T[] {
  return [...items].sort(comparePositionThenId);
}

/** Child folders and bookmarks of one parent, position ascending, then id. Deleted records are omitted. */
export function orderedSiblings(
  parentId: string | undefined,
  bookmarks: readonly Bookmark[],
  collections: readonly Collection[],
): Array<{ kind: 'bookmark'; record: Bookmark } | { kind: 'folder'; record: Collection }> {
  const children: Array<{ id: string; position: number; value: { kind: 'bookmark'; record: Bookmark } | { kind: 'folder'; record: Collection } }> = [];
  for (const folder of collections) {
    if ((folder.parentId ?? undefined) !== parentId || folder.deletedAt) continue;
    children.push({ id: folder.id, position: migrateCollection(folder).position, value: { kind: 'folder', record: folder } });
  }
  for (const bookmark of bookmarks) {
    if ((bookmark.collectionId ?? undefined) !== parentId || bookmark.deletedAt) continue;
    children.push({ id: bookmark.id, position: migrateBookmark(bookmark).position, value: { kind: 'bookmark', record: bookmark } });
  }
  children.sort(comparePositionThenId);
  return children.map((child) => child.value);
}

/** Keep a single toolbar folder. Only records whose flag changes gain a revision. */
export function assignToolbar(collections: readonly Collection[], toolbarId: string | undefined, now = new Date().toISOString()): Collection[] {
  return collections.map((collection) => applyCollectionUpdate(collection, { toolbar: toolbarId !== undefined && collection.id === toolbarId }, now));
}

export * from './service';
