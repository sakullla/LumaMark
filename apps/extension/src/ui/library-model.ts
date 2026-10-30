import { isSeparator, urlKey, type Bookmark, type Collection } from '../../../../packages/domain/src/index';
import { isHttpUrl } from './bar';
import { filterBookmarks, type LibraryFilters } from './index';

/** What the library is showing. Smart views cross folders; `folder` and `tag` narrow to one. */
export type LibraryScope =
  | { kind: 'all' | 'favorites' | 'recent' | 'unfiled' | 'duplicates' | 'trash' }
  | { kind: 'folder'; id: string }
  | { kind: 'tag'; tag: string };

export const RECENT_DAYS = 30;

export function scopeKey(scope: LibraryScope): string {
  if (scope.kind === 'folder') return `folder:${scope.id}`;
  if (scope.kind === 'tag') return `tag:${scope.tag}`;
  return scope.kind;
}

export function sameScope(left: LibraryScope, right: LibraryScope): boolean {
  return scopeKey(left) === scopeKey(right);
}

export function aliveFolderIds(collections: readonly Collection[]): Set<string> {
  return new Set(collections.filter((collection) => !collection.deletedAt).map((collection) => collection.id));
}

/** A bookmark whose folder was deleted is still saved, so it counts as unfiled rather than disappearing. */
export function isUnfiled(bookmark: Bookmark, alive: ReadonlySet<string>): boolean {
  return !bookmark.collectionId || !alive.has(bookmark.collectionId);
}

export function folderDescendants(collections: readonly Collection[], id: string): Set<string> {
  const found = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const collection of collections) {
      if (collection.deletedAt || !collection.parentId || found.has(collection.id) || !found.has(collection.parentId)) continue;
      found.add(collection.id);
      grew = true;
    }
  }
  return found;
}

/** "Parent / Child" for every live folder. */
export function folderPaths(collections: readonly Collection[]): Map<string, string> {
  const byId = new Map(collections.filter((collection) => !collection.deletedAt).map((collection) => [collection.id, collection]));
  const paths = new Map<string, string>();
  const pathOf = (id: string, seen: Set<string>): string => {
    const known = paths.get(id);
    if (known !== undefined) return known;
    const collection = byId.get(id);
    if (!collection) return '';
    const parent = collection.parentId && !seen.has(collection.parentId) ? pathOf(collection.parentId, seen.add(id)) : '';
    const path = parent ? `${parent} / ${collection.name}` : collection.name;
    paths.set(id, path);
    return path;
  };
  for (const id of byId.keys()) pathOf(id, new Set());
  return paths;
}

export function liveBookmarks(bookmarks: readonly Bookmark[]): Bookmark[] {
  return bookmarks.filter((bookmark) => !bookmark.deletedAt && !isSeparator(bookmark));
}

export function deletedBookmarks(bookmarks: readonly Bookmark[]): Bookmark[] {
  return bookmarks.filter((bookmark) => bookmark.deletedAt && !isSeparator(bookmark));
}

export interface CountedName { name: string; count: number }

function counted(names: Iterable<string>): CountedName[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

export function tagCounts(bookmarks: readonly Bookmark[]): CountedName[] {
  return counted(liveBookmarks(bookmarks).flatMap((bookmark) => bookmark.tags));
}

export function domainCounts(bookmarks: readonly Bookmark[]): CountedName[] {
  return counted(liveBookmarks(bookmarks).map((bookmark) => bookmark.domain).filter(Boolean));
}

/** Live bookmarks that share a URL, largest group first. */
export function duplicateGroups(bookmarks: readonly Bookmark[]): Bookmark[][] {
  const groups = new Map<string, Bookmark[]>();
  for (const bookmark of liveBookmarks(bookmarks)) {
    const key = urlKey(bookmark.url);
    const group = groups.get(key);
    if (group) group.push(bookmark);
    else groups.set(key, [bookmark]);
  }
  return [...groups.values()].filter((group) => group.length > 1).sort((left, right) => right.length - left.length);
}

const keepScore = (bookmark: Bookmark) => (bookmark.favorite ? 4 : 0) + (bookmark.notes ? 2 : 0) + (bookmark.tags.length ? 1 : 0);

/** The copies to delete so each group keeps one: favorites, then annotated, then most recently updated. */
export function extraDuplicateIds(groups: readonly Bookmark[][]): string[] {
  return groups.flatMap((group) => {
    const ordered = [...group].sort((left, right) => keepScore(right) - keepScore(left) || right.updatedAt.localeCompare(left.updatedAt));
    return ordered.slice(1).map((bookmark) => bookmark.id);
  });
}

export interface ScopeContext {
  collections: readonly Collection[];
  /** Search crosses folders unless the user keeps it inside the current one. */
  searchWithinFolder?: boolean;
  now?: number;
}

/** Bookmarks visible in a scope with filters applied, in display order. */
export function scopedBookmarks(bookmarks: readonly Bookmark[], scope: LibraryScope, filters: LibraryFilters, context: ScopeContext): Bookmark[] {
  const clean = { ...filters, collectionId: '', includeDeleted: scope.kind === 'trash' };
  if (scope.kind === 'trash') return filterBookmarks(deletedBookmarks(bookmarks), clean);
  const live = liveBookmarks(bookmarks);
  if (scope.kind === 'duplicates') {
    const members = duplicateGroups(live).flat();
    const grouped = filterBookmarks(members, clean);
    return grouped.sort((left, right) => urlKey(left.url).localeCompare(urlKey(right.url)));
  }
  if (scope.kind === 'favorites') return filterBookmarks(live.filter((bookmark) => bookmark.favorite), clean);
  if (scope.kind === 'recent') {
    const since = new Date((context.now ?? Date.now()) - RECENT_DAYS * 86_400_000).toISOString();
    return filterBookmarks(live.filter((bookmark) => bookmark.createdAt >= since), clean);
  }
  if (scope.kind === 'unfiled') {
    const alive = aliveFolderIds(context.collections);
    return filterBookmarks(live.filter((bookmark) => isUnfiled(bookmark, alive)), clean);
  }
  if (scope.kind === 'tag') return filterBookmarks(live.filter((bookmark) => bookmark.tags.includes(scope.tag)), clean);
  if (scope.kind === 'folder') {
    if (filters.text.trim() && !context.searchWithinFolder) return filterBookmarks(live, clean);
    const folders = filters.text.trim() ? folderDescendants(context.collections, scope.id) : new Set([scope.id]);
    return filterBookmarks(live.filter((bookmark) => bookmark.collectionId !== undefined && folders.has(bookmark.collectionId)), clean);
  }
  return filterBookmarks(live, clean);
}

/** Ids between the anchor and the target in display order, inclusive. A missing anchor selects just the target. */
export function rangeIds(ordered: readonly string[], anchor: string | undefined, target: string): string[] {
  const end = ordered.indexOf(target);
  if (end < 0) return [];
  const start = anchor === undefined ? -1 : ordered.indexOf(anchor);
  if (start < 0) return [target];
  return ordered.slice(Math.min(start, end), Math.max(start, end) + 1);
}

export function parseTags(value: string): string[] {
  return value.split(/[,，]/).map((tag) => tag.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
}

export interface BatchChange { id: string; update: Record<string, unknown> }

/** Per-item tag edits. Bookmarks that would not change are left out so they keep their revision. */
export function tagChanges(bookmarks: readonly Bookmark[], add: readonly string[], remove: readonly string[]): BatchChange[] {
  const dropped = new Set(remove);
  const changes: BatchChange[] = [];
  for (const bookmark of bookmarks) {
    const tags = [...new Set([...bookmark.tags.filter((tag) => !dropped.has(tag)), ...add])].sort();
    if (tags.join('\n') !== [...bookmark.tags].sort().join('\n')) changes.push({ id: bookmark.id, update: { tags } });
  }
  return changes;
}

/** The fields a bulk edit can touch, as an update that puts them back. */
export function undoChanges(bookmarks: readonly Bookmark[], fields: ReadonlyArray<'title' | 'url' | 'tags' | 'favorite' | 'collectionId'>): BatchChange[] {
  return bookmarks.map((bookmark) => {
    const update: Record<string, unknown> = {};
    for (const field of fields) update[field] = field === 'collectionId' ? bookmark.collectionId ?? null : bookmark[field];
    return { id: bookmark.id, update };
  });
}

export type ReplaceField = 'title' | 'url';

export interface ReplacePlan {
  edits: Array<{ id: string; before: string; after: string }>;
  /** URLs the replacement would leave invalid; they are skipped. */
  invalid: number;
}

/** Literal find and replace. Regular expressions stay out so a typo cannot rewrite a whole library. */
export function planReplace(bookmarks: readonly Bookmark[], input: { field: ReplaceField; find: string; replace: string; matchCase: boolean }): ReplacePlan {
  const plan: ReplacePlan = { edits: [], invalid: 0 };
  if (!input.find) return plan;
  const needle = input.matchCase ? input.find : input.find.toLowerCase();
  for (const bookmark of bookmarks) {
    const before = bookmark[input.field];
    const haystack = input.matchCase ? before : before.toLowerCase();
    if (!haystack.includes(needle)) continue;
    let after = '';
    let from = 0;
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, from)) {
      after += before.slice(from, at) + input.replace;
      from = at + needle.length;
    }
    after += before.slice(from);
    if (after === before) continue;
    if (input.field === 'url' && isHttpUrl(before) && !isHttpUrl(after)) { plan.invalid += 1; continue; }
    if (input.field === 'title' && !after.trim()) { plan.invalid += 1; continue; }
    plan.edits.push({ id: bookmark.id, before, after });
  }
  return plan;
}
