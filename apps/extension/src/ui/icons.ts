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
