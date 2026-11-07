import { bindWebApp, createWebApp, type PageRoot } from './app';
import type { FetchLike } from './client';

export function startWebApp(): void {
  const host = globalThis as {
    document?: { querySelector(selector: string): PageRoot | null };
    fetch?: FetchLike;
  };
  const root = host.document?.querySelector('#root');
  if (!root || !host.fetch) return;
  bindWebApp(root, createWebApp({ fetchImpl: host.fetch.bind(host) }));
}
