import { describe, expect, it } from 'vitest';
import { makeBookmark } from '../../packages/domain/src/index';
import { exportLumaMarkJson, parseBookmarksHtml, parseLumaMarkJson, planImport } from '../../packages/import-export/src/index';

describe('import/export', () => {
  it('parses nested Netscape bookmark folders and decodes entities', () => {
    const html = '<DL><p><DT><H3>Reading &amp; Notes</H3><DL><p><DT><A HREF="https://example.test/a#part">A &amp; B</A></DL></DL>';
    const result = parseBookmarksHtml(html);
    expect(result.issues).toHaveLength(0);
    expect(result.collections).toHaveLength(1);
    expect(result.bookmarks[0].url).toBe('https://example.test/a#part');
    expect(result.bookmarks[0].title).toBe('A & B');
    expect(result.bookmarks[0].collectionId).toBe(result.collections[0].id);
  });

  it('keeps valid JSON records and reports malformed JSON', () => {
    const result = parseLumaMarkJson('{bad');
    expect(result.bookmarks).toHaveLength(0);
    expect(result.issues[0].kind).toBe('invalid-json');
  });

  it('round trips LumaMark JSON and makes explicit duplicate plans', () => {
    const bookmark = makeBookmark({ url: 'https://example.test', title: 'Example', tags: ['one'] });
    const text = exportLumaMarkJson([bookmark], []);
    const parsed = parseLumaMarkJson(text);
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.bookmarks[0].title).toBe('Example');
    const skip = planImport(parsed, [bookmark], 'skip');
    expect(skip.entries).toHaveLength(0);
    expect(skip.issues.some((issue) => issue.kind === 'duplicate')).toBe(true);
    const copy = planImport(parsed, [bookmark], 'copy');
    expect(copy.entries[0].action).toBe('copy');
    expect(copy.entries[0].bookmark.id).not.toBe(bookmark.id);
  });

  it('reports JSON records missing required metadata instead of returning incomplete bookmarks', () => {
    const result = parseLumaMarkJson(JSON.stringify({
      format: 'lumamark',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      bookmarks: [{ id: 'broken', url: 'https://example.test', title: 'Broken', tags: [] }],
      collections: [],
    }));
    expect(result.bookmarks).toHaveLength(0);
    expect(result.issues.some((issue) => issue.kind === 'invalid-entry')).toBe(true);
  });

  it('reports unclosed HTML anchors and folder headings', () => {
    const folder = parseBookmarksHtml('<DL><H3>Folder');
    const anchor = parseBookmarksHtml('<DL><A HREF="https://example.test">Title');
    expect(folder.bookmarks).toHaveLength(0);
    expect(anchor.bookmarks).toHaveLength(0);
    expect(folder.issues.some((issue) => issue.message.includes('Folder heading'))).toBe(true);
    expect(anchor.issues.some((issue) => issue.message.includes('Bookmark anchor'))).toBe(true);
  });
});

