import { applyBookmarkUpdate, domainFromUrl, normalizeBookmarkUrl, type Bookmark, type ConflictField } from '../../../packages/domain/src/index';
import type { DuplicateImportAction, ImportResult } from '../../../packages/import-export/src/index';
import { AccountClient, WebRequestError, type FetchLike } from './client';
import {
  addBookmark,
  applyImport,
  countDuplicateImports,
  deleteBookmark,
  emptyTrash,
  escapeHtml,
  exportHtml,
  exportJson,
  folderFor,
  folderName,
  libraryFromManifest,
  librarySignature,
  manifestFromLibrary,
  mergeTitleChoices,
  parseImport,
  restoreBookmark,
  titleConflicts,
  updateBookmark,
  visibleBookmarks,
  type BookmarkFilter,
  type BookmarkInput,
  type BookmarkPatch,
  type ConflictChoice,
  type ConflictKeep,
  type LibraryModel,
  type TitleConflict,
} from './library';

export type { BookmarkInput, BookmarkPatch, TitleConflict };
export { WebRequestError };

export interface WebSnapshot {
  mode: 'login' | 'offline' | 'library' | 'import-choice' | 'conflict';
  message: string;
  username?: string;
  importPending: boolean;
  conflicts: TitleConflict[];
}

export interface WebApp {
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  search(query: string): void;
  setFavoritesOnly(value: boolean): void;
  showTrash(value: boolean): void;
  addBookmark(input: BookmarkInput): Promise<void>;
  updateBookmark(id: string, patch: BookmarkPatch): Promise<void>;
  deleteBookmark(id: string): Promise<void>;
  restoreBookmark(id: string): Promise<void>;
  emptyTrash(): Promise<void>;
  beginImport(text: string, format: 'html' | 'json'): Promise<'applied' | 'awaiting-choice' | 'rejected'>;
  chooseImport(action: DuplicateImportAction): Promise<void>;
  cancelImport(): void;
  exportJson(): string;
  exportHtml(): string;
  chooseConflict(bookmarkId: string, keep: ConflictKeep, patch?: BookmarkPatch & { deleted?: boolean }): Promise<void>;
  visibleBookmarks(): Bookmark[];
  render(): string;
  snapshot(): WebSnapshot;
  sessionToken(): string | undefined;
}

export interface PageTarget {
  id?: string;
  value?: string;
  checked?: boolean;
  getAttribute?(name: string): string | null;
  elements?: Record<string, { value?: string; checked?: boolean } | undefined>;
}

export interface PageEvent {
  preventDefault(): void;
  target: PageTarget | null;
}

export interface PageRoot {
  innerHTML: string;
  addEventListener(type: 'submit' | 'click' | 'change', listener: (event: PageEvent) => void): void;
}

export interface WebAppOptions {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  now?: () => string;
}

interface PendingConflict {
  attempted: LibraryModel;
  remote: LibraryModel;
  etag: string;
  choices: Map<string, ConflictChoice>;
  conflicts: TitleConflict[];
}

const OFFLINE = '连不上服务，没有显示书签库。';
const EMPTY = '这个账号还没有书签。';
const UNSAVED = '没有保存成。账号保持原样。';

export function createWebApp(options: WebAppOptions = {}): WebApp {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  return new WebController(new AccountClient(fetchImpl, options.baseUrl), options.now ?? (() => new Date().toISOString()));
}

export function bindWebApp(root: PageRoot, app: WebApp): void {
  const paint = () => {
    root.innerHTML = app.render();
  };
  const finish = (result: Promise<unknown>) => {
    void result.then(paint, paint);
  };
  root.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    if (!form?.elements) return;
    const value = (name: string) => form.elements?.[name]?.value ?? '';
    const checked = (name: string) => Boolean(form.elements?.[name]?.checked);
    if (form.id === 'login') {
      finish(app.login(value('username'), value('password')));
      return;
    }
    if (form.id === 'search') {
      app.search(value('query'));
      paint();
      return;
    }
    if (form.id === 'add') {
      finish(app.addBookmark({
        title: value('title'),
        url: value('url'),
        folder: value('folder'),
        tags: splitTags(value('tags')),
        notes: value('notes'),
        favorite: checked('favorite'),
      }));
      return;
    }
    if (form.id === 'import') {
      finish(app.beginImport(value('content'), value('format') === 'html' ? 'html' : 'json'));
      return;
    }
    if (form.getAttribute?.('data-action') === 'update') {
      finish(app.updateBookmark(form.getAttribute('data-bookmark-id') ?? '', {
        title: value('title'),
        url: value('url'),
        folder: value('folder'),
        tags: splitTags(value('tags')),
        notes: value('notes'),
        favorite: checked('favorite'),
      }));
      return;
    }
    if (form.getAttribute?.('data-action') === 'merge-conflict') {
      const deleted = form.elements?.deleted;
      finish(app.chooseConflict(form.getAttribute('data-bookmark-id') ?? '', 'merged', {
        title: value('title'),
        url: value('url'),
        folder: value('folder'),
        tags: splitTags(value('tags')),
        notes: value('notes'),
        favorite: checked('favorite'),
        ...(deleted ? { deleted: Boolean(deleted.checked) } : {}),
      }));
    }
  });
  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!target?.getAttribute || target.getAttribute('type') === 'submit') return;
    const importAction = target.getAttribute('data-import-action');
    if (importAction === 'skip' || importAction === 'update' || importAction === 'copy') {
      finish(app.chooseImport(importAction));
      return;
    }
    const keep = target.getAttribute('data-keep');
    if (keep === 'local' || keep === 'remote') {
      finish(app.chooseConflict(target.getAttribute('data-bookmark-id') ?? '', keep));
      return;
    }
    const action = target.getAttribute('data-action');
    const id = target.getAttribute('data-bookmark-id') ?? '';
    if (action === 'delete') finish(app.deleteBookmark(id));
    else if (action === 'restore') finish(app.restoreBookmark(id));
    else if (action === 'empty-trash') finish(app.emptyTrash());
    else if (action === 'logout') finish(app.logout());
    else if (action === 'cancel-import') {
      app.cancelImport();
      paint();
    } else if (action === 'export-json') {
      app.exportJson();
      paint();
    } else if (action === 'export-html') {
      app.exportHtml();
      paint();
    } else if (action === 'show-trash') {
      app.showTrash(true);
      paint();
    } else if (action === 'show-library') {
      app.showTrash(false);
      paint();
    }
  });
  root.addEventListener('change', (event) => {
    const target = event.target;
    if (target?.id !== 'favorites-only') return;
    app.setFavoritesOnly(Boolean(target.checked));
    paint();
  });
  paint();
}

function splitTags(value: string): string[] {
  return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
}

class WebController implements WebApp {
  private library: LibraryModel | undefined;
  private etag: string | undefined;
  private username: string | undefined;
  private mode: WebSnapshot['mode'] = 'login';
  private message = '';
  private query = '';
  private favoritesOnly = false;
  private trash = false;
  private importDraft: ImportResult | undefined;
  private pending: PendingConflict | undefined;
  private lastExport = '';

  constructor(
    private readonly client: AccountClient,
    private readonly now: () => string,
  ) {}

  async login(username: string, password: string): Promise<void> {
    try {
      const session = await this.client.login(username, password);
      this.username = session.username;
    } catch (error) {
      if (error instanceof WebRequestError && error.status === 401) {
        if (this.library) this.message = '登录信息不正确，没有切换账号。';
        else {
          this.mode = 'login';
          this.message = '登录信息不正确，没有进入账号。';
        }
      } else if (this.library) this.message = '连不上服务，没有切换账号。';
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

  async logout(): Promise<void> {
    try {
      await this.client.logout();
    } catch (error) {
      this.message = '没有退出。仍显示当前账号。';
      throw error;
    }
    this.clearSession();
  }

  async refresh(): Promise<void> {
    try {
      await this.reload();
    } catch (error) {
      this.failRead();
      throw error;
    }
  }

  search(query: string): void {
    this.query = query;
    this.refreshMessage();
  }

  setFavoritesOnly(value: boolean): void {
    this.favoritesOnly = value;
    this.refreshMessage();
  }

  showTrash(value: boolean): void {
    this.trash = value;
    this.refreshMessage();
  }

  async addBookmark(input: BookmarkInput): Promise<void> {
    await this.persist(addBookmark(this.requireLibrary(), input, this.now()));
  }

  async updateBookmark(id: string, patch: BookmarkPatch): Promise<void> {
    await this.persist(updateBookmark(this.requireLibrary(), id, patch, this.now()));
  }

  async deleteBookmark(id: string): Promise<void> {
    await this.persist(deleteBookmark(this.requireLibrary(), id, this.now()));
  }

  async restoreBookmark(id: string): Promise<void> {
    await this.persist(restoreBookmark(this.requireLibrary(), id, this.now()));
  }

  async emptyTrash(): Promise<void> {
    await this.persist(emptyTrash(this.requireLibrary()));
  }

  async beginImport(text: string, format: 'html' | 'json'): Promise<'applied' | 'awaiting-choice' | 'rejected'> {
    const library = this.requireLibrary();
    const parsed = parseImport(text, format);
    if (!parsed.bookmarks.length && !parsed.purgedIds.length) {
      this.message = '没有导入书签，账号保持不变。';
      return 'rejected';
    }
    if (countDuplicateImports(library, parsed) > 0) {
      this.importDraft = parsed;
      this.mode = 'import-choice';
      this.message = '尚未选择重复项处理方式，账号保持不变。';
      return 'awaiting-choice';
    }
    await this.persist(applyImport(library, parsed, 'skip', this.now()));
    return 'applied';
  }

  async chooseImport(action: DuplicateImportAction): Promise<void> {
    if (action !== 'skip' && action !== 'update' && action !== 'copy') throw new Error('未知的重复项处理方式');
    if (!this.library || !this.importDraft) throw new Error('还没有需要选择的重复项');
    await this.persist(applyImport(this.library, this.importDraft, action, this.now()));
  }

  cancelImport(): void {
    this.importDraft = undefined;
    if (!this.library) return;
    this.mode = 'library';
    this.refreshMessage();
  }

  exportJson(): string {
    this.lastExport = exportJson(this.requireLibrary(), this.now());
    return this.lastExport;
  }

  exportHtml(): string {
    this.lastExport = exportHtml(this.requireLibrary());
    return this.lastExport;
  }

  async chooseConflict(bookmarkId: string, keep: ConflictKeep, patch?: BookmarkPatch & { deleted?: boolean }): Promise<void> {
    if (!this.pending) throw new Error('没有需要选择的版本');
    const conflict = this.pending.conflicts.find((item) => item.bookmarkId === bookmarkId);
    if (!conflict) throw new Error('没有这条书签的冲突');
    if (keep === 'merged' && !patch) throw new Error('合并需要给出要保留的内容');
    const choice: ConflictChoice = keep === 'merged'
      ? { keep, bookmark: this.bookmarkForMerge(conflict.local, patch ?? {}) }
      : { keep };
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

  visibleBookmarks(): Bookmark[] {
    if (!this.library) return [];
    return visibleBookmarks(this.library, this.filter());
  }

  snapshot(): WebSnapshot {
    return {
      mode: this.mode,
      message: this.message,
      username: this.username,
      importPending: this.mode === 'import-choice',
      conflicts: this.pending?.conflicts.map((conflict) => ({ ...conflict })) ?? [],
    };
  }

  sessionToken(): string | undefined {
    return this.client.sessionToken();
  }

  render(): string {
    const notice = `<p id="notice" role="status">${escapeHtml(this.message)}</p>`;
    if (this.mode === 'offline') return `<div data-mode="offline">${notice}</div>`;
    if (this.mode === 'login' || !this.library || !this.username) {
      return `<div data-mode="login">${notice}${loginForm()}<p>账号由部署者在服务器上创建，此页面不能注册。</p></div>`;
    }
    const account = `<p data-account="${escapeHtml(this.username)}">当前账号：${escapeHtml(this.username)}</p>`;
    if (this.mode === 'conflict' && this.pending) {
      return `<div data-mode="conflict">${account}${notice}${this.renderConflicts()}${this.renderBookmarkList(true)}</div>`;
    }
    if (this.mode === 'import-choice') {
      return `<div data-mode="import-choice" data-bookmark-count="${this.liveCount()}">${account}${notice}${importChoice()}${this.renderBookmarkList(true)}</div>`;
    }
    return `<div data-mode="library" data-bookmark-count="${this.visibleBookmarks().length}">${account}${notice}${this.renderTools()}${this.renderBookmarkList(false)}</div>`;
  }

  private requireLibrary(): LibraryModel {
    if (!this.library || !this.etag) throw new WebRequestError('没有进入账号', 401);
    return this.library;
  }

  private filter(): BookmarkFilter {
    return { query: this.query, favoritesOnly: this.favoritesOnly, trash: this.trash };
  }

  private async reload(): Promise<void> {
    const snapshot = await this.client.readManifest();
    this.library = libraryFromManifest(snapshot.manifest);
    this.etag = snapshot.etag;
    this.mode = 'library';
    this.pending = undefined;
    this.importDraft = undefined;
    this.query = '';
    this.favoritesOnly = false;
    this.trash = false;
    this.lastExport = '';
    this.refreshMessage();
  }

  private async persist(model: LibraryModel): Promise<void> {
    const current = this.requireLibrary();
    if (librarySignature(model) === librarySignature(current)) {
      this.mode = 'library';
      this.importDraft = undefined;
      this.refreshMessage();
      return;
    }
    try {
      await this.writeModel(model, this.etag ?? '');
    } catch (error) {
      if (error instanceof WebRequestError && error.status === 412) {
        await this.noteConflict(model);
        return;
      }
      this.message = UNSAVED;
      throw error;
    }
  }

  private async writeModel(model: LibraryModel, etag: string): Promise<void> {
    const nextEtag = await this.client.writeManifest(manifestFromLibrary(model, this.now()), etag);
    this.library = model;
    this.etag = nextEtag;
    this.mode = 'library';
    this.pending = undefined;
    this.importDraft = undefined;
    this.refreshMessage();
  }

  private async noteConflict(attempted: LibraryModel): Promise<void> {
    let remote;
    try {
      remote = await this.client.readManifest();
    } catch {
      this.message = '连不上服务，没有写入这次修改。账号保持原样。';
      return;
    }
    const remoteModel = libraryFromManifest(remote.manifest);
    const conflicts = titleConflicts(attempted, remoteModel);
    if (!conflicts.length) {
      try {
        await this.writeModel(mergeTitleChoices(attempted, remoteModel, new Map(), this.now()), remote.etag);
      } catch (error) {
        if (error instanceof WebRequestError && error.status === 412) this.message = UNSAVED;
        throw error;
      }
      return;
    }
    this.mode = 'conflict';
    this.message = '同一条书签两边都改过，选择要保留的版本。选择完成前不会写回账号。';
    this.pending = { attempted, remote: remoteModel, etag: remote.etag, choices: new Map(), conflicts };
  }

  private bookmarkForMerge(base: Bookmark, patch: BookmarkPatch & { deleted?: boolean }): Bookmark {
    const library = this.pending?.attempted;
    let collectionId = patch.folder === undefined ? undefined : null as string | null;
    if (patch.folder !== undefined && library && this.pending) {
      const placed = folderFor(library, patch.folder, this.now());
      this.pending.attempted = placed.model;
      collectionId = placed.collectionId ?? null;
    }
    let bookmark = applyBookmarkUpdate(base, {
      title: patch.title,
      notes: patch.notes,
      tags: patch.tags,
      favorite: patch.favorite,
      collectionId,
    }, this.now());
    if (patch.url !== undefined) {
      const url = normalizeBookmarkUrl(patch.url);
      bookmark = { ...bookmark, url, domain: domainFromUrl(url) };
    }
    if (patch.deleted === true) bookmark = { ...bookmark, deletedAt: this.now() };
    else if (patch.deleted === false) delete bookmark.deletedAt;
    else if (base.deletedAt) bookmark = { ...bookmark, deletedAt: base.deletedAt };
    else delete bookmark.deletedAt;
    return { ...bookmark, id: base.id };
  }

  private showOffline(): void {
    this.mode = 'offline';
    this.library = undefined;
    this.etag = undefined;
    this.pending = undefined;
    this.importDraft = undefined;
    this.message = OFFLINE;
  }

  private failRead(): void {
    this.showOffline();
    this.username = undefined;
  }

  private clearSession(): void {
    this.library = undefined;
    this.etag = undefined;
    this.username = undefined;
    this.pending = undefined;
    this.importDraft = undefined;
    this.query = '';
    this.favoritesOnly = false;
    this.trash = false;
    this.lastExport = '';
    this.mode = 'login';
    this.message = '';
  }

  private refreshMessage(): void {
    if (!this.library || this.mode !== 'library') return;
    const visible = visibleBookmarks(this.library, this.filter());
    if (this.query.trim() || this.favoritesOnly || this.trash) {
      this.message = visible.length ? '' : '没有符合条件的书签。';
      return;
    }
    this.message = this.liveCount() ? '' : EMPTY;
  }

  private liveCount(): number {
    if (!this.library) return 0;
    const gone = new Set(this.library.purged);
    return this.library.bookmarks.filter((bookmark) => !bookmark.deletedAt && !bookmark.purgedAt && !gone.has(bookmark.id)).length;
  }

  private renderTools(): string {
    const query = escapeHtml(this.query);
    const favorites = this.favoritesOnly ? ' checked' : '';
    const exportOutput = this.lastExport ? `<textarea id="export-output" readonly>${escapeHtml(this.lastExport)}</textarea>` : '';
    return `<form id="search"><label>搜索标题 <input name="query" value="${query}"></label><button type="submit">搜索</button></form>` +
      `<label>只看收藏 <input id="favorites-only" type="checkbox"${favorites}></label>` +
      `<button type="button" data-action="show-library">书签库</button>` +
      `<button type="button" data-action="show-trash">回收站</button>` +
      (this.trash ? '<button type="button" data-action="empty-trash">清空回收站</button>' : '') +
      `<form id="add"><h2>新增书签</h2>${bookmarkFields()}</form>` +
      `<form id="import"><h2>导入</h2><label>内容 <textarea name="content"></textarea></label>` +
      `<label>格式 <select name="format"><option value="html">HTML</option><option value="json">LumaMark JSON</option></select></label>` +
      `<button type="submit">导入</button></form>` +
      `<button type="button" data-action="export-json">导出 JSON</button>` +
      `<button type="button" data-action="export-html">导出 HTML</button>${exportOutput}` +
      `<button type="button" data-action="logout">退出</button>`;
  }

  private renderBookmarkList(readonly: boolean): string {
    const items = this.visibleBookmarks().map((bookmark) => this.renderBookmark(bookmark, readonly)).join('');
    return `<ul id="bookmarks">${items}</ul>`;
  }

  private renderBookmark(bookmark: Bookmark, readonly: boolean): string {
    const library = this.library;
    const folder = library ? folderName(library, bookmark.collectionId) : '';
    const fields = `<h3 data-field="title">${escapeHtml(bookmark.title)}</h3>` +
      `<p data-field="url">${escapeHtml(bookmark.url)}</p>` +
      `<p data-field="folder">${escapeHtml(folder)}</p>` +
      `<p data-field="tags">${escapeHtml(bookmark.tags.join(', '))}</p>` +
      `<p data-field="notes">${escapeHtml(bookmark.notes)}</p>` +
      `<p data-field="favorite">${bookmark.favorite ? '已收藏' : '未收藏'}</p>`;
    if (readonly) return `<li data-bookmark-id="${escapeHtml(bookmark.id)}">${fields}</li>`;
    if (bookmark.deletedAt) {
      return `<li data-bookmark-id="${escapeHtml(bookmark.id)}">${fields}` +
        `<button type="button" data-action="restore" data-bookmark-id="${escapeHtml(bookmark.id)}">恢复</button></li>`;
    }
    return `<li data-bookmark-id="${escapeHtml(bookmark.id)}">${fields}` +
      `<form data-action="update" data-bookmark-id="${escapeHtml(bookmark.id)}">${bookmarkFields(bookmark, folder)}<button type="submit">保存修改</button></form>` +
      `<button type="button" data-action="delete" data-bookmark-id="${escapeHtml(bookmark.id)}">删除</button></li>`;
  }

  private renderConflicts(): string {
    const localLibrary = this.pending?.attempted;
    const remoteLibrary = this.pending?.remote;
    const items = (this.pending?.conflicts ?? []).map((conflict) => {
      const localFolder = localLibrary ? folderName(localLibrary, conflict.local.collectionId) : '';
      const remoteFolder = remoteLibrary ? folderName(remoteLibrary, conflict.remote.collectionId) : '';
      const fields = conflict.fields.filter((field) => field !== 'title').map((field) => (
        `<p data-field="${field}" data-side="local">${escapeHtml(conflictValue(conflict.local, field, localFolder))}</p>` +
        `<p data-field="${field}" data-side="remote">${escapeHtml(conflictValue(conflict.remote, field, remoteFolder))}</p>`
      )).join('');
      const deleted = conflict.fields.includes('deletedAt')
        ? `<label>删除 <input name="deleted" type="checkbox"${conflict.local.deletedAt ? ' checked' : ''}></label>`
        : '';
      return `<article data-bookmark-id="${escapeHtml(conflict.bookmarkId)}">` +
        `<h2>选择要保留的版本</h2>` +
        `<p data-title-source="local">${escapeHtml(conflict.localTitle)}</p>` +
        `<p data-title-source="remote">${escapeHtml(conflict.remoteTitle)}</p>` +
        fields +
        `<button type="button" data-keep="local" data-bookmark-id="${escapeHtml(conflict.bookmarkId)}">保留网页版本</button>` +
        `<button type="button" data-keep="remote" data-bookmark-id="${escapeHtml(conflict.bookmarkId)}">保留服务版本</button>` +
        `<form data-action="merge-conflict" data-bookmark-id="${escapeHtml(conflict.bookmarkId)}">${bookmarkFields(conflict.local, localFolder)}${deleted}<button type="submit">合并两边</button></form>` +
        `</article>`;
    }).join('');
    return `<section id="conflicts">${items}</section>`;
  }
}

function conflictValue(bookmark: Bookmark, field: ConflictField, folder: string): string {
  if (field === 'url') return bookmark.url;
  if (field === 'title') return bookmark.title;
  if (field === 'notes') return bookmark.notes;
  if (field === 'tags') return bookmark.tags.join(', ');
  if (field === 'collectionId') return folder || '未分类';
  if (field === 'favorite') return bookmark.favorite ? '已收藏' : '未收藏';
  return bookmark.deletedAt ? '已删除' : '未删除';
}

function loginForm(): string {
  return '<form id="login"><label>用户名 <input name="username" autocomplete="username" required></label>' +
    '<label>密码 <input name="password" type="password" autocomplete="current-password" required></label>' +
    '<button type="submit">登录</button></form>';
}

function importChoice(): string {
  return '<section id="import-choice"><h2>重复网址处理</h2>' +
    '<button type="button" data-import-action="skip">跳过重复</button>' +
    '<button type="button" data-import-action="update">更新已有记录</button>' +
    '<button type="button" data-import-action="copy">另存一份</button>' +
    '<button type="button" data-action="cancel-import">取消</button></section>';
}

function bookmarkFields(bookmark?: Bookmark, folder = ''): string {
  const title = escapeHtml(bookmark?.title ?? '');
  const url = escapeHtml(bookmark?.url ?? '');
  const notes = escapeHtml(bookmark?.notes ?? '');
  const tags = escapeHtml(bookmark?.tags.join(', ') ?? '');
  const favorite = bookmark?.favorite ? ' checked' : '';
  return `<label>标题 <input name="title" value="${title}"></label>` +
    `<label>网址 <input name="url" value="${url}"></label>` +
    `<label>文件夹 <input name="folder" value="${escapeHtml(folder)}"></label>` +
    `<label>标签 <input name="tags" value="${tags}"></label>` +
    `<label>备注 <textarea name="notes">${notes}</textarea></label>` +
    `<label>收藏 <input name="favorite" type="checkbox"${favorite}></label>`;
}
