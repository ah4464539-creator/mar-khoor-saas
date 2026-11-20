// Browser-side image preparation for uploads: fixes phone photo rotation, strips camera
// metadata (location), scales large photos down and re-encodes them small before upload.
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export const IMAGE_ACCEPT = ACCEPTED.join(',');

function canvasBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

export async function prepareImage(file, { maxSide = 1600, quality = 0.85, square = false } = {}) {
  if (!file || !ACCEPTED.includes(file.type)) throw Error('Choose a JPG, PNG or WebP photo.');
  if (file.size > 20 * 1024 * 1024) throw Error('That photo is too large. Choose one under 20 MB.');
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw Error('This photo could not be read. Try another one.'); }
  let { width, height } = bitmap, sx = 0, sy = 0, sw = width, sh = height;
  if (square) { const side = Math.min(width, height); sx = (width - side) / 2; sy = (height - side) / 2; sw = sh = side; width = height = side; }
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (file.type === 'image/png') context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  let blob = await canvasBlob(canvas, 'image/webp', quality);
  if (!blob || blob.type !== 'image/webp') blob = await canvasBlob(canvas, file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality);
  if (!blob) throw Error('This photo could not be prepared. Try another one.');
  if (blob.size > 5 * 1024 * 1024) throw Error('The photo is still larger than 5 MB after compression.');
  return blob;
}

export async function uploadImage({ restaurantId, token, kind, file, options }) {
  const blob = await prepareImage(file, options);
  let response;
  try {
    response = await fetch('/api/restaurants/' + encodeURIComponent(restaurantId) + '/media?kind=' + encodeURIComponent(kind), {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': blob.type }, body: blob,
    });
  } catch { throw Error('Upload failed. Check your internet connection and try again.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || 'Upload failed');
  return data;
}
