import type { Bookmark, Collection } from '../../../../packages/domain/src/index';
import { defaultLibraryFilters, filterBookmarks, libraryDocument, renderBookmarkCard, renderEmptyState, type LibraryFilters, viewClass } from '../ui/index';
import { sendRuntime, type RuntimePort } from './popup';

export interface LibraryRenderState { bookmarks: Bookmark[]; collections: Collection[]; filters: LibraryFilters }

export function renderLibrary(state: LibraryRenderState): string {
  const filtered = filterBookmarks(state.bookmarks, state.filters);
  const body = filtered.length ? filtered.map(renderBookmarkCard).join('') : renderEmptyState(state.filters);
  return `<section id="results" class="${viewClass(state.filters.view)}" aria-live="polite">${body}</section>`;
}

export function initialLibraryState(bookmarks: Bookmark[] = [], collections: Collection[] = []): LibraryRenderState {
  return { bookmarks, collections, filters: defaultLibraryFilters() };
}

/** Mount the full library page; all mutations go through the background runtime. */
export function mountLibrary(root: ParentNode = document, port: RuntimePort = (globalThis as any).browser?.runtime ?? (globalThis as any).chrome?.runtime): void {
  let state = initialLibraryState();
  const results = () => root.querySelector<HTMLElement>('#results');
  const status = () => root.querySelector<HTMLElement>('#sync-status');
  const render = () => {
    const target = results(); if (!target) return;
    const filtered = filterBookmarks(state.bookmarks, state.filters);
    target.className = viewClass(state.filters.view); target.innerHTML = filtered.length ? filtered.map(renderBookmarkCard).join('') : renderEmptyState(state.filters);
  };
  const load = async () => {
    const target = results(); if (target) target.innerHTML = '<p class="loading-state" role="status">Loading bookmarks…</p>';
    try {
      const response = await sendRuntime(port, 'list', { includeDeleted: true });
      state.bookmarks = Array.isArray(response?.items) ? response.items : [];
      try {
        const collections = await sendRuntime(port, 'list-collections');
        state.collections = Array.isArray(collections?.items) ? collections.items : state.collections;
        const select = root.querySelector<HTMLSelectElement>('#collection');
        const options = state.collections.filter((item) => !item.deletedAt).map((item) => `<option value="${item.id}">${item.name}</option>`).join('');
        if (select) select.innerHTML = '<option value="">All collections</option>' + options;
        const batchSelect = root.querySelector<HTMLSelectElement>('#batch-collection'); if (batchSelect) batchSelect.innerHTML = '<option value="">Choose collection</option>' + options;
      } catch { /* old background versions may not expose collections */ }
      render();
    } catch (error) { if (status()) status()!.textContent = `Unable to load bookmarks. ${String(error)}`; }
  };
  const form = root.querySelector<HTMLFormElement>('#filters');
  form?.addEventListener('input', () => {
    const data = new FormData(form);
    state.filters = { ...state.filters, text: String(data.get('text') ?? ''), collectionId: String(data.get('collectionId') ?? ''), tag: String(data.get('tag') ?? ''), domain: String(data.get('domain') ?? ''), from: String(data.get('from') ?? ''), to: String(data.get('to') ?? ''), sort: String(data.get('sort') ?? 'updatedAt') as LibraryFilters['sort'], direction: String(data.get('direction') ?? 'desc') as LibraryFilters['direction'], favoriteOnly: data.has('favoriteOnly') };
    render();
  });
  form?.addEventListener('reset', () => { state.filters = defaultLibraryFilters(); setTimeout(render, 0); });
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.addEventListener('click', () => {
    state.filters.view = button.dataset.view as LibraryFilters['view'];
    root.querySelectorAll('[data-view]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    render();
  }));
  root.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'clear-filters') { form?.reset(); return; }
    const card = target.closest<HTMLElement>('[data-bookmark-id]');
    const id = card?.dataset.bookmarkId;
    if (!action || !id) return;
    try {
      if (action === 'favorite') await sendRuntime(port, 'favorite', { id });
      if (action === 'delete') {
        if (!globalThis.confirm?.('Delete this bookmark? You can undo this action.')) return;
        await sendRuntime(port, 'delete', { id });
        if (status()) {
          status()!.textContent = 'Bookmark deleted. ';
          const undo = document.createElement('button'); undo.type = 'button'; undo.textContent = 'Undo';
          undo.addEventListener('click', async () => { await sendRuntime(port, 'undo'); undo.disabled = true; status()!.textContent = 'Bookmark restored.'; await load(); });
          status()!.append(undo);
        }
      }
      if (action === 'edit') {
        const bookmark = state.bookmarks.find((item) => item.id === id);
        const title = globalThis.prompt?.('Bookmark title', bookmark?.title ?? '');
        if (title !== null && title !== undefined) await sendRuntime(port, 'update', { id, update: { title } });
      }
      await load();
    } catch (error) { if (status()) status()!.textContent = `Unable to update bookmark. ${String(error)}`; }
  });
  root.querySelector<HTMLButtonElement>('#select-all')?.addEventListener('click', () => {
    const boxes = root.querySelectorAll<HTMLInputElement>('[data-select-bookmark]'); const all = [...boxes].every((box) => box.checked); boxes.forEach((box) => { box.checked = !all; });
  });
  root.querySelector<HTMLButtonElement>('#batch-delete')?.addEventListener('click', async () => {
    const ids = [...root.querySelectorAll<HTMLInputElement>('[data-select-bookmark]:checked')].map((box) => box.dataset.selectBookmark).filter(Boolean);
    if (!ids.length || !globalThis.confirm?.(`Delete ${ids.length} selected bookmarks? You can undo this action.`)) return;
    await sendRuntime(port, 'delete', { ids });
    if (status()) { status()!.textContent = `${ids.length} bookmarks deleted. `; const undo = document.createElement('button'); undo.type = 'button'; undo.textContent = 'Undo'; undo.addEventListener('click', async () => { await sendRuntime(port, 'undo'); undo.disabled = true; status()!.textContent = 'Bookmarks restored.'; await load(); }); status()!.append(undo); }
    await load();
  });
  root.querySelector<HTMLButtonElement>('#batch-move')?.addEventListener('click', async () => {
    const ids = [...root.querySelectorAll<HTMLInputElement>('[data-select-bookmark]:checked')].map((box) => box.dataset.selectBookmark).filter(Boolean);
    const collectionId = root.querySelector<HTMLSelectElement>('#batch-collection')?.value ?? ''; if (!collectionId) return;
    if (!ids.length) return;
    await sendRuntime(port, 'update', { ids, update: { collectionId } }); await load();
  });
  root.querySelector<HTMLButtonElement>('#create-collection')?.addEventListener('click', async () => {
    const name = root.querySelector<HTMLInputElement>('#new-collection')?.value.trim(); if (!name) return;
    await sendRuntime(port, 'collection-create', { name }); await load();
  });
  root.querySelector<HTMLButtonElement>('#delete-collection')?.addEventListener('click', async () => {
    const id = root.querySelector<HTMLSelectElement>('#collection')?.value; if (!id || !globalThis.confirm?.('Delete this collection? Bookmarks can be restored.')) return;
    await sendRuntime(port, 'collection-delete', { id }); if (status()) { status()!.textContent = 'Collection deleted. '; const undo = document.createElement('button'); undo.type = 'button'; undo.textContent = 'Undo'; undo.addEventListener('click', async () => { await sendRuntime(port, 'collection-restore', { id }); undo.disabled = true; status()!.textContent = 'Collection restored.'; await load(); }); status()!.append(undo); } await load();
  });
  void load();
}

export { libraryDocument };
