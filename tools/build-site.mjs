import { copyFile, lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_FILES } from './public-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
if (dirname(output) !== root) throw new Error('Build output must stay inside the project.');
const existing = await lstat(output).catch(error => {
  if (error.code !== 'ENOENT') throw error;
});
if (existing?.isSymbolicLink()) throw new Error('Refusing to replace a linked build directory.');

// Validate before removing the previous build, and never follow links outside
// the checkout when preparing an upload.
for (const relative of PUBLIC_FILES) {
  let current = root;
  for (const part of relative.split('/')) {
    current = resolve(current, part);
    if (!current.startsWith(root + sep) || (await lstat(current)).isSymbolicLink()) {
      throw new Error(`Unsafe public file: ${relative}`);
    }
  }
  if (!(await lstat(current)).isFile()) throw new Error(`Not a file: ${relative}`);
}

await rm(output, { recursive: true, force: true });
for (const relative of PUBLIC_FILES) {
  const destination = resolve(output, relative);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(root, relative), destination);
}
await writeFile(resolve(output, '.nojekyll'), '');
console.log(`Prepared ${PUBLIC_FILES.length} application files in dist/.`);
