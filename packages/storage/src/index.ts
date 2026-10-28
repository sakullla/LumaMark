import {
  Bookmark,
  BookmarkQuery,
  BookmarkRepository,
  Collection,
  ConflictRecord,
  CURRENT_SCHEMA_VERSION,
  SyncMetadata,
  SyncConfig,
} from '../../domain/src/index';

const DB_VERSION = 2;
const BOOKMARKS = 'bookmarks';
const COLLECTIONS = 'collections';
const META = 'meta';
const CONFLICTS = 'conflicts';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class IndexedDbRepository implements BookmarkRepository {
  private dbPromise?: Promise<IDBDatabase>;

  public constructor(private readonly dbName = 'lumamark') {}

  private async db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(BOOKMARKS)) {
          const store = db.createObjectStore(BOOKMARKS, { keyPath: 'id' });
          store.createIndex('url', 'url', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
          store.createIndex('collectionId', 'collectionId', { unique: false });
        }
        if (!db.objectStoreNames.contains(COLLECTIONS)) {
          const store = db.createObjectStore(COLLECTIONS, { keyPath: 'id' });
          store.createIndex('parentId', 'parentId', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(CONFLICTS)) db.createObjectStore(CONFLICTS, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB'));
    });
    return this.dbPromise;
  }

  async list(query: BookmarkQuery = {}): Promise<Bookmark[]> {
    const db = await this.db();
    const tx = db.transaction(BOOKMARKS, 'readonly');
    const values = await requestResult(tx.objectStore(BOOKMARKS).getAll());
    await transactionDone(tx);
    const needle = query.text?.trim().toLowerCase();
    const filtered = values.filter((item) => {
      if (!query.includeDeleted && item.deletedAt) return false;
      if (query.collectionId !== undefined && item.collectionId !== query.collectionId) return false;
      if (query.tag !== undefined && !item.tags.includes(query.tag.toLowerCase())) return false;
      if (query.domain !== undefined && item.domain !== query.domain.toLowerCase()) return false;
      if (query.favorite !== undefined && item.favorite !== query.favorite) return false;
      if (query.from !== undefined && item.updatedAt < query.from) return false;
      if (query.to !== undefined && item.updatedAt > query.to) return false;
      if (needle && ![item.title, item.url, item.domain, item.notes, ...item.tags].some((field) => field.toLowerCase().includes(needle))) return false;
      return true;
    });
    const sort = query.sort ?? 'updatedAt';
    const direction = query.direction === 'asc' ? 1 : -1;
    filtered.sort((a, b) => String(a[sort]).localeCompare(String(b[sort])) * direction);
    const offset = query.offset ?? 0;
    return filtered.slice(offset, query.limit === undefined ? undefined : offset + query.limit);
  }

  async findById(id: string): Promise<Bookmark | undefined> {
    const db = await this.db();
    const tx = db.transaction(BOOKMARKS, 'readonly');
    const value = await requestResult(tx.objectStore(BOOKMARKS).get(id));
    await transactionDone(tx);
    return value;
  }

  async findByUrl(url: string): Promise<Bookmark | undefined> {
    const db = await this.db();
    const tx = db.transaction(BOOKMARKS, 'readonly');
    const value = await requestResult(tx.objectStore(BOOKMARKS).index('url').get(url));
    await transactionDone(tx);
    return value;
  }

  async put(bookmark: Bookmark): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(BOOKMARKS, 'readwrite');
    tx.objectStore(BOOKMARKS).put(bookmark);
    await transactionDone(tx);
  }

  async remove(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(BOOKMARKS, 'readwrite');
    tx.objectStore(BOOKMARKS).delete(id);
    await transactionDone(tx);
  }

  async listCollections(): Promise<Collection[]> {
    const db = await this.db();
    const tx = db.transaction(COLLECTIONS, 'readonly');
    const values = await requestResult(tx.objectStore(COLLECTIONS).getAll());
    await transactionDone(tx);
    return values;
  }

  async putCollection(collection: Collection): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(COLLECTIONS, 'readwrite');
    tx.objectStore(COLLECTIONS).put(collection);
    await transactionDone(tx);
  }

  async getSyncMetadata(): Promise<SyncMetadata> {
    const db = await this.db();
    const tx = db.transaction(META, 'readonly');
    const value = await requestResult(tx.objectStore(META).get('sync'));
    await transactionDone(tx);
    if (value) return value;
    const metadata: SyncMetadata = {
      key: 'sync',
      deviceId: crypto.randomUUID(),
      pendingChanges: 0,
      status: 'offline',
      autoSync: false,
    };
    await this.setSyncMetadata(metadata);
    return metadata;
  }

  async setSyncMetadata(metadata: SyncMetadata): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).put(metadata);
    await transactionDone(tx);
  }

  async getSyncConfig(): Promise<SyncConfig | undefined> {
    const db = await this.db();
    const tx = db.transaction(META, 'readonly');
    const value = await requestResult(tx.objectStore(META).get('sync-config'));
    await transactionDone(tx);
    return value;
  }

  async setSyncConfig(config: SyncConfig): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).put(config);
    await transactionDone(tx);
  }

  async putConflict(conflict: ConflictRecord): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(CONFLICTS, 'readwrite');
    tx.objectStore(CONFLICTS).put(conflict);
    await transactionDone(tx);
  }

  async listConflicts(includeResolved = false): Promise<ConflictRecord[]> {
    const db = await this.db();
    const tx = db.transaction(CONFLICTS, 'readonly');
    const values = await requestResult(tx.objectStore(CONFLICTS).getAll());
    await transactionDone(tx);
    return includeResolved ? values : values.filter((item) => !item.resolvedAt);
  }

  async close(): Promise<void> {
    if (this.dbPromise) (await this.dbPromise).close();
    this.dbPromise = undefined;
  }

  get schemaVersion(): number { return CURRENT_SCHEMA_VERSION; }
}

export type StorageRepository = IndexedDbRepository;
