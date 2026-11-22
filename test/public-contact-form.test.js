import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { publicContactRouter } from '../src/public-contact.js';
import { publicAssistantRouter } from '../src/public-assistant.js';

const page = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');

async function withServer(router, fn) {
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  const server = app.listen(0);
  try {
    await new Promise(resolve => server.once('listening', resolve));
    await fn('http://127.0.0.1:' + server.address().port + '/api');
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
const data = {
  name: 'Example Visitor',
  email: 'visitor@example.org',
  topic: 'website',
  message: 'Can someone please help with our website setup?',
  consent: true,
  website: '',
};
const post = (base, input) => fetch(base + '/public/contact', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(input),
});

test('Contact page provides official contact form with safe public email fallback', () => {
  const html = page('contact.html');
  const script = page('contact-form.js');
  assert.match(html, /id="mk-contact-form"/);
  assert.match(html, /name="consent"/);
  assert.match(html, /name="website"/);
  assert.match(html, /admin@mar-khoor\.com/);
  assert.match(html, /\/contact-form\.js/);
  assert.match(script, /\/api\/public\/contact/);
  assert.match(page('index.html'), /href="\/contact\.html"/);
});

test('Contact form sends only to official Mar-Khoor email via configured mailer', async () => {
  const delivered = [];
  await withServer(publicContactRouter({ sendMail: async message => delivered.push(message) }), async base => {
    assert.deepEqual(await (await fetch(base + '/public/contact/status')).json(), { available: true });
    assert.equal((await post(base, { ...data, topic: 'unexpected' })).status, 400);
    assert.equal((await post(base, { ...data, email: 'unsafe@\r\nBcc:evil@example.net' })).status, 400);
    assert.equal((await post(base, { ...data, message: 'short' })).status, 400);
    assert.equal(delivered.length, 0);
    const response = await post(base, { ...data, name: '<Visitor & Partner>', message: 'Please help! <script>alert(1)</script>' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true });
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].to, 'admin@mar-khoor.com');
    assert.match(delivered[0].text, /visitor@example\.org/);
    assert.match(delivered[0].html, /&lt;script&gt;/);
    assert.doesNotMatch(delivered[0].html, /<script>/);
  });
});

test('Contact form avoids sending bot requests and returns honest errors when mail unavailable', async () => {
  const delivered = [];
  await withServer(publicContactRouter({ sendMail: async message => delivered.push(message) }), async base => {
    assert.equal((await post(base, { ...data, website: 'https://spam.test' })).status, 200);
    assert.equal(delivered.length, 0);
  });
  await withServer(publicContactRouter({ sendMail: null }), async base => {
    assert.deepEqual(await (await fetch(base + '/public/contact/status')).json(), { available: false });
    const result = await post(base, data);
    assert.equal(result.status, 503);
    assert.match((await result.json()).error, /admin@mar-khoor\.com/);
  });
  await withServer(publicContactRouter({ sendMail: async () => { throw Error('test provider unavailable'); } }), async base => {
    assert.equal((await post(base, data)).status, 502);
  });
});

test('Public AI support is enabled by configured server key with an emergency pause switch', async () => {
  const keys = ['OPENAI_API_KEY', 'WEBSITE_AI_ASSISTANT_ENABLED', 'WEBSITE_AI_ASSISTANT_PAUSED'];
  const originals = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    process.env.OPENAI_API_KEY = 'local-mocked-test-key';
    process.env.WEBSITE_AI_ASSISTANT_ENABLED = 'false'; // old switch does not block the new opt-in rollout
    delete process.env.WEBSITE_AI_ASSISTANT_PAUSED;
    let calls = 0;
    const fakeProvider = async () => {
      calls++;
      return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: 'Salam! Main madad kar sakta hoon.' }] }] }) };
    };
    await withServer(publicAssistantRouter({ fetcher: fakeProvider }), async base => {
      assert.deepEqual(await (await fetch(base + '/public/assistant/status')).json(), { enabled: true });
      const response = await fetch(base + '/public/assistant/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Salam, registration kesay krni hai?' }),
      });
      assert.equal(response.status, 200);
      assert.match((await response.json()).reply, /Salam/);
      assert.equal(calls, 1);
      process.env.WEBSITE_AI_ASSISTANT_PAUSED = 'true';
      assert.deepEqual(await (await fetch(base + '/public/assistant/status')).json(), { enabled: false });
      assert.equal((await fetch(base + '/public/assistant/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Hello' }),
      })).status, 503);
    });
  } finally {
    for (const key of keys) if (originals[key] === undefined) delete process.env[key]; else process.env[key] = originals[key];
  }
});
