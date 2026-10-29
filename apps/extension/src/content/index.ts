export interface PageMetadataMessage {
  type: 'lumamark-page-metadata';
  title: string;
  faviconUrl?: string;
}

export interface LinkContextTarget {
  href?: string;
  innerText?: string;
  textContent?: string | null;
}

export function readPageMetadata(documentLike: Pick<Document, 'title' | 'querySelector'> = document): PageMetadataMessage {
  const icon = documentLike.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  return { type: 'lumamark-page-metadata', title: documentLike.title, faviconUrl: icon?.href };
}

export function readLinkTarget(target: { closest?: (selector: string) => LinkContextTarget | null } | null): { url: string; title: string } | undefined {
  const anchor = target?.closest?.('a[href]');
  const url = anchor?.href?.trim() ?? '';
  if (!url) return undefined;
  try {
    const protocol = new URL(url).protocol;
    if (protocol !== 'http:' && protocol !== 'https:') return undefined;
  } catch {
    return undefined;
  }
  const raw = anchor?.innerText?.trim() ? anchor.innerText : (anchor?.textContent ?? '');
  return { url, title: raw.replace(/\s+/g, ' ').trim() };
}

if (typeof document !== 'undefined') {
  const runtime = (globalThis as { browser?: { runtime?: { sendMessage?: (message: unknown) => void } }; chrome?: { runtime?: { sendMessage?: (message: unknown) => void } } }).browser?.runtime
    ?? (globalThis as { chrome?: { runtime?: { sendMessage?: (message: unknown) => void } } }).chrome?.runtime;
  runtime?.sendMessage?.(readPageMetadata(document));
  document.addEventListener('contextmenu', (event) => {
    const node = event.target as { closest?: (selector: string) => LinkContextTarget | null; parentElement?: { closest?: (selector: string) => LinkContextTarget | null } } | null;
    const element = typeof node?.closest === 'function' ? node : node?.parentElement ?? null;
    const found = readLinkTarget(element);
    runtime?.sendMessage?.({ type: 'lumamark-link-context', payload: { url: found?.url ?? '', title: found?.title ?? '' } });
  }, true);
}
