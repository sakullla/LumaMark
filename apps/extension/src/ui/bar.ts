import {
  Bookmark,
  Collection,
  comparePositionThenId,
  migrateCollection,
  isSeparator,
  orderedSiblings,
  sortByPosition,
} from '../../../../packages/domain/src/index';
import { escapeHtml } from './html';
import { folderIcon } from './icons';

export const DEFAULT_SEARCH_URL = 'https://www.google.com/search?q={query}';

export interface BarEntry {
  kind: 'bookmark' | 'folder';
  id: string;
  title: string;
  url?: string;
  faviconUrl?: string;
  children: BarEntry[];
}

export interface BarModel {
  toolbarId?: string;
  items: BarEntry[];
  other: BarEntry[];
}

export function toolbarFolder(collections: readonly Collection[]): Collection | undefined {
  return sortByPosition(collections.filter((collection) => !collection.deletedAt && migrateCollection(collection).toolbar))[0];
}

export function buildBar(bookmarks: readonly Bookmark[], collections: readonly Collection[]): BarModel {
  const toolbar = toolbarFolder(collections);
  const shown = bookmarks.filter((bookmark) => !isSeparator(bookmark));
  const entries = (parentId: string | undefined): BarEntry[] => orderedSiblings(parentId, shown, collections).map((item) => {
    if (item.kind === 'folder') {
      return { kind: 'folder', id: item.record.id, title: item.record.name, children: entries(item.record.id) };
    }
    return {
      kind: 'bookmark',
      id: item.record.id,
      title: item.record.title,
      url: item.record.url,
      faviconUrl: item.record.faviconUrl,
      children: [],
    };
  });
  if (!toolbar) return { items: entries(undefined), other: [] };
  return {
    toolbarId: toolbar.id,
    items: entries(toolbar.id),
    other: entries(undefined).filter((entry) => entry.id !== toolbar.id),
  };
}

export function hasDisplayableBookmarks(bookmarks: readonly Bookmark[]): boolean {
  return bookmarks.some((bookmark) => !bookmark.deletedAt);
}

export function titleInitial(title: string): string {
  return Array.from(title.trim())[0] || '?';
}

export function visibleItemCount(widths: readonly number[], container: number, trailing = 0, gap = 4): number {
  if (container <= 0) return 0;
  let used = Math.max(0, trailing);
  let count = 0;
  for (const width of widths) {
    const next = used + (count > 0 ? gap : 0) + width;
    if (next > container) break;
    used = next;
    count += 1;
  }
  return count;
}

/** Width left for bar items after padding, trailing controls, and the gaps before those controls. */
export function barItemBudget(input: {
  clientWidth: number;
  padding?: number;
  otherWidth?: number;
  overflowWidth?: number;
  barGap?: number;
}): number {
  const gap = input.barGap ?? 4;
  const other = Math.max(0, input.otherWidth ?? 0);
  const overflow = Math.max(0, input.overflowWidth ?? 0);
  const pieces = (other > 0 ? 1 : 0) + (overflow > 0 ? 1 : 0);
  const room = input.clientWidth - Math.max(0, input.padding ?? 0) - other - overflow - pieces * gap;
  return room > 0 ? room : 0;
}

/** '' moves to the top level. undefined keeps the drop on the item under the pointer. */
export function barDropParent(input: { inBar: boolean; onOtherButton: boolean }): '' | undefined {
  if (!input.inBar || input.onOtherButton) return '';
  return undefined;
}

/** A missing data-parent-id keeps the current folder. An empty attribute still means the top level. */
export function menuParentId(attribute: string | null, current: string): string {
  return attribute === null ? current : attribute;
}

export function buildSearchUrl(template: string, query: string): string {
  const source = template.trim() || DEFAULT_SEARCH_URL;
  const parsed = new URL(source);
  if (parsed.protocol !== 'https:') throw new Error('Search address must be https');
  if (source.includes('{query}')) return source.replaceAll('{query}', encodeURIComponent(query));
  parsed.searchParams.append('q', query);
  return parsed.toString();
}

export function normalizeSearchUrl(value: string): string {
  const source = value.trim();
  const parsed = new URL(source);
  if (parsed.protocol !== 'https:') throw new Error('Search address must be https');
  return source;
}

export type WebSearchPlan = { sent: false; reason: 'offline' | 'invalid' } | { sent: true; url: string };

export function planWebSearch(template: string, query: string, online: boolean): WebSearchPlan {
  if (!online) return { sent: false, reason: 'offline' };
  try {
    return { sent: true, url: buildSearchUrl(template, query) };
  } catch {
    return { sent: false, reason: 'invalid' };
  }
}

export type ProbeKind = 'ok' | 'credentials' | 'rejected' | 'space' | 'unreachable';

export function classifyHttpStatus(status: number): ProbeKind {
  if (status === 401) return 'credentials';
  if (status === 403 || status === 405) return 'rejected';
  if (status === 413 || status === 507) return 'space';
  if (status === 404 || (status >= 200 && status < 300)) return 'ok';
  if (status >= 400) return 'rejected';
  return 'ok';
}

export function classifyFailure(message: string | undefined): ProbeKind | 'other' | undefined {
  if (!message) return undefined;
  if (/\b401\b|credential/i.test(message)) return 'credentials';
  if (/\b403\b|\b405\b|rejected/i.test(message)) return 'rejected';
  if (/\b413\b|\b507\b|\bspace\b/i.test(message)) return 'space';
  if (/unreachable|failed to fetch|network|offline|load failed|timeout/i.test(message)) return 'unreachable';
  return 'other';
}

export type HomeSyncPhrase = 'local-only' | 'aligned' | 'waiting-network' | 'needs-attention';

export function homeSyncPhrase(input: { configured: boolean; status?: string; error?: string }): HomeSyncPhrase {
  if (!input.configured) return 'local-only';
  if (input.status === 'offline' || classifyFailure(input.error) === 'unreachable') return 'waiting-network';
  if (input.status === 'error' || input.status === 'conflict') return 'needs-attention';
  return 'aligned';
}

export function nextIndex(current: number, count: number, key: string): number | undefined {
  if (count <= 0) return undefined;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return undefined;
}

export function dropIntent(input: { kind: 'bookmark' | 'folder'; start: number; size: number; point: number }): 'before' | 'after' | 'inside' {
  const ratio = input.size <= 0 ? 0.5 : (input.point - input.start) / input.size;
  if (input.kind === 'folder' && ratio > 0.25 && ratio < 0.75) return 'inside';
  return ratio < 0.5 ? 'before' : 'after';
}

export function nextSiblingPosition(parentId: string | undefined, bookmarks: readonly Bookmark[], collections: readonly Collection[]): number {
  const siblings = orderedSiblings(parentId, bookmarks, collections);
  return siblings.reduce((highest, item) => Math.max(highest, item.record.position ?? 0), -1) + 1;
}

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface FolderNode {
  id: string;
  name: string;
  toolbar: boolean;
  children: FolderNode[];
}

export function folderTree(collections: readonly Collection[]): FolderNode[] {
  const alive = collections.filter((collection) => !collection.deletedAt).map((collection) => migrateCollection(collection));
  const walk = (parentId: string | undefined): FolderNode[] => alive
    .filter((collection) => (collection.parentId ?? undefined) === parentId)
    .sort(comparePositionThenId)
    .map((collection) => ({ id: collection.id, name: collection.name, toolbar: collection.toolbar === true, children: walk(collection.id) }));
  return walk(undefined);
}

function iconMarkup(title: string, faviconUrl?: string): string {
  const initial = escapeHtml(titleInitial(title));
  if (!faviconUrl) return `<span class="item-fallback" aria-hidden="true">${initial}</span>`;
  return `<span class="item-icon"><img src="${escapeHtml(faviconUrl)}" alt="" data-initial="${initial}"><span class="item-fallback" hidden>${initial}</span></span>`;
}

function entryMarkup(entry: BarEntry, parentId: string): string {
  const tooltip = `<span class="item-tooltip" role="tooltip">${escapeHtml(entry.title)}</span>`;
  const glyph = `<span class="item-glyph" aria-hidden="true">${folderIcon()}</span>`;
  const body = entry.kind === 'folder'
    ? `${glyph}<span class="item-label">${escapeHtml(entry.title)}</span>`
    : `${iconMarkup(entry.title, entry.faviconUrl)}<span class="item-label">${escapeHtml(entry.title)}</span>`;
  if (entry.kind === 'folder') {
    const children = entry.children.map((child) => entryMarkup(child, entry.id)).join('');
    return `<div class="bar-item folder" data-kind="folder" data-id="${escapeHtml(entry.id)}" data-parent-id="${escapeHtml(parentId)}" draggable="true">` +
      `<button type="button" class="bar-hit" aria-expanded="false" title="${escapeHtml(entry.title)}">${body}</button>${tooltip}` +
      `<div class="folder-menu" hidden role="menu" data-parent-id="${escapeHtml(entry.id)}">${children}</div></div>`;
  }
  const href = entry.url && isHttpUrl(entry.url) ? ` href="${escapeHtml(entry.url)}"` : '';
  return `<a class="bar-item"${href} data-kind="bookmark" data-id="${escapeHtml(entry.id)}" data-parent-id="${escapeHtml(parentId)}" draggable="true" title="${escapeHtml(entry.title)}">${body}${tooltip}</a>`;
}

export function renderBarEntries(entries: readonly BarEntry[], parentId = ''): string {
  return entries.map((entry) => entryMarkup(entry, parentId)).join('');
}
