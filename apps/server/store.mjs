import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

export class StoreError extends Error {
  constructor(status, code) {
    super(code);
    this.name = 'StoreError';
    this.status = status;
    this.code = code;
  }
}

function normalizeUsername(username) {
  if (typeof username !== 'string') return null;
  const value = username.trim();
  if (value.length < 1 || value.length > 64) return null;
  if (/[\u0000-\u001f\u007f\\/]/.test(value)) return null;
  return value;
}

function normalizePassword(password) {
  if (typeof password !== 'string') return null;
  if (password.length < 1 || password.length > 1024) return null;
  return password;
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return {
    algorithm: 'scrypt',
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
    keylen: SCRYPT_KEYLEN,
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  };
}

function storedSecret(record) {
  if (!record || record.algorithm !== 'scrypt') return null;
  if (record.keylen !== SCRYPT_KEYLEN || record.n !== SCRYPT_N || record.r !== SCRYPT_R || record.p !== SCRYPT_P) return null;
  const salt = Buffer.from(String(record.salt), 'base64');
  const expected = Buffer.from(String(record.hash), 'base64');
  if (salt.length !== 16 || expected.length !== SCRYPT_KEYLEN) return null;
  return { salt, expected };
}

async function verifyPassword(password, record) {
  const stored = storedSecret(record);
  if (!stored) return false;
  const actual = await scrypt(password, stored.salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return actual.length === stored.expected.length && timingSafeEqual(actual, stored.expected);
}

function assertAccountId(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw new StoreError(500, 'accounts_unavailable');
  }
}

function etagToken(value) {
  let token = String(value).trim();
  if (token.startsWith('W/') || token.startsWith('w/')) token = token.slice(2).trim();
  if (token.startsWith('"') && token.endsWith('"') && token.length >= 2) token = token.slice(1, -1);
  return token;
}

function etagEquals(header, current) {
  const expected = etagToken(current);
  if (!expected || expected === '*') return false;
  return String(header).split(',').some((part) => {
    const token = etagToken(part);
    return token !== '*' && token === expected;
  });
}

function requiredString(value, max) {
  return typeof value === 'string' && value.length <= max ? value : null;
}

function copyBookmark(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StoreError(400, 'invalid_manifest');
  const id = requiredString(value.id, 200);
  const url = requiredString(value.url, 8000);
  const title = requiredString(value.title, 2000);
  const domain = requiredString(value.domain, 2000);
  const notes = requiredString(value.notes, 100000);
  if (!id || !url || title == null || domain == null || notes == null) throw new StoreError(400, 'invalid_manifest');
  if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string' || tag.length > 200)) {
    throw new StoreError(400, 'invalid_manifest');
  }
  if (typeof value.position !== 'number' || !Number.isFinite(value.position)) throw new StoreError(400, 'invalid_manifest');
  if (typeof value.favorite !== 'boolean') throw new StoreError(400, 'invalid_manifest');
  const createdAt = requiredString(value.createdAt, 64);
  const updatedAt = requiredString(value.updatedAt, 64);
  if (!createdAt || !updatedAt || typeof value.revision !== 'number' || !Number.isFinite(value.revision)) {
    throw new StoreError(400, 'invalid_manifest');
  }
  const bookmark = {
    id,
    url,
    title,
    domain,
    notes,
    tags: [...value.tags],
    position: value.position,
    favorite: value.favorite,
    createdAt,
    updatedAt,
    revision: value.revision,
  };
  for (const key of ['faviconUrl', 'collectionId', 'deletedAt', 'purgedAt']) {
    if (value[key] === undefined || value[key] === null) continue;
    const text = requiredString(value[key], key === 'faviconUrl' ? 8000 : 200);
    if (text == null || (key !== 'faviconUrl' && text.length < 1)) throw new StoreError(400, 'invalid_manifest');
    bookmark[key] = text;
  }
  return bookmark;
}

function copyCollection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StoreError(400, 'invalid_manifest');
  const id = requiredString(value.id, 200);
  const name = requiredString(value.name, 2000);
  const createdAt = requiredString(value.createdAt, 64);
  const updatedAt = requiredString(value.updatedAt, 64);
  if (!id || name == null || !createdAt || !updatedAt) throw new StoreError(400, 'invalid_manifest');
  if (typeof value.position !== 'number' || !Number.isFinite(value.position)) throw new StoreError(400, 'invalid_manifest');
  if (typeof value.toolbar !== 'boolean') throw new StoreError(400, 'invalid_manifest');
  if (typeof value.revision !== 'number' || !Number.isFinite(value.revision)) throw new StoreError(400, 'invalid_manifest');
  const collection = { id, name, position: value.position, toolbar: value.toolbar, createdAt, updatedAt, revision: value.revision };
  if (value.parentId !== undefined && value.parentId !== null) {
    const parentId = requiredString(value.parentId, 200);
    if (!parentId) throw new StoreError(400, 'invalid_manifest');
    collection.parentId = parentId;
  }
  if (value.deletedAt !== undefined && value.deletedAt !== null) {
    const deletedAt = requiredString(value.deletedAt, 64);
    if (!deletedAt) throw new StoreError(400, 'invalid_manifest');
    collection.deletedAt = deletedAt;
  }
  return collection;
}

export function normalizeManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StoreError(400, 'invalid_manifest');
  if (value.format !== 'lumamark-sync') throw new StoreError(400, 'invalid_manifest');
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) throw new StoreError(400, 'invalid_manifest');
  const generatedAt = requiredString(value.generatedAt, 64);
  const deviceId = requiredString(value.deviceId, 200);
  if (!generatedAt || !deviceId) throw new StoreError(400, 'invalid_manifest');
  if (!Array.isArray(value.bookmarks) || !Array.isArray(value.collections)) throw new StoreError(400, 'invalid_manifest');
  const manifest = {
    format: 'lumamark-sync',
    schemaVersion: value.schemaVersion,
    generatedAt,
    deviceId,
    bookmarks: value.bookmarks.map((item) => copyBookmark(item)),
    collections: value.collections.map((item) => copyCollection(item)),
  };
  if (value.purged !== undefined) {
    if (!Array.isArray(value.purged) || value.purged.some((id) => typeof id !== 'string' || id.length < 1 || id.length > 200)) {
      throw new StoreError(400, 'invalid_manifest');
    }
    const purged = [...new Set(value.purged)];
    if (purged.length) manifest.purged = purged;
  }
  return manifest;
}

function emptyManifest() {
  return normalizeManifest({
    format: 'lumamark-sync',
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    deviceId: 'lumamark-server',
    bookmarks: [],
    collections: [],
  });
}

function canonical(manifest) {
  return `${JSON.stringify(manifest)}\n`;
}

async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  const handle = await open(temp, 'w');
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, path);
  } catch (error) {
    // Windows refuses to rename over an existing file. Callers hold the data-directory lock.
    if (!error || (error.code !== 'EPERM' && error.code !== 'EEXIST')) {
      await rm(temp, { force: true });
      throw error;
    }
    await rm(path, { force: true });
    try {
      await rename(temp, path);
    } catch (renameError) {
      await rm(temp, { force: true });
      throw renameError;
    }
  }
}

async function fileLock(root, fn) {
  await mkdir(root, { recursive: true });
  const lockPath = join(root, '.lock');
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > 30000) await rm(lockPath, { recursive: true, force: true });
      } catch {
        // Another process released or replaced the lock.
      }
      if (Date.now() > deadline) throw new StoreError(500, 'internal_error');
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 40));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

export function openDataStore(dataDir) {
  const root = resolve(dataDir);
  let chain = Promise.resolve();
  let dummy = null;

  function withLock(fn) {
    const run = chain.then(() => fileLock(root, fn));
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  function manifestPath(accountId) {
    assertAccountId(accountId);
    const folder = join(root, 'manifests');
    const path = join(folder, `${accountId}.json`);
    const fromFolder = relative(folder, path);
    if (!fromFolder || fromFolder.startsWith('..') || isAbsolute(fromFolder)) throw new StoreError(500, 'accounts_unavailable');
    return path;
  }

  async function readAccounts() {
    try {
      const parsed = JSON.parse(await readFile(join(root, 'accounts.json'), 'utf8'));
      if (!parsed || parsed.format !== 'lumamark-accounts' || !Array.isArray(parsed.accounts)) {
        throw new StoreError(500, 'accounts_unavailable');
      }
      return parsed.accounts;
    } catch (error) {
      if (error && error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function writeAccounts(accounts) {
    await atomicWrite(join(root, 'accounts.json'), canonical({ format: 'lumamark-accounts', accounts }));
  }

  async function readManifestFile(accountId) {
    let bytes;
    try {
      bytes = await readFile(manifestPath(accountId));
    } catch (error) {
      if (error && error.code === 'ENOENT') throw new StoreError(500, 'manifest_unavailable');
      throw error;
    }
    let manifest;
    try {
      manifest = normalizeManifest(JSON.parse(bytes.toString('utf8')));
    } catch (error) {
      if (error instanceof StoreError && error.status === 400) throw new StoreError(500, 'manifest_unavailable');
      throw new StoreError(500, 'manifest_unavailable');
    }
    return { manifest, etag: `"${createHash('sha256').update(bytes).digest('hex')}"` };
  }

  async function dummyRecord() {
    if (!dummy) dummy = await hashPassword('lumamark-dummy-password');
    return dummy;
  }

  return {
    ready() {
      return mkdir(root, { recursive: true });
    },
    async createAccount(username, password) {
      const name = normalizeUsername(username);
      const secret = normalizePassword(password);
      if (!name || secret == null) throw new StoreError(400, 'invalid_account');
      const passwordRecord = await hashPassword(secret);
      const account = { id: randomUUID(), username: name, password: passwordRecord, createdAt: new Date().toISOString() };
      await withLock(async () => {
        const accounts = await readAccounts();
        if (accounts.some((item) => item && item.username === name)) throw new StoreError(409, 'account_exists');
        await atomicWrite(manifestPath(account.id), canonical(emptyManifest()));
        accounts.push(account);
        await writeAccounts(accounts);
      });
      return { id: account.id, username: account.username };
    },
    async authenticate(username, password) {
      const name = normalizeUsername(username);
      const secret = normalizePassword(password);
      if (!name || secret == null) return null;
      const accounts = await withLock(() => readAccounts());
      const account = accounts.find((item) => item && item.username === name);
      const matches = await verifyPassword(secret, account ? account.password : await dummyRecord());
      if (!account || !matches) return null;
      return { id: account.id, username: account.username };
    },
    readManifest(accountId) {
      return withLock(() => readManifestFile(accountId));
    },
    writeManifest(accountId, value, ifMatch) {
      const manifest = normalizeManifest(value);
      return withLock(async () => {
        const current = await readManifestFile(accountId);
        if (ifMatch == null || String(ifMatch).trim() === '') throw new StoreError(428, 'precondition_required');
        if (!etagEquals(ifMatch, current.etag)) throw new StoreError(412, 'conflict');
        const bytes = canonical(manifest);
        await atomicWrite(manifestPath(accountId), bytes);
        return { etag: `"${createHash('sha256').update(bytes).digest('hex')}"` };
      });
    },
  };
}
