/** Inline SVG icons: viewBox 16, currentColor, decorative (aria-hidden, not focusable). */
const SVG_OPEN = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false"';

function strokeIcon(body: string): string {
  return `<svg ${SVG_OPEN} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

function fillIcon(body: string): string {
  return `<svg ${SVG_OPEN} fill="currentColor" stroke="none">${body}</svg>`;
}

const STAR_PATH = '<path d="M8 1.9l1.91 3.87 4.27.62-3.09 3.01.73 4.25L8 11.63l-3.82 2.01.73-4.25-3.09-3.01 4.27-.62z"/>';

export function starIcon(filled: boolean): string {
  return filled ? fillIcon(STAR_PATH) : strokeIcon(STAR_PATH);
}

export function pencilIcon(): string {
  return strokeIcon('<path d="M10.7 3.3l2 2L6.2 11.8l-3.2 1.2 1.2-3.2z"/>');
}

export function trashIcon(): string {
  return strokeIcon('<path d="M2.8 4.6h10.4"/><path d="M6.4 4.6V3.2h3.2v1.4"/><path d="M4.4 4.6l.5 7.6a1.4 1.4 0 0 0 1.4 1.3h3.4a1.4 1.4 0 0 0 1.4-1.3l.5-7.6"/>');
}

export function folderIcon(): string {
  return strokeIcon('<path d="M2 12.4V5a1.5 1.5 0 0 1 1.5-1.5h2.6L7.6 5.5h4.9A1.5 1.5 0 0 1 14 7v5.4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.4z"/>');
}

export function searchIcon(): string {
  return strokeIcon('<circle cx="7" cy="7" r="4.4"/><path d="M10.3 10.3l3.2 3.2"/>');
}

export function overflowIcon(): string {
  return fillIcon('<circle cx="3" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="13" cy="8" r="1.2"/>');
}

export function externalIcon(): string {
  return strokeIcon('<path d="M6.6 3.4H4.6A1.6 1.6 0 0 0 3 5v6.4A1.6 1.6 0 0 0 4.6 13H11a1.6 1.6 0 0 0 1.6-1.6V9.4"/><path d="M9.6 3h3.4v3.4"/><path d="M13 3L7.4 8.6"/>');
}

// ── 24px stroke set used by page chrome (headers, buttons, empty states) ──
const UI_PATHS = {
  bookmark: '<path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  bookmarkPlus: '<path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><path d="M12 7v6M9 10h6"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
  library: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/>',
  cloud: '<path d="M17.5 19H7a5 5 0 1 1 1-9.9A6 6 0 0 1 19.5 11 4 4 0 0 1 17.5 19z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7h2A5.5 5.5 0 0 0 22 11c0-5-4.5-9-10-9z"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
} as const;

export type UiIconName = keyof typeof UI_PATHS;

export function uiIcon(name: UiIconName, className = 'ui-icon'): string {
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${UI_PATHS[name]}</svg>`;
}

/** Brand mark: gradient tile with a bookmark and spark (matches the extension icon). */
export function logoMark(size = 28): string {
  return `<svg class="logo-mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false"><defs><linearGradient id="lm-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c6cff"/><stop offset="1" stop-color="#ec5fa8"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#lm-grad)"/><path d="M11 8.5h10a1.5 1.5 0 0 1 1.5 1.5v14l-6.5-3.8L9.5 24V10A1.5 1.5 0 0 1 11 8.5z" fill="#fff" fill-opacity=".95"/><path d="M19.5 4.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="#fff"/></svg>`;
}

export function bindIconFallback(scope: ParentNode): void {
  scope.querySelectorAll<HTMLImageElement>('.item-icon img').forEach((img) => {
    const show = () => {
      img.hidden = true;
      const fallback = img.parentElement?.querySelector<HTMLElement>('.item-fallback');
      if (!fallback) return;
      if (!fallback.textContent) fallback.textContent = img.dataset.initial ?? '';
      fallback.hidden = false;
    };
    img.addEventListener('error', show);
    if (img.complete && img.naturalWidth === 0 && img.src) show();
  });
}
