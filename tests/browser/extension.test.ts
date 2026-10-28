import { describe, expect, it, vi } from 'vitest';
import { captureActivePage, resolveExtensionApi, saveActivePage } from '../../packages/browser/src/index';
import { readPageMetadata } from '../../apps/extension/src/content/index';
import { BookmarkService } from '../../packages/domain/src/index';

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
});

