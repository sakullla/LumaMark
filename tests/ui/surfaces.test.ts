import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeBookmark, type Collection } from '../../packages/domain/src/index';
import {
  bookmarksInFolder,
  homeDocument,
  libraryDocument,
  libraryFailureMessage,
  popupDocument,
  renderConflicts,
  renderEmptyState,
  renderSyncLine,
  searchBookmarks,
  settingsDocument,
  defaultLibraryFilters,
  renderLibraryResults,
} from '../../apps/extension/src/ui/index';
import { mountHome } from '../../apps/extension/src/pages/home';
import { mountLibrary } from '../../apps/extension/src/pages/library';
import { mountPopup } from '../../apps/extension/src/pages/popup';
import { mountSettings } from '../../apps/extension/src/pages/settings';
import {
  barDropParent,
  barItemBudget,
  buildBar,
  buildSearchUrl,
  dropIntent,
  hasDisplayableBookmarks,
  homeSyncPhrase,
  menuParentId,
  nextIndex,
  planWebSearch,
  renderBarEntries,
  titleInitial,
  visibleItemCount,
} from '../../apps/extension/src/ui/bar';
import { uiLanguage } from '../../apps/extension/src/ui/copy';

const now = '2024-01-01T00:00:00.000Z';
const folder = (id: string, extra: Partial<Collection> = {}): Collection => ({
  id, name: id, position: 0, toolbar: false, createdAt: now, updatedAt: now, revision: 1, ...extra,
});

describe('bookmark bar and shared surfaces', () => {
  it('builds one toolbar row, nests folders, and hides deleted or empty other bookmarks', () => {
    const bar = folder('bar', { name: 'Toolbar', toolbar: true });
    const nest = folder('nest', { name: 'Nested', parentId: 'bar', position: 1 });
    const outside = folder('out', { name: 'Outside', position: 1 });
    const inside = makeBookmark({ url: 'https://in.example/a', title: 'Inside', collectionId: 'bar', position: 0 }, now);
    const child = makeBookmark({ url: 'https://child.example/a', title: 'Child', collectionId: 'nest', position: 0 }, now);
    const loose = makeBookmark({ url: 'https://loose.example/a', title: 'Loose', position: 2 }, now);
    const deleted = { ...makeBookmark({ url: 'https://gone.example/a', title: 'Gone', collectionId: 'bar', position: 2 }, now), deletedAt: now };
    const model = buildBar([inside, child, loose, deleted], [bar, nest, outside]);
    expect(model.toolbarId).toBe('bar');
    expect(model.items.map((item) => item.id)).toEqual([inside.id, 'nest']);
    expect(model.items[1]?.children.map((item) => item.id)).toEqual([child.id]);
    expect(model.other.map((item) => item.id)).toEqual(['out', loose.id]);
    expect(hasDisplayableBookmarks([deleted])).toBe(false);
    const markup = renderBarEntries(model.items, 'bar');
    expect(markup).toContain(`href="${inside.url}"`);
    expect(markup).not.toContain('target=');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain(`>${titleInitial(inside.title)}<`);
    expect(markup).toContain('item-fallback');
    expect(markup).toContain('class="bar-item folder"');
    expect(markup).toContain('item-glyph');
    expect(markup).toContain('<svg');
    expect(markup).toContain('aria-hidden="true"');
    const icon = renderBarEntries([{ kind: 'bookmark', id: 'icon', title: 'Icon', url: 'https://icon.example/a', faviconUrl: 'https://icon.example/favicon.ico', children: [] }]);
    expect(icon).toContain(`data-initial="${titleInitial('Icon')}"`);
    const open = buildBar([loose], [folder('plain', { name: 'Plain' })]);
    expect(open.toolbarId).toBeUndefined();
    expect(open.other).toEqual([]);
    expect(open.items.map((item) => item.id)).toEqual(['plain', loose.id]);
  });

  it('plans local search and a single home sync sentence', () => {
    expect(buildSearchUrl('https://search.example/find?q={query}', 'a b')).toBe('https://search.example/find?q=a%20b');
    expect(buildSearchUrl('https://search.example/find', 'a b')).toBe('https://search.example/find?q=a+b');
    expect(planWebSearch('https://search.example/find?q={query}', 'docs', false)).toEqual({ sent: false, reason: 'offline' });
    expect(homeSyncPhrase({ configured: false, status: 'offline' })).toBe('local-only');
    expect(homeSyncPhrase({ configured: true, status: 'offline' })).toBe('waiting-network');
    expect(homeSyncPhrase({ configured: true, status: 'error', error: 'Failed to fetch' })).toBe('waiting-network');
    expect(homeSyncPhrase({ configured: true, status: 'error', error: '401' })).toBe('needs-attention');
    expect(homeSyncPhrase({ configured: true, status: 'conflict' })).toBe('needs-attention');
    expect(homeSyncPhrase({ configured: true, status: 'idle' })).toBe('aligned');
    expect(renderSyncLine('needs-attention')).toContain('href="settings.html"');
    expect(renderSyncLine('needs-attention')).toContain('class="sync-dot danger"');
    expect(renderSyncLine('local-only')).toContain('Only on this browser');
    expect(renderSyncLine('local-only')).toContain('class="sync-dot"');
    expect(renderSyncLine('local-only')).not.toContain('sync-dot danger');
  });

  it('keeps overflow and drag decisions independent of the page width measurement', () => {
    expect(visibleItemCount([20, 20, 20], 0)).toBe(0);
    expect(visibleItemCount([20, 20, 20], 50)).toBe(2);
    const content = barItemBudget({ clientWidth: 200, padding: 8 });
    expect(content).toBe(192);
    expect(visibleItemCount([100, 96], content)).toBe(1);
    expect(barItemBudget({ clientWidth: 200, padding: 8, otherWidth: 40, overflowWidth: 30, barGap: 4 })).toBe(114);
    expect(barDropParent({ inBar: false, onOtherButton: false })).toBe('');
    expect(barDropParent({ inBar: true, onOtherButton: true })).toBe('');
    expect(barDropParent({ inBar: true, onOtherButton: false })).toBeUndefined();
    expect(menuParentId(null, 'bar')).toBe('bar');
    expect(menuParentId('', 'bar')).toBe('');
    expect(menuParentId('folder', '')).toBe('folder');
    expect(dropIntent({ kind: 'folder', start: 0, size: 100, point: 50 })).toBe('inside');
    expect(dropIntent({ kind: 'bookmark', start: 0, size: 100, point: 20 })).toBe('before');
    expect(dropIntent({ kind: 'bookmark', start: 0, size: 100, point: 80 })).toBe('after');
    expect(nextIndex(0, 3, 'End')).toBe(2);
  });

  it('renders the four surfaces in the browser language without a first-screen form', () => {
    expect(uiLanguage('zh-CN')).toBe('zh');
    expect(uiLanguage('en-US')).toBe('en');
    const home = homeDocument();
    const homeZh = homeDocument('zh');
    const library = libraryDocument();
    const settings = settingsDocument();
    const settingsZh = settingsDocument('zh');
    expect(home).toContain('LumaMark');
    expect(home).toContain('id="bookmark-bar"');
    expect(home.indexOf('id="bookmark-bar"')).toBeLessThan(home.indexOf('class="brand"'));
    expect(home.indexOf('id="bookmark-bar"')).toBeLessThan(home.indexOf('id="sync-line"'));
    expect(home).toContain('value="skip"');
    expect(home).toContain('value="update"');
    expect(home).toContain('value="copy"');
    expect(home).not.toMatch(/autofocus/i);
    expect(home).not.toMatch(/type="password"|webdav/i);
    expect(homeZh).toContain('书签栏');
    expect(homeZh).toContain('保存当前页');
    expect(popupDocument()).toContain('aria-live');
    expect(popupDocument()).not.toMatch(/autofocus/i);
    expect(library).toContain('Search title, URL, tags, or notes');
    expect(library).toContain('id="batch-actions" hidden');
    expect(library).toContain('<details id="more-filters">');
    expect(library).not.toContain('<details id="more-filters" open');
    expect(settings).toContain('WebDAV URL');
    expect(settings).toContain('other desktop browsers get the same bookmarks');
    expect(settings).toContain('type="password"');
    expect(settings).not.toContain('value="secret"');
    expect(settingsZh).toContain('用来让其他桌面浏览器得到同一套书签');
    for (const html of [home, homeZh, settings, settingsZh, library, popupDocument('zh')]) {
      expect(html).not.toMatch(/全文|团队协作|社交分享|移动 Safari|注册|登录|配对|full-text archive|team collaboration|social sharing|Mobile Safari|pairing code|sign in/i);
    }
    expect(renderEmptyState({ ...defaultLibraryFilters(), text: 'missing' })).toContain('clear-filters');
    expect(renderEmptyState({ ...defaultLibraryFilters(), text: 'missing' })).toContain('class="empty-icon"');
    expect(renderEmptyState(defaultLibraryFilters())).toContain('Save current page');
    expect(renderEmptyState(defaultLibraryFilters())).toContain('class="primary"');
    expect(renderEmptyState(defaultLibraryFilters())).toContain('<svg');
    expect(libraryFailureMessage()).not.toContain('No bookmarks yet');
    expect(libraryFailureMessage('zh')).not.toContain('还没有书签');
    const conflicts = renderConflicts([{ id: 'c', local: { title: 'Local', url: 'https://local.example', notes: 'mine' }, remote: { title: 'Remote', url: 'https://remote.example', notes: 'theirs' } }]);
    expect(conflicts).toContain('Local');
    expect(conflicts).toContain('Remote');
    expect(conflicts).toContain('data-resolution="local"');
    expect(conflicts).toContain('data-resolution="remote"');
    expect(conflicts).not.toContain('data-resolution="merged"');
    expect(typeof mountHome).toBe('function');
    expect(typeof mountLibrary).toBe('function');
    expect(typeof mountPopup).toBe('function');
    expect(typeof mountSettings).toBe('function');
  });

  it('searches and lists only the selected folder', () => {
    const first = makeBookmark({ url: 'https://example.com/one', title: 'One', notes: 'alpha note', tags: ['work'], collectionId: 'bar' }, now);
    const second = makeBookmark({ url: 'https://other.test/two', title: 'Two', notes: 'beta note', collectionId: 'else' }, now);
    expect(bookmarksInFolder([first, second], 'bar', defaultLibraryFilters()).map((item) => item.id)).toEqual([first.id]);
    expect(searchBookmarks([first, second], 'alpha').map((item) => item.id)).toEqual([first.id]);
    expect(searchBookmarks([first, second], 'other.test').map((item) => item.id)).toEqual([second.id]);
    const nested = makeBookmark({ url: 'https://nested.example/a', title: 'Nested', collectionId: 'child' }, now);
    const folderEmpty = renderLibraryResults([nested], 'bar', defaultLibraryFilters());
    expect(folderEmpty).not.toContain('No bookmarks yet');
    expect(folderEmpty).not.toContain('Save current page');
    expect(folderEmpty).toContain('This folder has no bookmarks.');
    expect(renderLibraryResults([nested], 'bar', defaultLibraryFilters(), 'zh')).not.toContain('还没有书签');
    expect(renderLibraryResults([], null, defaultLibraryFilters())).toContain('No bookmarks yet');
    expect(renderLibraryResults([], null, defaultLibraryFilters())).toContain('Save current page');
  });

  it('leaves the new tab page alone, syncs browser bookmarks and avoids dialog functions', () => {
    for (const name of ['chrome', 'firefox']) {
      const manifest = JSON.parse(readFileSync(`apps/extension/manifest.${name}.json`, 'utf8'));
      expect(manifest.chrome_url_overrides).toBeUndefined();
      expect(manifest.permissions).toContain('bookmarks');
      expect(manifest.permissions).toContain('alarms');
      if (name === 'chrome') expect(manifest.host_permissions).toEqual(expect.arrayContaining(['http://*/*', 'https://*/*']));
    }
    const pages = ['popup.ts', 'library.ts', 'settings.ts', 'home.ts'];
    for (const page of pages) {
      const source = readFileSync(`apps/extension/src/pages/${page}`, 'utf8');
      expect(source).not.toMatch(/\b(prompt|confirm|alert)\s*\(/);
    }
    const content = readFileSync('apps/extension/src/content/index.ts', 'utf8');
    expect(content).not.toContain('bookmark-bar');
    const home = readFileSync('apps/extension/src/pages/home.ts', 'utf8');
    expect(home).toContain('id="overflow-menu" hidden data-parent-id="${escapeHtml(parent)}"');
    expect(home).toContain('menuParentId(menu.getAttribute(\'data-parent-id\'), parentId)');
    const css = readFileSync('apps/extension/src/styles/main.css', 'utf8');
    expect(css).toContain('color-scheme: light');
    expect(css).toContain('prefers-color-scheme: dark');
    expect(css).toContain('flex-wrap: nowrap');
    expect(css).toContain('max-width: 720px');
  });
});
