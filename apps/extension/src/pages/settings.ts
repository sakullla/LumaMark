import { collectionOptions, renderConflicts, settingsDocument } from '../ui/index';
import { classifyFailure } from '../ui/bar';
import { copyFor, detectUiLanguage, probeSentence, type UiLanguage } from '../ui/copy';
import { chooseTextFile } from './files';
import { sendRuntime, type RuntimePort } from './popup';

export type SettingsStatus = 'idle' | 'saving' | 'syncing' | 'synced' | 'error' | 'conflict';

export function settingsStatusMessage(status: SettingsStatus, detail = '', language: UiLanguage = 'en'): string {
  const text = copyFor(language);
  const labels: Record<SettingsStatus, string> = {
    idle: text.settingsIdle,
    saving: text.settingsSaving,
    syncing: text.settingsSyncing,
    synced: text.settingsSynced,
    error: text.settingsSyncFailed,
    conflict: text.settingsConflict,
  };
  return detail ? `${labels[status]} ${detail}` : labels[status];
}

function globalRuntime(): RuntimePort {
  const scope = globalThis as { browser?: { runtime?: RuntimePort }; chrome?: { runtime?: RuntimePort } };
  const runtime = scope.browser?.runtime ?? scope.chrome?.runtime;
  if (!runtime?.sendMessage) throw new Error('WebExtension runtime is unavailable');
  return runtime;
}

export function mountSettings(root: ParentNode = document, port: RuntimePort = globalRuntime()): void {
  const language = detectUiLanguage();
  const text = copyFor(language);
  const syncStatus = root.querySelector<HTMLElement>('#sync-status');
  const dataStatus = root.querySelector<HTMLElement>('#data-status');
  const homeStatus = root.querySelector<HTMLElement>('#home-status');
  const conflicts = root.querySelector<HTMLElement>('#conflicts');
  const syncMetadata = root.querySelector<HTMLElement>('#sync-metadata');
  const importAction = root.querySelector<HTMLSelectElement>('#import-action');
  const passwordInput = root.querySelector<HTMLInputElement>('#webdav-password');
  const autoSync = root.querySelector<HTMLInputElement>('#auto-sync');
  const setSync = (value: string) => { if (syncStatus) syncStatus.textContent = value; };
  const statusText = (status: SettingsStatus, detail = '') => settingsStatusMessage(status, detail, language);

  const renderConflictList = async (items: Array<{ id: string; local?: { title?: string; url?: string; notes?: string }; remote?: { title?: string; url?: string; notes?: string } }> = []) => {
    if (!conflicts) return;
    conflicts.innerHTML = renderConflicts(items.map((item) => ({
      id: item.id,
      local: item.local ? { title: item.local.title ?? '', url: item.local.url ?? '', notes: item.local.notes ?? '' } : undefined,
      remote: item.remote ? { title: item.remote.title ?? '', url: item.remote.url ?? '', notes: item.remote.notes ?? '' } : undefined,
    })), language);
    conflicts.querySelectorAll<HTMLButtonElement>('[data-resolution]').forEach((button) => button.addEventListener('click', async () => {
      const card = button.closest<HTMLElement>('[data-conflict-id]');
      if (!card || (button.dataset.resolution !== 'local' && button.dataset.resolution !== 'remote')) return;
      await sendRuntime(port, 'resolve-conflict', { id: card.dataset.conflictId, resolution: button.dataset.resolution });
      await loadConflicts();
    }));
  };

  const loadConflicts = async () => {
    try {
      const response = await sendRuntime(port, 'list-conflicts');
      await renderConflictList(Array.isArray(response?.items) ? response.items : []);
      const metadata = await sendRuntime(port, 'sync-status');
      const value = metadata?.metadata;
      if (syncMetadata && value) syncMetadata.textContent = `${text.syncGroup}: ${value.pendingChanges ?? 0} · ${value.lastSyncAt ?? '—'}`;
    } catch { /* the background may still be starting */ }
  };

  const loadForm = async () => {
    try {
      const [configResponse, engineResponse, collectionsResponse] = await Promise.all([
        sendRuntime(port, 'get-sync-config'),
        sendRuntime(port, 'get-search-engine'),
        sendRuntime(port, 'list-collections'),
      ]);
      const config = configResponse?.config ?? {};
      const url = root.querySelector<HTMLInputElement>('#webdav-url');
      const path = root.querySelector<HTMLInputElement>('#webdav-path');
      const username = root.querySelector<HTMLInputElement>('#webdav-user');
      const search = root.querySelector<HTMLInputElement>('#search-url');
      if (url) url.value = config.url ?? '';
      if (path) path.value = config.path ?? '';
      if (username) username.value = config.username ?? '';
      if (passwordInput) passwordInput.value = '';
      if (autoSync) autoSync.checked = Boolean(config.autoSync);
      if (search && typeof engineResponse?.url === 'string') search.value = engineResponse.url;
      const folders = root.querySelector<HTMLSelectElement>('#toolbar-folder');
      const items = Array.isArray(collectionsResponse?.items) ? collectionsResponse.items : [];
      const selected = items.find((item: { toolbar?: boolean; deletedAt?: string }) => item.toolbar && !item.deletedAt)?.id ?? '';
      if (folders) folders.innerHTML = collectionOptions(items, selected, language);
    } catch { /* leave the form empty rather than inventing stored secrets */ }
  };

  root.querySelector<HTMLFormElement>('#sync-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    setSync(statusText('saving'));
    try {
      const response = await sendRuntime(port, 'sync-configure', {
        url: data.get('webdav-url'),
        path: data.get('webdav-path'),
        username: data.get('webdav-user'),
        password: data.get('webdav-password'),
        autoSync: true,
      });
      if (passwordInput) passwordInput.value = '';
      if (autoSync) autoSync.checked = Boolean(response?.autoSync);
      const kind = String(response?.probe ?? '');
      if (!response?.ok) setSync(statusText('error'));
      else if (kind === 'empty') setSync(text.syncLocal);
      else setSync(probeSentence(kind, language));
    } catch {
      if (passwordInput) passwordInput.value = '';
      setSync(statusText('error'));
    }
  });

  autoSync?.addEventListener('change', () => {
    void sendRuntime(port, 'set-auto-sync', { autoSync: autoSync.checked });
  });

  root.querySelector<HTMLButtonElement>('#sync-now')?.addEventListener('click', async () => {
    setSync(statusText('syncing'));
    try {
      const response = await sendRuntime(port, 'sync');
      if (response?.status === 'conflict') setSync(statusText('conflict'));
      else if (response?.status === 'error' || response?.ok === false) {
        const kind = classifyFailure(String(response?.error ?? ''));
        setSync(kind && kind !== 'other' ? probeSentence(kind, language) : statusText('error'));
      } else setSync(statusText('synced'));
      await renderConflictList(response?.conflicts ?? []);
      await loadConflicts();
    } catch {
      setSync(statusText('error'));
    }
  });

  root.querySelector<HTMLButtonElement>('#save-toolbar')?.addEventListener('click', async () => {
    const id = root.querySelector<HTMLSelectElement>('#toolbar-folder')?.value ?? '';
    if (!id) return;
    const response = await sendRuntime(port, 'set-toolbar', { id });
    if (homeStatus) homeStatus.textContent = response?.ok ? text.saved : text.notSaved;
  });
  root.querySelector<HTMLButtonElement>('#save-search')?.addEventListener('click', async () => {
    const url = root.querySelector<HTMLInputElement>('#search-url')?.value ?? '';
    const response = await sendRuntime(port, 'set-search-engine', { url });
    if (homeStatus) homeStatus.textContent = response?.ok ? text.saved : text.invalidUrl;
  });

  const importFile = async (accept: string, format: string) => {
    const content = await chooseTextFile(accept);
    if (!content || !dataStatus) return;
    try {
      const response = await sendRuntime(port, 'import', { format, content, action: importAction?.value ?? 'skip' });
      const issues = Array.isArray(response?.issues) ? response.issues : [];
      dataStatus.textContent = response?.ok === false ? text.importFailed : issues.length ? text.importIssues : text.importDone;
    } catch {
      dataStatus.textContent = text.importFailed;
    }
  };
  root.querySelector<HTMLButtonElement>('#import-html')?.addEventListener('click', () => { void importFile('.html,text/html', 'html'); });
  root.querySelector<HTMLButtonElement>('#import-json')?.addEventListener('click', () => { void importFile('.json,application/json', 'json'); });
  root.querySelector<HTMLButtonElement>('#export')?.addEventListener('click', async () => {
    try {
      const response = await sendRuntime(port, 'export');
      const content = response?.content ?? response?.data;
      if (typeof content !== 'string') throw new Error('No export data returned');
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'lumamark-export.json';
      link.click();
      URL.revokeObjectURL(url);
      if (dataStatus) dataStatus.textContent = text.exportReady;
    } catch {
      if (dataStatus) dataStatus.textContent = text.exportFailed;
    }
  });

  void loadForm();
  void loadConflicts();
}

export { settingsDocument };
