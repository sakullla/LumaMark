import { comparePositionThenId, urlKey, type Bookmark, type Collection } from '../../domain/src/index';

/** Bookmarks, folders, and ids emptied from Trash. */
export interface LoginLibrary {
  bookmarks: readonly Bookmark[];
  collections: readonly Collection[];
  purged?: readonly string[];
}

export interface LoginMergeResult {
  bookmarks: Bookmark[];
  collections: Collection[];
  purged: string[];
}

interface Ranked {
  id: string;
  revision: number;
  updatedAt: string;
}

/**
 * Trimmed folder names from the root down to this folder.
 * Different ids with the same chain are the same folder. A cycle stops the walk.
 */
export function folderNameChain(collections: readonly Collection[], collectionId: string | undefined): string[] {
  if (!collectionId) return [];
  const byId = new Map(dedupe(collections).map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = collectionId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const folder = byId.get(current);
    if (!folder) break;
    names.push(folder.name.trim());
    current = folder.parentId;
  }
  names.reverse();
  return names;
}

/** True when both ids sit on the same trimmed name chain, including the root. */
export function sameFolder(
  leftCollections: readonly Collection[],
  leftId: string | undefined,
  rightCollections: readonly Collection[],
  rightId: string | undefined,
): boolean {
  const left = folderNameChain(leftCollections, leftId);
  const right = folderNameChain(rightCollections, rightId);
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

/** Bookmark identity used at login: folder name chain plus urlKey(url). */
export function bookmarkMergeKey(bookmark: Pick<Bookmark, 'url' | 'collectionId'>, collections: readonly Collection[]): string {
  return JSON.stringify([folderNameChain(collections, bookmark.collectionId), urlKey(bookmark.url)]);
}

/** An account is empty when it has no bookmark or folder that is still live. */
export function isEmptyAccount(library: Pick<LoginLibrary, 'bookmarks' | 'collections'>): boolean {
  const liveBookmark = library.bookmarks.some((bookmark) => bookmark && !bookmark.deletedAt && !bookmark.purgedAt);
  const liveFolder = library.collections.some((folder) => folder && !folder.deletedAt);
  return !liveBookmark && !liveFolder;
}

/**
 * Copy the unauthenticated library into an empty account.
 * Original ids stay. Ids already cleared on either library are kept cleared and are not copied back as bookmarks.
 */
export function copyUnauthenticatedLibrary(account: LoginLibrary, guest: LoginLibrary): LoginMergeResult {
  const purged = uniqueIds([...(account.purged ?? []), ...(guest.purged ?? [])]);
  const blocked = new Set(purged);
  const seenBookmarks = new Set<string>();
  const bookmarks: Bookmark[] = [];
  for (const bookmark of guest.bookmarks) {
    if (!bookmark?.id || blocked.has(bookmark.id) || seenBookmarks.has(bookmark.id)) continue;
    seenBookmarks.add(bookmark.id);
    bookmarks.push(cloneBookmark(bookmark, bookmark.collectionId));
  }
  const seenFolders = new Set<string>();
  const collections: Collection[] = [];
  for (const folder of guest.collections) {
    if (!folder?.id || seenFolders.has(folder.id)) continue;
    seenFolders.add(folder.id);
    collections.push({ ...folder });
  }
  return { bookmarks, collections, purged };
}

/**
 * Collapse both libraries by folder name chain and urlKey.
 * One-sided bookmarks keep their id and folder chain. A shared key keeps the account id
 * and the account title, notes, tags, favorite, and deletion state.
 */
export function mergeLoginLibraries(account: LoginLibrary, guest: LoginLibrary): LoginMergeResult {
  const accountFolders = dedupe(account.collections);
  const guestFolders = dedupe(guest.collections);
  const canonical = canonicalFolders(accountFolders, guestFolders);
  const blocked = new Set(uniqueIds(account.purged));
  const guestBookmarks = dedupe(guest.bookmarks).filter((bookmark) => !blocked.has(bookmark.id));
  const accountGroups = groupBookmarks(dedupe(account.bookmarks), accountFolders);
  const guestGroups = groupBookmarks(guestBookmarks, guestFolders);

  const chosen: Array<{ fromAccount: boolean; bookmark: Bookmark; collectionId: string | undefined }> = [];
  for (const key of new Set([...accountGroups.keys(), ...guestGroups.keys()])) {
    const accountItems = accountGroups.get(key) ?? [];
    const guestItems = guestGroups.get(key) ?? [];
    const fromAccount = accountItems.length > 0;
    const source = fromAccount ? prefer(accountItems) : prefer(guestItems);
    if (!source) continue;
    const collections = fromAccount ? accountFolders : guestFolders;
    chosen.push({
      fromAccount,
      bookmark: source,
      collectionId: canonicalCollectionId(source, collections, canonical),
    });
  }

  const taken = new Set<string>();
  const bookmarks: Bookmark[] = [];
  for (const item of chosen.filter((entry) => entry.fromAccount)) {
    taken.add(item.bookmark.id);
    bookmarks.push(cloneBookmark(item.bookmark, item.collectionId));
  }
  for (const item of chosen.filter((entry) => !entry.fromAccount).sort((left, right) => compareId(left.bookmark.id, right.bookmark.id))) {
    const id = unusedId(item.bookmark.id, taken);
    taken.add(id);
    bookmarks.push(cloneBookmark({ ...item.bookmark, id }, item.collectionId));
  }

  const collections = [...canonical.entries()].map(([key, folder]) => {
    const chain = JSON.parse(key) as string[];
    const parent = chain.length > 1 ? canonical.get(JSON.stringify(chain.slice(0, -1))) : undefined;
    return placeFolder(folder, parent?.id);
  });
  bookmarks.sort(comparePositionThenId);
  collections.sort(comparePositionThenId);

  const liveIds = new Set(bookmarks.filter((bookmark) => !bookmark.purgedAt).map((bookmark) => bookmark.id));
  const purged = uniqueIds(account.purged).filter((id) => !liveIds.has(id));
  return { bookmarks, collections, purged };
}

function canonicalCollectionId(
  bookmark: Bookmark,
  collections: readonly Collection[],
  canonical: ReadonlyMap<string, Collection>,
): string | undefined {
  if (!bookmark.collectionId) return undefined;
  const chain = folderNameChain(collections, bookmark.collectionId);
  if (!chain.length) return bookmark.collectionId;
  return canonical.get(JSON.stringify(chain))?.id ?? bookmark.collectionId;
}

function canonicalFolders(accountFolders: readonly Collection[], guestFolders: readonly Collection[]): Map<string, Collection> {
  const groups = new Map<string, { account: Collection[]; guest: Collection[] }>();
  const push = (side: 'account' | 'guest', folders: readonly Collection[]): void => {
    for (const folder of folders) {
      const chain = folderNameChain(folders, folder.id);
      if (!chain.length) continue;
      const key = JSON.stringify(chain);
      const group = groups.get(key) ?? { account: [], guest: [] };
      group[side].push(folder);
      groups.set(key, group);
    }
  };
  push('account', accountFolders);
  push('guest', guestFolders);

  const canonical = new Map<string, Collection>();
  for (const [key, group] of groups) {
    const winner = group.account.length ? prefer(group.account) : prefer(group.guest);
    if (winner) canonical.set(key, winner);
  }
  return canonical;
}

function groupBookmarks(bookmarks: readonly Bookmark[], collections: readonly Collection[]): Map<string, Bookmark[]> {
  const groups = new Map<string, Bookmark[]>();
  for (const bookmark of bookmarks) {
    const key = bookmarkMergeKey(bookmark, collections);
    const group = groups.get(key);
    if (group) group.push(bookmark);
    else groups.set(key, [bookmark]);
  }
  return groups;
}

function dedupe<T extends Ranked>(items: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) {
    if (!item?.id) continue;
    const current = byId.get(item.id);
    if (!current || outranks(item, current)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

/** Higher revision, then later updatedAt, then smaller id. */
function outranks(candidate: Ranked, current: Ranked): boolean {
  if (candidate.revision !== current.revision) return candidate.revision > current.revision;
  if (candidate.updatedAt !== current.updatedAt) return candidate.updatedAt > current.updatedAt;
  return candidate.id < current.id;
}

function prefer<T extends Ranked>(items: readonly T[]): T | undefined {
  return items.reduce<T | undefined>((best, item) => (!best || outranks(item, best) ? item : best), undefined);
}

function uniqueIds(ids: readonly string[] | undefined): string[] {
  return [...new Set((ids ?? []).filter((id) => typeof id === 'string' && id))].sort();
}

function unusedId(preferred: string, taken: Set<string>): string {
  if (!taken.has(preferred)) return preferred;
  let suffix = 2;
  let next = `${preferred}#${suffix}`;
  while (taken.has(next)) {
    suffix += 1;
    next = `${preferred}#${suffix}`;
  }
  return next;
}

function compareId(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function cloneBookmark(bookmark: Bookmark, collectionId: string | undefined): Bookmark {
  const copy: Bookmark = { ...bookmark, tags: [...bookmark.tags] };
  if (collectionId) copy.collectionId = collectionId;
  else delete copy.collectionId;
  return copy;
}

function placeFolder(folder: Collection, parentId: string | undefined): Collection {
  const copy: Collection = { ...folder };
  if (parentId) copy.parentId = parentId;
  else delete copy.parentId;
  return copy;
}
