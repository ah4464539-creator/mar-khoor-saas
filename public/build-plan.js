// "Choose your plan" page. Shows the same Starter / Premium / Enterprise catalog the dashboard uses,
// in the currency of the chosen country, and hands the choice to registration.
const form = document.querySelector('#plan');
const country = document.querySelector('#country');
const grid = document.querySelector('#plans');
const status = document.querySelector('#status');
const summary = document.querySelector('#summary-text');
const next = document.querySelector('#continue');
const notes = document.querySelector('#notes');
const yearlySave = document.querySelector('#yearly-save');

const PLAN_KEYS = ['starter', 'premium', 'enterprise'];
const ALIASES = { professional: 'premium', pro: 'premium' };
const BLURBS = {
  starter: 'For a single restaurant getting started with online orders and AI.',
  premium: 'For busy restaurants that want a dedicated AI phone line.',
  enterprise: 'For high-volume restaurants and groups with several branches.',
};
const METRICS = { ai_chats: 'AI chats', whatsapp_messages: 'WhatsApp messages', ai_call_minutes: 'AI call minutes' };
const FEATURES = ['Restaurant website & online ordering', 'Website AI Assistant (chat & voice)', 'WhatsApp Business replies', 'AI Caller for phone orders'];
const STORE_KEY = 'mar-khoor.chosen-plan';

const params = new URLSearchParams(location.search);
const wanted = (params.get('plan') || '').toLowerCase();
let selected = PLAN_KEYS.includes(wanted) ? wanted : ALIASES[wanted] || 'premium';
if (params.get('cycle') === 'yearly') form.elements.cycle.value = 'yearly';
let plans = [];
let exchange = null;
let request;

// Country list (same approach as registration).
const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const regions = [];
for (const first of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') for (const last of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  const code = first + last;
  const name = names.of(code);
  if (name && !['EU', 'EZ', 'QO', 'UN', 'ZZ', 'XA', 'XB'].includes(code)) regions.push({ code, name });
}
regions.sort((a, b) => a.name.localeCompare(b.name));
for (const { code, name } of regions) country.add(new Option(name, code));
const guess = (params.get('country') || (navigator.language || '').split('-')[1] || '').toUpperCase();
if (regions.some(region => region.code === guess)) country.value = guess;

function money(amount, currency) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: amount % 100 ? 2 : 0 }).format(amount / 100);
}
const cycle = () => form.elements.cycle.value;
const el = (tag, text, className) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text }, className ? { className } : {});

function render() {
  const current = cycle();
  grid.replaceChildren(...plans.map(plan => {
    const card = el('label', null, 'plan' + (plan.key === selected ? ' selected' : ''));
    const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'plan', value: plan.key, checked: plan.key === selected });
    input.setAttribute('aria-label', plan.name);
    card.append(input);
    if (plan.key === 'premium') card.append(el('span', 'Most popular', 'tag'));
    card.append(el('h2', plan.name), el('p', BLURBS[plan.key] || '', 'blurb'));
    const amount = plan.price_minor?.[current];
    const price = el('div', null, 'price');
    if (amount == null) price.append(el('strong', 'Price on request'));
    else price.append(el('strong', money(amount, plan.currency)), el('span', current === 'yearly' ? '/ year' : '/ month'));
    card.append(price);
    const usd = plan.currency !== plan.base_currency && plan.base_price_minor?.[current] != null
      ? '≈ ' + money(plan.base_price_minor[current], plan.base_currency) + (current === 'yearly' ? ' / year' : ' / month') : '';
    card.append(el('p', usd, 'usd'));
    const list = el('ul');
    for (const [metric, label] of Object.entries(METRICS)) {
      if (plan.limits?.[metric] != null) list.append(el('li', plan.limits[metric].toLocaleString() + ' ' + label + ' / month'));
    }
    const number = plan.dedicated_number;
    if (number?.included) list.append(el('li', 'Dedicated AI phone number included'));
    else if (number?.addon_price_minor != null) list.append(el('li', 'Dedicated AI phone number: +' + money(number.addon_price_minor, plan.currency) + ' / month', 'muted-line'));
    else if (number) list.append(el('li', 'Dedicated AI phone number: optional add-on', 'muted-line'));
    for (const feature of FEATURES) list.append(el('li', feature));
    card.append(list, el('span', plan.key === selected ? 'Selected' : 'Choose ' + plan.name, 'pick'));
    return card;
  }));
  updateSummary();
}

function updateSummary() {
  const plan = plans.find(entry => entry.key === selected);
  const current = cycle();
  // Yearly saving label, based on Starter (all plans use the same ratio).
  const ref = plans[0];
  if (ref?.price_minor?.monthly && ref?.price_minor?.yearly) {
    const months = Math.round(12 - ref.price_minor.yearly / ref.price_minor.monthly);
    yearlySave.textContent = months > 0 ? months + ' months free' : '';
  }
  if (!plan) {
    summary.textContent = 'Choose a plan to continue.';
    next.setAttribute('aria-disabled', 'true');
    return;
  }
  const amount = plan.price_minor?.[current];
  summary.replaceChildren(el('strong', plan.name + ' · ' + (current === 'yearly' ? 'yearly' : 'monthly')), ' — ',
    amount == null ? 'price confirmed during setup.' : money(amount, plan.currency) + (current === 'yearly' ? ' per year' : ' per month') + ', before taxes.');
  const target = new URLSearchParams({ plan: plan.key, cycle: current });
  if (country.value) target.set('country', country.value);
  let signedIn = false;
  try { signedIn = Boolean(localStorage.getItem('mar-khoor.owner-session') || sessionStorage.getItem('mar-khoor.owner-session')); } catch {}
  next.href = (signedIn ? '/restaurant.html?' : '/register.html?') + target;
  next.textContent = 'Continue with ' + plan.name;
  next.removeAttribute('aria-disabled');

  const converted = plans.some(entry => entry.converted);
  notes.replaceChildren('Prices are before taxes. No payment is taken on this page: you confirm the plan in your restaurant dashboard after registering.');
  if (converted) {
    notes.append(' Prices converted from USD with daily exchange rates');
    if (exchange?.attribution) notes.append(' by ', Object.assign(el('a', exchange.attribution.name), { href: exchange.attribution.url, target: '_blank', rel: 'noopener noreferrer' }));
    notes.append('; the price is locked when you choose a plan.');
  }
}

async function load() {
  request?.abort();
  request = new AbortController();
  const { signal } = request;
  status.textContent = plans.length ? '' : 'Loading plans…';
  try {
    const query = country.value ? '?country=' + encodeURIComponent(country.value) : '';
    const response = await fetch('/api/public/plans' + query, { signal });
    if (!response.ok) throw Error('unavailable');
    const data = await response.json();
    if (signal.aborted) return;
    plans = PLAN_KEYS.map(key => data.plans.find(plan => plan.key === key)).filter(Boolean);
    exchange = data.exchange;
    status.textContent = '';
    render();
  } catch {
    if (!signal.aborted) status.textContent = 'Plans could not be loaded. Please refresh the page or try again shortly.';
  }
}

grid.addEventListener('change', event => {
  if (event.target.name !== 'plan') return;
  selected = event.target.value;
  render();
  grid.querySelector('input[value="' + selected + '"]')?.focus();
});
form.addEventListener('change', event => { if (event.target === country) load(); else render(); });
form.addEventListener('submit', event => event.preventDefault());
next.addEventListener('click', () => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ plan: selected, cycle: cycle(), at: Date.now() })); } catch {}
});
load();
