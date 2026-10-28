import { settingsDocument } from '../ui/index';
import { sendRuntime, type RuntimePort } from './popup';

export type SettingsStatus = 'idle' | 'saving' | 'syncing' | 'synced' | 'error' | 'conflict';

export function settingsStatusMessage(status: SettingsStatus, detail = ''): string {
  const labels: Record<SettingsStatus, string> = {
    idle: 'Not configured', saving: 'Saving settings…', syncing: 'Syncing…', synced: 'Synced successfully.',
    error: 'Sync failed. Local data is still available; retry when ready.', conflict: 'A sync conflict needs your choice.',
  };
  return detail ? `${labels[status]} ${detail}` : labels[status];
}

export function mountSettings(root: ParentNode = document, port: RuntimePort = (globalThis as any).browser?.runtime ?? (globalThis as any).chrome?.runtime): void {
  const syncStatus = root.querySelector<HTMLElement>('#sync-status');
  const dataStatus = root.querySelector<HTMLElement>('#data-status');
  const conflicts = root.querySelector<HTMLElement>('#conflicts');
  const importAction = root.querySelector<HTMLSelectElement>('#import-action');
  const setSync = (status: SettingsStatus, detail = '') => { if (syncStatus) syncStatus.textContent = settingsStatusMessage(status, detail); };
  root.querySelector<HTMLFormElement>('#sync-form')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget as HTMLFormElement; const data = new FormData(form);
    setSync('saving');
    try { await sendRuntime(port, 'sync-configure', { url: data.get('webdav-url'), path: data.get('webdav-path'), username: data.get('webdav-user'), password: data.get('webdav-password'), autoSync: data.has('auto-sync') }); setSync('idle', 'Settings saved locally.'); }
    catch (error) { setSync('error', String(error)); }
  });
  const renderConflicts = async (items: any[] = []) => {
    if (!conflicts) return;
    conflicts.innerHTML = items.length ? `<h3>Conflicts requiring a choice</h3>${items.map((item) => `<article data-conflict-id="${item.id}"><strong>${item.local?.title ?? item.bookmarkId}</strong><p>Fields: ${(item.fields ?? []).join(', ')}</p><button type="button" data-resolution="local">Keep local</button><button type="button" data-resolution="remote">Keep remote</button><button type="button" data-resolution="merged">Use merged</button></article>`).join('')}` : '';
    conflicts.querySelectorAll<HTMLButtonElement>('[data-resolution]').forEach((button) => button.addEventListener('click', async () => { const card = button.closest<HTMLElement>('[data-conflict-id]'); if (!card) return; await sendRuntime(port, 'resolve-conflict', { id: card.dataset.conflictId, resolution: button.dataset.resolution }); await loadConflicts(); }));
  };
  const loadConflicts = async () => { try { const response = await sendRuntime(port, 'list-conflicts'); await renderConflicts(Array.isArray(response?.items) ? response.items : []); } catch { /* optional on older background */ } };
  const sync = async () => { setSync('syncing'); try { const response = await sendRuntime(port, 'sync'); setSync(response?.status === 'conflict' ? 'conflict' : response?.status === 'error' ? 'error' : 'synced', response?.error); await renderConflicts(response?.conflicts ?? []); } catch (error) { setSync('error', String(error)); } };
  root.querySelector<HTMLButtonElement>('#sync-now')?.addEventListener('click', () => { void sync(); });
  void loadConflicts();
  const importFile = (accept: string, format: string) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = accept;
    input.addEventListener('change', async () => { const file = input.files?.[0]; if (!file) return; try { const response = await sendRuntime(port, 'import', { format, content: await file.text(), action: importAction?.value ?? 'skip' }); const issues = Array.isArray(response?.issues) ? response.issues : []; if (dataStatus) dataStatus.textContent = issues.length ? `Import complete with ${issues.length} skipped or duplicate item(s).` : 'Import complete.'; } catch (error) { if (dataStatus) dataStatus.textContent = `Import failed. ${String(error)}`; } });
    input.click();
  };
  root.querySelector<HTMLButtonElement>('#import-html')?.addEventListener('click', () => importFile('.html,text/html', 'html'));
  root.querySelector<HTMLButtonElement>('#import-json')?.addEventListener('click', () => importFile('.json,application/json', 'json'));
  root.querySelector<HTMLButtonElement>('#export')?.addEventListener('click', async () => {
    try {
      const response = await sendRuntime(port, 'export'); const content = response?.content ?? response?.data; if (typeof content !== 'string') throw new Error('No export data returned');
      const blob = new Blob([content], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'lumamark-export.json'; link.click(); URL.revokeObjectURL(url); if (dataStatus) dataStatus.textContent = 'Export ready.';
    } catch (error) { if (dataStatus) dataStatus.textContent = `Export failed. ${String(error)}`; }
  });
}

export { settingsDocument };
