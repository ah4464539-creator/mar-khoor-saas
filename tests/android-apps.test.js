// The two Android apps (Trusted Web Activity) and the website must agree on package names,
// otherwise Android shows a browser bar instead of a full-screen app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const gradle = readFileSync('android/app/build.gradle', 'utf8');
const links = JSON.parse(readFileSync('public/.well-known/assetlinks.json', 'utf8'));

test('assetlinks lists both app packages with valid SHA-256 fingerprints', () => {
  const packages = links.map(l => l.target.package_name).sort();
  assert.deepEqual(packages, ['com.markhoor.app', 'com.markhoor.business']);
  for (const pkg of packages) assert.match(gradle, new RegExp("applicationId '" + pkg.replace(/\./g, '\\.') + "'"));
  for (const l of links) {
    assert.deepEqual(l.relation, ['delegate_permission/common.handle_all_urls']);
    assert.ok(l.target.sha256_cert_fingerprints.length >= 1);
    for (const fp of l.target.sha256_cert_fingerprints) assert.match(fp, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  }
});

test('apps open the right pages and no signing secret is in the repo', () => {
  assert.match(gradle, /launchUrl', 'https:\/\/' \+ host \+ '\/restaurant\.html#order-desk'/);
  assert.match(gradle, /launchUrl', 'https:\/\/' \+ host \+ '\/app'/);
  assert.match(gradle, /MK_UPLOAD_STORE_FILE/);
  assert.match(readFileSync('android/.gitignore', 'utf8'), /\*\.jks/);
  assert.match(readFileSync('src/server.js', 'utf8'), /app\.use\('\/\.well-known'/);
});
