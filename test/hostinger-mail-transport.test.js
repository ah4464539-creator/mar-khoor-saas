import test from 'node:test';
import assert from 'node:assert/strict';
import { mailerFromEnv, sendViaHostingerApi } from '../src/mailer.js';

const env = {
  MAIL_FROM: 'Mar-Khoor <admin@mar-khoor.com>',
  SMTP_HOST: 'smtp.hostinger.com',
  SMTP_USER: 'admin@mar-khoor.com',
  SMTP_PASSWORD: 'old-invalid-test-password',
  HOSTINGER_MAIL_API_TOKEN: 'test-only-not-real',
  HOSTINGER_MAILBOX_RESOURCE_ID: 'AC31b06158251d89273d3c45526a59',
};

test('Hostinger Mail API sends expected secure request (no SMTP credentials)', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { status: 204 };
  };
  await sendViaHostingerApi({
    apiToken: 'non-production-unit-test-key',
    mailboxResourceId: 'AC31b06158251d89273d3c45526a59',
    fetchImpl,
  }, {
    to: 'qa@example.org',
    subject: 'Contact Test',
    text: 'Some text',
    html: '<p>Some text</p>',
    displayName: 'Mar-Khoor Support',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.mail.hostinger.com/api/v1/mailboxes/AC31b06158251d89273d3c45526a59/send');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer non-production-unit-test-key');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    to: ['qa@example.org'], subject: 'Contact Test', text: 'Some text',
    html: '<p>Some text</p>', displayName: 'Mar-Khoor Support',
  });
});

test('Hostinger Mail API rejects failed response without revealing the token', async () => {
  const token = 'unit-test-redacted-secret-value';
  await assert.rejects(() => sendViaHostingerApi({
    apiToken: token, mailboxResourceId: env.HOSTINGER_MAILBOX_RESOURCE_ID,
    fetchImpl: async () => ({ status: 401 }),
  }, { to: 'qa@example.org', subject: 'test', text: 'test' }), error => {
    assert.match(error.message, /401/);
    assert.doesNotMatch(error.message, new RegExp(token));
    return true;
  });
  await assert.rejects(() => sendViaHostingerApi({
    apiToken: token, mailboxResourceId: '../evil',
    fetchImpl: async () => ({ status: 204 }),
  }, { to: 'qa@example.org', subject: 'test', text: 'test' }), /ID not configured/);
});

test('Mailer uses Hostinger token ahead of stale SMTP password and validates recipients', async () => {
  const sender = mailerFromEnv(env);
  assert.equal(typeof sender, 'function');
  await assert.rejects(sender({ to: 'invalid\\r\\nBcc:other@example.com', subject: 'a', text: 'b', html: 'c' }), /Invalid recipient/);
});
