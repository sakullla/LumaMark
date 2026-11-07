import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { settingsDocument } from '../../apps/extension/src/ui/index';
import { copyFor } from '../../apps/extension/src/ui/copy';
import { homeSyncPhrase } from '../../apps/extension/src/ui/bar';
import { popupRuntimeMessage } from '../../apps/extension/src/pages/popup';

describe('account sign-in controls', () => {
  it('offers overwrite, merge, sign-out, and switch, and has no registration', () => {
    for (const language of ['en', 'zh'] as const) {
      const html = settingsDocument(language);
      const text = copyFor(language);
      expect(html).toContain(text.accountSignIn);
      expect(html).toContain(text.accountOverwrite);
      expect(html).toContain(text.accountMerge);
      expect(html).toContain(text.accountSignOut);
      expect(html).toContain(text.accountSwitch);
      expect(html).not.toMatch(/注册|创建账号|signup|sign-up|create account|account-register/i);
    }
    expect(popupRuntimeMessage('account-login', { username: 'alice' })).toEqual({
      type: 'lumamark-account-login',
      payload: { username: 'alice' },
    });
    expect(popupRuntimeMessage('account-choose', { choice: 'cancel' }).type).toBe('lumamark-account-choose');
    const source = readFileSync('apps/extension/src/background/account.ts', 'utf8');
    expect(source).not.toContain('/api/register');
    expect(source).not.toContain('/api/signup');
  });

  it('does not show the library as synced while a write is still waiting', () => {
    expect(homeSyncPhrase({ configured: true, status: 'idle', pendingChanges: 1 })).toBe('needs-attention');
    expect(homeSyncPhrase({ configured: true, status: 'syncing' })).toBe('needs-attention');
    expect(homeSyncPhrase({ configured: true, status: 'error', error: 'Failed to fetch' })).toBe('waiting-network');
    expect(homeSyncPhrase({ configured: true, status: 'idle', pendingChanges: 0, lastSyncAt: '2024-01-01T00:00:00.000Z' } as never)).toBe('aligned');
  });
});
