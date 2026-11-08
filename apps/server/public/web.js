var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

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
function applyCollectionUpdate(collection, update, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const current = migrateCollection(collection);
  const name = update.name === void 0 ? collection.name : update.name;
  const parentId = update.parentId === void 0 ? collection.parentId : update.parentId ?? void 0;
  const position = update.position === void 0 ? current.position : update.position;
  const toolbar = update.toolbar === void 0 ? current.toolbar : update.toolbar;
  const changed = name !== collection.name || parentId !== collection.parentId || position !== current.position || toolbar !== current.toolbar;
  if (!changed) return current;
  return { ...current, name, parentId, position, toolbar, updatedAt: now, revision: collection.revision + 1 };
}

// apps/web/src/client.ts
var WebRequestError = class extends Error {
  constructor(message, status) {
    super(message);
    __publicField(this, "status");
    this.name = "WebRequestError";
    this.status = status;
  }
};
var ADMIN_ERRORS = {
  account_exists: "这个用户名已经有人用了",
  invalid_account: "用户名无效：1–64 个字符，不能包含斜杠或控制字符",
  weak_password: "密码至少 8 个字符",
  account_missing: "这个账号已经不存在了",
  cannot_delete_admin: "管理员账号由环境变量提供，不能在网页上删除",
  forbidden: "只有管理员可以管理账号",
  unauthorized: "登录已过期，请重新登录"
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
    __publicField(this, "token");
  }
  sessionToken() {
    return this.token;
  }
  async checkSession() {
    try {
      const response = await this.request("/api/session", { method: "GET" });
      if (!response.ok) return void 0;
      const body = await readJson(response);
      if (!body || typeof body !== "object") return void 0;
      const record = body;
      if (typeof record.username !== "string" || !record.username) return void 0;
      if (typeof record.token === "string" && record.token) this.token = record.token;
      return { username: record.username, admin: record.admin === true };
    } catch {
      return void 0;
    }
  }
  async listAccounts() {
    const response = await this.request("/api/admin/accounts", { method: "GET" });
    await this.adminCheck(response);
    const body = await readJson(response);
    if (!body || !Array.isArray(body.accounts)) throw new WebRequestError("连不上服务", response.status);
    return body.accounts.filter((item) => Boolean(item) && typeof item.username === "string").map((item) => ({ username: item.username, createdAt: typeof item.createdAt === "string" ? item.createdAt : null, admin: item.admin === true }));
  }
  async createAccount(username, password) {
    const response = await this.request("/api/admin/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    await this.adminCheck(response);
    const body = await readJson(response);
    return typeof body?.username === "string" ? body.username : username.trim();
  }
  async resetPassword(username, password) {
    const response = await this.request(`/api/admin/accounts/${encodeURIComponent(username)}/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    await this.adminCheck(response);
  }
  async deleteAccount(username) {
    const response = await this.request(`/api/admin/accounts/${encodeURIComponent(username)}`, { method: "DELETE" });
    await this.adminCheck(response);
  }
  async adminCheck(response) {
    if (response.ok) return;
    const body = await readJson(response);
    const code = typeof body?.error === "string" ? body.error : "";
    throw new WebRequestError(ADMIN_ERRORS[code] ?? "连不上服务，账号没有改动", response.status);
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
    return { username: record.username, token: record.token, admin: record.admin === true };
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

// apps/web/src/icons.ts
var SVG_ATTR = 'class="ui-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
var PATHS = {
  bookmark: '<path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  bookmarkPlus: '<path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><path d="M12 7v6M9 10h6"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  inbox: '<path d="M22 13h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 13v5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5l-3.5-7.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  trash: '<path d="M3.5 6h17"/><path d="M9 6V4h6v2"/><path d="m6 6 .8 13a2 2 0 0 0 2 1.9h6.4a2 2 0 0 0 2-1.9L18 6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  rows: '<path d="M4 5h16M4 10h16M4 15h16M4 20h16"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7h2A5.5 5.5 0 0 0 22 11c0-5-4.5-9-10-9z"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  move: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8.5 13h7M12.5 10l3 3-3 3"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'
};
function webIcon(name) {
  return `<svg ${SVG_ATTR}>${PATHS[name]}</svg>`;
}
function starSvg(filled) {
  return filled ? `<svg class="ui-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">${PATHS.star}</svg>` : webIcon("star");
}
function webLogo(size = 28) {
  return `<svg class="logo-mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false"><defs><linearGradient id="lm-web-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c6cff"/><stop offset="1" stop-color="#ec5fa8"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#lm-web-grad)"/><path d="M11 8.5h10a1.5 1.5 0 0 1 1.5 1.5v14l-6.5-3.8L9.5 24V10A1.5 1.5 0 0 1 11 8.5z" fill="#fff" fill-opacity=".95"/><path d="M19.5 4.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="#fff"/></svg>`;
}

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
var textOrder = new Intl.Collator(void 0, { sensitivity: "base", numeric: true });
var RECENT_DAYS = 30;
function isHttpBookmarkUrl(url) {
  return /^https?:\/\//i.test(url.trim());
}
function tileHueFor(seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 360;
}
function titleInitialFor(title, url = "") {
  const source = (title || domainFromUrl(url) || url).trim();
  const match = source.match(/[\p{L}\p{N}]/u);
  return (match ? match[0] : "★").toUpperCase();
}
function formatRelativeTime(iso, nowMs = Date.now()) {
  if (!iso) return "";
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const diffSec = Math.max(0, Math.floor((nowMs - time) / 1e3));
  if (diffSec < 60) return "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} 天前`;
  return iso.slice(0, 10);
}
function liveBookmarksOf(model) {
  const gone = new Set(model.purged);
  return model.bookmarks.filter((bookmark) => !bookmark.deletedAt && !bookmark.purgedAt && !gone.has(bookmark.id) && !isSeparator(bookmark));
}
function trashedBookmarksOf(model) {
  const gone = new Set(model.purged);
  return model.bookmarks.filter((bookmark) => Boolean(bookmark.deletedAt) && !bookmark.purgedAt && !gone.has(bookmark.id) && !isSeparator(bookmark));
}
function aliveFolderIdsOf(collections) {
  return new Set(collections.filter((collection) => !collection.deletedAt).map((collection) => collection.id));
}
function scopeCountsOf(model, nowMs = Date.now()) {
  const live = liveBookmarksOf(model);
  const trashed = trashedBookmarksOf(model);
  const aliveFolders = aliveFolderIdsOf(model.collections);
  const since = new Date(nowMs - RECENT_DAYS * 864e5).toISOString();
  return {
    all: live.length,
    favorites: live.filter((item) => item.favorite).length,
    recent: live.filter((item) => item.createdAt >= since).length,
    unfiled: live.filter((item) => !item.collectionId || !aliveFolders.has(item.collectionId)).length,
    duplicates: extraDuplicateIdsOf(model).length,
    trash: trashed.length
  };
}
function folderTreeOf(model) {
  const alive = model.collections.filter((item) => !item.deletedAt);
  const aliveIds = new Set(alive.map((item) => item.id));
  const directCounts = /* @__PURE__ */ new Map();
  for (const bookmark of liveBookmarksOf(model)) {
    if (bookmark.collectionId && aliveIds.has(bookmark.collectionId)) {
      directCounts.set(bookmark.collectionId, (directCounts.get(bookmark.collectionId) ?? 0) + 1);
    }
  }
  const byParent = /* @__PURE__ */ new Map();
  for (const folder of alive) {
    const parentKey = folder.parentId && aliveIds.has(folder.parentId) ? folder.parentId : void 0;
    const list = byParent.get(parentKey);
    if (list) list.push(folder);
    else byParent.set(parentKey, [folder]);
  }
  for (const list of byParent.values()) {
    list.sort((left, right) => left.position - right.position || textOrder.compare(left.name, right.name));
  }
  const visited = /* @__PURE__ */ new Set();
  const build = (parentId, prefix) => {
    const items = byParent.get(parentId) ?? [];
    const nodes = [];
    for (const item of items) {
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      const path = prefix ? `${prefix} / ${item.name}` : item.name;
      const children = build(item.id, path);
      const directCount = directCounts.get(item.id) ?? 0;
      const totalCount = directCount + children.reduce((sum, child) => sum + child.totalCount, 0);
      nodes.push({
        id: item.id,
        name: item.name,
        path,
        parentId: item.parentId && aliveIds.has(item.parentId) ? item.parentId : void 0,
        directCount,
        totalCount,
        children
      });
    }
    return nodes;
  };
  return build(void 0, "");
}
function folderPathsOf(model) {
  const paths = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      paths.push(node.path);
      walk(node.children);
    }
  };
  walk(folderTreeOf(model));
  return paths;
}
function tagCountsOf(model) {
  const counts = /* @__PURE__ */ new Map();
  for (const bookmark of liveBookmarksOf(model)) {
    for (const raw of bookmark.tags) {
      const tag = raw.trim();
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((left, right) => right.count - left.count || textOrder.compare(left.name, right.name));
}
function duplicateGroupsOf(bookmarks) {
  const groups = /* @__PURE__ */ new Map();
  for (const bookmark of bookmarks) {
    if (bookmark.deletedAt || bookmark.purgedAt || isSeparator(bookmark)) continue;
    const key = urlKey(bookmark.url);
    const group = groups.get(key);
    if (group) group.push(bookmark);
    else groups.set(key, [bookmark]);
  }
  return [...groups.values()].filter((group) => group.length > 1).sort((left, right) => right.length - left.length);
}
var keepScore = (bookmark) => (bookmark.favorite ? 4 : 0) + (bookmark.notes ? 2 : 0) + (bookmark.tags.length ? 1 : 0);
function extraDuplicateIdsOf(model) {
  const alive = aliveFolderIdsOf(model.collections);
  const groups = duplicateGroupsOf(liveBookmarksOf(model));
  return groups.flatMap((group) => {
    const ordered = [...group].sort((left, right) => keepScore(right) - keepScore(left) || Number(Boolean(right.collectionId && alive.has(right.collectionId))) - Number(Boolean(left.collectionId && alive.has(left.collectionId))) || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
    return ordered.slice(1).map((bookmark) => bookmark.id);
  });
}
function cleanDuplicatesInLibrary(model, now) {
  const ids = new Set(extraDuplicateIdsOf(model));
  if (!ids.size) return { model, removed: 0 };
  const bookmarks = model.bookmarks.map((bookmark) => ids.has(bookmark.id) && !bookmark.deletedAt ? { ...bookmark, deletedAt: now, updatedAt: now, revision: bookmark.revision + 1 } : bookmark);
  return { model: { ...model, bookmarks }, removed: ids.size };
}
function visibleBookmarks(model, filter) {
  const gone = new Set(model.purged);
  const query = filter.query.trim().toLowerCase();
  const aliveFolders = aliveFolderIdsOf(model.collections);
  const isTrash = filter.trash || filter.scope === "trash";
  let candidates = model.bookmarks.filter((bookmark) => {
    if (bookmark.purgedAt || gone.has(bookmark.id) || isSeparator(bookmark)) return false;
    if (Boolean(bookmark.deletedAt) !== isTrash) return false;
    return true;
  });
  if (!isTrash) {
    if (filter.scope === "favorites") {
      candidates = candidates.filter((bookmark) => bookmark.favorite);
    } else if (filter.scope === "recent") {
      const since = new Date((filter.now ?? Date.now()) - RECENT_DAYS * 864e5).toISOString();
      candidates = candidates.filter((bookmark) => bookmark.createdAt >= since);
    } else if (filter.scope === "unfiled") {
      candidates = candidates.filter((bookmark) => !bookmark.collectionId || !aliveFolders.has(bookmark.collectionId));
    } else if (filter.scope === "duplicates") {
      const dupIds = new Set(duplicateGroupsOf(candidates).flat().map((item) => item.id));
      candidates = candidates.filter((bookmark) => dupIds.has(bookmark.id));
    } else if (filter.scope === "folder" && filter.folderId) {
      candidates = candidates.filter((bookmark) => bookmark.collectionId === filter.folderId);
    } else if (filter.scope === "tag" && filter.tag) {
      const tagLower = filter.tag.toLowerCase();
      candidates = candidates.filter((bookmark) => bookmark.tags.some((t) => t.toLowerCase() === tagLower));
    }
  }
  const filtered = candidates.filter((bookmark) => {
    if (filter.favoritesOnly && !bookmark.favorite) return false;
    if (filter.domain && bookmark.domain.toLowerCase() !== filter.domain.toLowerCase()) return false;
    if (query) {
      const folder = folderPathName(model, bookmark.collectionId).toLowerCase();
      const haystack = [bookmark.title, bookmark.url, bookmark.domain, bookmark.notes, folder, ...bookmark.tags].join(" ").toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
  if (filter.sort) {
    const field = filter.sort;
    const dir = filter.direction === "asc" ? 1 : -1;
    filtered.sort((left, right) => {
      const a = String(left[field] ?? "");
      const b = String(right[field] ?? "");
      const cmp = field === "title" || field === "domain" ? textOrder.compare(a, b) : a < b ? -1 : a > b ? 1 : 0;
      return cmp * dir;
    });
  } else if (filter.scope === "duplicates") {
    filtered.sort((left, right) => urlKey(left.url).localeCompare(urlKey(right.url)));
  }
  return filtered;
}
function folderName(model, collectionId) {
  if (!collectionId) return "";
  return model.collections.find((collection) => collection.id === collectionId && !collection.deletedAt)?.name ?? model.collections.find((collection) => collection.id === collectionId)?.name ?? "";
}
function folderPathName(model, collectionId) {
  if (!collectionId) return "";
  const byId = new Map(model.collections.filter((item) => !item.deletedAt).map((item) => [item.id, item]));
  const names = [];
  const seen = /* @__PURE__ */ new Set();
  let current = byId.get(collectionId) ?? model.collections.find((item) => item.id === collectionId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : void 0;
  }
  return names.join(" / ");
}
function folderFor(model, name, now) {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return { model, collectionId: void 0 };
  const parts = trimmed.split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { model, collectionId: void 0 };
  if (parts.length === 1) {
    const single = parts[0];
    const topMatch = model.collections.find((collection) => !collection.deletedAt && !collection.parentId && collection.name === single);
    if (topMatch) return { model, collectionId: topMatch.id };
    const anyMatch = model.collections.find((collection) => !collection.deletedAt && collection.name === single);
    if (anyMatch) return { model, collectionId: anyMatch.id };
  }
  let nextModel = model;
  let parentId;
  for (const part of parts) {
    const existing = nextModel.collections.find((collection2) => !collection2.deletedAt && (collection2.parentId ?? void 0) === parentId && collection2.name === part);
    if (existing) {
      parentId = existing.id;
      continue;
    }
    const collection = {
      id: crypto.randomUUID(),
      name: part,
      parentId,
      position: nextModel.collections.filter((item) => !item.deletedAt && (item.parentId ?? void 0) === parentId).length,
      toolbar: false,
      createdAt: now,
      updatedAt: now,
      revision: 1
    };
    nextModel = { ...nextModel, collections: [...nextModel.collections, collection] };
    parentId = collection.id;
  }
  return { model: nextModel, collectionId: parentId };
}
function createCollectionInLibrary(model, name, parentId, now) {
  const trimmed = name.trim();
  if (!trimmed) return model;
  const existing = model.collections.find((item) => !item.deletedAt && (item.parentId ?? void 0) === parentId && item.name === trimmed);
  if (existing) return model;
  const collection = {
    id: crypto.randomUUID(),
    name: trimmed,
    parentId,
    position: model.collections.filter((item) => !item.deletedAt && (item.parentId ?? void 0) === parentId).length,
    toolbar: false,
    createdAt: now,
    updatedAt: now,
    revision: 1
  };
  return { ...model, collections: [...model.collections, collection] };
}
function renameCollectionInLibrary(model, id2, name, now) {
  const trimmed = name.trim();
  if (!trimmed) return model;
  const current = model.collections.find((item) => item.id === id2 && !item.deletedAt);
  if (!current) return model;
  const updated = applyCollectionUpdate(current, { name: trimmed }, now);
  return { ...model, collections: model.collections.map((item) => item.id === id2 ? updated : item) };
}
function deleteCollectionInLibrary(model, id2, now) {
  const descendants = /* @__PURE__ */ new Set([id2]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of model.collections) {
      if (!item.deletedAt && item.parentId && descendants.has(item.parentId) && !descendants.has(item.id)) {
        descendants.add(item.id);
        grew = true;
      }
    }
  }
  const collections = model.collections.map((item) => descendants.has(item.id) && !item.deletedAt ? { ...item, deletedAt: now, updatedAt: now, revision: item.revision + 1 } : item);
  const bookmarks = model.bookmarks.map((bookmark) => bookmark.collectionId && descendants.has(bookmark.collectionId) && !bookmark.deletedAt ? applyBookmarkUpdate(bookmark, { collectionId: null }, now) : bookmark);
  return { ...model, collections, bookmarks };
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
function deleteBookmarksBatch(model, ids, now) {
  const target = new Set(ids);
  const bookmarks = model.bookmarks.map((bookmark) => {
    if (!target.has(bookmark.id) || bookmark.deletedAt || bookmark.purgedAt || model.purged.includes(bookmark.id)) return bookmark;
    return { ...bookmark, deletedAt: now, updatedAt: now, revision: bookmark.revision + 1 };
  });
  return { ...model, bookmarks };
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
function restoreBookmarksBatch(model, ids, now) {
  const target = new Set(ids);
  const bookmarks = model.bookmarks.map((bookmark) => {
    if (!target.has(bookmark.id) || !bookmark.deletedAt || bookmark.purgedAt || model.purged.includes(bookmark.id)) return bookmark;
    const restored = { ...bookmark, updatedAt: now, revision: bookmark.revision + 1 };
    delete restored.deletedAt;
    return restored;
  });
  return { ...model, bookmarks };
}
function purgeBookmarksBatch(model, ids) {
  const target = new Set(ids);
  const purged = new Set(model.purged);
  const bookmarks = [];
  for (const bookmark of model.bookmarks) {
    if (target.has(bookmark.id)) purged.add(bookmark.id);
    else bookmarks.push(bookmark);
  }
  return { ...model, bookmarks, purged: [...purged].sort() };
}
function moveBookmarksBatch(model, ids, folder, now) {
  const ensured = folderFor(model, folder, now);
  const target = new Set(ids);
  const bookmarks = ensured.model.bookmarks.map((bookmark) => {
    if (!target.has(bookmark.id) || bookmark.deletedAt || bookmark.purgedAt) return bookmark;
    if ((bookmark.collectionId ?? void 0) === ensured.collectionId) return bookmark;
    return applyBookmarkUpdate(bookmark, { collectionId: ensured.collectionId ?? null }, now);
  });
  return { ...ensured.model, bookmarks };
}
function favoriteBookmarksBatch(model, ids, favorite, now) {
  const target = new Set(ids);
  const bookmarks = model.bookmarks.map((bookmark) => {
    if (!target.has(bookmark.id) || bookmark.deletedAt || bookmark.purgedAt || bookmark.favorite === favorite) return bookmark;
    return applyBookmarkUpdate(bookmark, { favorite }, now);
  });
  return { ...model, bookmarks };
}
function tagBookmarksBatch(model, ids, addTags, removeTags, now) {
  const target = new Set(ids);
  const dropped = new Set(removeTags.map((t) => t.toLowerCase()));
  const added = addTags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  const bookmarks = model.bookmarks.map((bookmark) => {
    if (!target.has(bookmark.id) || bookmark.deletedAt || bookmark.purgedAt) return bookmark;
    const nextTags = [.../* @__PURE__ */ new Set([...bookmark.tags.filter((t) => !dropped.has(t.toLowerCase())), ...added])].sort();
    if (nextTags.join("\n") === [...bookmark.tags].sort().join("\n")) return bookmark;
    return applyBookmarkUpdate(bookmark, { tags: nextTags }, now);
  });
  return { ...model, bookmarks };
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
var ACCENT_CHOICES = ["iris", "ember", "rose", "ocean", "jade", "graphite"];
var OFFLINE = "连不上服务，没有显示书签库。";
var EMPTY = "这个账号还没有书签。";
var NO_MATCH = "没有符合条件的书签。";
var UNSAVED = "没有保存成。账号保持原样。";
var INVALID_URL = "网址无效：请填写 http:// 或 https:// 开头的网址。账号保持原样。";
var PAGE_SIZE = 200;
var SORTS = {
  "updatedAt:desc": { label: "最近修改", field: "updatedAt", direction: "desc" },
  "createdAt:desc": { label: "最新添加", field: "createdAt", direction: "desc" },
  "createdAt:asc": { label: "最早添加", field: "createdAt", direction: "asc" },
  "title:asc": { label: "标题 A→Z", field: "title", direction: "asc" },
  "domain:asc": { label: "按网站", field: "domain", direction: "asc" }
};
var SCOPES = [
  { scope: "all", label: "全部书签", icon: "layers" },
  { scope: "favorites", label: "收藏", icon: "star" },
  { scope: "recent", label: "最近 30 天", icon: "clock" },
  { scope: "unfiled", label: "未归类", icon: "inbox" },
  { scope: "duplicates", label: "重复网址", icon: "copy" },
  { scope: "trash", label: "回收站", icon: "trash" }
];
function createWebApp(options = {}) {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  return new WebController(
    new AccountClient(fetchImpl, options.baseUrl),
    options.now ?? (() => (/* @__PURE__ */ new Date()).toISOString()),
    { theme: "light", accent: "iris", ...options.appearance },
    { view: "list", sort: "updatedAt:desc", ...options.preferences }
  );
}
function splitTags(value) {
  return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
}
function detectFormat(text, chosen) {
  if (chosen === "html" || chosen === "json") return chosen;
  return /^\s*[{[]/.test(text) ? "json" : "html";
}
var host = () => globalThis;
function downloadText(name, content, type) {
  const { document, URL: url, Blob: BlobCtor } = host();
  if (!document?.createElement || !url?.createObjectURL || !BlobCtor) return false;
  const href = url.createObjectURL(new BlobCtor([content], { type }));
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  document.body?.append?.(link);
  link.click();
  link.remove?.();
  url.revokeObjectURL?.(href);
  return true;
}
function applyAppearanceToDocument(appearance) {
  const dataset = host().document?.documentElement?.dataset;
  if (!dataset) return;
  dataset.theme = appearance.theme;
  dataset.accent = appearance.accent;
}
function remember(key, value) {
  try {
    host().localStorage?.setItem(key, value);
  } catch {
  }
}
function focusSelector(element) {
  const el = element;
  if (!el || !el.tagName || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return void 0;
  const caret = { start: el.selectionStart, end: el.selectionEnd };
  if (el.id) return { selector: `#${el.id}`, ...caret };
  if (!el.name || !el.form) return void 0;
  if (el.form.id) return { selector: `#${el.form.id} [name="${el.name}"]`, ...caret };
  const bookmark = el.form.getAttribute?.("data-bookmark-id");
  const action = el.form.getAttribute?.("data-action");
  if (bookmark && action) return { selector: `form[data-action="${action}"][data-bookmark-id="${bookmark}"] [name="${el.name}"]`, ...caret };
  return void 0;
}
var PASSWORD_CHARS = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomPassword(length = 14) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => PASSWORD_CHARS[byte % PASSWORD_CHARS.length]).join("");
}
function fieldKey(field) {
  if (!field.name || !field.form || field.type === "file" || field.type === "hidden" || field.type === "password") return void 0;
  const form = field.form.id || `${field.form.getAttribute?.("data-action") ?? ""}:${field.form.getAttribute?.("data-bookmark-id") ?? ""}`;
  return `${form}|${field.name}`;
}
function unsavedFields(root) {
  const kept = /* @__PURE__ */ new Map();
  for (const field of root.querySelectorAll?.("form input, form textarea, form select") ?? []) {
    const key = fieldKey(field);
    const edited = field.type === "checkbox" ? field.checked !== field.defaultChecked : field.defaultValue !== void 0 && field.value !== field.defaultValue;
    if (key && edited) kept.set(key, field);
  }
  return kept;
}
function restoreFields(root, kept) {
  if (!kept.size) return;
  for (const field of root.querySelectorAll?.("form input, form textarea, form select") ?? []) {
    const key = fieldKey(field);
    const old = key ? kept.get(key) : void 0;
    if (!old) continue;
    if (field.type === "checkbox") field.checked = old.checked;
    else field.value = old.value;
  }
}
function bindWebApp(root, app) {
  let toastTimer;
  let opener;
  let lastAutofocus;
  const paint = (keepTyping = true) => {
    const memory = focusSelector(host().document?.activeElement);
    const kept = keepTyping ? unsavedFields(root) : /* @__PURE__ */ new Map();
    const hadModal = Boolean(root.querySelector?.(".modal"));
    root.innerHTML = app.render();
    restoreFields(root, kept);
    const modal = root.querySelector?.(".modal");
    const autofocus = modal?.querySelector?.("[data-autofocus]");
    const autofocusKey = autofocus ? `${autofocus.id ?? ""}|${autofocus.name ?? ""}` : void 0;
    const freshAutofocus = Boolean(autofocusKey && autofocusKey !== lastAutofocus);
    lastAutofocus = autofocusKey;
    if (keepTyping && memory && root.querySelector && !freshAutofocus) {
      try {
        const next = root.querySelector(memory.selector);
        next?.focus?.();
        if (memory.start != null && memory.end != null) next?.setSelectionRange?.(memory.start, memory.end);
      } catch {
      }
    }
    if (host().document) {
      const active = host().document?.activeElement;
      if (modal) {
        if (freshAutofocus || !modal.contains?.(active)) (autofocus ?? modal.querySelector?.("input:not([type=hidden]), textarea") ?? modal.querySelector?.("button"))?.focus?.();
      } else if (hadModal && opener) {
        root.querySelector?.(opener)?.focus?.();
        opener = void 0;
      }
    }
    const { setTimeout: later, clearTimeout: cancel } = host();
    if (later) {
      if (toastTimer !== void 0) cancel?.(toastTimer);
      toastTimer = void 0;
      if (root.innerHTML.includes('id="toast"')) {
        toastTimer = later(() => {
          toastTimer = void 0;
          app.dismissToast();
          paint();
        }, 6e3);
      }
    }
  };
  const finish = (result) => {
    paint();
    void result.then(() => paint(false), () => paint());
  };
  const closest = (target, selector) => {
    if (!target) return null;
    if (target.closest) return target.closest(selector);
    return target.getAttribute ? target : null;
  };
  const attr = (target, name) => target?.getAttribute?.(name) ?? "";
  root.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    if (!form?.elements) return;
    const value = (name) => form.elements?.[name]?.value ?? "";
    const checked = (name) => Boolean(form.elements?.[name]?.checked);
    const action = form.getAttribute?.("data-action");
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
      }, value("force") === "1"));
      return;
    }
    if (form.id === "import") {
      const content = value("content");
      finish(app.beginImport(content, detectFormat(content, value("format"))));
      return;
    }
    if (form.id === "folder-form") {
      const id2 = form.getAttribute?.("data-folder-id") ?? "";
      const parent = form.getAttribute?.("data-parent-id") ?? "";
      finish(id2 ? app.renameFolder(id2, value("name")) : app.createFolder(value("name"), parent || void 0));
      return;
    }
    if (form.id === "account-create") {
      finish(app.createAccount(value("username"), value("password")));
      return;
    }
    if (action === "account-reset") {
      finish(app.resetAccountPassword(form.getAttribute?.("data-username") ?? "", value("password")));
      return;
    }
    if (form.id === "batch-move") {
      finish(app.moveMany(app.selectedIds(), value("folder")));
      return;
    }
    if (form.id === "batch-tag") {
      finish(app.tagMany(app.selectedIds(), splitTags(value("tags"))));
      return;
    }
    if (action === "update") {
      finish(app.updateBookmark(form.getAttribute?.("data-bookmark-id") ?? "", {
        title: value("title"),
        url: value("url"),
        folder: value("folder"),
        tags: splitTags(value("tags")),
        notes: value("notes"),
        favorite: checked("favorite")
      }));
      return;
    }
    if (action === "merge-conflict") {
      const deleted = form.elements?.deleted;
      finish(app.chooseConflict(form.getAttribute?.("data-bookmark-id") ?? "", "merged", {
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
    const raw = event.target;
    if (raw?.getAttribute?.("data-modal-backdrop") != null) {
      app.closeModal();
      paint();
      return;
    }
    const target = closest(raw, "button, a[data-action], [data-tag-link]");
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
    const scope = target.getAttribute("data-scope");
    if (scope) {
      app.setScope(scope, attr(target, "data-scope-value") || void 0);
      paint();
      return;
    }
    const tagLink = target.getAttribute("data-tag-link");
    if (tagLink) {
      app.setScope("tag", tagLink);
      paint();
      return;
    }
    const view = target.getAttribute("data-view");
    if (view === "list" || view === "compact" || view === "grid") {
      app.setView(view);
      remember("lumamark-web-view", view);
      paint();
      return;
    }
    const accent = target.getAttribute("data-accent-choice");
    if (accent && ACCENT_CHOICES.includes(accent)) {
      app.setAppearance({ accent });
      applyAppearanceToDocument(app.appearance());
      remember("lumamark-accent", accent);
      paint();
      return;
    }
    const action = target.getAttribute("data-action");
    const id2 = target.getAttribute("data-bookmark-id") ?? "";
    const confirmed = (key) => {
      if (app.armConfirm(key)) return true;
      paint();
      return false;
    };
    switch (action) {
      case "delete":
        finish(app.deleteBookmark(id2));
        break;
      case "restore":
        finish(app.restoreBookmark(id2));
        break;
      case "favorite":
        finish(app.toggleFavorite(id2));
        break;
      case "edit":
        opener = `[data-action="edit"][data-bookmark-id="${id2}"]`;
        app.startEdit(id2);
        paint();
        break;
      case "cancel-edit":
        app.startEdit(void 0);
        paint();
        break;
      case "close-modal":
        app.closeModal();
        paint();
        break;
      case "open-accounts":
        opener = '[data-action="open-accounts"]';
        finish(app.openAccounts());
        break;
      case "account-reset":
        app.setResetTarget(attr(target, "data-username"));
        paint();
        break;
      case "account-delete": {
        const name = attr(target, "data-username");
        if (confirmed(`account-delete:${name}`)) finish(app.deleteAccount(name));
        break;
      }
      case "dismiss-account-notice":
        app.dismissAccountNotice();
        paint();
        break;
      case "generate-password": {
        const field = root.querySelector?.(attr(target, "data-target"));
        if (field) {
          field.value = randomPassword();
          field.focus?.();
          field.select?.();
        }
        break;
      }
      case "copy-text": {
        const text = attr(target, "data-text");
        const clipboard = globalThis.navigator?.clipboard;
        if (clipboard && text) {
          void clipboard.writeText(text).then(() => {
            const label = target.querySelector?.("span");
            if (label) label.textContent = "已复制";
          }, () => void 0);
        }
        break;
      }
      case "copy-link": {
        const url = attr(target, "data-url");
        const clipboard = globalThis.navigator?.clipboard;
        if (clipboard && url) void clipboard.writeText(url).then(() => {
          app.notify("链接已复制");
          paint();
        }, () => void 0);
        break;
      }
      case "empty-trash":
        if (confirmed("empty-trash")) finish(app.emptyTrash());
        break;
      case "restore-all":
        finish(app.restoreMany(app.visibleBookmarks().map((item) => item.id)));
        break;
      case "clean-duplicates":
        if (confirmed("clean-duplicates")) finish(app.cleanDuplicates());
        break;
      case "logout":
        finish(app.logout());
        break;
      case "retry":
        finish(app.refresh());
        break;
      case "to-login":
        app.goToLogin();
        paint();
        break;
      case "cancel-import":
        app.cancelImport();
        paint();
        break;
      case "toggle-panel": {
        const panel = attr(target, "data-panel");
        if (panel === "add") opener = '.top-tools [data-panel="add"]';
        app.setPanel(panel || "none");
        paint();
        break;
      }
      case "export-json": {
        const content = app.exportJson();
        app.notify(downloadText("lumamark-export.json", content, "application/json") ? "已下载 LumaMark JSON 备份" : "导出内容已准备好");
        paint();
        break;
      }
      case "export-html": {
        const content = app.exportHtml();
        app.notify(downloadText("lumamark-bookmarks.html", content, "text/html") ? "已下载 HTML 书签文件，可导入任何浏览器" : "导出内容已准备好");
        paint();
        break;
      }
      case "show-trash":
        app.showTrash(true);
        paint();
        break;
      case "show-library":
        app.showTrash(false);
        paint();
        break;
      case "show-more":
        app.showMore();
        paint();
        break;
      case "clear-selection":
        app.clearSelection();
        paint();
        break;
      case "batch-delete":
        finish(app.deleteMany(app.selectedIds()));
        break;
      case "batch-restore":
        finish(app.restoreMany(app.selectedIds()));
        break;
      case "batch-purge":
        if (confirmed("batch-purge")) finish(app.purgeMany(app.selectedIds()));
        break;
      case "batch-favorite":
        finish(app.favoriteMany(app.selectedIds(), true));
        break;
      case "batch-unfavorite":
        finish(app.favoriteMany(app.selectedIds(), false));
        break;
      case "undo":
        finish(app.restoreMany(splitTags(attr(target, "data-ids"))));
        break;
      case "dismiss-toast":
        app.dismissToast();
        paint();
        break;
      case "clear-search":
        app.search("");
        paint();
        break;
      case "theme-toggle": {
        app.setAppearance({ theme: app.appearance().theme === "dark" ? "light" : "dark" });
        applyAppearanceToDocument(app.appearance());
        remember("lumamark-theme", app.appearance().theme);
        paint();
        break;
      }
      case "new-folder":
        app.setFolderDraft({ mode: "create", parentId: attr(target, "data-parent-id") || void 0 });
        paint();
        break;
      case "rename-folder":
        app.setFolderDraft({ mode: "rename", id: attr(target, "data-folder-id") });
        paint();
        break;
      case "cancel-folder":
        app.setFolderDraft(void 0);
        paint();
        break;
      case "delete-folder": {
        const folderId = attr(target, "data-folder-id");
        if (confirmed(`delete-folder:${folderId}`)) finish(app.deleteFolder(folderId));
        break;
      }
      default:
        break;
    }
  });
  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!target) return;
    if (target.id === "favorites-only") {
      app.setFavoritesOnly(Boolean(target.checked));
      paint();
      return;
    }
    if (target.id === "sort") {
      app.setSort(target.value ?? "");
      remember("lumamark-web-sort", target.value ?? "");
      paint();
      return;
    }
    if (target.id === "select-all") {
      app.selectAll(Boolean(target.checked));
      paint();
      return;
    }
    const selectId = target.getAttribute?.("data-select");
    if (selectId) {
      app.toggleSelected(selectId, Boolean(target.checked));
      paint();
      return;
    }
    if (target.id === "import-file") {
      const file = target.files?.[0];
      if (!file) return;
      void file.text().then((text) => {
        finish(app.beginImport(text, detectFormat(text, /\.json$/i.test(file.name) ? "json" : /\.html?$/i.test(file.name) ? "html" : "auto")));
      }, () => {
        app.notify("读不了这个文件，账号保持不变。");
        paint();
      });
    }
  });
  root.addEventListener("input", (event) => {
    const target = event.target;
    if (target?.name !== "query" || target.id !== "query") return;
    app.search(target.value ?? "");
    paint();
  });
  const onKey = (event) => {
    if (event.isComposing || app.snapshot().mode !== "library") return;
    const target = event.target;
    const typing = Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
    const modal = root.querySelector?.(".modal");
    if (modal) {
      if (event.key === "Escape") {
        event.preventDefault();
        app.closeModal();
        paint();
        return;
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        const form = target?.closest?.("form");
        if (form?.requestSubmit) {
          event.preventDefault();
          form.requestSubmit();
        }
        return;
      }
      if (event.key === "Tab") {
        const items = Array.from(modal.querySelectorAll?.('button:not([disabled]), input:not([type="hidden"]):not([disabled]), textarea, select, a[href]') ?? []);
        if (!items.length) return;
        const active = host().document?.activeElement;
        const index = items.indexOf(active);
        if (!modal.contains?.(active) || event.shiftKey && index === 0 || !event.shiftKey && index === items.length - 1) {
          event.preventDefault();
          items[event.shiftKey ? items.length - 1 : 0].focus();
        }
      }
      return;
    }
    if (event.key === "Escape") {
      if (target?.id === "query" && target.value) {
        app.search("");
        paint();
        return;
      }
      app.startEdit(void 0);
      app.setFolderDraft(void 0);
      app.clearSelection();
      app.armConfirm(void 0);
      paint();
      return;
    }
    if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "/") {
      const search = root.querySelector?.("#query");
      if (search?.focus) {
        event.preventDefault();
        search.focus();
      }
    } else if (event.key === "n") {
      event.preventDefault();
      opener = '.top-tools [data-panel="add"]';
      app.setPanel("add", false);
      paint();
    }
  };
  const page = host().document;
  if (page?.addEventListener) page.addEventListener("keydown", onKey);
  else root.addEventListener("keydown", onKey);
  paint();
  finish(app.restoreSession());
}
var WebController = class {
  constructor(client, now, look, prefs) {
    this.client = client;
    this.now = now;
    this.look = look;
    this.prefs = prefs;
    __publicField(this, "library");
    __publicField(this, "etag");
    __publicField(this, "username");
    __publicField(this, "loginName", "");
    __publicField(this, "mode", "login");
    __publicField(this, "message", "");
    __publicField(this, "query", "");
    __publicField(this, "favoritesOnly", false);
    __publicField(this, "scope", "all");
    __publicField(this, "lastScope", "all");
    __publicField(this, "folderId");
    __publicField(this, "tag");
    __publicField(this, "limit", PAGE_SIZE);
    __publicField(this, "panel", "none");
    __publicField(this, "editingId");
    __publicField(this, "selection", /* @__PURE__ */ new Set());
    __publicField(this, "confirmKey");
    __publicField(this, "folderDraft");
    __publicField(this, "addDraft");
    __publicField(this, "addError");
    __publicField(this, "editError");
    __publicField(this, "modal");
    __publicField(this, "admin", false);
    __publicField(this, "accounts");
    __publicField(this, "accountsLoading", false);
    __publicField(this, "accountsError");
    __publicField(this, "accountNotice");
    __publicField(this, "resetTarget");
    __publicField(this, "toast");
    __publicField(this, "busy", false);
    __publicField(this, "importDraft");
    __publicField(this, "pending");
    if (!SORTS[this.prefs.sort]) this.prefs.sort = "updatedAt:desc";
  }
  async login(username, password) {
    this.loginName = username;
    this.busy = true;
    try {
      const session = await this.client.login(username, password);
      this.username = session.username;
      this.admin = session.admin === true;
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
    } finally {
      this.busy = false;
    }
    try {
      await this.reload();
    } catch (error) {
      this.failRead();
      throw error;
    }
  }
  async restoreSession() {
    if (this.username || this.library) return false;
    const session = await this.client.checkSession();
    if (!session || this.username || this.library || this.mode !== "login") return false;
    this.username = session.username;
    this.admin = session.admin;
    try {
      await this.reload();
      return true;
    } catch {
      this.username = void 0;
      this.mode = "login";
      this.message = "";
      return false;
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
    if (!this.username) {
      this.goToLogin();
      return;
    }
    this.busy = true;
    try {
      await this.reload();
    } catch (error) {
      this.failRead();
      throw error;
    } finally {
      this.busy = false;
    }
  }
  goToLogin() {
    this.clearSession();
  }
  search(query) {
    this.query = query;
    this.limit = PAGE_SIZE;
    this.refreshMessage();
  }
  setFavoritesOnly(value) {
    this.favoritesOnly = value;
    this.refreshMessage();
  }
  showTrash(value) {
    if (value) {
      if (this.scope !== "trash") this.lastScope = this.scope;
      this.setScope("trash");
    } else this.setScope(this.lastScope === "trash" ? "all" : this.lastScope, this.lastScope === "folder" ? this.folderId : this.tag);
  }
  setScope(scope, value) {
    if (!SCOPES.some((item) => item.scope === scope) && scope !== "folder" && scope !== "tag") return;
    this.scope = scope;
    this.folderId = scope === "folder" ? value : void 0;
    this.tag = scope === "tag" ? value : void 0;
    this.limit = PAGE_SIZE;
    this.selection.clear();
    this.editingId = void 0;
    this.confirmKey = void 0;
    this.refreshMessage();
  }
  setSort(value) {
    if (SORTS[value]) this.prefs.sort = value;
  }
  setView(view) {
    this.prefs.view = view;
  }
  setPanel(panel, toggle = true) {
    if (panel === "add") {
      if (this.modal === "add" && toggle) this.closeModal();
      else {
        this.closeModal();
        this.modal = "add";
      }
      return;
    }
    this.panel = toggle && this.panel === panel ? "none" : panel;
  }
  modalOpen() {
    return this.mode === "library" ? this.modal : void 0;
  }
  closeModal() {
    this.modal = void 0;
    this.editingId = void 0;
    this.editError = void 0;
    this.addDraft = void 0;
    this.addError = void 0;
    this.resetTarget = void 0;
    this.accountNotice = void 0;
    this.accountsError = void 0;
    this.confirmKey = void 0;
  }
  async openAccounts() {
    if (!this.admin) return;
    this.closeModal();
    this.modal = "accounts";
    await this.loadAccounts();
  }
  async loadAccounts() {
    this.accountsLoading = true;
    try {
      this.accounts = await this.client.listAccounts();
    } catch (error) {
      this.accountsError = error instanceof Error ? error.message : "连不上服务";
    } finally {
      this.accountsLoading = false;
    }
  }
  async accountStep(step) {
    this.accountsError = void 0;
    this.accountNotice = void 0;
    this.busy = true;
    try {
      await step();
    } catch (error) {
      this.accountsError = error instanceof Error ? error.message : "连不上服务，账号没有改动";
      throw error;
    } finally {
      this.busy = false;
    }
    await this.loadAccounts();
  }
  async createAccount(username, password) {
    await this.accountStep(async () => {
      if (password.length < 8) throw new Error("密码至少 8 个字符");
      const created = await this.client.createAccount(username, password);
      this.accountNotice = { kind: "created", username: created, password };
    });
  }
  async resetAccountPassword(username, password) {
    await this.accountStep(async () => {
      if (password.length < 8) throw new Error("密码至少 8 个字符");
      await this.client.resetPassword(username, password);
      this.resetTarget = void 0;
      this.accountNotice = { kind: "reset", username, password };
    });
  }
  async deleteAccount(username) {
    await this.accountStep(async () => {
      await this.client.deleteAccount(username);
      this.accountNotice = { kind: "deleted", username };
    });
  }
  setResetTarget(username) {
    this.resetTarget = this.resetTarget === username ? void 0 : username;
    this.accountsError = void 0;
  }
  dismissAccountNotice() {
    this.accountNotice = void 0;
  }
  setAppearance(appearance) {
    this.look = { ...this.look, ...appearance };
  }
  appearance() {
    return { ...this.look };
  }
  showMore() {
    this.limit += PAGE_SIZE;
  }
  startEdit(id2) {
    if (!id2) {
      if (this.modal === "edit") this.closeModal();
      return;
    }
    this.closeModal();
    this.modal = "edit";
    this.editingId = id2;
  }
  toggleSelected(id2, value = !this.selection.has(id2)) {
    if (value) this.selection.add(id2);
    else this.selection.delete(id2);
    this.confirmKey = void 0;
  }
  selectAll(value) {
    this.selection.clear();
    if (value) for (const bookmark of this.visibleBookmarks()) this.selection.add(bookmark.id);
  }
  clearSelection() {
    this.selection.clear();
  }
  selectedIds() {
    const visible = new Set(this.visibleBookmarks().map((item) => item.id));
    return [...this.selection].filter((id2) => visible.has(id2));
  }
  /** Destructive steps ask twice: the first click arms the button, the second one acts. */
  armConfirm(key) {
    if (key && this.confirmKey === key) {
      this.confirmKey = void 0;
      return true;
    }
    this.confirmKey = key;
    return false;
  }
  setFolderDraft(draft) {
    this.folderDraft = draft;
  }
  dismissToast() {
    this.toast = void 0;
  }
  notify(text) {
    this.toast = { text };
  }
  async addBookmark(input, force = false) {
    const library = this.requireLibrary();
    const url = this.typedUrl(input.url);
    let model;
    try {
      const normalized = normalizeBookmarkUrl(url);
      if (!isHttpBookmarkUrl(normalized)) throw new Error("not http");
      const existing = liveBookmarksOf(library).find((item) => urlKey(item.url) === urlKey(normalized));
      if (existing && !force) {
        this.addDraft = { ...input, url: normalized, duplicateOf: existing.id };
        this.addError = `这个网址已经保存过：「${existing.title || existing.url}」。可以修改后再保存，或仍然另存一份。`;
        return;
      }
      model = addBookmark(library, { ...input, url: normalized }, this.now());
    } catch (error) {
      this.addDraft = { ...input };
      this.addError = INVALID_URL;
      throw error;
    }
    this.addDraft = { ...input };
    this.addError = void 0;
    try {
      await this.persist(model, `已保存「${input.title?.trim() || domainFromUrl(url)}」`);
    } catch (error) {
      this.addError = UNSAVED;
      throw error;
    }
    if (this.mode === "library" && this.modal === "add") this.closeModal();
    else if (this.mode === "conflict") this.closeModal();
    else this.addDraft = void 0;
  }
  async updateBookmark(id2, patch) {
    let model;
    try {
      model = updateBookmark(this.requireLibrary(), id2, patch.url === void 0 ? patch : { ...patch, url: this.typedUrl(patch.url) }, this.now());
    } catch (error) {
      this.message = patch.url !== void 0 ? INVALID_URL : UNSAVED;
      this.editError = this.message;
      throw error;
    }
    try {
      await this.persist(model, "修改已保存");
    } catch (error) {
      this.editError = UNSAVED;
      throw error;
    }
    if (this.modal === "edit") this.closeModal();
    this.editingId = void 0;
  }
  async toggleFavorite(id2) {
    const bookmark = this.requireLibrary().bookmarks.find((item) => item.id === id2);
    if (!bookmark) return;
    await this.persist(favoriteBookmarksBatch(this.requireLibrary(), [id2], !bookmark.favorite, this.now()), bookmark.favorite ? "已取消收藏" : "已加入收藏");
  }
  async deleteBookmark(id2) {
    await this.persist(deleteBookmark(this.requireLibrary(), id2, this.now()), { text: "已移到回收站", undo: { kind: "restore", ids: [id2] } });
    if (this.editingId === id2) this.closeModal();
  }
  async restoreBookmark(id2) {
    await this.persist(restoreBookmark(this.requireLibrary(), id2, this.now()), "已恢复");
  }
  async restoreMany(ids) {
    if (!ids.length) return;
    await this.persist(restoreBookmarksBatch(this.requireLibrary(), ids, this.now()), `已恢复 ${ids.length} 个书签`);
    this.selection.clear();
  }
  async emptyTrash() {
    const count = trashedBookmarksOf(this.requireLibrary()).length;
    await this.persist(emptyTrash(this.requireLibrary()), count ? `已彻底删除 ${count} 个书签` : void 0);
  }
  async purgeMany(ids) {
    if (!ids.length) return;
    await this.persist(purgeBookmarksBatch(this.requireLibrary(), ids), `已彻底删除 ${ids.length} 个书签`);
    this.selection.clear();
  }
  async deleteMany(ids) {
    if (!ids.length) return;
    await this.persist(deleteBookmarksBatch(this.requireLibrary(), ids, this.now()), { text: `已把 ${ids.length} 个书签移到回收站`, undo: { kind: "restore", ids: [...ids] } });
    this.selection.clear();
  }
  async favoriteMany(ids, favorite) {
    if (!ids.length) return;
    await this.persist(favoriteBookmarksBatch(this.requireLibrary(), ids, favorite, this.now()), favorite ? `已收藏 ${ids.length} 个书签` : `已取消收藏 ${ids.length} 个书签`);
  }
  async moveMany(ids, folder) {
    if (!ids.length) return;
    await this.persist(moveBookmarksBatch(this.requireLibrary(), ids, folder, this.now()), folder.trim() ? `已移到「${folder.trim()}」` : "已移到未归类");
    this.selection.clear();
  }
  async tagMany(ids, tags) {
    if (!ids.length || !tags.length) return;
    await this.persist(tagBookmarksBatch(this.requireLibrary(), ids, tags, [], this.now()), `已给 ${ids.length} 个书签加上标签`);
  }
  async cleanDuplicates() {
    const ids = extraDuplicateIdsOf(this.requireLibrary());
    const result = cleanDuplicatesInLibrary(this.requireLibrary(), this.now());
    if (!result.removed) return;
    await this.persist(result.model, { text: `已把 ${result.removed} 个多余副本移到回收站`, undo: { kind: "restore", ids } });
  }
  async createFolder(name, parentId) {
    if (!name.trim()) {
      this.folderDraft = void 0;
      return;
    }
    await this.persist(createCollectionInLibrary(this.requireLibrary(), name, parentId, this.now()), `已新建文件夹「${name.trim()}」`);
    this.folderDraft = void 0;
  }
  async renameFolder(id2, name) {
    if (!name.trim()) {
      this.folderDraft = void 0;
      return;
    }
    await this.persist(renameCollectionInLibrary(this.requireLibrary(), id2, name, this.now()), "文件夹已改名");
    this.folderDraft = void 0;
  }
  async deleteFolder(id2) {
    await this.persist(deleteCollectionInLibrary(this.requireLibrary(), id2, this.now()), "文件夹已删除，里面的书签移到了未归类");
    if (this.scope === "folder" && this.folderId === id2) this.setScope("all");
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
    await this.persist(applyImport(library, parsed, "skip", this.now()), `已导入 ${parsed.bookmarks.length} 个书签`);
    this.panel = "none";
    return "applied";
  }
  async chooseImport(action) {
    if (action !== "skip" && action !== "update" && action !== "copy") throw new Error("未知的重复项处理方式");
    if (!this.library || !this.importDraft) throw new Error("还没有需要选择的重复项");
    await this.persist(applyImport(this.library, this.importDraft, action, this.now()), "导入完成");
    this.panel = "none";
  }
  cancelImport() {
    this.importDraft = void 0;
    if (!this.library) return;
    this.mode = "library";
    this.refreshMessage();
  }
  exportJson() {
    return exportJson(this.requireLibrary(), this.now());
  }
  exportHtml() {
    return exportHtml(this.requireLibrary());
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
      this.toast = { text: "已按你的选择保存" };
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
      admin: this.admin,
      importPending: this.mode === "import-choice",
      conflicts: this.pending?.conflicts.map((conflict) => ({ ...conflict })) ?? []
    };
  }
  sessionToken() {
    return this.client.sessionToken();
  }
  render() {
    if (this.mode === "offline") return this.renderOffline();
    if (this.mode === "login" || !this.library || !this.username) return this.renderLogin();
    return this.renderWorkspace();
  }
  // ── State plumbing ──
  typedUrl(value) {
    const trimmed = value.trim();
    if (!trimmed || /^[a-z][\w+.-]*:/i.test(trimmed)) return trimmed;
    return /^[^\s/]+\.[^\s/]+/.test(trimmed) ? `https://${trimmed}` : trimmed;
  }
  requireLibrary() {
    if (!this.library || !this.etag) throw new WebRequestError("没有进入账号", 401);
    return this.library;
  }
  filter() {
    const sort = SORTS[this.prefs.sort] ?? SORTS["updatedAt:desc"];
    return {
      query: this.query,
      favoritesOnly: this.favoritesOnly,
      trash: this.scope === "trash",
      scope: this.scope,
      folderId: this.folderId,
      tag: this.tag,
      sort: this.scope === "duplicates" ? void 0 : sort.field,
      direction: sort.direction
    };
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
    this.scope = "all";
    this.folderId = void 0;
    this.tag = void 0;
    this.selection.clear();
    this.closeModal();
    this.panel = "none";
    this.limit = PAGE_SIZE;
    this.refreshMessage();
  }
  async persist(model, done) {
    const current = this.requireLibrary();
    this.confirmKey = void 0;
    if (librarySignature(model) === librarySignature(current)) {
      this.mode = "library";
      this.importDraft = void 0;
      this.refreshMessage();
      return;
    }
    this.busy = true;
    try {
      await this.writeModel(model, this.etag ?? "");
      if (done) this.toast = typeof done === "string" ? { text: done } : done;
    } catch (error) {
      if (error instanceof WebRequestError && error.status === 412) {
        await this.noteConflict(model);
        return;
      }
      this.message = UNSAVED;
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async writeModel(model, etag) {
    const nextEtag = await this.client.writeManifest(manifestFromLibrary(model, this.now()), etag);
    this.library = model;
    this.etag = nextEtag;
    this.mode = "library";
    this.pending = void 0;
    this.importDraft = void 0;
    const alive = new Set(this.visibleBookmarks().map((item) => item.id));
    for (const id2 of [...this.selection]) if (!alive.has(id2)) this.selection.delete(id2);
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
    this.scope = "all";
    this.folderId = void 0;
    this.tag = void 0;
    this.selection.clear();
    this.closeModal();
    this.admin = false;
    this.accounts = void 0;
    this.folderDraft = void 0;
    this.toast = void 0;
    this.panel = "none";
    this.mode = "login";
    this.message = "";
  }
  refreshMessage() {
    if (!this.library || this.mode !== "library") return;
    const visible = visibleBookmarks(this.library, this.filter());
    if (this.query.trim() || this.favoritesOnly || this.scope !== "all") {
      this.message = visible.length || this.scope !== "all" && !this.query.trim() && !this.favoritesOnly ? "" : NO_MATCH;
      return;
    }
    this.message = this.liveCount() ? "" : EMPTY;
  }
  liveCount() {
    return this.library ? liveBookmarksOf(this.library).length : 0;
  }
  // ── Rendering ──
  renderNotice() {
    if (!this.message || this.message === EMPTY || this.message === NO_MATCH) return '<p id="notice" role="status"></p>';
    const tone = /连不上|不正确|没有保存成|没有写入|没有退出|没有切换|网址无效/.test(this.message) ? "danger" : /尚未选择|两边都改过|没有导入|已经保存过/.test(this.message) ? "warning" : "info";
    const icon = tone === "info" ? "" : webIcon("alert");
    return `<p id="notice" role="status" data-tone="${tone}">${icon}<span>${escapeHtml(this.message)}</span></p>`;
  }
  renderLogin() {
    return `<div data-mode="login" class="auth-page"><section class="auth-card" aria-labelledby="auth-title"><header class="auth-head"><p class="auth-brand" id="auth-title">${webLogo(34)}<span>LumaMark</span></p><p class="auth-sub">登录你自己部署的书签服务，在任何电脑上整理同一份书签。</p></header>` + this.renderNotice() + `<form id="login" class="auth-form"><label><span>用户名</span><input name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required value="${escapeHtml(this.loginName)}"${this.loginName ? "" : " autofocus"}></label><label><span>密码</span><input name="password" type="password" autocomplete="current-password" required${this.loginName ? " autofocus" : ""}></label><button type="submit" class="primary"${this.busy ? ' disabled aria-busy="true"' : ""}>登录</button></form><p class="auth-foot">账号由管理员创建，此页面不能注册。</p></section></div>`;
  }
  renderOffline() {
    return `<div data-mode="offline" class="auth-page"><section class="auth-card"><header class="auth-head"><span class="empty-badge" aria-hidden="true">${webIcon("alert")}</span><h1 class="auth-brand">暂时连不上服务</h1><p class="auth-sub">书签都还在服务器上，只是这台电脑现在访问不到。检查网络或服务是否在运行后再试。</p></header>` + this.renderNotice() + `<div class="drawer-foot"><button type="button" class="ghost" data-action="to-login">返回登录</button><button type="button" class="primary" data-action="retry">${webIcon("sync")}<span>重新连接</span></button></div></section></div>`;
  }
  scopeTitle() {
    const library = this.library;
    if (this.scope === "folder" && library) return folderName(library, this.folderId) || "文件夹";
    if (this.scope === "tag") return `#${this.tag ?? ""}`;
    return SCOPES.find((item) => item.scope === this.scope)?.label ?? "全部书签";
  }
  renderWorkspace() {
    const library = this.library;
    const readonly = this.mode !== "library";
    const visible = this.visibleBookmarks();
    const account = `<span class="account-pill" data-account="${escapeHtml(this.username ?? "")}" title="当前账号：${escapeHtml(this.username ?? "")}"><span class="account-avatar" aria-hidden="true">${escapeHtml(titleInitialFor(this.username ?? ""))}</span><span class="account-name">${escapeHtml(this.username ?? "")}</span></span>`;
    let body = "";
    if (this.mode === "conflict" && this.pending) body = this.renderConflicts();
    else if (this.mode === "import-choice") body = importChoice(this.importDraft ? countDuplicateImports(library, this.importDraft) : 0);
    const shellAttrs = `data-mode="${this.mode}" data-bookmark-count="${readonly ? this.liveCount() : visible.length}"${this.busy ? ' aria-busy="true"' : ""}`;
    return `<div class="web-shell" ${shellAttrs}>` + this.renderSidebar(library, account, readonly) + `<main class="web-main">${this.renderTop(visible.length, readonly)}<div class="web-body">${this.renderNotice()}${body}${readonly ? "" : this.renderScopeBanner(visible.length)}${this.renderList(visible, readonly)}</div></main>` + (readonly ? "" : this.renderBatchDock()) + this.renderToast() + this.renderModal() + `</div>`;
  }
  renderSidebar(library, account, readonly) {
    const counts = scopeCountsOf(library);
    const navButton = (scope, label, icon, count, value) => {
      const pressed = this.scope === scope && (scope !== "folder" || this.folderId === value) && (scope !== "tag" || this.tag === value);
      return `<button type="button" class="nav-btn" data-scope="${scope}"${value ? ` data-scope-value="${escapeHtml(value)}"` : ""} aria-pressed="${pressed}"${readonly ? " disabled" : ""}><span class="nav-icon" aria-hidden="true">${icon}</span><span class="nav-label">${escapeHtml(label)}</span>${count ? `<span class="nav-count">${count.toLocaleString()}</span>` : ""}</button>`;
    };
    const scopes = SCOPES.filter((item) => item.scope !== "duplicates" || counts.duplicates || this.scope === "duplicates").map((item) => navButton(item.scope, item.label, webIcon(item.icon), counts[item.scope] ?? 0)).join("");
    const draftForm = (draft, initial = "") => `<form id="folder-form" class="folder-inline-form"${draft.id ? ` data-folder-id="${escapeHtml(draft.id)}"` : ""}${draft.parentId ? ` data-parent-id="${escapeHtml(draft.parentId)}"` : ""}><input id="folder-name" name="name" value="${escapeHtml(initial)}" placeholder="文件夹名称" aria-label="文件夹名称" autocomplete="off" autofocus required><button type="submit" class="primary">${draft.mode === "rename" ? "改名" : "新建"}</button><button type="button" class="icon-btn" data-action="cancel-folder" aria-label="取消">${webIcon("x")}</button></form>`;
    const folderNode = (node) => {
      if (this.folderDraft?.mode === "rename" && this.folderDraft.id === node.id) {
        return `<div class="folder-node">${draftForm(this.folderDraft, node.name)}${node.children.length ? `<div class="folder-children">${node.children.map(folderNode).join("")}</div>` : ""}</div>`;
      }
      const deleteArmed = this.confirmKey === `delete-folder:${node.id}`;
      const tools = readonly ? "" : `<span class="folder-tools"><button type="button" class="folder-tool" data-action="new-folder" data-parent-id="${escapeHtml(node.id)}" title="新建子文件夹" aria-label="在「${escapeHtml(node.name)}」里新建文件夹">${webIcon("plus")}</button><button type="button" class="folder-tool" data-action="rename-folder" data-folder-id="${escapeHtml(node.id)}" title="改名" aria-label="给「${escapeHtml(node.name)}」改名">${webIcon("pencil")}</button><button type="button" class="folder-tool danger${deleteArmed ? " is-armed" : ""}" data-action="delete-folder" data-folder-id="${escapeHtml(node.id)}" title="${deleteArmed ? "再点一次确认删除" : "删除文件夹"}" aria-label="${deleteArmed ? "再点一次确认删除" : `删除「${escapeHtml(node.name)}」`}">${deleteArmed ? webIcon("check") : webIcon("trash")}</button></span>`;
      const childDraft = this.folderDraft?.mode === "create" && this.folderDraft.parentId === node.id ? draftForm(this.folderDraft) : "";
      const children = node.children.length || childDraft ? `<div class="folder-children">${node.children.map(folderNode).join("")}${childDraft}</div>` : "";
      return `<div class="folder-node"><div class="folder-row">${navButton("folder", node.name, webIcon("folder"), node.totalCount, node.id)}${tools}</div>${children}</div>`;
    };
    const tree = folderTreeOf(library);
    const rootDraft = this.folderDraft?.mode === "create" && !this.folderDraft.parentId ? draftForm(this.folderDraft) : "";
    const folders = `<div class="side-group"><div class="side-section-head"><span>文件夹</span>${readonly ? "" : `<button type="button" class="icon-btn" data-action="new-folder" title="新建文件夹" aria-label="新建文件夹">${webIcon("folderPlus")}</button>`}</div>` + (tree.length || rootDraft ? tree.map(folderNode).join("") + rootDraft : `<p class="side-empty">还没有文件夹。新增书签时填写文件夹名，会自动创建。</p>`) + `</div>`;
    const tags = tagCountsOf(library).slice(0, 40);
    const tagCloud = tags.length ? `<div class="side-group"><div class="side-section-head"><span>标签</span></div><div class="tag-cloud">` + tags.map((tag) => `<button type="button" class="tag-pill" data-scope="tag" data-scope-value="${escapeHtml(tag.name)}" aria-pressed="${this.scope === "tag" && this.tag === tag.name}"${readonly ? " disabled" : ""}><span>${escapeHtml(tag.name)}</span><span class="tag-pill-count">${tag.count}</span></button>`).join("") + `</div></div>` : "";
    const swatches = ACCENT_CHOICES.map((accent) => `<button type="button" class="swatch-btn" data-accent-choice="${accent}" aria-pressed="${this.look.accent === accent}" aria-label="强调色 ${accent}" title="强调色"></button>`).join("");
    return `<aside class="web-side"><div class="side-brand-row"><span class="side-brand">${webLogo(26)}<span>LumaMark</span></span><span class="side-badge">网页版</span></div><div class="side-scroll"><nav class="side-group" aria-label="书签库">${scopes}</nav>${folders}${tagCloud}</div><footer class="side-foot"><div class="theme-popover"><div class="swatch-row" role="group" aria-label="强调色">${swatches}</div><button type="button" class="icon-btn" data-action="theme-toggle" title="${this.look.theme === "dark" ? "切换到浅色" : "切换到深色"}" aria-label="${this.look.theme === "dark" ? "切换到浅色" : "切换到深色"}">${webIcon(this.look.theme === "dark" ? "sun" : "moon")}</button></div><div class="account-bar">${account}<span class="side-foot-actions">` + (this.admin ? `<button type="button" class="icon-btn" data-action="open-accounts" aria-haspopup="dialog" title="账号管理" aria-label="账号管理">${webIcon("user")}</button>` : "") + `<button type="button" class="icon-btn" data-action="retry" title="从服务器重新读取" aria-label="从服务器重新读取">${webIcon("sync")}</button><button type="button" class="icon-btn" data-action="logout" title="退出" aria-label="退出">${webIcon("logout")}</button></span></div></footer></aside>`;
  }
  renderTop(count, readonly) {
    const viewButton = (view, label, icon) => `<button type="button" data-view="${view}" aria-pressed="${this.prefs.view === view}" title="${label}" aria-label="${label}">${webIcon(icon)}</button>`;
    const panelButton = (panel, label, icon, cls) => `<button type="button" class="${cls}" data-action="toggle-panel" data-panel="${panel}" aria-expanded="${this.panel === panel}"${readonly ? " disabled" : ""}>${webIcon(icon)}<span>${label}</span></button>`;
    const sortOptions = Object.entries(SORTS).map(([value, sort]) => `<option value="${value}"${value === this.prefs.sort ? " selected" : ""}>${sort.label}</option>`).join("");
    const tools = readonly ? "" : `<div class="search-toolbar"><form id="search" role="search"><div class="search-box"><span class="search-glyph" aria-hidden="true">${webIcon("search")}</span><label class="sr-only" for="query">搜索书签</label><input id="query" name="query" type="search" autocomplete="off" placeholder="搜索标题、网址、标签、备注或文件夹（按 / 聚焦）" value="${escapeHtml(this.query)}"><button type="submit" class="ghost search-submit">搜索</button></div></form><div class="filter-controls"><label class="check-chip"><input id="favorites-only" type="checkbox"${this.favoritesOnly ? " checked" : ""}> 只看收藏</label><label class="sr-only" for="sort">排序</label><select id="sort" class="sort-select">${sortOptions}</select><div class="view-switcher" role="group" aria-label="显示方式">${viewButton("list", "列表", "list")}${viewButton("compact", "紧凑", "rows")}${viewButton("grid", "卡片", "grid")}</div></div></div>`;
    return `<header class="web-top"><div class="top-head"><div class="title-group"><h1>${escapeHtml(this.scopeTitle())}</h1><span class="count-pill">${count.toLocaleString()} 个</span></div><div class="top-tools">${panelButton("import", "导入", "upload", "ghost")}${panelButton("export", "导出", "download", "ghost")}<button type="button" class="primary" data-action="toggle-panel" data-panel="add" aria-haspopup="dialog" title="新增书签（N）"${readonly ? " disabled" : ""}>${webIcon("plus")}<span>新增书签</span></button></div></div>` + tools + (readonly ? "" : this.renderPanel()) + `</header>`;
  }
  renderPanel() {
    if (this.panel === "import") {
      return `<form id="import" class="drawer-panel"><div class="drawer-head"><h2>${webIcon("upload")}导入书签</h2><button type="button" class="icon-btn" data-action="toggle-panel" data-panel="import" aria-label="收起">${webIcon("x")}</button></div><p class="form-hint">选择浏览器导出的 HTML 书签文件或 LumaMark JSON 备份。遇到已有网址时会先问你怎么处理。</p><label class="file-drop"><span>${webIcon("upload")} 选择文件</span><input id="import-file" type="file" accept=".html,.htm,.json,text/html,application/json"></label><label><span>或者粘贴内容</span><textarea name="content" rows="5" placeholder="&lt;!DOCTYPE NETSCAPE-Bookmark-file-1&gt; 或 { &quot;format&quot;: &quot;lumamark&quot; … }"></textarea></label><div class="drawer-foot"><label class="inline-select"><span>格式</span><select name="format"><option value="auto">自动识别</option><option value="html">HTML</option><option value="json">LumaMark JSON</option></select></label><button type="submit" class="primary">导入</button></div></form>`;
    }
    if (this.panel === "export") {
      return `<section class="drawer-panel" aria-label="导出"><div class="drawer-head"><h2>${webIcon("download")}导出书签</h2><button type="button" class="icon-btn" data-action="toggle-panel" data-panel="export" aria-label="收起">${webIcon("x")}</button></div><div class="export-grid"><button type="button" class="secondary export-card" data-action="export-json">${webIcon("download")}<strong>导出 JSON</strong><small>完整备份：含文件夹、标签、备注和回收站，可再导入 LumaMark。</small></button><button type="button" class="secondary export-card" data-action="export-html">${webIcon("download")}<strong>导出 HTML</strong><small>通用书签文件，可导入 Chrome、Edge、Firefox、Safari。</small></button></div></section>`;
    }
    return "";
  }
  renderScopeBanner(count) {
    const library = this.library;
    if (this.scope === "duplicates") {
      const extra = scopeCountsOf(library).duplicates;
      if (!extra) return "";
      const armed = this.confirmKey === "clean-duplicates";
      return `<div class="scope-banner"><div class="scope-banner-text"><strong>有 ${extra} 个多余副本</strong><p>每组保留收藏过、有备注或标签、最近改过的那一条，其余移到回收站，可以恢复。</p></div><button type="button" class="${armed ? "danger" : "primary"}" data-action="clean-duplicates">${armed ? "再点一次确认" : "一键清理"}</button></div>`;
    }
    if (this.scope === "trash" && count) {
      const armed = this.confirmKey === "empty-trash";
      return `<div class="scope-banner"><div class="scope-banner-text"><strong>回收站里的书签可以恢复</strong><p>清空后会从账号里彻底删除，其他设备同步后也不会再出现。</p></div><div class="drawer-foot"><button type="button" class="secondary" data-action="restore-all">${webIcon("undo")}<span>全部恢复</span></button><button type="button" class="danger${armed ? " is-armed" : ""}" data-action="empty-trash">${armed ? "再点一次确认清空" : "清空回收站"}</button></div></div>`;
    }
    return "";
  }
  renderEmpty() {
    const query = this.query.trim();
    if (query || this.favoritesOnly) {
      return emptyBox(
        "search",
        "没有符合条件的书签",
        query ? `没有找到包含「${query}」的书签。换个关键词，或在全部书签里搜索。` : "当前范围里没有收藏的书签。",
        `${query ? '<button type="button" class="secondary" data-action="clear-search">清除搜索</button>' : ""}${this.scope !== "all" ? '<button type="button" class="ghost" data-scope="all">查看全部书签</button>' : ""}`
      );
    }
    if (this.scope === "trash") return emptyBox("trash", "回收站是空的", "删除的书签会先放在这里，可以随时恢复。");
    if (this.scope === "favorites") return emptyBox("star", "还没有收藏", "点书签右侧的星标，常用的网址就会出现在这里。");
    if (this.scope === "recent") return emptyBox("clock", "最近 30 天没有新书签", "新保存的书签会先出现在这里。");
    if (this.scope === "unfiled") return emptyBox("inbox", "所有书签都已归类", "没有放进文件夹的书签会出现在这里。");
    if (this.scope === "duplicates") return emptyBox("copy", "没有重复的网址", "同一个网址保存了多次时，会在这里集中处理。");
    if (this.scope === "folder") return emptyBox("folder", "这个文件夹是空的", "新增书签时选择这个文件夹，或者在列表里勾选书签后批量移进来。", '<button type="button" class="primary" data-action="toggle-panel" data-panel="add">新增书签</button>');
    if (this.scope === "tag") return emptyBox("tag", "这个标签下没有书签", "标签可以在编辑书签时添加。");
    const box = emptyBox(
      "bookmark",
      EMPTY.replace("。", ""),
      "在下面填入网址保存第一条书签，或者导入浏览器导出的 HTML 书签文件。",
      '<button type="button" class="secondary" data-action="toggle-panel" data-panel="import">导入书签</button>'
    );
    if (this.modal === "add") return box;
    return `${box}<form id="add" class="drawer-panel empty-add">${this.addFormBody()}<div class="drawer-foot"><span class="form-hint">只填网址也可以，标题默认用网站名。</span><button type="submit" class="primary"${this.busy ? " disabled" : ""}>${this.addDraft?.duplicateOf ? "仍然另存一份" : "保存书签"}</button></div></form>`;
  }
  datalists() {
    const library = this.library;
    return `<datalist id="folder-options">${folderPathsOf(library).map((path) => `<option value="${escapeHtml(path)}"></option>`).join("")}</datalist><datalist id="tag-options">${tagCountsOf(library).slice(0, 60).map((tag) => `<option value="${escapeHtml(tag.name)}"></option>`).join("")}</datalist>`;
  }
  addFormBody() {
    const library = this.library;
    const draft = this.addDraft;
    const fields = bookmarkFields({
      title: draft?.title ?? "",
      url: draft?.url ?? "",
      folder: draft?.folder ?? (this.scope === "folder" ? folderPathName(library, this.folderId) : ""),
      tags: (draft?.tags ?? (this.scope === "tag" && this.tag ? [this.tag] : [])).join(", "),
      notes: draft?.notes ?? "",
      favorite: draft?.favorite ?? this.scope === "favorites"
    }, true);
    const force = draft?.duplicateOf ? '<input type="hidden" name="force" value="1">' : "";
    return `${fields}${force}${this.datalists()}${formAlert(this.addError, draft?.duplicateOf ? "warning" : "danger")}`;
  }
  renderModal() {
    const modal = this.modalOpen();
    if (!modal) return "";
    const close = `<button type="button" class="icon-btn modal-close" data-action="close-modal" title="关闭（Esc）" aria-label="关闭">${webIcon("x")}</button>`;
    const wrap = (inner) => `<div class="modal-backdrop" data-modal-backdrop>${inner}</div>`;
    const busy = this.busy ? ' disabled aria-busy="true"' : "";
    if (modal === "add") {
      return wrap(`<form id="add" class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><span class="modal-icon" aria-hidden="true">${webIcon("bookmarkPlus")}</span><div class="modal-title-group"><h2 id="modal-title">新增书签</h2><p class="modal-sub">只填网址也可以，标题默认用网站名。</p></div>${close}</header><div class="modal-body">${this.addFormBody()}</div><footer class="modal-foot"><span class="form-hint">Ctrl + Enter 保存</span><button type="button" class="ghost" data-action="close-modal">取消</button><button type="submit" class="primary"${busy}>${this.addDraft?.duplicateOf ? "仍然另存一份" : "保存书签"}</button></footer></form>`);
    }
    if (modal === "edit") {
      const library = this.library;
      const bookmark = library.bookmarks.find((item) => item.id === this.editingId && !item.deletedAt);
      if (!bookmark) return "";
      const id2 = escapeHtml(bookmark.id);
      const nowMs = Date.parse(this.now()) || Date.now();
      const fields = bookmarkFields({ title: bookmark.title, url: bookmark.url, folder: folderPathName(library, bookmark.collectionId), tags: bookmark.tags.join(", "), notes: bookmark.notes, favorite: bookmark.favorite }, false);
      return wrap(`<form class="modal" data-action="update" data-bookmark-id="${id2}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><span class="bm-tile" style="--tile-hue:${tileHueFor(bookmark.domain || bookmark.title)}" aria-hidden="true">${escapeHtml(titleInitialFor(bookmark.title, bookmark.url))}</span><div class="modal-title-group"><h2 id="modal-title">编辑书签</h2><p class="modal-sub">${escapeHtml(bookmark.domain || bookmark.url)} · 添加于 ${escapeHtml(formatRelativeTime(bookmark.createdAt, nowMs))} · 修改于 ${escapeHtml(formatRelativeTime(bookmark.updatedAt, nowMs))}</p></div>${close}</header><div class="modal-body">${fields}${this.datalists()}${formAlert(this.editError, "danger")}</div><footer class="modal-foot"><button type="button" class="ghost danger modal-delete" data-action="delete" data-bookmark-id="${id2}">${webIcon("trash")}<span>移到回收站</span></button><button type="button" class="ghost" data-action="close-modal">取消</button><button type="submit" class="primary"${busy}>保存修改</button></footer></form>`);
    }
    return wrap(`<section class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><span class="modal-icon" aria-hidden="true">${webIcon("user")}</span><div class="modal-title-group"><h2 id="modal-title">账号管理</h2><p class="modal-sub">管理员账号由服务器环境变量提供；其他人的账号在这里创建。每个账号有自己独立的书签库。</p></div>${close}</header><div class="modal-body">${this.renderAccountNotice()}${formAlert(this.accountsError, "danger")}<form id="account-create" class="account-create"><div class="account-create-fields"><label><span>用户名</span><input name="username" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64" required${this.resetTarget ? "" : " data-autofocus"}></label><label><span>初始密码</span><span class="password-field"><input id="account-create-password" name="password" type="text" autocomplete="off" spellcheck="false" minlength="8" required placeholder="至少 8 个字符"><button type="button" class="ghost" data-action="generate-password" data-target="#account-create-password">生成</button></span></label></div><button type="submit" class="primary"${busy}>${webIcon("plus")}<span>创建账号</span></button></form>` + this.renderAccountList() + `</div></section>`);
  }
  renderAccountNotice() {
    const notice = this.accountNotice;
    if (!notice) return "";
    const name = escapeHtml(notice.username);
    const dismiss = `<button type="button" class="icon-btn" data-action="dismiss-account-notice" aria-label="关闭提示">${webIcon("x")}</button>`;
    if (notice.kind === "deleted") return `<div class="account-notice">${webIcon("check")}<p>已删除账号 <strong>${name}</strong> 和它的书签。</p>${dismiss}</div>`;
    const password = escapeHtml(notice.password ?? "");
    const lead = notice.kind === "created" ? `已创建账号 <strong>${name}</strong>。把下面的信息交给对方，对方用它登录网页或扩展：` : `已重置 <strong>${name}</strong> 的密码，它在其他地方的登录已经失效：`;
    const credentials = notice.kind === "created" ? `用户名：${notice.username}
密码：${notice.password ?? ""}` : notice.password ?? "";
    return `<div class="account-notice">${webIcon("check")}<div class="account-notice-body"><p>${lead}</p><dl class="credential-list">${notice.kind === "created" ? `<dt>用户名</dt><dd><code>${name}</code></dd>` : ""}<dt>密码</dt><dd><code>${password}</code></dd></dl><button type="button" class="secondary" data-action="copy-text" data-text="${escapeHtml(credentials)}">${webIcon("copy")}<span>复制</span></button></div>${dismiss}</div>`;
  }
  renderAccountList() {
    if (this.accountsLoading && !this.accounts) return '<p class="account-empty">正在读取账号…</p>';
    const accounts = this.accounts ?? [];
    if (!accounts.length) return '<p class="account-empty">还没有其他账号。</p>';
    const nowMs = Date.parse(this.now()) || Date.now();
    const rows = accounts.map((account) => {
      const name = escapeHtml(account.username);
      const badges = (account.admin ? '<span class="side-badge">管理员</span>' : "") + (account.username === this.username ? '<span class="count-pill">当前登录</span>' : "");
      const armed = this.confirmKey === `account-delete:${account.username}`;
      const remove = account.admin ? "" : `<button type="button" class="${armed ? "danger is-armed" : "ghost danger"}" data-action="account-delete" data-username="${name}">${armed ? "再点一次删除" : "删除"}</button>`;
      const reset = account.admin ? "" : `<button type="button" class="ghost" data-action="account-reset" data-username="${name}" aria-expanded="${this.resetTarget === account.username}">重置密码</button>`;
      const resetForm = this.resetTarget === account.username ? `<form class="account-reset" data-action="account-reset" data-username="${name}"><span class="password-field"><input id="account-reset-password" name="password" type="text" autocomplete="off" spellcheck="false" minlength="8" required placeholder="新密码，至少 8 个字符" aria-label="${name} 的新密码" data-autofocus><button type="button" class="ghost" data-action="generate-password" data-target="#account-reset-password">生成</button></span><button type="button" class="ghost" data-action="account-reset" data-username="${name}">取消</button><button type="submit" class="primary">保存新密码</button></form>` : "";
      return `<li class="account-row"><div class="account-row-main"><span class="account-avatar" aria-hidden="true">${escapeHtml(titleInitialFor(account.username))}</span><div class="account-row-text"><p class="account-row-name">${name}${badges}</p><p class="account-row-meta">${account.admin ? "来自环境变量，密码在服务器上修改" : account.createdAt ? `创建于 ${escapeHtml(formatRelativeTime(account.createdAt, nowMs))}` : ""}</p></div><div class="account-row-actions">${reset}${remove}</div></div>${resetForm}</li>`;
    }).join("");
    return `<div class="account-list-head"><span>已有账号</span><span class="count-pill">${accounts.length}</span></div><ul class="account-list">${rows}</ul>`;
  }
  renderList(visible, readonly) {
    if (!visible.length) return `<ul id="bookmarks" data-view="${this.prefs.view}"></ul>${readonly ? "" : this.renderEmpty()}`;
    const shown = visible.slice(0, this.limit);
    const selected = this.selectedIds().length;
    const all = selected > 0 && selected === visible.length;
    const subbar = readonly ? "" : `<div class="list-subbar"><label class="check-line"><input id="select-all" type="checkbox"${all ? " checked" : ""} aria-label="全选当前列表"> ${selected ? `已选 ${selected} 个` : "全选"}</label><span>${visible.length > shown.length ? `显示 ${shown.length} / ${visible.length}` : `${visible.length} 个书签`}</span></div>`;
    const more = visible.length > shown.length ? `<button type="button" class="secondary show-more" data-action="show-more">再显示 ${Math.min(PAGE_SIZE, visible.length - shown.length)} 个</button>` : "";
    const nowMs = Date.parse(this.now()) || Date.now();
    return `${subbar}<ul id="bookmarks" data-view="${this.prefs.view}">${shown.map((bookmark) => this.renderBookmark(bookmark, readonly, nowMs)).join("")}</ul>${more}`;
  }
  renderBookmark(bookmark, readonly, nowMs) {
    const library = this.library;
    const id2 = escapeHtml(bookmark.id);
    const folder = folderPathName(library, bookmark.collectionId);
    const selected = this.selection.has(bookmark.id);
    const editing = !readonly && this.editingId === bookmark.id && !bookmark.deletedAt;
    const hue = tileHueFor(bookmark.domain || bookmark.title);
    const url = escapeHtml(bookmark.url);
    const title = escapeHtml(bookmark.title || bookmark.url);
    const titleNode = isHttpBookmarkUrl(bookmark.url) ? `<a class="bm-title-link" href="${url}" target="_blank" rel="noreferrer noopener" title="${url}">${title}</a>` : `<span class="bm-title-link" title="${url}">${title}</span>`;
    const stamp = bookmark.deletedAt ?? bookmark.updatedAt;
    const meta = `<p class="bm-meta"><span class="bm-url">${escapeHtml(bookmark.domain || bookmark.url)}</span>` + (folder ? `<span class="bm-folder-pill">${webIcon("folder")}${escapeHtml(folder)}</span>` : "") + `<time datetime="${escapeHtml(stamp)}">${bookmark.deletedAt ? "删除于 " : ""}${escapeHtml(formatRelativeTime(stamp, nowMs))}</time></p>`;
    const tags = bookmark.tags.length ? `<p class="bm-tags">${bookmark.tags.map((tag) => readonly ? `<span class="bm-tag">#${escapeHtml(tag)}</span>` : `<button type="button" class="bm-tag" data-tag-link="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join("")}</p>` : "";
    const notes = bookmark.notes ? `<p class="bm-notes">${escapeHtml(bookmark.notes)}</p>` : "";
    const iconBtn = (action, label, icon, extra = "") => `<button type="button" class="icon-btn${extra}" data-action="${action}" data-bookmark-id="${id2}" title="${label}" aria-label="${label}">${icon}</button>`;
    let actions = "";
    if (!readonly) {
      actions = bookmark.deletedAt ? `<div class="bm-actions"><button type="button" class="secondary" data-action="restore" data-bookmark-id="${id2}">${webIcon("undo")}<span>恢复</span></button></div>` : `<div class="bm-actions">${iconBtn("favorite", bookmark.favorite ? "取消收藏" : "收藏", starSvg(bookmark.favorite), bookmark.favorite ? " is-on" : "")}<button type="button" class="icon-btn" data-action="copy-link" data-url="${url}" title="复制链接" aria-label="复制链接">${webIcon("link")}</button>${iconBtn("edit", "编辑", webIcon("pencil"))}${iconBtn("delete", "删除", webIcon("trash"), " danger")}</div>`;
    }
    const check = readonly ? "" : `<label class="bm-check"><input type="checkbox" data-select="${id2}"${selected ? " checked" : ""} aria-label="选择 ${title}"></label>`;
    const classes = `bm-item${selected ? " is-selected" : ""}${editing ? " is-editing" : ""}`;
    return `<li class="${classes}" data-bookmark-id="${id2}"><div class="bm-row">${check}<span class="bm-tile" style="--tile-hue:${hue}" aria-hidden="true">${escapeHtml(titleInitialFor(bookmark.title, bookmark.url))}</span><div class="bm-main"><div class="bm-title-line">${titleNode}${bookmark.favorite ? '<span class="bm-star-badge" aria-label="已收藏">★</span>' : ""}</div>${meta}${notes}${tags}</div>${actions}</div></li>`;
  }
  renderBatchDock() {
    const ids = this.selectedIds();
    if (!ids.length) return "";
    const head = `<span class="batch-count">已选 ${ids.length} 个</span><button type="button" class="icon-btn" data-action="clear-selection" title="取消选择（Esc）" aria-label="取消选择">${webIcon("x")}</button>`;
    if (this.scope === "trash") {
      const armed = this.confirmKey === "batch-purge";
      return `<div class="batch-dock" role="toolbar" aria-label="批量操作">${head}<button type="button" class="primary" data-action="batch-restore">${webIcon("undo")}<span>恢复</span></button><button type="button" class="danger" data-action="batch-purge">${armed ? "再点一次彻底删除" : "彻底删除"}</button></div>`;
    }
    const library = this.library;
    const allFavorite = ids.every((id2) => library.bookmarks.find((item) => item.id === id2)?.favorite);
    return `<div class="batch-dock" role="toolbar" aria-label="批量操作">${head}<form id="batch-move" class="batch-form"><input name="folder" list="folder-options" placeholder="移到文件夹…" aria-label="目标文件夹（留空为未归类）" autocomplete="off"><button type="submit" class="secondary">${webIcon("move")}<span>移动</span></button></form><form id="batch-tag" class="batch-form"><input name="tags" list="tag-options" placeholder="加标签…" aria-label="要添加的标签" autocomplete="off"><button type="submit" class="secondary">${webIcon("tag")}<span>加标签</span></button></form><button type="button" class="ghost" data-action="${allFavorite ? "batch-unfavorite" : "batch-favorite"}">${starSvg(allFavorite)}<span>${allFavorite ? "取消收藏" : "收藏"}</span></button><button type="button" class="danger" data-action="batch-delete">${webIcon("trash")}<span>删除</span></button><datalist id="folder-options">${folderPathsOf(library).map((path) => `<option value="${escapeHtml(path)}"></option>`).join("")}</datalist><datalist id="tag-options">${tagCountsOf(library).slice(0, 60).map((tag) => `<option value="${escapeHtml(tag.name)}"></option>`).join("")}</datalist></div>`;
  }
  renderToast() {
    if (!this.toast || this.mode !== "library") return "";
    const undo = this.toast.undo?.ids.length ? `<button type="button" data-action="undo" data-ids="${escapeHtml(this.toast.undo.ids.join(","))}">撤销</button>` : "";
    return `<div id="toast" class="toast" role="status">${webIcon("check")}<span>${escapeHtml(this.toast.text)}</span>${undo}<button type="button" class="toast-close" data-action="dismiss-toast" aria-label="关闭提示">${webIcon("x")}</button></div>`;
  }
  renderConflicts() {
    const localLibrary = this.pending?.attempted;
    const remoteLibrary = this.pending?.remote;
    const conflicts = this.pending?.conflicts ?? [];
    const done = conflicts.filter((item) => this.pending?.choices.has(item.bookmarkId)).length;
    const items = conflicts.map((conflict) => {
      const chosen = this.pending?.choices.get(conflict.bookmarkId);
      const localFolder = localLibrary ? folderName(localLibrary, conflict.local.collectionId) : "";
      const remoteFolder = remoteLibrary ? folderName(remoteLibrary, conflict.remote.collectionId) : "";
      const side = (which) => {
        const record = which === "local" ? conflict.local : conflict.remote;
        const folder = which === "local" ? localFolder : remoteFolder;
        const titleText = which === "local" ? conflict.localTitle : conflict.remoteTitle;
        const fields = conflict.fields.filter((field) => field !== "title").map((field) => `<div class="conflict-field"><span class="conflict-field-name">${FIELD_NAMES[field]}</span><p data-field="${field}" data-side="${which}">${escapeHtml(conflictValue(record, field, folder))}</p></div>`).join("");
        return `<div class="conflict-box${chosen?.keep === which ? " is-chosen" : ""}"><span class="conflict-box-head">${which === "local" ? "这个网页里的版本" : "服务器上的版本"}</span><div class="conflict-field"><span class="conflict-field-name">标题</span><p data-title-source="${which}">${escapeHtml(titleText)}</p></div>${fields}<button type="button" class="${which === "local" ? "primary" : "secondary"}" data-keep="${which}" data-bookmark-id="${escapeHtml(conflict.bookmarkId)}">${which === "local" ? "保留网页版本" : "保留服务版本"}</button></div>`;
      };
      const deleted = conflict.fields.includes("deletedAt") ? `<label class="check-inline"><input name="deleted" type="checkbox"${conflict.local.deletedAt ? " checked" : ""}> 删除</label>` : "";
      return `<article class="conflict-card" data-bookmark-id="${escapeHtml(conflict.bookmarkId)}"><h2>选择要保留的版本${chosen ? ' <span class="count-pill">已选择</span>' : ""}</h2><div class="conflict-compare">${side("local")}${side("remote")}</div><details class="conflict-merge"><summary>都不对？手动合并两边</summary><form data-action="merge-conflict" data-bookmark-id="${escapeHtml(conflict.bookmarkId)}">${bookmarkFields({ title: conflict.local.title, url: conflict.local.url, folder: localFolder, tags: conflict.local.tags.join(", "), notes: conflict.local.notes, favorite: conflict.local.favorite }, false)}${deleted}<div class="drawer-foot"><button type="submit" class="primary">合并两边</button></div></form></details></article>`;
    }).join("");
    return `<section id="conflicts"><div class="drawer-head"><h2>${webIcon("alert")}有 ${conflicts.length} 条书签在别处也改过</h2><span class="count-pill">${done} / ${conflicts.length}</span></div>${items}</section>`;
  }
};
var FIELD_NAMES = {
  title: "标题",
  url: "网址",
  notes: "备注",
  tags: "标签",
  collectionId: "文件夹",
  favorite: "收藏",
  deletedAt: "回收站"
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
function importChoice(count) {
  return `<section id="import-choice"><div class="drawer-head"><h2>${webIcon("copy")}重复网址处理</h2></div><p class="form-hint">要导入的内容里有 ${count} 个网址已经在书签库中。选择处理方式后才会写入账号。</p><div class="choice-grid"><button type="button" class="secondary choice-card" data-import-action="skip"><strong>跳过重复</strong><small>已有的书签保持原样，只导入新的网址。</small></button><button type="button" class="secondary choice-card" data-import-action="update"><strong>更新已有记录</strong><small>用导入内容覆盖已有书签的标题、标签和备注。</small></button><button type="button" class="secondary choice-card" data-import-action="copy"><strong>另存一份</strong><small>两份都保留，之后可以在“重复网址”里清理。</small></button></div><div class="drawer-foot"><button type="button" class="ghost" data-action="cancel-import">取消</button></div></section>`;
}
function formAlert(text, tone) {
  return text ? `<p class="form-alert" role="alert" data-tone="${tone}">${webIcon("alert")}<span>${escapeHtml(text)}</span></p>` : "";
}
function emptyBox(icon, title, text, actions = "") {
  return `<section class="empty-box" role="status"><span class="empty-badge" aria-hidden="true">${webIcon(icon)}</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p>${actions ? `<div class="drawer-foot">${actions}</div>` : ""}</section>`;
}
function bookmarkFields(values, autofocus) {
  return `<div class="field-grid"><label class="span-2"><span>网址 </span><input name="url" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://example.com" value="${escapeHtml(values.url)}"${autofocus ? " required" : ""}></label><label><span>标题 </span><input name="title" autocomplete="off" placeholder="留空则使用网站名" value="${escapeHtml(values.title)}"></label><label><span>文件夹 </span><input name="folder" list="folder-options" autocomplete="off" placeholder="未归类；用 / 分隔子文件夹" value="${escapeHtml(values.folder)}"></label><label><span>标签 </span><input name="tags" list="tag-options" autocomplete="off" placeholder="用逗号分隔" value="${escapeHtml(values.tags)}"></label><label class="check-inline"><input name="favorite" type="checkbox"${values.favorite ? " checked" : ""}><span>收藏 </span></label><label class="span-2"><span>备注 </span><textarea name="notes" rows="2">${escapeHtml(values.notes)}</textarea></label></div>`;
}

// apps/web/src/styles.ts
var WEB_STYLES = `
:root {
  color-scheme: light;
  font-family: "Inter", "SF Pro Display", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei UI", sans-serif;
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  --canvas: #f3f4f8;
  --surface: #ffffff;
  --surface-raised: #ffffff;
  --surface-sunken: #eceef3;
  --sidebar: #f3f4f8;
  --text: #15171f;
  --muted: #5a5f6e;
  --border: #e3e6ef;
  --border-strong: #ced2df;
  --on-accent: #ffffff;
  --danger: #c8233f;
  --success: #15794a;
  --warning: #9a5800;
  --star: #d99000;
  --hover: color-mix(in srgb, var(--text) 5%, transparent);
  --press: color-mix(in srgb, var(--text) 9%, transparent);
  --accent-soft: color-mix(in srgb, var(--accent) 12%, transparent);
  --accent-glow: color-mix(in srgb, var(--accent) 20%, transparent);
  --accent-line: color-mix(in srgb, var(--accent) 32%, transparent);
  --danger-soft: color-mix(in srgb, var(--danger) 11%, transparent);
  --success-soft: color-mix(in srgb, var(--success) 12%, transparent);
  --warning-soft: color-mix(in srgb, var(--warning) 12%, transparent);
  --focus-ring: color-mix(in srgb, var(--accent) 68%, transparent);
  --glass: color-mix(in srgb, var(--surface) 84%, transparent);
  --glass-strong: color-mix(in srgb, var(--surface-raised) 92%, transparent);
  --text-2xs: 0.6875rem;
  --text-xs: 0.75rem;
  --text-sm: 0.8125rem;
  --text-md: 0.875rem;
  --text-lg: 1.0625rem;
  --text-xl: 1.375rem;
  --text-2xl: 1.875rem;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --radius-sm: 0.5rem;
  --radius-md: 0.6875rem;
  --radius-lg: 0.9375rem;
  --radius-xl: 1.25rem;
  --radius-full: 999px;
  --shadow-1: 0 1px 2px rgba(18, 21, 38, 0.05), 0 2px 6px -1px rgba(18, 21, 38, 0.04);
  --shadow-2: 0 2px 4px -1px rgba(18, 21, 38, 0.05), 0 12px 28px -6px rgba(18, 21, 38, 0.12);
  --shadow-3: 0 4px 12px -2px rgba(18, 21, 38, 0.08), 0 28px 64px -12px rgba(18, 21, 38, 0.24);
  --panel-edge: 0 0 0 1px var(--border), 0 2px 8px -2px rgba(18, 21, 38, 0.05);
  --card-edge: 0 0 0 1px var(--border), 0 1px 3px rgba(18, 21, 38, 0.04);
  --scrim: rgba(15, 17, 28, 0.42);
  --tile-bg: 88% 93%;
  --tile-fg: 48% 30%;
  --band-from: 84% 88%;
  --band-to: 76% 92%;
  --motion-fast: 130ms;
  --motion-base: 210ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --side-width: 16.5rem;
  --editor-width: 24rem;
  --control: 2.1875rem;
  --panel-gap: 0.5625rem;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --canvas: #0d0e13;
    --surface: #15161d;
    --surface-raised: #1d1f28;
    --surface-sunken: #0a0a0f;
    --sidebar: #0d0e13;
    --text: #eceef4;
    --muted: #a0a5b5;
    --border: #252734;
    --border-strong: #393c4d;
    --danger: #ff8094;
    --success: #5fd79b;
    --warning: #f5bd4f;
    --star: #f5c04e;
    --hover: color-mix(in srgb, var(--text) 7%, transparent);
    --press: color-mix(in srgb, var(--text) 12%, transparent);
    --accent-soft: color-mix(in srgb, var(--accent) 16%, transparent);
    --accent-glow: color-mix(in srgb, var(--accent) 24%, transparent);
    --danger-soft: color-mix(in srgb, var(--danger) 14%, transparent);
    --success-soft: color-mix(in srgb, var(--success) 15%, transparent);
    --warning-soft: color-mix(in srgb, var(--warning) 15%, transparent);
    --glass: color-mix(in srgb, var(--surface) 82%, transparent);
    --glass-strong: color-mix(in srgb, var(--surface-raised) 90%, transparent);
    --shadow-1: 0 1px 3px rgba(0, 0, 0, 0.45);
    --shadow-2: 0 2px 6px rgba(0, 0, 0, 0.38), 0 14px 32px -6px rgba(0, 0, 0, 0.62);
    --shadow-3: 0 4px 12px rgba(0, 0, 0, 0.45), 0 30px 72px -12px rgba(0, 0, 0, 0.78);
    --panel-edge: 0 0 0 1px var(--border), inset 0 1px 0 rgba(255, 255, 255, 0.03);
    --card-edge: 0 0 0 1px var(--border), inset 0 1px 0 rgba(255, 255, 255, 0.025);
    --scrim: rgba(0, 0, 0, 0.65);
    --tile-bg: 36% 22%;
    --tile-fg: 82% 82%;
    --band-from: 44% 25%;
    --band-to: 34% 18%;
    --accent: #a99fff;
    --accent-hover: #bdb5ff;
    --accent-text: #b4abff;
    --on-accent: #17132e;
  }
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --canvas: #0d0e13;
  --surface: #15161d;
  --surface-raised: #1d1f28;
  --surface-sunken: #0a0a0f;
  --sidebar: #0d0e13;
  --text: #eceef4;
  --muted: #a0a5b5;
  --border: #252734;
  --border-strong: #393c4d;
  --danger: #ff8094;
  --success: #5fd79b;
  --warning: #f5bd4f;
  --star: #f5c04e;
  --hover: color-mix(in srgb, var(--text) 7%, transparent);
  --press: color-mix(in srgb, var(--text) 12%, transparent);
  --accent-soft: color-mix(in srgb, var(--accent) 16%, transparent);
  --accent-glow: color-mix(in srgb, var(--accent) 24%, transparent);
  --danger-soft: color-mix(in srgb, var(--danger) 14%, transparent);
  --success-soft: color-mix(in srgb, var(--success) 15%, transparent);
  --warning-soft: color-mix(in srgb, var(--warning) 15%, transparent);
  --glass: color-mix(in srgb, var(--surface) 82%, transparent);
  --glass-strong: color-mix(in srgb, var(--surface-raised) 90%, transparent);
  --shadow-1: 0 1px 3px rgba(0, 0, 0, 0.45);
  --shadow-2: 0 2px 6px rgba(0, 0, 0, 0.38), 0 14px 32px -6px rgba(0, 0, 0, 0.62);
  --shadow-3: 0 4px 12px rgba(0, 0, 0, 0.45), 0 30px 72px -12px rgba(0, 0, 0, 0.78);
  --panel-edge: 0 0 0 1px var(--border), inset 0 1px 0 rgba(255, 255, 255, 0.03);
  --card-edge: 0 0 0 1px var(--border), inset 0 1px 0 rgba(255, 255, 255, 0.025);
  --scrim: rgba(0, 0, 0, 0.65);
  --tile-bg: 36% 22%;
  --tile-fg: 82% 82%;
  --band-from: 44% 25%;
  --band-to: 34% 18%;
}

:root, :root[data-accent="iris"] { --accent: #5a48e0; --accent-hover: #4a39c8; --accent-text: #5240d6; --accent-2: #ec5fa8; }
:root[data-accent="ember"] { --accent: #b84a0e; --accent-hover: #9c3d09; --accent-text: #a8430c; --accent-2: #f2b84e; }
:root[data-accent="rose"] { --accent: #c22a6a; --accent-hover: #a51f58; --accent-text: #b8265f; --accent-2: #ff9a62; }
:root[data-accent="ocean"] { --accent: #0b6bcb; --accent-hover: #0a5aab; --accent-text: #0a63bd; --accent-2: #38d0c0; }
:root[data-accent="jade"] { --accent: #0f7a5a; --accent-hover: #0c6549; --accent-text: #0e7354; --accent-2: #8ad14f; }
:root[data-accent="graphite"] { --accent: #262833; --accent-hover: #000000; --accent-text: #262833; --accent-2: #9499a8; }
:root[data-theme="dark"], :root[data-theme="dark"][data-accent="iris"] { --accent: #a99fff; --accent-hover: #bdb5ff; --accent-text: #b4abff; --on-accent: #17132e; }
:root[data-theme="dark"][data-accent="ember"] { --accent: #ffab70; --accent-hover: #ffbd8f; --accent-text: #ffb27d; --on-accent: #2b1405; }
:root[data-theme="dark"][data-accent="rose"] { --accent: #ff9cc4; --accent-hover: #ffb5d4; --accent-text: #ffa6ca; --on-accent: #2e0e1c; }
:root[data-theme="dark"][data-accent="ocean"] { --accent: #7cc0ff; --accent-hover: #9ccfff; --accent-text: #87c5ff; --on-accent: #06192c; }
:root[data-theme="dark"][data-accent="jade"] { --accent: #6fe0b8; --accent-hover: #8fe9c9; --accent-text: #79e3bd; --on-accent: #05211a; }
:root[data-theme="dark"][data-accent="graphite"] { --accent: #e7e9f0; --accent-hover: #ffffff; --accent-text: #e7e9f0; --on-accent: #16171d; }

*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
html { background: var(--canvas); height: 100%; }
body { margin: 0; max-width: none; padding: 0; min-height: 100%; color: var(--text); font-size: var(--text-md); background: var(--canvas); }
h1, h2, h3, h4 { line-height: 1.25; margin: 0; letter-spacing: -0.015em; }
p, ul, li { margin: 0; padding: 0; }
ul { list-style: none; }
a { color: var(--accent-text); text-decoration: none; }
a:hover { text-decoration: underline; text-underline-offset: 0.2em; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.ui-icon { width: 1.125em; height: 1.125em; flex: none; stroke-width: 1.85; }
.logo-mark { flex: none; display: block; filter: drop-shadow(0 2px 4px rgba(90, 72, 224, 0.22)); }
kbd { display: inline-block; padding: 0 0.42em; min-width: 1.5em; border: 1px solid var(--border-strong); border-radius: 0.35rem; background: var(--surface); color: var(--muted); box-shadow: inset 0 -1px 0 var(--border); font: 560 0.6875rem/1.55 ui-monospace, "SF Mono", Consolas, monospace; text-align: center; }

button, input, select, textarea {
  min-height: var(--control);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 0.35rem var(--space-3);
  font: inherit;
  font-size: var(--text-sm);
  color: inherit;
  background-color: var(--surface);
}
button { cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; font-weight: 560; white-space: nowrap; user-select: none; width: auto; }
input, select, textarea { width: 100%; min-width: 0; box-shadow: inset 0 1px 2px rgba(18, 21, 38, 0.02); }
input::placeholder, textarea::placeholder { color: var(--muted); opacity: 0.75; }
input:hover, select:not(:disabled):hover, textarea:hover { border-color: var(--border-strong); }
input:focus, select:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); outline: none; }
textarea { resize: vertical; line-height: 1.5; min-height: 4.25rem; }
input[type="checkbox"] {
  appearance: none; -webkit-appearance: none;
  position: relative; flex: none; width: 1.05rem; height: 1.05rem; min-height: 0; padding: 0; margin: 0;
  border: 1.5px solid var(--border-strong); border-radius: 0.325rem; background: var(--surface); cursor: pointer;
}
input[type="checkbox"]:checked { background: var(--accent); border-color: var(--accent); }
input[type="checkbox"]:checked::after { content: ""; position: absolute; left: 0.28rem; top: 0.08rem; width: 0.3rem; height: 0.56rem; border: solid var(--on-accent); border-width: 0 1.85px 1.85px 0; transform: rotate(42deg); }

.primary {
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 92%, #ffffff) 0%, var(--accent) 100%);
  color: var(--on-accent);
  border-color: color-mix(in srgb, var(--accent) 85%, #000000);
  font-weight: 600;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 2px 6px -1px color-mix(in srgb, var(--accent) 42%, transparent);
}
.primary:not(:disabled):hover { background: var(--accent-hover); }
.secondary { background: var(--surface); color: var(--text); border-color: var(--border-strong); box-shadow: var(--shadow-1); }
.secondary:not(:disabled):hover { background-color: var(--surface-sunken); border-color: var(--muted); }
.ghost { background: transparent; color: var(--muted); border-color: transparent; }
.ghost:not(:disabled):hover { color: var(--text); background: var(--hover); }
.danger { background: transparent; color: var(--danger); border-color: color-mix(in srgb, var(--danger) 36%, transparent); }
.danger:not(:disabled):hover { background: var(--danger-soft); border-color: var(--danger); }
.icon-btn { display: inline-grid; place-items: center; width: var(--control); height: var(--control); min-height: var(--control); padding: 0; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--muted); }
.icon-btn:hover { color: var(--text); background: var(--hover); text-decoration: none; }
.icon-btn.is-on { color: var(--star); }
.icon-btn.danger:hover { color: var(--danger); background: var(--danger-soft); }

/* ── Auth / Login / Offline Card ── */
.auth-page { position: relative; min-height: 100vh; display: grid; place-items: center; padding: var(--space-5); overflow: hidden; }
.auth-page::before {
  content: ""; position: fixed; z-index: 0; top: -12rem; left: 50%; width: 68rem; height: 38rem; transform: translateX(-50%); pointer-events: none; opacity: 0.72;
  background: radial-gradient(closest-side at 35% 50%, color-mix(in srgb, var(--accent) 22%, transparent), transparent),
              radial-gradient(closest-side at 68% 45%, color-mix(in srgb, var(--accent-2) 18%, transparent), transparent);
}
.auth-card {
  position: relative; z-index: 1; width: min(100%, 26.5rem); display: grid; gap: var(--space-4); padding: 2rem 2rem 1.75rem;
  border-radius: var(--radius-xl); background: var(--glass-strong); -webkit-backdrop-filter: saturate(180%) blur(18px); backdrop-filter: saturate(180%) blur(18px);
  box-shadow: var(--panel-edge), var(--shadow-2);
}
.auth-head { display: grid; gap: 0.5rem; text-align: center; justify-items: center; }
.auth-brand { display: inline-flex; align-items: center; gap: 0.6rem; font-size: var(--text-xl); font-weight: 760; letter-spacing: -0.025em; }
.auth-sub { color: var(--muted); font-size: var(--text-sm); line-height: 1.45; }
.auth-form { display: grid; gap: var(--space-3); }
.auth-form label { display: grid; gap: 0.35rem; font-size: var(--text-xs); font-weight: 580; color: var(--muted); }
.auth-form input { min-height: 2.5rem; font-size: var(--text-md); color: var(--text); }
.auth-form button[type="submit"] { width: 100%; min-height: 2.65rem; font-size: var(--text-md); margin-top: 0.25rem; }
.auth-foot { padding-top: var(--space-3); border-top: 1px solid var(--border); color: var(--muted); font-size: var(--text-xs); text-align: center; line-height: 1.5; }

/* ── Notice Banner ── */
#notice {
  display: flex; align-items: center; gap: 0.5rem; min-height: 0; padding: 0.55rem 0.875rem;
  border-radius: var(--radius-md); background: var(--surface-sunken); border: 1px solid var(--border);
  color: var(--text); font-size: var(--text-sm); font-weight: 520;
}
#notice:empty { display: none; }
#notice[data-tone="danger"] { background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 32%, transparent); color: var(--danger); }
#notice[data-tone="warning"] { background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 32%, transparent); color: var(--warning); }

/* ── Workspace Shell ── */
.web-shell { display: grid; grid-template-columns: var(--side-width) minmax(0, 1fr) auto; min-height: 100vh; height: 100vh; overflow: hidden; background: var(--canvas); }
.web-side { display: flex; flex-direction: column; min-height: 0; background: var(--sidebar); padding-bottom: var(--space-2); }
.side-brand-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: 0.95rem var(--space-3) 0.65rem; }
.side-brand { display: inline-flex; align-items: center; gap: 0.55rem; font-weight: 740; font-size: 0.975rem; letter-spacing: -0.02em; color: var(--text); }
.side-badge { padding: 0.1rem 0.45rem; border-radius: var(--radius-full); background: var(--accent-soft); color: var(--accent-text); font-size: var(--text-2xs); font-weight: 640; }
.side-cta { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.4rem; padding: 0 var(--space-3) var(--space-2); }
.side-cta .primary { width: 100%; min-height: 2.35rem; }
.side-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: var(--space-1) var(--space-2) var(--space-3); display: grid; gap: var(--space-3); align-content: start; }
.side-group { display: grid; gap: 2px; align-content: start; }
.side-section-head { display: flex; align-items: center; justify-content: space-between; min-height: 1.65rem; padding: 0 0.5rem; color: var(--muted); font-size: var(--text-2xs); font-weight: 660; text-transform: uppercase; letter-spacing: 0.04em; }
.side-section-head .icon-btn { width: 1.5rem; height: 1.5rem; min-height: 0; }
.nav-btn {
  display: flex; align-items: center; justify-content: flex-start; gap: 0.5rem; width: 100%; min-width: 0; min-height: 2.0625rem;
  padding: 0.2rem 0.5rem 0.2rem 0.625rem; border: 1px solid transparent; border-radius: var(--radius-sm);
  background: transparent; color: var(--text); text-align: left; font-size: var(--text-sm); font-weight: 500;
}
.nav-btn:hover { background: var(--hover); }
.nav-btn[aria-pressed="true"] { background: var(--surface); color: var(--text); font-weight: 620; box-shadow: var(--panel-edge); }
.nav-btn[aria-pressed="true"] .nav-icon { color: var(--accent-text); }
.nav-btn[aria-pressed="true"] .nav-count { background: var(--accent-soft); color: var(--accent-text); }
.nav-icon { display: inline-grid; place-items: center; color: var(--muted); flex: none; }
.nav-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-count { flex: none; padding: 0.05rem 0.42rem; border-radius: var(--radius-full); background: color-mix(in srgb, var(--text) 6%, transparent); color: var(--muted); font-size: var(--text-2xs); font-weight: 580; font-variant-numeric: tabular-nums; }

.folder-node { display: grid; gap: 1px; }
.folder-children { margin-left: 0.75rem; padding-left: 0.35rem; border-left: 1px solid var(--border-strong); display: grid; gap: 1px; }
.folder-row { position: relative; display: flex; align-items: center; min-width: 0; }
.folder-tools { position: absolute; right: 0.25rem; display: flex; gap: 1px; opacity: 0; pointer-events: none; background: var(--surface); border-radius: 0.35rem; box-shadow: var(--shadow-1); }
.folder-row:hover .folder-tools, .folder-row:focus-within .folder-tools { opacity: 1; pointer-events: auto; }
.folder-row:hover .nav-count { opacity: 0; }
.folder-tool { width: 1.4rem; height: 1.4rem; min-height: 0; padding: 0; border: 0; border-radius: 0.3rem; background: transparent; color: var(--muted); }
.folder-tool:hover { background: var(--hover); color: var(--text); }
.folder-tool.danger:hover { background: var(--danger-soft); color: var(--danger); }
.folder-inline-form { display: flex; gap: 0.25rem; padding: 0.2rem 0.35rem; align-items: center; }
.folder-inline-form input { min-height: 1.75rem; padding: 0.15rem 0.45rem; font-size: var(--text-xs); }
.folder-inline-form button { min-height: 1.75rem; padding: 0 0.5rem; font-size: var(--text-xs); }

.tag-cloud { display: flex; flex-wrap: wrap; gap: 0.3rem; padding: 0.15rem 0.4rem; }
.tag-pill {
  display: inline-flex; align-items: center; gap: 0.3rem; min-height: 1.5625rem; padding: 0 0.55rem;
  border: 1px solid var(--border); border-radius: var(--radius-full); background: color-mix(in srgb, var(--surface) 65%, transparent);
  color: var(--text); font-size: var(--text-xs); font-weight: 520; max-width: 100%;
}
.tag-pill:hover { background: var(--surface); border-color: var(--border-strong); }
.tag-pill[aria-pressed="true"] { background: var(--accent); border-color: transparent; color: var(--on-accent); }
.tag-pill-count { font-size: var(--text-2xs); opacity: 0.75; font-variant-numeric: tabular-nums; }

.side-foot {
  display: grid; gap: 0.45rem; padding: var(--space-2) var(--space-3) var(--space-1);
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}
.account-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-width: 0; }
.account-pill { display: inline-flex; align-items: center; gap: 0.45rem; min-width: 0; font-size: var(--text-xs); font-weight: 600; color: var(--text); }
.account-avatar { display: inline-grid; place-items: center; width: 1.55rem; height: 1.55rem; border-radius: var(--radius-full); background: var(--accent-soft); color: var(--accent-text); font-size: var(--text-xs); font-weight: 700; flex: none; }
.account-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.side-foot-actions { display: flex; align-items: center; gap: 2px; }
.side-foot-actions .icon-btn { width: 1.8rem; height: 1.8rem; min-height: 0; }
.theme-popover { display: flex; align-items: center; justify-content: space-between; gap: 0.35rem; padding: 0.35rem 0.5rem; border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--card-edge); }
.swatch-row { display: flex; gap: 0.35rem; align-items: center; }
.swatch-btn { width: 1.15rem; height: 1.15rem; min-height: 0; padding: 0; border-radius: var(--radius-full); border: 2px solid transparent; }
.swatch-btn[aria-pressed="true"] { box-shadow: 0 0 0 1.5px var(--surface), 0 0 0 3px var(--accent); }
.swatch-btn[data-accent-choice="iris"] { background: #5a48e0; }
.swatch-btn[data-accent-choice="ember"] { background: #b84a0e; }
.swatch-btn[data-accent-choice="rose"] { background: #c22a6a; }
.swatch-btn[data-accent-choice="ocean"] { background: #0b6bcb; }
.swatch-btn[data-accent-choice="jade"] { background: #0f7a5a; }
.swatch-btn[data-accent-choice="graphite"] { background: #262833; }

/* ── Main Content Surface ── */
.web-main {
  position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0;
  margin: var(--panel-gap) var(--panel-gap) var(--panel-gap) 0; overflow-y: auto;
  border-radius: var(--radius-xl); background: var(--surface); box-shadow: var(--panel-edge);
}
.web-top {
  position: sticky; top: 0; z-index: 10; display: grid; gap: var(--space-3);
  padding: 1.125rem var(--space-5) var(--space-3);
  background: var(--glass); -webkit-backdrop-filter: saturate(180%) blur(16px); backdrop-filter: saturate(180%) blur(16px);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}
.top-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.title-group { display: flex; align-items: center; gap: 0.6rem; min-width: 0; }
.title-group h1 { font-size: var(--text-xl); font-weight: 720; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.count-pill { padding: 0.125rem 0.55rem; border-radius: var(--radius-full); background: var(--surface-sunken); color: var(--muted); font-size: var(--text-xs); font-weight: 580; font-variant-numeric: tabular-nums; }
.top-tools { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.view-switcher { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--border); background: var(--surface-sunken); border-radius: var(--radius-md); }
.view-switcher button { width: 1.85rem; min-height: 1.65rem; padding: 0; border: 0; border-radius: 0.375rem; background: transparent; color: var(--muted); }
.view-switcher button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: var(--shadow-1); }

.search-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2); align-items: center; }
#search { display: flex; align-items: center; gap: var(--space-2); position: relative; }
.search-box { position: relative; flex: 1; display: flex; align-items: center; min-width: 0; }
.search-box .search-glyph { position: absolute; left: 0.8rem; color: var(--muted); pointer-events: none; display: inline-grid; }
.search-box input[name="query"] {
  min-height: 2.5rem; padding-left: 2.3rem; padding-right: 4.5rem;
  border-color: var(--border); border-radius: var(--radius-md); background: var(--surface-sunken); font-size: var(--text-md);
}
.search-box input[name="query"]:focus { background: var(--surface); border-color: var(--accent); }
.search-submit { position: absolute; right: 0.3rem; min-height: 1.9rem; padding: 0 0.65rem; border-radius: var(--radius-sm); font-size: var(--text-xs); }
.filter-controls { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.check-chip {
  display: inline-flex; align-items: center; gap: 0.4rem; min-height: 2.5rem; padding: 0 0.75rem;
  border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-sunken);
  font-size: var(--text-xs); font-weight: 560; cursor: pointer; user-select: none; color: var(--muted);
}
.check-chip:hover { color: var(--text); border-color: var(--border-strong); }
.sort-select { width: auto; min-height: 2.5rem; background: var(--surface-sunken); color: var(--muted); font-size: var(--text-xs); font-weight: 560; }

/* ── Tool Drawers (Add / Import / Export) ── */
.drawer-panel {
  padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--surface-sunken) 45%, var(--surface)); box-shadow: var(--shadow-1);
  display: grid; gap: var(--space-3);
}
.drawer-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.drawer-head h2 { font-size: var(--text-md); font-weight: 680; display: inline-flex; align-items: center; gap: 0.45rem; }
.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.field-grid label, .drawer-panel label { display: grid; gap: 0.3rem; font-size: var(--text-xs); font-weight: 580; color: var(--muted); }
.field-grid label.span-2 { grid-column: 1 / -1; }
.field-grid label.check-inline, .drawer-panel label.check-inline { display: inline-flex; flex-direction: row; align-items: center; gap: 0.45rem; color: var(--text); font-size: var(--text-sm); cursor: pointer; }
.drawer-foot { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); flex-wrap: wrap; }
#export-output { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: var(--text-xs); min-height: 7.5rem; background: var(--surface); }

/* ── Scope Banner & List Header ── */
.web-body { flex: 1; padding: var(--space-3) var(--space-4) 5.5rem; display: grid; gap: var(--space-3); align-content: start; }
.scope-banner {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap;
  padding: 0.85rem var(--space-4); border: 1px solid var(--accent-line); border-radius: var(--radius-lg);
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, var(--surface)), color-mix(in srgb, var(--accent-2) 5%, var(--surface)));
}
.scope-banner-text { display: grid; gap: 2px; }
.scope-banner-text strong { font-size: var(--text-sm); font-weight: 650; }
.scope-banner-text p { font-size: var(--text-xs); color: var(--muted); }
.list-subbar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: 0 0.5rem; color: var(--muted); font-size: var(--text-xs); }
.check-line { display: inline-flex; align-items: center; gap: 0.45rem; cursor: pointer; user-select: none; }

/* ── Bookmarks List / Compact / Grid ── */
#bookmarks { display: grid; gap: 0.35rem; }
#bookmarks[data-view="grid"] { grid-template-columns: repeat(auto-fill, minmax(16.5rem, 1fr)); gap: 0.875rem; }
.bm-item {
  position: relative; display: grid; gap: 0.5rem; padding: 0.65rem 0.85rem;
  border: 1px solid transparent; border-radius: var(--radius-lg); background: var(--surface);
  transition: background-color var(--motion-fast), border-color var(--motion-fast), box-shadow var(--motion-fast);
}
.bm-item:hover { background: var(--hover); border-color: color-mix(in srgb, var(--border) 85%, transparent); }
.bm-item.is-selected { background: var(--accent-soft); border-color: var(--accent-line); }
.bm-item.is-editing { background: var(--surface-sunken); border-color: var(--accent); box-shadow: var(--shadow-1); }

.bm-row { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto auto; gap: 0.75rem; align-items: center; min-width: 0; }
.bm-check { display: inline-flex; align-items: center; opacity: 0.35; }
.bm-item:hover .bm-check, .bm-item.is-selected .bm-check { opacity: 1; }
.bm-tile {
  display: inline-grid; place-items: center; width: 2.25rem; height: 2.25rem; border-radius: 0.625rem;
  background: hsl(var(--tile-hue, 220) var(--tile-bg)); color: hsl(var(--tile-hue, 220) var(--tile-fg));
  font-weight: 700; font-size: var(--text-md); flex: none; box-shadow: var(--card-edge);
}
.bm-main { display: grid; gap: 2px; min-width: 0; }
.bm-title-line { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
.bm-title-line h3 { font-size: var(--text-md); font-weight: 580; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bm-title-link { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 580; font-size: var(--text-md); }
.bm-title-link:hover { color: var(--accent-text); text-decoration: none; }
.bm-star-badge { color: var(--star); font-size: 0.85rem; flex: none; }
.bm-meta { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; color: var(--muted); font-size: var(--text-xs); min-width: 0; }
.bm-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 26rem; color: var(--muted); }
.bm-folder-pill { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.05rem 0.45rem; border-radius: var(--radius-sm); background: var(--surface-sunken); color: var(--accent-text); font-weight: 550; }
.bm-notes { color: var(--muted); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.9; }
.bm-tags { display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; }
.bm-tag { padding: 0.05rem 0.5rem; border: 1px solid color-mix(in srgb, var(--border) 80%, transparent); border-radius: var(--radius-full); background: var(--surface-sunken); color: var(--muted); font-size: var(--text-2xs); font-weight: 540; cursor: pointer; }
.bm-tag:hover { border-color: var(--accent-line); color: var(--accent-text); }
.bm-actions { display: flex; align-items: center; gap: 2px; }
.bm-actions .icon-btn { width: 1.75rem; height: 1.75rem; min-height: 0; }

#bookmarks[data-view="compact"] .bm-item { padding: 0.3rem 0.65rem; border-radius: var(--radius-sm); }
#bookmarks[data-view="compact"] .bm-tile { width: 1.4rem; height: 1.4rem; font-size: var(--text-2xs); border-radius: 0.35rem; }
#bookmarks[data-view="compact"] .bm-notes { display: none; }

#bookmarks[data-view="grid"] .bm-item {
  display: flex; flex-direction: column; justify-content: space-between; padding: var(--space-3);
  border: 1px solid var(--border); box-shadow: var(--shadow-1); min-height: 9.5rem;
}
#bookmarks[data-view="grid"] .bm-row { display: flex; flex-direction: column; align-items: stretch; gap: 0.5rem; }

.bm-edit-drawer {
  margin-top: 0.35rem; padding-top: var(--space-3); border-top: 1px solid var(--border);
  display: grid; gap: var(--space-3);
}

/* ── Conflict & Import Decision Cards ── */
#conflicts, #import-choice {
  display: grid; gap: var(--space-3); padding: var(--space-4);
  border: 1px solid color-mix(in srgb, var(--warning) 40%, var(--border)); border-radius: var(--radius-xl);
  background: color-mix(in srgb, var(--warning) 6%, var(--surface)); box-shadow: var(--shadow-1);
}
.conflict-card {
  display: grid; gap: var(--space-3); padding: var(--space-4);
  border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
}
.conflict-compare { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.conflict-box {
  display: grid; gap: 0.35rem; padding: var(--space-3); border: 1px solid var(--border);
  border-radius: var(--radius-md); background: var(--surface-sunken); font-size: var(--text-xs);
}
.conflict-box-head { font-weight: 660; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }

/* ── Batch Floating Dock ── */
.batch-dock {
  position: fixed; z-index: 30; left: calc(50% + var(--side-width) / 2); bottom: 1.25rem; transform: translateX(-50%);
  display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap;
  padding: 0.45rem 0.75rem; border-radius: var(--radius-full);
  background: var(--glass-strong); -webkit-backdrop-filter: saturate(180%) blur(18px); backdrop-filter: saturate(180%) blur(18px);
  box-shadow: 0 0 0 1px var(--border-strong), var(--shadow-3);
}

/* ── Empty State ── */
.empty-box {
  display: grid; justify-items: center; gap: 0.5rem; padding: 3.5rem var(--space-4);
  text-align: center; color: var(--muted);
}
.empty-badge {
  display: inline-grid; place-items: center; width: 3rem; height: 3rem; border-radius: 0.9rem;
  background: var(--accent-soft); color: var(--accent-text); margin-bottom: 0.25rem;
}
.empty-box h2 { font-size: var(--text-lg); color: var(--text); }
.empty-box p { font-size: var(--text-sm); max-width: 24rem; }
.side-empty { padding: 0.25rem 0.6rem; font-size: var(--text-xs); color: var(--muted); }

/* ── Panels: hints, file picker, export & import choices ── */
.form-alert {
  display: flex; align-items: flex-start; gap: 0.45rem; padding: 0.55rem 0.75rem; border-radius: var(--radius-md);
  font-size: var(--text-sm); background: var(--danger-soft); color: var(--danger);
}
.form-alert[data-tone="warning"] { background: var(--warning-soft); color: var(--warning); }
.form-alert svg { width: 1rem; height: 1rem; flex: none; margin-top: 0.1rem; }
.form-hint { font-size: var(--text-xs); color: var(--muted); margin-right: auto; }
.file-drop {
  display: grid; place-items: center; min-height: 4.5rem; padding: var(--space-3); cursor: pointer;
  border: 1.5px dashed var(--border-strong); border-radius: var(--radius-lg); background: var(--surface-sunken);
  color: var(--muted); font-size: var(--text-sm); transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.file-drop:hover, .file-drop:focus-within { border-color: var(--accent); color: var(--accent-text); background: var(--accent-soft); }
.file-drop > span { display: inline-flex; align-items: center; gap: 0.4rem; }
.file-drop svg { width: 1rem; height: 1rem; }
.file-drop input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.inline-select { display: inline-flex !important; align-items: center; gap: 0.5rem; margin-right: auto; font-size: var(--text-xs); color: var(--muted); }
.inline-select select { width: auto; }
.export-grid, .choice-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: var(--space-3); }
.export-card, .choice-card {
  display: grid !important; justify-items: start; align-content: start; gap: 0.3rem; height: auto !important;
  padding: var(--space-3) var(--space-4) !important; text-align: left; white-space: normal; border-radius: var(--radius-lg) !important;
}
.export-card svg { width: 1.1rem; height: 1.1rem; color: var(--accent-text); }
.export-card strong, .choice-card strong { font-size: var(--text-md); color: var(--text); }
.export-card small, .choice-card small { font-size: var(--text-xs); font-weight: 400; color: var(--muted); line-height: 1.45; }

/* ── Conflict details ── */
.conflict-field { display: grid; gap: 0.1rem; }
.conflict-field-name { font-size: var(--text-2xs); color: var(--muted); }
.conflict-field p { font-size: var(--text-sm); color: var(--text); overflow-wrap: anywhere; white-space: pre-wrap; }
.conflict-box button { margin-top: 0.35rem; justify-self: start; }
.conflict-box.is-chosen { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
.conflict-merge summary { cursor: pointer; font-size: var(--text-sm); color: var(--muted); }
.conflict-merge summary:hover { color: var(--text); }
.conflict-merge[open] summary { margin-bottom: var(--space-3); }
.conflict-merge form { display: grid; gap: var(--space-3); }

/* ── Confirm-armed destructive buttons ── */
.is-armed { background: var(--danger) !important; color: var(--surface) !important; border-color: transparent !important; }

/* ── Show more, batch forms ── */
.show-more { justify-self: center; margin: var(--space-4) auto; display: flex; }
.batch-count { font-size: var(--text-sm); font-weight: 650; padding-left: 0.35rem; }
.batch-form { display: inline-flex; align-items: center; gap: 0.3rem; }
.batch-form input { width: 9rem; height: 2rem; padding: 0 0.6rem; }

/* ── Toast ── */
.toast {
  position: fixed; z-index: 40; right: 1.25rem; bottom: 1.25rem; max-width: min(26rem, calc(100vw - 2.5rem));
  display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.6rem 0.6rem 0.85rem;
  border-radius: var(--radius-lg); background: var(--text); color: var(--canvas);
  box-shadow: var(--shadow-3); font-size: var(--text-sm); animation: lm-rise 0.18s ease-out;
}
.toast > svg { width: 1rem; height: 1rem; flex: none; color: color-mix(in srgb, var(--success) 60%, var(--canvas)); }
.toast > span { flex: 1; }
.toast button {
  border: 0; background: transparent; color: inherit; font: inherit; font-weight: 650; cursor: pointer;
  padding: 0.25rem 0.5rem; border-radius: var(--radius-sm);
}
.toast button:hover { background: color-mix(in srgb, var(--canvas) 16%, transparent); }
.toast [data-action="undo"] { color: color-mix(in srgb, var(--accent) 55%, var(--canvas)); }
.toast-close { display: inline-grid; place-items: center; opacity: 0.7; }
.toast-close svg { width: 0.9rem; height: 0.9rem; }
.batch-dock ~ .toast { bottom: 5rem; }
.web-shell:has(.batch-dock) .web-body { padding-bottom: 7rem; }
@keyframes lm-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* ── Modal dialog ── */
.modal-backdrop {
  position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 1.5rem;
  background: color-mix(in srgb, #0b0c14 46%, transparent);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); animation: lm-fade 0.14s ease-out;
}
.modal {
  position: relative; width: min(34rem, 100%); max-height: calc(100vh - 3rem); display: flex; flex-direction: column;
  border-radius: var(--radius-xl); background: var(--surface-raised); color: var(--text);
  box-shadow: 0 0 0 1px var(--border), var(--shadow-3); animation: lm-pop 0.16s cubic-bezier(0.2, 0.9, 0.3, 1.1);
}
.modal-wide { width: min(42rem, 100%); }
.modal-head { display: flex; align-items: flex-start; gap: 0.75rem; padding: 1.15rem 1.25rem 0.85rem; }
.modal-head .bm-tile { flex: none; }
.modal-icon {
  flex: none; display: inline-grid; place-items: center; width: 2.25rem; height: 2.25rem; border-radius: 0.7rem;
  background: var(--accent-soft); color: var(--accent-text);
}
.modal-icon svg { width: 1.1rem; height: 1.1rem; }
.modal-title-group { flex: 1; min-width: 0; display: grid; gap: 0.15rem; }
.modal-title-group h2 { font-size: var(--text-lg); font-weight: 680; letter-spacing: -0.01em; }
.modal-sub { font-size: var(--text-xs); color: var(--muted); overflow-wrap: anywhere; }
.modal-close { flex: none; margin: -0.25rem -0.35rem 0 0; }
.modal-body { display: grid; gap: var(--space-3); padding: 0.25rem 1.25rem 1rem; overflow-y: auto; min-height: 0; }
.modal-foot {
  display: flex; align-items: center; justify-content: flex-end; gap: 0.5rem; padding: 0.85rem 1.25rem;
  border-top: 1px solid var(--border); background: color-mix(in srgb, var(--surface-sunken) 45%, transparent);
  border-radius: 0 0 var(--radius-xl) var(--radius-xl);
}
.modal-foot .form-hint { margin-right: auto; }
.modal-foot .modal-delete { margin-right: auto; border-color: transparent; }
.modal-foot .modal-delete svg { width: 0.95rem; height: 0.95rem; }
.web-shell:has(.modal-backdrop) .web-main { overflow: hidden; }
.empty-add { max-width: 40rem; margin: 0 auto var(--space-5); width: 100%; }
@keyframes lm-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes lm-pop { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }

/* ── Account management ── */
.account-create {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 0.6rem;
  padding: 0.85rem; border-radius: var(--radius-lg); background: var(--surface-sunken);
}
.account-create-fields { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 0.6rem; }
.account-create label, .account-reset label { display: grid; gap: 0.3rem; font-size: var(--text-xs); color: var(--muted); font-weight: 600; }
.password-field { display: flex; gap: 0.35rem; align-items: center; }
.password-field input { flex: 1; min-width: 0; font-family: ui-monospace, "SF Mono", Consolas, monospace; }
.password-field .ghost { flex: none; }
.account-list-head { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.35rem; font-size: var(--text-xs); font-weight: 660; color: var(--muted); }
.account-list { list-style: none; margin: 0; padding: 0; display: grid; border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
.account-row + .account-row { border-top: 1px solid var(--border); }
.account-row-main { display: flex; align-items: center; gap: 0.7rem; padding: 0.65rem 0.8rem; }
.account-row-text { flex: 1; min-width: 0; display: grid; gap: 0.1rem; }
.account-row-name { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; font-size: var(--text-md); font-weight: 620; overflow-wrap: anywhere; }
.account-row-meta { font-size: var(--text-xs); color: var(--muted); }
.account-row-actions { display: flex; gap: 0.25rem; flex: none; }
.account-row-actions button { min-height: 2rem; padding: 0 0.65rem; font-size: var(--text-sm); }
.account-row-actions .ghost.danger { border-color: transparent; }
.account-reset { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; padding: 0 0.8rem 0.75rem 3.55rem; }
.account-reset .password-field { flex: 1 1 14rem; }
.account-empty { padding: 1.25rem; text-align: center; font-size: var(--text-sm); color: var(--muted); }
.account-notice {
  display: flex; align-items: flex-start; gap: 0.6rem; padding: 0.75rem 0.85rem; border-radius: var(--radius-lg);
  background: var(--success-soft); color: var(--text); font-size: var(--text-sm);
}
.account-notice > svg { flex: none; width: 1.05rem; height: 1.05rem; margin-top: 0.15rem; color: var(--success); }
.account-notice > p { flex: 1; min-width: 0; }
.account-notice-body { flex: 1; min-width: 0; display: grid; gap: 0.5rem; }
.account-notice-body > button { justify-self: start; min-height: 1.9rem; }
.account-notice .icon-btn { flex: none; width: 1.75rem; height: 1.75rem; min-height: 0; }
.credential-list { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.25rem 0.75rem; margin: 0; }
.credential-list dt { color: var(--muted); font-size: var(--text-xs); align-self: center; }
.credential-list dd { margin: 0; }
.credential-list code {
  font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: var(--text-sm); padding: 0.1rem 0.4rem;
  border-radius: 0.35rem; background: var(--surface); user-select: all; overflow-wrap: anywhere;
}

@media (max-width: 640px) {
  .modal-backdrop { place-items: end center; padding: 0; }
  .modal, .modal-wide { width: 100%; max-height: calc(100vh - 2.5rem); border-radius: var(--radius-xl) var(--radius-xl) 0 0; }
  .modal-foot { border-radius: 0; padding-bottom: max(0.85rem, env(safe-area-inset-bottom)); }
  .modal-foot .form-hint { display: none; }
  .account-create, .account-create-fields { grid-template-columns: minmax(0, 1fr); }
  .account-row-main { flex-wrap: wrap; }
  .account-reset { padding-left: 0.8rem; }
}

/* ── Busy indicator while writing to the server ── */
.web-shell[aria-busy="true"] .web-main::before {
  content: ""; position: absolute; z-index: 5; inset: 0 0 auto; height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent); background-size: 40% 100%;
  background-repeat: no-repeat; animation: lm-busy 1s linear infinite;
}
@keyframes lm-busy { from { background-position: -40% 0; } to { background-position: 140% 0; } }
@media (prefers-reduced-motion: reduce) {
  .toast, .web-shell[aria-busy="true"] .web-main::before, .modal, .modal-backdrop { animation: none; }
}

@media (max-width: 900px) {
  .web-shell { grid-template-columns: minmax(0, 1fr); height: auto; min-height: 100vh; overflow: visible; }
  .web-side {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "brand foot" "scroll scroll";
    align-items: center; padding-bottom: 0;
  }
  .side-brand-row { grid-area: brand; padding: 0.7rem var(--space-3) 0.5rem; justify-content: flex-start; }
  .side-foot { grid-area: foot; display: flex; align-items: center; gap: 0.35rem; padding: 0.5rem var(--space-3) 0.5rem 0; border: 0; margin: 0; }
  .theme-popover { padding: 0.2rem; background: transparent; box-shadow: none; }
  .swatch-row, .account-name { display: none; }
  .side-scroll {
    grid-area: scroll; display: flex; gap: 0.35rem; overflow-x: auto; overflow-y: hidden; padding: 0 var(--space-3) 0.6rem;
    scrollbar-width: none; -webkit-mask-image: linear-gradient(90deg, #000 92%, transparent);
  }
  .side-scroll::-webkit-scrollbar { display: none; }
  .side-group, .folder-node, .folder-children, .folder-row, .tag-cloud { display: contents; }
  .side-section-head, .side-empty, .folder-tools, .tag-pill-count { display: none; }
  .side-scroll .nav-btn, .side-scroll .tag-pill {
    flex: none; width: auto; min-height: 2rem; padding: 0.25rem 0.7rem; border-radius: var(--radius-full);
    border: 1px solid var(--border); background: var(--surface);
  }
  .side-scroll .nav-btn[aria-pressed="true"] { border-color: var(--accent-line); }
  .side-scroll .nav-label { overflow: visible; }
  .folder-inline-form { flex: none; }
  .web-main { margin: 0 var(--panel-gap) var(--panel-gap); }
  .field-grid, .conflict-compare { grid-template-columns: minmax(0, 1fr); }
  .batch-dock {
    left: 0.75rem; right: 0.75rem; bottom: 0.75rem; transform: none; justify-content: center;
    border-radius: var(--radius-xl); padding: 0.55rem;
  }
  .batch-form input { width: 7.5rem; }
  .batch-dock ~ .toast { bottom: 9rem; }
}
`;

// apps/web/src/main.ts
function startWebApp() {
  const host2 = globalThis;
  const document = host2.document;
  const root = document?.querySelector("#root");
  if (!document || !root || !host2.fetch) return;
  if (document.createElement && document.head && !document.getElementById?.("lumamark-web-styles")) {
    const style = document.createElement("style");
    style.id = "lumamark-web-styles";
    style.textContent = WEB_STYLES;
    document.head.append(style);
  }
  const stored = (key) => {
    try {
      return host2.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const theme = stored("lumamark-theme") === "dark" || stored("lumamark-theme") !== "light" && host2.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const accentValue = stored("lumamark-accent");
  const accent = accentValue && ACCENT_CHOICES.includes(accentValue) ? accentValue : "iris";
  const viewValue = stored("lumamark-web-view");
  const view = viewValue === "compact" || viewValue === "grid" ? viewValue : "list";
  applyAppearanceToDocument({ theme, accent });
  bindWebApp(root, createWebApp({
    fetchImpl: host2.fetch.bind(host2),
    appearance: { theme, accent },
    preferences: { view, sort: stored("lumamark-web-sort") ?? void 0 }
  }));
}
export {
  startWebApp
};
