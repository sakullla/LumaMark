import type { Bookmark, Collection } from '../../../../packages/domain/src/index';
import {
  bookmarksInFolder,
  collectionOptions,
  defaultLibraryFilters,
  libraryDocument,
  libraryFailureMessage,
  renderBookmarkCard,
  renderEmptyState,
  renderFolderTree,
  viewClass,
  type LibraryFilters,
} from '../ui/index';
import { copyFor, detectUiLanguage } from '../ui/copy';
import { bindIconFallback } from '../ui/icons';
import { isHttpUrl, nextIndex } from '../ui/bar';
import { chooseTextFile } from './files';
import { sendRuntime, type RuntimePort } from './popup';

export interface LibraryRenderState { bookmarks: Bookmark[]; collections: Collection[]; filters: LibraryFilters; folderId: string | null }

export function renderLibrary(state: LibraryRenderState, language = detectUiLanguage()): string {
  const filtered = bookmarksInFolder(state.bookmarks, state.folderId, state.filters);
  const body = filtered.length ? filtered.map((bookmark) => renderBookmarkCard(bookmark, language)).join('') : renderEmptyState(state.filters, language);
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

/** Mount the library. Decisions stay in the page; nothing calls prompt, confirm, or alert. */
export function mountLibrary(root: PageRoot = document, port: RuntimePort = globalRuntime()): void {
  const language = detectUiLanguage();
  const text = copyFor(language);
  let bookmarks: Bookmark[] = [];
  let collections: Collection[] = [];
  let filters = defaultLibraryFilters();
  let folderId: string | null = null;
  let folderChosen = false;
  let editingId: string | undefined;

  const results = () => root.querySelector<HTMLElement>('#results');
  const status = () => root.querySelector<HTMLElement>('#library-status');
  const selectedIds = () => [...root.querySelectorAll<HTMLInputElement>('[data-select-bookmark]:checked')].map((box) => box.dataset.selectBookmark).filter((id): id is string => Boolean(id));

  const showUndo = (message: string, restore: () => Promise<unknown>) => {
    const target = status();
    if (!target) return;
    target.textContent = `${message} `;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text.undo;
    button.addEventListener('click', async () => {
      button.disabled = true;
      await restore();
      target.textContent = text.restored;
      await load();
    });
    target.append(button);
  };

  const ask = (message: string) => new Promise<boolean>((resolve) => {
    const dialog = root.querySelector<HTMLElement>('#decision');
    const label = root.querySelector<HTMLElement>('#decision-text');
    const yes = root.querySelector<HTMLButtonElement>('#decision-confirm');
    const no = root.querySelector<HTMLButtonElement>('#decision-cancel');
    if (!dialog || !yes || !no) { resolve(false); return; }
    if (label) label.textContent = message;
    dialog.hidden = false;
    const finish = (value: boolean) => {
      dialog.hidden = true;
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      resolve(value);
    };
    const onYes = () => finish(true);
    const onNo = () => finish(false);
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
  });

  const render = () => {
    const tree = root.querySelector<HTMLElement>('#folder-tree');
    if (tree) tree.innerHTML = renderFolderTree(collections, folderId, language);
    const options = collectionOptions(collections, '', language);
    const batchSelect = root.querySelector<HTMLSelectElement>('#batch-collection');
    if (batchSelect) batchSelect.innerHTML = `<option value="">${text.chooseFolder}</option>${options}`;
    const editorSelect = root.querySelector<HTMLSelectElement>('#editor-folder');
    const editorFolder = editorSelect?.value ?? '';
    if (editorSelect) editorSelect.innerHTML = `<option value="">${text.topLevel}</option>${collectionOptions(collections, editorFolder, language)}`;
    const target = results();
    if (!target) return;
    const visible = bookmarksInFolder(bookmarks, folderId, filters);
    target.className = viewClass(filters.view);
    target.innerHTML = visible.length ? visible.map((bookmark) => renderBookmarkCard(bookmark, language)).join('') : renderEmptyState({ ...filters, collectionId: '' }, language);
    bindIconFallback(target);
    const batch = root.querySelector<HTMLElement>('#batch-actions');
    if (batch) batch.hidden = selectedIds().length === 0;
  };

  const load = async () => {
    const target = results();
    try {
      const response = await sendRuntime(port, 'list', { includeDeleted: true });
      if (response?.ok === false) throw new Error(response.error || 'load failed');
      bookmarks = Array.isArray(response?.items) ? response.items : [];
      const collectionsResponse = await sendRuntime(port, 'list-collections');
      if (collectionsResponse?.ok === false) throw new Error(collectionsResponse.error || 'load failed');
      collections = Array.isArray(collectionsResponse?.items) ? collectionsResponse.items : [];
      if (!folderChosen) {
        folderId = collections.find((item) => item.toolbar && !item.deletedAt)?.id ?? null;
        folderChosen = true;
      }
      render();
    } catch {
      if (target) target.innerHTML = libraryFailureMessage(language);
    }
  };

  const form = root.querySelector<HTMLFormElement>('#filters');
  form?.addEventListener('submit', (event) => event.preventDefault());
  form?.addEventListener('input', () => {
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
    render();
  });
  form?.addEventListener('reset', () => {
    filters = { ...defaultLibraryFilters(), view: filters.view };
    setTimeout(render, 0);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.addEventListener('click', () => {
    filters.view = button.dataset.view as LibraryFilters['view'];
    root.querySelectorAll('[data-view]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    render();
  }));

  const openEditor = (id: string) => {
    const bookmark = bookmarks.find((item) => item.id === id);
    const editor = root.querySelector<HTMLFormElement>('#editor');
    if (!bookmark || !editor) return;
    editingId = id;
    editor.hidden = false;
    (editor.elements.namedItem('title') as HTMLInputElement).value = bookmark.title;
    (editor.elements.namedItem('url') as HTMLInputElement).value = bookmark.url;
    (editor.elements.namedItem('tags') as HTMLInputElement).value = bookmark.tags.join(', ');
    (editor.elements.namedItem('notes') as HTMLTextAreaElement).value = bookmark.notes;
    (editor.elements.namedItem('favorite') as HTMLInputElement).checked = bookmark.favorite;
    const folder = editor.elements.namedItem('folder') as HTMLSelectElement;
    folder.innerHTML = `<option value="">${text.topLevel}</option>${collectionOptions(collections, bookmark.collectionId ?? '', language)}`;
    const error = root.querySelector<HTMLElement>('#editor-error');
    if (error) error.textContent = '';
  };

  root.querySelector<HTMLFormElement>('#editor')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!editingId) return;
    const editor = event.currentTarget as HTMLFormElement;
    const url = (editor.elements.namedItem('url') as HTMLInputElement).value;
    const error = root.querySelector<HTMLElement>('#editor-error');
    if (!isHttpUrl(url)) {
      if (error) error.textContent = text.invalidUrl;
      return;
    }
    const response = await sendRuntime(port, 'update', {
      id: editingId,
      update: {
        title: (editor.elements.namedItem('title') as HTMLInputElement).value,
        url,
        collectionId: (editor.elements.namedItem('folder') as HTMLSelectElement).value || null,
        tags: (editor.elements.namedItem('tags') as HTMLInputElement).value.split(',').map((tag) => tag.trim()).filter(Boolean),
        notes: (editor.elements.namedItem('notes') as HTMLTextAreaElement).value,
        favorite: (editor.elements.namedItem('favorite') as HTMLInputElement).checked,
      },
    });
    if (response?.error === 'invalid-url' || response?.ok === false) {
      if (error) error.textContent = response?.error === 'invalid-url' ? text.invalidUrl : text.notSaved;
      await load();
      return;
    }
    editor.hidden = true;
    editingId = undefined;
    await load();
  });
  root.querySelector<HTMLButtonElement>('#editor-cancel')?.addEventListener('click', () => {
    const editor = root.querySelector<HTMLElement>('#editor');
    if (editor) editor.hidden = true;
    editingId = undefined;
  });

  root.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    if (!target.matches('[data-select-bookmark]')) return;
    const batch = root.querySelector<HTMLElement>('#batch-actions');
    if (batch) batch.hidden = selectedIds().length === 0;
  });

  root.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const folderButton = target.closest<HTMLElement>('[data-select-folder]');
    if (folderButton) {
      folderChosen = true;
      folderId = folderButton.dataset.selectFolder || null;
      render();
      return;
    }
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'clear-filters') { form?.reset(); return; }
    if (action === 'save-page') {
      const response = await sendRuntime(port, 'save', {});
      if (status()) status()!.textContent = response?.unsavable ? text.cannotSave : response?.ok ? text.saved : text.notSaved;
      await load();
      return;
    }
    if (action === 'import-html') {
      const rule = root.querySelector<HTMLSelectElement>('#empty-import-action')?.value ?? 'skip';
      const content = await chooseTextFile('.html,text/html');
      if (!content) return;
      const response = await sendRuntime(port, 'import', { format: 'html', content, action: rule });
      if (status()) status()!.textContent = response?.ok ? text.importDone : text.importFailed;
      await load();
      return;
    }
    const card = target.closest<HTMLElement>('[data-bookmark-id]');
    const id = card?.dataset.bookmarkId;
    if (!action || !id) return;
    if (action === 'favorite') {
      const bookmark = bookmarks.find((item) => item.id === id);
      await sendRuntime(port, 'favorite', { id, favorite: !bookmark?.favorite });
      await load();
      return;
    }
    if (action === 'edit') { openEditor(id); return; }
    if (action === 'delete') {
      const accepted = await ask(text.confirmDeleteBookmark);
      if (!accepted) return;
      const response = await sendRuntime(port, 'delete', { ids: [id] });
      if (response?.ok) showUndo(text.deletedUndo, () => sendRuntime(port, 'undo'));
      await load();
    }
  });

  results()?.addEventListener('keydown', (event) => {
    const cards = [...(results()?.querySelectorAll<HTMLElement>('.bookmark-card') ?? [])];
    const current = cards.findIndex((card) => card === document.activeElement || card.contains(document.activeElement));
    if (event.key === 'Enter' && current >= 0 && event.target === cards[current]) {
      cards[current].querySelector<HTMLAnchorElement>('a')?.click();
      return;
    }
    const next = nextIndex(current < 0 ? 0 : current, cards.length, event.key);
    if (next === undefined) return;
    event.preventDefault();
    cards[next]?.focus();
  });

  root.querySelector<HTMLButtonElement>('#batch-delete')?.addEventListener('click', async () => {
    const ids = selectedIds();
    if (!ids.length) return;
    const accepted = await ask(text.confirmDeleteBookmark);
    if (!accepted) return;
    const response = await sendRuntime(port, 'delete', { ids });
    if (response?.ok) showUndo(text.deletedUndo, () => sendRuntime(port, 'undo'));
    await load();
  });
  root.querySelector<HTMLButtonElement>('#batch-move')?.addEventListener('click', async () => {
    const ids = selectedIds();
    const collectionId = root.querySelector<HTMLSelectElement>('#batch-collection')?.value ?? '';
    if (!ids.length || !collectionId) return;
    await sendRuntime(port, 'update', { ids, update: { collectionId } });
    await load();
  });
  root.querySelector<HTMLButtonElement>('#create-collection')?.addEventListener('click', async () => {
    const name = root.querySelector<HTMLInputElement>('#new-collection')?.value.trim();
    if (!name) return;
    await sendRuntime(port, 'collection-create', { name });
    await load();
  });
  root.querySelector<HTMLButtonElement>('#delete-folder')?.addEventListener('click', async () => {
    if (!folderId) return;
    const accepted = await ask(text.confirmDeleteFolder);
    if (!accepted) return;
    const id = folderId;
    const response = await sendRuntime(port, 'collection-delete', { id });
    if (response?.ok) showUndo(text.deletedUndo, () => sendRuntime(port, 'collection-restore', { id }));
    folderId = null;
    await load();
  });
  void load();
}

export { libraryDocument };
