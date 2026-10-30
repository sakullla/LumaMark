import type { Bookmark, Collection } from '../../../../packages/domain/src/index';
import {
  collectionOptions,
  defaultLibraryFilters,
  folderCounts,
  libraryDocument,
  libraryFailureMessage,
  libraryHasActiveFilters,
  renderBookmarkCard,
  renderEmptyState,
  renderFolderTree,
  renderLibraryResults,
  renderNotice,
  renderScopeNav,
  renderSyncLine,
  renderTagList,
  siteIcon,
  viewClass,
  type LibraryFilters,
} from '../ui/index';
import { bookmarkCountLabel, copyFor, detectUiLanguage, fill, fillCount, relativeTime } from '../ui/copy';
import { uiIcon, watchIconFallback } from '../ui/icons';
import { escapeHtml } from '../ui/html';
import { homeSyncPhrase, isHttpUrl } from '../ui/bar';
import {
  aliveFolderIds,
  deletedBookmarks,
  domainCounts,
  duplicateGroups,
  extraDuplicateIds,
  folderPaths,
  isUnfiled,
  liveBookmarks,
  parseTags,
  planReplace,
  rangeIds,
  RECENT_DAYS,
  sameScope,
  scopedBookmarks,
  scopeKey,
  tagChanges,
  tagCounts,
  undoChanges,
  type BatchChange,
  type LibraryScope,
  type ReplaceField,
} from '../ui/library-model';
import { chooseTextFile } from './files';
import { sendRuntime, type RuntimePort } from './popup';

export interface LibraryRenderState { bookmarks: Bookmark[]; collections: Collection[]; filters: LibraryFilters; folderId: string | null }

export function renderLibrary(state: LibraryRenderState, language = detectUiLanguage()): string {
  const body = renderLibraryResults(state.bookmarks, state.folderId, state.filters, language);
  return `<section id="results" class="${viewClass(state.filters.view)}" aria-live="polite">${body}</section>`;
}

export function initialLibraryState(bookmarks: Bookmark[] = [], collections: Collection[] = []): LibraryRenderState {
  return { bookmarks, collections, filters: defaultLibraryFilters(), folderId: null };
}

function globalRuntime(): RuntimePort {
  const scope = globalThis as { browser?: { runtime?: RuntimePort }; chrome?: { runtime?: RuntimePort } };
  const runtime = scope.browser?.runtime ?? scope.chrome?.runtime;
  if (!runtime?.sendMessage) throw new Error('WebExtension runtime is unavailable');
  return runtime;
}

type PageRoot = ParentNode & EventTarget;

const PAGE_SIZE = 120;
const CONFIRM_DELETE_AT = 100;
const CONFIRM_OPEN_AT = 10;
const UNFILED_TARGET = '__unfiled';
const VIEW_KEY = 'lumamark-library-view';
const COLLAPSED_KEY = 'lumamark-collapsed-folders';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch { return fallback; }
}

function writeJson(key: string, value: unknown): void {
  try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* the choice lasts for this page only */ }
}

const isTyping = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT' || element.isContentEditable));
};

/** Mount the library. Decisions stay in the page; nothing calls prompt, confirm, or alert. */
export function mountLibrary(root: PageRoot = document, port: RuntimePort = globalRuntime()): void {
  const language = detectUiLanguage();
  const text = copyFor(language);
  const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const remembered = readJson<Partial<Pick<LibraryFilters, 'view' | 'sort' | 'direction'>>>(VIEW_KEY, {});

  let bookmarks: Bookmark[] = [];
  let collections: Collection[] = [];
  let filters: LibraryFilters = { ...defaultLibraryFilters(), ...remembered };
  let scope: LibraryScope = { kind: 'all' };
  let searchWithinFolder = false;
  let visible: Bookmark[] = [];
  let shown = 0;
  let paths = new Map<string, string>();
  let groups: Bookmark[][] = [];
  let loaded = false;
  const selection = new Set<string>();
  let anchorId: string | undefined;
  let cursorId: string | undefined;
  let editingId: string | undefined;
  let editorBaseline = '';
  let lastUndo: (() => Promise<unknown>) | undefined;
  const collapsed = new Set(readJson<string[]>(COLLAPSED_KEY, []));

  const get = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector);
  const results = () => get('#results');
  const status = () => get('#library-status');
  const scroller = () => get('.library-main');
  const cardFor = (id: string) => get(`[data-bookmark-id="${CSS.escape(id)}"]`);
  const selected = () => visible.filter((bookmark) => selection.has(bookmark.id));

  // ── Messages and undo ──
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** The status line doubles as a toast; it clears itself after a while. */
  const say = (message: string, keepFor = 3500) => {
    const target = status();
    if (!target) return;
    target.textContent = message;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (target) target.textContent = ''; }, keepFor);
  };

  const runUndo = async () => {
    const restore = lastUndo;
    if (!restore) return;
    lastUndo = undefined;
    const result = await restore() as { ok?: boolean } | undefined;
    say(result?.ok ? text.restored : text.notSaved);
    await load();
  };

  const showUndo = (message: string, restore: () => Promise<unknown>) => {
    const target = status();
    lastUndo = restore;
    if (!target) return;
    say(`${message} `, 10_000);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text.undo;
    button.addEventListener('click', () => {
      button.disabled = true;
      void runUndo();
    });
    target.append(button);
  };

  /** Apply per-item edits as one change the user can take back. */
  const applyBatch = async (items: BatchChange[], undo: BatchChange[], message: string) => {
    if (!items.length) { say(text.nothingChanged); return; }
    if (items.length > PAGE_SIZE) say(text.working, 60_000);
    const response = await sendRuntime(port, 'update', { items });
    if (response?.ok === false) {
      say(response.error === 'invalid-url' ? text.invalidUrl : text.notSaved);
      await load();
      return;
    }
    showUndo(message, () => sendRuntime(port, 'update', { items: undo }));
    await load();
  };

  const withIds = (ids: readonly string[]) => {
    const wanted = new Set(ids);
    return bookmarks.filter((bookmark) => wanted.has(bookmark.id));
  };

  // ── Dialogs ──
  const openDialog = (id: string) => {
    const dialog = get<HTMLDialogElement>(id);
    if (dialog && !dialog.open) dialog.showModal();
    return dialog;
  };

  const ask = (message: string, confirmLabel = text.delete) => new Promise<boolean>((resolve) => {
    const dialog = get<HTMLDialogElement>('#decision');
    const label = get('#decision-text');
    const yes = get<HTMLButtonElement>('#decision-confirm');
    const no = get<HTMLButtonElement>('#decision-cancel');
    if (!dialog || !yes || !no) { resolve(false); return; }
    if (label) label.textContent = message;
    yes.textContent = confirmLabel;
    const finish = (value: boolean) => {
      dialog.close();
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      dialog.removeEventListener('cancel', onNo);
      resolve(value);
    };
    const onYes = () => finish(true);
    const onNo = () => finish(false);
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
    dialog.addEventListener('cancel', onNo);
    dialog.showModal();
    no.focus();
  });

  const askName = (title: string, initial = '') => new Promise<string | undefined>((resolve) => {
    const dialog = get<HTMLDialogElement>('#name-dialog');
    const form = get<HTMLFormElement>('#name-form');
    const input = get<HTMLInputElement>('#name-input');
    const cancel = get<HTMLButtonElement>('#name-cancel');
    const heading = get('#name-heading');
    if (!dialog || !form || !input || !cancel) { resolve(undefined); return; }
    if (heading) heading.textContent = title;
    input.value = initial;
    const finish = (value: string | undefined) => {
      dialog.close();
      form.removeEventListener('submit', onSubmit);
      cancel.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
      resolve(value);
    };
    const onSubmit = (event: Event) => { event.preventDefault(); finish(input.value.trim() || undefined); };
    const onCancel = () => finish(undefined);
    form.addEventListener('submit', onSubmit);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
    input.select();
  });

  // ── Selection ──
  const syncSelection = () => {
    const batch = get('#batch-actions');
    const count = selection.size;
    if (batch) batch.hidden = count === 0;
    const label = get('#batch-count');
    if (label) label.textContent = fillCount(text.selectedCount, count);
    const all = get<HTMLButtonElement>('#batch-all');
    if (all) {
      all.hidden = count >= visible.length;
      all.textContent = fillCount(text.selectAllCount, visible.length);
    }
    const box = get<HTMLInputElement>('#select-all');
    if (box) {
      box.checked = count > 0 && count === visible.length;
      box.indeterminate = count > 0 && count < visible.length;
    }
    const favorite = get<HTMLButtonElement>('#batch-favorite');
    if (favorite) {
      const allFavorite = count > 0 && selected().every((bookmark) => bookmark.favorite);
      const title = allFavorite ? text.unfavoriteSelected : text.favoriteSelected;
      favorite.title = title;
      favorite.setAttribute('aria-label', title);
      favorite.classList.toggle('is-on', allFavorite);
    }
    root.querySelectorAll<HTMLElement>('.bookmark-card').forEach((card) => {
      const isSelected = selection.has(card.dataset.bookmarkId ?? '');
      card.classList.toggle('is-selected', isSelected);
      const input = card.querySelector<HTMLInputElement>('[data-select-bookmark]');
      if (input) input.checked = isSelected;
    });
    get('.library-main')?.classList.toggle('has-selection', count > 0);
  };

  const clearSelection = () => {
    selection.clear();
    anchorId = undefined;
    syncSelection();
  };

  const toggleSelected = (id: string, value = !selection.has(id)) => {
    if (value) selection.add(id);
    else selection.delete(id);
    anchorId = id;
    syncSelection();
  };

  const selectRange = (target: string) => {
    for (const id of rangeIds(visible.map((bookmark) => bookmark.id), anchorId, target)) selection.add(id);
    syncSelection();
  };

  const selectAll = () => {
    for (const bookmark of visible) selection.add(bookmark.id);
    syncSelection();
  };

  // ── Rendering ──
  const rowHtml = (bookmark: Bookmark, now: number) => renderBookmarkCard(bookmark, language, {
    selected: selection.has(bookmark.id),
    path: scopeKey(scope) === `folder:${bookmark.collectionId}` ? undefined : paths.get(bookmark.collectionId ?? ''),
    now,
  });

  const appendRows = () => {
    const target = results();
    if (!target || shown >= visible.length) return;
    const now = Date.now();
    const next = visible.slice(shown, shown + PAGE_SIZE);
    target.insertAdjacentHTML('beforeend', next.map((bookmark) => rowHtml(bookmark, now)).join(''));
    shown += next.length;
    markRows();
  };

  const ensureRendered = (index: number) => {
    while (index >= shown && shown < visible.length) appendRows();
  };

  const markRows = () => {
    root.querySelectorAll<HTMLElement>('.bookmark-card').forEach((card) => {
      card.tabIndex = card.dataset.bookmarkId === (cursorId ?? visible[0]?.id) ? 0 : -1;
      card.classList.toggle('is-editing', card.dataset.bookmarkId === editingId);
    });
  };

  const hasFilters = () => libraryHasActiveFilters({ ...filters, includeDeleted: false });

  const emptyView = () => {
    if (hasFilters()) return renderEmptyState(filters, language);
    if (scope.kind === 'trash') return renderNotice('trash', text.trashEmpty, text.trashHelp);
    if (scope.kind === 'duplicates') return renderNotice('copy', text.duplicatesNone, text.duplicatesNoneHelp);
    if (scope.kind === 'favorites') return renderNotice('star', text.favoritesEmpty, text.favoritesEmptyHelp);
    if (scope.kind === 'recent') return renderNotice('clock', text.recentEmpty, text.recentEmptyHelp);
    if (scope.kind === 'unfiled') return renderNotice('inbox', text.unfiledEmpty, text.unfiledEmptyHelp);
    if (scope.kind === 'tag') return renderNotice('tag', text.noMatches, text.tagEmpty);
    if (scope.kind === 'folder' && liveBookmarks(bookmarks).length) return renderNotice('folder', text.emptyFolder, text.noMatchesHelp);
    return renderEmptyState(defaultLibraryFilters(), language);
  };

  const renderResults = (keepRows = false) => {
    const target = results();
    if (!target) return;
    const keep = keepRows ? Math.max(shown, PAGE_SIZE) : PAGE_SIZE;
    target.className = viewClass(filters.view);
    shown = 0;
    if (!visible.length) {
      target.innerHTML = emptyView();
    } else {
      const now = Date.now();
      const next = visible.slice(0, keep);
      target.innerHTML = next.map((bookmark) => rowHtml(bookmark, now)).join('');
      shown = next.length;
    }
    markRows();
    const head = get('.results-head');
    if (head) head.hidden = !visible.length;
  };

  const renderSidebar = () => {
    const live = liveBookmarks(bookmarks);
    const alive = aliveFolderIds(collections);
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
    const nav = get('#scope-nav');
    if (nav) nav.innerHTML = renderScopeNav(scopeKey(scope), {
      all: live.length,
      favorites: live.filter((bookmark) => bookmark.favorite).length,
      recent: live.filter((bookmark) => bookmark.createdAt >= since).length,
      unfiled: live.filter((bookmark) => isUnfiled(bookmark, alive)).length,
      duplicates: extraDuplicateIds(groups).length,
      trash: deletedBookmarks(bookmarks).length,
    }, language);
    const tree = get('#folder-tree');
    if (tree) tree.innerHTML = renderFolderTree(collections, scope.kind === 'folder' ? scope.id : null, language, folderCounts(bookmarks), collapsed);
    const tags = tagCounts(bookmarks);
    const tagGroup = get('#tags-group');
    if (tagGroup) tagGroup.hidden = !tags.length;
    const tagList = get('#tag-list');
    if (tagList) tagList.innerHTML = renderTagList(tags, scope.kind === 'tag' ? scope.tag : undefined);
    const options = (values: Array<{ name: string }>) => values.map((value) => `<option value="${escapeHtml(value.name)}"></option>`).join('');
    const tagOptions = get('#tag-options');
    if (tagOptions) tagOptions.innerHTML = options(tags);
    const domainOptions = get('#domain-options');
    if (domainOptions) domainOptions.innerHTML = options(domainCounts(bookmarks));
  };

  const scopeTitle = () => {
    if (scope.kind === 'all') return text.allBookmarks;
    if (scope.kind === 'favorites') return text.favorites;
    if (scope.kind === 'recent') return text.recent;
    if (scope.kind === 'unfiled') return text.unfiled;
    if (scope.kind === 'duplicates') return text.duplicates;
    if (scope.kind === 'trash') return text.trash;
    const current: LibraryScope = scope;
    if (current.kind === 'tag') return `#${current.tag}`;
    const id = current.kind === 'folder' ? current.id : undefined;
    return collections.find((item) => item.id === id)?.name ?? text.libraryTitle;
  };

  const chip = (key: string, label: string) => `<button type="button" class="chip is-removable" data-remove-filter="${key}" aria-label="${escapeHtml(fill(text.removeFilter, { v: label }))}"><span>${escapeHtml(label)}</span>${uiIcon('x')}</button>`;

  const renderHead = () => {
    const heading = get('#folder-heading');
    if (heading) heading.textContent = scopeTitle();
    const count = get('#folder-count');
    if (count) count.textContent = bookmarkCountLabel(visible.length, language);
    if (typeof document !== 'undefined') document.title = `${scopeTitle()} · LumaMark`;

    const menu = get<HTMLDetailsElement>('#scope-menu');
    if (menu) {
      menu.hidden = scope.kind !== 'folder' && scope.kind !== 'tag';
      menu.open = false;
      root.querySelectorAll<HTMLElement>('[data-menu-for]').forEach((group) => { group.hidden = group.dataset.menuFor !== scope.kind; });
      const summary = menu.querySelector('summary');
      const label = scope.kind === 'tag' ? text.tagMenu : text.folderMenu;
      summary?.setAttribute('aria-label', label);
      summary?.setAttribute('title', label);
    }
    const replace = get('#open-replace');
    if (replace) replace.hidden = scope.kind === 'trash' || !visible.length;

    // Bulk tools differ in Trash: the only thing to do there is bring bookmarks back.
    root.querySelectorAll<HTMLElement>('[data-batch]').forEach((group) => { group.hidden = (group.dataset.batch === 'trash') !== (scope.kind === 'trash'); });

    const moveOptions = `<option value="">${escapeHtml(text.chooseFolder)}</option><option value="${UNFILED_TARGET}">${escapeHtml(text.unfiled)}</option>${collectionOptions(collections, '', language)}`;
    const batchSelect = get<HTMLSelectElement>('#batch-collection');
    if (batchSelect) batchSelect.innerHTML = moveOptions;
    const editorSelect = get<HTMLSelectElement>('#editor-folder');
    const editorFolder = editorSelect?.value ?? '';
    if (editorSelect) editorSelect.innerHTML = `<option value="">${escapeHtml(text.unfiled)}</option>${collectionOptions(collections, editorFolder, language)}`;

    const banner = get('#scope-banner');
    if (banner) {
      const extra = extraDuplicateIds(groups).length;
      if (scope.kind === 'duplicates' && extra) {
        banner.hidden = false;
        banner.innerHTML = `<div><strong>${escapeHtml(fill(text.duplicatesBanner, { groups: groups.length, extra }))}</strong><p>${escapeHtml(text.duplicatesHelp)}</p></div><button type="button" class="primary" data-action="clean-duplicates">${escapeHtml(text.duplicatesAction)}</button>`;
      } else if (scope.kind === 'trash' && visible.length) {
        banner.hidden = false;
        banner.innerHTML = `<div><p>${escapeHtml(text.trashHelp)}</p></div><button type="button" class="secondary" data-action="restore-all">${escapeHtml(text.restoreAll)}</button>`;
      } else {
        banner.hidden = true;
        banner.innerHTML = '';
      }
    }

    const subfolders = get('#subfolders');
    if (subfolders) {
      const current: LibraryScope = scope;
      const id = current.kind === 'folder' ? current.id : undefined;
      const children = id && !filters.text.trim() ? collections.filter((item) => item.parentId === id && !item.deletedAt) : [];
      subfolders.hidden = !children.length;
      subfolders.innerHTML = children.map((child) => `<button type="button" class="subfolder" data-select-folder="${escapeHtml(child.id)}" data-drop="folder:${escapeHtml(child.id)}">${uiIcon('folder')}<span>${escapeHtml(child.name)}</span></button>`).join('');
    }

    const searchScope = get('#search-scope');
    const crossing = scope.kind === 'folder' && Boolean(filters.text.trim());
    if (searchScope) {
      searchScope.hidden = !crossing;
      searchScope.innerHTML = crossing
        ? `<button type="button" data-search-within="false" aria-pressed="${!searchWithinFolder}">${escapeHtml(text.searchEverywhere)}</button><button type="button" data-search-within="true" aria-pressed="${searchWithinFolder}">${escapeHtml(fill(text.searchIn, { v: scopeTitle() }))}</button>`
        : '';
    }
    const chips = [
      filters.tag.trim() ? chip('tag', fill(text.filterTag, { v: filters.tag.trim() })) : '',
      filters.domain.trim() ? chip('domain', fill(text.filterDomain, { v: filters.domain.trim() })) : '',
      filters.from ? chip('from', fill(text.filterFrom, { v: filters.from })) : '',
      filters.to ? chip('to', fill(text.filterTo, { v: filters.to })) : '',
      filters.favoriteOnly ? chip('favoriteOnly', text.favoritesOnly) : '',
    ].filter(Boolean);
    const active = get('#active-filters');
    if (active) active.innerHTML = chips.join('');
    const row = get('#filter-row');
    if (row) row.hidden = !chips.length && !crossing;
    const badge = get('#filter-count');
    if (badge) {
      badge.hidden = !chips.length;
      badge.textContent = String(chips.length);
    }
  };

  const computeVisible = () => {
    visible = scopedBookmarks(bookmarks, scope, filters, { collections, searchWithinFolder });
    const ids = new Set(visible.map((bookmark) => bookmark.id));
    // A selection never reaches bookmarks the user can no longer see.
    for (const id of [...selection]) if (!ids.has(id)) selection.delete(id);
    if (cursorId && !ids.has(cursorId)) cursorId = undefined;
  };

  const render = (keepRows = false) => {
    computeVisible();
    renderSidebar();
    renderHead();
    renderResults(keepRows);
    syncSelection();
  };

  /** Filter and search changes redraw the list only; the sidebar does not move. */
  const renderList = () => {
    computeVisible();
    renderHead();
    renderResults();
    syncSelection();
    const main = scroller();
    if (main) main.scrollTop = 0;
  };

  const setScope = (next: LibraryScope) => {
    if (!sameScope(scope, next)) {
      scope = next;
      searchWithinFolder = false;
      selection.clear();
      anchorId = undefined;
      cursorId = undefined;
      if (editingId) closeEditor();
    }
    render();
    const main = scroller();
    if (main) main.scrollTop = 0;
  };

  const load = async () => {
    const target = results();
    try {
      const [response, collectionsResponse, config, metadata] = await Promise.all([
        sendRuntime(port, 'list', { includeDeleted: true }),
        sendRuntime(port, 'list-collections'),
        sendRuntime(port, 'get-sync-config'),
        sendRuntime(port, 'sync-status'),
      ]);
      if (response?.ok === false) throw new Error(response.error || 'load failed');
      if (collectionsResponse?.ok === false) throw new Error(collectionsResponse.error || 'load failed');
      bookmarks = Array.isArray(response?.items) ? response.items : [];
      collections = Array.isArray(collectionsResponse?.items) ? collectionsResponse.items : [];
      paths = folderPaths(collections);
      groups = duplicateGroups(bookmarks);
      const line = get('#sync-line');
      if (line) line.innerHTML = renderSyncLine(homeSyncPhrase({ configured: Boolean(config?.config?.configured), status: metadata?.metadata?.status, error: metadata?.metadata?.error }), language);
      const current: LibraryScope = scope;
      if (current.kind === 'folder' && !aliveFolderIds(collections).has(current.id)) scope = { kind: 'all' };
      const first = !loaded;
      loaded = true;
      render(!first);
      if (first) openDeepLink();
    } catch {
      if (target) target.innerHTML = libraryFailureMessage(language);
    }
  };

  /** Home and the popup link straight to a view or a bookmark. */
  const openDeepLink = () => {
    const wanted = params.get('scope');
    const folder = params.get('folder');
    const bookmarkId = params.get('bookmark');
    if (wanted === 'favorites' || wanted === 'recent') setScope({ kind: wanted });
    if (folder) setScope({ kind: 'folder', id: folder });
    if (bookmarkId && bookmarks.some((item) => item.id === bookmarkId)) {
      setCursor(bookmarkId);
      openEditor(bookmarkId);
    }
  };

  // ── Cursor ──
  const setCursor = (id: string | undefined, focus = true) => {
    cursorId = id;
    if (!id) { markRows(); return; }
    ensureRendered(visible.findIndex((bookmark) => bookmark.id === id));
    markRows();
    if (!focus) return;
    const card = cardFor(id);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: 'nearest' });
  };

  const moveCursor = (delta: number) => {
    if (!visible.length) return undefined;
    const current = visible.findIndex((bookmark) => bookmark.id === cursorId);
    const next = current < 0 ? 0 : Math.min(visible.length - 1, Math.max(0, current + delta));
    setCursor(visible[next]?.id);
    return visible[next]?.id;
  };

  // ── Editor ──
  const editorField = <T extends HTMLElement>(name: string) => (get<HTMLFormElement>('#editor')?.elements.namedItem(name) ?? null) as T | null;
  const editorSnapshot = () => JSON.stringify(['title', 'url', 'folder', 'tags', 'notes'].map((name) => editorField<HTMLInputElement>(name)?.value ?? '').concat(String(editorField<HTMLInputElement>('favorite')?.checked)));

  const suggestTags = (container: HTMLElement | null, current: string, limit = 8) => {
    if (!container) return;
    const used = new Set(parseTags(current));
    const options = tagCounts(bookmarks).filter((tag) => !used.has(tag.name)).slice(0, limit);
    container.hidden = !options.length;
    container.innerHTML = options.map((tag) => `<button type="button" class="chip" data-add-tag="${escapeHtml(tag.name)}">#${escapeHtml(tag.name)}</button>`).join('');
  };

  const closeEditor = () => {
    const editor = get('#editor');
    if (editor) editor.hidden = true;
    editingId = undefined;
    editorBaseline = '';
    markRows();
  };

  const openEditor = (id: string) => {
    const bookmark = bookmarks.find((item) => item.id === id);
    const editor = get<HTMLFormElement>('#editor');
    if (!bookmark || !editor || bookmark.deletedAt) return;
    editingId = id;
    editor.hidden = false;
    editorField<HTMLInputElement>('title')!.value = bookmark.title;
    editorField<HTMLInputElement>('url')!.value = bookmark.url;
    editorField<HTMLInputElement>('tags')!.value = bookmark.tags.join(', ');
    editorField<HTMLTextAreaElement>('notes')!.value = bookmark.notes;
    editorField<HTMLInputElement>('favorite')!.checked = bookmark.favorite;
    const folder = editorField<HTMLSelectElement>('folder')!;
    folder.innerHTML = `<option value="">${escapeHtml(text.unfiled)}</option>${collectionOptions(collections, bookmark.collectionId ?? '', language)}`;
    const error = get('#editor-error');
    if (error) error.textContent = '';
    const icon = get('#editor-icon');
    if (icon) icon.innerHTML = siteIcon(bookmark.url, bookmark.title, bookmark.domain, bookmark.faviconUrl);
    const meta = get('#editor-meta');
    if (meta) meta.textContent = `${fill(text.savedOn, { v: relativeTime(bookmark.createdAt, language) })} · ${fill(text.changedOn, { v: relativeTime(bookmark.updatedAt, language) })}`;
    suggestTags(get('#editor-tag-suggestions'), bookmark.tags.join(','));
    editorBaseline = editorSnapshot();
    markRows();
  };

  const saveEditor = async (): Promise<boolean> => {
    const id = editingId;
    if (!id) return true;
    const url = editorField<HTMLInputElement>('url')?.value ?? '';
    const error = get('#editor-error');
    const original = bookmarks.find((item) => item.id === id);
    if (!isHttpUrl(url) && (!original || isHttpUrl(original.url) || !url.trim())) {
      if (error) error.textContent = text.invalidUrl;
      return false;
    }
    const response = await sendRuntime(port, 'update', {
      id,
      update: {
        title: editorField<HTMLInputElement>('title')?.value,
        url,
        collectionId: editorField<HTMLSelectElement>('folder')?.value || null,
        tags: parseTags(editorField<HTMLInputElement>('tags')?.value ?? ''),
        notes: editorField<HTMLTextAreaElement>('notes')?.value,
        favorite: editorField<HTMLInputElement>('favorite')?.checked,
      },
    });
    if (response?.error === 'invalid-url' || response?.ok === false) {
      if (error) error.textContent = response?.error === 'invalid-url' ? text.invalidUrl : text.notSaved;
      return false;
    }
    return true;
  };

  /** Moving to another bookmark keeps what was typed, the way a document would. */
  const switchEditor = async (id: string) => {
    if (editingId === id) return;
    if (editingId && editorSnapshot() !== editorBaseline) {
      if (!await saveEditor()) return;
      await load();
    }
    openEditor(id);
  };

  get<HTMLFormElement>('#editor')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!await saveEditor()) return;
    closeEditor();
    await load();
  });
  get('#editor-cancel')?.addEventListener('click', closeEditor);
  get('#editor-close')?.addEventListener('click', closeEditor);
  get('#editor-delete')?.addEventListener('click', async () => {
    const id = editingId;
    if (!id) return;
    closeEditor();
    await deleteIds([id]);
  });
  get('#editor-tags')?.addEventListener('input', (event) => suggestTags(get('#editor-tag-suggestions'), (event.target as HTMLInputElement).value));

  // ── Bulk actions ──
  async function deleteIds(ids: string[]) {
    if (!ids.length) return;
    if (ids.length >= CONFIRM_DELETE_AT && !await ask(text.confirmDeleteBookmark)) return;
    if (ids.length > PAGE_SIZE) say(text.working, 60_000);
    const response = await sendRuntime(port, 'delete', { ids });
    if (response?.ok && typeof response.undoToken === 'string') {
      const token = response.undoToken;
      showUndo(ids.length === 1 ? text.deletedUndo : fillCount(text.deletedCount, ids.length), () => sendRuntime(port, 'undo', { token }));
    }
    if (editingId && ids.includes(editingId)) closeEditor();
    await load();
  }

  const restoreIds = async (ids: string[]) => {
    if (!ids.length) return;
    const response = await sendRuntime(port, 'restore', { ids });
    if (response?.ok) showUndo(fillCount(text.restoredCount, ids.length), () => sendRuntime(port, 'delete', { ids }));
    else say(text.notSaved);
    await load();
  };

  const moveIds = async (ids: string[], target: string) => {
    const collectionId = target === UNFILED_TARGET ? null : target;
    const moving = withIds(ids).filter((bookmark) => (bookmark.collectionId ?? null) !== collectionId);
    await applyBatch(moving.map((bookmark) => ({ id: bookmark.id, update: { collectionId } })), undoChanges(moving, ['collectionId']), fillCount(text.movedCount, moving.length));
  };

  const setFavorite = async (ids: string[], favorite: boolean) => {
    const changing = withIds(ids).filter((bookmark) => bookmark.favorite !== favorite);
    await applyBatch(changing.map((bookmark) => ({ id: bookmark.id, update: { favorite } })), undoChanges(changing, ['favorite']), fillCount(text.favoritedCount, changing.length));
  };

  const editTags = async (ids: string[], add: string[], remove: string[]) => {
    const affected = withIds(ids);
    const items = tagChanges(affected, add, remove);
    const changing = withIds(items.map((item) => item.id));
    await applyBatch(items, undoChanges(changing, ['tags']), fillCount(text.taggedCount, items.length));
  };

  const openIds = async (ids: string[]) => {
    const urls = withIds(ids).map((bookmark) => bookmark.url).filter(isHttpUrl);
    if (urls.length >= CONFIRM_OPEN_AT && !await ask(fill(text.confirmOpenMany, { n: urls.length }), text.openTabs)) return;
    for (const url of urls) await sendRuntime(port, 'open-existing', { url });
  };

  get('#batch-clear')?.addEventListener('click', clearSelection);
  get('#batch-all')?.addEventListener('click', selectAll);
  get('#batch-delete')?.addEventListener('click', () => { void deleteIds([...selection]); });
  get('#batch-restore')?.addEventListener('click', () => { void restoreIds([...selection]); });
  get('#batch-open')?.addEventListener('click', () => { void openIds([...selection]); });
  get('#batch-move')?.addEventListener('click', () => {
    const target = get<HTMLSelectElement>('#batch-collection')?.value ?? '';
    if (selection.size && target) void moveIds([...selection], target);
  });
  get('#batch-favorite')?.addEventListener('click', () => {
    const items = selected();
    void setFavorite(items.map((item) => item.id), !items.every((item) => item.favorite));
  });
  get('#select-all')?.addEventListener('change', (event) => {
    if ((event.target as HTMLInputElement).checked) selectAll();
    else clearSelection();
  });

  // Tag dialog
  const removingTags = new Set<string>();
  const openTagDialog = () => {
    if (!selection.size) return;
    removingTags.clear();
    const heading = get('#tag-heading');
    if (heading) heading.textContent = fillCount(text.tagDialogTitle, selection.size);
    const add = get<HTMLInputElement>('#tag-add');
    if (add) add.value = '';
    const present = tagCounts(selected());
    const group = get('#tag-existing-group');
    if (group) group.hidden = !present.length;
    const list = get('#tag-existing');
    if (list) list.innerHTML = present.map((tag) => `<button type="button" class="chip" data-toggle-tag="${escapeHtml(tag.name)}" aria-pressed="false">#${escapeHtml(tag.name)}<span class="chip-count">${tag.count}</span></button>`).join('');
    openDialog('#tag-dialog');
    add?.focus();
  };
  get('#batch-tags')?.addEventListener('click', openTagDialog);
  get('#tag-existing')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-toggle-tag]');
    const tag = button?.dataset.toggleTag;
    if (!button || !tag) return;
    if (removingTags.has(tag)) removingTags.delete(tag);
    else removingTags.add(tag);
    button.setAttribute('aria-pressed', String(removingTags.has(tag)));
  });
  get('#tag-cancel')?.addEventListener('click', () => get<HTMLDialogElement>('#tag-dialog')?.close());
  get('#tag-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    get<HTMLDialogElement>('#tag-dialog')?.close();
    void editTags([...selection], parseTags(get<HTMLInputElement>('#tag-add')?.value ?? ''), [...removingTags]);
  });

  // Find and replace
  let replaceTargets: Bookmark[] = [];
  const replaceInput = () => ({
    field: (get<HTMLInputElement>('input[name="replace-field"]:checked')?.value ?? 'title') as ReplaceField,
    find: get<HTMLInputElement>('#replace-find')?.value ?? '',
    replace: get<HTMLInputElement>('#replace-with')?.value ?? '',
    matchCase: Boolean(get<HTMLInputElement>('#replace-case')?.checked),
  });
  const paintReplace = () => {
    const plan = planReplace(replaceTargets, replaceInput());
    const preview = get('#replace-preview');
    const apply = get<HTMLButtonElement>('#replace-apply');
    if (apply) {
      apply.disabled = !plan.edits.length;
      apply.textContent = plan.edits.length ? fillCount(text.replaceApply, plan.edits.length) : text.apply;
    }
    if (!preview) return;
    if (!plan.edits.length && !plan.invalid) { preview.innerHTML = `<p class="form-note">${escapeHtml(text.replaceNone)}</p>`; return; }
    const rows = plan.edits.slice(0, 5).map((edit) => `<li><span class="replace-before">${escapeHtml(edit.before)}</span><span class="replace-after">${escapeHtml(edit.after)}</span></li>`).join('');
    preview.innerHTML = `<p class="field-label">${escapeHtml(fillCount(text.replacePreview, plan.edits.length))}</p><ul>${rows}</ul>` +
      (plan.invalid ? `<p class="form-note">${escapeHtml(fill(text.replaceInvalid, { n: plan.invalid }))}</p>` : '');
  };
  const openReplace = () => {
    replaceTargets = selection.size ? selected() : visible;
    if (!replaceTargets.length) return;
    const heading = get('#replace-heading');
    const where = selection.size ? fillCount(text.replaceScopeSelected, selection.size) : fillCount(text.replaceScopeView, visible.length);
    if (heading) heading.textContent = fill(text.replaceTitle, { v: where });
    // Each run starts blank: a leftover search is one click away from rewriting the wrong bookmarks.
    get<HTMLFormElement>('#replace-form')?.reset();
    paintReplace();
    openDialog('#replace-dialog');
    get('#replace-find')?.focus();
  };
  get('#open-replace')?.addEventListener('click', openReplace);
  get('#batch-replace')?.addEventListener('click', openReplace);
  get('#replace-form')?.addEventListener('input', paintReplace);
  get('#replace-cancel')?.addEventListener('click', () => get<HTMLDialogElement>('#replace-dialog')?.close());
  get('#replace-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = replaceInput();
    const plan = planReplace(replaceTargets, input);
    get<HTMLDialogElement>('#replace-dialog')?.close();
    const before = withIds(plan.edits.map((edit) => edit.id));
    void applyBatch(plan.edits.map((edit) => ({ id: edit.id, update: { [input.field]: edit.after } })), undoChanges(before, [input.field]), fillCount(text.replacedDone, plan.edits.length));
  });

  get('#shortcut-close')?.addEventListener('click', () => get<HTMLDialogElement>('#shortcut-dialog')?.close());
  get('#show-shortcuts')?.addEventListener('click', () => openDialog('#shortcut-dialog'));

  // ── Filters ──
  const form = get<HTMLFormElement>('#filters');
  const rememberView = () => writeJson(VIEW_KEY, { view: filters.view, sort: filters.sort, direction: filters.direction });
  const readFilters = () => {
    if (!form) return;
    const data = new FormData(form);
    filters = {
      ...filters,
      text: String(data.get('text') ?? ''),
      tag: String(data.get('tag') ?? ''),
      domain: String(data.get('domain') ?? ''),
      from: String(data.get('from') ?? ''),
      to: String(data.get('to') ?? ''),
      favoriteOnly: data.has('favoriteOnly'),
    };
  };
  form?.addEventListener('submit', (event) => event.preventDefault());
  form?.addEventListener('input', () => { readFilters(); renderList(); });
  form?.addEventListener('reset', () => {
    filters = { ...defaultLibraryFilters(), view: filters.view, sort: filters.sort, direction: filters.direction };
    setTimeout(renderList, 0);
  });
  const sortSelect = get<HTMLSelectElement>('#sort');
  if (sortSelect) sortSelect.value = `${filters.sort}:${filters.direction}`;
  sortSelect?.addEventListener('change', () => {
    const [sort, direction] = sortSelect.value.split(':') as [LibraryFilters['sort'], LibraryFilters['direction']];
    filters = { ...filters, sort, direction };
    rememberView();
    renderList();
  });
  const paintViewButtons = () => root.querySelectorAll<HTMLElement>('[data-view]').forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.view === filters.view)));
  paintViewButtons();
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.addEventListener('click', () => {
    filters.view = button.dataset.view as LibraryFilters['view'];
    rememberView();
    paintViewButtons();
    renderResults(true);
    syncSelection();
  }));

  // ── Clicks ──
  const closeMenus = (except?: Element | null) => {
    root.querySelectorAll<HTMLDetailsElement>('details.menu[open]').forEach((menu) => { if (menu !== except) menu.open = false; });
  };

  const actions: Record<string, () => void | Promise<void>> = {
    'clean-duplicates': () => deleteIds(extraDuplicateIds(groups)),
    'restore-all': () => restoreIds(visible.map((bookmark) => bookmark.id)),
    'clear-filters': () => { form?.reset(); },
    'save-page': async () => {
      const response = await sendRuntime(port, 'save', {});
      say(response?.unsavable ? text.cannotSave : response?.ok ? text.saved : text.notSaved);
      await load();
    },
    'import-html': async () => {
      const rule = get<HTMLSelectElement>('#empty-import-action')?.value ?? 'skip';
      const content = await chooseTextFile('.html,text/html');
      if (!content) return;
      const response = await sendRuntime(port, 'import', { format: 'html', content, action: rule });
      say(response?.ok ? text.importDone : text.importFailed);
      await load();
    },
  };

  root.addEventListener('click', async (event) => {
    const mouse = event as MouseEvent;
    const target = event.target as HTMLElement;
    closeMenus(target.closest('details.menu'));

    const twisty = target.closest<HTMLElement>('[data-toggle-folder]');
    if (twisty) {
      const id = twisty.dataset.toggleFolder ?? '';
      if (collapsed.has(id)) collapsed.delete(id);
      else collapsed.add(id);
      writeJson(COLLAPSED_KEY, [...collapsed]);
      renderSidebar();
      return;
    }
    const scopeButton = target.closest<HTMLElement>('[data-scope]');
    if (scopeButton) { setScope({ kind: scopeButton.dataset.scope as 'all' }); return; }
    const folderButton = target.closest<HTMLElement>('[data-select-folder]');
    if (folderButton) { setScope({ kind: 'folder', id: folderButton.dataset.selectFolder ?? '' }); return; }
    const tagButton = target.closest<HTMLElement>('[data-select-tag]');
    if (tagButton) { setScope({ kind: 'tag', tag: tagButton.dataset.selectTag ?? '' }); return; }
    const within = target.closest<HTMLElement>('[data-search-within]');
    if (within) { searchWithinFolder = within.dataset.searchWithin === 'true'; renderList(); return; }
    const removeFilter = target.closest<HTMLElement>('[data-remove-filter]');
    if (removeFilter) {
      const input = get<HTMLInputElement>(`[name="${removeFilter.dataset.removeFilter}"]`);
      if (input) {
        if (input.type === 'checkbox') input.checked = false;
        else input.value = '';
      }
      readFilters();
      renderList();
      return;
    }
    const addTag = target.closest<HTMLElement>('[data-add-tag]');
    if (addTag) {
      const input = editorField<HTMLInputElement>('tags');
      if (input) {
        input.value = [...parseTags(input.value), addTag.dataset.addTag].join(', ');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }

    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action && actions[action]) { await actions[action](); return; }

    const box = target.closest<HTMLInputElement>('[data-select-bookmark]');
    if (box) {
      const id = box.dataset.selectBookmark ?? '';
      if (mouse.shiftKey) selectRange(id);
      else toggleSelected(id, box.checked);
      return;
    }

    const card = target.closest<HTMLElement>('[data-bookmark-id]');
    const id = card?.dataset.bookmarkId;
    if (!card || !id) return;
    if (action === 'favorite') {
      const bookmark = bookmarks.find((item) => item.id === id);
      await sendRuntime(port, 'favorite', { id, favorite: !bookmark?.favorite });
      await load();
      return;
    }
    if (action === 'edit') { setCursor(id, false); await switchEditor(id); return; }
    if (action === 'delete') { await deleteIds([id]); return; }
    if (action === 'restore') { await restoreIds([id]); return; }
    if (target.closest('a, button, label, input')) return;
    setCursor(id, false);
    if (mouse.shiftKey) { selectRange(id); return; }
    if (mouse.ctrlKey || mouse.metaKey || selection.size) { toggleSelected(id); return; }
    anchorId = id;
    if (scope.kind !== 'trash') await switchEditor(id);
  });

  // ── Keyboard ──
  root.addEventListener('keydown', (event) => {
    const key = event as KeyboardEvent;
    const target = key.target as HTMLElement | null;
    if (get('dialog[open]')) return;
    const typing = isTyping(target);
    const command = key.ctrlKey || key.metaKey;

    if (key.key === 'Escape') {
      const openMenu = get('details.menu[open]');
      if (openMenu) { closeMenus(); return; }
      if (editingId) { closeEditor(); return; }
      const search = get<HTMLInputElement>('#search');
      if (search && target === search && search.value) {
        search.value = '';
        search.form?.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (selection.size) clearSelection();
      return;
    }
    if (typing) {
      if (key.key === 'ArrowDown' && target?.id === 'search' && visible.length) { key.preventDefault(); moveCursor(0); }
      return;
    }
    if (command && key.key.toLowerCase() === 'z') { key.preventDefault(); void runUndo(); return; }
    if (command && key.key.toLowerCase() === 'a') { key.preventDefault(); selectAll(); return; }
    if (command) return;
    if (key.key === '/') { key.preventDefault(); get('#search')?.focus(); return; }
    if (key.key === '?') { key.preventDefault(); openDialog('#shortcut-dialog'); return; }

    const step = key.key === 'ArrowDown' || key.key === 'j' ? 1 : key.key === 'ArrowUp' || key.key === 'k' ? -1 : 0;
    if (step) {
      key.preventDefault();
      const start = cursorId;
      const id = moveCursor(step);
      if (key.shiftKey && id) {
        anchorId ??= start ?? id;
        selectRange(id);
      }
      return;
    }
    const id = cursorId;
    if (key.key === 'Home' || key.key === 'End') {
      key.preventDefault();
      moveCursor(key.key === 'Home' ? -visible.length : visible.length);
      return;
    }
    if (!id || !target?.closest('.bookmark-card')) {
      if ((key.key === 'Delete' || key.key === 'Backspace') && selection.size) void deleteIds([...selection]);
      return;
    }
    if (key.key === 'x' || key.key === ' ') { key.preventDefault(); toggleSelected(id); return; }
    if (key.key === 'Enter') {
      if (target === cardFor(id)) cardFor(id)?.querySelector<HTMLAnchorElement>('a.bookmark-title')?.click();
      return;
    }
    if (key.key === 'e' && scope.kind !== 'trash') {
      void switchEditor(id).then(() => get<HTMLInputElement>('#editor-title')?.focus());
      return;
    }
    if (key.key === 'f' && scope.kind !== 'trash') {
      const bookmark = bookmarks.find((item) => item.id === id);
      void sendRuntime(port, 'favorite', { id, favorite: !bookmark?.favorite }).then(load);
      return;
    }
    if (key.key === 'Delete' || key.key === 'Backspace') {
      if (scope.kind === 'trash') return;
      void deleteIds(selection.size ? [...selection] : [id]);
    }
  });

  // ── Drag to folders, tags, Favorites and Trash ──
  let dragged: { kind: 'bookmarks'; ids: string[] } | { kind: 'folder'; id: string } | undefined;

  const dragLabel = (count: number) => {
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = bookmarkCountLabel(count, language);
    document.body.append(ghost);
    setTimeout(() => ghost.remove(), 0);
    return ghost;
  };

  root.addEventListener('dragstart', (event) => {
    const drag = event as DragEvent;
    const target = drag.target as HTMLElement;
    const node = target.closest?.<HTMLElement>('[data-folder-node]');
    if (node) {
      dragged = { kind: 'folder', id: node.dataset.folderNode ?? '' };
      if (drag.dataTransfer) { drag.dataTransfer.effectAllowed = 'move'; drag.dataTransfer.setData('text/plain', ''); }
      return;
    }
    const card = target.closest?.<HTMLElement>('[data-bookmark-id]');
    const id = card?.dataset.bookmarkId;
    if (!id) return;
    const ids = selection.has(id) ? [...selection] : [id];
    dragged = { kind: 'bookmarks', ids };
    if (drag.dataTransfer) {
      drag.dataTransfer.effectAllowed = 'move';
      drag.dataTransfer.setData('text/plain', withIds(ids).map((bookmark) => bookmark.url).join('\n'));
      if (ids.length > 1) drag.dataTransfer.setDragImage(dragLabel(ids.length), 12, 12);
    }
    get('.library-shell')?.classList.add('is-dragging');
  });
  const clearDrop = () => root.querySelectorAll('.is-drop').forEach((item) => item.classList.remove('is-drop'));
  const dropTarget = (event: Event) => (event.target as HTMLElement).closest?.<HTMLElement>('[data-drop]');
  root.addEventListener('dragover', (event) => {
    const target = dropTarget(event);
    if (!dragged || !target) return;
    if (dragged.kind === 'folder' && !target.dataset.drop?.startsWith('folder:')) return;
    event.preventDefault();
    if (!target.classList.contains('is-drop')) { clearDrop(); target.classList.add('is-drop'); }
  });
  root.addEventListener('dragleave', (event) => { dropTarget(event)?.classList.remove('is-drop'); });
  root.addEventListener('dragend', () => {
    dragged = undefined;
    clearDrop();
    get('.library-shell')?.classList.remove('is-dragging');
  });
  root.addEventListener('drop', async (event) => {
    const target = dropTarget(event)?.dataset.drop;
    const moving = dragged;
    dragged = undefined;
    clearDrop();
    get('.library-shell')?.classList.remove('is-dragging');
    if (!target || !moving) return;
    event.preventDefault();
    if (moving.kind === 'folder') {
      const parentId = target.slice('folder:'.length);
      if (parentId === moving.id) return;
      const response = await sendRuntime(port, 'reorder', { kind: 'folder', id: moving.id, parentId });
      if (response?.ok === false) say(text.notSaved);
      await load();
      return;
    }
    if (target === 'trash') await deleteIds(moving.ids);
    else if (target === 'favorites') await setFavorite(moving.ids, true);
    else if (target === 'unfiled') await moveIds(moving.ids, UNFILED_TARGET);
    else if (target.startsWith('tag:')) await editTags(moving.ids, [target.slice('tag:'.length)], []);
    else if (target.startsWith('folder:')) await moveIds(moving.ids, target.slice('folder:'.length));
  });

  // ── Folders and tags ──
  const showNewFolder = (show: boolean) => {
    const box = get('#new-folder-form');
    if (box) box.hidden = !show;
    if (show) get('#new-collection')?.focus();
  };
  const createFolder = async () => {
    const input = get<HTMLInputElement>('#new-collection');
    const name = input?.value.trim();
    if (!name) { showNewFolder(false); return; }
    const response = await sendRuntime(port, 'collection-create', { name });
    if (input) input.value = '';
    showNewFolder(false);
    await load();
    if (response?.item?.id) setScope({ kind: 'folder', id: response.item.id });
  };
  get('#show-new-folder')?.addEventListener('click', () => showNewFolder(Boolean(get('#new-folder-form')?.hidden)));
  get('#create-collection')?.addEventListener('click', () => { void createFolder(); });
  get('#new-collection')?.addEventListener('keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (key === 'Enter') { event.preventDefault(); void createFolder(); }
    if (key === 'Escape') { event.stopPropagation(); showNewFolder(false); }
  });

  const folderInScope = () => (scope.kind === 'folder' ? collections.find((item) => item.id === (scope as { id: string }).id) : undefined);

  get('#rename-folder')?.addEventListener('click', async () => {
    const folder = folderInScope();
    if (!folder) return;
    const name = await askName(text.renameFolder, folder.name);
    if (!name || name === folder.name) return;
    const response = await sendRuntime(port, 'collection-update', { id: folder.id, name });
    say(response?.ok ? text.folderRenamed : text.notSaved);
    await load();
  });
  get('#add-subfolder')?.addEventListener('click', async () => {
    const folder = folderInScope();
    if (!folder) return;
    const name = await askName(text.newSubfolder);
    if (!name) return;
    collapsed.delete(folder.id);
    await sendRuntime(port, 'collection-create', { name, parentId: folder.id });
    await load();
  });
  get('#use-as-bar')?.addEventListener('click', async () => {
    const folder = folderInScope();
    if (!folder) return;
    const response = await sendRuntime(port, 'set-toolbar', { id: folder.id });
    say(response?.ok ? text.barChanged : text.notSaved);
    await load();
  });
  get('#delete-folder')?.addEventListener('click', async () => {
    const folder = folderInScope();
    if (!folder || !await ask(fill(text.confirmDeleteFolder, { v: folder.name }))) return;
    const response = await sendRuntime(port, 'collection-delete', { id: folder.id });
    if (response?.ok) showUndo(text.folderDeleted, () => sendRuntime(port, 'collection-restore', { id: folder.id }));
    setScope({ kind: 'all' });
    await load();
  });
  const tagInScope = () => (scope.kind === 'tag' ? scope.tag : undefined);
  get('#rename-tag')?.addEventListener('click', async () => {
    const tag = tagInScope();
    if (!tag) return;
    const next = parseTags(await askName(text.renameTag, tag) ?? '')[0];
    if (!next || next === tag) return;
    await editTags(liveBookmarks(bookmarks).filter((bookmark) => bookmark.tags.includes(tag)).map((bookmark) => bookmark.id), [next], [tag]);
    setScope({ kind: 'tag', tag: next });
  });
  get('#delete-tag')?.addEventListener('click', async () => {
    const tag = tagInScope();
    if (!tag) return;
    await editTags(liveBookmarks(bookmarks).filter((bookmark) => bookmark.tags.includes(tag)).map((bookmark) => bookmark.id), [], [tag]);
    setScope({ kind: 'all' });
  });

  // Long lists draw in pages as the user scrolls; bulk actions use the full result set, not the drawn rows.
  const list = results();
  if (list) watchIconFallback(list);
  const sentinel = get('#load-more');
  if (sentinel && typeof IntersectionObserver !== 'undefined') {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      appendRows();
      syncSelection();
      observer.unobserve(sentinel);
      if (shown < visible.length) observer.observe(sentinel);
    }, { root: scroller(), rootMargin: '800px' });
    const watch = () => { observer.unobserve(sentinel); if (shown < visible.length) observer.observe(sentinel); };
    const rendered = new MutationObserver(watch);
    if (list) rendered.observe(list, { childList: true });
  }

  // Changes made elsewhere (the popup, the browser's own bookmarks, a sync) show up on return.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && loaded && !editingId) void load();
    });
  }
  void load();
}

export { libraryDocument };
