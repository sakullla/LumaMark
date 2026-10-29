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
    const payload = JSON.parse(text) as { schemaVersion: number; bookmarks: Array<{ position: number }> };
    expect(payload.schemaVersion).toBe(2);
    expect(payload.bookmarks[0].position).toBe(0);
    const parsed = parseLumaMarkJson(text);
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.bookmarks[0].title).toBe('Example');
    expect(parsed.bookmarks[0].position).toBe(0);
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

  it('reads schema 1 JSON without order or toolbar and writes schema 2', () => {
    const result = parseLumaMarkJson(JSON.stringify({
      format: 'lumamark',
      schemaVersion: 1,
      exportedAt: '2024-01-01T00:00:00.000Z',
      bookmarks: [{
        id: 'b1', url: 'https://example.test/a', title: 'Alpha', domain: 'example.test', notes: 'keep', tags: [], favorite: true,
        createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-02T00:00:00.000Z', revision: 4,
      }],
      collections: [{
        id: 'c1', name: 'Notes', parentId: 'root', position: 3,
        createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', revision: 2,
      }, {
        id: 'root', name: 'Root',
        createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', revision: 1,
      }],
    }));
    expect(result.issues).toEqual([]);
    expect(result.bookmarks).toHaveLength(1);
    expect(result.bookmarks[0]).toMatchObject({ id: 'b1', url: 'https://example.test/a', title: 'Alpha', notes: 'keep', position: 0, revision: 4 });
    expect(result.collections.map((collection) => collection.id).sort()).toEqual(['c1', 'root']);
    expect(result.collections.find((collection) => collection.id === 'c1')).toMatchObject({ parentId: 'root', position: 3, toolbar: false });
    expect(result.collections.find((collection) => collection.id === 'root')).toMatchObject({ position: 0, toolbar: false });
    const exported = JSON.parse(exportLumaMarkJson(result.bookmarks, result.collections, '2024-02-01T00:00:00.000Z')) as {
      schemaVersion: number;
      bookmarks: Array<{ position: number }>;
      collections: Array<{ toolbar: boolean }>;
    };
    expect(exported.schemaVersion).toBe(2);
    expect(exported.bookmarks[0].position).toBe(0);
    expect(exported.collections.every((collection) => collection.toolbar === false)).toBe(true);
  });

  it('writes HTML document order and selects one toolbar without changing bookmark identity', () => {
    const html = [
      '<DL><p>',
      '<DT><H3>Bookmarks Toolbar</H3><DL><p>',
      '<DT><A HREF="https://toolbar.example/a">Toolbar link</A>',
      '</DL><p>',
      '<DT><A HREF="https://root.example/b">Root</A>',
      '<DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Custom bar</H3><DL><p>',
      '<DT><A HREF="https://custom.example/c">Custom</A>',
      '<DT><H3>Nested</H3><DL><p>',
      '<DT><A HREF="https://nested.example/d">Nested link</A>',
      '</DL><p>',
      '<DT><A HREF="https://custom.example/e">After nested</A>',
      '</DL><p>',
      '<DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Second</H3><DL><p></DL>',
      '<DT><H3>书签栏</H3><DL><p>',
      '<DT><A HREF="https://zh.example/f">中文</A>',
      '</DL><p>',
      '</DL>',
    ].join('');
    const marked = parseBookmarksHtml(html);
    expect(marked.issues).toEqual([]);
    expect(marked.bookmarks.map((bookmark) => [bookmark.title, bookmark.url, bookmark.position])).toEqual([
      ['Toolbar link', 'https://toolbar.example/a', 0],
      ['Root', 'https://root.example/b', 1],
      ['Custom', 'https://custom.example/c', 0],
      ['Nested link', 'https://nested.example/d', 0],
      ['After nested', 'https://custom.example/e', 2],
      ['中文', 'https://zh.example/f', 0],
    ]);
    const folders = Object.fromEntries(marked.collections.map((collection) => [collection.name, collection]));
    expect(folders['Bookmarks Toolbar']).toMatchObject({ position: 0, toolbar: false, parentId: undefined });
    expect(folders.Nested.parentId).toBe(folders['Custom bar'].id);
    expect(folders.Nested.position).toBe(1);
    expect(folders['Custom bar']).toMatchObject({ position: 2, toolbar: true });
    expect(folders['After nested']).toBeUndefined();
    expect(folders.Second).toMatchObject({ position: 3, toolbar: false });
    expect(folders['书签栏']).toMatchObject({ position: 4, toolbar: false });
    expect(marked.bookmarks.find((bookmark) => bookmark.title === 'Root')?.collectionId).toBeUndefined();
    expect(marked.bookmarks.find((bookmark) => bookmark.title === 'After nested')?.collectionId).toBe(folders['Custom bar'].id);
    expect(marked.bookmarks.find((bookmark) => bookmark.title === 'Nested link')?.collectionId).toBe(folders.Nested.id);

    const plain = [
      '<DL><p>',
      '<DT><A HREF="https://root.example/b">Root</A>',
      '<DT><H3>Parent</H3><DL><p>',
      '<DT><A HREF="https://child.example/c">Child</A>',
      '<DT><H3>Inner</H3><DL><p>',
      '<DT><A HREF="https://inner.example/d">Inner link</A>',
      '</DL></DL></DL>',
    ].join('');
    const imported = parseBookmarksHtml(plain);
    expect(imported.bookmarks).toHaveLength(3);
    expect(imported.bookmarks.map((bookmark) => [bookmark.title, bookmark.url])).toEqual([
      ['Root', 'https://root.example/b'],
      ['Child', 'https://child.example/c'],
      ['Inner link', 'https://inner.example/d'],
    ]);
    const parent = imported.collections.find((collection) => collection.name === 'Parent');
    const inner = imported.collections.find((collection) => collection.name === 'Inner');
    expect(parent?.parentId).toBeUndefined();
    expect(imported.bookmarks.find((bookmark) => bookmark.title === 'Child')?.collectionId).toBe(parent?.id);
    expect(inner?.parentId).toBe(parent?.id);
    expect(imported.bookmarks.find((bookmark) => bookmark.title === 'Inner link')?.collectionId).toBe(inner?.id);
    expect(imported.collections.some((collection) => collection.toolbar)).toBe(false);
    expect(imported.bookmarks.map((bookmark) => bookmark.position)).toEqual([0, 0, 0]);
    expect(parent?.position).toBe(1);
    expect(inner?.position).toBe(1);
  });

  it('matches one top-level toolbar name in priority order', () => {
    const named = parseBookmarksHtml([
      '<DL><p>',
      '<DT><H3>Bookmarks Toolbar</H3><DL><p></DL>',
      '<DT><H3>Other</H3><DL><p>',
      '<DT><H3>书签栏</H3><DL><p></DL>',
      '</DL>',
      '<DT><H3>Bookmarks bar</H3><DL><p></DL>',
      '<DT><H3>书签栏</H3><DL><p></DL>',
      '</DL>',
    ].join(''));
    expect(named.collections.filter((collection) => collection.toolbar).map((collection) => collection.name)).toEqual(['书签栏']);
    expect(named.collections.find((collection) => collection.toolbar)?.parentId).toBeUndefined();

    const english = parseBookmarksHtml('<DL><p><DT><H3>Bookmarks Toolbar</H3><DL><p></DL><DT><H3>Bookmarks bar</H3><DL><p></DL></DL>');
    expect(english.collections.filter((collection) => collection.toolbar).map((collection) => collection.name)).toEqual(['Bookmarks bar']);

    const firefox = parseBookmarksHtml('<DL><p><DT><H3>Other</H3><DL><p></DL><DT><H3>Bookmarks Toolbar</H3><DL><p></DL></DL>');
    expect(firefox.collections.filter((collection) => collection.toolbar).map((collection) => collection.name)).toEqual(['Bookmarks Toolbar']);

    const none = parseBookmarksHtml('<DL><p><DT><H3>Other</H3><DL><p><DT><A HREF="https://example.test/a">A</A></DL></DL>');
    expect(none.collections.some((collection) => collection.toolbar)).toBe(false);
    expect(none.bookmarks).toHaveLength(1);
  });

  it('still distinguishes skip, update and copy for duplicate HTML urls', () => {
    const parsed = parseBookmarksHtml('<DL><p><DT><A HREF="https://example.test/a">Imported</A></DL>');
    const existing = makeBookmark({ url: 'https://example.test/a', title: 'Old' });
    const skip = planImport(parsed, [existing], 'skip');
    expect(skip.entries).toHaveLength(0);
    expect(skip.issues.some((issue) => issue.kind === 'duplicate')).toBe(true);
    const update = planImport(parsed, [existing], 'update');
    expect(update.entries).toHaveLength(1);
    expect(update.entries[0].action).toBe('update');
    expect(update.entries[0].existing?.id).toBe(existing.id);
    expect(update.entries[0].bookmark.title).toBe('Imported');
    const copy = planImport(parsed, [existing], 'copy');
    expect(copy.entries[0].action).toBe('copy');
    expect(copy.entries[0].bookmark.id).not.toBe(existing.id);
    expect(copy.entries[0].bookmark.url).toBe(existing.url);
    expect(parsed.bookmarks).toHaveLength(1);
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

