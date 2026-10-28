import { popupDocument, type RuntimeAction, type RuntimeMessage } from '../ui/index';

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

export { popupDocument };
