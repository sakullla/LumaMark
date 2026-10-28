import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist/extension');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const htmlShell = (title, script) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body><script src="${script}"></script></body></html>`;

async function bundleEntry(contents, outfile) {
  await build({
    stdin: { contents, resolveDir: root, sourcefile: `${outfile}.entry.ts` },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    loader: { '.css': 'text' },
    outfile,
  });
}

async function bundleSource(entryPoint, outfile) {
  await build({
    entryPoints: [resolve(root, entryPoint)],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    outfile,
  });
}

const pageEntries = {
  popup: { title: 'LumaMark', documentExport: 'popupDocument', mount: 'mountPopup', module: './apps/extension/src/pages/popup.ts' },
  library: { title: 'LumaMark Library', documentExport: 'libraryDocument', mount: 'mountLibrary', module: './apps/extension/src/pages/library.ts' },
  settings: { title: 'LumaMark Settings', documentExport: 'settingsDocument', mount: 'mountSettings', module: './apps/extension/src/pages/settings.ts' },
};

for (const target of ['chrome', 'firefox', 'safari']) {
  const targetDir = resolve(out, target);
  await mkdir(targetDir, { recursive: true });
  const manifestPath = target === 'safari'
    ? resolve(root, 'apps/extension/manifest.chrome.json')
    : resolve(root, `apps/extension/manifest.${target}.json`);
  await writeFile(resolve(targetDir, 'manifest.json'), await readFile(manifestPath));
  await cp(resolve(root, 'apps/extension/src/assets'), resolve(targetDir, 'assets'), { recursive: true });

  await bundleSource('apps/extension/src/background/index.ts', resolve(targetDir, 'background.js'));
  await bundleSource('apps/extension/src/content/index.ts', resolve(targetDir, 'content.js'));

  for (const [name, page] of Object.entries(pageEntries)) {
    const entry = `
      import { ${page.documentExport}, ${page.mount} } from '${page.module}';
      import css from './apps/extension/src/styles/main.css';
      const start = () => {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.append(style);
        document.body.innerHTML = ${page.documentExport}();
        ${page.mount}(document);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
      else start();
    `;
    await bundleEntry(entry, resolve(targetDir, `${name}.js`));
    await writeFile(resolve(targetDir, `${name}.html`), htmlShell(page.title, `${name}.js`));
  }

  await writeFile(resolve(targetDir, 'PACKAGING.md'), target === 'safari'
    ? '# Safari macOS packaging\n\nWrap this complete WebExtension directory in an Xcode Safari Web Extension target.\n'
    : `# ${target} package\n\nLoad this directory as an unpacked extension or package it for distribution.\n`);
}

console.log(`Built Chrome, Firefox and Safari WebExtension packages in ${out}`);
