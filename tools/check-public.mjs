import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PUBLIC_FILES } from './public-files.mjs';

const base = new URL(process.argv[2] || 'https://usaginchaku.github.io/ginchakurabu/');
assert.equal(base.protocol, 'https:');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const request = url => fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'manual' });
const http = new URL(base);
http.protocol = 'http:';
const redirect = await request(http);
assert.ok([301, 302, 307, 308].includes(redirect.status), 'HTTP must redirect');
assert.equal(new URL(redirect.headers.get('location'), http).protocol, 'https:');

for (const relative of PUBLIC_FILES) {
  const response = await request(new URL(relative, base));
  assert.equal(response.status, 200, relative);
  const downloaded = Buffer.from(await response.arrayBuffer());
  const local = await readFile(new URL(`../dist/${relative}`, import.meta.url));
  assert.equal(hash(downloaded), hash(local), `Deployed content differs: ${relative}`);
  if (relative === 'index.html') {
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(response.headers.get('strict-transport-security') || '', /max-age=[1-9]/);
    assert.match(downloaded.toString('utf8'), /Content-Security-Policy/);
  }
  console.log(`Verified: ${relative}`);
}
for (const privatePath of ['.env', 'package.json', 'server.mjs', 'tools/compose.py', 'SECURITY.md']) {
  const response = await request(new URL(privatePath, base));
  assert.equal(response.status, 404, `Unexpected deployed file: ${privatePath}`);
}
console.log('Public checks passed: HTTPS redirect, HSTS, CSP, all 9 file hashes, and 5 excluded paths.');
