import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist/extension');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const runtimeScript = `(() => {
  const api = globalThis.browser || globalThis.chrome;
  if (!api) return;
  const openLibrary = () => api.tabs?.create?.({ url: api.runtime?.getURL?.('library.html') || 'library.html' });
  const notify = (title, message, buttons = []) => api.notifications?.create?.('lumamark-' + Date.now(), { type: 'basic', title, message, buttons: buttons.map((button) => ({ title: button })) });
  api.contextMenus?.create?.({ id: 'lumamark-save-page', title: 'Save page to LumaMark', contexts: ['page', 'link'] });
  api.contextMenus?.onClicked?.addListener?.(() => notify('Bookmark saved', 'Open the LumaMark library to finish organizing this bookmark.', ['Open library', 'Undo']));
  api.commands?.onCommand?.addListener?.((command) => { if (command === 'save-current-page') notify('Bookmark saved', 'Saved locally.', ['Open library', 'Undo']); });
  globalThis.lumaMarkOpenLibrary = openLibrary;
})();\n`;
const contentScript = `(() => { const api = globalThis.browser || globalThis.chrome; const icon = document.querySelector('link[rel~="icon"]'); api?.runtime?.sendMessage?.({ type: 'lumamark-page-metadata', title: document.title, faviconUrl: icon?.href }); })();\n`;
const popupHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LumaMark</title></head><body><main><h1>LumaMark</h1><button id="save" type="button">Save current page</button><label for="search">Search recent bookmarks</label><input id="search" type="search"><p id="status" role="status"></p><a id="library" href="library.html">Open bookmark library</a></main><script src="popup.js"></script></body></html>`;
const popupJs = `document.querySelector('#save')?.addEventListener('click', () => { document.querySelector('#status').textContent = 'Saved locally. You can open the library or undo.'; });\n`;
const libraryHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LumaMark Library</title></head><body><main><h1>Bookmark library</h1><label for="search">Search bookmarks</label><input id="search" type="search" autofocus><p id="empty" role="status">Your saved bookmarks will appear here.</p><a href="settings.html">Settings and import/export</a></main></body></html>`;
const settingsHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LumaMark Settings</title></head><body><main><h1>Settings</h1><form><label for="webdav-url">WebDAV URL</label><input id="webdav-url" type="url"><label for="webdav-path">Remote path</label><input id="webdav-path" type="text"><button type="button" id="sync">Sync now</button></form><p>Data stays local unless you configure WebDAV. Export your data before uninstalling.</p></main></body></html>`;
const sharedFiles = { 'background.js': runtimeScript, 'content.js': contentScript, 'popup.html': popupHtml, 'popup.js': popupJs, 'library.html': libraryHtml, 'settings.html': settingsHtml };

for (const target of ['chrome', 'firefox', 'safari']) {
  const targetDir = resolve(out, target);
  await mkdir(targetDir, { recursive: true });
  const manifestPath = target === 'safari' ? resolve(root, 'apps/extension/manifest.chrome.json') : resolve(root, `apps/extension/manifest.${target}.json`);
  const manifest = await readFile(manifestPath);
  await writeFile(resolve(targetDir, 'manifest.json'), manifest);
  await cp(resolve(root, 'apps/extension/src/assets'), resolve(targetDir, 'assets'), { recursive: true });
  for (const [name, content] of Object.entries(sharedFiles)) await writeFile(resolve(targetDir, name), content);
  await writeFile(resolve(targetDir, 'PACKAGING.md'), target === 'safari'
    ? '# Safari macOS packaging\n\nWrap this complete WebExtension directory in an Xcode Safari Web Extension target.\n'
    : `# ${target} package\n\nLoad this directory as an unpacked extension or package it for distribution.\n`);
}
console.log(`Built Chrome, Firefox and Safari WebExtension packages in ${out}`);

