import { popupDocument, collectionOptions, type RuntimeAction, type RuntimeMessage } from '../ui/index';
import { copyFor, detectUiLanguage } from '../ui/copy';
import { titleInitial } from '../ui/bar';
import { escapeHtml } from '../ui/html';
import { bindIconFallback } from '../ui/icons';

export interface RuntimePort {
  sendMessage(message: RuntimeMessage): Promise<unknown> | unknown;
}

function globalRuntime(): RuntimePort {
  const scope = globalThis as { browser?: { runtime?: RuntimePort }; chrome?: { runtime?: RuntimePort } };
  const runtime = scope.browser?.runtime ?? scope.chrome?.runtime;
  if (!runtime?.sendMessage) throw new Error('WebExtension runtime is unavailable');
  return runtime;
}

export async function sendRuntime(port: RuntimePort, action: RuntimeAction, payload?: unknown): Promise<any> {
  return await port.sendMessage(popupRuntimeMessage(action, payload));
}

export function popupRuntimeMessage(action: RuntimeAction, payload?: unknown): RuntimeMessage {
  const runtimeTypes: Record<RuntimeAction, RuntimeMessage['type']> = {
    save: 'lumamark-save', undo: 'lumamark-undo', 'open-library': 'lumamark-open-library', 'open-home': 'lumamark-open-home', 'open-existing': 'lumamark-open-existing',
    capture: 'lumamark-capture', list: 'lumamark-list', 'list-collections': 'lumamark-list-collections',
    'update-existing': 'lumamark-update-existing', 'copy-existing': 'lumamark-copy-existing',
    update: 'lumamark-update', delete: 'lumamark-delete', restore: 'lumamark-restore',
    favorite: 'lumamark-favorite', sync: 'lumamark-sync', 'sync-configure': 'lumamark-sync-configure',
    export: 'lumamark-export', import: 'lumamark-import', 'list-conflicts': 'lumamark-list-conflicts',
    'resolve-conflict': 'lumamark-resolve-conflict', 'collection-create': 'lumamark-collection-create',
    'collection-delete': 'lumamark-collection-delete', 'collection-restore': 'lumamark-collection-restore',
    'sync-status': 'lumamark-sync-status', reorder: 'lumamark-reorder', 'set-toolbar': 'lumamark-set-toolbar',
    'get-search-engine': 'lumamark-get-search-engine', 'set-search-engine': 'lumamark-set-search-engine',
    'get-sync-config': 'lumamark-get-sync-config', 'set-auto-sync': 'lumamark-set-auto-sync',
  };
  return { type: runtimeTypes[action], ...(payload === undefined ? {} : { payload }) };
}

export function popupStatus(kind: 'saving' | 'saved' | 'existing' | 'error' | 'undone', detail = ''): string {
  const messages = {
    saving: 'Saving current page…', saved: 'Saved locally.', existing: 'This URL is already saved.',
    error: 'Unable to save. Your local data is unchanged.', undone: 'Save undone.',
  } as const;
  return detail ? `${messages[kind]} ${detail}` : messages[kind];
}

/** Bind the save card to the background. Tags and notes stay behind More. */
export function mountPopup(root: ParentNode = document, port: RuntimePort = globalRuntime()): void {
  const text = copyFor(detectUiLanguage());
  const status = root.querySelector<HTMLElement>('#status');
  const saveButton = root.querySelector<HTMLButtonElement>('#save');
  const existingActions = root.querySelector<HTMLElement>('#existing-actions');
  const savedEditor = root.querySelector<HTMLElement>('#saved-editor');
  const unsavable = root.querySelector<HTMLElement>('#unsavable');
  const undo = root.querySelector<HTMLButtonElement>('#undo');
  const setStatus = (value: string) => { if (status) status.textContent = value; };
  let savedId: string | undefined;
  let pageUrl = '';

  const extras = () => ({
    tags: (root.querySelector<HTMLInputElement>('#save-tags')?.value ?? '').split(',').map((tag) => tag.trim()).filter(Boolean),
    notes: root.querySelector<HTMLTextAreaElement>('#save-notes')?.value ?? '',
  });

  const showPreview = (page: { url?: string; title?: string; faviconUrl?: string }) => {
    pageUrl = page.url ?? '';
    const title = root.querySelector<HTMLElement>('#page-title');
    const url = root.querySelector<HTMLElement>('#page-url');
    const icon = root.querySelector<HTMLImageElement>('#page-icon');
    const fallback = root.querySelector<HTMLElement>('#page-fallback');
    if (title) title.textContent = page.title || page.url || '';
    if (url) url.textContent = page.url || '';
    const initial = titleInitial(page.title || page.url || '');
    if (fallback) { fallback.textContent = initial; fallback.hidden = Boolean(page.faviconUrl); }
    if (icon) {
      if (page.faviconUrl) { icon.hidden = false; icon.src = page.faviconUrl; }
      else icon.hidden = true;
    }
    bindIconFallback(root);
  };

  const loadFolders = async (selected = '') => {
    const select = root.querySelector<HTMLSelectElement>('#edit-folder');
    if (!select) return;
    try {
      const response = await sendRuntime(port, 'list-collections');
      const items = Array.isArray(response?.items) ? response.items : [];
      select.innerHTML = `<option value="">${escapeHtml(text.topLevel)}</option>${collectionOptions(items, selected, detectUiLanguage())}`;
    } catch { /* the folder list is optional until the background answers */ }
  };

  const showSaved = async (bookmark: { id?: string; title?: string; collectionId?: string }) => {
    savedId = bookmark.id;
    if (savedEditor) savedEditor.hidden = false;
    if (undo) undo.disabled = false;
    if (saveButton) saveButton.hidden = true;
    if (existingActions) existingActions.hidden = true;
    const titleInput = root.querySelector<HTMLInputElement>('#edit-title');
    if (titleInput) titleInput.value = bookmark.title ?? '';
    await loadFolders(bookmark.collectionId ?? '');
  };

  const refresh = async () => {
    try {
      const response = await sendRuntime(port, 'capture');
      const savable = Boolean(response?.savable);
      showPreview(response?.page ?? {});
      if (unsavable) unsavable.hidden = savable;
      const existing = response?.existing;
      if (existingActions) existingActions.hidden = !existing;
      if (saveButton) saveButton.hidden = !savable || Boolean(existing);
      if (!existing && savedEditor && !savedId) savedEditor.hidden = true;
      if (!savable) setStatus(text.cannotSave);
    } catch {
      if (unsavable) unsavable.hidden = false;
      if (saveButton) saveButton.hidden = true;
      setStatus(text.cannotSave);
    }
  };

  saveButton?.addEventListener('click', async () => {
    setStatus(text.saving);
    try {
      const response = await sendRuntime(port, 'save', extras());
      if (response?.unsavable) { setStatus(text.cannotSave); return; }
      if (!response?.ok) { setStatus(text.notSaved); return; }
      const outcome = response.result;
      if (outcome?.kind === 'existing') {
        if (existingActions) existingActions.hidden = false;
        if (saveButton) saveButton.hidden = true;
        setStatus(text.alreadySaved);
        return;
      }
      await showSaved(outcome?.bookmark ?? {});
      setStatus(text.saved);
    } catch {
      setStatus(text.notSaved);
    }
  });

  root.querySelector<HTMLButtonElement>('#save-edits')?.addEventListener('click', async () => {
    if (!savedId) return;
    const title = root.querySelector<HTMLInputElement>('#edit-title')?.value ?? '';
    const folder = root.querySelector<HTMLSelectElement>('#edit-folder')?.value ?? '';
    try {
      const response = await sendRuntime(port, 'update', { id: savedId, update: { title, collectionId: folder || null } });
      setStatus(response?.ok ? text.saved : text.notSaved);
    } catch {
      setStatus(text.notSaved);
    }
  });

  root.querySelector<HTMLButtonElement>('#delete-saved')?.addEventListener('click', async () => {
    if (!savedId) return;
    const response = await sendRuntime(port, 'delete', { id: savedId });
    if (!response?.ok) { setStatus(text.notSaved); return; }
    if (undo) undo.disabled = false;
    setStatus(text.deletedUndo);
  });

  undo?.addEventListener('click', async () => {
    await sendRuntime(port, 'undo');
    if (undo) undo.disabled = true;
    savedId = undefined;
    if (savedEditor) savedEditor.hidden = true;
    setStatus(text.undone);
    await refresh();
  });

  root.querySelector<HTMLButtonElement>('#open-existing')?.addEventListener('click', () => {
    void sendRuntime(port, 'open-existing', { url: pageUrl });
  });
  root.querySelector<HTMLButtonElement>('#update-existing')?.addEventListener('click', async () => {
    const response = await sendRuntime(port, 'update-existing', extras());
    setStatus(response?.ok ? text.saved : text.notSaved);
  });
  root.querySelector<HTMLButtonElement>('#copy-existing')?.addEventListener('click', async () => {
    const response = await sendRuntime(port, 'copy-existing', extras());
    if (response?.ok && response.result?.bookmark) await showSaved(response.result.bookmark);
    setStatus(response?.ok ? text.saved : text.notSaved);
  });
  root.querySelector<HTMLAnchorElement>('#open-home')?.addEventListener('click', (event) => {
    event.preventDefault();
    void sendRuntime(port, 'open-home');
  });
  root.querySelector<HTMLAnchorElement>('#open-library')?.addEventListener('click', (event) => {
    event.preventDefault();
    void sendRuntime(port, 'open-library');
  });
  void refresh();
}

export { popupDocument };
