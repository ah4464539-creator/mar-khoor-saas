const assistant = document.querySelector('#assistant');
const launcher = assistant.querySelector('summary');
const form = assistant.querySelector('form');
const input = form.elements.message;
const submit = form.querySelector('button[type="submit"]');
const messages = assistant.querySelector('[data-assistant-messages]');

assistant.querySelector('[data-close-assistant]').addEventListener('click', closePanel);
assistant.addEventListener('keydown', event => {
  if (event.key === 'Escape' && assistant.open) closePanel();
});
if (location.hash === '#assistant') assistant.open = true;

function closePanel() {
  assistant.open = false;
  launcher.focus();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || submit.disabled) return;
  submit.disabled = true;
  input.value = '';
  const question = document.createElement('p');
  question.textContent = message;
  const reply = document.createElement('p');
  reply.textContent = 'Thinking…';
  messages.append(question, reply);
  messages.scrollTop = messages.scrollHeight;
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      body: new URLSearchParams({ message }),
    });
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    reply.textContent = page.querySelector('[aria-label="Assistant response"]')?.textContent ||
      'The assistant is temporarily unavailable.';
  } catch {
    reply.textContent = 'Could not connect. Please try again.';
  } finally {
    submit.disabled = false;
    messages.scrollTop = messages.scrollHeight;
  }
});
