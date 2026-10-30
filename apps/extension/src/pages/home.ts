import type { Bookmark, Collection } from '../../../../packages/domain/src/index';
import { homeDocument, renderSyncLine, searchBookmarks } from '../ui/index';
import {
  barDropParent,
  barItemBudget,
  buildBar,
  dropIntent,
  hasDisplayableBookmarks,
  homeSyncPhrase,
  isHttpUrl,
  menuParentId,
  nextIndex,
  planWebSearch,
  renderBarEntries,
  visibleItemCount,
  type BarModel,
} from '../ui/bar';
import { copyFor, detectUiLanguage } from '../ui/copy';
import { escapeHtml } from '../ui/html';
import { bindIconFallback, overflowIcon } from '../ui/icons';
import { chooseTextFile } from './files';
import { sendRuntime, type RuntimePort } from './popup';

function globalRuntime(): RuntimePort {
  const scope = globalThis as { browser?: { runtime?: RuntimePort }; chrome?: { runtime?: RuntimePort } };
  const runtime = scope.browser?.runtime ?? scope.chrome?.runtime;
  if (!runtime?.sendMessage) throw new Error('WebExtension runtime is unavailable');
  return runtime;
}

type PageRoot = ParentNode & EventTarget;

function px(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function gapPx(value: string | undefined): number {
  if (!value || value === 'normal') return 4;
  return px(value);
}

function naturalWidth(element: HTMLElement | null): number {
  if (!element) return 0;
  const previous = element.style.flexShrink;
  element.style.flexShrink = '0';
  const width = element.getBoundingClientRect().width;
  element.style.flexShrink = previous;
  return width;
}

function overflowButtonWidth(wrap: HTMLElement): number {
  const wasHidden = wrap.hidden;
  if (wasHidden) wrap.hidden = false;
  const width = naturalWidth(wrap.querySelector<HTMLElement>('#overflow-button'));
  if (wasHidden) wrap.hidden = true;
  return width;
}

export function mountHome(root: PageRoot = document, port: RuntimePort = globalRuntime()): void {
  const language = detectUiLanguage();
  const text = copyFor(language);
  let bookmarks: Bookmark[] = [];
  let collections: Collection[] = [];
  let searchUrl = 'https://www.google.com/search?q={query}';
  let model: BarModel = { items: [], other: [] };
  let drag: { kind: 'bookmark' | 'folder'; id: string } | undefined;
  let layingOut = false;
  const liftedMenus = new Map<HTMLElement, { parent: HTMLElement; next: ChildNode | null; anchor: HTMLElement }>();
  const liftedTooltips = new Map<HTMLElement, { parent: HTMLElement; next: ChildNode | null; anchor: HTMLElement }>();
  let hoveredAnchor: HTMLElement | undefined;

  const bar = () => root.querySelector<HTMLElement>('#bookmark-bar');
  const note = () => root.querySelector<HTMLElement>('#search-note');
  const results = () => root.querySelector<HTMLElement>('#search-results');
  const menuLayer = () => root.querySelector<HTMLElement>('#bar-region');

  const restoreLiftedMenu = (menu: HTMLElement) => {
    const home = liftedMenus.get(menu);
    if (!home) return;
    menu.style.position = '';
    menu.style.top = '';
    menu.style.left = '';
    menu.style.zIndex = '';
    if (home.parent.isConnected) {
      if (home.next && home.next.parentNode === home.parent) home.parent.insertBefore(menu, home.next);
      else home.parent.append(menu);
    } else menu.remove();
    liftedMenus.delete(menu);
  };

  const restoreLiftedMenus = () => {
    for (const menu of [...liftedMenus.keys()]) restoreLiftedMenu(menu);
  };

  // The bar clips its row. Open menus and full-title tips attach to #bar-region, which does not.
  const positionLiftedMenu = (menu: HTMLElement, anchor: HTMLElement, layer: HTMLElement) => {
    if (typeof anchor.getBoundingClientRect !== 'function' || typeof layer.getBoundingClientRect !== 'function') return;
    const anchorRect = anchor.getBoundingClientRect();
    const nested = Boolean(anchor.closest('.folder-menu'));
    const topEdge = nested ? anchorRect.top : anchorRect.bottom;
    const leftEdge = nested ? anchorRect.right : anchorRect.left;
    const layerRect = layer.getBoundingClientRect();
    menu.style.position = 'absolute';
    menu.style.zIndex = '5';
    menu.style.top = `${topEdge - layerRect.top}px`;
    menu.style.left = `${leftEdge - layerRect.left}px`;
  };

  const liftMenu = (menu: HTMLElement, anchor: HTMLElement) => {
    const layer = menuLayer();
    if (!layer) return;
    if (liftedMenus.has(menu)) {
      positionLiftedMenu(menu, anchor, layer);
      return;
    }
    if (!menu.closest('.bookmark-bar, .bar-items')) return;
    const parent = menu.parentElement;
    if (!parent || parent === layer) return;
    liftedMenus.set(menu, { parent, next: menu.nextSibling, anchor });
    menu.style.position = 'absolute';
    menu.style.zIndex = '5';
    layer.append(menu);
    positionLiftedMenu(menu, anchor, layer);
  };

  const menuFor = (button: HTMLElement): HTMLElement | undefined => {
    const inline = button.parentElement?.querySelector<HTMLElement>(':scope > .folder-menu');
    if (inline) return inline;
    for (const [menu, home] of liftedMenus) {
      if (home.anchor === button) return menu;
    }
    return undefined;
  };

  const closeMenu = (menu: HTMLElement) => {
    menu.querySelectorAll<HTMLElement>('.folder-menu').forEach((nested) => { nested.hidden = true; });
    menu.hidden = true;
    const anchor = liftedMenus.get(menu)?.anchor;
    restoreLiftedMenu(menu);
    anchor?.setAttribute('aria-expanded', 'false');
  };

  const openMenu = (button: HTMLElement, menu: HTMLElement) => {
    const scope = button.parentElement?.parentElement;
    scope?.querySelectorAll<HTMLElement>(':scope > .folder > .folder-menu, :scope > .bar-menu > .folder-menu').forEach((other) => {
      if (other !== menu) other.hidden = true;
    });
    for (const [other, home] of [...liftedMenus]) {
      if (other !== menu && scope?.contains(home.anchor)) closeMenu(other);
    }
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    liftMenu(menu, button);
  };

  const restoreLiftedTooltip = (tooltip: HTMLElement) => {
    const home = liftedTooltips.get(tooltip);
    if (!home) return;
    tooltip.style.position = '';
    tooltip.style.top = '';
    tooltip.style.left = '';
    tooltip.style.zIndex = '';
    tooltip.style.display = '';
    tooltip.style.pointerEvents = '';
    tooltip.style.maxWidth = '';
    tooltip.style.whiteSpace = '';
    tooltip.style.overflowWrap = '';
    if (home.parent.isConnected) {
      if (home.next && home.next.parentNode === home.parent) home.parent.insertBefore(tooltip, home.next);
      else home.parent.append(tooltip);
    } else tooltip.remove();
    liftedTooltips.delete(tooltip);
  };

  const restoreLiftedTooltips = () => {
    for (const tooltip of [...liftedTooltips.keys()]) restoreLiftedTooltip(tooltip);
  };

  const tooltipGap = (layer: HTMLElement): number => {
    if (typeof getComputedStyle !== 'function') return 3.2;
    const root = layer.ownerDocument?.documentElement;
    if (!root) return 3.2;
    const font = px(getComputedStyle(root).fontSize);
    return font > 0 ? font * 0.2 : 3.2;
  };

  const viewportWidth = (layer: HTMLElement): number => {
    const root = layer.ownerDocument?.documentElement;
    if (root && root.clientWidth > 0) return root.clientWidth;
    const inner = layer.ownerDocument?.defaultView?.innerWidth ?? 0;
    return inner > 0 ? inner : 0;
  };

  // Nowrap text runs past the right edge. Slide it back, and wrap only when it is wider than the viewport.
  const positionLiftedTooltip = (tooltip: HTMLElement, anchor: HTMLElement, layer: HTMLElement) => {
    tooltip.style.position = 'absolute';
    tooltip.style.zIndex = '4';
    tooltip.style.display = 'block';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.whiteSpace = 'nowrap';
    tooltip.style.overflowWrap = '';
    tooltip.style.maxWidth = 'none';
    if (typeof anchor.getBoundingClientRect !== 'function' || typeof layer.getBoundingClientRect !== 'function') return;
    const anchorRect = anchor.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    const viewport = viewportWidth(layer);
    let width = typeof tooltip.getBoundingClientRect === 'function' ? tooltip.getBoundingClientRect().width : 0;
    if (viewport > 0 && width > viewport) {
      tooltip.style.whiteSpace = 'normal';
      tooltip.style.overflowWrap = 'anywhere';
      tooltip.style.maxWidth = `${viewport}px`;
      width = typeof tooltip.getBoundingClientRect === 'function' ? tooltip.getBoundingClientRect().width : viewport;
      if (width > viewport) width = viewport;
    }
    let viewLeft = anchorRect.left;
    if (viewport > 0 && width > 0) {
      if (viewLeft + width > viewport) viewLeft = viewport - width;
      if (viewLeft < 0) viewLeft = 0;
    }
    tooltip.style.top = `${anchorRect.bottom - layerRect.top + tooltipGap(layer)}px`;
    tooltip.style.left = `${viewLeft - layerRect.left}px`;
  };

  const tooltipOf = (anchor: HTMLElement): HTMLElement | undefined => {
    const inline = [...anchor.children].find((child) => child.classList.contains('item-tooltip'));
    if (inline) return inline as HTMLElement;
    for (const [tooltip, home] of liftedTooltips) {
      if (home.anchor === anchor) return tooltip;
    }
    return undefined;
  };

  const showItemTooltip = (anchor: HTMLElement) => {
    const tooltip = tooltipOf(anchor);
    const layer = menuLayer();
    if (!tooltip || !layer || !anchor.isConnected) return;
    if (!liftedTooltips.has(tooltip) && !tooltip.closest('.bookmark-bar, .bar-items')) return;
    if (liftedTooltips.has(tooltip)) {
      positionLiftedTooltip(tooltip, anchor, layer);
      return;
    }
    const parent = tooltip.parentElement;
    if (!parent || parent === layer) return;
    liftedTooltips.set(tooltip, { parent, next: tooltip.nextSibling, anchor });
    layer.append(tooltip);
    positionLiftedTooltip(tooltip, anchor, layer);
  };

  const focusedBarItem = (): HTMLElement | undefined => {
    if (typeof document === 'undefined') return undefined;
    const active = document.activeElement as HTMLElement | null;
    if (!active || typeof active.closest !== 'function') return undefined;
    const item = active.closest('.bar-item');
    return item?.isConnected ? item as HTMLElement : undefined;
  };

  const syncTooltips = () => {
    if (hoveredAnchor && !hoveredAnchor.isConnected) hoveredAnchor = undefined;
    const wanted = new Set<HTMLElement>();
    if (hoveredAnchor) wanted.add(hoveredAnchor);
    const focused = focusedBarItem();
    if (focused) wanted.add(focused);
    for (const [tooltip, home] of [...liftedTooltips]) {
      if (!wanted.has(home.anchor)) restoreLiftedTooltip(tooltip);
    }
    for (const anchor of wanted) showItemTooltip(anchor);
  };

  const layoutBar = () => {
    if (layingOut) return;
    layingOut = true;
    const reopen = [...liftedMenus].filter(([menu]) => !menu.hidden).map(([menu, home]) => ({ menu, anchor: home.anchor }));
    restoreLiftedMenus();
    restoreLiftedTooltips();
    try {
      const target = bar();
      const itemsHost = target?.querySelector<HTMLElement>('.bar-items');
      const overflowMenu = target?.querySelector<HTMLElement>('#overflow-menu');
      const overflowWrap = target?.querySelector<HTMLElement>('.overflow-menu');
      if (!target || !itemsHost || !overflowMenu || !overflowWrap) return;
      [...overflowMenu.children].forEach((child) => itemsHost.append(child));
      const items = [...itemsHost.querySelectorAll<HTMLElement>(':scope > .bar-item')];
      items.forEach((item) => { item.hidden = false; });
      if (target.clientWidth <= 0) { overflowWrap.hidden = true; return; }
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(target) : undefined;
      const hostStyle = typeof getComputedStyle === 'function' ? getComputedStyle(itemsHost) : undefined;
      const padding = style ? px(style.paddingLeft) + px(style.paddingRight) : 0;
      const barGap = gapPx(style?.columnGap || style?.gap);
      const itemGap = gapPx(hostStyle?.columnGap || hostStyle?.gap);
      const widths = items.map((item) => naturalWidth(item));
      const otherWidth = naturalWidth(target.querySelector<HTMLElement>('.other-bookmarks'));
      const fit = (overflowWidth: number) => visibleItemCount(widths, barItemBudget({
        clientWidth: target.clientWidth,
        padding,
        otherWidth,
        overflowWidth,
        barGap,
      }), 0, itemGap);
      let visible = fit(0);
      if (visible < items.length) visible = fit(overflowButtonWidth(overflowWrap));
      overflowMenu.replaceChildren();
      items.slice(visible).forEach((item) => overflowMenu.append(item));
      overflowWrap.hidden = visible >= items.length;
    } finally {
      try {
        for (const entry of reopen) {
          if (entry.menu.isConnected && !entry.menu.hidden) liftMenu(entry.menu, entry.anchor);
        }
        syncTooltips();
      } finally {
        layingOut = false;
      }
    }
  };

  const render = () => {
    restoreLiftedMenus();
    restoreLiftedTooltips();
    hoveredAnchor = undefined;
    const target = bar();
    const empty = root.querySelector<HTMLElement>('#bar-empty');
    if (!target) return;
    const showEmpty = !hasDisplayableBookmarks(bookmarks);
    if (empty) empty.hidden = !showEmpty;
    target.hidden = showEmpty;
    if (showEmpty) { target.innerHTML = ''; return; }
    const parent = model.toolbarId ?? '';
    target.dataset.parentId = parent;
    const other = model.other.length
      ? `<div class="bar-menu other-bookmarks"><button type="button" class="bar-hit" id="other-bookmarks" aria-expanded="false">${escapeHtml(text.otherBookmarks)}</button><div class="folder-menu" hidden role="menu" data-parent-id="">${renderBarEntries(model.other, '')}</div></div>`
      : '';
    target.innerHTML = `<div class="bar-items" data-parent-id="${escapeHtml(parent)}">${renderBarEntries(model.items, parent)}</div>` +
      `<div class="bar-menu overflow-menu" hidden><button type="button" class="bar-hit" id="overflow-button" aria-expanded="false">${overflowIcon()}<span class="item-label">${escapeHtml(text.overflow)}</span></button><div class="folder-menu" id="overflow-menu" hidden data-parent-id="${escapeHtml(parent)}"></div></div>${other}`;
    bindIconFallback(target);
    layoutBar();
  };

  const toggleMenu = (button: HTMLElement) => {
    const menu = menuFor(button);
    if (!menu) return;
    if (!menu.hidden) {
      closeMenu(menu);
      button.setAttribute('aria-expanded', 'false');
      return;
    }
    openMenu(button, menu);
    menu.querySelector<HTMLElement>('a, button')?.focus();
  };

  const focusRow = (container: HTMLElement, key: string) => {
    const items = [...container.querySelectorAll<HTMLElement>(':scope > a.bar-item, :scope > .folder > .bar-hit, :scope > .bar-menu > .bar-hit')];
    const current = items.findIndex((item) => item === document.activeElement);
    const next = nextIndex(current < 0 ? 0 : current, items.length, key);
    if (next === undefined) return false;
    items[next]?.focus();
    return true;
  };

  const menuHost = menuLayer() ?? bar();
  menuHost?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('.folder > .bar-hit, #other-bookmarks, #overflow-button');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    toggleMenu(button);
  });

  menuHost?.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    const key = event.key;
    if (key === 'Escape') {
      root.querySelectorAll<HTMLElement>('.folder-menu').forEach((menu) => { menu.hidden = true; });
      for (const home of liftedMenus.values()) home.anchor.setAttribute('aria-expanded', 'false');
      restoreLiftedMenus();
      return;
    }
    if ((key === 'Enter' || key === ' ') && target.matches('.folder > .bar-hit, #other-bookmarks, #overflow-button')) {
      event.preventDefault();
      toggleMenu(target);
      return;
    }
    if (key === 'ArrowDown' && target.matches('.folder > .bar-hit, #other-bookmarks, #overflow-button')) {
      event.preventDefault();
      const menu = menuFor(target);
      if (!menu) return;
      openMenu(target, menu);
      menu.querySelector<HTMLElement>(':scope > a.bar-item, :scope > .folder > .bar-hit')?.focus();
      return;
    }
    const menu = target.closest<HTMLElement>('.folder-menu');
    const host = menu ?? bar()?.querySelector<HTMLElement>('.bar-items') ?? undefined;
    if (!host) return;
    if (key === 'ArrowRight' && target.matches('.folder > .bar-hit') && menu) {
      event.preventDefault();
      const nested = target.parentElement?.querySelector<HTMLElement>(':scope > .folder-menu');
      if (!nested) return;
      openMenu(target, nested);
      nested.querySelector<HTMLElement>('a, button')?.focus();
      return;
    }
    if (!focusRow(host, key)) return;
    if (key.startsWith('Arrow') || key === 'Home' || key === 'End') event.preventDefault();
  });

  const barItemFrom = (event: Event): HTMLElement | undefined => {
    const target = event.target as { closest?: (selector: string) => HTMLElement | null } | null;
    if (!target || typeof target.closest !== 'function') return undefined;
    return target.closest('.bar-item') ?? undefined;
  };

  const relatedNode = (event: Event): Node | null => (event as Event & { relatedTarget?: Node | null }).relatedTarget ?? null;

  const pointerStillInside = (anchor: HTMLElement, node: Node | null): boolean => {
    if (!node) return false;
    if (anchor.contains(node)) return true;
    const tooltip = tooltipOf(anchor);
    return Boolean(tooltip && (node === tooltip || tooltip.contains(node)));
  };

  const showHovered = (event: Event) => {
    const anchor = barItemFrom(event);
    if (!anchor) return;
    hoveredAnchor = anchor;
    syncTooltips();
  };

  const hideHovered = (event: Event) => {
    const anchor = barItemFrom(event);
    if (!anchor || hoveredAnchor !== anchor) return;
    if (pointerStillInside(anchor, relatedNode(event))) return;
    hoveredAnchor = undefined;
    syncTooltips();
  };

  menuHost?.addEventListener('mouseover', showHovered);
  menuHost?.addEventListener('pointerover', showHovered);
  menuHost?.addEventListener('mouseout', hideHovered);
  menuHost?.addEventListener('pointerout', hideHovered);
  menuHost?.addEventListener('focusin', () => { syncTooltips(); });
  menuHost?.addEventListener('focusout', () => { syncTooltips(); });

  const readDrag = (event: DragEvent) => {
    if (drag) return drag;
    const raw = event.dataTransfer?.getData('application/x-lumamark') || event.dataTransfer?.getData('text/plain');
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as { kind?: string; id?: string };
      if ((parsed.kind === 'bookmark' || parsed.kind === 'folder') && parsed.id) return { kind: parsed.kind, id: parsed.id };
    } catch { /* ignore a foreign drag */ }
    return undefined;
  };

  root.addEventListener('dragstart', (event) => {
    const dragEvent = event as DragEvent;
    const item = (dragEvent.target as HTMLElement).closest<HTMLElement>('[data-kind][data-id]');
    if (!item || (item.dataset.kind !== 'bookmark' && item.dataset.kind !== 'folder')) return;
    drag = { kind: item.dataset.kind, id: item.dataset.id! };
    dragEvent.dataTransfer?.setData('text/plain', JSON.stringify(drag));
    dragEvent.dataTransfer?.setData('application/x-lumamark', JSON.stringify(drag));
  });
  root.addEventListener('dragover', (event) => {
    const dragEvent = event as DragEvent;
    if (!drag && !dragEvent.dataTransfer?.types.includes('application/x-lumamark') && !dragEvent.dataTransfer?.types.includes('text/plain')) return;
    dragEvent.preventDefault();
  });
  root.addEventListener('drop', async (event) => {
    const dragEvent = event as DragEvent;
    const moving = readDrag(dragEvent);
    drag = undefined;
    if (!moving) return;
    dragEvent.preventDefault();
    const raw = dragEvent.target as { closest?: HTMLElement['closest']; parentElement?: HTMLElement | null } | null;
    const hit = (typeof raw?.closest === 'function' ? raw : raw?.parentElement) as HTMLElement | null;
    if (!hit?.closest) return;
    let parentId = model.toolbarId ?? '';
    let beforeId: string | undefined;
    const topLevel = barDropParent({
      inBar: Boolean(hit.closest('#bookmark-bar')) || Boolean(hit.closest('.folder-menu')),
      onOtherButton: Boolean(hit.closest('#other-bookmarks')),
    });
    if (topLevel === '') parentId = '';
    else {
      const item = hit.closest<HTMLElement>('[data-kind][data-id]');
      if (item?.dataset.id === moving.id) return;
      if (item) {
        const rect = item.getBoundingClientRect();
        const horizontal = !item.closest('.folder-menu');
        const intent = dropIntent({
          kind: item.dataset.kind === 'folder' ? 'folder' : 'bookmark',
          start: horizontal ? rect.left : rect.top,
          size: horizontal ? rect.width : rect.height,
          point: horizontal ? dragEvent.clientX : dragEvent.clientY,
        });
        if (intent === 'inside' && item.dataset.kind === 'folder') parentId = item.dataset.id ?? '';
        else {
          parentId = item.dataset.parentId ?? '';
          const siblings = [...(item.parentElement?.querySelectorAll<HTMLElement>(':scope > [data-id]') ?? [])];
          const index = siblings.findIndex((sibling) => sibling.dataset.id === item.dataset.id);
          if (intent === 'before') beforeId = item.dataset.id;
          if (intent === 'after') beforeId = siblings[index + 1]?.dataset.id;
        }
      } else {
        const menu = hit.closest<HTMLElement>('.folder-menu');
        if (menu) parentId = menuParentId(menu.getAttribute('data-parent-id'), parentId);
      }
    }
    const response = await sendRuntime(port, 'reorder', { kind: moving.kind, id: moving.id, parentId, beforeId });
    if (response?.ok) await load();
  });

  const searchInput = () => root.querySelector<HTMLInputElement>('#search');
  const paintSearch = () => {
    const input = searchInput();
    const list = results();
    if (!input || !list) return;
    const matches = searchBookmarks(bookmarks, input.value);
    list.innerHTML = matches.map((bookmark) => `<li role="option"><a${isHttpUrl(bookmark.url) ? ` href="${escapeHtml(bookmark.url)}"` : ''}>${escapeHtml(bookmark.title)}</a></li>`).join('');
  };
  searchInput()?.addEventListener('input', () => {
    paintSearch();
    if (note()) note()!.textContent = '';
  });
  searchInput()?.addEventListener('keydown', (event) => {
    const links = [...(results()?.querySelectorAll<HTMLAnchorElement>('a') ?? [])];
    if (event.key === 'ArrowDown' && links.length) {
      event.preventDefault();
      links[0].focus();
      return;
    }
    if (event.key === 'Enter' && links.length && event.altKey) links[0].click();
  });
  results()?.addEventListener('keydown', (event) => {
    const links = [...(results()?.querySelectorAll<HTMLAnchorElement>('a') ?? [])];
    const current = links.findIndex((link) => link === document.activeElement);
    const next = nextIndex(current < 0 ? 0 : current, links.length, event.key);
    if (next === undefined) return;
    event.preventDefault();
    links[next]?.focus();
  });
  root.querySelector<HTMLFormElement>('#search-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = searchInput()?.value.trim() ?? '';
    if (!query) return;
    const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    const plan = planWebSearch(searchUrl, query, online);
    if (!plan.sent) {
      if (note()) note()!.textContent = text.webSearchNotSent;
      return;
    }
    if (typeof location !== 'undefined') location.assign(plan.url);
  });

  root.querySelector<HTMLButtonElement>('#save-current')?.addEventListener('click', async () => {
    const response = await sendRuntime(port, 'save', {});
    if (note()) note()!.textContent = response?.unsavable ? text.cannotSave : response?.ok ? text.saved : text.notSaved;
    if (response?.ok) await load();
  });
  root.querySelector<HTMLButtonElement>('#import-html')?.addEventListener('click', async () => {
    const content = await chooseTextFile('.html,text/html');
    if (!content) return;
    const action = root.querySelector<HTMLSelectElement>('#import-action')?.value ?? 'skip';
    const response = await sendRuntime(port, 'import', { format: 'html', content, action });
    if (note()) note()!.textContent = response?.ok ? text.importDone : text.importFailed;
    if (response?.ok) await load();
  });

  const load = async () => {
    const [listed, folderResponse, engine, config, metadata] = await Promise.all([
      sendRuntime(port, 'list', { includeDeleted: false }),
      sendRuntime(port, 'list-collections'),
      sendRuntime(port, 'get-search-engine'),
      sendRuntime(port, 'get-sync-config'),
      sendRuntime(port, 'sync-status'),
    ]);
    bookmarks = Array.isArray(listed?.items) ? listed.items : [];
    collections = Array.isArray(folderResponse?.items) ? folderResponse.items : [];
    if (typeof engine?.url === 'string') searchUrl = engine.url;
    model = buildBar(bookmarks, collections);
    const phrase = homeSyncPhrase({
      configured: Boolean(config?.config?.configured),
      status: metadata?.metadata?.status,
      error: metadata?.metadata?.error,
    });
    const syncLine = root.querySelector<HTMLElement>('#sync-line');
    if (syncLine) syncLine.innerHTML = renderSyncLine(phrase, language);
    render();
    paintSearch();
  };

  if (typeof ResizeObserver !== 'undefined') {
    const target = bar();
    if (target) new ResizeObserver(() => layoutBar()).observe(target);
  }
  void load();
}

export { homeDocument };
