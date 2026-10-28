import { describe, expect, it, vi } from 'vitest';
import { captureActivePage, notifySaveResult, resolveExtensionApi, saveActionsForResult, saveActivePage } from '../../packages/browser/src/index';
import { readPageMetadata } from '../../apps/extension/src/content/index';
import { BookmarkService, makeBookmark } from '../../packages/domain/src/index';
import { planImport } from '../../packages/import-export/src/index';
import { applyImportPlan } from '../../apps/extension/src/background/index';
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
      for (const file of ['manifest.json', 'background.js', 'content.js', 'popup.html', 'library.html', 'settings.html']) {
        expect(existsSync(`dist/extension/${target}/${file}`)).toBe(true);
      }
      expect(readFileSync(`dist/extension/${target}/background.js`, 'utf8')).toContain('lumamark-save-page');
      expect(readFileSync(`dist/extension/${target}/content.js`, 'utf8')).toContain('lumamark-page-metadata');
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

  it('updates an existing import in place instead of creating a duplicate', async () => {
    const existing = makeBookmark({ id: 'existing-id', url: 'https://example.test', title: 'Old title' });
    const imported = makeBookmark({ id: 'import-id', url: 'https://example.test', title: 'New title' });
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
    expect(records.has(imported.id)).toBe(false);
  });
});

