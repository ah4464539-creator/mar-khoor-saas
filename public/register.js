const form = document.querySelector('#register');
const status = document.querySelector('#status');
const country = document.querySelector('#country');
const done = document.querySelector('#done');
const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const regions = [];
for (const first of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  for (const last of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const code = first + last;
    const name = names.of(code);
    if (name && !['EU', 'EZ', 'QO', 'UN', 'ZZ', 'XA', 'XB'].includes(code)) regions.push({ code, name });
  }
}
regions.sort((a, b) => a.name.localeCompare(b.name));
for (const { code, name } of regions) country.add(new Option(name, code));

// Plan chosen on the landing page or /build-plan.html. It is remembered and preselected in the
// dashboard setup right after registration (we sign the new owner in automatically).
const chosen = new URLSearchParams(location.search);
const PLAN_STORE = 'mar-khoor.chosen-plan';
const planSelect = document.querySelector('#chosen-plan-select');
const cycleSelect = document.querySelector('#chosen-cycle-select');
const signinLink = document.querySelector('#signin-link');
const compareLink = document.querySelector('#compare-plans');
if (['starter', 'premium', 'enterprise'].includes(chosen.get('plan'))) planSelect.value = chosen.get('plan');
if (chosen.get('cycle') === 'yearly') cycleSelect.value = 'yearly';
// A single tool picked on the landing page: after registration the dashboard opens the cart with it.
if (['website', 'whatsapp', 'calling'].includes(chosen.get('tool'))) {
  try { localStorage.setItem('mar-khoor.want-tool', chosen.get('tool')); } catch {}
  if (signinLink) signinLink.href = '/restaurant.html?tool=' + chosen.get('tool');
}
function rememberPlan() {
  const plan = planSelect.value;
  cycleSelect.hidden = !plan;
  try {
    if (plan) localStorage.setItem(PLAN_STORE, JSON.stringify({ plan, cycle: cycleSelect.value, at: Date.now() }));
    else localStorage.removeItem(PLAN_STORE);
  } catch {}
  const query = plan ? '?' + new URLSearchParams({ plan, cycle: cycleSelect.value }) : '';
  if (signinLink) signinLink.href = '/restaurant.html' + query;
  if (compareLink) compareLink.href = '/build-plan.html' + query;
  const doneLink = document.querySelector('#done a.button');
  if (doneLink) doneLink.href = '/restaurant.html' + query;
}
planSelect.addEventListener('change', rememberPlan);
cycleSelect.addEventListener('change', rememberPlan);
rememberPlan();
if (/^[A-Z]{2}$/.test(chosen.get('country') || '') && [...country.options].some(option => option.value === chosen.get('country'))) country.value = chosen.get('country');

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (stage < steps.length - 1) { next.click(); return; }
  const password = document.querySelector('#password').value;
  const confirm = document.querySelector('#confirm-password').value;
  if (password !== confirm) { status.textContent = 'Passwords do not match'; return; }
  const button = document.querySelector('#create-restaurant');
  button.disabled = true;
  status.textContent = 'Creating your account…';
  try {
    const response = await fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        restaurant_name: document.querySelector('#restaurant-name').value,
        business_type: document.querySelector('input[name="business_type"]:checked')?.value,
        country: country.value,
        email: document.querySelector('#email').value,
        password: document.querySelector('#password').value
      })
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Registration failed');
    form.hidden = true;
    status.textContent = '';
    document.querySelector('#done-text').textContent = 'Your web address is "' + data.slug + '". Opening your workspace to finish setup' + (planSelect.value ? ' with the ' + planSelect.options[planSelect.selectedIndex].text + ' plan' : '') + '…';
    document.querySelector('#registration-voice').textContent = data.voice?.status === 'active'
      ? 'Your AI call number: ' + data.voice.number
      : 'AI call number: pending.';
    done.hidden = false;
    // Sign the new owner in and continue straight to plan and channel setup.
    try {
      const login = await fetch('/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: document.querySelector('#email').value, password })
      });
      const session = await login.json();
      if (login.ok && session.token) {
        try { localStorage.setItem('mar-khoor.owner-session', session.token); } catch {}
        location.assign('/restaurant.html' + (planSelect.value ? '?' + new URLSearchParams({ plan: planSelect.value, cycle: cycleSelect.value }) : ''));
        return;
      }
    } catch {}
    document.querySelector('#done-text').textContent = 'Sign in with the email and password you just chose to finish setup. Your restaurant name for customers is "' + data.slug + '".';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

const steps = [...form.querySelectorAll('fieldset')];
const indicators = [...document.querySelectorAll('.register-steps li')];
const previous = document.querySelector('#previous-step');
const next = document.querySelector('#next-step');
const create = document.querySelector('#create-restaurant');
let stage = 0;

function changeStage(index) {
  stage = index;
  steps.forEach((step, i) => { step.hidden = step.disabled = i !== stage; });
  indicators.forEach((indicator, i) => {
    if (i === stage) indicator.setAttribute('aria-current', 'step');
    else indicator.removeAttribute('aria-current');
  });
  previous.hidden = stage === 0;
  next.hidden = stage === steps.length - 1;
  create.hidden = !next.hidden;
  status.textContent = '';
  steps[stage].querySelector('input, select').focus();
}

next.addEventListener('click', () => {
  if (stage === 0 && !document.querySelector('input[name="business_type"]:checked')) {
    const hint = document.querySelector('#biz-type-hint');
    if (hint) { hint.textContent = 'Please choose your type of business first.'; hint.classList.add('hint-error'); }
    document.querySelector('.biz-types')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (form.reportValidity()) changeStage(stage + 1);
});
previous.addEventListener('click', () => changeStage(stage - 1));

// Business type: pre-select from ?type= and adapt the name example.
(() => {
  const NAMES = { restaurant: 'e.g. Cheema Cafe', clinic: 'e.g. City Care Clinic', hotel: 'e.g. Hunza View Guest House', salon: 'e.g. Glow Salon' };
  const want = new URLSearchParams(location.search).get('type');
  const radio = want && document.querySelector('input[name="business_type"][value="' + want.replace(/[^a-z]/g, '') + '"]');
  if (radio) radio.checked = true;
  const sync = () => {
    const v = document.querySelector('input[name="business_type"]:checked')?.value || 'restaurant';
    const input = document.querySelector('#restaurant-name'); if (input) input.placeholder = NAMES[v] || NAMES.restaurant;
    const label = { restaurant: 'restaurant', clinic: 'clinic', hotel: 'hotel', salon: 'salon' }[v] || 'business';
    const create = document.querySelector('#create-restaurant'); if (create) create.textContent = 'Create ' + label;
    const title = document.querySelector('.auth-copy h1'); if (title) title.textContent = v === 'restaurant' ? 'Your AI ordering desk, ready in minutes.' : 'Your AI booking desk, ready in minutes.';
    const hint = document.querySelector('#biz-type-hint');
    if (hint && document.querySelector('input[name="business_type"]:checked')) { hint.classList.remove('hint-error'); hint.textContent = 'WhatsApp, AI calls and your dashboard will be set up for this type.'; }
  };
  document.querySelectorAll('input[name="business_type"]').forEach(r => r.addEventListener('change', sync)); sync();
})();
