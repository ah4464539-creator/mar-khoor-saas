// Fetch a public web page for the owner (e.g. their old menu page) without letting the server be
// used to reach internal addresses (SSRF). HTTPS/HTTP on standard ports only, public IPs only,
// every redirect re-checked, size and time limited.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class SafeFetchError extends Error {}

export function isPrivateAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower);
  }
  return true;
}

export async function assertPublicUrl(raw, { resolve = lookup } = {}) {
  let url;
  try { url = new URL(raw); } catch { throw new SafeFetchError('Enter a full web address, for example https://myrestaurant.com/menu'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new SafeFetchError('Only http and https links are allowed');
  if (url.username || url.password) throw new SafeFetchError('Links with a username or password are not allowed');
  if (url.port && !['80', '443'].includes(url.port)) throw new SafeFetchError('Only standard web ports are allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new SafeFetchError('That address is not public');
  const addresses = isIP(host) ? [{ address: host }] : await resolve(host, { all: true }).catch(() => { throw new SafeFetchError('That website could not be found'); });
  if (!addresses.length || addresses.some(entry => isPrivateAddress(entry.address))) throw new SafeFetchError('That address is not public');
  return url;
}

export async function safeFetchText(raw, { fetcher = fetch, resolve = lookup, maxBytes = 2 * 1024 * 1024, timeoutMs = 10000, maxRedirects = 3 } = {}) {
  let url = await assertPublicUrl(raw, { resolve });
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetcher(url.href, { redirect: 'manual', signal, headers: { 'User-Agent': 'MarKhoorMenuImport/1.0 (+https://mar-khoor.com)', Accept: 'text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.1' } })
      .catch(() => { throw new SafeFetchError('That website did not respond'); });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get('location');
      if (!next) throw new SafeFetchError('That website redirected without an address');
      url = await assertPublicUrl(new URL(next, url).href, { resolve });
      continue;
    }
    if (!response.ok) throw new SafeFetchError('That website answered with an error (' + response.status + ')');
    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) throw new SafeFetchError('That link is not a web page. Upload a PDF or photo instead.');
    const declared = Number(response.headers.get('content-length'));
    if (declared > maxBytes) throw new SafeFetchError('That page is too large');
    const reader = response.body?.getReader?.();
    if (!reader) { const text = await response.text(); if (text.length > maxBytes) throw new SafeFetchError('That page is too large'); return { url: url.href, text }; }
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { reader.cancel().catch(() => {}); throw new SafeFetchError('That page is too large'); }
      chunks.push(value);
    }
    return { url: url.href, text: Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8') };
  }
  throw new SafeFetchError('Too many redirects');
}

// Readable text from HTML: drops scripts, styles and tags, keeps line structure.
export function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
