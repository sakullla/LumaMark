/**
 * UI preview harness: serves the built extension pages in a normal browser tab
 * with the real background logic running in-page (fake tabs/storage/alarms API
 * + IndexedDB) and seeded sample data.
 *
 *   npm run preview
 *   open http://localhost:4178/home.html   (library.html, popup.html, settings.html)
 *   query: ?theme=dark|light  ?lang=zh|en  ?reset=1  ?tab=<url of the "active tab">
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist/extension/chrome');
const port = Number(process.argv[2] ?? 4178);

const shimSource = `
import { startBackground } from './apps/extension/src/background/index';
import { IndexedDbRepository } from './packages/storage/src/index';
import { makeBookmark } from './packages/domain/src/index';

const params = new URLSearchParams(location.search);
if (params.get('theme')) localStorage.setItem('lumamark-theme', params.get('theme'));
if (params.get('lang')) {
  const language = params.get('lang') === 'zh' ? 'zh-CN' : 'en-US';
  Object.defineProperty(navigator, 'language', { value: language, configurable: true });
  Object.defineProperty(navigator, 'languages', { value: [language], configurable: true });
}
const tabUrl = params.get('tab') ?? 'https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API';
const activeTab = { url: tabUrl, title: params.get('tab') ? new URL(tabUrl).hostname : 'IndexedDB API - Web APIs | MDN', favIconUrl: params.get('tab') ? undefined : 'https://developer.mozilla.org/favicon-48x48.png' };
const memory = {};
let listener;
const runtime = {
  getURL: (path) => path,
  onMessage: { addListener: (callback) => { listener = callback; } },
  sendMessage: (message) => new Promise((resolveMessage) => { const keep = listener?.(message, {}, resolveMessage); if (keep !== true) resolveMessage(undefined); }),
  getManifest: () => ({ version: '0.2.0' }),
};
const api = {
  tabs: { query: async () => [activeTab], create: async ({ url }) => { location.href = url; } },
  runtime,
  storage: { local: { get: async (keys) => { const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(memory); return Object.fromEntries(list.filter((key) => key in memory).map((key) => [key, memory[key]])); }, set: async (items) => { Object.assign(memory, items); } } },
  alarms: { create() {}, clear: async () => true, get: async () => undefined, onAlarm: { addListener() {} } },
  i18n: { getUILanguage: () => navigator.language },
  bookmarks: fakeBookmarks(),
};

/** Minimal in-memory chrome.bookmarks so the browser-bookmark bridge runs in the preview. */
function fakeBookmarks() {
  const nodes = new Map([['0', { id: '0', title: '', children: ['1', '2'] }], ['1', { id: '1', parentId: '0', title: 'Bookmarks bar', folderType: 'bookmarks-bar', children: [] }], ['2', { id: '2', parentId: '0', title: 'Other bookmarks', folderType: 'other', children: [] }]]);
  let next = 10;
  const build = (id, index) => { const node = nodes.get(id); return { ...node, index, children: node.url ? undefined : node.children.map(build) }; };
  const detach = (id) => { const node = nodes.get(id); const list = nodes.get(node.parentId).children; list.splice(list.indexOf(id), 1); };
  const attach = (id, parentId, index) => { const node = nodes.get(id); node.parentId = parentId; const list = nodes.get(parentId).children; if (index === undefined) list.push(id); else list.splice(index, 0, id); };
  const drop = (id) => { for (const child of nodes.get(id).children ?? []) drop(child); nodes.delete(id); };
  const event = { addListener() {} };
  return {
    getTree: async () => [build('0', 0)],
    create: async ({ parentId, index, title, url }) => { const id = String(next++); nodes.set(id, { id, title: title ?? '', url, children: [] }); attach(id, parentId, index); return { id, parentId, title, url }; },
    update: async (id, changes) => { Object.assign(nodes.get(id), changes); return nodes.get(id); },
    move: async (id, { parentId, index }) => { const target = parentId ?? nodes.get(id).parentId; detach(id); attach(id, target, index); return nodes.get(id); },
    remove: async (id) => { detach(id); nodes.delete(id); },
    removeTree: async (id) => { detach(id); drop(id); },
    onCreated: event, onRemoved: event, onChanged: event, onMoved: event,
  };
}
const repository = new IndexedDbRepository();

async function seed() {
  if (params.get('reset')) { for (const item of await repository.list({ includeDeleted: true })) await repository.remove(item.id); }
  if ((await repository.list({ includeDeleted: true })).length) return;
  const now = Date.now();
  const day = 86400000;
  const stamp = new Date(now).toISOString();
  const folders = [
    ['bar', 'Bookmarks bar', undefined, true], ['dev', 'Development', 'bar'], ['design', 'Design inspiration', 'bar'], ['read', 'Reading list'], ['tools', 'Tools'], ['rust', 'Rust', 'dev'],
  ];
  for (const [index, [id, name, parentId, toolbar]] of folders.entries()) await repository.putCollection({ id, name, parentId, toolbar: Boolean(toolbar), position: index, createdAt: stamp, updatedAt: stamp, revision: 1 });
  const rows = [
    ['https://github.com/', 'GitHub', 'bar', [], '', true, 0.1],
    ['https://news.ycombinator.com/', 'Hacker News', 'bar', ['news'], '', false, 0.5],
    ['https://developer.mozilla.org/en-US/docs/Web/CSS/color-mix', 'color-mix() - CSS: Cascading Style Sheets | MDN', 'dev', ['css', 'reference'], 'Great for theme tokens.', true, 1],
    ['https://github.com/rust-lang/rust', 'rust-lang/rust: Empowering everyone to build reliable and efficient software.', 'rust', ['rust', 'oss'], '', true, 1.5],
    ['https://www.figma.com/community', 'Figma Community — Explore files, plugins and widgets', 'design', ['design', 'ui'], 'Look for dashboard kits', false, 2],
    ['https://linear.app/method', 'The Linear Method — Practices for building', 'read', ['product', 'read-later'], 'Read the section on momentum.', false, 3],
    ['https://vitejs.dev/guide/', 'Getting Started | Vite', 'tools', ['js', 'tooling'], '', false, 5],
    ['https://www.smashingmagazine.com/2024/01/accessible-forms/', 'A Complete Guide To Accessible Front-End Components — Smashing Magazine', 'read', ['a11y', 'read-later'], 'Checklist for focus states and labels.', true, 8],
    ['https://tailwindcss.com/docs/customizing-colors', 'Customizing Colors - Tailwind CSS', 'design', ['css', 'design'], '', false, 10],
    ['https://doc.rust-lang.org/book/', 'The Rust Programming Language', 'rust', ['rust', 'book'], 'Chapter 15: smart pointers', false, 12],
    ['https://excalidraw.com/', 'Excalidraw — Collaborative whiteboarding made easy', 'tools', ['tools', 'drawing'], '', true, 15],
    ['https://web.dev/articles/vitals', 'Web Vitals | Articles | web.dev', 'bar', ['performance'], '', false, 20],
    ['https://zh.wikipedia.org/wiki/书签', '书签 - 维基百科，自由的百科全书', undefined, ['wiki', '中文'], '一个非常长的标题和备注用于检查长文本在窄窗口下不会横向溢出：这是一段测试文本，包含很多字符。', false, 30],
    ['https://www.nextcloud.com/', 'Nextcloud - Open source content collaboration platform', 'tools', ['webdav', 'self-hosted'], 'Use for LumaMark WebDAV sync.', false, 40],
    ['https://dribbble.com/shots/popular', 'Popular Shots on Dribbble', 'design', ['design', 'inspiration'], '', false, 45],
    ['https://www.youtube.com/', 'YouTube', 'bar', [], '', false, 50],
    ['https://www.notion.so/', 'Notion – The all-in-one workspace', 'bar', [], '', false, 55],
  ];
  for (const [index, [url, title, collectionId, tags, notes, favorite, age]] of rows.entries()) {
    await repository.put(makeBookmark({ url, title, collectionId, tags, notes, favorite, position: index }, new Date(now - age * day).toISOString()));
  }
}

globalThis.chrome = { runtime };
globalThis.__lumamarkReady = seed().catch((error) => { console.error('LumaMark preview seed failed', error); }).then(() => startBackground(api, repository));
`;

const shim = await build({ stdin: { contents: shimSource, resolveDir: root, sourcefile: 'preview-shim.ts' }, bundle: true, format: 'iife', platform: 'browser', target: ['es2020'], write: false });
const shimCode = shim.outputFiles[0].text;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`);
  const path = url.pathname === '/' ? '/home.html' : url.pathname;
  if (path === '/preview-shim.js') { response.writeHead(200, { 'content-type': types['.js'] }); response.end(shimCode); return; }
  try {
    let body = await readFile(resolve(dist, `.${path}`));
    if (path.endsWith('.html')) {
      // Delay page boot until the in-page background has seeded data.
      const page = path.slice(1, -5);
      body = Buffer.from(body.toString().replace(`<script src="${page}.js"></script>`, `<script src="preview-shim.js"></script><script>__lumamarkReady.then(() => { const s = document.createElement('script'); s.src = '${page}.js'; document.body.append(s); });</script>`));
    }
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(port, () => console.log(`LumaMark preview at http://localhost:${port}/home.html (library.html, popup.html, settings.html)`));
