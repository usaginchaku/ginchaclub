import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PUBLIC_FILES } from '../tools/public-files.mjs';

const root = new URL('../', import.meta.url);
test('the release contains only runtime files and generated audio', () => {
  assert.equal(new Set(PUBLIC_FILES).size, PUBLIC_FILES.length);
  for (const file of PUBLIC_FILES) {
    assert.match(file, /^(index\.html|style\.css|src\/[a-z]+\.js|assets\/favicon\.svg|assets\/audio\/poyo-pop\.(wav|mp3))$/);
  }
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
