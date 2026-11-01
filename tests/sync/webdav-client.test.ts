import { afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { startBackground, webDavClient } from '../../apps/extension/src/background/index';
import { IndexedDbRepository } from '../../packages/storage/src/index';
import { makeBookmark } from '../../packages/domain/src/index';
import type { SyncManifest } from '../../packages/sync/src/index';

const manifest: SyncManifest = { format: 'lumamark-sync', schemaVersion: 2, generatedAt: '2024-01-01', deviceId: 'remote', bookmarks: [], collections: [] };
const config = { key: 'sync-config' as const, url: 'https://dav.example/', path: 'lumamark.json', autoSync: true };

describe('WebDAV transport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('bypasses cached snapshots and preserves the exact ETag on conditional writes', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(manifest, { headers: { ETag: '"fresh-version"' } }))
      .mockResolvedValueOnce(new Response('', { status: 412 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = webDavClient(config);
    const snapshot = await client.read();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
    await expect(client.write(manifest, snapshot.etag)).rejects.toMatchObject({ status: 412 });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PUT', headers: { 'If-Match': '"fresh-version"' } });
  });

  it('does not overwrite a manifest created by another device after a 404', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 412 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = webDavClient(config);
    await expect(client.read()).rejects.toMatchObject({ status: 404 });
    await expect(client.write(manifest)).rejects.toMatchObject({ status: 412 });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PUT', headers: { 'If-None-Match': '*' } });
  });

  it('keeps auto sync enabled after manual and alarm retries exhaust on 412', async () => {
    const repository = new IndexedDbRepository('busy-remote-' + crypto.randomUUID());
    await repository.setSyncConfig(config);
    await repository.put(makeBookmark({ url: 'https://local.example/', title: 'Local' }));
    let listener: any;
    let alarm: any;
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === 'PUT'
      ? new Response('', { status: 412 }) : Response.json(manifest, { headers: { ETag: '"version"' } }));
    vi.stubGlobal('fetch', fetchMock);
    startBackground({
      tabs: { query: async () => [] },
      runtime: { onMessage: { addListener: (callback: any) => { listener = callback; } } },
      alarms: { create: vi.fn(), clear: vi.fn(), onAlarm: { addListener: (callback: any) => { alarm = callback; } } },
    }, repository);
    const response = await new Promise<any>((resolve) => listener({ type: 'lumamark-sync' }, {}, resolve));
    expect(response).toMatchObject({ status: 'error', retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect((await repository.getSyncConfig())?.autoSync).toBe(true);
    alarm({ name: 'lumamark-auto-sync' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(12));
    expect((await repository.getSyncConfig())?.autoSync).toBe(true);
  });
});
