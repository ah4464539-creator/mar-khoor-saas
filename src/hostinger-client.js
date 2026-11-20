// Minimal Hostinger public API client (https://developers.hostinger.com) used to connect
// restaurant domains to the Mar-Khoor website automatically. The token stays on the server.

export class HostingerError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

export function hostingerConfig(env = process.env) {
  const token = env.HOSTINGER_API_TOKEN;
  if (!token) return null;
  return {
    token,
    username: env.HOSTINGER_USERNAME || '',
    website: (env.HOSTINGER_WEBSITE_DOMAIN || 'mar-khoor.com').toLowerCase(),
    serverIp: env.HOSTINGER_SERVER_IP || '',
  };
}

export function createHostingerClient(config, { fetcher = fetch, base = 'https://developers.hostinger.com' } = {}) {
  if (!config?.token) return null;
  async function request(method, path, body) {
    let response;
    try {
      response = await fetcher(base + path, {
        method, signal: AbortSignal.timeout(20000),
        headers: { Authorization: 'Bearer ' + config.token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new HostingerError(503, 'Hostinger did not respond'); }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      const message = data?.message || data?.error || (response.status === 401 ? 'Hostinger API token was rejected' : 'Hostinger answered ' + response.status);
      throw new HostingerError(response.status, String(message).slice(0, 240), data);
    }
    return data;
  }
  const enc = encodeURIComponent;
  const site = () => '/api/hosting/v1/accounts/' + enc(config.username) + '/websites/' + enc(config.website);
  return {
    config,
    request,
    verifyOwnership: domain => request('POST', '/api/hosting/v1/domains/verify-ownership', { domain }),
    async portfolioDomain(domain) {
      try { return await request('GET', '/api/domains/v1/portfolio/' + enc(domain)); }
      catch (error) { if ([404, 422].includes(error.status)) return null; throw error; }
    },
    listParked: () => request('GET', site() + '/parked-domains'),
    park: domain => request('POST', site() + '/parked-domains', { parked_domain: domain }),
    async zone(domain) {
      try { return await request('GET', '/api/dns/v1/zones/' + enc(domain)); }
      catch (error) { if ([404, 422].includes(error.status)) return null; throw error; }
    },
    // Never overwrite: existing email/verification records must survive.
    addRecords: (domain, zone) => request('PUT', '/api/dns/v1/zones/' + enc(domain), { overwrite: false, zone }),
    sslInstall: domain => request('POST', '/api/hosting/v1/accounts/' + enc(config.username) + '/websites/' + enc(domain) + '/ssl/setup'),
    sslStatus: domain => request('GET', '/api/hosting/v1/accounts/' + enc(config.username) + '/websites/' + enc(domain) + '/ssl/status'),
    availability: (name, tlds) => request('POST', '/api/domains/v1/availability', { domain: name, tlds }),
    catalog: name => request('GET', '/api/billing/v1/catalog?category=DOMAIN&name=' + enc(name)),
    purchase: (domain, itemId) => request('POST', '/api/domains/v1/portfolio', { domain, item_id: itemId }),
  };
}

// Picks the 1-year registration price from a catalog answer, whatever its exact shape.
export function yearlyDomainPrice(items, tld) {
  const list = Array.isArray(items) ? items : Array.isArray(items?.data) ? items.data : [];
  const wanted = '.' + String(tld).toLowerCase();
  for (const item of list) {
    const name = String(item?.name || item?.id || '').toLowerCase();
    if (!name.startsWith(wanted) && !name.includes(wanted + ' ') && name !== wanted && !name.endsWith(wanted)) continue;
    for (const price of item.prices ?? []) {
      if (Number(price.period) === 1 && /year/i.test(String(price.period_unit))) {
        return { item_id: String(price.id), price_cents: Number(price.price ?? price.first_period_price ?? 0), currency: price.currency || 'USD', renewal_cents: Number(price.renewal_price ?? price.price ?? 0) };
      }
    }
  }
  return null;
}
