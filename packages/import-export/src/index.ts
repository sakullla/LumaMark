import {
  Bookmark,
  Collection,
  CURRENT_SCHEMA_VERSION,
  LumaMarkExport,
  makeBookmark,
  migrateBookmark,
  migrateCollection,
  migrateExport,
  isSeparator,
  normalizeBookmarkUrl,
  normalizeUrl,
  urlKey,
} from '../../domain/src/index';

export type DuplicateImportAction = 'skip' | 'update' | 'copy';

export interface ImportIssue {
  kind: 'invalid-json' | 'invalid-entry' | 'duplicate' | 'malformed-html';
  message: string;
  index?: number;
}

export interface ImportResult {
  bookmarks: Bookmark[];
  collections: Collection[];
  issues: ImportIssue[];
}

export interface ImportPlanEntry {
  bookmark: Bookmark;
  action: 'create' | 'update' | 'copy';
  existing?: Bookmark;
}

export interface ImportPlan {
  entries: ImportPlanEntry[];
  issues: ImportIssue[];
}

const entityMap: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (_, name: string) => entityMap[name.toLowerCase()] ?? `&${name};`)
    .replace(/<[^>]*>/g, '')
    .trim();
}

function id(): string {
  return crypto.randomUUID();
}

function makeCollection(name: string, parentId: string | undefined, position: number, toolbar: boolean, now: string): Collection {
  return { id: id(), name, parentId, position, toolbar, createdAt: now, updatedAt: now, revision: 1 };
}

const toolbarNames = ['书签栏', 'Bookmarks bar', 'Bookmarks Toolbar'];

function hasToolbarAttribute(token: string): boolean {
  return /\bPERSONAL_TOOLBAR_FOLDER\s*=\s*(?:"true"|'true'|true)(?=[\s>])/i.test(token);
}

/** Parse a LumaMark JSON backup while retaining all valid records after bad entries. */
export function parseLumaMarkJson(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { bookmarks: [], collections: [], issues: [{ kind: 'invalid-json', message: `Invalid JSON: ${String(error)}` }] };
  }
  try {
    const backup = migrateExport(parsed);
    return { bookmarks: [...backup.bookmarks], collections: [...backup.collections], issues: [] };
  } catch (error) {
    const raw = parsed && typeof parsed === 'object' ? parsed as Partial<LumaMarkExport> : undefined;
    const bookmarks = Array.isArray(raw?.bookmarks) ? raw.bookmarks : [];
    const valid: Bookmark[] = [];
    const issues: ImportIssue[] = [{ kind: 'invalid-entry', message: String(error) }];
    bookmarks.forEach((value, index) => {
      try {
        if (!value || typeof value !== 'object') throw new Error('Invalid bookmark entry');
        const item = value as Bookmark;
        if (typeof item.createdAt !== 'string' || !item.createdAt) {
          throw new Error('Bookmark createdAt is required');
        }
        if (typeof item.updatedAt !== 'string' || !item.updatedAt) {
          throw new Error('Bookmark updatedAt is required');
        }
        if (typeof item.revision !== 'number' || !Number.isInteger(item.revision) || item.revision < 1) {
          throw new Error('Bookmark revision must be a positive integer');
        }
        const url = normalizeBookmarkUrl(item.url);
        valid.push({
          ...makeBookmark({
            id: item.id,
            url,
            title: item.title,
            faviconUrl: item.faviconUrl,
            notes: item.notes,
            tags: item.tags,
            collectionId: item.collectionId,
            position: typeof item.position === 'number' ? item.position : 0,
            favorite: item.favorite,
          }, item.createdAt),
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          deletedAt: item.deletedAt,
          revision: item.revision,
        });
      } catch (entryError) {
        issues.push({ kind: 'invalid-entry', index, message: String(entryError) });
      }
    });
    const collections = Array.isArray(raw?.collections) ? raw.collections.map((collection) => migrateCollection(collection as Collection)) : [];
    return { bookmarks: valid, collections, issues };
  }
}

/** Parse browser bookmark HTML (Netscape format), preserving folder hierarchy. */
export function parseBookmarksHtml(text: string): ImportResult {
  const now = new Date().toISOString();
  const collections: Collection[] = [];
  const bookmarks: Bookmark[] = [];
  const issues: ImportIssue[] = [];
  const stack: Array<{ id?: string; nextPosition: number }> = [{ nextPosition: 0 }];
  const tokens = text.match(/<[^>]+>|[^<]+/g) ?? [];
  let pendingFolder: string | undefined;
  let pendingToolbar = false;
  let toolbarClaimed = false;
  let folderText = '';
  let inFolder = false;
  let anchorAttrs = '';
  let anchorText = '';
  let inAnchor = false;
  let tokenIndex = 0;
  for (const token of tokens) {
    if (/^<h3\b[^>]*>$/i.test(token)) {
      inFolder = true;
      folderText = '';
      pendingToolbar = !toolbarClaimed && hasToolbarAttribute(token);
      continue;
    }
    if (/^<\/h3\b/i.test(token)) {
      pendingFolder = decodeHtml(folderText);
      inFolder = false;
      continue;
    }
    if (inFolder) {
      folderText += token;
      continue;
    }
    const anchorStart = token.match(/^<a\b([^>]*)>$/i);
    if (anchorStart) {
      inAnchor = true;
      anchorAttrs = anchorStart[1];
      anchorText = '';
      continue;
    }
    if (/^<\/a\b/i.test(token)) {
      const href = anchorAttrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const url = href?.[1] ?? href?.[2] ?? href?.[3];
      const title = decodeHtml(anchorText);
      if (!url) {
        issues.push({ kind: 'malformed-html', index: tokenIndex, message: 'Bookmark is missing an href' });
      } else {
        try {
          const parent = stack[stack.length - 1];
          const bookmark = makeBookmark({ url: decodeHtml(url), title, collectionId: parent.id, position: parent.nextPosition }, now);
          bookmarks.push(bookmark);
          parent.nextPosition += 1;
        } catch (error) {
          issues.push({ kind: 'malformed-html', index: tokenIndex, message: String(error) });
        }
      }
      inAnchor = false;
      tokenIndex += 1;
      continue;
    }
    if (inAnchor) {
      anchorText += token;
      continue;
    }
    if (/^<dl\b/i.test(token)) {
      if (pendingFolder) {
        const parent = stack[stack.length - 1];
        const toolbar = pendingToolbar;
        if (toolbar) toolbarClaimed = true;
        const collection = makeCollection(pendingFolder, parent.id, parent.nextPosition, toolbar, now);
        parent.nextPosition += 1;
        collections.push(collection);
        stack.push({ id: collection.id, nextPosition: 0 });
        pendingFolder = undefined;
        pendingToolbar = false;
      }
      continue;
    }
    if (/^<\/dl\b/i.test(token)) {
      if (stack.length > 1) stack.pop();
      continue;
    }
  }
  if (!toolbarClaimed) {
    for (const name of toolbarNames) {
      const match = collections.find((collection) => collection.parentId === undefined && collection.name === name);
      if (match) {
        match.toolbar = true;
        break;
      }
    }
  }
  if (pendingFolder) issues.push({ kind: 'malformed-html', message: `Folder without content: ${pendingFolder}` });
  if (inAnchor) issues.push({ kind: 'malformed-html', message: 'Bookmark anchor is not closed' });
  if (inFolder) issues.push({ kind: 'malformed-html', message: 'Folder heading is not closed' });
  return { bookmarks, collections, issues };
}

export function exportLumaMarkJson(bookmarks: Bookmark[], collections: Collection[], now = new Date().toISOString()): string {
  const payload: LumaMarkExport = {
    format: 'lumamark',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: now,
    bookmarks: bookmarks.map((bookmark) => migrateBookmark(bookmark)),
    collections: collections.map((collection) => migrateCollection(collection)),
  };
  return JSON.stringify(payload, null, 2);
}

/** Build an explicit import plan so the UI can ask how to handle duplicate URLs. */
export function planImport(result: ImportResult, existing: Bookmark[], action: DuplicateImportAction = 'skip'): ImportPlan {
  const byUrl = new Map(existing.filter((bookmark) => !isSeparator(bookmark)).map((bookmark) => [urlKey(bookmark.url), bookmark]));
  const issues = [...result.issues];
  const entries: ImportPlanEntry[] = [];
  for (const bookmark of result.bookmarks) {
    const found = isSeparator(bookmark) ? undefined : byUrl.get(urlKey(bookmark.url));
    if (!found) {
      entries.push({ bookmark, action: 'create' });
      continue;
    }
    if (action === 'skip') {
      issues.push({ kind: 'duplicate', message: `Duplicate URL skipped: ${bookmark.url}` });
      continue;
    }
    if (action === 'update') entries.push({ bookmark, existing: found, action: 'update' });
    else entries.push({ bookmark: { ...bookmark, id: id() }, existing: found, action: 'copy' });
  }
  return { entries, issues };
}

