const assistant = document.querySelector('#assistant');
const launcher = assistant.querySelector('summary');
const form = assistant.querySelector('form');
const input = form.elements.message;
const submit = form.querySelector('button[type="submit"]');
const messages = assistant.querySelector('[data-assistant-messages]');
const history = []; // Local to this browser tab; no cross-restaurant storage.
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

assistant.querySelector('[data-close-assistant]').addEventListener('click', closePanel);
assistant.addEventListener('keydown', event => {
  if (event.key === 'Escape' && assistant.open) closePanel();
});
launcher.addEventListener('click', event => {
  event.preventDefault();
  if (assistant.open) closePanel();
  else openPanel();
});
if (location.hash === '#assistant') openPanel();

function openPanel() {
  assistant.open = true;
  input.focus({ preventScroll: true });
}

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
  question.className = 'assistant-question';
  question.textContent = message;
  const reply = document.createElement('p');
  reply.className = 'assistant-reply';
  reply.textContent = 'Thinking…';
  messages.append(question, reply);
  messages.scrollTop = messages.scrollHeight;
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ message, history }),
      signal: AbortSignal.timeout(26000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error('Assistant unavailable');
    reply.textContent = typeof data.reply === 'string' ? data.reply : 'The assistant is temporarily unavailable.';
    if (data.source === 'ai') {
      history.push({ role: 'user', content: message.slice(0, 1200) },
        { role: 'assistant', content: reply.textContent.slice(0, 1200) });
      while (history.length > 6 || history.reduce((size, entry) => size + entry.content.length, 0) > 4000)
        history.splice(0, 2);
    }
  } catch {
    reply.textContent = 'Could not connect. Please try again.';
  } finally {
    submit.disabled = false;
    if (assistant.open && document.activeElement === submit) input.focus({ preventScroll: true });
    messages.scrollTop = messages.scrollHeight;
  }
});
