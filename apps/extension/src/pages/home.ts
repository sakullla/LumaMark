import type { Bookmark, Collection } from '../../../../packages/domain/src/index';
import { homeDocument, renderSyncLine, searchBookmarks } from '../ui/index';
import {
  barDropParent,
  barItemBudget,
  buildBar,
  dropIntent,
  hasDisplayableBookmarks,
  homeSyncPhrase,
  menuParentId,
  nextIndex,
  planWebSearch,
  renderBarEntries,
  visibleItemCount,
  type BarModel,
} from '../ui/bar';
import { copyFor, detectUiLanguage } from '../ui/copy';
import { escapeHtml } from '../ui/html';
import { bindIconFallback } from '../ui/icons';
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

  const bar = () => root.querySelector<HTMLElement>('#bookmark-bar');
  const note = () => root.querySelector<HTMLElement>('#search-note');
  const results = () => root.querySelector<HTMLElement>('#search-results');

  const layoutBar = () => {
    if (layingOut) return;
    layingOut = true;
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
      layingOut = false;
    }
  };

  const render = () => {
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
      `<div class="bar-menu overflow-menu" hidden><button type="button" class="bar-hit" id="overflow-button" aria-expanded="false">${escapeHtml(text.overflow)}</button><div class="folder-menu" id="overflow-menu" hidden data-parent-id="${escapeHtml(parent)}"></div></div>${other}`;
    bindIconFallback(target);
    layoutBar();
  };

  const toggleMenu = (button: HTMLElement) => {
    const menu = button.parentElement?.querySelector<HTMLElement>(':scope > .folder-menu');
    if (!menu) return;
    const open = menu.hidden;
    button.parentElement?.parentElement?.querySelectorAll<HTMLElement>(':scope > .folder > .folder-menu, :scope > .bar-menu > .folder-menu').forEach((otherMenu) => {
      if (otherMenu !== menu) otherMenu.hidden = true;
    });
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector<HTMLElement>('a, button')?.focus();
  };

  const focusRow = (container: HTMLElement, key: string) => {
    const items = [...container.querySelectorAll<HTMLElement>(':scope > a.bar-item, :scope > .folder > .bar-hit, :scope > .bar-menu > .bar-hit')];
    const current = items.findIndex((item) => item === document.activeElement);
    const next = nextIndex(current < 0 ? 0 : current, items.length, key);
    if (next === undefined) return false;
    items[next]?.focus();
    return true;
  };

  bar()?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('.folder > .bar-hit, #other-bookmarks, #overflow-button');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    toggleMenu(button);
  });

  bar()?.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    const key = event.key;
    if (key === 'Escape') {
      root.querySelectorAll<HTMLElement>('.folder-menu').forEach((menu) => { menu.hidden = true; });
      return;
    }
    if ((key === 'Enter' || key === ' ') && target.matches('.folder > .bar-hit, #other-bookmarks, #overflow-button')) {
      event.preventDefault();
      toggleMenu(target);
      return;
    }
    if (key === 'ArrowDown' && target.matches('.folder > .bar-hit, #other-bookmarks, #overflow-button')) {
      event.preventDefault();
      const menu = target.parentElement?.querySelector<HTMLElement>(':scope > .folder-menu');
      if (!menu) return;
      menu.hidden = false;
      target.setAttribute('aria-expanded', 'true');
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
      nested.hidden = false;
      target.setAttribute('aria-expanded', 'true');
      nested.querySelector<HTMLElement>('a, button')?.focus();
      return;
    }
    if (!focusRow(host, key)) return;
    if (key.startsWith('Arrow') || key === 'Home' || key === 'End') event.preventDefault();
  });

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
      inBar: Boolean(hit.closest('#bookmark-bar')),
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
    list.innerHTML = matches.map((bookmark) => `<li role="option"><a href="${escapeHtml(bookmark.url)}">${escapeHtml(bookmark.title)}</a></li>`).join('');
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
