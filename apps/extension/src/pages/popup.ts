import type { Collection } from '../../../../packages/domain/src/index';
import { popupDocument, collectionOptions, type RuntimeAction, type RuntimeMessage } from '../ui/index';
import { copyFor, detectUiLanguage, fill } from '../ui/copy';
import { titleInitial, toolbarFolder } from '../ui/bar';
import { escapeHtml } from '../ui/html';
import { bindIconFallback, uiIcon } from '../ui/icons';
import { folderPaths, parseTags, tagCounts } from '../ui/library-model';

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
    'native-status': 'lumamark-native-status', 'set-native-sync': 'lumamark-set-native-sync',
    'collection-update': 'lumamark-collection-update', add: 'lumamark-add', 'open-settings': 'lumamark-open-settings',
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

const TAG_SUGGESTIONS = 6;
const RECENT_FOLDERS_KEY = 'lumamark-recent-folders';
const RECENT_FOLDERS = 3;

function recentFolders(): string[] {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(RECENT_FOLDERS_KEY) ?? '[]') as unknown;
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

function rememberFolder(id: string | undefined): void {
  if (!id) return;
  try { globalThis.localStorage?.setItem(RECENT_FOLDERS_KEY, JSON.stringify([id, ...recentFolders().filter((item) => item !== id)].slice(0, RECENT_FOLDERS * 2))); } catch { /* a convenience only */ }
}

/** Bind the save card to the background. The folder is one choice away; tags and notes stay behind More. */
export function mountPopup(root: ParentNode = document, port: RuntimePort = globalRuntime()): void {
  const text = copyFor(detectUiLanguage());
  const status = root.querySelector<HTMLElement>('#status');
  const saveButton = root.querySelector<HTMLButtonElement>('#save');
  const existingActions = root.querySelector<HTMLElement>('#existing-actions');
  const savedEditor = root.querySelector<HTMLElement>('#saved-editor');
  const unsavable = root.querySelector<HTMLElement>('#unsavable');
  const undo = root.querySelector<HTMLButtonElement>('#undo');
  const saveHint = root.querySelector<HTMLElement>('#save-hint');
  const more = root.querySelector<HTMLElement>('#more');
  const folderRow = root.querySelector<HTMLElement>('#save-folder-row');
  /** The hint, the folder choice and the tags/notes drawer belong to the save button and follow its visibility. */
  const syncSaveExtras = () => {
    const hidden = !saveButton || saveButton.hidden;
    if (saveHint) saveHint.hidden = hidden;
    if (more) more.hidden = hidden;
    if (folderRow) folderRow.hidden = hidden;
  };
  const setStatus = (value: string) => { if (status) status.textContent = value; };
  const closePopup = () => { if (typeof window !== 'undefined') window.close(); };
  let savedId: string | undefined;
  let undoToken: string | undefined;
  let existingId: string | undefined;
  let collections: Collection[] = [];

  const extras = () => ({
    tags: parseTags(root.querySelector<HTMLInputElement>('#save-tags')?.value ?? ''),
    notes: root.querySelector<HTMLTextAreaElement>('#save-notes')?.value ?? '',
    collectionId: root.querySelector<HTMLSelectElement>('#save-folder')?.value || undefined,
  });

  const showPreview = (page: { url?: string; title?: string; faviconUrl?: string }) => {
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
      collections = Array.isArray(response?.items) ? response.items : [];
      select.innerHTML = `<option value="">${escapeHtml(text.topLevel)}</option>${collectionOptions(collections, selected, detectUiLanguage())}`;
    } catch { /* the folder list is optional until the background answers */ }
  };

  /** Folder choice before saving: starts on the bar folder, which is where a plain save lands. */
  const loadSaveFolders = async () => {
    const select = root.querySelector<HTMLSelectElement>('#save-folder');
    if (!select) return;
    await loadFolders();
    const initial = toolbarFolder(collections)?.id ?? '';
    select.innerHTML = `${initial ? '' : `<option value="">${escapeHtml(text.topLevel)}</option>`}${collectionOptions(collections, initial, detectUiLanguage())}`;
    paintRecentFolders();
    select.addEventListener('change', paintRecentFolders);
  };

  /** The last few folders stay one click away, which beats scrolling a long list on every save. */
  const paintRecentFolders = () => {
    const box = root.querySelector<HTMLElement>('#recent-folders');
    const select = root.querySelector<HTMLSelectElement>('#save-folder');
    if (!box || !select) return;
    const alive = collections.filter((folder) => !folder.deletedAt);
    const folders = recentFolders().map((id) => alive.find((folder) => folder.id === id)).filter((folder): folder is Collection => Boolean(folder)).slice(0, RECENT_FOLDERS);
    box.hidden = !folders.length;
    box.innerHTML = folders.map((folder) => `<button type="button" class="chip" data-recent-folder="${escapeHtml(folder.id)}" aria-pressed="${folder.id === select.value}">${uiIcon('folder')}<span>${escapeHtml(folder.name)}</span></button>`).join('');
  };
  root.querySelector<HTMLElement>('#recent-folders')?.addEventListener('click', (event) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-recent-folder]')?.dataset.recentFolder;
    const select = root.querySelector<HTMLSelectElement>('#save-folder');
    if (!id || !select) return;
    select.value = id;
    paintRecentFolders();
  });

  const addSuggestion = (tag: string) => {
    const input = root.querySelector<HTMLInputElement>('#save-tags');
    if (input) input.value = [...parseTags(input.value), tag].join(', ');
    paintSuggestions();
  };

  let knownTags: string[] = [];
  const paintSuggestions = () => {
    const box = root.querySelector<HTMLElement>('#tag-suggestions');
    if (!box) return;
    const used = new Set(parseTags(root.querySelector<HTMLInputElement>('#save-tags')?.value ?? ''));
    const tags = knownTags.filter((tag) => !used.has(tag)).slice(0, TAG_SUGGESTIONS);
    box.hidden = !tags.length;
    box.innerHTML = tags.map((tag) => `<button type="button" class="chip" data-add-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join('');
  };
  const loadSuggestions = async () => {
    try {
      const response = await sendRuntime(port, 'list', { includeDeleted: false });
      knownTags = tagCounts(Array.isArray(response?.items) ? response.items : []).map((tag) => tag.name);
      paintSuggestions();
    } catch { /* suggestions are optional */ }
  };
  root.querySelector<HTMLElement>('#tag-suggestions')?.addEventListener('click', (event) => {
    const tag = (event.target as HTMLElement).closest<HTMLElement>('[data-add-tag]')?.dataset.addTag;
    if (tag) addSuggestion(tag);
  });
  root.querySelector<HTMLElement>('#save-tags')?.addEventListener('input', paintSuggestions);

  const showSaved = async (bookmark: { id?: string; title?: string; collectionId?: string }) => {
    savedId = bookmark.id;
    if (savedEditor) savedEditor.hidden = false;
    if (undo) undo.disabled = false;
    if (saveButton) saveButton.hidden = true;
    if (existingActions) existingActions.hidden = true;
    syncSaveExtras();
    const titleInput = root.querySelector<HTMLInputElement>('#edit-title');
    if (titleInput) titleInput.value = bookmark.title ?? '';
    await loadFolders(bookmark.collectionId ?? '');
    rememberFolder(bookmark.collectionId);
    const where = folderPaths(collections).get(bookmark.collectionId ?? '');
    const headline = root.querySelector<HTMLElement>('#saved-text');
    if (headline) headline.textContent = where ? fill(text.savedInto, { v: where }) : text.savedHeadline;
  };

  const refresh = async () => {
    try {
      const response = await sendRuntime(port, 'capture');
      const savable = Boolean(response?.savable);
      showPreview(response?.page ?? {});
      if (unsavable) unsavable.hidden = savable;
      const existing = response?.existing;
      existingId = existing?.id;
      if (existingActions) existingActions.hidden = !existing;
      if (existing) {
        await loadFolders();
        const folder = folderPaths(collections).get(existing.collectionId ?? '');
        const label = root.querySelector<HTMLElement>('#existing-text');
        if (label) label.textContent = folder ? fill(text.alreadySavedIn, { v: folder }) : text.alreadySaved;
      }
      if (saveButton) saveButton.hidden = !savable || Boolean(existing);
      if (!existing && savedEditor && !savedId) savedEditor.hidden = true;
      syncSaveExtras();
      if (!savable) setStatus('');
    } catch {
      if (unsavable) unsavable.hidden = false;
      if (saveButton) saveButton.hidden = true;
      syncSaveExtras();
      setStatus('');
    }
  };

  // Ctrl/⌘+Enter saves from anywhere in the card (including the tags and notes fields).
  root.addEventListener?.('keydown', (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.key !== 'Enter' || !(key.ctrlKey || key.metaKey)) return;
    key.preventDefault();
    if (saveButton && !saveButton.hidden) saveButton.click();
    else if (savedEditor && !savedEditor.hidden) root.querySelector<HTMLButtonElement>('#save-edits')?.click();
  });

  saveButton?.addEventListener('click', async () => {
    if (saveButton.disabled) return;
    saveButton.disabled = true;
    setStatus(text.saving);
    try {
      const response = await sendRuntime(port, 'save', extras());
      if (response?.unsavable) { setStatus(text.cannotSave); return; }
      if (!response?.ok) { setStatus(text.notSaved); return; }
      const outcome = response.result;
      if (outcome?.kind === 'existing') {
        existingId = outcome.existing?.id;
        if (existingActions) existingActions.hidden = false;
        if (saveButton) saveButton.hidden = true;
        syncSaveExtras();
        setStatus('');
        return;
      }
      undoToken = typeof response.undoToken === 'string' ? response.undoToken : undefined;
      await showSaved(outcome?.bookmark ?? {});
      setStatus('');
    } catch {
      setStatus(text.notSaved);
    } finally {
      saveButton.disabled = false;
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
    undoToken = typeof response.undoToken === 'string' ? response.undoToken : undefined;
    if (undo) undo.disabled = false;
    setStatus(text.deletedUndo);
  });

  undo?.addEventListener('click', async () => {
    const response = await sendRuntime(port, 'undo', undoToken ? { token: undoToken } : undefined);
    if (!response?.ok) {
      setStatus(text.notSaved);
      return;
    }
    if (undo) undo.disabled = true;
    undoToken = undefined;
    savedId = undefined;
    if (savedEditor) savedEditor.hidden = true;
    setStatus(text.undone);
    await refresh();
  });

  // The page is already open behind this card; what the user wants from here is the saved record.
  root.querySelector<HTMLButtonElement>('#open-existing')?.addEventListener('click', () => {
    void sendRuntime(port, 'open-library', existingId ? { bookmarkId: existingId } : undefined);
    closePopup();
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
    closePopup();
  });
  root.querySelector<HTMLAnchorElement>('#open-library')?.addEventListener('click', (event) => {
    event.preventDefault();
    void sendRuntime(port, 'open-library');
    closePopup();
  });
  root.querySelector<HTMLAnchorElement>('#open-settings')?.addEventListener('click', (event) => {
    event.preventDefault();
    void sendRuntime(port, 'open-settings');
    closePopup();
  });
  if (typeof navigator !== 'undefined' && /mac/i.test(navigator.platform ?? '')) {
    const hint = root.querySelector<HTMLElement>('#save-hint kbd');
    if (hint) hint.textContent = '⌘ Enter';
  }
  void refresh();
  void loadSaveFolders();
  void loadSuggestions();
}

export { popupDocument };
