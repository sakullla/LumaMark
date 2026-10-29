import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { captureActivePage, notifySaveResult, resolveExtensionApi, saveActionsForResult, saveActivePage, titleForSavedLink } from '../../packages/browser/src/index';
import { readLinkTarget, readPageMetadata } from '../../apps/extension/src/content/index';
import { BookmarkService, makeBookmark, type Bookmark, type Collection } from '../../packages/domain/src/index';
import { planImport } from '../../packages/import-export/src/index';
import { applyImportPlan, startBackground } from '../../apps/extension/src/background/index';
import { placeItem } from '../../apps/extension/src/background/place';
import { IndexedDbRepository } from '../../packages/storage/src/index';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

describe('browser adapter', () => {
  it('captures the active tab and preserves a missing title for domain fallback', async () => {
    const api = { tabs: { query: vi.fn().mockResolvedValue([{ url: 'https://example.test/path#part' }]) } };
    await expect(captureActivePage(api)).resolves.toEqual({ url: 'https://example.test/path#part' });
  });

  it('saves an active page through the shared service', async () => {
    const api = { tabs: { query: vi.fn().mockResolvedValue([{ url: 'https://example.test', title: 'Example' }]) } };
    const records = new Map<string, any>();
    const service = new BookmarkService({
      list: async () => [...records.values()],
      findById: async (id) => records.get(id),
      findByUrl: async (url) => [...records.values()].find((item) => item.url === url),
      put: async (item) => { records.set(item.id, item); },
      remove: async (id) => { records.delete(id); },
    });
    const result = await saveActivePage(api, service);
    expect(result.kind).toBe('saved');
  });

  it('reads metadata from a favicon link', () => {
    const metadata = readPageMetadata({ title: 'Example', querySelector: () => ({ href: 'https://example.test/icon.png' }) as HTMLLinkElement });
    expect(metadata).toEqual({ type: 'lumamark-page-metadata', title: 'Example', faviconUrl: 'https://example.test/icon.png' });
  });

  it('reads the visible text of an http(s) link and ignores other addresses', () => {
    const anchor = { href: 'https://link.example/a', innerText: ' Docs ', textContent: 'Docs' };
    expect(readLinkTarget({ closest: () => anchor })).toEqual({ url: 'https://link.example/a', title: 'Docs' });
    expect(readLinkTarget({ closest: () => ({ href: 'https://link.example/b', innerText: '', textContent: '' }) })).toEqual({ url: 'https://link.example/b', title: '' });
    expect(readLinkTarget({ closest: () => ({ href: 'chrome://extensions', textContent: 'Extensions' }) })).toBeUndefined();
    expect(titleForSavedLink({ menuItemId: 'lumamark-save-page', linkUrl: 'https://link.example/a' }, 'Docs')).toBe('Docs');
    expect(titleForSavedLink({ menuItemId: 'lumamark-save-page', linkUrl: 'https://link.example/b', selectionText: 'Selected' }, ' ')).toBe('https://link.example/b');
    expect(titleForSavedLink({ menuItemId: 'lumamark-save-page', linkUrl: 'https://link.example/a', linkText: 'Link title' }, 'Other')).toBe('Link title');
  });

  it('resolves browser before chrome APIs', () => {
    const tabs = { query: vi.fn() };
    expect(resolveExtensionApi({ browser: { tabs }, chrome: { tabs: { query: vi.fn() } } })).toEqual({ tabs });
  });

  it('exposes actionable save feedback for saved and existing records', async () => {
    const saved = { kind: 'saved' as const, bookmark: makeBookmark({ url: 'https://example.test' }), undoToken: 'x' };
    expect(saveActionsForResult(saved).map((action) => action.id)).toEqual(['open-library', 'undo']);
    const existing = { kind: 'existing' as const, existing: saved.bookmark };
    expect(saveActionsForResult(existing).map((action) => action.id)).toEqual(['open-existing', 'update-existing', 'copy-existing']);
    const clicked: string[] = [];
    let onButton: ((id: string, index: number) => void) | undefined;
    const api = { tabs: { query: vi.fn() }, notifications: { create: vi.fn().mockResolvedValue('id'), onButtonClicked: { addListener: (listener: (id: string, index: number) => void) => { onButton = listener; } } } };
    await notifySaveResult(api, saved, { undo: () => { clicked.push('undo'); } });
    expect(api.notifications.create).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ buttons: [{ title: 'Open library' }, { title: 'Undo' }] }));
    onButton?.(api.notifications.create.mock.calls[0][0], 1);
    expect(clicked).toEqual(['undo']);
  });

  it('builds installable files for every browser target', () => {
    execFileSync(process.execPath, ['scripts/build-extension.mjs'], { stdio: 'ignore' });
    for (const target of ['chrome', 'firefox', 'safari']) {
      for (const file of ['manifest.json', 'background.js', 'content.js', 'popup.html', 'library.html', 'settings.html', 'home.html', 'home.js']) {
        expect(existsSync(`dist/extension/${target}/${file}`)).toBe(true);
      }
      const manifest = JSON.parse(readFileSync(`dist/extension/${target}/manifest.json`, 'utf8'));
      expect(manifest.chrome_url_overrides.newtab).toBe('home.html');
      expect(manifest.permissions).not.toContain('bookmarks');
      expect(readFileSync(`dist/extension/${target}/background.js`, 'utf8')).toContain('lumamark-save-page');
      expect(readFileSync(`dist/extension/${target}/background.js`, 'utf8')).toContain('return true');
      const content = readFileSync(`dist/extension/${target}/content.js`, 'utf8');
      expect(content).toContain('lumamark-page-metadata');
      expect(content).toContain('lumamark-link-context');
      expect(content).not.toContain('bookmark-bar');
      expect(readFileSync(`dist/extension/${target}/home.js`, 'utf8')).toContain('bookmark-bar');
      const popup = readFileSync(`dist/extension/${target}/popup.js`, 'utf8');
      const library = readFileSync(`dist/extension/${target}/library.js`, 'utf8');
      const settings = readFileSync(`dist/extension/${target}/settings.js`, 'utf8');
      expect(popup).toContain('lumamark-save');
      expect(popup).toContain('Undo last save');
      expect(library).toContain('lumamark-list');
      expect(library).toContain('No matching bookmarks');
      expect(library).toContain('batch-delete');
      expect(settings).toContain('lumamark-sync-configure');
      expect(settings).toContain('lumamark-import');
      expect(settings).toContain('lumamark-export');
      expect(settings).not.toContain('Sync requested. Configure WebDAV in the host app.');
    }
  });

  it('keeps asynchronous background responses open for runtime messages', async () => {
    type RuntimeMessageListener = (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void;
    let listener: RuntimeMessageListener | undefined;
    const api = {
      tabs: { query: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue(undefined) },
      runtime: { onMessage: { addListener: (callback: RuntimeMessageListener) => { listener = callback; } } },
    };
    startBackground(api);

    expect(listener).toBeDefined();
    let response: unknown;
    const keepChannelOpen = listener?.({ type: 'lumamark-list' }, {}, (value) => { response = value; });
    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => expect(response).toEqual({ ok: true, items: [] }));
  });

  it('uses current page metadata for existing bookmark update and copy actions', async () => {
    type RuntimeMessageListener = (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void;
    const repository = new IndexedDbRepository(`lumamark-metadata-${crypto.randomUUID()}`);
    let activeTab = { url: 'https://example.test', title: 'Original title', favIconUrl: 'https://example.test/original.ico' };
    let listener: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void) | undefined;
    let notificationButtonListener: ((id: string, buttonIndex: number) => void) | undefined;
    const api = {
      tabs: { query: vi.fn().mockImplementation(async () => [activeTab]), create: vi.fn() },
      notifications: {
        create: vi.fn().mockResolvedValue('notification-id'),
        onButtonClicked: { addListener: (callback: (id: string, buttonIndex: number) => void) => { notificationButtonListener = callback; } },
      },
      runtime: { onMessage: { addListener: (callback: RuntimeMessageListener) => { listener = callback; } } },
    };
    startBackground(api, repository);
    const send = (message: unknown) => new Promise<unknown>((resolve) => {
      listener?.(message, {}, resolve);
    });

    await send({ type: 'lumamark-save' });
    activeTab = { url: 'https://example.test', title: 'Updated title', favIconUrl: 'https://example.test/updated.ico' };
    await send({ type: 'lumamark-save' });
    const existingNotificationId = api.notifications.create.mock.calls.at(-1)?.[0] as string;
    notificationButtonListener?.(existingNotificationId, 1);
    await vi.waitFor(async () => {
      const updated = await repository.findByUrl('https://example.test/');
      expect(updated?.title).toBe('Updated title');
      expect(updated?.faviconUrl).toBe('https://example.test/updated.ico');
    });

    activeTab = { url: 'https://example.test', title: 'Copied title', favIconUrl: 'https://example.test/copied.ico' };
    await send({ type: 'lumamark-save' });
    const copyNotificationId = api.notifications.create.mock.calls.at(-1)?.[0] as string;
    notificationButtonListener?.(copyNotificationId, 2);
    await vi.waitFor(async () => {
      const records = await repository.list({ includeDeleted: true });
      expect(records).toHaveLength(2);
      expect(records.some((item) => item.title === 'Copied title' && item.faviconUrl === 'https://example.test/copied.ico')).toBe(true);
    });
  });

  it('updates an existing import in place instead of creating a duplicate', async () => {
    const existing = makeBookmark({ id: 'existing-id', url: 'https://example.test', title: 'Old title' });
    const imported = makeBookmark({ id: 'import-id', url: 'https://example.test', title: 'New title', position: 3 });
    const records = new Map([[existing.id, existing]]);
    const repository = {
      list: async () => [...records.values()],
      findById: async (id: string) => records.get(id),
      findByUrl: async (url: string) => [...records.values()].find((item) => item.url === url),
      put: async (item: typeof existing) => { records.set(item.id, item); },
      remove: async (id: string) => { records.delete(id); },
    };
    const plan = planImport({ bookmarks: [imported], collections: [], issues: [] }, [existing], 'update');
    await applyImportPlan(plan, new BookmarkService(repository), repository);
    expect(records.size).toBe(1);
    expect(records.get(existing.id)?.title).toBe('New title');
    expect(records.get(existing.id)?.position).toBe(3);
    expect(records.has(imported.id)).toBe(false);
  });

  it('persists a drag move and refuses a folder cycle without writes', async () => {
    const name = `lumamark-place-${crypto.randomUUID()}`;
    const repository = new IndexedDbRepository(name);
    const now = '2024-03-01T00:00:00.000Z';
    const toolbar: Collection = { id: 'toolbar', name: 'Toolbar', position: 0, toolbar: true, createdAt: now, updatedAt: now, revision: 1 };
    const first = makeBookmark({ url: 'https://a.example/a', title: 'A', collectionId: toolbar.id, position: 0 }, now);
    const second = makeBookmark({ url: 'https://b.example/b', title: 'B', collectionId: toolbar.id, position: 1 }, now);
    const third = makeBookmark({ url: 'https://c.example/c', title: 'C', collectionId: toolbar.id, position: 2 }, now);
    await repository.putCollection(toolbar);
    await repository.put(first);
    await repository.put(second);
    await repository.put(third);
    await placeItem(repository, { kind: 'bookmark', id: second.id, parentId: toolbar.id, beforeId: first.id });
    await placeItem(repository, { kind: 'bookmark', id: third.id, parentId: '' });
    const reopened = new IndexedDbRepository(name);
    const stored = await reopened.list({ includeDeleted: true });
    expect(stored.find((item) => item.id === second.id)).toMatchObject({ position: 0, collectionId: toolbar.id, revision: 2 });
    expect(stored.find((item) => item.id === first.id)).toMatchObject({ position: 1, collectionId: toolbar.id });
    expect(stored.find((item) => item.id === third.id)?.collectionId).toBeUndefined();
    const parent: Collection = { id: 'parent', name: 'Parent', position: 0, toolbar: false, createdAt: now, updatedAt: now, revision: 1 };
    const child: Collection = { id: 'child', name: 'Child', parentId: parent.id, position: 0, toolbar: false, createdAt: now, updatedAt: now, revision: 1 };
    const writes: string[] = [];
    await expect(placeItem({
      list: async () => [],
      put: async () => { writes.push('bookmark'); },
      listCollections: async () => [parent, child],
      putCollection: async () => { writes.push('folder'); },
    }, { kind: 'folder', id: parent.id, parentId: child.id })).rejects.toThrow(/itself/);
    expect(writes).toEqual([]);
    expect(parent.revision).toBe(1);
  });

  it('saves a link from the context menu and leaves unsavable pages untouched', async () => {
    const repository = new IndexedDbRepository(`lumamark-menu-${crypto.randomUUID()}`);
    let menuListener: ((info: { menuItemId: string; linkUrl?: string; linkText?: string; selectionText?: string; pageUrl?: string }) => void) | undefined;
    let activeTab = { url: 'https://page.example/current', title: 'Current page' };
    const api = {
      i18n: { getUILanguage: () => 'en' },
      tabs: { query: vi.fn().mockImplementation(async () => [activeTab]), create: vi.fn() },
      notifications: { create: vi.fn().mockResolvedValue('notice'), onButtonClicked: { addListener: vi.fn() } },
      contextMenus: { create: vi.fn(), onClicked: { addListener: (listener: typeof menuListener) => { menuListener = listener; } } },
      runtime: { onMessage: { addListener: vi.fn() } },
    };
    startBackground(api, repository);
    menuListener?.({ menuItemId: 'lumamark-save-page', linkUrl: 'https://link.example/a', linkText: 'Link title', pageUrl: 'https://page.example/current' });
    await vi.waitFor(async () => {
      expect((await repository.findByUrl('https://link.example/a'))?.title).toBe('Link title');
    });
    expect(await repository.findByUrl('https://page.example/current')).toBeUndefined();

    activeTab = { url: 'chrome://extensions', title: 'Extensions' };
    let response: { ok?: boolean; unsavable?: boolean } | undefined;
    const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0] as ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void) | undefined;
    listener?.({ type: 'lumamark-save' }, {}, (value) => { response = value as typeof response; });
    await vi.waitFor(() => expect(response?.unsavable).toBe(true));
    expect(await repository.list()).toHaveLength(1);
    expect(api.notifications.create).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ title: 'Cannot save' }));
  });

  it('saves a link title supplied by the page when the menu has no link text', async () => {
    const repository = new IndexedDbRepository(`lumamark-link-text-${crypto.randomUUID()}`);
    let menuListener: ((info: { menuItemId: string; linkUrl?: string; selectionText?: string; pageUrl?: string }) => void) | undefined;
    let listener: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void) | undefined;
    const api = {
      i18n: { getUILanguage: () => 'en' },
      tabs: { query: vi.fn().mockResolvedValue([{ url: 'https://page.example/current', title: 'Current page' }]), create: vi.fn() },
      notifications: { create: vi.fn().mockResolvedValue('notice'), onButtonClicked: { addListener: vi.fn() } },
      contextMenus: { create: vi.fn(), onClicked: { addListener: (callback: typeof menuListener) => { menuListener = callback; } } },
      runtime: { onMessage: { addListener: (callback: typeof listener) => { listener = callback; } } },
    };
    startBackground(api, repository);
    const send = (message: unknown) => new Promise<unknown>((resolve) => { listener?.(message, {}, resolve); });
    await send({ type: 'lumamark-link-context', payload: { url: 'https://link.example/a', title: 'Docs' } });
    menuListener?.({ menuItemId: 'lumamark-save-page', linkUrl: 'https://link.example/a', pageUrl: 'https://page.example/current' });
    await vi.waitFor(async () => {
      expect((await repository.findByUrl('https://link.example/a'))?.title).toBe('Docs');
    });
    await send({ type: 'lumamark-link-context', payload: { url: 'https://link.example/b', title: '  ' } });
    menuListener?.({ menuItemId: 'lumamark-save-page', linkUrl: 'https://link.example/b', selectionText: 'Selected', pageUrl: 'https://page.example/current' });
    await vi.waitFor(async () => {
      expect((await repository.findByUrl('https://link.example/b'))?.title).toBe('https://link.example/b');
    });
  });

  it('undoes only the recorded save or delete, including after a background restart', async () => {
    const repository = new IndexedDbRepository(`lumamark-undo-${crypto.randomUUID()}`);
    const kept = makeBookmark({ url: 'https://kept.example/a', title: 'Kept' });
    await repository.put(kept);
    const memory: Record<string, unknown> = {};
    const storage = {
      local: {
        get: async (keys?: string | string[] | Record<string, unknown> | null) => (typeof keys === 'string' ? { [keys]: memory[keys] } : { ...memory }),
        set: async (items: Record<string, unknown>) => { Object.assign(memory, items); },
      },
    };
    let activeTab = { url: 'https://new.example/a', title: 'New' };
    let listener: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void) | undefined;
    const api = {
      i18n: { getUILanguage: () => 'en' },
      tabs: { query: vi.fn().mockImplementation(async () => [activeTab]), create: vi.fn() },
      notifications: { create: vi.fn().mockResolvedValue('notice'), onButtonClicked: { addListener: vi.fn() } },
      storage,
      runtime: { onMessage: { addListener: (callback: typeof listener) => { listener = callback; } } },
    };
    startBackground(api, repository);
    const send = (message: unknown) => new Promise<any>((resolve) => { listener?.(message, {}, resolve); });
    const removed = await send({ type: 'lumamark-delete', payload: { ids: [kept.id] } });
    expect(removed.undoToken).toEqual(expect.any(String));
    expect((await send({ type: 'lumamark-save' })).ok).toBe(true);
    expect(await send({ type: 'lumamark-undo', payload: { token: removed.undoToken } })).toMatchObject({ ok: true });
    expect((await repository.findById(kept.id))?.deletedAt).toBeUndefined();
    expect((await repository.findByUrl('https://new.example/a'))?.title).toBe('New');
    expect(await send({ type: 'lumamark-undo', payload: { token: removed.undoToken } })).toMatchObject({ ok: false });
    expect(await send({ type: 'lumamark-undo' })).toMatchObject({ ok: false });

    activeTab = { url: 'https://notice.example/a', title: 'Notice' };
    expect((await send({ type: 'lumamark-save' })).ok).toBe(true);
    const notificationId = api.notifications.create.mock.calls.at(-1)?.[0] as string;
    const saved = await repository.findByUrl('https://notice.example/a');
    expect(saved?.deletedAt).toBeUndefined();
    const buttonListeners: Array<(id: string, index: number) => void> = [];
    startBackground({
      i18n: { getUILanguage: () => 'en' },
      tabs: { query: vi.fn().mockResolvedValue([]), create: vi.fn() },
      notifications: { create: vi.fn(), onButtonClicked: { addListener: (callback: (id: string, index: number) => void) => { buttonListeners.push(callback); } } },
      storage,
      runtime: { onMessage: { addListener: vi.fn() } },
    }, repository);
    buttonListeners[0]?.(notificationId, 1);
    await vi.waitFor(async () => {
      expect((await repository.findById(saved!.id))?.deletedAt).toEqual(expect.any(String));
    });
    expect((await repository.findById(kept.id))?.deletedAt).toBeUndefined();
  });

  it('rejects an invalid URL edit and a failed write without changing stored bookmarks', async () => {
    const repository = new IndexedDbRepository(`lumamark-edit-${crypto.randomUUID()}`);
    const existing = makeBookmark({ url: 'https://keep.example/a', title: 'Keep' });
    await repository.put(existing);
    let listener: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void) | undefined;
    startBackground({
      i18n: { getUILanguage: () => 'en' },
      tabs: { query: vi.fn().mockResolvedValue([{ url: 'https://keep.example/a', title: 'Keep' }]), create: vi.fn() },
      notifications: { create: vi.fn().mockResolvedValue('notice'), onButtonClicked: { addListener: vi.fn() } },
      runtime: { onMessage: { addListener: (callback: typeof listener) => { listener = callback; } } },
    }, repository);
    const send = (message: unknown) => new Promise<any>((resolve) => { listener?.(message, {}, resolve); });
    const invalid = await send({ type: 'lumamark-update', payload: { id: existing.id, update: { url: 'ftp://bad.example/a', title: 'Changed' } } });
    expect(invalid).toMatchObject({ ok: false, error: 'invalid-url' });
    expect(await repository.findById(existing.id)).toMatchObject({ url: existing.url, title: 'Keep', revision: existing.revision });

    class RejectingBookmarkPut extends IndexedDbRepository {
      override async put(bookmark: Bookmark): Promise<void> {
        if (bookmark.url.startsWith('https://reject.example')) throw new Error('disk full');
        await super.put(bookmark);
      }
    }
    const failing = new RejectingBookmarkPut(`lumamark-fail-${crypto.randomUUID()}`);
    const kept = makeBookmark({ url: 'https://kept.example/a', title: 'Kept' });
    await failing.put(kept);
    let failListener: typeof listener;
    const failingApi = {
      i18n: { getUILanguage: () => 'en' },
      tabs: { query: vi.fn().mockResolvedValue([{ url: 'https://reject.example/new', title: 'Should not stick' }]), create: vi.fn() },
      notifications: { create: vi.fn().mockResolvedValue('notice'), onButtonClicked: { addListener: vi.fn() } },
      runtime: { onMessage: { addListener: (callback: typeof listener) => { failListener = callback; } } },
    };
    startBackground(failingApi, failing);
    const failSend = (message: unknown) => new Promise<any>((resolve) => { failListener?.(message, {}, resolve); });
    const failed = await failSend({ type: 'lumamark-save' });
    expect(failed.ok).toBe(false);
    expect(await failing.list()).toEqual([expect.objectContaining({ id: kept.id, title: 'Kept' })]);
    expect(failingApi.notifications.create).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ title: 'Not saved' }));
  });

  it('selects a toolbar folder and deletes a folder without removing its bookmarks', async () => {
    const repository = new IndexedDbRepository(`lumamark-folder-${crypto.randomUUID()}`);
    const now = '2024-04-01T00:00:00.000Z';
    const bar: Collection = { id: 'bar', name: 'Bar', position: 0, toolbar: false, createdAt: now, updatedAt: now, revision: 1 };
    const other: Collection = { id: 'other', name: 'Other', position: 1, toolbar: true, createdAt: now, updatedAt: now, revision: 1 };
    const bookmark = makeBookmark({ url: 'https://inside.example/a', title: 'Inside', collectionId: bar.id }, now);
    await repository.putCollection(bar);
    await repository.putCollection(other);
    await repository.put(bookmark);
    let listener: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void) | undefined;
    startBackground({
      tabs: { query: vi.fn().mockResolvedValue([]), create: vi.fn() },
      runtime: { onMessage: { addListener: (callback: typeof listener) => { listener = callback; } } },
    }, repository);
    const send = (message: unknown) => new Promise<any>((resolve) => { listener?.(message, {}, resolve); });
    expect((await send({ type: 'lumamark-set-toolbar', payload: { id: bar.id } })).ok).toBe(true);
    const selected = await repository.listCollections();
    expect(selected.find((item) => item.id === bar.id)?.toolbar).toBe(true);
    expect(selected.find((item) => item.id === other.id)?.toolbar).toBe(false);
    expect((await send({ type: 'lumamark-collection-delete', payload: { id: bar.id } })).ok).toBe(true);
    expect(await repository.list({ includeDeleted: true })).toHaveLength(1);
    expect((await repository.listCollections()).find((item) => item.id === bar.id)?.deletedAt).toEqual(expect.any(String));
    expect((await send({ type: 'lumamark-collection-restore', payload: { id: bar.id } })).ok).toBe(true);
    expect((await repository.listCollections()).find((item) => item.id === bar.id)?.deletedAt).toBeUndefined();
    expect(await repository.list({ includeDeleted: true })).toHaveLength(1);
  });

  it('probes WebDAV, omits the password, and keeps the search address out of the sync manifest', async () => {
    const repository = new IndexedDbRepository(`lumamark-probe-${crypto.randomUUID()}`);
    const kept = makeBookmark({ url: 'https://kept.example/a', title: 'Kept' });
    await repository.put(kept);
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    let mode: '401' | '403' | '404' | 'throw' = '401';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : undefined;
      calls.push({ url: String(input), method, body });
      if (mode === 'throw') throw new Error('Failed to fetch');
      if (method === 'PUT') return new Response('{}', { status: 200, headers: { etag: 'W/"1"' } });
      const status = mode === '401' ? 401 : mode === '403' ? 403 : 404;
      return new Response('remote', { status });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      let listener: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void) | undefined;
      startBackground({
        i18n: { getUILanguage: () => 'en' },
        tabs: { query: vi.fn().mockResolvedValue([]), create: vi.fn() },
        storage: { local: { get: async () => ({}), set: async () => undefined } },
        runtime: { onMessage: { addListener: (callback: typeof listener) => { listener = callback; } } },
      }, repository);
      const send = (message: unknown) => new Promise<any>((resolve) => { listener?.(message, {}, resolve); });
      const denied = await send({ type: 'lumamark-sync-configure', payload: { url: 'https://dav.example/auth-fail', path: 'lumamark.json', username: 'me', password: 'secret-value' } });
      expect(denied).toMatchObject({ ok: true, probe: 'credentials', autoSync: false });
      expect(JSON.stringify(denied)).not.toContain('secret-value');
      expect((await send({ type: 'lumamark-sync-status' })).metadata).toMatchObject({ status: 'error', error: 'credentials', autoSync: false });
      expect(await repository.list()).toEqual([expect.objectContaining({ id: kept.id })]);
      mode = '403';
      expect(await send({ type: 'lumamark-sync-configure', payload: { url: 'https://dav.example/rejected', path: 'lumamark.json', username: 'me', password: '' } })).toMatchObject({ probe: 'rejected', autoSync: false });
      mode = 'throw';
      expect(await send({ type: 'lumamark-sync-configure', payload: { url: 'https://dav.example/offline', path: 'lumamark.json', username: 'me' } })).toMatchObject({ probe: 'unreachable', autoSync: false });
      mode = '404';
      const connected = await send({ type: 'lumamark-sync-configure', payload: { url: 'https://dav.example/missing-file', path: 'lumamark.json', username: 'me', password: 'secret-value' } });
      expect(connected).toMatchObject({ probe: 'ok', autoSync: true });
      const config = await send({ type: 'lumamark-get-sync-config' });
      expect(config.config.password).toBeUndefined();
      expect(JSON.stringify(config)).not.toContain('secret-value');
      const beforeEmpty = calls.length;
      expect(await send({ type: 'lumamark-sync-configure', payload: { url: '', path: 'lumamark.json' } })).toMatchObject({ probe: 'empty', autoSync: false });
      expect(calls).toHaveLength(beforeEmpty);
      await send({ type: 'lumamark-sync-configure', payload: { url: 'https://dav.example/missing-file', path: 'lumamark.json', username: 'me' } });
      await send({ type: 'lumamark-set-search-engine', payload: { url: 'https://search.example/find?q={query}' } });
      const synced = await send({ type: 'lumamark-sync' });
      expect(synced.status).toBe('idle');
      const put = calls.find((call) => call.method === 'PUT');
      expect(put?.body).toBeTruthy();
      expect(put?.body).not.toContain('search.example');
      expect(put?.body).not.toContain('searchUrl');
      const beforeOff = calls.length;
      expect(await send({ type: 'lumamark-set-auto-sync', payload: { autoSync: false } })).toMatchObject({ ok: true, autoSync: false });
      expect(calls).toHaveLength(beforeOff);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

