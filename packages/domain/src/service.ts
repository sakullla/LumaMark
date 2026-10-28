import {
  applyBookmarkUpdate,
  Bookmark,
  BookmarkQuery,
  CreateBookmarkInput,
  DuplicateAction,
  makeBookmark,
  SaveBookmarkResult,
  UpdateBookmarkInput,
} from './index';

export interface BookmarkRepository {
  list(query?: BookmarkQuery): Promise<Bookmark[]>;
  findById(id: string): Promise<Bookmark | undefined>;
  findByUrl(url: string): Promise<Bookmark | undefined>;
  put(bookmark: Bookmark): Promise<void>;
  remove(id: string): Promise<void>;
}

export class BookmarkService {
  public constructor(private readonly repository: BookmarkRepository) {}

  async save(input: CreateBookmarkInput, duplicateAction: DuplicateAction = 'existing'): Promise<SaveBookmarkResult> {
    const candidate = makeBookmark(input);
    const existing = await this.repository.findByUrl(candidate.url);
    if (existing && !existing.deletedAt && duplicateAction === 'existing') return { kind: 'existing', existing };
    if (existing && !existing.deletedAt && duplicateAction === 'update') {
      const updated = applyBookmarkUpdate(existing, input, new Date().toISOString());
      await this.repository.put(updated);
      return { kind: 'saved', bookmark: updated, undoToken: updated.id };
    }
    const saved = existing && duplicateAction === 'copy' ? { ...candidate, id: crypto.randomUUID() } : candidate;
    await this.repository.put(saved);
    return { kind: 'saved', bookmark: saved, undoToken: saved.id };
  }

  async update(id: string, update: UpdateBookmarkInput): Promise<Bookmark> {
    const current = await this.repository.findById(id);
    if (!current) throw new Error('Bookmark not found');
    const updated = applyBookmarkUpdate(current, update);
    await this.repository.put(updated);
    return updated;
  }

  async remove(id: string): Promise<Bookmark> {
    const current = await this.repository.findById(id);
    if (!current) throw new Error('Bookmark not found');
    const removed = { ...current, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: current.revision + 1 };
    await this.repository.put(removed);
    return removed;
  }

  async restore(id: string): Promise<Bookmark> {
    const current = await this.repository.findById(id);
    if (!current) throw new Error('Bookmark not found');
    const restored = { ...current, deletedAt: undefined, updatedAt: new Date().toISOString(), revision: current.revision + 1 };
    await this.repository.put(restored);
    return restored;
  }

  async list(query: BookmarkQuery = {}): Promise<Bookmark[]> {
    const values = await this.repository.list(query);
    return query.includeDeleted ? values : values.filter((item) => !item.deletedAt);
  }
}
