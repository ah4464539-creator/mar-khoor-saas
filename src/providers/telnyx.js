// Telnyx REST v2 client (search and order numbers). Built from Telnyx's published API reference;
// NOT yet exercised against the live Telnyx API. Spends real money when ordering.
export const E164 = /^\+[1-9][0-9]{6,14}$/;
const BASE = 'https://api.telnyx.com/v2';

async function call(fetcher, apiKey, path, options = {}) {
  const response = await fetcher(BASE + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  let data = null;
  try { data = await response.json(); } catch { /* non-JSON error body */ }
  if (!response.ok) {
    const detail = String(data?.errors?.[0]?.detail ?? data?.errors?.[0]?.title ?? 'Telnyx request failed').slice(0, 200);
    throw Object.assign(Error(detail), { providerStatus: response.status });
  }
  return data;
}

export async function searchNumbers({ apiKey, country, type = 'local', limit = 5, fetcher = fetch }) {
  if (!/^[A-Z]{2}$/.test(country)) throw Error('Invalid country');
  const query = new URLSearchParams({ 'filter[country_code]': country, 'filter[phone_number_type]': type, 'filter[limit]': String(Math.min(Math.max(limit, 1), 10)) });
  const data = await call(fetcher, apiKey, '/available_phone_numbers?' + query);
  return (data?.data ?? [])
    .filter(item => typeof item?.phone_number === 'string' && E164.test(item.phone_number))
    .filter(item => !Array.isArray(item.features) || item.features.some(f => f?.name === 'voice'))
    .map(item => ({
      phone_number: item.phone_number,
      monthly_cost: item.cost_information?.monthly_cost ?? null,
      upfront_cost: item.cost_information?.upfront_cost ?? null,
      currency: item.cost_information?.currency ?? null,
    }));
}

// Only numbers returned by a recent search can be ordered. Some countries need a requirement group.
export async function orderNumber({ apiKey, phoneNumber, requirementGroupId, fetcher = fetch }) {
  if (!E164.test(phoneNumber)) throw Error('Invalid phone number');
  const body = { phone_numbers: [{ phone_number: phoneNumber }] };
  if (requirementGroupId) body.requirement_group_id = requirementGroupId;
  const data = await call(fetcher, apiKey, '/number_orders', { method: 'POST', body: JSON.stringify(body) });
  const id = data?.data?.id;
  if (typeof id !== 'string' || !id) throw Error('Telnyx returned no order id');
  return { orderId: id.slice(0, 64), status: String(data.data.status ?? 'pending').slice(0, 32) };
}

export async function getOrderStatus({ apiKey, orderId, fetcher = fetch }) {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(orderId)) throw Error('Invalid order id');
  const data = await call(fetcher, apiKey, '/number_orders/' + orderId);
  return String(data?.data?.status ?? 'pending').slice(0, 32);
}
