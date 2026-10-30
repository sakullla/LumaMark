import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeBookmark, type Collection } from '../../packages/domain/src/index';
import { folderCounts, libraryDocument, popupDocument, renderBookmarkCard, renderFolderTree, settingsDocument, tileHue } from '../../apps/extension/src/ui/index';
import { bookmarkCountLabel, copyFor, fill, relativeTime } from '../../apps/extension/src/ui/copy';
import { popupRuntimeMessage } from '../../apps/extension/src/pages/popup';

const stamp = '2026-01-01T00:00:00.000Z';
const folder = (id: string, name: string, extra: Partial<Collection> = {}): Collection => ({ id, name, position: 0, toolbar: false, createdAt: stamp, updatedAt: stamp, revision: 1, ...extra });

describe('redesigned surfaces', () => {
  it('ships toolbar and store icons for every manifest', () => {
    for (const name of ['chrome', 'firefox']) {
      const manifest = JSON.parse(readFileSync(`apps/extension/manifest.${name}.json`, 'utf8'));
      const action = manifest.action ?? manifest.browser_action;
      for (const path of [...Object.values(manifest.icons), ...Object.values(action.default_icon)] as string[]) {
        expect(existsSync(`apps/extension/src/${path}`)).toBe(true);
      }
    }
  });

  it('fills placeholders, counts bookmarks and phrases relative times in both languages', () => {
    expect(fill('{n} of {total}', { n: 2, total: 5 })).toBe('2 of 5');
    expect(fill('{missing}', {})).toBe('{missing}');
    expect(bookmarkCountLabel(1)).toBe('1 bookmark');
    expect(bookmarkCountLabel(3, 'zh')).toBe('3 个书签');
    const now = Date.parse('2026-01-02T12:00:00.000Z');
    expect(relativeTime(undefined, 'en', now)).toBe('Never');
    expect(relativeTime('2026-01-02T11:59:30.000Z', 'en', now)).toBe('just now');
    expect(relativeTime('2026-01-02T11:15:00.000Z', 'en', now)).toBe('45m ago');
    expect(relativeTime('2026-01-02T09:00:00.000Z', 'zh', now)).toBe('3 小时前');
    expect(relativeTime('2025-12-30T12:00:00.000Z', 'en', now)).toBe('3d ago');
  });

  it('shows folder icons and live bookmark counts in the sidebar tree', () => {
    const bookmarks = [
      makeBookmark({ url: 'https://a.example/', title: 'A', collectionId: 'bar' }),
      makeBookmark({ url: 'https://b.example/', title: 'B', collectionId: 'bar' }),
      { ...makeBookmark({ url: 'https://c.example/', title: 'C', collectionId: 'bar' }), deletedAt: stamp },
      makeBookmark({ url: 'https://d.example/', title: 'D' }),
    ];
    const counts = folderCounts(bookmarks);
    expect(counts).toEqual({ bar: 2, '': 1 });
    const tree = renderFolderTree([folder('bar', 'Toolbar', { toolbar: true }), folder('dev', 'Dev')], 'bar', 'en', counts);
    expect(tree).toContain('<span class="tree-count">2</span>');
    expect(tree).toContain('data-select-folder="dev"');
    expect(tree).toContain('aria-pressed="true"');
    expect(tree).toContain('class="toolbar-mark"');
  });

  it('renders tags and notes on cards with escaped content and a stable letter tile', () => {
    const bookmark = { ...makeBookmark({ url: 'https://x.example/', title: '<Title>', tags: ['work'], notes: 'a & b' }), favorite: true };
    const html = renderBookmarkCard(bookmark);
    expect(html).toContain('#work');
    expect(html).toContain('a &amp; b');
    expect(html).toContain('&lt;Title&gt;');
    expect(html).toContain('data-favorite="true"');
    expect(html).toContain('icon-button is-on');
    expect(tileHue('x.example')).toBe(tileHue('x.example'));
    expect(tileHue('x.example')).toBeLessThan(360);
  });

  it('puts the browser-bookmark switch first in settings and keeps the header navigation', () => {
    const settings = settingsDocument();
    expect(settings).toContain('id="native-sync" type="checkbox" role="switch"');
    expect(settings).toContain('id="native-status"');
    expect(settings).toContain(copyFor('en').nativeExplain);
    expect(settings.indexOf('id="native-sync"')).toBeLessThan(settings.indexOf('id="sync-form"'));
    expect(settings).toContain('id="sync-summary"');
    expect(settings).toContain('aria-current="page"');
    expect(settingsDocument('zh')).toContain('浏览器书签');
    const library = libraryDocument();
    expect(library).toContain('id="folder-heading"');
    expect(library).toContain('id="batch-count"');
    expect(library).toContain('class="toast"');
    expect(popupDocument()).toContain('id="save-hint"');
    expect(popupRuntimeMessage('native-status')).toEqual({ type: 'lumamark-native-status' });
    expect(popupRuntimeMessage('set-native-sync', { enabled: false })).toEqual({ type: 'lumamark-set-native-sync', payload: { enabled: false } });
  });
});
