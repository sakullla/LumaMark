import { escapeHtml } from './html';
import { uiIcon, type UiIconName } from './icons';

export interface FolderPickerCopy {
  searchFolders: string;
  noFoldersFound: string;
}

interface FolderChoice {
  value: string;
  label: string;
  depth: number;
  icon: UiIconName;
}

/** Drop the leading depth marks that native options use, keeping a name that itself starts with "· ". */
export function folderChoiceLabel(text: string, depth = 0): string {
  const prefix = '· '.repeat(Math.max(0, depth));
  return prefix && text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/**
 * Replace a folder `<select>` popup with a searchable list.
 * The select stays in the form so existing `.value` reads keep working; only the menu is custom.
 */
export function bindFolderPicker(select: HTMLSelectElement | null, copy: FolderPickerCopy): void {
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
  let choices: FolderChoice[] = [];

  const panelOpen = () => panel.matches(':popover-open');
  const choicesFrom = (query: string): FolderChoice[] => {
    const needle = query.trim().toLowerCase();
    const rows: FolderChoice[] = [];
    for (const option of select.options) {
      const depth = Number(option.dataset.depth ?? 0) || 0;
      const label = folderChoiceLabel(option.textContent ?? '', depth);
      if (needle && !label.toLowerCase().includes(needle)) continue;
      const icon: UiIconName = !option.value ? 'inbox' : option.dataset.toolbar ? 'bookmark' : 'folder';
      rows.push({ value: option.value, label, depth: needle ? 0 : depth, icon });
    }
    return rows;
  };
  const syncTrigger = () => {
    const option = select.selectedOptions[0];
    const depth = Number(option?.dataset.depth ?? 0) || 0;
    valueEl.textContent = folderChoiceLabel(option?.textContent ?? '', depth);
    const icon: UiIconName = !select.value ? 'inbox' : option?.dataset.toolbar ? 'bookmark' : 'folder';
    iconEl.innerHTML = uiIcon(icon);
  };
  const paint = () => {
    choices = choicesFrom(search.value);
    if (active >= choices.length) active = Math.max(choices.length - 1, 0);
    if (!choices.length) {
      list.innerHTML = `<p class="pick-empty">${escapeHtml(copy.noFoldersFound)}</p>`;
      search.removeAttribute('aria-activedescendant');
      return;
    }
    const current = select.value;
    list.innerHTML = choices.map((choice, index) => {
      const id = `${select.id}-opt-${index}`;
      const pad = (0.65 + choice.depth * 0.9).toFixed(2);
      const check = choice.value === current ? `<span class="pick-check">${uiIcon('check')}</span>` : '';
      return `<button type="button" role="option" id="${id}" class="pick-row${choice.value === current ? ' is-current' : ''}" data-value="${escapeHtml(choice.value)}" aria-selected="${index === active}" tabindex="-1" style="padding-left:${pad}rem">${uiIcon(choice.icon)}<span class="pick-text"><span>${escapeHtml(choice.label)}</span></span>${check}</button>`;
    }).join('');
    const selectedRow = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!selectedRow) {
      search.removeAttribute('aria-activedescendant');
      return;
    }
    search.setAttribute('aria-activedescendant', selectedRow.id);
    const top = selectedRow.offsetTop;
    const bottom = top + selectedRow.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  };
  const place = () => {
    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const edge = 8;
    const below = window.innerHeight - rect.bottom - gap - edge;
    const above = rect.top - gap - edge;
    const upward = below < 200 && above > below;
    const room = Math.max(148, Math.min(320, upward ? above : below));
    const width = Math.min(Math.max(rect.width, 220), window.innerWidth - edge * 2);
    const left = Math.min(Math.max(edge, rect.left), window.innerWidth - width - edge);
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
    panel.style.width = `${width}px`;
    panel.style.maxHeight = `${room}px`;
    list.style.maxHeight = `${Math.max(96, room - 46)}px`;
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
  const open = (query = '') => {
    if (panelOpen()) return;
    search.value = query;
    const rows = choicesFrom(query);
    const current = rows.findIndex((choice) => choice.value === select.value);
    active = current >= 0 ? current : 0;
    panel.showPopover();
    trigger.setAttribute('aria-expanded', 'true');
    place();
    paint();
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
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      open(event.key);
    }
  });
  search.addEventListener('input', () => {
    const rows = choicesFrom(search.value);
    const current = rows.findIndex((choice) => choice.value === select.value);
    active = current >= 0 ? current : 0;
    paint();
  });
  search.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!choices.length) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
      paint();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      choose(choices[active]?.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      trigger.focus();
    }
  });
  list.addEventListener('mousedown', (event) => event.preventDefault());
  list.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-value]');
    if (!row || !list.contains(row)) return;
    choose(row.dataset.value ?? '');
  });
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
  window.addEventListener('scroll', onReflow, true);
  select.addEventListener('change', syncTrigger);
  new MutationObserver(() => { syncTrigger(); if (panelOpen()) paint(); }).observe(select, { childList: true });
  select.closest('dialog')?.addEventListener('close', () => close());
  const editor = select.closest('#editor');
  if (editor) new MutationObserver(() => { if ((editor as HTMLElement).hidden) close(); }).observe(editor, { attributes: true, attributeFilter: ['hidden'] });
  syncTrigger();
}
