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
