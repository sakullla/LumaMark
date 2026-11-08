import type { SyncManifest } from '../../../packages/sync/src/index';

export class WebRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'WebRequestError';
    this.status = status;
  }
}

export interface AccountSession {
  username: string;
  token: string;
  admin?: boolean;
}

export interface ManagedAccount {
  username: string;
  createdAt: string | null;
  admin: boolean;
}

const ADMIN_ERRORS: Record<string, string> = {
  account_exists: '这个用户名已经有人用了',
  invalid_account: '用户名无效：1–64 个字符，不能包含斜杠或控制字符',
  weak_password: '密码至少 8 个字符',
  account_missing: '这个账号已经不存在了',
  cannot_delete_admin: '管理员账号由环境变量提供，不能在网页上删除',
  forbidden: '只有管理员可以管理账号',
  unauthorized: '登录已过期，请重新登录',
};

export interface ManifestSnapshot {
  manifest: SyncManifest;
  etag: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function isManifest(value: unknown): value is SyncManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<SyncManifest>;
  return manifest.format === 'lumamark-sync'
    && (manifest.schemaVersion === 1 || manifest.schemaVersion === 2)
    && typeof manifest.generatedAt === 'string'
    && typeof manifest.deviceId === 'string'
    && Array.isArray(manifest.bookmarks)
    && Array.isArray(manifest.collections);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Web session for one browser page. The token lives only on this client. */
export class AccountClient {
  private token: string | undefined;

  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly baseUrl = '',
  ) {}

  sessionToken(): string | undefined {
    return this.token;
  }

  async checkSession(): Promise<{ username: string; admin: boolean } | undefined> {
    try {
      const response = await this.request('/api/session', { method: 'GET' });
      if (!response.ok) return undefined;
      const body = await readJson(response);
      if (!body || typeof body !== 'object') return undefined;
      const record = body as { username?: unknown; token?: unknown; admin?: unknown };
      if (typeof record.username !== 'string' || !record.username) return undefined;
      if (typeof record.token === 'string' && record.token) this.token = record.token;
      return { username: record.username, admin: record.admin === true };
    } catch {
      return undefined;
    }
  }

  async listAccounts(): Promise<ManagedAccount[]> {
    const response = await this.request('/api/admin/accounts', { method: 'GET' });
    await this.adminCheck(response);
    const body = await readJson(response) as { accounts?: unknown } | undefined;
    if (!body || !Array.isArray(body.accounts)) throw new WebRequestError('连不上服务', response.status);
    return body.accounts
      .filter((item): item is { username: string; createdAt?: unknown; admin?: unknown } => Boolean(item) && typeof (item as { username?: unknown }).username === 'string')
      .map((item) => ({ username: item.username, createdAt: typeof item.createdAt === 'string' ? item.createdAt : null, admin: item.admin === true }));
  }

  async createAccount(username: string, password: string): Promise<string> {
    const response = await this.request('/api/admin/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    await this.adminCheck(response);
    const body = await readJson(response) as { username?: unknown } | undefined;
    return typeof body?.username === 'string' ? body.username : username.trim();
  }

  async resetPassword(username: string, password: string): Promise<void> {
    const response = await this.request(`/api/admin/accounts/${encodeURIComponent(username)}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    await this.adminCheck(response);
  }

  async deleteAccount(username: string): Promise<void> {
    const response = await this.request(`/api/admin/accounts/${encodeURIComponent(username)}`, { method: 'DELETE' });
    await this.adminCheck(response);
  }

  private async adminCheck(response: Response): Promise<void> {
    if (response.ok) return;
    const body = await readJson(response) as { error?: unknown } | undefined;
    const code = typeof body?.error === 'string' ? body.error : '';
    throw new WebRequestError(ADMIN_ERRORS[code] ?? '连不上服务，账号没有改动', response.status);
  }

  async login(username: string, password: string): Promise<AccountSession> {
    const response = await this.request('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }, false);
    if (response.status === 401) throw new WebRequestError('登录信息不正确', 401);
    if (!response.ok) throw new WebRequestError('连不上服务', response.status);
    const body = await readJson(response);
    if (!body || typeof body !== 'object') throw new WebRequestError('连不上服务', response.status);
    const record = body as { username?: unknown; token?: unknown; admin?: unknown };
    if (typeof record.username !== 'string' || typeof record.token !== 'string' || !record.token) {
      throw new WebRequestError('连不上服务', response.status);
    }
    this.token = record.token;
    return { username: record.username, token: record.token, admin: record.admin === true };
  }

  async logout(): Promise<void> {
    const response = await this.request('/api/session', { method: 'DELETE' });
    if (response.status !== 204 && response.status !== 401) throw new WebRequestError('没有退出', response.status);
    this.token = undefined;
  }

  async readManifest(): Promise<ManifestSnapshot> {
    const response = await this.request('/api/manifest', { method: 'GET' });
    if (response.status === 401) throw new WebRequestError('没有进入账号', 401);
    if (!response.ok) throw new WebRequestError('连不上服务', response.status);
    const body = await readJson(response);
    if (!isManifest(body)) throw new WebRequestError('连不上服务', response.status);
    const etag = response.headers.get('etag');
    if (!etag) throw new WebRequestError('连不上服务', response.status);
    return { manifest: body, etag };
  }

  async writeManifest(manifest: SyncManifest, etag: string): Promise<string> {
    if (!etag) throw new WebRequestError('缺少版本', 428);
    const response = await this.request('/api/manifest', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,
      },
      body: JSON.stringify(manifest),
    });
    if (response.status === 412) throw new WebRequestError('版本冲突', 412);
    if (response.status === 428) throw new WebRequestError('缺少版本', 428);
    if (!response.ok) {
      const detail = await response.text();
      throw new WebRequestError(detail ? `没有保存成。${detail}` : '没有保存成', response.status);
    }
    const next = response.headers.get('etag');
    if (!next) throw new WebRequestError('没有保存成', response.status);
    return next;
  }

  private async request(path: string, init: RequestInit, authorize = true): Promise<Response> {
    const headers = new Headers(init.headers);
    if (authorize && this.token) headers.set('Authorization', `Bearer ${this.token}`);
    try {
      return await this.fetchImpl(this.url(path), {
        ...init,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch {
      throw new WebRequestError('连不上服务', 0);
    }
  }

  private url(path: string): string {
    if (!this.baseUrl) return path;
    const base = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
    return new URL(path, base).toString();
  }
}
