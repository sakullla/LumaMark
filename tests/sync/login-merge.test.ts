import { describe, expect, it } from 'vitest';
import { urlKey, type Bookmark, type Collection } from '../../packages/domain/src/index';
import {
  bookmarkMergeKey,
  copyUnauthenticatedLibrary,
  folderNameChain,
  isEmptyAccount,
  mergeLoginLibraries,
  sameFolder,
  type LoginLibrary,
} from '../../packages/sync/src/login-merge';

function folder(id: string, name: string, parentId?: string, patch: Partial<Collection> = {}): Collection {
  return {
    id,
    name,
    parentId,
    position: 0,
    toolbar: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
    ...patch,
  };
}

function bookmark(id: string, url: string, patch: Partial<Bookmark> = {}): Bookmark {
  return {
    id,
    url,
    title: id,
    domain: 'example.com',
    notes: '',
    tags: [],
    favorite: false,
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
    ...patch,
  };
}

function chainOf(collections: readonly Collection[], collectionId: string | undefined): string[] {
  const byId = new Map(collections.map((item) => [item.id, item]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = collectionId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const item = byId.get(current);
    if (!item) break;
    names.push(item.name.trim());
    current = item.parentId;
  }
  return names.reverse();
}

describe('login merge', () => {
  it('keeps a bookmark that exists on only one side and the folder name chain it belongs to', () => {
    const account: LoginLibrary = {
      bookmarks: [
        bookmark('account-only', 'https://account.example/only', { collectionId: 'a-notes', title: 'Account only' }),
        bookmark('account-work', 'https://shared-folder.example/account', { collectionId: 'a-work' }),
        bookmark('same-id', 'https://example.com/account-url', { collectionId: 'a-work', title: 'Account identity' }),
        bookmark('slash-account', 'https://example.com/slash', { collectionId: 'a-slash' }),
      ],
      collections: [
        folder('a-work', 'Work'),
        folder('a-notes', 'Notes', 'a-work'),
        folder('a-slash', 'A/B'),
      ],
    };
    const guest: LoginLibrary = {
      bookmarks: [
        bookmark('guest-only', 'https://guest.example/only', { collectionId: 'g-papers', title: 'Guest only', notes: 'from guest' }),
        bookmark('guest-extra', 'https://shared-folder.example/extra', { collectionId: 'g-extra', title: 'Extra' }),
        bookmark('same-id', 'https://example.com/guest-url', { collectionId: 'g-work', title: 'Guest identity', notes: 'guest notes' }),
        bookmark('slash-guest', 'https://example.com/slash', { collectionId: 'g-child' }),
      ],
      collections: [
        folder('g-read', 'Reading'),
        folder('g-papers', 'Papers', 'g-read'),
        folder('g-work', ' Work '),
        folder('g-extra', 'Extra', 'g-work'),
        folder('g-parent', 'A'),
        folder('g-child', 'B', 'g-parent'),
      ],
    };

    expect(sameFolder(account.collections, 'a-work', guest.collections, 'g-work')).toBe(true);
    expect(sameFolder(account.collections, 'a-notes', guest.collections, 'g-papers')).toBe(false);
    expect(folderNameChain(account.collections, 'a-notes')).toEqual(['Work', 'Notes']);
    expect(bookmarkMergeKey(account.bookmarks[1], account.collections)).not.toBe(
      bookmarkMergeKey(guest.bookmarks[1], guest.collections),
    );

    const result = mergeLoginLibraries(account, guest);
    const ids = result.bookmarks.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(['account-only', 'guest-only', 'guest-extra', 'account-work']));
    expect(new Set(ids).size).toBe(ids.length);

    const accountOnly = result.bookmarks.find((item) => item.id === 'account-only');
    const guestOnly = result.bookmarks.find((item) => item.id === 'guest-only');
    const guestExtra = result.bookmarks.find((item) => item.id === 'guest-extra');
    const accountWork = result.bookmarks.find((item) => item.id === 'account-work');
    expect(chainOf(result.collections, accountOnly?.collectionId)).toEqual(['Work', 'Notes']);
    expect(chainOf(result.collections, guestOnly?.collectionId)).toEqual(['Reading', 'Papers']);
    expect(chainOf(result.collections, guestExtra?.collectionId)).toEqual(['Work', 'Extra']);
    expect(chainOf(result.collections, accountWork?.collectionId)).toEqual(['Work']);
    expect(guestOnly).toMatchObject({ title: 'Guest only', notes: 'from guest', url: 'https://guest.example/only' });

    const workFolders = result.collections.filter((item) => chainOf(result.collections, item.id).join('/') === 'Work');
    expect(workFolders).toEqual([expect.objectContaining({ id: 'a-work', name: 'Work' })]);
    expect(result.collections.find((item) => item.id === 'g-extra')?.parentId).toBe('a-work');
    expect(result.collections.find((item) => item.id === 'a-notes')?.parentId).toBe('a-work');
    expect(result.collections.find((item) => item.id === 'g-papers')?.parentId).toBe('g-read');
    expect(result.collections.find((item) => item.id === 'g-read')?.parentId).toBeUndefined();
    expect(result.collections.some((item) => item.id === 'g-work')).toBe(false);

    const slashAccount = result.bookmarks.find((item) => item.id === 'slash-account');
    const slashGuest = result.bookmarks.find((item) => item.id === 'slash-guest');
    expect(slashAccount).toBeDefined();
    expect(slashGuest).toBeDefined();
    expect(chainOf(result.collections, slashAccount?.collectionId)).toEqual(['A/B']);
    expect(chainOf(result.collections, slashGuest?.collectionId)).toEqual(['A', 'B']);

    const accountIdentity = result.bookmarks.find((item) => item.id === 'same-id');
    const guestIdentity = result.bookmarks.find((item) => item.title === 'Guest identity');
    expect(accountIdentity?.title).toBe('Account identity');
    expect(guestIdentity?.id).toBe('same-id#2');
    expect(guestIdentity).toMatchObject({ notes: 'guest notes', url: 'https://example.com/guest-url' });
    expect(chainOf(result.collections, guestIdentity?.collectionId)).toEqual(['Work']);
    expect(account.bookmarks.find((item) => item.id === 'same-id')?.title).toBe('Account identity');
  });

  it('collapses the same folder chain and url into the account title, notes, tags, favorite and deletion state', () => {
    const accountBookmark = bookmark('acc-new', 'https://Example.com/item', {
      collectionId: 'af',
      title: 'Account title',
      notes: 'account notes',
      tags: ['keep', 'account'],
      favorite: true,
      deletedAt: '2026-02-01T00:00:00.000Z',
      position: 3,
      revision: 5,
      updatedAt: '2026-02-02T00:00:00.000Z',
    });
    const olderAccount = bookmark('acc-old', 'https://example.com/item', {
      collectionId: 'af',
      title: 'Old account',
      notes: 'old',
      tags: ['old'],
      favorite: false,
      revision: 2,
    });
    const guestBookmark = bookmark('gst', 'https://example.com/item', {
      collectionId: 'gf',
      title: 'Guest title',
      notes: 'guest notes',
      tags: ['drop'],
      favorite: false,
      position: 9,
      revision: 8,
    });
    const guestAgain = bookmark('gst-2', 'https://example.com/item', {
      collectionId: 'gf',
      title: 'Another guest',
      notes: 'other',
      tags: ['other'],
      favorite: true,
    });
    const guestOnly = bookmark('guest-only', 'https://example.com/only-guest', {
      collectionId: 'gf',
      title: 'Only guest',
      notes: 'guest body',
      tags: ['local'],
      favorite: true,
      position: 4,
      revision: 3,
      deletedAt: '2026-03-01T00:00:00.000Z',
    });
    const rootBookmark = bookmark('root-item', 'https://example.com/item', {
      title: 'Root title',
      notes: 'root',
      tags: ['root'],
      favorite: false,
    });
    const account: LoginLibrary = {
      bookmarks: [accountBookmark, olderAccount, rootBookmark],
      collections: [folder('af', 'Docs')],
    };
    const guest: LoginLibrary = {
      bookmarks: [guestBookmark, guestAgain, guestOnly],
      collections: [folder('gf', ' Docs ')],
    };

    expect(urlKey(accountBookmark.url)).toBe(urlKey(guestBookmark.url));
    expect(bookmarkMergeKey(accountBookmark, account.collections)).toBe(bookmarkMergeKey(guestBookmark, guest.collections));
    expect(bookmarkMergeKey(rootBookmark, account.collections)).not.toBe(bookmarkMergeKey(accountBookmark, account.collections));

    const result = mergeLoginLibraries(account, guest);
    const collapsed = result.bookmarks.filter((item) => urlKey(item.url) === urlKey('https://example.com/item') && chainOf(result.collections, item.collectionId).join('/') === 'Docs');
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toMatchObject({
      id: 'acc-old',
      title: 'Old account',
      notes: 'old',
      tags: ['old'],
      favorite: false,
      url: 'https://example.com/item',
      revision: 2,
    });
    expect(collapsed[0].deletedAt).toBeUndefined();
    expect(result.bookmarks.some((item) => item.id === 'gst' || item.id === 'gst-2' || item.id === 'acc-new')).toBe(false);

    const keptGuest = result.bookmarks.find((item) => item.id === 'guest-only');
    expect(keptGuest).toEqual({ ...guestOnly, collectionId: 'af' });
    expect(chainOf(result.collections, keptGuest?.collectionId)).toEqual(['Docs']);

    const root = result.bookmarks.find((item) => item.id === 'root-item');
    expect(root?.title).toBe('Root title');
    expect(root?.collectionId).toBeUndefined();
    expect(result.bookmarks.filter((item) => urlKey(item.url) === urlKey('https://example.com/item'))).toHaveLength(2);
  });

  it('treats an account with no live bookmarks or folders as empty and does not copy cleared ids', () => {
    const deletedBookmark = bookmark('trashed', 'https://example.com/trashed', { deletedAt: '2026-01-02T00:00:00.000Z' });
    const purgedBookmark = bookmark('purged-record', 'https://example.com/purged', { purgedAt: '2026-01-03T00:00:00.000Z', deletedAt: '2026-01-03T00:00:00.000Z' });
    const deletedFolder = folder('gone', 'Gone', undefined, { deletedAt: '2026-01-02T00:00:00.000Z' });
    expect(isEmptyAccount({ bookmarks: [], collections: [] })).toBe(true);
    expect(isEmptyAccount({ bookmarks: [deletedBookmark, purgedBookmark], collections: [deletedFolder], purged: ['old'] })).toBe(true);
    expect(isEmptyAccount({ bookmarks: [bookmark('live', 'https://example.com/live')], collections: [] })).toBe(false);
    expect(isEmptyAccount({ bookmarks: [deletedBookmark], collections: [folder('inbox', 'Inbox')] })).toBe(false);

    const fresh = bookmark('fresh', 'https://example.com/fresh', {
      collectionId: 'g-inbox',
      title: 'Fresh',
      notes: 'keep me',
      tags: ['new'],
      favorite: true,
      position: 2,
    });
    const account: LoginLibrary = {
      bookmarks: [deletedBookmark],
      collections: [deletedFolder],
      purged: ['old-id', 'old-id'],
    };
    const guest: LoginLibrary = {
      bookmarks: [
        bookmark('old-id', 'https://example.com/old', { title: 'Should not return', collectionId: 'g-inbox' }),
        fresh,
        bookmark('guest-cleared', 'https://example.com/cleared', { title: 'Cleared on guest', collectionId: 'g-inbox' }),
      ],
      collections: [folder('g-inbox', 'Inbox', undefined, { toolbar: true, position: 1 })],
      purged: ['guest-cleared'],
    };
    expect(isEmptyAccount(account)).toBe(true);

    const copied = copyUnauthenticatedLibrary(account, guest);
    expect(copied.bookmarks).toEqual([fresh]);
    expect(copied.collections).toEqual(guest.collections);
    expect(copied.purged).toEqual(['guest-cleared', 'old-id']);
    expect(copied.bookmarks.some((item) => item.id === 'old-id' || item.id === 'guest-cleared')).toBe(false);

    const merged = mergeLoginLibraries(
      { bookmarks: [bookmark('kept', 'https://example.com/kept', { title: 'Kept' })], collections: [folder('af', 'Docs')], purged: ['blocked'] },
      { bookmarks: [bookmark('blocked', 'https://example.com/blocked', { title: 'Do not restore', collectionId: 'gf' })], collections: [folder('gf', 'Other')] },
    );
    expect(merged.bookmarks.map((item) => item.id)).toEqual(['kept']);
    expect(merged.purged).toEqual(['blocked']);
    expect(merged.bookmarks.some((item) => item.title === 'Do not restore')).toBe(false);
  });

  it('keeps a live folder when a deleted folder has the same name chain', () => {
    const deletedAt = '2026-04-01T00:00:00.000Z';
    const alongside = mergeLoginLibraries(
      {
        bookmarks: [bookmark('live-mark', 'https://example.com/live', { collectionId: 'new-work', title: 'Live' })],
        collections: [
          folder('old-work', 'Work', undefined, { deletedAt, revision: 4 }),
          folder('new-work', 'Work', undefined, { revision: 1 }),
        ],
      },
      { bookmarks: [], collections: [] },
    );
    const liveWork = alongside.collections.filter((item) => item.name.trim() === 'Work' && !item.deletedAt);
    expect(liveWork).toEqual([expect.objectContaining({ id: 'new-work' })]);
    expect(alongside.collections.some((item) => item.id === 'old-work' || item.deletedAt)).toBe(false);
    expect(alongside.bookmarks.find((item) => item.id === 'live-mark')?.collectionId).toBe('new-work');

    const fromGuest = mergeLoginLibraries(
      {
        bookmarks: [],
        collections: [folder('dead-work', 'Work', undefined, { deletedAt, revision: 9 })],
      },
      {
        bookmarks: [bookmark('paper', 'https://example.com/paper', { collectionId: 'g-papers', title: 'Paper' })],
        collections: [
          folder('g-work', 'Work'),
          folder('g-papers', 'Papers', 'g-work'),
        ],
      },
    );
    const work = fromGuest.collections.find((item) => item.name.trim() === 'Work');
    const papers = fromGuest.collections.find((item) => item.name.trim() === 'Papers');
    expect(work?.deletedAt).toBeUndefined();
    expect(papers?.deletedAt).toBeUndefined();
    expect(papers?.parentId).toBe(work?.id);
    expect(papers?.parentId).not.toBe('dead-work');
    expect(chainOf(fromGuest.collections, papers?.id)).toEqual(['Work', 'Papers']);
    expect(chainOf(fromGuest.collections, fromGuest.bookmarks.find((item) => item.id === 'paper')?.collectionId)).toEqual(['Work', 'Papers']);
    expect(fromGuest.collections.some((item) => item.deletedAt)).toBe(false);
  });

  it('assigns a distinct folder id to each name chain', () => {
    const result = mergeLoginLibraries(
      {
        bookmarks: [bookmark('account-page', 'https://example.com/account-page', { collectionId: 'f1', title: 'Account page' })],
        collections: [folder('f1', 'Work')],
      },
      {
        bookmarks: [bookmark('guest-page', 'https://example.com/guest-page', { collectionId: 'f1', title: 'Guest page' })],
        collections: [
          folder('f1', 'Reading'),
          folder('papers', 'Papers', 'f1'),
        ],
      },
    );
    const work = result.collections.find((item) => item.name.trim() === 'Work');
    const reading = result.collections.find((item) => item.name.trim() === 'Reading');
    const papers = result.collections.find((item) => item.name.trim() === 'Papers');
    expect(work).toBeDefined();
    expect(reading).toBeDefined();
    expect(papers?.parentId).toBe(reading?.id);
    expect(work?.id).not.toBe(reading?.id);
    expect(papers?.parentId).not.toBe(work?.id);
    expect(new Set(result.collections.map((item) => item.id)).size).toBe(result.collections.length);
    expect(result.bookmarks.find((item) => item.id === 'account-page')?.collectionId).toBe(work?.id);
    expect(result.bookmarks.find((item) => item.id === 'guest-page')?.collectionId).toBe(reading?.id);
    expect(chainOf(result.collections, work?.id)).toEqual(['Work']);
    expect(chainOf(result.collections, reading?.id)).toEqual(['Reading']);
    expect(chainOf(result.collections, papers?.id)).toEqual(['Reading', 'Papers']);
  });

  it('keeps a live bookmark when the same key also has a deleted record', () => {
    const deletedAt = '2026-05-01T00:00:00.000Z';
    const guestOnly = mergeLoginLibraries(
      { bookmarks: [], collections: [] },
      {
        bookmarks: [
          bookmark('old', 'https://example.com/item', { collectionId: 'gf', deletedAt, revision: 2, title: 'Old' }),
          bookmark('fresh', 'https://example.com/item', { collectionId: 'gf', revision: 1, title: 'Fresh' }),
        ],
        collections: [folder('gf', 'Inbox')],
      },
    );
    expect(guestOnly.bookmarks.map((item) => item.id)).toEqual(['fresh']);
    expect(guestOnly.bookmarks[0]).toMatchObject({ title: 'Fresh', revision: 1 });
    expect(guestOnly.bookmarks[0].deletedAt).toBeUndefined();

    const accountMixed = mergeLoginLibraries(
      {
        bookmarks: [
          bookmark('acc-deleted', 'https://example.com/mix', {
            collectionId: 'af',
            deletedAt,
            revision: 5,
            title: 'Deleted account',
            notes: 'deleted',
            tags: ['deleted'],
            favorite: false,
          }),
          bookmark('acc-live', 'https://example.com/mix', {
            collectionId: 'af',
            revision: 1,
            title: 'Live account',
            notes: 'live',
            tags: ['live'],
            favorite: true,
          }),
        ],
        collections: [folder('af', 'Inbox')],
      },
      {
        bookmarks: [bookmark('guest-live', 'https://example.com/mix', { collectionId: 'gf', revision: 9, title: 'Guest', notes: 'guest', favorite: false })],
        collections: [folder('gf', 'Inbox')],
      },
    );
    expect(accountMixed.bookmarks.map((item) => item.id)).toEqual(['acc-live']);
    expect(accountMixed.bookmarks[0]).toMatchObject({
      title: 'Live account',
      notes: 'live',
      tags: ['live'],
      favorite: true,
    });
    expect(accountMixed.bookmarks[0].deletedAt).toBeUndefined();

    const accountDeleted = mergeLoginLibraries(
      {
        bookmarks: [bookmark('acc-gone', 'https://example.com/gone', {
          collectionId: 'af',
          deletedAt,
          revision: 2,
          title: 'Account gone',
          notes: 'gone',
          tags: ['gone'],
          favorite: true,
        })],
        collections: [folder('af', 'Inbox')],
      },
      {
        bookmarks: [bookmark('guest-live', 'https://example.com/gone', {
          collectionId: 'gf',
          revision: 8,
          title: 'Guest live',
          notes: 'guest',
          tags: ['guest'],
          favorite: false,
        })],
        collections: [folder('gf', 'Inbox')],
      },
    );
    expect(accountDeleted.bookmarks).toHaveLength(1);
    expect(accountDeleted.bookmarks[0]).toMatchObject({
      id: 'acc-gone',
      title: 'Account gone',
      notes: 'gone',
      tags: ['gone'],
      favorite: true,
      deletedAt,
    });
  });

  it('keeps cleared ids reserved when a conflicting bookmark needs a new id', () => {
    const result = mergeLoginLibraries(
      {
        bookmarks: [bookmark('guest', 'https://example.com/account', { title: 'Account' })],
        collections: [],
        purged: ['guest#2'],
      },
      {
        bookmarks: [bookmark('guest', 'https://example.com/guest', { title: 'Guest page', notes: 'other' })],
        collections: [],
        purged: ['guest#3'],
      },
    );
    const guestMark = result.bookmarks.find((item) => item.title === 'Guest page');
    expect(result.purged).toEqual(['guest#2', 'guest#3']);
    expect(result.bookmarks.map((item) => item.id)).not.toContain('guest#2');
    expect(result.bookmarks.map((item) => item.id)).not.toContain('guest#3');
    expect(result.bookmarks.find((item) => item.url === 'https://example.com/account')?.id).toBe('guest');
    expect(guestMark?.id).toBe('guest#4');
    expect(guestMark).toMatchObject({ notes: 'other', url: 'https://example.com/guest' });
  });
});
