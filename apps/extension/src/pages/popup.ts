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
  return { type: `lumamark-${action}`, ...(payload === undefined ? {} : { payload }) } as RuntimeMessage;
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
      const result = await sendRuntime(port, 'save');
      if (undo) undo.disabled = result?.kind !== 'saved';
      setStatus(result?.kind === 'existing' ? popupStatus('existing') : popupStatus('saved'));
      await refresh();
    } catch (error) { setStatus(popupStatus('error', String(error))); }
  });
  undo?.addEventListener('click', async () => {
    await sendRuntime(port, 'undo'); undo.disabled = true; setStatus(popupStatus('undone')); await refresh();
  });
  root.querySelector<HTMLAnchorElement>('#open-library')?.addEventListener('click', () => { void sendRuntime(port, 'open-library'); });
  root.querySelector<HTMLInputElement>('#quick-search')?.addEventListener('input', (event) => { void refresh((event.target as HTMLInputElement).value); });
  void refresh();
}

export { popupDocument };
