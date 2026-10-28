import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist/extension');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const popupHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LumaMark</title></head><body><main><h1>LumaMark</h1><button id="save" type="button">Save current page</button><button id="undo" type="button">Undo</button><label for="search">Search recent bookmarks</label><input id="search" type="search"><p id="status" role="status"></p><a id="library" href="library.html">Open bookmark library</a></main><script src="popup.js"></script></body></html>`;
const popupJs = `const send=(type)=>globalThis.browser?.runtime?.sendMessage?.({type})||globalThis.chrome?.runtime?.sendMessage?.({type}); document.querySelector('#save')?.addEventListener('click',()=>{send('lumamark-save'); document.querySelector('#status').textContent='Saving current page…';}); document.querySelector('#undo')?.addEventListener('click',()=>{send('lumamark-undo'); document.querySelector('#status').textContent='Undo requested.';});\n`;
const libraryHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LumaMark Library</title></head><body><main><h1>Bookmark library</h1><label for="search">Search bookmarks</label><input id="search" type="search" autofocus><ul id="bookmarks"></ul><p id="empty" role="status">Loading bookmarks…</p><a href="settings.html">Settings and import/export</a></main><script src="library.js"></script></body></html>`;
const libraryJs = `const api=globalThis.browser||globalThis.chrome; const list=document.querySelector('#bookmarks'); const empty=document.querySelector('#empty'); api?.runtime?.sendMessage?.({type:'lumamark-list'},(response)=>{const items=response?.items||[]; empty.hidden=items.length>0; empty.textContent=items.length?'':'No bookmarks yet.'; items.forEach((item)=>{const li=document.createElement('li'); const a=document.createElement('a'); a.href=item.url; a.textContent=item.title||item.url; li.append(a); list.append(li);});}); document.querySelector('#search')?.addEventListener('input',(event)=>{const q=event.target.value.toLowerCase(); [...list.children].forEach((li)=>{li.hidden=!li.textContent.toLowerCase().includes(q);});});\n`;
const settingsHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LumaMark Settings</title></head><body><main><h1>Settings</h1><form><label for="webdav-url">WebDAV URL</label><input id="webdav-url" type="url"><label for="webdav-path">Remote path</label><input id="webdav-path" type="text"><button type="button" id="sync">Sync now</button></form><p id="status">Data stays local unless you configure WebDAV. Export your data before uninstalling.</p></main><script src="settings.js"></script></body></html>`;
const settingsJs = `document.querySelector('#sync')?.addEventListener('click',()=>{document.querySelector('#status').textContent='Sync requested. Configure WebDAV in the host app.';});\n`;

for (const target of ['chrome', 'firefox', 'safari']) {
  const targetDir = resolve(out, target);
  await mkdir(targetDir, { recursive: true });
  const manifestPath = target === 'safari' ? resolve(root, 'apps/extension/manifest.chrome.json') : resolve(root, `apps/extension/manifest.${target}.json`);
  const manifest = await readFile(manifestPath);
  await writeFile(resolve(targetDir, 'manifest.json'), manifest);
  await cp(resolve(root, 'apps/extension/src/assets'), resolve(targetDir, 'assets'), { recursive: true });
  await build({ entryPoints: [resolve(root, 'apps/extension/src/background/index.ts')], bundle: true, format: 'iife', platform: 'browser', outfile: resolve(targetDir, 'background.js') });
  await build({ entryPoints: [resolve(root, 'apps/extension/src/content/index.ts')], bundle: true, format: 'iife', platform: 'browser', outfile: resolve(targetDir, 'content.js') });
  await writeFile(resolve(targetDir, 'popup.html'), popupHtml);
  await writeFile(resolve(targetDir, 'popup.js'), popupJs);
  await writeFile(resolve(targetDir, 'library.html'), libraryHtml);
  await writeFile(resolve(targetDir, 'library.js'), libraryJs);
  await writeFile(resolve(targetDir, 'settings.html'), settingsHtml);
  await writeFile(resolve(targetDir, 'settings.js'), settingsJs);
  await writeFile(resolve(targetDir, 'PACKAGING.md'), target === 'safari'
    ? '# Safari macOS packaging\n\nWrap this complete WebExtension directory in an Xcode Safari Web Extension target.\n'
    : `# ${target} package\n\nLoad this directory as an unpacked extension or package it for distribution.\n`);
}
console.log(`Built Chrome, Firefox and Safari WebExtension packages in ${out}`);

