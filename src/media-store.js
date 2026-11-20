// Restaurant images (dish photos, logo, cover, gallery) stored in MariaDB.
// No express import: testable with a mock pool. Images are public once uploaded, but every
// upload is tied to one restaurant, type-checked by magic bytes and size-limited.
import { randomBytes } from 'node:crypto';

export const MEDIA_KINDS = Object.freeze(['menu', 'logo', 'cover', 'gallery']);
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_RESTAURANT = 400;
export const MAX_BYTES_PER_RESTAURANT = 250 * 1024 * 1024;
export const MEDIA_PATH = /^\/media\/([1-9][0-9]{0,11})-([a-f0-9]{16})\.(jpg|png|webp)$/;

const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export const MEDIA_TABLE_SQL = `CREATE TABLE IF NOT EXISTS restaurant_media (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 kind ENUM('menu','logo','cover','gallery') NOT NULL,
 token CHAR(16) NOT NULL,
 mime VARCHAR(20) NOT NULL,
 byte_size INT UNSIGNED NOT NULL,
 width SMALLINT UNSIGNED NULL,
 height SMALLINT UNSIGNED NULL,
 data MEDIUMBLOB NOT NULL,
 created_by BIGINT UNSIGNED NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY restaurant_media_restaurant (restaurant_id, kind),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

// Additive and idempotent, so production needs no manual migration for this feature.
const ensured = new WeakMap();
export function ensureMediaTable(pool) {
  if (!ensured.has(pool)) ensured.set(pool, pool.query(MEDIA_TABLE_SQL).catch(error => { ensured.delete(pool); throw error; }));
  return ensured.get(pool);
}

// Identify the format from the file's first bytes; never trust the declared Content-Type alone.
export function detectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', mime: TYPES.jpg };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: TYPES.png };
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: TYPES.webp };
  return null;
}

// Best-effort pixel size (PNG IHDR, JPEG SOFn, WebP VP8/VP8L/VP8X). null when unknown.
export function imageSize(buffer, ext) {
  try {
    if (ext === 'png') return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    if (ext === 'jpg') {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset++; continue; }
        const marker = buffer[offset + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
      return null;
    }
    if (ext === 'webp') {
      const chunk = buffer.toString('ascii', 12, 16);
      if (chunk === 'VP8 ') return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const b = buffer.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
      if (chunk === 'VP8X') return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
    }
  } catch {}
  return null;
}

export const mediaUrl = (id, token, ext) => '/media/' + id + '-' + token + '.' + ext;
export const isMediaPath = value => typeof value === 'string' && MEDIA_PATH.test(value);

// A photo reference accepted anywhere an image URL is stored: our own media path or an HTTPS URL.
export function isAllowedImageRef(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  if (isMediaPath(value)) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}

export class MediaError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function saveMedia(pool, { restaurantId, kind, buffer, userId = null }) {
  if (!MEDIA_KINDS.includes(kind)) throw new MediaError(400, 'Unknown image type');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new MediaError(400, 'Choose an image to upload');
  if (buffer.length > MAX_IMAGE_BYTES) throw new MediaError(413, 'Images must be 5 MB or smaller');
  const format = detectImage(buffer);
  if (!format) throw new MediaError(415, 'Use a JPG, PNG or WebP image');
  const size = imageSize(buffer, format.ext);
  if (size && (size.width < 1 || size.height < 1 || size.width > 8000 || size.height > 8000))
    throw new MediaError(422, 'Images must be at most 8000 × 8000 pixels');
  await ensureMediaTable(pool);
  const [[usage]] = await pool.execute('SELECT COUNT(*) AS count, COALESCE(SUM(byte_size),0) AS bytes FROM restaurant_media WHERE restaurant_id=?', [restaurantId]);
  if (Number(usage.count) >= MAX_IMAGES_PER_RESTAURANT || Number(usage.bytes) + buffer.length > MAX_BYTES_PER_RESTAURANT)
    throw new MediaError(409, 'Image storage for this restaurant is full. Remove unused photos first.');
  const token = randomBytes(8).toString('hex');
  const [result] = await pool.execute(
    'INSERT INTO restaurant_media (restaurant_id,kind,token,mime,byte_size,width,height,data,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
    [restaurantId, kind, token, format.mime, buffer.length, size?.width ?? null, size?.height ?? null, buffer, userId]);
  return { id: Number(result.insertId), url: mediaUrl(result.insertId, token, format.ext), mime: format.mime, bytes: buffer.length, width: size?.width ?? null, height: size?.height ?? null };
}

export async function loadMedia(pool, path) {
  const match = MEDIA_PATH.exec(path);
  if (!match) return null;
  await ensureMediaTable(pool);
  const [rows] = await pool.execute('SELECT mime,data FROM restaurant_media WHERE id=? AND token=? LIMIT 1', [Number(match[1]), match[2]]);
  if (!rows.length || rows[0].mime !== TYPES[match[3]]) return null;
  return { mime: rows[0].mime, data: rows[0].data };
}

// Removal is scoped to the owning restaurant, so one tenant can never delete another's image.
export async function deleteMedia(pool, restaurantId, path) {
  const match = MEDIA_PATH.exec(path);
  if (!match) return false;
  await ensureMediaTable(pool);
  const [result] = await pool.execute('DELETE FROM restaurant_media WHERE id=? AND token=? AND restaurant_id=?', [Number(match[1]), match[2], restaurantId]);
  return result.affectedRows > 0;
}
