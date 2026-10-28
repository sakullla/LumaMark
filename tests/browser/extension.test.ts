import { describe, expect, it, vi } from 'vitest';
import { captureActivePage, notifySaveResult, resolveExtensionApi, saveActionsForResult, saveActivePage } from '../../packages/browser/src/index';
import { readPageMetadata } from '../../apps/extension/src/content/index';
import { BookmarkService, makeBookmark } from '../../packages/domain/src/index';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

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
    }
  });
});

