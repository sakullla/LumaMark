import { settingsDocument } from '../ui/index';

export type SettingsStatus = 'idle' | 'saving' | 'syncing' | 'synced' | 'error' | 'conflict';

export function settingsStatusMessage(status: SettingsStatus, detail = ''): string {
  const labels: Record<SettingsStatus, string> = {
    idle: 'Not configured', saving: 'Saving settings…', syncing: 'Syncing…', synced: 'Synced successfully.',
    error: 'Sync failed. Local data is still available; retry when ready.', conflict: 'A sync conflict needs your choice.',
  };
  return detail ? `${labels[status]} ${detail}` : labels[status];
}

export { settingsDocument };
