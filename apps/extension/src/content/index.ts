export interface PageMetadataMessage {
  type: 'lumamark-page-metadata';
  title: string;
  faviconUrl?: string;
}

export function readPageMetadata(documentLike: Pick<Document, 'title' | 'querySelector'> = document): PageMetadataMessage {
  const icon = documentLike.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  return { type: 'lumamark-page-metadata', title: documentLike.title, faviconUrl: icon?.href };
}

if (typeof document !== 'undefined') {
  const metadata = readPageMetadata(document);
  const runtime = (globalThis as { browser?: { runtime?: { sendMessage?: (message: unknown) => void } }; chrome?: { runtime?: { sendMessage?: (message: unknown) => void } } }).browser?.runtime
    ?? (globalThis as { chrome?: { runtime?: { sendMessage?: (message: unknown) => void } } }).chrome?.runtime;
  runtime?.sendMessage?.(metadata);
}

