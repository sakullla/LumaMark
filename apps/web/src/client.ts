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
}

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
    const record = body as { username?: unknown; token?: unknown };
    if (typeof record.username !== 'string' || typeof record.token !== 'string' || !record.token) {
      throw new WebRequestError('连不上服务', response.status);
    }
    this.token = record.token;
    return { username: record.username, token: record.token };
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
