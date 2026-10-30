import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IndexedDbRepository } from '../../packages/storage/src/index';
import { startBackground } from '../../apps/extension/src/background/index';
import { makeBookmark, type Bookmark, type Collection } from '../../packages/domain/src/index';
import {
  reconcileNativeBookmarks,
  ROOT_MENU_ID,
  ROOT_TOOLBAR_ID,
  type BridgeState,
  type BridgeStateStore,
  type NativeBookmarksApi,
  type NativeNode,
} from '../../apps/extension/src/background/native';

interface FakeNode { id: string; parentId?: string; title: string; url?: string; type?: string; children: string[] }

/** In-memory bookmarks API with Chrome or Firefox root ids. */
export class FakeNative implements NativeBookmarksApi {
  nodes = new Map<string, FakeNode>();
  next = 100;
  calls = 0;
  private listeners: Array<() => void> = [];
  onCreated = { addListener: (listener: () => void) => { this.listeners.push(listener); } };
  onChanged = this.onCreated;
  onMoved = this.onCreated;
  onRemoved = this.onCreated;
  /** What the browser does after any bookmark change, including the extension's own. */
  emit() { for (const listener of this.listeners) listener(); }
  readonly root: string;
  readonly bar: string;
  readonly other: string;
  readonly menu?: string;
  readonly mobile: string;

  constructor(flavor: 'chrome' | 'firefox' = 'chrome') {
    if (flavor === 'chrome') {
      this.root = '0'; this.bar = '1'; this.other = '2'; this.mobile = '3';
      this.addRaw({ id: '0', title: '', children: [] });
      for (const [id, title] of [['1', 'Bookmarks bar'], ['2', 'Other bookmarks'], ['3', 'Mobile bookmarks']]) this.attach('0', { id, title, children: [] });
    } else {
      this.root = 'root________'; this.menu = 'menu________'; this.bar = 'toolbar_____'; this.other = 'unfiled_____'; this.mobile = 'mobile______';
      this.addRaw({ id: this.root, title: '', children: [] });
      for (const [id, title] of [[this.menu, 'Bookmarks Menu'], [this.bar, 'Bookmarks Toolbar'], [this.other, 'Other Bookmarks'], [this.mobile, 'Mobile Bookmarks']]) this.attach(this.root, { id, title, children: [] });
    }
  }

  private addRaw(node: FakeNode) { this.nodes.set(node.id, node); }
  private attach(parentId: string, node: FakeNode, index?: number) {
    node.parentId = parentId;
    this.nodes.set(node.id, node);
    const siblings = this.nodes.get(parentId)!.children;
    if (index === undefined || index > siblings.length) siblings.push(node.id); else siblings.splice(index, 0, node.id);
  }
  private detach(id: string) {
    const node = this.nodes.get(id)!;
    const siblings = this.nodes.get(node.parentId!)!.children;
    siblings.splice(siblings.indexOf(id), 1);
  }

  add(parentId: string, title: string, url?: string, type?: string): string {
    const id = String(this.next++);
    this.attach(parentId, { id, title, url, type, children: [] });
    return id;
  }
  /** Titles under a folder; folders render as "Title/[...]" for compact assertions. */
  shape(parentId: string): unknown[] {
    return this.nodes.get(parentId)!.children.map((id) => {
      const node = this.nodes.get(id)!;
      return node.url || node.type === 'separator' ? node.title : { [node.title]: this.shape(id) };
    });
  }
  findByTitle(title: string): FakeNode | undefined { return [...this.nodes.values()].find((node) => node.title === title); }

  async getTree(): Promise<NativeNode[]> {
    const build = (id: string, index: number): NativeNode => {
      const node = this.nodes.get(id)!;
      return { id, parentId: node.parentId, index, title: node.title, url: node.url, type: node.type, ...(node.url ? {} : { children: node.children.map((child, position) => build(child, position)) }) };
    };
    return [build(this.root, 0)];
  }
  async create(input: { parentId: string; index?: number; title?: string; url?: string }): Promise<NativeNode> {
    this.calls += 1;
    const id = String(this.next++);
    this.attach(input.parentId, { id, title: input.title ?? '', url: input.url, children: [] }, input.index);
    this.emit();
    return { id, parentId: input.parentId, title: input.title ?? '', url: input.url };
  }
  async update(id: string, changes: { title?: string; url?: string }): Promise<NativeNode> {
    this.calls += 1;
    const node = this.nodes.get(id)!;
    if (changes.title !== undefined) node.title = changes.title;
    if (changes.url !== undefined) node.url = changes.url;
    return { id, title: node.title, url: node.url };
  }
  async move(id: string, destination: { parentId?: string; index?: number }): Promise<NativeNode> {
    this.calls += 1;
    const node = this.nodes.get(id)!;
    this.detach(id);
    this.attach(destination.parentId ?? node.parentId!, node, destination.index);
    return { id, title: node.title };
  }
  async remove(id: string): Promise<void> {
    this.calls += 1;
    if (this.nodes.get(id)!.children.length) throw new Error('Cannot remove non-empty folder');
    this.detach(id); this.nodes.delete(id);
  }
  async removeTree(id: string): Promise<void> {
    this.calls += 1;
    const drop = (nodeId: string) => { for (const child of this.nodes.get(nodeId)!.children) drop(child); this.nodes.delete(nodeId); };
    this.detach(id); drop(id);
  }
}

class MemoryRepo {
  bookmarks = new Map<string, Bookmark>();
  collections = new Map<string, Collection>();
  async list(query: { includeDeleted?: boolean } = {}) { return [...this.bookmarks.values()].filter((item) => query.includeDeleted || !item.deletedAt).map((item) => ({ ...item })); }
  async put(item: Bookmark) { this.bookmarks.set(item.id, { ...item }); }
  async listCollections() { return [...this.collections.values()].map((item) => ({ ...item })); }
  async putCollection(item: Collection) { this.collections.set(item.id, { ...item }); }
  live() { return [...this.bookmarks.values()].filter((item) => !item.deletedAt); }
  liveFolders() { return [...this.collections.values()].filter((item) => !item.deletedAt); }
}

class MemoryStore implements BridgeStateStore {
  state?: BridgeState;
  async load() { return this.state ? structuredClone(this.state) : undefined; }
  async save(state: BridgeState) { this.state = structuredClone(state); }
}

/** Stand-in for a WebDAV round trip: each record converges on the higher revision. */
function exchange(left: MemoryRepo, right: MemoryRepo) {
  for (const [from, to] of [[left, right], [right, left]] as const) {
    for (const item of from.bookmarks.values()) { const other = to.bookmarks.get(item.id); if (!other || item.revision > other.revision) to.bookmarks.set(item.id, { ...item }); }
    for (const item of from.collections.values()) { const other = to.collections.get(item.id); if (!other || item.revision > other.revision) to.collections.set(item.id, { ...item }); }
  }
}

function setup(flavor: 'chrome' | 'firefox' = 'chrome') {
  const native = new FakeNative(flavor);
  const repo = new MemoryRepo();
  const store = new MemoryStore();
  const run = () => reconcileNativeBookmarks(native, repo, store);
  return { native, repo, store, run };
}

describe('native bookmark bridge', () => {
  it('imports the browser tree, maps the bars and leaves unsyncable items alone', async () => {
    const { native, repo, run } = setup();
    native.add(native.bar, 'GitHub', 'https://github.com/');
    const dev = native.add(native.bar, 'Dev');
    native.add(dev, 'MDN', 'https://developer.mozilla.org/');
    native.add(native.other, 'Hacker News', 'https://news.ycombinator.com/');
    native.add(native.other, 'Bookmarklet', 'javascript:alert(1)');
    native.add(native.mobile, 'Phone only', 'https://phone.example/');

    const first = await run();
    expect(first.nativeChanges).toBe(0);
    expect(first.skipped).toBe(1);
    const toolbar = repo.collections.get(ROOT_TOOLBAR_ID)!;
    expect(toolbar).toMatchObject({ toolbar: true, name: 'Bookmarks bar' });
    const devFolder = repo.liveFolders().find((item) => item.name === 'Dev')!;
    expect(devFolder.parentId).toBe(ROOT_TOOLBAR_ID);
    const byTitle = (title: string) => repo.live().find((item) => item.title === title);
    expect(byTitle('GitHub')).toMatchObject({ collectionId: ROOT_TOOLBAR_ID, position: 0 });
    expect(devFolder.position).toBe(1);
    expect(byTitle('MDN')?.collectionId).toBe(devFolder.id);
    expect(byTitle('Hacker News')?.collectionId).toBeUndefined();
    expect(byTitle('Phone only')).toBeUndefined();
    expect(repo.live().some((item) => item.url.startsWith('javascript:'))).toBe(false);

    const second = await run();
    expect(second).toMatchObject({ repoChanges: 0, nativeChanges: 0 });
    expect(native.shape(native.other)).toEqual(['Hacker News', 'Bookmarklet']);
  });

  it('carries browser edits, moves and deletions into the store', async () => {
    const { native, repo, run } = setup();
    const github = native.add(native.bar, 'GitHub', 'https://github.com/');
    const dev = native.add(native.bar, 'Dev');
    const mdn = native.add(dev, 'MDN', 'https://developer.mozilla.org/');
    const hn = native.add(native.other, 'Hacker News', 'https://news.ycombinator.com/');
    await run();
    const idOf = (title: string) => repo.live().find((item) => item.title === title)!.id;
    const mdnId = idOf('MDN');

    await native.update(github, { title: 'GitHub Home' });
    await native.move(hn, { parentId: dev, index: 0 });
    await native.remove(mdn);
    const report = await run();
    expect(report.nativeChanges).toBe(0);
    expect(repo.bookmarks.get(mdnId)?.deletedAt).toBeTruthy();
    expect(repo.live().find((item) => item.url === 'https://github.com/')?.title).toBe('GitHub Home');
    const devId = repo.liveFolders().find((item) => item.name === 'Dev')!.id;
    expect(repo.live().find((item) => item.title === 'Hacker News')).toMatchObject({ collectionId: devId, position: 0 });
    expect(await run()).toMatchObject({ repoChanges: 0, nativeChanges: 0 });

    // Deleting a folder in the browser removes everything under it.
    await native.removeTree(dev);
    await run();
    expect(repo.liveFolders().map((item) => item.name)).not.toContain('Dev');
    expect(repo.live().map((item) => item.title)).toEqual(['GitHub Home']);
  });

  it('applies store changes (from sync or the LumaMark pages) to the browser', async () => {
    const { native, repo, run } = setup();
    native.add(native.bar, 'GitHub', 'https://github.com/');
    const dev = native.add(native.bar, 'Dev');
    native.add(dev, 'MDN', 'https://developer.mozilla.org/');
    native.add(native.other, 'Hacker News', 'https://news.ycombinator.com/');
    await run();
    const devFolder = repo.liveFolders().find((item) => item.name === 'Dev')!;
    const hn = repo.live().find((item) => item.title === 'Hacker News')!;

    await repo.put(makeBookmark({ url: 'https://vitejs.dev/', title: 'Vite', collectionId: devFolder.id, position: -1 }));
    await repo.putCollection({ ...devFolder, name: 'Development', revision: devFolder.revision + 1, updatedAt: new Date().toISOString() });
    await repo.put({ ...hn, deletedAt: new Date().toISOString(), revision: hn.revision + 1 });
    await repo.putCollection({ id: 'remote-folder', name: 'Reading', position: 5, toolbar: false, createdAt: '2024-01-01', updatedAt: '2024-01-01', revision: 1 });
    await repo.put(makeBookmark({ url: 'https://linear.app/method', title: 'Linear Method', collectionId: 'remote-folder' }));

    const report = await run();
    expect(report.nativeChanges).toBeGreaterThan(0);
    expect(native.shape(native.bar)).toEqual(['GitHub', { Development: ['Vite', 'MDN'] }]);
    expect(native.shape(native.other)).toEqual([{ Reading: ['Linear Method'] }]);
    expect(await run()).toMatchObject({ repoChanges: 0, nativeChanges: 0 });
  });

  it('moves live bookmarks to the nearest surviving folder before removing a folder deleted in the store', async () => {
    const { native, repo, run } = setup();
    const dev = native.add(native.bar, 'Dev');
    native.add(dev, 'MDN', 'https://developer.mozilla.org/');
    await run();
    const folder = repo.liveFolders().find((item) => item.name === 'Dev')!;
    await repo.putCollection({ ...folder, deletedAt: new Date().toISOString(), revision: folder.revision + 1 });
    await run();
    expect(native.findByTitle('Dev')).toBeUndefined();
    expect(native.shape(native.bar)).toEqual(['MDN']);
    expect(repo.live().map((item) => item.title)).toEqual(['MDN']);
    expect(await run()).toMatchObject({ nativeChanges: 0 });
  });

  it('keeps an edit from another browser when this browser deleted the same bookmark', async () => {
    const { native, repo, run } = setup();
    const github = native.add(native.bar, 'GitHub', 'https://github.com/');
    await run();
    const record = repo.live()[0];
    await native.remove(github);
    await repo.put({ ...record, title: 'Edited elsewhere', revision: record.revision + 1 });
    await run();
    expect(native.shape(native.bar)).toEqual(['Edited elsewhere']);
    expect(repo.live()).toHaveLength(1);
  });

  it('converges two browsers that started with the same bookmarks without duplicates', async () => {
    const chrome = setup('chrome');
    const firefox = setup('firefox');
    chrome.native.add(chrome.native.bar, 'GitHub', 'https://github.com/');
    const cDev = chrome.native.add(chrome.native.bar, 'Dev');
    chrome.native.add(cDev, 'MDN', 'https://developer.mozilla.org/');
    firefox.native.add(firefox.native.bar, 'GitHub', 'https://github.com/');
    const fDev = firefox.native.add(firefox.native.bar, 'Dev');
    firefox.native.add(fDev, 'MDN', 'https://developer.mozilla.org/');
    firefox.native.add(firefox.native.bar, 'News', 'https://news.ycombinator.com/');
    firefox.native.add(firefox.native.menu!, 'Mozilla', 'https://www.mozilla.org/');

    for (let round = 0; round < 4; round += 1) {
      await chrome.run();
      await firefox.run();
      exchange(chrome.repo, firefox.repo);
    }
    await chrome.run();
    await firefox.run();

    const chromeBar = chrome.native.shape(chrome.native.bar);
    expect(chromeBar).toEqual(firefox.native.shape(firefox.native.bar));
    expect(chromeBar).toHaveLength(3);
    expect(JSON.stringify(chromeBar).match(/GitHub/g)).toHaveLength(1);
    expect(JSON.stringify(chromeBar).match(/MDN/g)).toHaveLength(1);
    expect(chromeBar).toContain('News');
    // Firefox's menu arrives in Chrome as a normal folder under Other bookmarks.
    expect(chrome.native.shape(chrome.native.other)).toEqual([{ 'Bookmarks Menu': ['Mozilla'] }]);
    expect(firefox.native.shape(firefox.native.menu!)).toEqual(['Mozilla']);
    expect(firefox.repo.collections.get(ROOT_MENU_ID)?.deletedAt).toBeUndefined();
    const liveIds = (repo: MemoryRepo) => repo.live().map((item) => item.id).sort();
    expect(liveIds(chrome.repo)).toEqual(liveIds(firefox.repo));
    expect(await chrome.run()).toMatchObject({ nativeChanges: 0, repoChanges: 0 });
    expect(await firefox.run()).toMatchObject({ nativeChanges: 0, repoChanges: 0 });
  });

  it('propagates a deletion and a reorder between two synced browsers', async () => {
    const a = setup('chrome');
    const b = setup('chrome');
    a.native.add(a.native.bar, 'One', 'https://one.example/');
    a.native.add(a.native.bar, 'Two', 'https://two.example/');
    a.native.add(a.native.bar, 'Three', 'https://three.example/');
    await a.run();
    exchange(a.repo, b.repo);
    await b.run();
    expect(b.native.shape(b.native.bar)).toEqual(['One', 'Two', 'Three']);

    const three = [...b.native.nodes.values()].find((node) => node.title === 'Three')!;
    await b.native.move(three.id, { parentId: b.native.bar, index: 0 });
    const two = [...b.native.nodes.values()].find((node) => node.title === 'Two')!;
    await b.native.remove(two.id);
    await b.run();
    exchange(a.repo, b.repo);
    await a.run();
    expect(a.native.shape(a.native.bar)).toEqual(['Three', 'One']);
    expect(await a.run()).toMatchObject({ nativeChanges: 0, repoChanges: 0 });
  });
});

describe('native bookmark bridge: store removals', () => {
  it('removes the browser bookmark when a fresh save is undone, but never wipes the browser after a store reset', async () => {
    const { native, repo, run } = setup();
    native.add(native.bar, 'GitHub', 'https://github.com/');
    for (let index = 0; index < 6; index += 1) native.add(native.other, `Site ${index}`, `https://site${index}.example/`);
    await run();
    const saved = makeBookmark({ url: 'https://vitejs.dev/', title: 'Vite', collectionId: ROOT_TOOLBAR_ID, position: 9 });
    await repo.put(saved);
    await run();
    expect(native.shape(native.bar)).toEqual(['GitHub', 'Vite']);
    repo.bookmarks.delete(saved.id);
    await run();
    expect(native.shape(native.bar)).toEqual(['GitHub']);

    repo.bookmarks.clear();
    repo.collections.clear();
    await run();
    expect(native.shape(native.other)).toHaveLength(6);
    expect(repo.live()).toHaveLength(7);
  });
});

describe('background with browser bookmarks', () => {
  it('imports the bookmarks bar, mirrors saves and undo, and follows browser edits', async () => {
    const native = new FakeNative('chrome');
    native.add(native.bar, 'GitHub', 'https://github.com/');
    const local: Record<string, unknown> = {};
    let listener: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void) | undefined;
    const api = {
      i18n: { getUILanguage: () => 'en' },
      tabs: { query: vi.fn().mockResolvedValue([{ url: 'https://vitejs.dev/guide/', title: 'Vite Guide' }]), create: vi.fn() },
      notifications: { create: vi.fn().mockResolvedValue('notice'), onButtonClicked: { addListener: vi.fn() } },
      runtime: { onMessage: { addListener: (callback: typeof listener) => { listener = callback; } } },
      storage: { local: { get: async (key: string) => ({ [key]: structuredClone(local[key]) }), set: async (items: Record<string, unknown>) => { Object.assign(local, structuredClone(items)); } } },
      bookmarks: native,
    };
    const repository = new IndexedDbRepository(`lumamark-native-${crypto.randomUUID()}`);
    startBackground(api, repository);
    const send = (message: unknown) => new Promise<any>((resolve) => { listener?.(message, {}, resolve); });

    await vi.waitFor(async () => expect((await repository.findByUrl('https://github.com/'))?.collectionId).toBe(ROOT_TOOLBAR_ID));
    const status = await send({ type: 'lumamark-native-status' });
    expect(status).toMatchObject({ ok: true, supported: true, enabled: true, linked: 1 });

    const saved = await send({ type: 'lumamark-save', payload: { notify: false } });
    expect(saved.ok).toBe(true);
    await vi.waitFor(() => expect(native.shape(native.bar)).toEqual(['GitHub', 'Vite Guide']), { timeout: 3000 });

    await send({ type: 'lumamark-undo', payload: { token: saved.undoToken } });
    await vi.waitFor(() => expect(native.shape(native.bar)).toEqual(['GitHub']), { timeout: 3000 });

    const github = native.findByTitle('GitHub')!;
    await native.update(github.id, { title: 'GitHub (work)' });
    native.emit();
    await vi.waitFor(async () => expect((await repository.findByUrl('https://github.com/'))?.title).toBe('GitHub (work)'), { timeout: 3000 });

    await send({ type: 'lumamark-set-native-sync', payload: { enabled: false } });
    native.add(native.other, 'Ignored', 'https://ignored.example/');
    native.emit();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await repository.findByUrl('https://ignored.example/')).toBeUndefined();
    expect((await send({ type: 'lumamark-native-status' })).enabled).toBe(false);
  });
});

describe('native bookmark bridge: ordering', () => {
  it('keeps the synced order when a fresh browser joins', async () => {
    const a = setup('chrome');
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) a.native.add(a.native.bar, name, `https://${name.toLowerCase()}.example/`);
    await a.run();
    const b = setup('firefox');
    exchange(a.repo, b.repo);
    const revisions = [...b.repo.bookmarks.values()].map((item) => item.revision);
    await b.run();
    expect(b.native.shape(b.native.bar)).toEqual(['One', 'Two', 'Three', 'Four', 'Five']);
    expect([...b.repo.bookmarks.values()].map((item) => item.revision)).toEqual(revisions);
  });

  it('places a bookmark added in the middle of the bar where the user put it', async () => {
    const { native, repo, run } = setup();
    for (const name of ['One', 'Two', 'Three']) native.add(native.bar, name, `https://${name.toLowerCase()}.example/`);
    await run();
    const id = String(native.next++);
    (native as any).attach(native.bar, { id, title: 'Inserted', url: 'https://inserted.example/', children: [] }, 1);
    await run();
    const order = repo.live().filter((item) => item.collectionId === ROOT_TOOLBAR_ID).sort((x, y) => x.position - y.position).map((item) => item.title);
    expect(order).toEqual(['One', 'Inserted', 'Two', 'Three']);
    expect(native.shape(native.bar)).toEqual(['One', 'Inserted', 'Two', 'Three']);
  });
});
