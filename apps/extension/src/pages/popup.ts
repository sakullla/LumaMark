import { popupDocument, type RuntimeAction, type RuntimeMessage } from '../ui/index';

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
  // Keep the wire names explicit in the browser bundle. Besides making the
  // runtime contract easy to inspect, this avoids relying on a template
  // string when a browser's message bridge serializes the action.
  const runtimeTypes: Record<RuntimeAction, RuntimeMessage['type']> = {
    save: 'lumamark-save', undo: 'lumamark-undo', 'open-library': 'lumamark-open-library',
    list: 'lumamark-list', 'list-collections': 'lumamark-list-collections',
    'update-existing': 'lumamark-update-existing', 'copy-existing': 'lumamark-copy-existing',
    update: 'lumamark-update', delete: 'lumamark-delete', restore: 'lumamark-restore',
    favorite: 'lumamark-favorite', sync: 'lumamark-sync', 'sync-configure': 'lumamark-sync-configure',
    export: 'lumamark-export', import: 'lumamark-import', 'list-conflicts': 'lumamark-list-conflicts', 'resolve-conflict': 'lumamark-resolve-conflict', 'collection-create': 'lumamark-collection-create', 'collection-delete': 'lumamark-collection-delete',
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

/** Bind popup controls to the background service and keep recent items searchable. */
export function mountPopup(root: ParentNode = document, port: RuntimePort = globalRuntime()): void {
  const status = root.querySelector<HTMLElement>('#status');
  const undo = root.querySelector<HTMLButtonElement>('#undo');
  const recent = root.querySelector<HTMLOListElement>('#recent');
  const setStatus = (value: string) => { if (status) status.textContent = value; };
  void sendRuntime(port, 'list-collections').then((response) => {
    const select = root.querySelector<HTMLSelectElement>('#save-collection');
    if (select && Array.isArray(response?.items)) select.innerHTML = '<option value="">No collection</option>' + response.items.filter((item: any) => !item.deletedAt).map((item: any) => `<option value="${item.id}">${item.name}</option>`).join('');
  }).catch(() => undefined);
  const refresh = async (text = '') => {
    try {
      const response = await sendRuntime(port, 'list', { text });
      const items = Array.isArray(response?.items) ? response.items : [];
      if (recent) {
        recent.replaceChildren(...items.slice(0, 10).map((item: { id: string; title: string; url: string }) => {
          const li = document.createElement('li');
          const link = document.createElement('a');
          link.href = item.url; link.textContent = item.title || item.url; link.dataset.bookmarkId = item.id;
          li.append(link); return li;
        }));
      }
    } catch (error) { setStatus(popupStatus('error', String(error))); }
  };
  root.querySelector<HTMLButtonElement>('#save')?.addEventListener('click', async () => {
    setStatus(popupStatus('saving'));
    try {
      const tags = (root.querySelector<HTMLInputElement>('#save-tags')?.value ?? '').split(',').map((tag) => tag.trim()).filter(Boolean);
      const result = await sendRuntime(port, 'save', { collectionId: root.querySelector<HTMLInputElement>('#save-collection')?.value.trim() || undefined, tags, notes: root.querySelector<HTMLTextAreaElement>('#save-notes')?.value ?? '' });
      if (undo) undo.disabled = result?.kind !== 'saved';
      setStatus(result?.kind === 'existing' ? popupStatus('existing') : popupStatus('saved'));
      const existingActions = root.querySelector<HTMLElement>('#existing-actions'); if (existingActions) existingActions.hidden = result?.kind !== 'existing';
      await refresh();
    } catch (error) { setStatus(popupStatus('error', String(error))); }
  });
  root.querySelector<HTMLButtonElement>('#open-existing')?.addEventListener('click', () => { void sendRuntime(port, 'open-library'); });
  root.querySelector<HTMLButtonElement>('#update-existing')?.addEventListener('click', () => { void sendRuntime(port, 'update-existing'); });
  root.querySelector<HTMLButtonElement>('#copy-existing')?.addEventListener('click', () => { void sendRuntime(port, 'copy-existing'); });
  undo?.addEventListener('click', async () => {
    await sendRuntime(port, 'undo'); undo.disabled = true; setStatus(popupStatus('undone')); await refresh();
  });
  root.querySelector<HTMLAnchorElement>('#open-library')?.addEventListener('click', () => { void sendRuntime(port, 'open-library'); });
  root.querySelector<HTMLInputElement>('#quick-search')?.addEventListener('input', (event) => { void refresh((event.target as HTMLInputElement).value); });
  void refresh();
}

export { popupDocument };
