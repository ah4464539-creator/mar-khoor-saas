import test from 'node:test';
import assert from 'node:assert/strict';
import { detectImage, imageSize, saveMedia, loadMedia, deleteMedia, isAllowedImageRef, isMediaPath, MediaError, MAX_IMAGE_BYTES, MEDIA_TABLE_SQL } from '../src/media-store.js';
import { sanitizeSiteConfig, renderSitePage } from '../src/site-builder.js';
import { readFileSync } from 'node:fs';

const png = (w, h) => { const b = Buffer.alloc(64); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const jpg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0]);
const webp = () => { const b = Buffer.alloc(40); b.write('RIFF', 0, 'ascii'); b.write('WEBP', 8, 'ascii'); b.write('VP8X', 12, 'ascii'); b.writeUIntLE(799, 24, 3); b.writeUIntLE(599, 27, 3); return b; };

function mockPool({ count = 0, bytes = 0, rows = [] } = {}) {
  const calls = [];
  return {
    calls,
    query: async sql => { calls.push(['query', sql]); return [[]]; },
    execute: async (sql, params) => {
      calls.push([sql, params]);
      if (sql.startsWith('SELECT COUNT')) return [[{ count, bytes }]];
      if (sql.startsWith('INSERT')) return [{ insertId: 41 }];
      if (sql.startsWith('SELECT mime')) return [rows];
      if (sql.startsWith('DELETE')) return [{ affectedRows: params[2] === 7 ? 1 : 0 }];
      return [[]];
    },
  };
}

test('detects real image formats by magic bytes and reads their size', () => {
  assert.deepEqual(detectImage(png(10, 20)), { ext: 'png', mime: 'image/png' });
  assert.equal(detectImage(jpg(30, 40)).ext, 'jpg');
  assert.equal(detectImage(webp()).ext, 'webp');
  assert.equal(detectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(detectImage(Buffer.from('GIF89a................')), null);
  assert.deepEqual(imageSize(png(10, 20), 'png'), { width: 10, height: 20 });
  assert.deepEqual(imageSize(jpg(300, 200), 'jpg'), { width: 300, height: 200 });
  assert.deepEqual(imageSize(webp(), 'webp'), { width: 800, height: 600 });
});

test('saveMedia stores a tenant-scoped image and returns an unguessable public path', async () => {
  const pool = mockPool();
  const saved = await saveMedia(pool, { restaurantId: 7, kind: 'logo', buffer: png(512, 512), userId: 3 });
  assert.match(saved.url, /^\/media\/41-[a-f0-9]{16}\.png$/);
  assert.ok(isMediaPath(saved.url));
  const insert = pool.calls.find(([sql]) => String(sql).startsWith('INSERT'));
  assert.equal(insert[1][0], 7);
  assert.equal(insert[1][1], 'logo');
  assert.equal(insert[1][3], 'image/png');
  assert.ok(pool.calls.some(([kind, sql]) => kind === 'query' && sql === MEDIA_TABLE_SQL), 'table is created idempotently');
});

test('saveMedia rejects wrong types, oversize files, huge dimensions and full storage', async () => {
  const reject = (args, status, pool = mockPool()) => assert.rejects(saveMedia(pool, { restaurantId: 7, kind: 'menu', ...args }), e => e instanceof MediaError && e.status === status);
  await reject({ buffer: Buffer.from('<svg onload=alert(1)></svg>             ') }, 415);
  await reject({ buffer: Buffer.alloc(MAX_IMAGE_BYTES + 1, 0xff) }, 413);
  await reject({ buffer: png(9000, 10) }, 422);
  await reject({ kind: 'avatar', buffer: png(10, 10) }, 400);
  await reject({ buffer: png(10, 10) }, 409, mockPool({ count: 400 }));
  await reject({ buffer: png(10, 10) }, 409, mockPool({ bytes: 250 * 1024 * 1024 }));
});

test('loadMedia needs the exact token and matching type; deleteMedia is restaurant-scoped', async () => {
  const pool = mockPool({ rows: [{ mime: 'image/png', data: Buffer.from('x') }] });
  assert.ok(await loadMedia(pool, '/media/41-0123456789abcdef.png'));
  assert.equal(await loadMedia(pool, '/media/41-0123456789abcdef.jpg'), null);
  assert.equal(await loadMedia(pool, '/media/41-xyz.png'), null);
  assert.equal(await loadMedia(pool, '/media/../etc/passwd'), null);
  const lookup = pool.calls.find(([sql]) => String(sql).startsWith('SELECT mime'));
  assert.deepEqual(lookup[1], [41, '0123456789abcdef']);
  assert.equal(await deleteMedia(pool, 7, '/media/41-0123456789abcdef.png'), true);
  assert.equal(await deleteMedia(pool, 8, '/media/41-0123456789abcdef.png'), false);
});

test('image references accept uploaded media paths and HTTPS URLs only', () => {
  assert.ok(isAllowedImageRef('/media/5-aaaaaaaaaaaaaaaa.webp'));
  assert.ok(isAllowedImageRef('https://cdn.example.com/a.jpg'));
  for (const bad of ['http://x.com/a.jpg', 'javascript:alert(1)', '/media/5-aaaa.webp', '//evil.com/a.png', 'https://u:p@x.com/a.png', 'data:image/png;base64,AA'])
    assert.equal(isAllowedImageRef(bad), false, bad);
});

test('website config keeps only uploaded logo, cover and up to 8 gallery photos, and renders them escaped', () => {
  const restaurant = { name: 'Cheema Cafe', slug: 'cheema-cafe', currency: 'PKR' };
  const gallery = Array.from({ length: 10 }, (_, i) => '/media/' + (i + 1) + '-aaaaaaaaaaaaaaaa.jpg');
  const c = sanitizeSiteConfig({ logo: '/media/2-bbbbbbbbbbbbbbbb.png', cover: 'https://evil.example/x.png', gallery: [...gallery, 'javascript:1', gallery[0]] }, restaurant);
  assert.equal(c.logo, '/media/2-bbbbbbbbbbbbbbbb.png');
  assert.ok(!('cover' in c));
  assert.equal(c.gallery.length, 8);
  assert.ok(!('logo' in sanitizeSiteConfig({ logo: '"><script>' }, restaurant)));
  const html = renderSitePage({ restaurant, config: { ...c, cover: '/media/3-cccccccccccccccc.webp' }, items: [{ name: 'Tea', price_minor: 100, image_url: '/media/9-dddddddddddddddd.jpg' }] });
  assert.match(html, /class="site-logo" src="\/media\/2-bbbbbbbbbbbbbbbb\.png"/);
  assert.match(html, /src="\/media\/3-cccccccccccccccc\.webp"/);
  assert.match(html, /class="site-gallery"/);
  assert.ok(!html.includes('<script'));
});

test('upload route is admin-only, size-limited and media is served with safe headers', () => {
  const src = readFileSync(new URL('../src/media.js', import.meta.url), 'utf8');
  assert.match(src, /requireAuth, restaurantAdmin/);
  assert.match(src, /role='admin'/);
  assert.match(src, /limit: MAX_IMAGE_BYTES/);
  assert.match(src, /default-src 'none'; sandbox/);
  assert.ok(readFileSync(new URL('../src/server.js', import.meta.url), 'utf8').includes('app.use(mediaRouter(pool));'));
  assert.ok(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8').includes('CREATE TABLE IF NOT EXISTS restaurant_media'));
});
