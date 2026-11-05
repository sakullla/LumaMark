import { escapeHtml } from './html';
import { uiIcon, type UiIconName } from './icons';

export interface FolderPickerCopy {
  searchFolders: string;
  noFoldersFound: string;
  createNamed?: string;
  expandFolder?: string;
  collapseFolder?: string;
}

export interface FolderPickerOptions {
  /** Offer “Create …” when the search names no folder. Resolves to the new folder id once the select lists it. */
  create?: (name: string) => Promise<string | undefined>;
}

/** One option of the native select, read back as a tree node. */
export interface PickerOption {
  value: string;
  label: string;
  depth: number;
  toolbar: boolean;
  /** Overrides the folder glyph, for fixed choices such as “Unfiled”. */
  icon?: UiIconName;
}

/** A visible row of the menu. `match` is false for ancestors shown only to give a search hit its place. */
export interface PickerRow extends PickerOption {
  parent?: string;
  hasChildren: boolean;
  expanded: boolean;
  match: boolean;
}

/** Folders the person opened in a picker; shared by every picker so the tree looks the same everywhere. */
export const PICKER_EXPANDED_KEY = 'lumamark-picker-expanded';

/** Drop the leading depth marks that native options use, keeping a name that itself starts with "· ". */
export function folderChoiceLabel(text: string, depth = 0): string {
  const prefix = '· '.repeat(Math.max(0, depth));
  return prefix && text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/** Parent of each option, read from the depth order the options are written in. */
export function pickerParents(options: readonly PickerOption[]): Map<string, string | undefined> {
  const parents = new Map<string, string | undefined>();
  const stack: PickerOption[] = [];
  for (const option of options) {
    while (stack.length && stack[stack.length - 1].depth >= option.depth) stack.pop();
    parents.set(option.value, option.value ? stack[stack.length - 1]?.value : undefined);
    if (option.value) stack.push(option);
  }
  return parents;
}

/** Ids from the root down to (not including) `value`. */
export function pickerAncestors(options: readonly PickerOption[], value: string): string[] {
  const parents = pickerParents(options);
  const chain: string[] = [];
  const seen = new Set<string>();
  let parent = parents.get(value);
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    chain.unshift(parent);
    parent = parents.get(parent);
  }
  return chain;
}

/**
 * Rows to show. Without a query: the tree, hiding what sits under a closed folder.
 * With a query: every match plus the folders that hold it, all open, so a hit is never shown out of context.
 */
export function pickerRows(options: readonly PickerOption[], state: { query?: string; expanded: ReadonlySet<string> }): PickerRow[] {
  const parents = pickerParents(options);
  const withChildren = new Set<string>();
  for (const parent of parents.values()) if (parent) withChildren.add(parent);
  const needle = (state.query ?? '').trim().toLowerCase();
  if (!needle) {
    const rows: PickerRow[] = [];
    let hiddenBelow = Infinity;
    for (const option of options) {
      if (option.depth > hiddenBelow) continue;
      hiddenBelow = Infinity;
      const hasChildren = withChildren.has(option.value);
      const expanded = hasChildren && state.expanded.has(option.value);
      rows.push({ ...option, parent: parents.get(option.value), hasChildren, expanded, match: true });
      if (hasChildren && !expanded) hiddenBelow = option.depth;
    }
    return rows;
  }
  const keep = new Set<string>();
  const hits = new Set<string>();
  for (const option of options) {
    if (!option.label.toLowerCase().includes(needle)) continue;
    hits.add(option.value);
    keep.add(option.value);
    let parent = parents.get(option.value);
    while (parent && !keep.has(parent)) { keep.add(parent); parent = parents.get(parent); }
  }
  return options.filter((option) => keep.has(option.value)).map((option) => ({
    ...option,
    parent: parents.get(option.value),
    hasChildren: withChildren.has(option.value),
    expanded: true,
    match: hits.has(option.value),
  }));
}

/** Wrap each case-insensitive occurrence of the query in <mark>; everything else stays escaped. */
export function highlightMatch(label: string, query: string): string {
  const needle = query.trim().toLowerCase();
  if (!needle) return escapeHtml(label);
  const lower = label.toLowerCase();
  let html = '';
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    html += `${escapeHtml(label.slice(from, at))}<mark>${escapeHtml(label.slice(at, at + needle.length))}</mark>`;
    from = at + needle.length;
  }
  return html + escapeHtml(label.slice(from));
}

function readExpanded(): Set<string> | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(PICKER_EXPANDED_KEY);
    if (raw === null || raw === undefined) return undefined;
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? new Set(value.filter((id): id is string => typeof id === 'string')) : undefined;
  } catch { return undefined; }
}

function writeExpanded(expanded: ReadonlySet<string>): void {
  try { globalThis.localStorage?.setItem(PICKER_EXPANDED_KEY, JSON.stringify([...expanded])); } catch { /* the tree stays open for this page only */ }
}

function optionsOf(select: HTMLSelectElement): PickerOption[] {
  return [...select.options].map((option) => {
    const depth = Number(option.dataset.depth ?? 0) || 0;
    return { value: option.value, label: folderChoiceLabel(option.textContent ?? '', depth), depth, toolbar: Boolean(option.dataset.toolbar) };
  });
}

const iconFor = (option: { value: string; toolbar: boolean; icon?: UiIconName } | undefined, open = false): UiIconName =>
  option?.icon ?? (!option?.value ? 'inbox' : option.toolbar ? 'bookmark' : open ? 'folderOpen' : 'folder');

/** One tree row. Shared by the inline pickers and the library's move dialog so both read the same. */
export function pickerRowHtml(row: PickerRow, view: { id: string; active: boolean; current: boolean; query: string; copy: Pick<FolderPickerCopy, 'expandFolder' | 'collapseFolder'> }): string {
  const twisty = row.hasChildren && !view.query.trim()
    ? `<span class="pick-twisty" data-toggle="${escapeHtml(row.value)}" title="${escapeHtml((row.expanded ? view.copy.collapseFolder : view.copy.expandFolder) ?? '')}">${uiIcon('chevronRight')}</span>`
    : '<span class="pick-twisty" aria-hidden="true"></span>';
  const classes = ['pick-row', 'tree-row', view.current ? 'is-current' : '', row.match ? '' : 'is-context'].filter(Boolean).join(' ');
  const expandedAttr = row.hasChildren ? ` aria-expanded="${row.expanded}"` : '';
  const check = view.current ? `<span class="pick-check">${uiIcon('check')}</span>` : '';
  return `<div role="treeitem" id="${escapeHtml(view.id)}" class="${classes}" data-value="${escapeHtml(row.value)}" aria-level="${row.depth + 1}" aria-selected="${view.current}"${expandedAttr}${view.active ? ' data-active="true"' : ''} style="--depth:${row.depth}">` +
    `${twisty}${uiIcon(iconFor(row, row.expanded && row.hasChildren))}<span class="pick-text"><span>${highlightMatch(row.label, view.query)}</span></span>${check}</div>`;
}

/** The “Create …” row offered when a search names no folder. */
export function pickerCreateHtml(id: string, label: string, active: boolean): string {
  return `<div role="treeitem" id="${escapeHtml(id)}" class="pick-row tree-row is-create" data-create="true" aria-level="1" aria-selected="false"${active ? ' data-active="true"' : ''} style="--depth:0"><span class="pick-twisty" aria-hidden="true"></span>${uiIcon('folderPlus')}<span class="pick-text"><span>${escapeHtml(label)}</span></span></div>`;
}

/** Read and keep the shared open-folder set. `fallback` seeds it the first time. */
export function pickerExpandedState(fallback: () => Iterable<string>): { get: () => Set<string>; save: (value: ReadonlySet<string>) => void } {
  return { get: () => readExpanded() ?? new Set(fallback()), save: writeExpanded };
}

type MenuRow = { kind: 'folder'; row: PickerRow } | { kind: 'create'; name: string };

/**
 * Replace a folder `<select>` popup with a searchable, collapsible tree.
 * The select stays in the form so existing `.value` reads keep working; only the menu is custom.
 */
export function bindFolderPicker(select: HTMLSelectElement | null, copy: FolderPickerCopy, settings: FolderPickerOptions = {}): void {
  if (!select || select.dataset.pickerBound === 'true') return;
  const root = select.ownerDocument;
  const trigger = root.getElementById(`${select.id}-trigger`);
  const panel = root.getElementById(`${select.id}-panel`);
  const search = root.getElementById(`${select.id}-search`);
  const list = root.getElementById(`${select.id}-list`);
  const valueEl = trigger?.querySelector<HTMLElement>('.folder-picker-value');
  const iconEl = trigger?.querySelector<HTMLElement>('.folder-picker-icon');
  if (!trigger || !panel || !(search instanceof HTMLInputElement) || !list || !valueEl || !iconEl) return;
  if (typeof panel.showPopover !== 'function') return;
  select.dataset.pickerBound = 'true';
  const label = root.querySelector<HTMLLabelElement>(`label[for="${trigger.id}"]`);
  if (label) {
    if (!label.id) label.id = `${select.id}-label`;
    valueEl.id = `${select.id}-value`;
    trigger.setAttribute('aria-labelledby', `${label.id} ${valueEl.id}`);
  }

  let active = 0;
  let rows: MenuRow[] = [];
  let busy = false;
  // First visit: open the bookmarks bar, which is where most saves land; everything else starts closed.
  // Read lazily: the options usually arrive after binding.
  const store = pickerExpandedState(() => optionsOf(select).filter((option) => option.toolbar).map((option) => option.value));
  let expanded = new Set<string>();

  const panelOpen = () => panel.matches(':popover-open');
  const query = () => search.value.trim();
  const build = (): MenuRow[] => {
    const options = optionsOf(select);
    const found: MenuRow[] = pickerRows(options, { query: query(), expanded }).map((row) => ({ kind: 'folder', row }));
    const name = query();
    if (name && settings.create && copy.createNamed && !options.some((option) => option.value && option.label.toLowerCase() === name.toLowerCase())) {
      found.push({ kind: 'create', name });
    }
    return found;
  };
  const indexOfValue = (value: string) => rows.findIndex((item) => item.kind === 'folder' && item.row.value === value);
  /** Prefer the current folder, then the first real hit, then the top. */
  const startIndex = () => {
    const current = indexOfValue(select.value);
    if (current >= 0 && (!query() || (rows[current] as { row: PickerRow }).row.match)) return current;
    const hit = rows.findIndex((item) => item.kind === 'create' || item.row.match);
    return hit >= 0 ? hit : 0;
  };
  const syncTrigger = () => {
    const option = select.selectedOptions[0];
    const depth = Number(option?.dataset.depth ?? 0) || 0;
    const name = folderChoiceLabel(option?.textContent ?? '', depth);
    valueEl.textContent = name;
    // The button shows only the name; the full path answers “which Dev?” on hover.
    const options = optionsOf(select);
    const names = new Map(options.map((item) => [item.value, item.label]));
    trigger.title = [...pickerAncestors(options, select.value).map((id) => names.get(id) ?? ''), name].join(' / ');
    iconEl.innerHTML = uiIcon(iconFor(option ? { value: option.value, toolbar: Boolean(option.dataset.toolbar) } : undefined));
  };
  const keepActiveVisible = () => {
    const row = list.querySelector<HTMLElement>('[data-active="true"]');
    if (!row) { search.removeAttribute('aria-activedescendant'); return; }
    search.setAttribute('aria-activedescendant', row.id);
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop + 4) list.scrollTop = Math.max(0, top - 4);
    else if (bottom > list.scrollTop + list.clientHeight - 4) list.scrollTop = bottom - list.clientHeight + 4;
  };
  const paint = () => {
    rows = build();
    if (active >= rows.length) active = Math.max(rows.length - 1, 0);
    if (!rows.length) {
      list.innerHTML = `<p class="pick-empty">${escapeHtml(copy.noFoldersFound)}</p>`;
      search.removeAttribute('aria-activedescendant');
      return;
    }
    const current = select.value;
    const needle = query();
    list.innerHTML = rows.map((item, index) => {
      const id = `${select.id}-opt-${index}`;
      if (item.kind === 'create') return pickerCreateHtml(id, (copy.createNamed ?? '{v}').replace('{v}', item.name), index === active);
      return pickerRowHtml(item.row, { id, active: index === active, current: item.row.value === current, query: needle, copy });
    }).join('');
    keepActiveVisible();
  };
  const place = () => {
    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const edge = 8;
    const below = window.innerHeight - rect.bottom - gap - edge;
    const above = rect.top - gap - edge;
    const upward = below < 220 && above > below;
    const room = Math.max(148, Math.min(360, upward ? above : below));
    const width = Math.min(Math.max(rect.width, 240), window.innerWidth - edge * 2);
    const left = Math.min(Math.max(edge, rect.left), window.innerWidth - width - edge);
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
    panel.style.width = `${width}px`;
    panel.style.maxHeight = `${room}px`;
    list.style.maxHeight = `${Math.max(96, room - 50)}px`;
    panel.dataset.side = upward ? 'top' : 'bottom';
    if (upward) {
      panel.style.top = 'auto';
      panel.style.bottom = `${window.innerHeight - rect.top + gap}px`;
    } else {
      panel.style.bottom = 'auto';
      panel.style.top = `${rect.bottom + gap}px`;
    }
  };
  const close = () => {
    if (panelOpen()) panel.hidePopover();
    trigger.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
  };
  const open = (initial = '') => {
    if (panelOpen()) return;
    // A fresh read: another page may have opened or closed folders since this one loaded.
    expanded = store.get();
    // Always show where the current choice lives, without saving that as a preference.
    for (const id of pickerAncestors(optionsOf(select), select.value)) expanded.add(id);
    search.value = initial;
    rows = build();
    active = startIndex();
    panel.showPopover();
    trigger.setAttribute('aria-expanded', 'true');
    place();
    paint();
    // Centre the current folder rather than leaving it pinned to an edge.
    const row = list.querySelector<HTMLElement>('[data-active="true"]');
    if (row && !initial) list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2);
    search.focus();
    const end = search.value.length;
    search.setSelectionRange(end, end);
  };
  const choose = (value: string | undefined) => {
    if (value === undefined) return;
    select.value = value;
    syncTrigger();
    select.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    trigger.focus();
  };
  const createFolder = async (name: string) => {
    if (!settings.create || busy) return;
    busy = true;
    panel.setAttribute('aria-busy', 'true');
    try {
      const id = await settings.create(name);
      if (id) choose(id);
    } finally {
      busy = false;
      panel.removeAttribute('aria-busy');
    }
  };
  const activate = (item: MenuRow | undefined) => {
    if (!item) return;
    if (item.kind === 'create') void createFolder(item.name);
    else choose(item.row.value);
  };
  const setExpanded = (value: string, open: boolean) => {
    if (open === expanded.has(value)) return;
    if (open) expanded.add(value); else expanded.delete(value);
    writeExpanded(expanded);
    paint();
  };

  trigger.addEventListener('click', () => { if (panelOpen()) close(); else open(); });
  trigger.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open();
    } else if (event.key === 'Escape' && panelOpen()) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      open(event.key);
    }
  });
  search.addEventListener('input', () => {
    rows = build();
    active = startIndex();
    list.scrollTop = 0;
    paint();
  });
  search.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    const item = rows[active];
    const browsing = !search.value;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!rows.length) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      paint();
    } else if ((event.key === 'PageDown' || event.key === 'PageUp') && rows.length) {
      event.preventDefault();
      active = Math.min(rows.length - 1, Math.max(0, active + (event.key === 'PageDown' ? 8 : -8)));
      paint();
    } else if (browsing && (event.key === 'Home' || event.key === 'End') && rows.length) {
      event.preventDefault();
      active = event.key === 'Home' ? 0 : rows.length - 1;
      paint();
    } else if (browsing && event.key === 'ArrowRight' && item?.kind === 'folder' && item.row.hasChildren) {
      // Right opens a closed folder, then steps into it.
      event.preventDefault();
      if (!item.row.expanded) setExpanded(item.row.value, true);
      else { active += 1; paint(); }
    } else if (browsing && event.key === 'ArrowLeft' && item?.kind === 'folder') {
      // Left closes an open folder, then climbs to its parent.
      event.preventDefault();
      if (item.row.hasChildren && item.row.expanded) setExpanded(item.row.value, false);
      else if (item.row.parent) { active = Math.max(0, indexOfValue(item.row.parent)); paint(); }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      activate(item);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (search.value) { search.value = ''; search.dispatchEvent(new Event('input')); return; }
      close();
      trigger.focus();
    } else if (event.key === 'Tab') {
      close();
    }
  });
  list.addEventListener('mousedown', (event) => event.preventDefault());
  list.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const toggle = target.closest<HTMLElement>('[data-toggle]');
    if (toggle && list.contains(toggle)) {
      const value = toggle.dataset.toggle ?? '';
      active = Math.max(0, indexOfValue(value));
      setExpanded(value, !expanded.has(value));
      search.focus();
      return;
    }
    const row = target.closest<HTMLElement>('.tree-row');
    if (!row || !list.contains(row)) return;
    if (row.dataset.create) { void createFolder(query()); return; }
    choose(row.dataset.value ?? '');
  });
  list.addEventListener('dblclick', (event) => event.preventDefault());
  root.addEventListener('keydown', (event) => {
    if (!panelOpen() || event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    close();
    trigger.focus();
  }, true);
  root.addEventListener('pointerdown', (event) => {
    if (!panelOpen()) return;
    const target = event.target as Node | null;
    if (target && (panel.contains(target) || trigger.contains(target))) return;
    close();
  }, true);
  const onReflow = () => { if (panelOpen()) place(); };
  window.addEventListener('resize', onReflow);
  window.addEventListener('scroll', (event) => { if (!panel.contains(event.target as Node)) onReflow(); }, true);
  select.addEventListener('change', syncTrigger);
  new MutationObserver(() => { syncTrigger(); if (panelOpen()) paint(); }).observe(select, { childList: true });
  select.closest('dialog')?.addEventListener('close', () => close());
  const editor = select.closest('#editor');
  if (editor) new MutationObserver(() => { if ((editor as HTMLElement).hidden) close(); }).observe(editor, { attributes: true, attributeFilter: ['hidden'] });
  syncTrigger();
}
