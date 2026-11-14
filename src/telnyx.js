const e164 = /^\+[1-9]\d{6,14}$/;
export const isPhoneNumber = value => typeof value === 'string' && e164.test(value);

export function telnyxNumbers(apiKey, fetcher = fetch) {
  async function request(path, body) {
    const response = await fetcher('https://api.telnyx.com/v2/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error('Telnyx request failed');
    return (await response.json()).data;
  }

  return {
    async search(country, phoneNumber) {
      const query = new URLSearchParams({
        'filter[country_code]': country,
        'filter[phone_number_type]': 'local',
        'filter[features]': 'voice',
        'filter[limit]': '10',
        'filter[best_effort]': 'false',
      });
      if (phoneNumber) query.set('filter[phone_number]', phoneNumber);
      const numbers = await request('available_phone_numbers?' + query);
      return numbers.filter(item => isPhoneNumber(item.phone_number) && !item.best_effort).map(item => ({
        phone_number: item.phone_number,
        cost_information: item.cost_information ?? null,
      }));
    },
    order(phoneNumber, reference) {
      return request('number_orders', { phone_numbers: [{ phone_number: phoneNumber }], customer_reference: reference });
    },
    status(id) {
      return request('number_orders/' + encodeURIComponent(id));
    },
  };
}
