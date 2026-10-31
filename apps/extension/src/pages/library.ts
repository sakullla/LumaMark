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
import { createContextMenu, type MenuEntry } from '../ui/context-menu';
import { uiIcon, watchIconFallback, type UiIconName } from '../ui/icons';
import { applyPreferences, readPreferences, resolvedTheme, savePreference } from '../ui/theme';
import { escapeHtml } from '../ui/html';
import { dropIntent, homeSyncPhrase, isHttpUrl } from '../ui/bar';
import {
  aliveFolderIds,
  deletedBookmarks,
  domainCounts,
  duplicateGroups,
  extraDuplicateIds,
  folderDescendants,
  folderFootprint,
  folderPaths,
  folderTrail,
  isLockedFolder,
  isUnfiled,
  liveBookmarks,
  moveTargets,
  paletteResults,
  parseTags,
  planReplace,
  rangeIds,
  RECENT_DAYS,
  sameScope,
  scopedBookmarks,
  scopeKey,
  tagChanges,
  tagCounts,
  typedUrl,
  undoChanges,
  type BatchChange,
  type LibraryScope,
  type PaletteHit,
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
const TOP_TARGET = '__top';
const TAG_PREVIEW = 12;
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
  const menu = createContextMenu();
  let inlineEditing = false;
  let tagsExpanded = false;

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

  type Decision = 'confirm' | 'alt' | 'cancel';
  /** The one yes/no question of the page. `alt` adds a second way to say yes. */
  const decide = (message: string, options: { confirm?: string; title?: string; alt?: string } = {}) => new Promise<Decision>((resolve) => {
    const dialog = get<HTMLDialogElement>('#decision');
    const heading = get('#decision-heading');
    const label = get('#decision-text');
    const yes = get<HTMLButtonElement>('#decision-confirm');
    const no = get<HTMLButtonElement>('#decision-cancel');
    const alt = get<HTMLButtonElement>('#decision-alt');
    if (!dialog || !yes || !no) { resolve('cancel'); return; }
    if (heading) heading.textContent = options.title ?? text.confirmTitle;
    if (label) label.textContent = message;
    yes.textContent = options.confirm ?? text.delete;
    if (alt) { alt.hidden = !options.alt; alt.textContent = options.alt ?? ''; }
    dialog.classList.toggle('has-choice', Boolean(options.alt));
    const finish = (value: Decision) => {
      dialog.close();
      yes.removeEventListener('click', onYes);
      alt?.removeEventListener('click', onAlt);
      no.removeEventListener('click', onNo);
      dialog.removeEventListener('cancel', onNo);
      resolve(value);
    };
    const onYes = () => finish('confirm');
    const onAlt = () => finish('alt');
    const onNo = () => finish('cancel');
    yes.addEventListener('click', onYes);
    alt?.addEventListener('click', onAlt);
    no.addEventListener('click', onNo);
    dialog.addEventListener('cancel', onNo);
    dialog.showModal();
    no.focus();
  });
  const ask = async (message: string, confirm = text.delete) => await decide(message, { confirm }) === 'confirm';

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
    if (scope.kind === 'folder' && liveBookmarks(bookmarks).length) return renderNotice('folder', text.emptyFolder, text.clearTrashHint, { id: 'add-bookmark', label: text.addBookmark });
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

  const paintThemeButton = () => {
    const button = get('#toggle-theme');
    if (button) button.innerHTML = uiIcon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon');
  };

  const toggleTheme = () => {
    const prefersDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
    savePreference('theme', resolvedTheme(readPreferences().theme, prefersDark) === 'dark' ? 'light' : 'dark');
    applyPreferences();
    paintThemeButton();
  };

  const renderSidebar = () => {
    if (inlineEditing) return;
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
    if (tagList) tagList.innerHTML = renderTagList(tags, scope.kind === 'tag' ? scope.tag : undefined, tagsExpanded ? undefined : TAG_PREVIEW);
    const tagToggle = get('#tags-toggle');
    if (tagToggle) {
      tagToggle.hidden = tags.length <= TAG_PREVIEW;
      tagToggle.textContent = tagsExpanded ? text.showFewerTags : fill(text.showMoreTags, { n: tags.length });
    }
    paintThemeButton();
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

    const more = get('#scope-more');
    if (more) more.hidden = scope.kind !== 'folder' && scope.kind !== 'tag';
    const trailHost = get('#folder-trail');
    if (trailHost) {
      const here: LibraryScope = scope;
      const trail = here.kind === 'folder' ? folderTrail(collections, here.id).slice(0, -1) : [];
      trailHost.hidden = !trail.length;
      trailHost.innerHTML = trail.map((folder) => `<button type="button" data-select-folder="${escapeHtml(folder.id)}">${escapeHtml(folder.name)}</button>${uiIcon('chevronRight')}`).join('');
    }
    const replace = get('#open-replace');
    if (replace) replace.hidden = scope.kind === 'trash' || !visible.length;

    // Bulk tools differ in Trash: the only thing to do there is bring bookmarks back.
    root.querySelectorAll<HTMLElement>('[data-batch]').forEach((group) => { group.hidden = (group.dataset.batch === 'trash') !== (scope.kind === 'trash'); });

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
    const openLink = get<HTMLAnchorElement>('#editor-open');
    if (openLink) {
      openLink.hidden = !isHttpUrl(bookmark.url);
      openLink.href = isHttpUrl(bookmark.url) ? bookmark.url : '#';
    }
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
  get('#batch-move')?.addEventListener('click', () => { void moveSelection([...selection]); });
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
    'add-bookmark': () => openAdd(),
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

    const folderMore = target.closest<HTMLElement>('[data-folder-menu]');
    if (folderMore) { openFolderMenu(folderMore.dataset.folderMenu ?? '', folderMore); return; }
    const folderAdd = target.closest<HTMLElement>('[data-folder-add]');
    if (folderAdd) { void createFolder(folderAdd.dataset.folderAdd); return; }

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
    if (action === 'more') {
      const button = target.closest<HTMLElement>('[data-action="more"]');
      if (button) openBookmarkMenu(id, button);
      return;
    }
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
    if (menu.isOpen()) return;
    const typing = isTyping(target);
    const command = key.ctrlKey || key.metaKey;
    if (command && key.key.toLowerCase() === 'k') { key.preventDefault(); openPalette(); return; }
    if (!typing && !command && target?.closest('.tree-button[data-select-folder]') && treeKey(key, target)) return;

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
    if (key.key === 'n' && !key.shiftKey && !key.altKey) { key.preventDefault(); openAdd(); return; }

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
  const clearDrop = () => {
    root.querySelectorAll('.is-drop').forEach((item) => item.classList.remove('is-drop'));
    root.querySelectorAll<HTMLElement>('[data-drop-intent]').forEach((item) => { delete item.dataset.dropIntent; });
    folderDrop = undefined;
  };
  const dropTarget = (event: Event) => (event.target as HTMLElement).closest?.<HTMLElement>('[data-drop]');
  const finishDrag = () => {
    dragged = undefined;
    clearDrop();
    get('.library-shell')?.classList.remove('is-dragging');
  };

  /** Where a dragged folder would land: above, below or inside the row under the pointer, or at the top of the list. */
  let folderDrop: { parentId?: string; beforeId?: string } | undefined;
  const aimFolder = (drag: DragEvent, movingId: string): boolean => {
    const target = drag.target as HTMLElement;
    if (target.closest?.('[data-tree-root]')) {
      const title = target.closest<HTMLElement>('[data-tree-root]')!;
      clearDrop();
      title.dataset.dropIntent = 'inside';
      folderDrop = {};
      return true;
    }
    const row = target.closest?.<HTMLElement>('.tree-row');
    const node = row?.closest<HTMLElement>('[data-folder-node]');
    const id = node?.dataset.folderNode;
    if (!row || !node || !id || folderDescendants(collections, movingId).has(id)) { clearDrop(); return false; }
    const box = row.getBoundingClientRect();
    const intent = dropIntent({ kind: 'folder', start: box.top, size: box.height, point: drag.clientY });
    clearDrop();
    row.dataset.dropIntent = intent;
    const parentId = collections.find((item) => item.id === id)?.parentId;
    if (intent === 'inside') folderDrop = { parentId: id };
    else if (intent === 'before') folderDrop = { parentId, beforeId: id };
    else folderDrop = { parentId, beforeId: (node.nextElementSibling as HTMLElement | null)?.dataset?.folderNode };
    return true;
  };

  root.addEventListener('dragover', (event) => {
    const drag = event as DragEvent;
    if (!dragged) return;
    if (dragged.kind === 'folder') {
      if (aimFolder(drag, dragged.id)) event.preventDefault();
      return;
    }
    const target = dropTarget(event);
    if (!target) return;
    event.preventDefault();
    if (!target.classList.contains('is-drop')) { clearDrop(); target.classList.add('is-drop'); }
  });
  root.addEventListener('dragleave', (event) => { dropTarget(event)?.classList.remove('is-drop'); });
  root.addEventListener('dragend', finishDrag);
  root.addEventListener('drop', async (event) => {
    const target = dropTarget(event)?.dataset.drop;
    const moving = dragged;
    const landing = folderDrop;
    finishDrag();
    if (!moving) return;
    event.preventDefault();
    if (moving.kind === 'folder') {
      if (landing) await placeFolder(moving.id, landing.parentId, landing.beforeId);
      return;
    }
    if (!target) return;
    if (target === 'trash') await deleteIds(moving.ids);
    else if (target === 'favorites') await setFavorite(moving.ids, true);
    else if (target === 'unfiled') await moveIds(moving.ids, UNFILED_TARGET);
    else if (target.startsWith('tag:')) await editTags(moving.ids, [target.slice('tag:'.length)], []);
    else if (target.startsWith('folder:')) await moveIds(moving.ids, target.slice('folder:'.length));
  });

  // ── Folders and tags ──
  const folderById = (id: string | undefined) => collections.find((item) => item.id === id && !item.deletedAt);

  /** Type a name right in the tree. Enter or leaving the field keeps it; Esc walks away. */
  const typeFolderName = (host: HTMLElement, initial: string, placeholder: string) => new Promise<string | undefined>((resolve) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tree-input';
    input.value = initial;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);
    let done = false;
    const finish = (value: string | undefined) => {
      if (done) return;
      done = true;
      inlineEditing = false;
      resolve(value?.trim() || undefined);
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); finish(input.value); }
      if (event.key === 'Escape') { event.preventDefault(); finish(undefined); }
    });
    input.addEventListener('blur', () => finish(input.value));
    inlineEditing = true;
    host.append(input);
    input.focus();
    input.select();
  });

  const nodeOf = (id: string) => get(`[data-folder-node="${CSS.escape(id)}"]`);
  const focusFolder = (id: string) => (nodeOf(id)?.querySelector<HTMLElement>(':scope > .tree-row > .tree-button'))?.focus();

  const createFolder = async (parentId?: string) => {
    const parent = folderById(parentId);
    if (parent && collapsed.delete(parent.id)) { writeJson(COLLAPSED_KEY, [...collapsed]); renderSidebar(); }
    const draft = document.createElement('div');
    draft.className = 'tree-row tree-draft';
    draft.innerHTML = `<span class="tree-icon" aria-hidden="true">${uiIcon('folder')}</span>`;
    const node = parent ? nodeOf(parent.id) : undefined;
    let shelf = get('#folder-tree') as HTMLElement | null;
    if (node) {
      shelf = node.querySelector<HTMLElement>(':scope > .tree-children');
      if (!shelf) {
        shelf = document.createElement('div');
        shelf.className = 'tree-children';
        node.append(shelf);
      }
    }
    if (!shelf) return;
    shelf.append(draft);
    draft.scrollIntoView({ block: 'nearest' });
    const name = await typeFolderName(draft, '', text.newFolder);
    draft.remove();
    if (!name) { renderSidebar(); return; }
    const response = await sendRuntime(port, 'collection-create', { name, parentId: parent?.id });
    if (response?.ok && response.item?.id) {
      const id = response.item.id as string;
      showUndo(text.folderCreated, () => sendRuntime(port, 'collection-delete', { id }));
    } else say(text.notSaved);
    await load();
  };

  const renameFolder = async (folder: Collection) => {
    const node = nodeOf(folder.id) as HTMLElement | null;
    const row = node?.querySelector<HTMLElement>(':scope > .tree-row');
    // A folder scrolled out of reach, or hidden in a closed parent, still renames through the dialog.
    const name = row && node
      ? await (async () => {
        node.draggable = false;
        row.classList.add('is-renaming');
        const value = await typeFolderName(row, folder.name, text.renameFolder);
        row.querySelector('.tree-input')?.remove();
        row.classList.remove('is-renaming');
        node.draggable = true;
        return value;
      })()
      : await askName(text.renameFolder, folder.name);
    if (!name || name === folder.name) { renderSidebar(); focusFolder(folder.id); return; }
    const response = await sendRuntime(port, 'collection-update', { id: folder.id, name });
    say(response?.ok ? text.folderRenamed : text.notSaved);
    await load();
    focusFolder(folder.id);
  };

  const useAsBar = async (folder: Collection) => {
    const response = await sendRuntime(port, 'set-toolbar', { id: folder.id });
    say(response?.ok ? text.barChanged : text.notSaved);
    await load();
  };

  const deleteFolder = async (folder: Collection) => {
    if (isLockedFolder(folder)) { say(text.deleteBarBlocked); return; }
    const footprint = folderFootprint(bookmarks, collections, folder.id);
    const count = footprint.bookmarkIds.length;
    let trashBookmarks = false;
    if (count || footprint.subfolders) {
      const answer = await decide(fill(text.deleteFolderHelp, { bookmarks: count, folders: footprint.subfolders, bs: count === 1 ? '' : 's', fs: footprint.subfolders === 1 ? '' : 's' }), {
        title: fill(text.confirmDeleteFolderTitle, { v: folder.name }),
        confirm: text.deleteFolderKeep,
        alt: count ? text.deleteFolderAll : undefined,
      });
      if (answer === 'cancel') return;
      trashBookmarks = answer === 'alt';
    }
    const response = await sendRuntime(port, 'collection-delete', { id: folder.id });
    if (!response?.ok) { say(text.notSaved); await load(); return; }
    const ids: string[] = Array.isArray(response.ids) ? response.ids : [folder.id];
    if (trashBookmarks) {
      await sendRuntime(port, 'delete', { ids: footprint.bookmarkIds });
      showUndo(fillCount(text.folderTrashed, count), async () => {
        await sendRuntime(port, 'restore', { ids: footprint.bookmarkIds });
        return sendRuntime(port, 'collection-restore', { ids });
      });
    } else showUndo(text.folderDeleted, () => sendRuntime(port, 'collection-restore', { ids }));
    await load();
  };

  /** Put a folder somewhere else, and remember where it was so the move can be taken back. */
  const placeFolder = async (id: string, parentId: string | undefined, beforeId?: string) => {
    const folder = folderById(id);
    if (!folder || (beforeId === id) || (parentId !== undefined && folderDescendants(collections, id).has(parentId))) return;
    const siblings = collections.filter((item) => !item.deletedAt && item.parentId === folder.parentId).sort((left, right) => left.position - right.position);
    const oldBefore = siblings[siblings.findIndex((item) => item.id === id) + 1]?.id;
    const oldParent = folder.parentId;
    const response = await sendRuntime(port, 'reorder', { kind: 'folder', id, parentId, beforeId });
    if (response?.ok === false || !response) say(text.notSaved);
    else {
      if (parentId && collapsed.delete(parentId)) writeJson(COLLAPSED_KEY, [...collapsed]);
      showUndo(text.folderMoved, () => sendRuntime(port, 'reorder', { kind: 'folder', id, parentId: oldParent, beforeId: oldBefore }));
    }
    await load();
  };

  // ── Move picker ──
  type PickRow = { value: string; label: string; detail?: string; icon: UiIconName; create?: string };
  /** A list that answers to typing, because a <select> stops being usable around the fiftieth folder. */
  const pickFolder = (title: string, base: PickRow[], folders: readonly Collection[]) => new Promise<string | undefined>((resolve) => {
    const dialog = get<HTMLDialogElement>('#move-dialog');
    const heading = get('#move-heading');
    const input = get<HTMLInputElement>('#move-search');
    const list = get('#move-list');
    if (!dialog || !input || !list) { resolve(undefined); return; }
    if (heading) heading.textContent = title;
    const pathsNow = folderPaths(collections);
    const sorted = [...folders].sort((left, right) => (pathsNow.get(left.id) ?? '').localeCompare(pathsNow.get(right.id) ?? ''));
    const everything: PickRow[] = [...base, ...sorted.map((folder) => ({ value: folder.id, label: folder.name, detail: pathsNow.get(folder.id) === folder.name ? undefined : pathsNow.get(folder.id), icon: 'folder' as const }))];
    let rows: PickRow[] = [];
    let active = 0;
    const paint = () => {
      const query = input.value.trim().toLowerCase();
      rows = everything.filter((row) => `${row.label} ${row.detail ?? ''}`.toLowerCase().includes(query));
      if (query && !everything.some((row) => row.label.toLowerCase() === query)) rows.push({ value: '', label: fill(text.createNamed, { v: input.value.trim() }), icon: 'folderPlus', create: input.value.trim() });
      active = Math.min(active, Math.max(rows.length - 1, 0));
      list.innerHTML = rows.length ? rows.map((row, index) => `<button type="button" role="option" class="pick-row" data-pick="${index}" aria-selected="${index === active}" tabindex="-1">${uiIcon(row.icon)}<span class="pick-text"><span>${escapeHtml(row.label)}</span>${row.detail ? `<small>${escapeHtml(row.detail)}</small>` : ''}</span></button>`).join('') : `<p class="pick-empty">${escapeHtml(text.noFoldersFound)}</p>`;
      list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    };
    const finish = (value: string | undefined) => {
      dialog.close();
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKey);
      list.removeEventListener('click', onClick);
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('click', onBackdrop);
      resolve(value);
    };
    const choose = async (row: PickRow | undefined) => {
      if (!row) return;
      if (row.create === undefined) { finish(row.value); return; }
      const response = await sendRuntime(port, 'collection-create', { name: row.create });
      finish(response?.item?.id);
    };
    const onInput = () => { active = 0; paint(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (rows.length) active = (active + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        paint();
      }
      if (event.key === 'Enter') { event.preventDefault(); void choose(rows[active]); }
    };
    const onClick = (event: Event) => {
      const index = (event.target as HTMLElement).closest<HTMLElement>('[data-pick]')?.dataset.pick;
      if (index !== undefined) void choose(rows[Number(index)]);
    };
    const onCancel = () => finish(undefined);
    const onBackdrop = (event: Event) => { if (event.target === dialog) finish(undefined); };
    input.value = '';
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    list.addEventListener('click', onClick);
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('click', onBackdrop);
    paint();
    dialog.showModal();
    input.focus();
  });

  const moveSelection = async (ids: string[]) => {
    if (!ids.length) return;
    const target = await pickFolder(fillCount(text.moveBookmarksTitle, ids.length), [{ value: UNFILED_TARGET, label: text.unfiled, icon: 'inbox' }], moveTargets(collections, undefined));
    if (!target) return;
    await load();
    await moveIds(ids, target);
  };

  const moveFolder = async (folder: Collection) => {
    const target = await pickFolder(fill(text.moveFolderTitle, { v: folder.name }), [{ value: TOP_TARGET, label: text.topLevelFolder, icon: 'layers' }], moveTargets(collections, folder.id));
    if (!target) return;
    await load();
    await placeFolder(folder.id, target === TOP_TARGET ? undefined : target);
  };

  // ── Menus ──
  const pointOf = (element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    return { x: box.left, y: box.bottom + 4 };
  };

  const folderEntries = (folder: Collection): MenuEntry[] => {
    const locked = isLockedFolder(folder);
    const inside = liveBookmarks(bookmarks).filter((bookmark) => bookmark.collectionId === folder.id).map((bookmark) => bookmark.id);
    return [
      { id: 'open', label: text.open, icon: 'folderOpen', run: () => setScope({ kind: 'folder', id: folder.id }) },
      { id: 'open-all', label: fill(text.openAllInFolder, { n: inside.length }), icon: 'external', disabled: !inside.length, run: () => openIds(inside) },
      'separator',
      { id: 'new-subfolder', label: text.newSubfolder, icon: 'folderPlus', run: () => createFolder(folder.id) },
      { id: 'rename', label: text.renameFolder, icon: 'pencil', hint: 'F2', run: () => renameFolder(folder) },
      { id: 'move', label: text.moveTo, icon: 'move', disabled: locked, run: () => moveFolder(folder) },
      { id: 'use-as-bar', label: folder.toolbar ? text.barFolderLocked : text.useAsBar, icon: 'bookmark', disabled: folder.toolbar, run: () => useAsBar(folder) },
      'separator',
      { id: 'delete', label: text.deleteFolder, icon: 'trash', danger: true, disabled: locked, hint: 'Del', run: () => deleteFolder(folder) },
    ];
  };

  const openFolderMenu = (id: string, origin: HTMLElement, point = pointOf(origin)) => {
    const folder = folderById(id);
    if (folder) menu.open(point, folderEntries(folder), text.folderMenu, origin);
  };

  const treeEntries = (): MenuEntry[] => [
    { id: 'new-folder', label: text.newFolderHere, icon: 'folderPlus', run: () => createFolder() },
    'separator',
    { id: 'expand', label: text.expandAll, icon: 'expand', disabled: !collapsed.size, run: () => { collapsed.clear(); writeJson(COLLAPSED_KEY, []); renderSidebar(); } },
    { id: 'collapse', label: text.collapseAll, icon: 'collapse', run: () => {
      collections.filter((item) => !item.deletedAt && item.parentId).forEach((item) => { if (item.parentId) collapsed.add(item.parentId); });
      writeJson(COLLAPSED_KEY, [...collapsed]);
      renderSidebar();
    } },
  ];

  const bookmarkEntries = (bookmark: Bookmark): MenuEntry[] => {
    const openable = isHttpUrl(bookmark.url);
    const copy: MenuEntry = { id: 'copy', label: text.copyLink, icon: 'link', run: async () => { await navigator.clipboard?.writeText(bookmark.url); say(text.linkCopied); } };
    if (bookmark.deletedAt) return [{ id: 'restore', label: text.restore, icon: 'undo', run: () => restoreIds([bookmark.id]) }, copy];
    return [
      { id: 'open', label: text.openInTab, icon: 'external', disabled: !openable, run: () => { void sendRuntime(port, 'open-existing', { url: bookmark.url }); } },
      copy,
      'separator',
      { id: 'edit', label: text.edit, icon: 'pencil', hint: 'E', run: () => { setCursor(bookmark.id, false); return switchEditor(bookmark.id); } },
      { id: 'favorite', label: bookmark.favorite ? text.unfavorite : text.favorite, icon: 'star', hint: 'F', run: async () => { await sendRuntime(port, 'favorite', { id: bookmark.id, favorite: !bookmark.favorite }); await load(); } },
      { id: 'move', label: text.moveTo, icon: 'move', run: () => moveSelection([bookmark.id]) },
      'separator',
      { id: 'delete', label: text.delete, icon: 'trash', danger: true, hint: 'Del', run: () => deleteIds([bookmark.id]) },
    ];
  };

  const selectionEntries = (): MenuEntry[] => {
    if (scope.kind === 'trash') return [{ id: 'restore', label: text.restore, icon: 'undo', run: () => restoreIds([...selection]) }];
    return [
      { id: 'open', label: text.openSelected, icon: 'external', run: () => openIds([...selection]) },
      { id: 'move', label: text.moveTo, icon: 'move', run: () => moveSelection([...selection]) },
      { id: 'tags', label: text.tagSelected, icon: 'tag', run: openTagDialog },
      'separator',
      { id: 'delete', label: text.deleteSelected, icon: 'trash', danger: true, run: () => deleteIds([...selection]) },
    ];
  };

  const openBookmarkMenu = (id: string, origin: HTMLElement, point = pointOf(origin)) => {
    const bookmark = bookmarks.find((item) => item.id === id);
    if (!bookmark) return;
    const many = selection.has(id) && selection.size > 1;
    menu.open(point, many ? selectionEntries() : bookmarkEntries(bookmark), text.bookmarkMenu, origin);
  };

  const renameTag = async (tag: string) => {
    const next = parseTags(await askName(text.renameTag, tag) ?? '')[0];
    if (!next || next === tag) return;
    await editTags(liveBookmarks(bookmarks).filter((bookmark) => bookmark.tags.includes(tag)).map((bookmark) => bookmark.id), [next], [tag]);
    if (scope.kind === 'tag') setScope({ kind: 'tag', tag: next });
  };
  const deleteTag = async (tag: string) => {
    await editTags(liveBookmarks(bookmarks).filter((bookmark) => bookmark.tags.includes(tag)).map((bookmark) => bookmark.id), [], [tag]);
    if (scope.kind === 'tag') setScope({ kind: 'all' });
  };
  const tagEntries = (tag: string): MenuEntry[] => [
    { id: 'open', label: text.open, icon: 'tag', run: () => setScope({ kind: 'tag', tag }) },
    { id: 'rename', label: text.renameTag, icon: 'pencil', run: () => renameTag(tag) },
    'separator',
    { id: 'delete', label: text.deleteTag, icon: 'trash', danger: true, run: () => deleteTag(tag) },
  ];

  // Right click, the Menu key and Shift+F10 all arrive here. Fields keep the browser's menu for paste and spelling.
  root.addEventListener('contextmenu', (event) => {
    const mouse = event as MouseEvent;
    const target = mouse.target as HTMLElement;
    if (get('dialog[open]') || isTyping(target)) return;
    const box = target.getBoundingClientRect();
    const point = mouse.clientX || mouse.clientY ? { x: mouse.clientX, y: mouse.clientY } : { x: box.left, y: box.bottom };
    const folderId = target.closest<HTMLElement>('[data-folder-node]')?.dataset.folderNode ?? target.closest<HTMLElement>('.subfolder[data-select-folder]')?.dataset.selectFolder;
    if (folderId) { event.preventDefault(); openFolderMenu(folderId, target, point); return; }
    if (target.closest('#side-folders')) { event.preventDefault(); menu.open(point, treeEntries(), text.folderActions, target); return; }
    const tag = target.closest<HTMLElement>('[data-select-tag]')?.dataset.selectTag;
    if (tag) { event.preventDefault(); menu.open(point, tagEntries(tag), text.tagMenu, target); return; }
    const card = target.closest<HTMLElement>('[data-bookmark-id]');
    if (card?.dataset.bookmarkId) { event.preventDefault(); openBookmarkMenu(card.dataset.bookmarkId, card, point); }
  });

  /** Tree keys. Returns true when the key was for the tree. */
  const treeKey = (key: KeyboardEvent, target: HTMLElement): boolean => {
    const id = target.dataset.selectFolder ?? '';
    const folder = folderById(id);
    if (!folder) return false;
    const buttons = [...root.querySelectorAll<HTMLElement>('#folder-tree .tree-button')];
    const index = buttons.indexOf(target);
    if (key.key === 'ArrowDown' || key.key === 'ArrowUp') {
      key.preventDefault();
      buttons[index + (key.key === 'ArrowDown' ? 1 : -1)]?.focus();
      return true;
    }
    if (key.key === 'ArrowLeft' || key.key === 'ArrowRight') {
      const hasChildren = collections.some((item) => !item.deletedAt && item.parentId === id);
      if (!hasChildren) return false;
      key.preventDefault();
      if (key.key === 'ArrowLeft') collapsed.add(id);
      else collapsed.delete(id);
      writeJson(COLLAPSED_KEY, [...collapsed]);
      renderSidebar();
      focusFolder(id);
      return true;
    }
    if (key.key === 'F2') { key.preventDefault(); void renameFolder(folder); return true; }
    if (key.key === 'Delete' || key.key === 'Backspace') { key.preventDefault(); void deleteFolder(folder); return true; }
    return false;
  };

  get('#show-new-folder')?.addEventListener('click', () => { void createFolder(); });
  get('#scope-more')?.addEventListener('click', () => {
    const button = get('#scope-more');
    if (!button) return;
    const current: LibraryScope = scope;
    if (current.kind === 'folder') openFolderMenu(current.id, button);
    if (current.kind === 'tag') menu.open(pointOf(button), tagEntries(current.tag), text.tagMenu, button);
  });
  get('#tags-toggle')?.addEventListener('click', () => { tagsExpanded = !tagsExpanded; renderSidebar(); });
  get('#toggle-theme')?.addEventListener('click', toggleTheme);

  // ── New bookmark ──
  const openAdd = (url = '') => {
    const here: LibraryScope = scope;
    const folder = get<HTMLSelectElement>('#add-folder');
    if (folder) folder.innerHTML = `<option value="">${escapeHtml(text.unfiled)}</option>${collectionOptions(collections, here.kind === 'folder' ? here.id : '', language)}`;
    const form = get<HTMLFormElement>('#add-form');
    const field = get<HTMLInputElement>('#add-url');
    if (field) field.value = url;
    for (const id of ['#add-title', '#add-tags']) { const input = get<HTMLInputElement>(id); if (input) input.value = ''; }
    const error = get('#add-error');
    if (error) error.textContent = '';
    if (!form) return;
    openDialog('#add-dialog');
    (url ? get('#add-title') : field)?.focus();
  };
  get('#add-bookmark')?.addEventListener('click', () => openAdd());
  get('#add-cancel')?.addEventListener('click', () => get<HTMLDialogElement>('#add-dialog')?.close());
  get('#add-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = get('#add-error');
    const url = typedUrl(get<HTMLInputElement>('#add-url')?.value ?? '');
    if (!isHttpUrl(url)) { if (error) error.textContent = text.invalidUrl; return; }
    const response = await sendRuntime(port, 'add', {
      url,
      title: get<HTMLInputElement>('#add-title')?.value.trim() || undefined,
      tags: parseTags(get<HTMLInputElement>('#add-tags')?.value ?? ''),
      collectionId: get<HTMLSelectElement>('#add-folder')?.value || undefined,
    });
    if (!response?.ok) { if (error) error.textContent = text.invalidUrl; return; }
    if (response.result?.kind === 'existing') { if (error) error.textContent = text.alreadyInLibrary; return; }
    get<HTMLDialogElement>('#add-dialog')?.close();
    const id = response.result?.bookmark?.id as string | undefined;
    if (id) showUndo(text.addedBookmark, () => sendRuntime(port, 'delete', { ids: [id] }));
    await load();
  });
  // Pasting an address anywhere on the page starts a new bookmark with it.
  root.addEventListener('paste', (event) => {
    if (get('dialog[open]') || isTyping(event.target)) return;
    const value = (event as ClipboardEvent).clipboardData?.getData('text/plain').trim() ?? '';
    if (/^https?:\/\/\S+$/i.test(value)) { event.preventDefault(); openAdd(value); }
  });

  // ── Command palette ──
  let paletteHits: PaletteHit[] = [];
  let paletteActive = 0;
  const paletteCommands: Array<{ id: string; label: string; icon: UiIconName; run: () => void | Promise<void> }> = [
    { id: 'new-bookmark', label: text.addBookmark, icon: 'bookmarkPlus', run: () => openAdd() },
    { id: 'new-folder', label: text.newFolderHere, icon: 'folderPlus', run: () => createFolder() },
    { id: 'theme', label: text.commandTheme, icon: 'moon', run: toggleTheme },
    { id: 'shortcuts', label: text.shortcuts, icon: 'keyboard', run: () => { openDialog('#shortcut-dialog'); } },
    { id: 'home', label: text.home, icon: 'home', run: () => { location.href = 'home.html'; } },
    { id: 'settings', label: text.settings, icon: 'settings', run: () => { location.href = 'settings.html'; } },
  ];
  const paletteSource = () => ({
    bookmarks,
    collections,
    commands: paletteCommands,
    scopes: [
      { scope: { kind: 'all' } as LibraryScope, label: text.allBookmarks },
      { scope: { kind: 'favorites' } as LibraryScope, label: text.favorites },
      { scope: { kind: 'recent' } as LibraryScope, label: text.recent },
      { scope: { kind: 'unfiled' } as LibraryScope, label: text.unfiled },
      { scope: { kind: 'duplicates' } as LibraryScope, label: text.duplicates },
      { scope: { kind: 'trash' } as LibraryScope, label: text.trash },
    ],
  });
  const groupOf = (hit: PaletteHit) => ({ scope: text.groupGo, folder: text.groupFolders, tag: text.groupTags, bookmark: text.groupBookmarks, command: text.groupCommands })[hit.kind];
  const paletteRow = (hit: PaletteHit, index: number) => {
    const option = (icon: string, label: string, detail = '') => `<button type="button" role="option" class="pick-row" id="palette-${index}" data-hit="${index}" aria-selected="${index === paletteActive}" tabindex="-1">${icon}<span class="pick-text"><span>${escapeHtml(label)}</span>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</span></button>`;
    if (hit.kind === 'bookmark') return option(siteIcon(hit.bookmark.url, hit.bookmark.title, hit.bookmark.domain, hit.bookmark.faviconUrl), hit.bookmark.title, hit.bookmark.domain);
    if (hit.kind === 'folder') return option(uiIcon('folder'), hit.label, hit.detail);
    if (hit.kind === 'tag') return option(uiIcon('tag'), `#${hit.label}`, bookmarkCountLabel(hit.count, language));
    if (hit.kind === 'scope') return option(uiIcon('layers'), hit.label);
    return option(uiIcon(paletteCommands.find((item) => item.id === hit.id)?.icon ?? 'command'), hit.label);
  };
  const paintPalette = () => {
    const list = get('#palette-list');
    if (!list) return;
    paletteHits = paletteResults(get<HTMLInputElement>('#palette-input')?.value ?? '', paletteSource());
    paletteActive = Math.min(paletteActive, Math.max(paletteHits.length - 1, 0));
    let group = '';
    list.innerHTML = paletteHits.map((hit, index) => {
      const next = groupOf(hit);
      const head = next === group ? '' : `<p class="pick-group">${escapeHtml(next)}</p>`;
      group = next;
      return head + paletteRow(hit, index);
    }).join('') || `<p class="pick-empty">${escapeHtml(text.commandNone)}</p>`;
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };
  const closePalette = () => get<HTMLDialogElement>('#palette')?.close();
  const runHit = async (hit: PaletteHit | undefined) => {
    if (!hit) return;
    closePalette();
    if (hit.kind === 'scope') setScope(hit.scope);
    else if (hit.kind === 'folder') setScope({ kind: 'folder', id: hit.id });
    else if (hit.kind === 'tag') setScope({ kind: 'tag', tag: hit.tag });
    else if (hit.kind === 'command') await paletteCommands.find((item) => item.id === hit.id)?.run();
    else if (isHttpUrl(hit.bookmark.url)) await sendRuntime(port, 'open-existing', { url: hit.bookmark.url });
  };
  const openPalette = () => {
    const input = get<HTMLInputElement>('#palette-input');
    if (!input) return;
    input.value = '';
    paletteActive = 0;
    paintPalette();
    openDialog('#palette');
    input.focus();
  };
  get('#open-palette')?.addEventListener('click', openPalette);
  get('#palette-input')?.addEventListener('input', () => { paletteActive = 0; paintPalette(); });
  get('#palette-input')?.addEventListener('keydown', (event) => {
    const key = event as KeyboardEvent;
    if (key.isComposing) return;
    if (key.key === 'ArrowDown' || key.key === 'ArrowUp') {
      key.preventDefault();
      if (paletteHits.length) paletteActive = (paletteActive + (key.key === 'ArrowDown' ? 1 : -1) + paletteHits.length) % paletteHits.length;
      paintPalette();
    }
    if (key.key === 'Enter') { key.preventDefault(); void runHit(paletteHits[paletteActive]); }
  });
  get('#palette-list')?.addEventListener('click', (event) => {
    const index = (event.target as HTMLElement).closest<HTMLElement>('[data-hit]')?.dataset.hit;
    if (index !== undefined) void runHit(paletteHits[Number(index)]);
  });
  get('#palette')?.addEventListener('click', (event) => { if (event.target === get('#palette')) closePalette(); });

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
      if (document.visibilityState === 'visible' && loaded && !editingId && !inlineEditing) void load();
    });
  }
  void load();
}

export { libraryDocument };
