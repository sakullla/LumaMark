import { escapeHtml } from './html';
import { uiIcon, type UiIconName } from './icons';
import { placeMenu } from './library-model';

export interface MenuAction {
  id: string;
  label: string;
  icon?: UiIconName;
  danger?: boolean;
  disabled?: boolean;
  /** Shown at the end of the row, e.g. a shortcut. */
  hint?: string;
  run: () => void | Promise<void>;
}

export type MenuEntry = MenuAction | 'separator';

/** Markup only, so what a menu offers can be checked without a page. */
export function renderMenuEntries(entries: readonly MenuEntry[]): string {
  return entries.map((entry) => {
    if (entry === 'separator') return '<div class="context-separator" role="separator"></div>';
    const classes = `context-item${entry.danger ? ' is-danger' : ''}`;
    const icon = `<span class="context-icon" aria-hidden="true">${entry.icon ? uiIcon(entry.icon) : ''}</span>`;
    const hint = entry.hint ? `<kbd>${escapeHtml(entry.hint)}</kbd>` : '';
    return `<button type="button" role="menuitem" class="${classes}" data-menu-item="${escapeHtml(entry.id)}"${entry.disabled ? ' disabled' : ''}>${icon}<span class="context-label">${escapeHtml(entry.label)}</span>${hint}</button>`;
  }).join('');
}

/**
 * One floating menu per page, opened from a right click, the Menu key or a ⋯ button.
 * Focus moves in, arrows walk the items, and closing hands focus back to where it came from.
 */
export function createContextMenu(host: HTMLElement = document.body) {
  let element: HTMLElement | undefined;
  let returnFocus: HTMLElement | null = null;
  let actions: MenuAction[] = [];

  const items = () => [...(element?.querySelectorAll<HTMLButtonElement>('.context-item:not(:disabled)') ?? [])];

  const close = (restoreFocus = true) => {
    if (!element) return;
    element.remove();
    element = undefined;
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('blur', onDismiss);
    window.removeEventListener('resize', onDismiss);
    document.removeEventListener('scroll', onDismiss, true);
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  };

  const onDismiss = () => close(false);
  const onOutside = (event: Event) => { if (!element?.contains(event.target as Node)) close(false); };

  const step = (delta: number) => {
    const list = items();
    if (!list.length) return;
    const current = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = current < 0 ? (delta > 0 ? 0 : list.length - 1) : (current + delta + list.length) % list.length;
    list[next]?.focus();
  };

  const onKey = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'Tab') { event.preventDefault(); close(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); step(1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); step(-1); return; }
    if (event.key === 'Home') { event.preventDefault(); items()[0]?.focus(); return; }
    if (event.key === 'End') { event.preventDefault(); items().at(-1)?.focus(); }
  };

  const open = (point: { x: number; y: number }, entries: readonly MenuEntry[], label: string, origin?: HTMLElement | null) => {
    close(false);
    returnFocus = origin?.closest<HTMLElement>('button, a, [tabindex]') ?? (document.activeElement as HTMLElement | null);
    actions = entries.filter((entry): entry is MenuAction => entry !== 'separator');
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', label);
    menu.innerHTML = renderMenuEntries(entries);
    menu.addEventListener('contextmenu', (event) => event.preventDefault());
    menu.addEventListener('keydown', onKey);
    menu.addEventListener('click', (event) => {
      const id = (event.target as HTMLElement).closest<HTMLElement>('.context-item')?.dataset.menuItem;
      const action = actions.find((item) => item.id === id);
      if (!action || action.disabled) return;
      close();
      void action.run();
    });
    // A dialog sits in the top layer, so the menu has to live inside it to show above.
    (document.querySelector('dialog[open]') ?? host).append(menu);
    element = menu;
    const rect = menu.getBoundingClientRect();
    const place = placeMenu(point, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight });
    menu.style.left = `${place.left}px`;
    menu.style.top = `${place.top}px`;
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('blur', onDismiss);
    window.addEventListener('resize', onDismiss);
    document.addEventListener('scroll', onDismiss, true);
    items()[0]?.focus({ preventScroll: true });
  };

  return { open, close, isOpen: () => Boolean(element) };
}
