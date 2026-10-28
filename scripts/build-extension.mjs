import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist/extension');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const target of ['chrome', 'firefox']) {
  const targetDir = resolve(out, target);
  await mkdir(targetDir, { recursive: true });
  const manifest = await readFile(resolve(root, `apps/extension/manifest.${target}.json`));
  await writeFile(resolve(targetDir, 'manifest.json'), manifest);
  await cp(resolve(root, 'apps/extension/src/assets'), resolve(targetDir, 'assets'), { recursive: true });
}
await mkdir(resolve(out, 'safari'), { recursive: true });
await writeFile(resolve(out, 'safari', 'README.md'), '# Safari macOS packaging\n\nWrap the shared WebExtension build in an Xcode Safari Web Extension target.\n');
console.log(`Built extension manifests in ${out}`);

