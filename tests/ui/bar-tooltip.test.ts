import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBookmark, type Collection } from '../../packages/domain/src/index';
import { mountHome } from '../../apps/extension/src/pages/home';

const now = '2024-01-01T00:00:00.000Z';
const bookmarkTitle = 'Bookmark title wider than fourteen rem units';
const folderTitle = 'Folder title wider than fourteen rem units';

class MiniEvent {
  type: string;
  bubbles: boolean;
  target: MiniElement | null = null;
  currentTarget: MiniElement | null = null;
  relatedTarget: MiniNode | null = null;
  defaultPrevented = false;
  cancelBubble = false;
  key: string;
  constructor(type: string, init: { bubbles?: boolean; relatedTarget?: MiniNode | null; key?: string } = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.relatedTarget = init.relatedTarget ?? null;
    this.key = init.key ?? '';
  }
  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void { this.cancelBubble = true; }
}

class MiniNode {
  parentElement: MiniElement | null = null;
  parentNode: MiniNode | null = null;
  nodeType = 0;
  ownerDocument: MiniDocument;
  constructor(doc: MiniDocument) { this.ownerDocument = doc; }
  remove(): void { this.parentElement?.removeChild(this); }
}

class MiniText extends MiniNode {
  nodeType = 3;
  constructor(doc: MiniDocument, readonly data: string) { super(doc); }
}

class MiniElement extends MiniNode {
  nodeType = 1;
  attrs = new Map<string, string>();
  childNodes: MiniNode[] = [];
  style: Record<string, string> = {};
  listeners = new Map<string, Array<(event: MiniEvent) => void>>();
  clientWidth = 0;
  constructor(doc: MiniDocument, readonly tagName: string) { super(doc); }

  get id(): string { return this.getAttribute('id') ?? ''; }
  set id(value: string) { this.setAttribute('id', value); }
  get className(): string { return this.getAttribute('class') ?? ''; }
  set className(value: string) { this.setAttribute('class', value); }
  get classList(): { contains: (name: string) => boolean } {
    return { contains: (name: string) => this.className.split(/\s+/).includes(name) };
  }
  get hidden(): boolean { return this.hasAttribute('hidden'); }
  set hidden(value: boolean) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get dataset(): Record<string, string | undefined> {
    const element = this;
    return new Proxy({} as Record<string, string | undefined>, {
      get(_target, key: string) {
        const value = element.getAttribute(element.dataName(key));
        return value === null ? undefined : value;
      },
      set(_target, key: string, value: string) {
        element.setAttribute(element.dataName(key), String(value));
        return true;
      },
    });
  }
  get children(): MiniElement[] { return this.childNodes.filter((node): node is MiniElement => node.nodeType === 1); }
  get nextSibling(): MiniNode | null {
    const siblings = this.parentElement?.childNodes ?? [];
    const index = siblings.indexOf(this);
    return index >= 0 ? siblings[index + 1] ?? null : null;
  }
  get textContent(): string {
    return this.childNodes.map((node) => node instanceof MiniText ? node.data : node instanceof MiniElement ? node.textContent : '').join('');
  }
  get isConnected(): boolean {
    let node: MiniElement | null = this;
    while (node) {
      if (node === this.ownerDocument.documentElement) return true;
      node = node.parentElement;
    }
    return false;
  }

  dataName(key: string): string { return `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`; }
  getAttribute(name: string): string | null { return this.attrs.has(name) ? this.attrs.get(name)! : null; }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
    if (name === 'class' && (this.classList.contains('bookmark-bar') || this.classList.contains('bar-items'))) this.style.overflow = 'hidden';
  }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  removeChild(node: MiniNode): void {
    this.childNodes = this.childNodes.filter((child) => child !== node);
    node.parentElement = null;
    node.parentNode = null;
  }
  insertBefore(node: MiniNode, next: MiniNode | null): MiniNode {
    if (node.parentElement) node.parentElement.removeChild(node);
    node.parentElement = this;
    node.parentNode = this;
    const index = next ? this.childNodes.indexOf(next) : -1;
    if (index < 0) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
    return node;
  }
  append(...nodes: MiniNode[]): void { for (const node of nodes) this.insertBefore(node, null); }
  appendChild(node: MiniNode): MiniNode { return this.insertBefore(node, null); }
  replaceChildren(...nodes: MiniNode[]): void {
    for (const child of [...this.childNodes]) child.remove();
    this.append(...nodes);
  }
  addEventListener(type: string, listener: (event: MiniEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  dispatchEvent(event: MiniEvent): boolean {
    event.target = this;
    const path: MiniElement[] = [];
    let node: MiniElement | null = this;
    while (node) {
      path.push(node);
      node = node.parentElement;
    }
    for (const current of path) {
      event.currentTarget = current;
      for (const listener of [...(current.listeners.get(event.type) ?? [])]) listener.call(current, event);
      if (event.cancelBubble || !event.bubbles) break;
    }
    return true;
  }
  focus(): void {
    const doc = this.ownerDocument;
    const prev = doc.activeElement;
    if (prev === this) return;
    doc.activeElement = this;
    prev?.dispatchEvent(new MiniEvent('focusout', { bubbles: true, relatedTarget: this }));
    this.dispatchEvent(new MiniEvent('focusin', { bubbles: true, relatedTarget: prev }));
  }
  getBoundingClientRect(): { top: number; left: number; right: number; bottom: number; width: number; height: number } {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  matches(selector: string): boolean { return parseList(selector).some((chain) => matchChain(this, chain, this)); }
  closest(selector: string): MiniElement | null {
    let node: MiniElement | null = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }
  querySelectorAll(selector: string): MiniElement[] {
    const chains = parseList(selector);
    const found: MiniElement[] = [];
    const walk = (node: MiniElement) => {
      for (const child of node.children) {
        if (chains.some((chain) => matchChain(child, chain, this))) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector: string): MiniElement | null { return this.querySelectorAll(selector)[0] ?? null; }
  contains(other: MiniNode | null): boolean {
    let node = other;
    while (node) {
      if (node === this) return true;
      node = node.parentElement;
    }
    return false;
  }
}

class MiniDocument {
  documentElement: MiniElement;
  body: MiniElement;
  activeElement: MiniElement | null = null;
  nodeType = 9;
  constructor() {
    this.documentElement = new MiniElement(this, 'html');
    this.body = new MiniElement(this, 'body');
    this.documentElement.appendChild(this.body);
  }
  createElement(tag: string): MiniElement { return new MiniElement(this, tag.toLowerCase()); }
}

interface Compound { tag?: string; id?: string; classes: string[]; attrs: string[]; scope: boolean }
interface Part { comb: 'start' | '>' | ' '; compound: Compound }

function parseList(selector: string): Part[][] {
  const tokens = tokenize(selector);
  const chains: Part[][] = [];
  let current: Part[] = [];
  let comb: Part['comb'] = 'start';
  const flush = () => {
    if (current.length) chains.push(current);
    current = [];
    comb = 'start';
  };
  for (const token of tokens) {
    if (token === ',') { flush(); continue; }
    if (token === '>') { comb = '>'; continue; }
    if (token === ' ') { comb = ' '; continue; }
    current.push({ comb, compound: parseCompound(token) });
    comb = 'start';
  }
  flush();
  return chains;
}

function tokenize(selector: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < selector.length) {
    if (/\s/.test(selector[index])) {
      let next = index;
      while (next < selector.length && /\s/.test(selector[next])) next += 1;
      const prev = tokens[tokens.length - 1];
      const upcoming = selector[next];
      if (upcoming !== '>' && upcoming !== ',' && prev && prev !== '>' && prev !== ',') tokens.push(' ');
      index = next;
      continue;
    }
    if (selector[index] === '>' || selector[index] === ',') {
      tokens.push(selector[index]);
      index += 1;
      continue;
    }
    let compound = '';
    while (index < selector.length && !/[\s>,]/.test(selector[index])) {
      if (selector[index] === '[') {
        const end = selector.indexOf(']', index);
        compound += selector.slice(index, end + 1);
        index = end + 1;
      } else {
        compound += selector[index];
        index += 1;
      }
    }
    if (compound) tokens.push(compound);
  }
  return tokens;
}

function parseCompound(token: string): Compound {
  const compound: Compound = { classes: [], attrs: [], scope: false };
  let index = 0;
  if (token.startsWith(':scope')) { compound.scope = true; index = 6; }
  if (token[index] && /[a-zA-Z*]/.test(token[index])) {
    if (token[index] === '*') { compound.tag = '*'; index += 1; }
    else {
      const start = index;
      while (index < token.length && /[a-zA-Z0-9-]/.test(token[index])) index += 1;
      compound.tag = token.slice(start, index).toLowerCase();
    }
  }
  while (index < token.length) {
    if (token[index] === '#') {
      index += 1;
      const start = index;
      while (index < token.length && !'.#[:'.includes(token[index])) index += 1;
      compound.id = token.slice(start, index);
    } else if (token[index] === '.') {
      index += 1;
      const start = index;
      while (index < token.length && !'.#[:'.includes(token[index])) index += 1;
      compound.classes.push(token.slice(start, index));
    } else if (token[index] === '[') {
      const end = token.indexOf(']', index);
      compound.attrs.push(token.slice(index + 1, end).split('=')[0].trim());
      index = end + 1;
    } else break;
  }
  return compound;
}

function compoundMatches(element: MiniElement, compound: Compound, scope: MiniElement): boolean {
  if (compound.scope && element !== scope) return false;
  if (compound.tag && compound.tag !== '*' && element.tagName !== compound.tag) return false;
  if (compound.id !== undefined && element.id !== compound.id) return false;
  if (compound.classes.some((name) => !element.classList.contains(name))) return false;
  if (compound.attrs.some((name) => !element.hasAttribute(name))) return false;
  return true;
}

function matchChain(element: MiniElement | null, parts: Part[], scope: MiniElement): boolean {
  const visit = (node: MiniElement | null, index: number): boolean => {
    if (index < 0) return true;
    if (!node || !compoundMatches(node, parts[index].compound, scope)) return false;
    if (index === 0) return true;
    if (parts[index].comb === '>') return visit(node.parentElement, index - 1);
    let parent = node.parentElement;
    while (parent) {
      if (visit(parent, index - 1)) return true;
      parent = parent.parentElement;
    }
    return false;
  };
  return visit(element, parts.length - 1);
}

function decode(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, body: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (named[body]) return named[body];
    if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return entity;
  });
}

function parseAttributes(source: string): Array<[string, string]> {
  const attrs: Array<[string, string]> = [];
  const pattern = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g;
  for (const match of source.matchAll(pattern)) attrs.push([match[1].toLowerCase(), decode(match[2] ?? match[3] ?? match[4] ?? '')]);
  return attrs;
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function parseInto(parent: MiniElement, html: string): void {
  const stack = [parent];
  let index = 0;
  while (index < html.length) {
    if (html[index] !== '<') {
      const next = html.indexOf('<', index);
      const raw = html.slice(index, next === -1 ? html.length : next);
      const text = decode(raw);
      if (text) stack[stack.length - 1].appendChild(new MiniText(parent.ownerDocument, text));
      index = next === -1 ? html.length : next;
      continue;
    }
    if (html.startsWith('<!--', index)) {
      const end = html.indexOf('-->', index);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', index) || html.startsWith('<?', index)) {
      const end = html.indexOf('>', index);
      index = end === -1 ? html.length : end + 1;
      continue;
    }
    const end = html.indexOf('>', index);
    const token = html.slice(index + 1, end === -1 ? html.length : end);
    index = end === -1 ? html.length : end + 1;
    if (token.startsWith('/')) {
      const name = token.slice(1).trim().toLowerCase().replace(/\/$/, '');
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        if (stack[depth].tagName === name) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }
    const selfClosing = token.endsWith('/');
    const body = selfClosing ? token.slice(0, -1) : token;
    const space = body.search(/\s/);
    const name = (space === -1 ? body : body.slice(0, space)).toLowerCase();
    const element = parent.ownerDocument.createElement(name);
    for (const [attr, value] of parseAttributes(space === -1 ? '' : body.slice(space))) element.setAttribute(attr, value);
    stack[stack.length - 1].appendChild(element);
    if (!selfClosing && !VOID_TAGS.has(name)) stack.push(element);
  }
}

Object.defineProperty(MiniElement.prototype, 'innerHTML', {
  set(this: MiniElement, value: string) {
    for (const child of [...this.childNodes]) child.remove();
    parseInto(this, value);
  },
});

function clippingAncestor(node: MiniElement | null): MiniElement | null {
  let current = node?.parentElement ?? null;
  while (current) {
    if (current.style.overflow === 'hidden') return current;
    current = current.parentElement;
  }
  return null;
}

describe('bookmark bar full titles', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('places the full title outside the clipped bar on hover and keyboard focus', async () => {
    const css = readFileSync('apps/extension/src/styles/main.css', 'utf8');
    expect(css).toContain('.bookmark-bar { gap: 4px; overflow: hidden;');
    expect(css).toContain('.bar-items { flex: 1; overflow: hidden;');
    expect(css).not.toContain('overflow-y: visible');

    const toolbar: Collection = { id: 'bar', name: 'Toolbar', position: 0, toolbar: true, createdAt: now, updatedAt: now, revision: 1 };
    const nest: Collection = { id: 'nest', name: folderTitle, parentId: 'bar', position: 1, toolbar: false, createdAt: now, updatedAt: now, revision: 1 };
    const bookmark = makeBookmark({ url: 'https://long.example/a', title: bookmarkTitle, collectionId: 'bar', position: 0 }, now);
    const child = makeBookmark({ url: 'https://child.example/a', title: 'Nested child', collectionId: 'nest', position: 0 }, now);
    const doc = new MiniDocument();
    const region = doc.createElement('div');
    region.id = 'bar-region';
    region.className = 'bar-region';
    const bar = doc.createElement('nav');
    bar.id = 'bookmark-bar';
    bar.className = 'bookmark-bar';
    region.append(bar);
    doc.body.append(region);
    const failures: unknown[] = [];
    const onRejection = (error: unknown) => { failures.push(error); };
    process.on('unhandledRejection', onRejection);
    vi.stubGlobal('document', doc);
    const port = {
      async sendMessage(message: { type?: string }) {
        if (message.type === 'lumamark-list') return { items: [bookmark, child] };
        if (message.type === 'lumamark-list-collections') return { items: [toolbar, nest] };
        if (message.type === 'lumamark-get-sync-config') return { config: {} };
        if (message.type === 'lumamark-sync-status') return { metadata: {} };
        return {};
      },
    };
    try {
      mountHome(doc.body as never, port);
      const bookmarkLink = () => doc.body.querySelector('a.bar-item');
      const bookmarkTip = () => bookmarkLink()?.querySelector('.item-tooltip') ?? [...region.children].find((child) => child.classList.contains('item-tooltip') && child.textContent === bookmarkTitle) ?? null;
      await vi.waitFor(() => {
        if (failures.length) throw new Error(failures.map(String).join('\n'));
        expect(bookmarkTip()?.textContent).toBe(bookmarkTitle);
      });
      const link = bookmarkLink();
      const linkTip = link?.querySelector('.item-tooltip') ?? null;
      const folderButton = doc.body.querySelector('.folder > .bar-hit');
      const folderTip = () => folderButton?.parentElement?.querySelector(':scope > .item-tooltip')
        ?? [...region.children].find((child) => child.classList.contains('item-tooltip') && child.textContent === folderTitle)
        ?? null;
      expect(link).toBeTruthy();
      expect(folderButton).toBeTruthy();
      expect(clippingAncestor(linkTip)).not.toBeNull();
      expect(clippingAncestor(folderTip())).not.toBeNull();

      link?.querySelector('.item-label')?.dispatchEvent(new MiniEvent('mouseover', { bubbles: true }));
      expect(linkTip?.textContent).toBe(bookmarkTitle);
      expect(linkTip?.style.display).toBe('block');
      expect(linkTip?.parentElement?.id).toBe('bar-region');
      expect(clippingAncestor(linkTip)).toBeNull();
      expect(linkTip?.closest('.bookmark-bar')).toBeNull();
      expect(linkTip?.closest('.bar-items')).toBeNull();

      link?.dispatchEvent(new MiniEvent('mouseout', { bubbles: true }));
      expect(linkTip?.style.display).not.toBe('block');
      expect(clippingAncestor(linkTip)).not.toBeNull();

      link?.focus();
      expect(doc.activeElement).toBe(link);
      expect(linkTip?.style.display).toBe('block');
      expect(linkTip?.parentElement?.id).toBe('bar-region');
      expect(clippingAncestor(linkTip)).toBeNull();

      link?.dispatchEvent(new MiniEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
      expect(doc.activeElement).toBe(folderButton);
      const liftedFolderTip = folderTip();
      expect(liftedFolderTip?.textContent).toBe(folderTitle);
      expect(liftedFolderTip?.style.display).toBe('block');
      expect(liftedFolderTip?.parentElement?.id).toBe('bar-region');
      expect(clippingAncestor(liftedFolderTip)).toBeNull();
      expect(clippingAncestor(linkTip)).not.toBeNull();

      folderButton?.dispatchEvent(new MiniEvent('click', { bubbles: true }));
      const openMenu = region.children.find((child) => child.classList.contains('folder-menu') && !child.hidden) ?? null;
      expect(openMenu?.textContent).toContain('Nested child');
      expect(openMenu?.parentElement?.id).toBe('bar-region');
      expect(openMenu?.closest('.bookmark-bar')).toBeNull();
      expect(openMenu?.closest('.bar-items')).toBeNull();
      expect(clippingAncestor(openMenu)).toBeNull();
      expect(failures).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });
});
