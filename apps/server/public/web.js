// packages/domain/src/index.ts
var CURRENT_SCHEMA_VERSION = 2;
function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("URL is required");
  const parsed = new URL(trimmed);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http(s) URLs can be saved");
  }
  return parsed.toString();
}
var SEPARATOR_URL = "lumamark:separator";
function isSeparator(bookmark) {
  return bookmark.url === SEPARATOR_URL;
}
function normalizeBookmarkUrl(value) {
  const trimmed = value.trim();
  if (trimmed === SEPARATOR_URL) return trimmed;
  try {
    return normalizeUrl(trimmed);
  } catch (error) {
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw error;
    }
    if (parsed.protocol === "place:") throw new Error("Firefox place: queries are not stored");
    return trimmed;
  }
}
function urlKey(value) {
  try {
    return normalizeUrl(value);
  } catch {
    return value.trim();
  }
}
function domainFromUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return value;
  }
}
function defaultTitleForUrl(value) {
  return domainFromUrl(value) || value;
}
function normalizeTags(tags) {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();
}
function conflictFields(left, right, options = {}) {
  if (!left || !right) return [];
  if (left.purgedAt || right.purgedAt) return [];
  const leftDeleted = Boolean(left.deletedAt);
  const rightDeleted = Boolean(right.deletedAt);
  if (leftDeleted && rightDeleted) return [];
  const sameLogicalFolder = (a, b) => {
    if (a === b) return true;
    if (!a || !b || !options.collections) return false;
    const folderA = options.collections.get(a);
    const folderB = options.collections.get(b);
    if (!folderA || !folderB) return false;
    return folderA.name.trim() === folderB.name.trim() && (folderA.parentId ?? void 0) === (folderB.parentId ?? void 0);
  };
  const contentFields = [];
  if (left.url !== void 0 && right.url !== void 0 && urlKey(left.url) !== urlKey(right.url)) {
    contentFields.push("url");
  }
  if ((left.title ?? "").trim() !== (right.title ?? "").trim()) {
    contentFields.push("title");
  }
  if ((left.notes ?? "").trim() !== (right.notes ?? "").trim()) {
    contentFields.push("notes");
  }
  if (left.tags !== void 0 || right.tags !== void 0) {
    const leftTags = normalizeTags(left.tags);
    const rightTags = normalizeTags(right.tags);
    if (leftTags.length !== rightTags.length || leftTags.some((tag, index) => tag !== rightTags[index])) {
      contentFields.push("tags");
    }
  }
  if (!sameLogicalFolder(left.collectionId ?? void 0, right.collectionId ?? void 0)) {
    contentFields.push("collectionId");
  }
  if ((left.favorite !== void 0 || right.favorite !== void 0) && Boolean(left.favorite) !== Boolean(right.favorite)) {
    contentFields.push("favorite");
  }
  if (leftDeleted !== rightDeleted) {
    const alive = leftDeleted ? right : left;
    const deleted = leftDeleted ? left : right;
    const aliveKey = `${alive.collectionId ?? ""}::${urlKey(alive.url ?? "")}`;
    if (options.liveSameUrlKeys?.has(aliveKey)) return [];
    if (contentFields.length === 0 && (alive.revision ?? 1) <= 1 && (deleted.revision ?? 1) > (alive.revision ?? 1)) {
      return [];
    }
    return ["deletedAt", ...contentFields];
  }
  return contentFields;
}
function validateBookmark(value) {
  if (!value || typeof value !== "object") throw new Error("Invalid bookmark");
  const item = value;
  if (typeof item.id !== "string" || typeof item.url !== "string" || typeof item.title !== "string") {
    throw new Error("Invalid bookmark fields");
  }
  normalizeBookmarkUrl(item.url);
  if (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== "string")) {
    throw new Error("Invalid bookmark tags");
  }
  if (typeof item.position !== "number" || !Number.isFinite(item.position)) throw new Error("Invalid bookmark position");
  if (typeof item.revision !== "number" || item.revision < 1) throw new Error("Invalid bookmark revision");
}
function isReadableSchemaVersion(value) {
  return value === 1 || value === CURRENT_SCHEMA_VERSION;
}
function migrateExport(value) {
  if (!value || typeof value !== "object") throw new Error("Invalid LumaMark export");
  const item = value;
  if (item.format !== "lumamark" || !isReadableSchemaVersion(item.schemaVersion) || !Array.isArray(item.bookmarks) || !Array.isArray(item.collections)) {
    throw new Error("Unsupported LumaMark export schema");
  }
  const bookmarks = item.bookmarks.map((entry) => migrateBookmark(entry));
  bookmarks.forEach(validateBookmark);
  return {
    format: "lumamark",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: typeof item.exportedAt === "string" ? item.exportedAt : (/* @__PURE__ */ new Date()).toISOString(),
    bookmarks,
    collections: item.collections.map((entry) => migrateCollection(entry))
  };
}
function migrateBookmark(value) {
  const position = typeof value?.position === "number" && Number.isFinite(value.position) ? value.position : 0;
  if (value?.position === position) return value;
  return { ...value, position };
}
function migrateCollection(value) {
  const position = typeof value?.position === "number" && Number.isFinite(value.position) ? value.position : 0;
  const toolbar = value?.toolbar === true;
  if (value?.position === position && value?.toolbar === toolbar) return value;
  return { ...value, position, toolbar };
}
function makeBookmark(input, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const url = normalizeBookmarkUrl(input.url);
  return {
    id: input.id ?? crypto.randomUUID(),
    url,
    title: input.title?.trim() || defaultTitleForUrl(url),
    domain: domainFromUrl(url),
    faviconUrl: input.faviconUrl,
    notes: input.notes?.trim() ?? "",
    tags: normalizeTags(input.tags),
    collectionId: input.collectionId,
    position: input.position ?? 0,
    favorite: input.favorite ?? false,
    createdAt: now,
    updatedAt: now,
    revision: 1
  };
}
function applyBookmarkUpdate(bookmark, update, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const collectionId = update.collectionId === void 0 ? bookmark.collectionId : update.collectionId ?? void 0;
  const position = update.position === void 0 ? migrateBookmark(bookmark).position : update.position;
  return {
    ...bookmark,
    title: update.title === void 0 ? bookmark.title : update.title.trim() || defaultTitleForUrl(bookmark.url),
    notes: update.notes === void 0 ? bookmark.notes : update.notes.trim(),
    tags: update.tags === void 0 ? bookmark.tags : normalizeTags(update.tags),
    collectionId,
    position,
    favorite: update.favorite === void 0 ? bookmark.favorite : update.favorite,
    faviconUrl: update.faviconUrl === void 0 ? bookmark.faviconUrl : update.faviconUrl,
    updatedAt: now,
    revision: bookmark.revision + 1,
    deletedAt: void 0
  };
}

// apps/web/src/client.ts
var WebRequestError = class extends Error {
  status;
  constructor(message, status) {
    super(message);
    this.name = "WebRequestError";
    this.status = status;
  }
};
function isManifest(value) {
  if (!value || typeof value !== "object") return false;
  const manifest = value;
  return manifest.format === "lumamark-sync" && (manifest.schemaVersion === 1 || manifest.schemaVersion === 2) && typeof manifest.generatedAt === "string" && typeof manifest.deviceId === "string" && Array.isArray(manifest.bookmarks) && Array.isArray(manifest.collections);
}
async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return void 0;
  }
}
var AccountClient = class {
  constructor(fetchImpl, baseUrl = "") {
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
  }
  token;
  sessionToken() {
    return this.token;
  }
  async login(username, password) {
    const response = await this.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    }, false);
    if (response.status === 401) throw new WebRequestError("登录信息不正确", 401);
    if (!response.ok) throw new WebRequestError("连不上服务", response.status);
    const body = await readJson(response);
    if (!body || typeof body !== "object") throw new WebRequestError("连不上服务", response.status);
    const record = body;
    if (typeof record.username !== "string" || typeof record.token !== "string" || !record.token) {
      throw new WebRequestError("连不上服务", response.status);
    }
    this.token = record.token;
    return { username: record.username, token: record.token };
  }
  async logout() {
    const response = await this.request("/api/session", { method: "DELETE" });
    if (response.status !== 204 && response.status !== 401) throw new WebRequestError("没有退出", response.status);
    this.token = void 0;
  }
  async readManifest() {
    const response = await this.request("/api/manifest", { method: "GET" });
    if (response.status === 401) throw new WebRequestError("没有进入账号", 401);
    if (!response.ok) throw new WebRequestError("连不上服务", response.status);
    const body = await readJson(response);
    if (!isManifest(body)) throw new WebRequestError("连不上服务", response.status);
    const etag = response.headers.get("etag");
    if (!etag) throw new WebRequestError("连不上服务", response.status);
    return { manifest: body, etag };
  }
  async writeManifest(manifest, etag) {
    if (!etag) throw new WebRequestError("缺少版本", 428);
    const response = await this.request("/api/manifest", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": etag
      },
      body: JSON.stringify(manifest)
    });
    if (response.status === 412) throw new WebRequestError("版本冲突", 412);
    if (response.status === 428) throw new WebRequestError("缺少版本", 428);
    if (!response.ok) {
      const detail = await response.text();
      throw new WebRequestError(detail ? `没有保存成。${detail}` : "没有保存成", response.status);
    }
    const next = response.headers.get("etag");
    if (!next) throw new WebRequestError("没有保存成", response.status);
    return next;
  }
  async request(path, init, authorize = true) {
    const headers = new Headers(init.headers);
    if (authorize && this.token) headers.set("Authorization", `Bearer ${this.token}`);
    try {
      return await this.fetchImpl(this.url(path), {
        ...init,
        headers,
        credentials: "same-origin",
        cache: "no-store"
      });
    } catch {
      throw new WebRequestError("连不上服务", 0);
    }
  }
  url(path) {
    if (!this.baseUrl) return path;
    const base = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
    return new URL(path, base).toString();
  }
};

// packages/import-export/src/index.ts
var entityMap = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"'
};
function decodeHtml(value) {
  return value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16))).replace(/&([a-z]+);/gi, (_, name) => entityMap[name.toLowerCase()] ?? `&${name};`).replace(/<[^>]*>/g, "").trim();
}
function id() {
  return crypto.randomUUID();
}
function makeCollection(name, parentId, position, toolbar, now) {
  return { id: id(), name, parentId, position, toolbar, createdAt: now, updatedAt: now, revision: 1 };
}
var toolbarNames = ["书签栏", "Bookmarks bar", "Bookmarks Toolbar"];
function hasToolbarAttribute(token) {
  return /\bPERSONAL_TOOLBAR_FOLDER\s*=\s*(?:"true"|'true'|true)(?=[\s>])/i.test(token);
}
function purgedIdsIn(value, bookmarks = []) {
  const listed = value && typeof value === "object" && Array.isArray(value.purged) ? value.purged : [];
  const ids = listed.filter((id2) => typeof id2 === "string" && id2.length > 0);
  for (const bookmark of bookmarks) {
    if (bookmark.purgedAt && bookmark.id) ids.push(bookmark.id);
  }
  return [...new Set(ids)].sort();
}
function collectionsForExport(bookmarks, collections) {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const keep = /* @__PURE__ */ new Set();
  const mark = (id2) => {
    const seen = /* @__PURE__ */ new Set();
    let current = id2 ? byId.get(id2) : void 0;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      keep.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : void 0;
    }
  };
  for (const collection of collections) {
    if (!collection.deletedAt) mark(collection.id);
  }
  for (const bookmark of bookmarks) {
    if (!bookmark.purgedAt && bookmark.collectionId) mark(bookmark.collectionId);
  }
  return collections.filter((collection) => keep.has(collection.id)).map((collection) => migrateCollection(collection));
}
function parseLumaMarkJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { bookmarks: [], collections: [], purgedIds: [], issues: [{ kind: "invalid-json", message: `Invalid JSON: ${String(error)}` }] };
  }
  try {
    const backup = migrateExport(parsed);
    const purgedIds = purgedIdsIn(parsed, backup.bookmarks);
    const purged = new Set(purgedIds);
    const bookmarks = backup.bookmarks.filter((bookmark) => !bookmark.purgedAt && !purged.has(bookmark.id));
    return {
      bookmarks,
      collections: collectionsForExport(bookmarks, backup.collections),
      purgedIds,
      issues: []
    };
  } catch (error) {
    const raw = parsed && typeof parsed === "object" ? parsed : void 0;
    const bookmarks = Array.isArray(raw?.bookmarks) ? raw.bookmarks : [];
    const valid = [];
    const seenPurged = [];
    const issues = [{ kind: "invalid-entry", message: String(error) }];
    bookmarks.forEach((value, index) => {
      try {
        if (!value || typeof value !== "object") throw new Error("Invalid bookmark entry");
        const item = value;
        if (typeof item.createdAt !== "string" || !item.createdAt) {
          throw new Error("Bookmark createdAt is required");
        }
        if (typeof item.updatedAt !== "string" || !item.updatedAt) {
          throw new Error("Bookmark updatedAt is required");
        }
        if (typeof item.revision !== "number" || !Number.isInteger(item.revision) || item.revision < 1) {
          throw new Error("Bookmark revision must be a positive integer");
        }
        if (item.purgedAt) {
          seenPurged.push(item);
          return;
        }
        const url = normalizeBookmarkUrl(item.url);
        valid.push({
          ...makeBookmark({
            id: item.id,
            url,
            title: item.title,
            faviconUrl: item.faviconUrl,
            notes: item.notes,
            tags: item.tags,
            collectionId: item.collectionId,
            position: typeof item.position === "number" ? item.position : 0,
            favorite: item.favorite
          }, item.createdAt),
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          deletedAt: item.deletedAt,
          revision: item.revision
        });
      } catch (entryError) {
        issues.push({ kind: "invalid-entry", index, message: String(entryError) });
      }
    });
    const collections = Array.isArray(raw?.collections) ? raw.collections.map((collection) => migrateCollection(collection)) : [];
    const purgedIds = purgedIdsIn(parsed, seenPurged);
    return { bookmarks: valid, collections: collectionsForExport(valid, collections), purgedIds, issues };
  }
}
function parseBookmarksHtml(text) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const collections = [];
  const bookmarks = [];
  const issues = [];
  const stack = [{ nextPosition: 0 }];
  const tokens = text.match(/<[^>]+>|[^<]+/g) ?? [];
  let pendingFolder;
  let pendingToolbar = false;
  let toolbarClaimed = false;
  let folderText = "";
  let inFolder = false;
  let anchorAttrs = "";
  let anchorText = "";
  let inAnchor = false;
  let tokenIndex = 0;
  for (const token of tokens) {
    if (/^<h3\b[^>]*>$/i.test(token)) {
      inFolder = true;
      folderText = "";
      pendingToolbar = !toolbarClaimed && hasToolbarAttribute(token);
      continue;
    }
    if (/^<\/h3\b/i.test(token)) {
      pendingFolder = decodeHtml(folderText);
      inFolder = false;
      continue;
    }
    if (inFolder) {
      folderText += token;
      continue;
    }
    const anchorStart = token.match(/^<a\b([^>]*)>$/i);
    if (anchorStart) {
      inAnchor = true;
      anchorAttrs = anchorStart[1];
      anchorText = "";
      continue;
    }
    if (/^<\/a\b/i.test(token)) {
      const href = anchorAttrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const url = href?.[1] ?? href?.[2] ?? href?.[3];
      const title = decodeHtml(anchorText);
      if (!url) {
        issues.push({ kind: "malformed-html", index: tokenIndex, message: "Bookmark is missing an href" });
      } else {
        try {
          const parent = stack[stack.length - 1];
          const bookmark = makeBookmark({ url: decodeHtml(url), title, collectionId: parent.id, position: parent.nextPosition }, now);
          bookmarks.push(bookmark);
          parent.nextPosition += 1;
        } catch (error) {
          issues.push({ kind: "malformed-html", index: tokenIndex, message: String(error) });
        }
      }
      inAnchor = false;
      tokenIndex += 1;
      continue;
    }
    if (inAnchor) {
      anchorText += token;
      continue;
    }
    if (/^<dl\b/i.test(token)) {
      if (pendingFolder) {
        const parent = stack[stack.length - 1];
        const toolbar = pendingToolbar;
        if (toolbar) toolbarClaimed = true;
        const collection = makeCollection(pendingFolder, parent.id, parent.nextPosition, toolbar, now);
        parent.nextPosition += 1;
        collections.push(collection);
        stack.push({ id: collection.id, nextPosition: 0 });
        pendingFolder = void 0;
        pendingToolbar = false;
      }
      continue;
    }
    if (/^<\/dl\b/i.test(token)) {
      if (stack.length > 1) stack.pop();
      continue;
    }
  }
  if (!toolbarClaimed) {
    for (const name of toolbarNames) {
      const match = collections.find((collection) => collection.parentId === void 0 && collection.name === name);
      if (match) {
        match.toolbar = true;
        break;
      }
    }
  }
  if (pendingFolder) issues.push({ kind: "malformed-html", message: `Folder without content: ${pendingFolder}` });
  if (inAnchor) issues.push({ kind: "malformed-html", message: "Bookmark anchor is not closed" });
  if (inFolder) issues.push({ kind: "malformed-html", message: "Folder heading is not closed" });
  return { bookmarks, collections, purgedIds: [], issues };
}
function exportLumaMarkJson(bookmarks, collections, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const kept = bookmarks.filter((bookmark) => !bookmark.purgedAt);
  const payload = {
    format: "lumamark",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: now,
    bookmarks: kept.map((bookmark) => migrateBookmark(bookmark)),
    collections: collectionsForExport(kept, collections)
  };
  return JSON.stringify(payload, null, 2);
}
function planImport(result, existing, action = "skip") {
  const byUrl = new Map(existing.filter((bookmark) => !isSeparator(bookmark)).map((bookmark) => [urlKey(bookmark.url), bookmark]));
  const issues = [...result.issues];
  const entries = [];
  for (const bookmark of result.bookmarks) {
    const found = isSeparator(bookmark) ? void 0 : byUrl.get(urlKey(bookmark.url));
    if (!found) {
      entries.push({ bookmark, action: "create" });
      continue;
    }
    if (action === "skip") {
      issues.push({ kind: "duplicate", message: `Duplicate URL skipped: ${bookmark.url}` });
      continue;
    }
    if (action === "update") entries.push({ bookmark, existing: found, action: "update" });
    else entries.push({ bookmark: { ...bookmark, id: id() }, existing: found, action: "copy" });
  }
  return { entries, issues };
}

// packages/sync/src/index.ts
function sortedPurgedIds(ids) {
  return [...new Set((ids ?? []).filter((id2) => typeof id2 === "string" && id2))].sort();
}
function purgedBookmark(id2, purgedAt) {
  return {
    id: id2,
    url: "https://deleted.invalid/",
    title: "",
    domain: "",
    notes: "",
    tags: [],
    favorite: false,
    position: 0,
    createdAt: purgedAt,
    updatedAt: purgedAt,
    deletedAt: purgedAt,
    purgedAt,
    revision: 1
  };
}
function expandSyncBookmarks(bookmarks = [], purged = []) {
  const byId = /* @__PURE__ */ new Map();
  for (const item of bookmarks) {
    if (!item?.id || byId.get(item.id)?.purgedAt) continue;
    byId.set(item.id, item.purgedAt ? purgedBookmark(item.id, item.purgedAt) : migrateBookmark(item));
  }
  for (const id2 of sortedPurgedIds(purged)) {
    const existing = byId.get(id2);
    if (existing?.purgedAt) continue;
    byId.set(id2, purgedBookmark(id2, existing?.updatedAt || "1970-01-01T00:00:00.000Z"));
  }
  return [...byId.values()];
}
function compactSyncManifest(manifest) {
  const bookmarks = [];
  const purged = [...manifest.purged ?? []];
  for (const item of manifest.bookmarks) {
    if (item.purgedAt) purged.push(item.id);
    else bookmarks.push(item);
  }
  const ids = sortedPurgedIds(purged);
  const deleted = new Set(ids);
  const next = { ...manifest, bookmarks: bookmarks.filter((item) => !deleted.has(item.id)) };
  if (ids.length) next.purged = ids;
  else delete next.purged;
  return next;
}

// apps/web/src/library.ts
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
function libraryFromManifest(manifest) {
  const purged = [...new Set((manifest.purged ?? []).filter((id2) => id2.length > 0))].sort();
  const gone = new Set(purged);
  const bookmarks = expandSyncBookmarks(manifest.bookmarks ?? [], purged).filter((bookmark) => !bookmark.purgedAt && !gone.has(bookmark.id)).map((bookmark) => ({ ...migrateBookmark(bookmark), tags: [...bookmark.tags] }));
  return {
    deviceId: manifest.deviceId,
    bookmarks,
    collections: (manifest.collections ?? []).map((collection) => ({ ...migrateCollection(collection) })),
    purged
  };
}
function manifestFromLibrary(model, now) {
  const gone = new Set(model.purged);
  return compactSyncManifest({
    format: "lumamark-sync",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    generatedAt: now,
    deviceId: model.deviceId || "lumamark-web",
    bookmarks: model.bookmarks.filter((bookmark) => !bookmark.purgedAt && !gone.has(bookmark.id)),
    collections: model.collections,
    purged: [...gone].sort()
  });
}
function librarySignature(model) {
  const bookmarks = [...model.bookmarks].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const collections = [...model.collections].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return JSON.stringify({ bookmarks, collections, purged: [...model.purged].sort() });
}
function visibleBookmarks(model, filter) {
  const gone = new Set(model.purged);
  const query = filter.query.trim().toLowerCase();
  return model.bookmarks.filter((bookmark) => {
    if (bookmark.purgedAt || gone.has(bookmark.id)) return false;
    if (Boolean(bookmark.deletedAt) !== filter.trash) return false;
    if (filter.favoritesOnly && !bookmark.favorite) return false;
    if (query && !bookmark.title.toLowerCase().includes(query)) return false;
    return true;
  });
}
function folderName(model, collectionId) {
  if (!collectionId) return "";
  return model.collections.find((collection) => collection.id === collectionId)?.name ?? "";
}
function folderFor(model, name, now) {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return { model, collectionId: void 0 };
  const existing = model.collections.find((collection2) => !collection2.deletedAt && !collection2.parentId && collection2.name === trimmed);
  if (existing) return { model, collectionId: existing.id };
  const collection = {
    id: crypto.randomUUID(),
    name: trimmed,
    position: model.collections.filter((item) => !item.parentId).length,
    toolbar: false,
    createdAt: now,
    updatedAt: now,
    revision: 1
  };
  return { model: { ...model, collections: [...model.collections, collection] }, collectionId: collection.id };
}
function addBookmark(model, input, now) {
  const ensured = folderFor(model, input.folder, now);
  const bookmark = makeBookmark({
    url: input.url,
    title: input.title,
    notes: input.notes,
    tags: input.tags,
    favorite: input.favorite,
    collectionId: ensured.collectionId,
    position: ensured.model.bookmarks.filter((item) => !item.deletedAt && item.collectionId === ensured.collectionId).length
  }, now);
  if (ensured.model.purged.includes(bookmark.id)) throw new Error("清空后不能再恢复");
  return { ...ensured.model, bookmarks: [...ensured.model.bookmarks, bookmark] };
}
function updateBookmark(model, id2, patch, now) {
  const current = model.bookmarks.find((bookmark) => bookmark.id === id2);
  if (!current || current.purgedAt || model.purged.includes(id2)) throw new Error("Bookmark not found");
  if (current.deletedAt) throw new Error("Bookmark is in trash");
  const ensured = patch.folder === void 0 ? { model, collectionId: current.collectionId } : folderFor(model, patch.folder, now);
  let updated = applyBookmarkUpdate(current, {
    title: patch.title,
    notes: patch.notes,
    tags: patch.tags,
    favorite: patch.favorite,
    collectionId: patch.folder === void 0 ? void 0 : ensured.collectionId ?? null
  }, now);
  if (patch.url !== void 0) {
    const url = normalizeBookmarkUrl(patch.url);
    updated = { ...updated, url, domain: domainFromUrl(url) };
  }
  return {
    ...ensured.model,
    bookmarks: ensured.model.bookmarks.map((bookmark) => bookmark.id === id2 ? updated : bookmark)
  };
}
function deleteBookmark(model, id2, now) {
  const current = model.bookmarks.find((bookmark) => bookmark.id === id2);
  if (!current || current.purgedAt || model.purged.includes(id2)) throw new Error("Bookmark not found");
  if (current.deletedAt) throw new Error("Bookmark is in trash");
  const deleted = { ...current, deletedAt: now, updatedAt: now, revision: current.revision + 1 };
  return { ...model, bookmarks: model.bookmarks.map((bookmark) => bookmark.id === id2 ? deleted : bookmark) };
}
function restoreBookmark(model, id2, now) {
  if (model.purged.includes(id2)) throw new Error("清空后不能再恢复");
  const current = model.bookmarks.find((bookmark) => bookmark.id === id2);
  if (!current || current.purgedAt) throw new Error("清空后不能再恢复");
  if (!current.deletedAt) throw new Error("Bookmark is not in trash");
  const restored = { ...current, updatedAt: now, revision: current.revision + 1 };
  delete restored.deletedAt;
  return { ...model, bookmarks: model.bookmarks.map((bookmark) => bookmark.id === id2 ? restored : bookmark) };
}
function emptyTrash(model) {
  const purged = new Set(model.purged);
  const bookmarks = [];
  for (const bookmark of model.bookmarks) {
    if (bookmark.deletedAt || bookmark.purgedAt) purged.add(bookmark.id);
    else bookmarks.push(bookmark);
  }
  return { ...model, bookmarks, purged: [...purged].sort() };
}
function parseImport(text, format) {
  return format === "html" ? parseBookmarksHtml(text) : parseLumaMarkJson(text);
}
function countDuplicateImports(model, parsed) {
  const existing = model.bookmarks.filter((bookmark) => !bookmark.purgedAt && !model.purged.includes(bookmark.id));
  return planImport(parsed, existing, "skip").issues.filter((issue) => issue.kind === "duplicate").length;
}
function collectionsFor(bookmarks, available, existing) {
  const byId = new Map(available.map((collection) => [collection.id, collection]));
  const have = new Set(existing.map((collection) => collection.id));
  const extra = [];
  const seen = /* @__PURE__ */ new Set();
  for (const bookmark of bookmarks) {
    let current = bookmark.collectionId;
    const guard = /* @__PURE__ */ new Set();
    while (current && !guard.has(current)) {
      guard.add(current);
      if (!have.has(current) && !seen.has(current)) {
        const collection = byId.get(current);
        if (collection) {
          extra.push({ ...collection });
          seen.add(current);
        }
      }
      current = byId.get(current)?.parentId;
    }
  }
  return extra;
}
function purgeKnown(model, ids) {
  const purged = new Set(model.purged);
  let bookmarks = model.bookmarks;
  for (const id2 of ids) {
    if (!bookmarks.some((bookmark) => bookmark.id === id2) && !purged.has(id2)) continue;
    purged.add(id2);
    bookmarks = bookmarks.filter((bookmark) => bookmark.id !== id2);
  }
  return { ...model, bookmarks, purged: [...purged].sort() };
}
function applyImport(model, parsed, action, now) {
  const existing = model.bookmarks.filter((bookmark) => !bookmark.purgedAt && !model.purged.includes(bookmark.id));
  const plan = planImport(parsed, existing, action);
  const referenced = plan.entries.map((entry) => entry.action === "update" && entry.existing ? { ...entry.existing, collectionId: entry.bookmark.collectionId } : entry.bookmark);
  const collections = [...model.collections, ...collectionsFor(referenced, parsed.collections, model.collections)];
  const bookmarks = [...model.bookmarks];
  for (const entry of plan.entries) {
    if (entry.action === "update" && entry.existing) {
      const index = bookmarks.findIndex((bookmark) => bookmark.id === entry.existing?.id);
      if (index < 0) continue;
      bookmarks[index] = applyBookmarkUpdate(bookmarks[index], {
        title: entry.bookmark.title,
        notes: entry.bookmark.notes,
        tags: entry.bookmark.tags,
        favorite: entry.bookmark.favorite,
        collectionId: entry.bookmark.collectionId ?? null,
        position: entry.bookmark.position,
        faviconUrl: entry.bookmark.faviconUrl
      }, now);
      continue;
    }
    if (model.purged.includes(entry.bookmark.id) || bookmarks.some((bookmark) => bookmark.id === entry.bookmark.id)) continue;
    bookmarks.push(entry.bookmark);
  }
  return purgeKnown({ ...model, bookmarks, collections }, parsed.purgedIds);
}
function exportJson(model, now) {
  const gone = new Set(model.purged);
  const bookmarks = model.bookmarks.filter((bookmark) => !bookmark.purgedAt && !gone.has(bookmark.id));
  return exportLumaMarkJson(bookmarks, model.collections, now);
}
function exportHtml(model) {
  const gone = new Set(model.purged);
  const collections = model.collections.filter((collection) => !collection.deletedAt);
  const bookmarks = model.bookmarks.filter((bookmark) => !bookmark.deletedAt && !bookmark.purgedAt && !gone.has(bookmark.id));
  const children = (parentId) => {
    let html = "";
    for (const folder of collections.filter((collection) => (collection.parentId ?? void 0) === parentId)) {
      const toolbar = folder.toolbar ? ' PERSONAL_TOOLBAR_FOLDER="true"' : "";
      html += `<DT><H3${toolbar}>${escapeHtml(folder.name)}</H3>
<DL><p>
${children(folder.id)}</DL><p>
`;
    }
    for (const bookmark of bookmarks.filter((bookmark2) => (bookmark2.collectionId ?? void 0) === parentId)) {
      html += `<DT><A HREF="${escapeHtml(bookmark.url)}">${escapeHtml(bookmark.title)}</A>
`;
    }
    return html;
  };
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
${children(void 0)}</DL><p>
`;
}
function collectionMap(local, remote) {
  const collections = /* @__PURE__ */ new Map();
  for (const collection of [...local.collections, ...remote.collections]) collections.set(collection.id, collection);
  return collections;
}
function titleConflicts(local, remote) {
  const remoteById = new Map(remote.bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const collections = collectionMap(local, remote);
  const conflicts = [];
  for (const bookmark of local.bookmarks) {
    const other = remoteById.get(bookmark.id);
    if (!other) continue;
    const fields = conflictFields(bookmark, other, { collections });
    if (!fields.length) continue;
    conflicts.push({
      bookmarkId: bookmark.id,
      localTitle: bookmark.title,
      remoteTitle: other.title,
      fields: [...fields],
      local: bookmark,
      remote: other
    });
  }
  return conflicts;
}
function mergeTitleChoices(local, remote, choices, now) {
  const conflicts = titleConflicts(local, remote);
  if (conflicts.some((conflict) => !choices.has(conflict.bookmarkId))) throw new Error("未选择要保留的版本");
  const chosenIds = new Set(conflicts.map((conflict) => conflict.bookmarkId));
  const localById = new Map(local.bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const remoteById = new Map(remote.bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const remotePurged = new Set(remote.purged);
  const purged = /* @__PURE__ */ new Set([...local.purged, ...remote.purged]);
  const bookmarks = [];
  for (const id2 of /* @__PURE__ */ new Set([...localById.keys(), ...remoteById.keys()])) {
    if (remotePurged.has(id2)) {
      purged.add(id2);
      continue;
    }
    const left = localById.get(id2);
    const right = remoteById.get(id2);
    if (left && right && chosenIds.has(id2)) {
      const choice = choices.get(id2);
      const chosen = choice?.keep === "remote" ? right : choice?.keep === "merged" ? choice.bookmark : left;
      if (!choice || !chosen || chosen.id !== id2) throw new Error("合并需要这条书签");
      bookmarks.push({
        ...chosen,
        id: id2,
        tags: [...chosen.tags],
        updatedAt: now,
        revision: Math.max(left.revision, right.revision, chosen.revision) + 1
      });
      continue;
    }
    if (left && right) {
      const winner = left.revision > right.revision || left.revision === right.revision && left.updatedAt >= right.updatedAt ? left : right;
      bookmarks.push({ ...winner, tags: [...winner.tags] });
      continue;
    }
    const only = left ?? right;
    if (only) bookmarks.push({ ...only, tags: [...only.tags] });
  }
  const collections = /* @__PURE__ */ new Map();
  for (const collection of [...remote.collections, ...local.collections]) {
    const previous = collections.get(collection.id);
    if (!previous || collection.revision >= previous.revision) collections.set(collection.id, { ...collection });
  }
  return {
    deviceId: remote.deviceId || local.deviceId,
    bookmarks: bookmarks.filter((bookmark) => !purged.has(bookmark.id) && !bookmark.purgedAt),
    collections: [...collections.values()],
    purged: [...purged].sort()
  };
}

// apps/web/src/app.ts
var OFFLINE = "连不上服务，没有显示书签库。";
var EMPTY = "这个账号还没有书签。";
var UNSAVED = "没有保存成。账号保持原样。";
function createWebApp(options = {}) {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  return new WebController(new AccountClient(fetchImpl, options.baseUrl), options.now ?? (() => (/* @__PURE__ */ new Date()).toISOString()));
}
function bindWebApp(root, app) {
  const paint = () => {
    root.innerHTML = app.render();
  };
  const finish = (result) => {
    void result.then(paint, paint);
  };
  root.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    if (!form?.elements) return;
    const value = (name) => form.elements?.[name]?.value ?? "";
    const checked = (name) => Boolean(form.elements?.[name]?.checked);
    if (form.id === "login") {
      finish(app.login(value("username"), value("password")));
      return;
    }
    if (form.id === "search") {
      app.search(value("query"));
      paint();
      return;
    }
    if (form.id === "add") {
      finish(app.addBookmark({
        title: value("title"),
        url: value("url"),
        folder: value("folder"),
        tags: splitTags(value("tags")),
        notes: value("notes"),
        favorite: checked("favorite")
      }));
      return;
    }
    if (form.id === "import") {
      finish(app.beginImport(value("content"), value("format") === "html" ? "html" : "json"));
      return;
    }
    if (form.getAttribute?.("data-action") === "update") {
      finish(app.updateBookmark(form.getAttribute("data-bookmark-id") ?? "", {
        title: value("title"),
        url: value("url"),
        folder: value("folder"),
        tags: splitTags(value("tags")),
        notes: value("notes"),
        favorite: checked("favorite")
      }));
      return;
    }
    if (form.getAttribute?.("data-action") === "merge-conflict") {
      const deleted = form.elements?.deleted;
      finish(app.chooseConflict(form.getAttribute("data-bookmark-id") ?? "", "merged", {
        title: value("title"),
        url: value("url"),
        folder: value("folder"),
        tags: splitTags(value("tags")),
        notes: value("notes"),
        favorite: checked("favorite"),
        ...deleted ? { deleted: Boolean(deleted.checked) } : {}
      }));
    }
  });
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!target?.getAttribute || target.getAttribute("type") === "submit") return;
    const importAction = target.getAttribute("data-import-action");
    if (importAction === "skip" || importAction === "update" || importAction === "copy") {
      finish(app.chooseImport(importAction));
      return;
    }
    const keep = target.getAttribute("data-keep");
    if (keep === "local" || keep === "remote") {
      finish(app.chooseConflict(target.getAttribute("data-bookmark-id") ?? "", keep));
      return;
    }
    const action = target.getAttribute("data-action");
    const id2 = target.getAttribute("data-bookmark-id") ?? "";
    if (action === "delete") finish(app.deleteBookmark(id2));
    else if (action === "restore") finish(app.restoreBookmark(id2));
    else if (action === "empty-trash") finish(app.emptyTrash());
    else if (action === "logout") finish(app.logout());
    else if (action === "cancel-import") {
      app.cancelImport();
      paint();
    } else if (action === "export-json") {
      app.exportJson();
      paint();
    } else if (action === "export-html") {
      app.exportHtml();
      paint();
    } else if (action === "show-trash") {
      app.showTrash(true);
      paint();
    } else if (action === "show-library") {
      app.showTrash(false);
      paint();
    }
  });
  root.addEventListener("change", (event) => {
    const target = event.target;
    if (target?.id !== "favorites-only") return;
    app.setFavoritesOnly(Boolean(target.checked));
    paint();
  });
  paint();
}
function splitTags(value) {
  return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
}
var WebController = class {
  constructor(client, now) {
    this.client = client;
    this.now = now;
  }
  library;
  etag;
  username;
  mode = "login";
  message = "";
  query = "";
  favoritesOnly = false;
  trash = false;
  importDraft;
  pending;
  lastExport = "";
  async login(username, password) {
    try {
      const session = await this.client.login(username, password);
      this.username = session.username;
    } catch (error) {
      if (error instanceof WebRequestError && error.status === 401) {
        if (this.library) this.message = "登录信息不正确，没有切换账号。";
        else {
          this.mode = "login";
          this.message = "登录信息不正确，没有进入账号。";
        }
      } else if (this.library) this.message = "连不上服务，没有切换账号。";
      else this.showOffline();
      throw error;
    }
    try {
      await this.reload();
    } catch (error) {
      this.failRead();
      throw error;
    }
  }
  async logout() {
    try {
      await this.client.logout();
    } catch (error) {
      this.message = "没有退出。仍显示当前账号。";
      throw error;
    }
    this.clearSession();
  }
  async refresh() {
    try {
      await this.reload();
    } catch (error) {
      this.failRead();
      throw error;
    }
  }
  search(query) {
    this.query = query;
    this.refreshMessage();
  }
  setFavoritesOnly(value) {
    this.favoritesOnly = value;
    this.refreshMessage();
  }
  showTrash(value) {
    this.trash = value;
    this.refreshMessage();
  }
  async addBookmark(input) {
    await this.persist(addBookmark(this.requireLibrary(), input, this.now()));
  }
  async updateBookmark(id2, patch) {
    await this.persist(updateBookmark(this.requireLibrary(), id2, patch, this.now()));
  }
  async deleteBookmark(id2) {
    await this.persist(deleteBookmark(this.requireLibrary(), id2, this.now()));
  }
  async restoreBookmark(id2) {
    await this.persist(restoreBookmark(this.requireLibrary(), id2, this.now()));
  }
  async emptyTrash() {
    await this.persist(emptyTrash(this.requireLibrary()));
  }
  async beginImport(text, format) {
    const library = this.requireLibrary();
    const parsed = parseImport(text, format);
    if (!parsed.bookmarks.length && !parsed.purgedIds.length) {
      this.message = "没有导入书签，账号保持不变。";
      return "rejected";
    }
    if (countDuplicateImports(library, parsed) > 0) {
      this.importDraft = parsed;
      this.mode = "import-choice";
      this.message = "尚未选择重复项处理方式，账号保持不变。";
      return "awaiting-choice";
    }
    await this.persist(applyImport(library, parsed, "skip", this.now()));
    return "applied";
  }
  async chooseImport(action) {
    if (action !== "skip" && action !== "update" && action !== "copy") throw new Error("未知的重复项处理方式");
    if (!this.library || !this.importDraft) throw new Error("还没有需要选择的重复项");
    await this.persist(applyImport(this.library, this.importDraft, action, this.now()));
  }
  cancelImport() {
    this.importDraft = void 0;
    if (!this.library) return;
    this.mode = "library";
    this.refreshMessage();
  }
  exportJson() {
    this.lastExport = exportJson(this.requireLibrary(), this.now());
    return this.lastExport;
  }
  exportHtml() {
    this.lastExport = exportHtml(this.requireLibrary());
    return this.lastExport;
  }
  async chooseConflict(bookmarkId, keep, patch) {
    if (!this.pending) throw new Error("没有需要选择的版本");
    const conflict = this.pending.conflicts.find((item) => item.bookmarkId === bookmarkId);
    if (!conflict) throw new Error("没有这条书签的冲突");
    if (keep === "merged" && !patch) throw new Error("合并需要给出要保留的内容");
    const choice = keep === "merged" ? { keep, bookmark: this.bookmarkForMerge(conflict.local, patch ?? {}) } : { keep };
    this.pending.choices.set(bookmarkId, choice);
    if (this.pending.conflicts.some((item) => !this.pending?.choices.has(item.bookmarkId))) return;
    const merged = mergeTitleChoices(this.pending.attempted, this.pending.remote, this.pending.choices, this.now());
    const etag = this.pending.etag;
    try {
      await this.writeModel(merged, etag);
    } catch (error) {
      if (error instanceof WebRequestError && error.status === 412) {
        await this.noteConflict(merged);
        return;
      }
      this.message = UNSAVED;
      throw error;
    }
  }
  visibleBookmarks() {
    if (!this.library) return [];
    return visibleBookmarks(this.library, this.filter());
  }
  snapshot() {
    return {
      mode: this.mode,
      message: this.message,
      username: this.username,
      importPending: this.mode === "import-choice",
      conflicts: this.pending?.conflicts.map((conflict) => ({ ...conflict })) ?? []
    };
  }
  sessionToken() {
    return this.client.sessionToken();
  }
  render() {
    const notice = `<p id="notice" role="status">${escapeHtml(this.message)}</p>`;
    if (this.mode === "offline") return `<div data-mode="offline">${notice}</div>`;
    if (this.mode === "login" || !this.library || !this.username) {
      return `<div data-mode="login">${notice}${loginForm()}<p>账号由部署者在服务器上创建，此页面不能注册。</p></div>`;
    }
    const account = `<p data-account="${escapeHtml(this.username)}">当前账号：${escapeHtml(this.username)}</p>`;
    if (this.mode === "conflict" && this.pending) {
      return `<div data-mode="conflict">${account}${notice}${this.renderConflicts()}${this.renderBookmarkList(true)}</div>`;
    }
    if (this.mode === "import-choice") {
      return `<div data-mode="import-choice" data-bookmark-count="${this.liveCount()}">${account}${notice}${importChoice()}${this.renderBookmarkList(true)}</div>`;
    }
    return `<div data-mode="library" data-bookmark-count="${this.visibleBookmarks().length}">${account}${notice}${this.renderTools()}${this.renderBookmarkList(false)}</div>`;
  }
  requireLibrary() {
    if (!this.library || !this.etag) throw new WebRequestError("没有进入账号", 401);
    return this.library;
  }
  filter() {
    return { query: this.query, favoritesOnly: this.favoritesOnly, trash: this.trash };
  }
  async reload() {
    const snapshot = await this.client.readManifest();
    this.library = libraryFromManifest(snapshot.manifest);
    this.etag = snapshot.etag;
    this.mode = "library";
    this.pending = void 0;
    this.importDraft = void 0;
    this.query = "";
    this.favoritesOnly = false;
    this.trash = false;
    this.lastExport = "";
    this.refreshMessage();
  }
  async persist(model) {
    const current = this.requireLibrary();
    if (librarySignature(model) === librarySignature(current)) {
      this.mode = "library";
      this.importDraft = void 0;
      this.refreshMessage();
      return;
    }
    try {
      await this.writeModel(model, this.etag ?? "");
    } catch (error) {
      if (error instanceof WebRequestError && error.status === 412) {
        await this.noteConflict(model);
        return;
      }
      this.message = UNSAVED;
      throw error;
    }
  }
  async writeModel(model, etag) {
    const nextEtag = await this.client.writeManifest(manifestFromLibrary(model, this.now()), etag);
    this.library = model;
    this.etag = nextEtag;
    this.mode = "library";
    this.pending = void 0;
    this.importDraft = void 0;
    this.refreshMessage();
  }
  async noteConflict(attempted) {
    let remote;
    try {
      remote = await this.client.readManifest();
    } catch {
      this.message = "连不上服务，没有写入这次修改。账号保持原样。";
      return;
    }
    const remoteModel = libraryFromManifest(remote.manifest);
    const conflicts = titleConflicts(attempted, remoteModel);
    if (!conflicts.length) {
      try {
        await this.writeModel(mergeTitleChoices(attempted, remoteModel, /* @__PURE__ */ new Map(), this.now()), remote.etag);
      } catch (error) {
        if (error instanceof WebRequestError && error.status === 412) this.message = UNSAVED;
        throw error;
      }
      return;
    }
    this.mode = "conflict";
    this.message = "同一条书签两边都改过，选择要保留的版本。选择完成前不会写回账号。";
    this.pending = { attempted, remote: remoteModel, etag: remote.etag, choices: /* @__PURE__ */ new Map(), conflicts };
  }
  bookmarkForMerge(base, patch) {
    const library = this.pending?.attempted;
    let collectionId = patch.folder === void 0 ? void 0 : null;
    if (patch.folder !== void 0 && library && this.pending) {
      const placed = folderFor(library, patch.folder, this.now());
      this.pending.attempted = placed.model;
      collectionId = placed.collectionId ?? null;
    }
    let bookmark = applyBookmarkUpdate(base, {
      title: patch.title,
      notes: patch.notes,
      tags: patch.tags,
      favorite: patch.favorite,
      collectionId
    }, this.now());
    if (patch.url !== void 0) {
      const url = normalizeBookmarkUrl(patch.url);
      bookmark = { ...bookmark, url, domain: domainFromUrl(url) };
    }
    if (patch.deleted === true) bookmark = { ...bookmark, deletedAt: this.now() };
    else if (patch.deleted === false) delete bookmark.deletedAt;
    else if (base.deletedAt) bookmark = { ...bookmark, deletedAt: base.deletedAt };
    else delete bookmark.deletedAt;
    return { ...bookmark, id: base.id };
  }
  showOffline() {
    this.mode = "offline";
    this.library = void 0;
    this.etag = void 0;
    this.pending = void 0;
    this.importDraft = void 0;
    this.message = OFFLINE;
  }
  failRead() {
    this.showOffline();
    this.username = void 0;
  }
  clearSession() {
    this.library = void 0;
    this.etag = void 0;
    this.username = void 0;
    this.pending = void 0;
    this.importDraft = void 0;
    this.query = "";
    this.favoritesOnly = false;
    this.trash = false;
    this.lastExport = "";
    this.mode = "login";
    this.message = "";
  }
  refreshMessage() {
    if (!this.library || this.mode !== "library") return;
    const visible = visibleBookmarks(this.library, this.filter());
    if (this.query.trim() || this.favoritesOnly || this.trash) {
      this.message = visible.length ? "" : "没有符合条件的书签。";
      return;
    }
    this.message = this.liveCount() ? "" : EMPTY;
  }
  liveCount() {
    if (!this.library) return 0;
    const gone = new Set(this.library.purged);
    return this.library.bookmarks.filter((bookmark) => !bookmark.deletedAt && !bookmark.purgedAt && !gone.has(bookmark.id)).length;
  }
  renderTools() {
    const query = escapeHtml(this.query);
    const favorites = this.favoritesOnly ? " checked" : "";
    const exportOutput = this.lastExport ? `<textarea id="export-output" readonly>${escapeHtml(this.lastExport)}</textarea>` : "";
    return `<form id="search"><label>搜索标题 <input name="query" value="${query}"></label><button type="submit">搜索</button></form><label>只看收藏 <input id="favorites-only" type="checkbox"${favorites}></label><button type="button" data-action="show-library">书签库</button><button type="button" data-action="show-trash">回收站</button>` + (this.trash ? '<button type="button" data-action="empty-trash">清空回收站</button>' : "") + `<form id="add"><h2>新增书签</h2>${bookmarkFields()}</form><form id="import"><h2>导入</h2><label>内容 <textarea name="content"></textarea></label><label>格式 <select name="format"><option value="html">HTML</option><option value="json">LumaMark JSON</option></select></label><button type="submit">导入</button></form><button type="button" data-action="export-json">导出 JSON</button><button type="button" data-action="export-html">导出 HTML</button>${exportOutput}<button type="button" data-action="logout">退出</button>`;
  }
  renderBookmarkList(readonly) {
    const items = this.visibleBookmarks().map((bookmark) => this.renderBookmark(bookmark, readonly)).join("");
    return `<ul id="bookmarks">${items}</ul>`;
  }
  renderBookmark(bookmark, readonly) {
    const library = this.library;
    const folder = library ? folderName(library, bookmark.collectionId) : "";
    const fields = `<h3 data-field="title">${escapeHtml(bookmark.title)}</h3><p data-field="url">${escapeHtml(bookmark.url)}</p><p data-field="folder">${escapeHtml(folder)}</p><p data-field="tags">${escapeHtml(bookmark.tags.join(", "))}</p><p data-field="notes">${escapeHtml(bookmark.notes)}</p><p data-field="favorite">${bookmark.favorite ? "已收藏" : "未收藏"}</p>`;
    if (readonly) return `<li data-bookmark-id="${escapeHtml(bookmark.id)}">${fields}</li>`;
    if (bookmark.deletedAt) {
      return `<li data-bookmark-id="${escapeHtml(bookmark.id)}">${fields}<button type="button" data-action="restore" data-bookmark-id="${escapeHtml(bookmark.id)}">恢复</button></li>`;
    }
    return `<li data-bookmark-id="${escapeHtml(bookmark.id)}">${fields}<form data-action="update" data-bookmark-id="${escapeHtml(bookmark.id)}">${bookmarkFields(bookmark, folder)}<button type="submit">保存修改</button></form><button type="button" data-action="delete" data-bookmark-id="${escapeHtml(bookmark.id)}">删除</button></li>`;
  }
  renderConflicts() {
    const localLibrary = this.pending?.attempted;
    const remoteLibrary = this.pending?.remote;
    const items = (this.pending?.conflicts ?? []).map((conflict) => {
      const localFolder = localLibrary ? folderName(localLibrary, conflict.local.collectionId) : "";
      const remoteFolder = remoteLibrary ? folderName(remoteLibrary, conflict.remote.collectionId) : "";
      const fields = conflict.fields.filter((field) => field !== "title").map((field) => `<p data-field="${field}" data-side="local">${escapeHtml(conflictValue(conflict.local, field, localFolder))}</p><p data-field="${field}" data-side="remote">${escapeHtml(conflictValue(conflict.remote, field, remoteFolder))}</p>`).join("");
      const deleted = conflict.fields.includes("deletedAt") ? `<label>删除 <input name="deleted" type="checkbox"${conflict.local.deletedAt ? " checked" : ""}></label>` : "";
      return `<article data-bookmark-id="${escapeHtml(conflict.bookmarkId)}"><h2>选择要保留的版本</h2><p data-title-source="local">${escapeHtml(conflict.localTitle)}</p><p data-title-source="remote">${escapeHtml(conflict.remoteTitle)}</p>` + fields + `<button type="button" data-keep="local" data-bookmark-id="${escapeHtml(conflict.bookmarkId)}">保留网页版本</button><button type="button" data-keep="remote" data-bookmark-id="${escapeHtml(conflict.bookmarkId)}">保留服务版本</button><form data-action="merge-conflict" data-bookmark-id="${escapeHtml(conflict.bookmarkId)}">${bookmarkFields(conflict.local, localFolder)}${deleted}<button type="submit">合并两边</button></form></article>`;
    }).join("");
    return `<section id="conflicts">${items}</section>`;
  }
};
function conflictValue(bookmark, field, folder) {
  if (field === "url") return bookmark.url;
  if (field === "title") return bookmark.title;
  if (field === "notes") return bookmark.notes;
  if (field === "tags") return bookmark.tags.join(", ");
  if (field === "collectionId") return folder || "未分类";
  if (field === "favorite") return bookmark.favorite ? "已收藏" : "未收藏";
  return bookmark.deletedAt ? "已删除" : "未删除";
}
function loginForm() {
  return '<form id="login"><label>用户名 <input name="username" autocomplete="username" required></label><label>密码 <input name="password" type="password" autocomplete="current-password" required></label><button type="submit">登录</button></form>';
}
function importChoice() {
  return '<section id="import-choice"><h2>重复网址处理</h2><button type="button" data-import-action="skip">跳过重复</button><button type="button" data-import-action="update">更新已有记录</button><button type="button" data-import-action="copy">另存一份</button><button type="button" data-action="cancel-import">取消</button></section>';
}
function bookmarkFields(bookmark, folder = "") {
  const title = escapeHtml(bookmark?.title ?? "");
  const url = escapeHtml(bookmark?.url ?? "");
  const notes = escapeHtml(bookmark?.notes ?? "");
  const tags = escapeHtml(bookmark?.tags.join(", ") ?? "");
  const favorite = bookmark?.favorite ? " checked" : "";
  return `<label>标题 <input name="title" value="${title}"></label><label>网址 <input name="url" value="${url}"></label><label>文件夹 <input name="folder" value="${escapeHtml(folder)}"></label><label>标签 <input name="tags" value="${tags}"></label><label>备注 <textarea name="notes">${notes}</textarea></label><label>收藏 <input name="favorite" type="checkbox"${favorite}></label>`;
}

// apps/web/src/main.ts
function startWebApp() {
  const host = globalThis;
  const root = host.document?.querySelector("#root");
  if (!root || !host.fetch) return;
  bindWebApp(root, createWebApp({ fetchImpl: host.fetch.bind(host) }));
}
export {
  startWebApp
};
