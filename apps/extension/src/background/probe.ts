import { classifyHttpStatus, type ProbeKind } from '../ui/bar';

export interface ProbeTarget {
  url: string;
  path: string;
  username?: string;
  password?: string;
}

export async function probeWebDav(target: ProbeTarget, fetchImpl: typeof fetch = fetch): Promise<{ kind: ProbeKind; status?: number }> {
  const endpoint = `${target.url.replace(/\/$/, '')}/${target.path.replace(/^\//, '')}`;
  const headers: Record<string, string> = {};
  if (target.username) headers.Authorization = `Basic ${btoa(`${target.username}:${target.password ?? ''}`)}`;
  try {
    const response = await fetchImpl(endpoint, { method: 'GET', headers });
    return { kind: classifyHttpStatus(response.status), status: response.status };
  } catch {
    return { kind: 'unreachable' };
  }
}
