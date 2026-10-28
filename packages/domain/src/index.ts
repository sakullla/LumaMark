export const CURRENT_SCHEMA_VERSION = 1 as const;

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
  favorite?: boolean;
  id?: BookmarkId;
}

export interface UpdateBookmarkInput {
  title?: string;
  notes?: string;
  tags?: string[];
  collectionId?: CollectionId;
  favorite?: boolean;
  faviconUrl?: string;
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
  if (typeof item.revision !== 'number' || item.revision < 1) throw new Error('Invalid bookmark revision');
}

export function validateExport(value: unknown): asserts value is LumaMarkExport {
  if (!value || typeof value !== 'object') throw new Error('Invalid LumaMark export');
  const item = value as Partial<LumaMarkExport>;
  if (item.format !== 'lumamark' || item.schemaVersion !== CURRENT_SCHEMA_VERSION || !Array.isArray(item.bookmarks) || !Array.isArray(item.collections)) {
    throw new Error('Unsupported LumaMark export schema');
  }
  item.bookmarks.forEach(validateBookmark);
}

export function migrateExport(value: unknown): LumaMarkExport {
  validateExport(value);
  return value;
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
    favorite: input.favorite ?? false,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
}

export function applyBookmarkUpdate(bookmark: Bookmark, update: UpdateBookmarkInput, now = new Date().toISOString()): Bookmark {
  return {
    ...bookmark,
    title: update.title === undefined ? bookmark.title : update.title.trim() || defaultTitleForUrl(bookmark.url),
    notes: update.notes === undefined ? bookmark.notes : update.notes.trim(),
    tags: update.tags === undefined ? bookmark.tags : normalizeTags(update.tags),
    collectionId: update.collectionId === undefined ? bookmark.collectionId : update.collectionId,
    favorite: update.favorite === undefined ? bookmark.favorite : update.favorite,
    faviconUrl: update.faviconUrl === undefined ? bookmark.faviconUrl : update.faviconUrl,
    updatedAt: now,
    revision: bookmark.revision + 1,
    deletedAt: undefined,
  };
}

export * from './service';
