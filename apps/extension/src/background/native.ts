/**
 * Two-way bridge between the browser's own bookmarks (bookmarks API) and the
 * LumaMark store that WebDAV sync publishes.
 *
 * One reconcile pass is a three-way diff between the native tree, the store and
 * the link table saved after the previous pass:
 *   - a native node changed since the last pass while its record did not  → update the record
 *   - a record's revision moved since the last pass                         → update the native node
 *   - a linked native node disappeared                                     → tombstone the record
 *   - a linked record became a tombstone                                   → remove the native node
 *   - unlinked native nodes / records are paired (same URL or folder name in the same
 *     folder) before anything is created, so joining a second browser does not duplicate.
 * The pass is idempotent: the bookmark events caused by its own writes find nothing to do.
 */
import {
  applyBookmarkUpdate,
  applyCollectionUpdate,
  domainFromUrl,
  makeBookmark,
  migrateBookmark,
  migrateCollection,
  normalizeUrl,
  orderedSiblings,
  type Bookmark,
  type Collection,
} from '../../../../packages/domain/src/index';
import type { NativeBookmarksApi, NativeNode } from '../../../../packages/browser/src/index';

export type { NativeBookmarksApi, NativeNode };


export interface BridgeRepository {
  list(query?: { includeDeleted?: boolean }): Promise<Bookmark[]>;
  put(bookmark: Bookmark): Promise<void>;
  listCollections(): Promise<Collection[]>;
  putCollection(collection: Collection): Promise<void>;
}

export interface BridgeLink {
  lumaId: string;
  nativeId: string;
  kind: 'bookmark' | 'folder' | 'root';
  title: string;
  url?: string;
  parent?: string;
  revision: number;
}

export interface BridgeState {
  version: 1;
  links: BridgeLink[];
  /** Linked record ids per native folder, in native order, as left by the last pass. */
  orders: Record<string, string[]>;
  lastReconcileAt?: string;
}

export interface BridgeStateStore {
  load(): Promise<BridgeState | undefined>;
  save(state: BridgeState): Promise<void>;
}

export interface ReconcileReport {
  repoChanges: number;
  nativeChanges: number;
  linked: number;
  skipped: number;
  errors: string[];
}

export const ROOT_TOOLBAR_ID = 'root-toolbar';
export const ROOT_MENU_ID = 'root-menu';

type RootKind = 'toolbar' | 'other' | 'menu' | 'mobile' | 'unknown';

export function nativeRootKind(node: Pick<NativeNode, 'id' | 'folderType'>): RootKind {
  const { id, folderType } = node;
  if (folderType === 'bookmarks-bar' || id === '1' || id === 'toolbar_____') return 'toolbar';
  if (folderType === 'other' || id === '2' || id === 'unfiled_____') return 'other';
  if (id === 'menu________') return 'menu';
  if (folderType === 'mobile' || id === '3' || id === 'mobile______') return 'mobile';
  return 'unknown';
}

const isFolderNode = (node: NativeNode) => !node.url && node.type !== 'separator';

function syncableUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try { return normalizeUrl(url); } catch { return undefined; }
}

function sameUrl(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return (syncableUrl(left) ?? left) === (syncableUrl(right) ?? right);
}

const emptyState = (): BridgeState => ({ version: 1, links: [], orders: {} });

export function normalizeBridgeState(value: unknown): BridgeState {
  if (!value || typeof value !== 'object') return emptyState();
  const raw = value as Partial<BridgeState>;
  const links = Array.isArray(raw.links) ? raw.links.filter((link): link is BridgeLink => Boolean(link && typeof link.lumaId === 'string' && typeof link.nativeId === 'string')) : [];
  return { version: 1, links, orders: raw.orders && typeof raw.orders === 'object' ? { ...raw.orders } : {}, lastReconcileAt: raw.lastReconcileAt };
}

const sameList = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((value, index) => value === right[index]);

export async function reconcileNativeBookmarks(native: NativeBookmarksApi, repository: BridgeRepository, store: BridgeStateStore): Promise<ReconcileReport> {
  const report: ReconcileReport = { repoChanges: 0, nativeChanges: 0, linked: 0, skipped: 0, errors: [] };
  const state = normalizeBridgeState(await store.load());
  const stamp = () => new Date().toISOString();

  // ── native tree ──
  const readTree = async () => {
    const tree = await native.getTree();
    const nodes = new Map<string, NativeNode>();
    const roots: Partial<Record<RootKind, NativeNode>> = {};
    const preorder: NativeNode[] = [];
    let skipped = 0;
    const walk = (parent: NativeNode) => {
      const children = [...(parent.children ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      for (const child of children) {
        if (child.type === 'separator' || child.unmodifiable) { skipped += 1; continue; }
        if (!isFolderNode(child) && !syncableUrl(child.url)) { skipped += 1; continue; }
        const node = { ...child, parentId: child.parentId ?? parent.id };
        nodes.set(node.id, node);
        preorder.push(node);
        if (isFolderNode(child)) walk(child);
      }
    };
    for (const root of tree[0]?.children ?? []) {
      const kind = nativeRootKind(root);
      if (kind === 'mobile' || kind === 'unknown' || roots[kind]) continue;
      roots[kind] = root;
      walk(root);
    }
    return { nodes, roots, preorder, skipped };
  };
  let native0 = await readTree();
  const { roots } = native0;
  const otherRoot = roots.other ?? roots.toolbar;
  if (!otherRoot) return report;
  report.skipped = native0.skipped;
  const rootIds = new Set([roots.toolbar?.id, roots.other?.id, roots.menu?.id].filter((id): id is string => Boolean(id)));

  // ── store ──
  const bookmarks = new Map((await repository.list({ includeDeleted: true })).map((item) => [item.id, migrateBookmark(item)] as const));
  const collections = new Map((await repository.listCollections()).map((item) => [item.id, migrateCollection(item)] as const));
  const putBookmark = async (item: Bookmark) => { bookmarks.set(item.id, item); await repository.put(item); report.repoChanges += 1; };
  const putCollection = async (item: Collection) => { collections.set(item.id, item); await repository.putCollection(item); report.repoChanges += 1; };
  const tombstone = async (kind: 'bookmark' | 'folder' | 'root', id: string) => {
    const now = stamp();
    if (kind === 'bookmark') {
      const current = bookmarks.get(id);
      if (current && !current.deletedAt) await putBookmark({ ...current, deletedAt: now, updatedAt: now, revision: current.revision + 1 });
    } else {
      const current = collections.get(id);
      if (current && !current.deletedAt) await putCollection({ ...current, deletedAt: now, updatedAt: now, revision: current.revision + 1 });
    }
  };
  const recordOf = (link: Pick<BridgeLink, 'kind' | 'lumaId'>): Bookmark | Collection | undefined => (link.kind === 'bookmark' ? bookmarks.get(link.lumaId) : collections.get(link.lumaId));

  // ── links ──
  const byLuma = new Map<string, BridgeLink>();
  const byNative = new Map<string, BridgeLink>();
  const addLink = (link: BridgeLink) => { byLuma.set(link.lumaId, link); byNative.set(link.nativeId, link); };
  const dropLink = (link: BridgeLink) => { byLuma.delete(link.lumaId); if (byNative.get(link.nativeId) === link) byNative.delete(link.nativeId); };
  for (const link of state.links) addLink({ ...link });
  const safely = async (label: string, work: () => Promise<void>) => {
    try { await work(); } catch (error) { report.errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
  };

  // ── roots: bookmarks bar ↔ toolbar folder, other bookmarks ↔ top level, Firefox menu ↔ fixed folder ──
  for (const link of [...byLuma.values()]) {
    if (link.kind === 'root' && !rootIds.has(link.nativeId)) dropLink(link);
  }
  const ensureRoot = async (node: NativeNode | undefined, kind: 'toolbar' | 'menu') => {
    if (!node) return;
    const existing = byNative.get(node.id);
    const current = existing ? collections.get(existing.lumaId) : undefined;
    if (existing && current && !current.deletedAt) return;
    if (existing) dropLink(existing);
    const fixedId = kind === 'toolbar' ? ROOT_TOOLBAR_ID : ROOT_MENU_ID;
    const live = [...collections.values()].filter((item) => !item.deletedAt && !byLuma.has(item.id));
    let chosen = kind === 'toolbar'
      ? live.find((item) => item.id === fixedId) ?? live.filter((item) => item.toolbar).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))[0]
      : live.find((item) => item.id === fixedId);
    if (!chosen) {
      const now = stamp();
      const previous = collections.get(fixedId);
      chosen = previous
        ? { ...previous, deletedAt: undefined, updatedAt: now, revision: previous.revision + 1 }
        : { id: fixedId, name: node.title || (kind === 'toolbar' ? 'Bookmarks bar' : 'Bookmarks menu'), position: kind === 'toolbar' ? 0 : 1, toolbar: kind === 'toolbar', createdAt: now, updatedAt: now, revision: 1 };
      await putCollection(chosen);
    }
    addLink({ lumaId: chosen.id, nativeId: node.id, kind: 'root', title: node.title, parent: undefined, revision: chosen.revision });
  };
  await ensureRoot(roots.toolbar, 'toolbar');
  // Firefox's Bookmarks Menu only becomes a synced folder once it holds something (or another browser sent one).
  const menuInUse = Boolean(roots.menu && (native0.preorder.some((node) => node.parentId === roots.menu!.id) || (collections.get(ROOT_MENU_ID) && !collections.get(ROOT_MENU_ID)!.deletedAt)));
  if (menuInUse) await ensureRoot(roots.menu, 'menu');

  const nativeToRepoParent = (nativeParentId: string | undefined): string | undefined => {
    if (!nativeParentId || nativeParentId === otherRoot.id) return undefined;
    return byNative.get(nativeParentId)?.lumaId;
  };
  /** Native folder for a record's parent; deleted or unknown folders fall back to their nearest live ancestor. */
  const repoToNativeParent = (repoParentId: string | undefined): string => {
    let current = repoParentId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const folder = collections.get(current);
      const link = byLuma.get(current);
      if (folder && !folder.deletedAt && link) return link.nativeId;
      if (!folder) break;
      current = folder.parentId;
    }
    return otherRoot.id;
  };

  // Records removed outright (undo of a fresh save) mean "delete in the browser". A store that lost most of
  // its linked records was reset instead: forget those links so pairing re-imports rather than deleting.
  const missing = [...byLuma.values()].filter((link) => link.kind !== 'root' && !recordOf(link));
  const linkedCount = [...byLuma.values()].filter((link) => link.kind !== 'root').length;
  const storeReset = missing.length > 3 && missing.length * 2 > linkedCount;
  for (const link of missing) {
    dropLink(link);
    if (storeReset || !native0.nodes.has(link.nativeId)) continue;
    await safely(`remove ${link.lumaId}`, async () => {
      if (link.kind === 'bookmark') await native.remove(link.nativeId); else await native.removeTree(link.nativeId);
      report.nativeChanges += 1;
    });
  }
  if (report.nativeChanges) native0 = await readTree();

  // ── 1. native → store ──
  const forceNative = new Set<string>();
  /** Native folders that gained children in the browser since the last pass. */
  const nativeAdded = new Set<string>();
  for (const node of native0.preorder) {
    const folder = isFolderNode(node);
    const parentLuma = nativeToRepoParent(node.parentId);
    let link = byNative.get(node.id);
    if (link && (link.kind === 'root' || (link.kind === 'folder') !== folder || !recordOf(link))) { dropLink(link); link = undefined; }
    if (link) {
      const record = recordOf(link)!;
      if (record.deletedAt) continue; // removed in step 3
      const nativeChanged = node.title !== link.title || (node.url ?? '') !== (link.url ?? '') || node.parentId !== link.parent;
      const repoChanged = record.revision !== link.revision;
      if (nativeChanged && !repoChanged) {
        await safely(`store ${record.id}`, async () => {
          if (folder) {
            const next = applyCollectionUpdate(record as Collection, { name: node.title, ...(node.parentId !== link!.parent ? { parentId: parentLuma ?? null } : {}) });
            if (next !== record) await putCollection(next);
            link!.revision = (collections.get(record.id) ?? next).revision;
          } else {
            const bookmark = record as Bookmark;
            const url = syncableUrl(node.url) ?? bookmark.url;
            const next = applyBookmarkUpdate(bookmark, { title: node.title, ...(node.parentId !== link!.parent ? { collectionId: parentLuma ?? null } : {}) });
            const stored = { ...next, url, domain: domainFromUrl(url) };
            await putBookmark(stored);
            link!.revision = stored.revision;
          }
          link!.title = node.title; link!.url = node.url; link!.parent = node.parentId;
        });
      }
      continue;
    }
    // Unlinked native node: pair with an unlinked record in the same folder, otherwise create one.
    if (folder) {
      const candidate = [...collections.values()].find((item) => !item.deletedAt && !byLuma.has(item.id) && !item.toolbar
        && (item.parentId ?? undefined) === parentLuma && item.name.trim() === node.title.trim());
      if (candidate) {
        addLink({ lumaId: candidate.id, nativeId: node.id, kind: 'folder', title: node.title, parent: node.parentId, revision: candidate.revision });
        report.linked += 1;
        continue;
      }
      const now = stamp();
      if (node.parentId) nativeAdded.add(node.parentId);
      const created: Collection = { id: crypto.randomUUID(), name: node.title, parentId: parentLuma, position: node.index ?? 0, toolbar: false, createdAt: node.dateAdded ? new Date(node.dateAdded).toISOString() : now, updatedAt: now, revision: 1 };
      await putCollection(created);
      addLink({ lumaId: created.id, nativeId: node.id, kind: 'folder', title: node.title, parent: node.parentId, revision: created.revision });
      report.linked += 1;
      continue;
    }
    const candidate = [...bookmarks.values()].find((item) => !item.deletedAt && !byLuma.has(item.id)
      && (item.collectionId ?? undefined) === parentLuma && sameUrl(item.url, node.url));
    if (candidate) {
      addLink({ lumaId: candidate.id, nativeId: node.id, kind: 'bookmark', title: node.title, url: node.url, parent: node.parentId, revision: candidate.revision });
      // The store is the synced copy; let it correct the native title.
      if (candidate.title !== node.title) forceNative.add(candidate.id);
      report.linked += 1;
      continue;
    }
    await safely(`import ${node.id}`, async () => {
      const now = stamp();
      const created = makeBookmark({ url: node.url!, title: node.title, collectionId: parentLuma, position: node.index ?? 0 }, now);
      if (node.dateAdded) created.createdAt = new Date(node.dateAdded).toISOString();
      if (node.parentId) nativeAdded.add(node.parentId);
      await putBookmark(created);
      addLink({ lumaId: created.id, nativeId: node.id, kind: 'bookmark', title: node.title, url: node.url, parent: node.parentId, revision: created.revision });
      report.linked += 1;
    });
  }

  // Which folders were reordered natively since the last pass (compared before this pass writes anything).
  const nativeOrderOf = (tree: typeof native0, folderId: string) => [...tree.nodes.values()]
    .filter((node) => node.parentId === folderId && byNative.has(node.id))
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((node) => byNative.get(node.id)!.lumaId);
  const nativeReordered = new Set<string>();
  const folderIds = () => [...rootIds, ...[...byNative.values()].filter((link) => link.kind === 'folder').map((link) => link.nativeId)];
  for (const folderId of folderIds()) {
    // Only an actual reorder or a new item placed in the browser makes native order win over the store.
    const previous = state.orders[folderId];
    if (nativeAdded.has(folderId)) { nativeReordered.add(folderId); continue; }
    if (!previous) continue;
    const current = nativeOrderOf(native0, folderId);
    const known = new Set(current);
    const before = previous.filter((id) => known.has(id));
    const kept = new Set(before);
    if (!sameList(before, current.filter((id) => kept.has(id)))) nativeReordered.add(folderId);
  }

  // ── 2. linked native nodes that disappeared ──
  for (const link of [...byLuma.values()]) {
    if (link.kind === 'root' || native0.nodes.has(link.nativeId)) continue;
    const record = recordOf(link);
    dropLink(link);
    // Deleted in the browser while the record stayed as it was: delete the record.
    // If the record changed meanwhile (e.g. edited on another browser), it is recreated below.
    if (record && !record.deletedAt && record.revision === link.revision) await safely(`delete ${record.id}`, () => tombstone(link.kind, record.id));
  }

  // ── 3. store → native ──
  const depth = (folder: Collection) => { let count = 0; let current = folder.parentId; const seen = new Set<string>(); while (current && !seen.has(current)) { seen.add(current); count += 1; current = collections.get(current)?.parentId; } return count; };
  const reparentChildren = async (fromId: string, toId: string) => {
    for (const item of [...bookmarks.values()]) {
      if (item.deletedAt || item.collectionId !== fromId) continue;
      await putBookmark(applyBookmarkUpdate(item, { collectionId: toId }));
    }
    for (const item of [...collections.values()]) {
      if (item.deletedAt || item.parentId !== fromId) continue;
      const next = applyCollectionUpdate(item, { parentId: toId });
      if (next !== item) await putCollection(next);
    }
  };
  const mergedThisPass = new Set<string>();

  const unlinkedFolders = [...collections.values()].filter((item) => !item.deletedAt && !byLuma.has(item.id)).sort((a, b) => depth(a) - depth(b) || a.position - b.position);
  for (const folder of unlinkedFolders) {
    const current = collections.get(folder.id);
    if (!current || current.deletedAt || byLuma.has(current.id)) continue;
    const nativeParent = repoToNativeParent(current.parentId);
    // A folder that arrived from another browser and matches one linked here: keep one deterministic survivor.
    const duplicate = current.toolbar && roots.toolbar
      ? byNative.get(roots.toolbar.id)
      : [...byLuma.values()].find((link) => link.kind === 'folder' && !mergedThisPass.has(link.lumaId) && link.parent === nativeParent
        && collections.get(link.lumaId)?.name.trim() === current.name.trim() && !collections.get(link.lumaId)?.deletedAt);
    const duplicateRecord = duplicate ? collections.get(duplicate.lumaId) : undefined;
    if (duplicate && duplicateRecord && !duplicateRecord.deletedAt && duplicateRecord.id !== current.id) {
      await safely(`merge ${current.id}`, async () => {
        const survivor = current.id < duplicateRecord.id ? current : duplicateRecord;
        const loser = survivor === current ? duplicateRecord : current;
        await reparentChildren(loser.id, survivor.id);
        await tombstone('folder', loser.id);
        if (survivor === current) {
          dropLink(duplicate);
          addLink({ ...duplicate, lumaId: survivor.id, revision: collections.get(survivor.id)!.revision });
        }
        mergedThisPass.add(survivor.id);
      });
      continue;
    }
    await safely(`create folder ${current.id}`, async () => {
      const created = await native.create({ parentId: nativeParent, title: current.name });
      report.nativeChanges += 1;
      addLink({ lumaId: current.id, nativeId: created.id, kind: 'folder', title: created.title ?? current.name, parent: nativeParent, revision: current.revision });
    });
  }

  const byPosition = (a: Bookmark, b: Bookmark) => a.position - b.position || a.id.localeCompare(b.id);
  for (const bookmark of [...bookmarks.values()].sort(byPosition)) {
    const current = bookmarks.get(bookmark.id)!;
    if (current.deletedAt || byLuma.has(current.id)) continue;
    const nativeParent = repoToNativeParent(current.collectionId);
    const duplicate = [...byLuma.values()].find((link) => link.kind === 'bookmark' && !mergedThisPass.has(link.lumaId) && link.parent === nativeParent
      && !bookmarks.get(link.lumaId)?.deletedAt && sameUrl(bookmarks.get(link.lumaId)?.url, current.url));
    const duplicateRecord = duplicate ? bookmarks.get(duplicate.lumaId) : undefined;
    if (duplicate && duplicateRecord) {
      await safely(`merge ${current.id}`, async () => {
        const survivor = current.id < duplicateRecord.id ? current : duplicateRecord;
        const loser = survivor === current ? duplicateRecord : current;
        await tombstone('bookmark', loser.id);
        if (survivor === current) {
          dropLink(duplicate);
          addLink({ ...duplicate, lumaId: survivor.id, revision: survivor.revision });
          forceNative.add(survivor.id);
        }
        mergedThisPass.add(survivor.id);
      });
      continue;
    }
    await safely(`create bookmark ${current.id}`, async () => {
      const created = await native.create({ parentId: nativeParent, title: current.title, url: current.url });
      report.nativeChanges += 1;
      addLink({ lumaId: current.id, nativeId: created.id, kind: 'bookmark', title: created.title ?? current.title, url: created.url ?? current.url, parent: nativeParent, revision: current.revision });
    });
  }

  // Linked records whose content or folder differs from the browser.
  for (const link of [...byLuma.values()]) {
    if (link.kind === 'root') continue;
    const record = recordOf(link);
    if (!record || record.deletedAt) continue;
    const node = native0.nodes.get(link.nativeId);
    const repoChanged = record.revision !== link.revision || forceNative.has(record.id);
    const title = link.kind === 'folder' ? (record as Collection).name : (record as Bookmark).title;
    const url = link.kind === 'bookmark' ? (record as Bookmark).url : undefined;
    const desiredParent = repoToNativeParent(link.kind === 'folder' ? (record as Collection).parentId : (record as Bookmark).collectionId);
    await safely(`update ${record.id}`, async () => {
      if (repoChanged && (title !== link.title || (url !== undefined && !sameUrl(url, link.url)))) {
        await native.update(link.nativeId, url !== undefined ? { title, url } : { title });
        report.nativeChanges += 1;
        link.title = title;
        if (url !== undefined) link.url = url;
      }
      const currentParent = node?.parentId ?? link.parent;
      if (desiredParent !== currentParent) {
        await native.move(link.nativeId, { parentId: desiredParent });
        report.nativeChanges += 1;
      }
      link.parent = desiredParent;
      link.revision = record.revision;
    });
  }

  // Records deleted in the store (here or on another browser): bookmarks first, then deepest folders.
  const removals = [...byLuma.values()].filter((link) => link.kind !== 'root' && recordOf(link)?.deletedAt);
  removals.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'bookmark' ? -1 : 1)
    || depth(collections.get(b.lumaId) ?? ({} as Collection)) - depth(collections.get(a.lumaId) ?? ({} as Collection)));
  for (const link of removals) {
    await safely(`remove ${link.lumaId}`, async () => {
      if (link.kind === 'bookmark') await native.remove(link.nativeId); else await native.removeTree(link.nativeId);
      report.nativeChanges += 1;
    });
    dropLink(link);
  }

  // ── 4. sibling order ──
  const tree = report.nativeChanges ? await readTree() : native0;
  const orders: Record<string, string[]> = {};
  for (const folderId of folderIds()) {
    if (!tree.nodes.has(folderId) && !rootIds.has(folderId)) continue;
    const nativeOrder = nativeOrderOf(tree, folderId);
    const repoParent = nativeToRepoParent(folderId);
    const isChildOf = (id: string) => {
      const link = byLuma.get(id);
      if (!link) return false;
      const parent = link.kind === 'folder' ? collections.get(id)?.parentId : bookmarks.get(id)?.collectionId;
      return (parent ?? undefined) === repoParent;
    };
    if (nativeReordered.has(folderId)) {
      // The browser is authoritative for this folder: store positions follow native order.
      for (let index = 0; index < nativeOrder.length; index += 1) {
        const id = nativeOrder[index];
        if (!isChildOf(id)) continue;
        const link = byLuma.get(id)!;
        await safely(`position ${id}`, async () => {
          if (link.kind === 'folder') {
            const current = collections.get(id)!;
            if (current.position === index) return;
            const next = applyCollectionUpdate(current, { position: index });
            await putCollection(next);
            link.revision = next.revision;
          } else {
            const current = bookmarks.get(id)!;
            if (current.position === index) return;
            const next = applyBookmarkUpdate(current, { position: index });
            await putBookmark(next);
            link.revision = next.revision;
          }
        });
      }
      orders[folderId] = nativeOrder;
      continue;
    }
    const present = new Set(nativeOrder);
    const fromStore = orderedSiblings(repoParent, [...bookmarks.values()], [...collections.values()]).map((entry) => entry.record.id).filter((id) => present.has(id));
    const desired = [...fromStore, ...nativeOrder.filter((id) => !fromStore.includes(id))];
    if (!sameList(desired, nativeOrder)) {
      // Move everything from the first difference to the end, in store order.
      let first = 0;
      while (first < desired.length && desired[first] === nativeOrder[first]) first += 1;
      for (const id of desired.slice(first)) {
        await safely(`order ${id}`, async () => {
          await native.move(byLuma.get(id)!.nativeId, { parentId: folderId });
          report.nativeChanges += 1;
        });
      }
    }
    orders[folderId] = desired;
  }

  await store.save({ version: 1, links: [...byLuma.values()], orders, lastReconcileAt: stamp() });
  return report;
}
