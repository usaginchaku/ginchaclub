import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { PUBLIC_FILES } from '../tools/public-files.mjs';
import { SOUNDS } from '../src/sounds.js';

const root = new URL('../', import.meta.url);
const runFile = promisify(execFile);

test('published HTML and its whole module graph use one cache version', async () => {
  await runFile(process.execPath, ['tools/build-site.mjs'], { cwd: fileURLToPath(root) });
  const html = await readFile(new URL('dist/index.html', root), 'utf8');
  const version = html.match(/style\.css\?v=([a-f0-9]{12})/)[1];
  assert.ok(html.includes(`src/app.js?v=${version}`));
  for (const file of PUBLIC_FILES.filter(file => file.endsWith('.js'))) {
    const js = await readFile(new URL(`dist/${file}`, root), 'utf8');
    for (const match of js.matchAll(/from ['"]([^'"]+)['"]/g)) {
      assert.ok(match[1].endsWith(`?v=${version}`), `Stale module import in ${file}`);
      assert.ok(PUBLIC_FILES.includes(`src/${match[1].split('?')[0].slice(2)}`));
    }
  }
});
test('the release contains only runtime files and generated audio', () => {
  assert.equal(new Set(PUBLIC_FILES).size, PUBLIC_FILES.length);
  for (const file of PUBLIC_FILES) {
    assert.match(file, /^(index\.html|style\.css|src\/[a-z]+\.js|assets\/favicon\.svg|assets\/apple-touch-icon\.png|assets\/audio\/poyo-pop\.(wav|mp3))$/);
  }
});

test('all sounds have one matching accessible pad and playback controls follow them', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const pads = [...html.matchAll(/data-sound="(\d+)"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.equal(pads.length, SOUNDS.length);
  pads.forEach((pad, i) => {
    assert.equal(Number(pad[1]), i);
    assert.ok(pad[2].includes(`<span>${SOUNDS[i].label}</span>`));
  });
  assert.ok(html.indexOf('id="play"') > html.indexOf('data-sound="7"'));
  assert.ok(html.indexOf('id="volume"') > html.indexOf('data-sound="7"'));
});

test('page resources stay inside the release and inline executable content is absent', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const resources = [...html.matchAll(/(?:src|href)="(\.\/[^\"]+)"/g)].map(match => match[1].slice(2));
  for (const file of resources) assert.ok(PUBLIC_FILES.includes(file), `Missing resource: ${file}`);
  assert.doesNotMatch(html, /\son[a-z]+\s*=|javascript:|<script(?![^>]*\bsrc=)[^>]*>/i);
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  for (const directive of ["default-src 'none'", "script-src 'self'", "connect-src 'self'", "base-uri 'none'", "form-action 'none'"]) {
    assert.ok(csp.includes(directive), `Missing CSP restriction: ${directive}`);
  }
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
});
