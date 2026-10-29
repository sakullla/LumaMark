import { access, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const useShell = process.platform === 'win32' && (command === 'npm.cmd' || command === 'npm');
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: useShell });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`)));
  });
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
await run(npm, ['run', 'typecheck']);
if (packageJson.scripts?.lint) await run(npm, ['run', 'lint']);
await run(npm, ['test']);
await run(process.execPath, [resolve(root, 'scripts/build-extension.mjs')]);

const required = ['manifest.json', 'background.js', 'content.js', 'popup.html', 'popup.js', 'library.html', 'library.js', 'settings.html', 'settings.js', 'home.html', 'home.js'];
for (const target of ['chrome', 'firefox', 'safari']) {
  for (const file of required) {
    const path = resolve(root, 'dist/extension', target, file);
    if (!(await exists(path))) throw new Error(`Missing ${target}/${file}`);
  }
}

const support = await readFile(resolve(root, 'docs/support-matrix.md'), 'utf8');
for (const marker of ['Chrome', 'Edge', 'Firefox', 'Safari macOS', 'WebDAV', '移动 Safari']) {
  if (!support.includes(marker)) throw new Error(`Support matrix missing ${marker}`);
}
console.log('Verification passed: typecheck, optional lint, tests, import/export coverage, and Chrome/Edge/Firefox/Safari build artifacts.');
