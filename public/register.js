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

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  status.textContent = 'Creating your restaurant…';
  try {
    const response = await fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        restaurant_name: document.querySelector('#restaurant-name').value,
        country: country.value,
        email: document.querySelector('#email').value,
        password: document.querySelector('#password').value
      })
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Registration failed');
    form.hidden = true;
    status.textContent = '';
    document.querySelector('#done-text').textContent = 'Sign in with the email and password you just chose. Your restaurant name for customers is "' + data.slug + '": they can enter it on the menu page at mar-khoor.com/menu.html once you add menu items.';
    done.hidden = false;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
