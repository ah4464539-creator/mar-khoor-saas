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
    assert.deepEqual(await response.json(), { accepted: true, acknowledgement_sent: true });
    assert.equal(delivered.length, 2);
    assert.equal(delivered[0].to, 'admin@mar-khoor.com');
    assert.match(delivered[0].text, /visitor@example\.org/);
    assert.match(delivered[0].html, /&lt;script&gt;/);
    assert.doesNotMatch(delivered[0].html, /<script>/);
    assert.equal(delivered[1].to, 'visitor@example.org');
    assert.match(delivered[1].subject, /We Received Your Message/);
    assert.match(delivered[1].text, /within 24 hours/);
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


test('Acknowledgement sends once per email each 24 hours and does not loop to support inbox', async () => {
  const sent = [];
  let time = Date.parse('2026-11-22T12:00:00Z');
  await withServer(publicContactRouter({ sendMail: async item => sent.push(item), now: () => time }), async base => {
    const first = await (await post(base, data)).json();
    const second = await (await post(base, data)).json();
    assert.deepEqual(first, { accepted: true, acknowledgement_sent: true });
    assert.deepEqual(second, { accepted: true, acknowledgement_sent: false });
    assert.equal(sent.filter(x => x.to === 'admin@mar-khoor.com').length, 2);
    assert.equal(sent.filter(x => x.to === data.email).length, 1);
    time += 24 * 60 * 60 * 1000 + 1;
    const third = await (await post(base, data)).json();
    assert.equal(third.acknowledgement_sent, true);
    assert.equal(sent.filter(x => x.to === data.email).length, 2);
    const self = await (await post(base, { ...data, email: 'admin@mar-khoor.com' })).json();
    assert.equal(self.acknowledgement_sent, false);
    assert.equal(sent.filter(x => x.to === 'admin@mar-khoor.com').length, 4);
  });
});

test('Support message stays accepted when visitor auto-reply delivery fails', async () => {
  const delivered = [];
  await withServer(publicContactRouter({ sendMail: async item => {
    delivered.push(item);
    if (item.to !== 'admin@mar-khoor.com') throw Error('ack channel down');
  } }), async base => {
    const response = await post(base, data);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, acknowledgement_sent: false });
    assert.equal(delivered[0].to, 'admin@mar-khoor.com');
    assert.equal(delivered[1].to, data.email);
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
