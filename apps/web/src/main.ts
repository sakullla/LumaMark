import { ACCENT_CHOICES, applyAppearanceToDocument, bindWebApp, createWebApp, type AccentChoice, type PageRoot, type ThemeChoice, type WebView } from './app';
import type { FetchLike } from './client';
import { WEB_STYLES } from './styles';

interface StyleNode { id: string; textContent: string | null }

export function startWebApp(): void {
  const host = globalThis as {
    document?: {
      querySelector(selector: string): PageRoot | null;
      getElementById?(id: string): unknown;
      createElement?(tag: string): StyleNode;
      head?: { append(node: unknown): void };
    };
    fetch?: FetchLike;
    localStorage?: { getItem(key: string): string | null };
    matchMedia?(query: string): { matches: boolean };
  };
  const document = host.document;
  const root = document?.querySelector('#root');
  if (!document || !root || !host.fetch) return;
  if (document.createElement && document.head && !document.getElementById?.('lumamark-web-styles')) {
    const style = document.createElement('style');
    style.id = 'lumamark-web-styles';
    style.textContent = WEB_STYLES;
    document.head.append(style);
  }
  const stored = (key: string) => {
    try { return host.localStorage?.getItem(key) ?? null; } catch { return null; }
  };
  const theme: ThemeChoice = stored('lumamark-theme') === 'dark' || (stored('lumamark-theme') !== 'light' && host.matchMedia?.('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  const accentValue = stored('lumamark-accent') as AccentChoice | null;
  const accent = accentValue && ACCENT_CHOICES.includes(accentValue) ? accentValue : 'iris';
  const viewValue = stored('lumamark-web-view');
  const view: WebView = viewValue === 'compact' || viewValue === 'grid' ? viewValue : 'list';
  applyAppearanceToDocument({ theme, accent });
  bindWebApp(root, createWebApp({
    fetchImpl: host.fetch.bind(host),
    appearance: { theme, accent },
    preferences: { view, sort: stored('lumamark-web-sort') ?? undefined },
  }));
}
