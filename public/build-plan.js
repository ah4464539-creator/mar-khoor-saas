const form = document.querySelector('#plan');
const country = document.querySelector('#country');
const phone = document.querySelector('#phone');
const voice = document.querySelector('#voice');
const items = document.querySelector('#items');
const usage = document.querySelector('#usage');
const total = document.querySelector('#total');
const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const regions = [];
for (const first of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  for (const last of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const code = first + last;
    const name = names.of(code);
    if (name && !['EU', 'EZ', 'QO', 'UN', 'ZZ', 'XA', 'XB'].includes(code)) {
      regions.push({ code, name });
    }
  }
}
regions.sort((a, b) => a.name.localeCompare(b.name));
for (const { code, name } of regions) country.add(new Option(name, code));

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const dollars = cents => money.format(cents / 100);
let request;

form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('change', async () => {
  request?.abort();
  phone.hidden = phone.disabled = !voice.checked;
  const data = new FormData(form);
  const features = data.getAll('service');
  items.replaceChildren();
  usage.textContent = '';
  if (!country.value || !features.length) {
    total.textContent = 'Select your country and services to see your estimate.';
    return;
  }

  request = new AbortController();
  const { signal } = request;
  total.textContent = 'Updating estimate…';
  try {
    const response = await fetch('/api/public/plan-quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: country.value, features, numberMode: data.get('number') || 'existing' }),
      signal
    });
    if (!response.ok) throw new Error('Quote request failed');
    const quote = await response.json();
    if (signal.aborted) return;
    for (const item of quote.items) {
      const row = document.createElement('li');
      const price = item.monthly === null ? '' : dollars(item.monthly) + ' / month';
      const setup = item.setup ? dollars(item.setup) + ' one-time' : '';
      row.textContent = [item.label, price, setup, item.status === 'quoted' ? '' : item.status]
        .filter(Boolean).join(' · ');
      items.append(row);
    }
    const notes = [];
    if (features.includes('voice')) {
      notes.push(quote.usage.voiceMinutes === null ? 'Included minutes pending.'
        : quote.usage.voiceMinutes + ' minutes included.');
      notes.push(quote.usage.voiceExtra === null ? 'Extra minute rate pending.'
        : dollars(quote.usage.voiceExtra) + ' per extra minute.');
    }
    if (features.includes('whatsapp')) notes.push('Billable WhatsApp messaging is separate.');
    usage.textContent = notes.join(' ');
    total.textContent = (quote.complete ? 'Estimated first month: ' : 'Confirmed-price subtotal for the first month: ')
      + dollars(quote.firstMonth) + ' · Monthly: ' + dollars(quote.monthly)
      + ' · Before taxes and usage. Payments are currently unavailable.';
  } catch (error) {
    if (!signal.aborted) total.textContent = 'The estimate is unavailable. Change your selection to try again.';
  }
});
