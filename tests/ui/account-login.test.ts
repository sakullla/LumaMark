import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { settingsDocument } from '../../apps/extension/src/ui/index';
import { copyFor } from '../../apps/extension/src/ui/copy';
import { homeSyncPhrase } from '../../apps/extension/src/ui/bar';
import { popupRuntimeMessage, type RuntimePort } from '../../apps/extension/src/pages/popup';
import { mountSettings, type SettingsMountRoot } from '../../apps/extension/src/pages/settings';

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

  it('restores the signed-in server and uses it when the address field is blank', async () => {
    const sent: Array<{ type: string; payload?: { serverUrl?: string; username?: string } }> = [];
    const port: RuntimePort = {
      async sendMessage(message) {
        sent.push(message as { type: string; payload?: { serverUrl?: string; username?: string } });
        if (message.type === 'lumamark-account-status') {
          return { ok: true, loggedIn: true, username: 'alice', serverUrl: 'https://bookmarks.example' };
        }
        return { ok: true, items: [], config: {} };
      },
    };
    const root = settingsRoot();
    mountSettings(root, port);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.nodes.get('account-server')?.value).toBe('https://bookmarks.example');
    root.nodes.get('account-server')!.value = '   ';
    root.nodes.get('account-switch-user')!.value = 'betty';
    root.nodes.get('account-switch-password')!.value = 'secret';
    await root.nodes.get('account-switch-form')!.submit();
    const switched = sent.find((message) => message.type === 'lumamark-account-switch');
    expect(switched?.payload).toMatchObject({ serverUrl: 'https://bookmarks.example', username: 'betty' });
  });

  it('does not show the library as synced while a write is still waiting', () => {
    expect(homeSyncPhrase({ configured: true, status: 'idle', pendingChanges: 1 })).toBe('needs-attention');
    expect(homeSyncPhrase({ configured: true, status: 'syncing' })).toBe('needs-attention');
    expect(homeSyncPhrase({ configured: true, status: 'error', error: 'Failed to fetch' })).toBe('waiting-network');
    expect(homeSyncPhrase({ configured: true, status: 'idle', pendingChanges: 0, lastSyncAt: '2024-01-01T00:00:00.000Z' } as never)).toBe('aligned');
  });
});

class SettingsNode {
  value = '';
  textContent = '';
  hidden = false;
  disabled = false;
  checked = false;
  dataset: Record<string, string> = {};
  private listeners = new Map<string, Array<(event: { preventDefault(): void; currentTarget: SettingsNode }) => unknown>>();

  addEventListener(type: string, listener: (event: { preventDefault(): void; currentTarget: SettingsNode }) => unknown): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  submit(): Promise<unknown> {
    return Promise.all((this.listeners.get('submit') ?? []).map((listener) => listener({
      preventDefault() {},
      currentTarget: this,
    })));
  }
}

function settingsRoot(): SettingsMountRoot & { nodes: Map<string, SettingsNode> } {
  const nodes = new Map<string, SettingsNode>();
  for (const id of ['account-server', 'account-form', 'account-signed-in', 'account-who', 'account-status', 'account-switch-form', 'account-switch-user', 'account-switch-password']) {
    nodes.set(id, new SettingsNode());
  }
  return {
    nodes,
    querySelector<T extends Element = Element>(selector: string): T | null {
      const match = selector.match(/#([A-Za-z0-9_-]+)/);
      const found = match ? nodes.get(match[1]) : undefined;
      return (found ?? null) as T | null;
    },
    querySelectorAll<T extends Element = Element>(): T[] {
      return [];
    },
  };
}
