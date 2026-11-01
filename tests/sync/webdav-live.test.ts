import { expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { webDavClient } from '../../apps/extension/src/background/index';
import { makeBookmark, type Collection } from '../../packages/domain/src/index';
import { IndexedDbRepository } from '../../packages/storage/src/index';
import { WebDavSyncEngine, type SyncManifest, type WebDavClient } from '../../packages/sync/src/index';

// Opt-in only. Every run creates its own resource and removes it in finally;
// the configured folder's actual sync manifest is never read or modified.
const base = process.env.LUMAMARK_WEBDAV_TEST_URL;
const username = process.env.LUMAMARK_WEBDAV_TEST_USER;
const password = process.env.LUMAMARK_WEBDAV_TEST_PASSWORD;

it.skipIf(!base || !username || !password)('recovers a real WebDAV 412 without losing another writer\'s folder or bookmark', async () => {
  const path = `lumamark-integration-${crypto.randomUUID()}.json`;
  const config = { key: 'sync-config' as const, url: base!, path, username, password, autoSync: false };
  const repository = new IndexedDbRepository('live-dav-' + crypto.randomUUID());
  const local = makeBookmark({ url: 'https://local.example/', title: 'Local test bookmark' });
  await repository.put(local);
  const stamp = new Date().toISOString();
  const folder: Collection = { id: crypto.randomUUID(), name: 'Concurrent test folder', position: 0, toolbar: false, createdAt: stamp, updatedAt: stamp, revision: 1 };
  const remote = makeBookmark({ url: 'https://remote.example/', title: 'Remote test bookmark', collectionId: folder.id });
  const seed: SyncManifest = { format: 'lumamark-sync', schemaVersion: 2, generatedAt: stamp, deviceId: 'other', bookmarks: [], collections: [] };
  const other = webDavClient(config);
  let created = false;
  try {
    await expect(other.read()).rejects.toMatchObject({ status: 404 });
    await other.write(seed);
    created = true;
    const transport = webDavClient(config);
    let writes = 0;
    let preconditions = 0;
    const racingClient: WebDavClient = {
      read: () => transport.read(),
      async write(manifest, etag) {
        writes++;
        if (writes === 1) {
          const snapshot = await other.read();
          await other.write({ ...seed, bookmarks: [remote], collections: [folder] }, snapshot.etag);
        }
        try { return await transport.write(manifest, etag); }
        catch (error) {
          if ((error as { status?: number }).status === 412) preconditions++;
          throw error;
        }
      },
    };
    const engine = new WebDavSyncEngine(repository, racingClient);
    expect((await engine.sync()).status).toBe('idle');
    expect(preconditions).toBe(1);
    expect(writes).toBe(2);
    const final = (await other.read()).manifest!;
    expect(final.bookmarks.map((item) => item.id).sort()).toEqual([local.id, remote.id].sort());
    expect(final.collections).toEqual([folder]);
    expect(await repository.findById(remote.id)).toMatchObject({ collectionId: folder.id });
    expect((await engine.sync()).status).toBe('idle');
    expect(writes).toBe(2);
  } finally {
    await repository.close();
    if (created) {
      const response = await fetch(`${base!.replace(/\/$/, '')}/${path}`, {
        method: 'DELETE', headers: { Authorization: `Basic ${btoa(`${username}:${password}`)}` },
      });
      expect([200, 204, 404]).toContain(response.status);
    }
  }
}, 30_000);
