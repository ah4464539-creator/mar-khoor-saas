import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import express from 'express';
import { authRouter, hashPassword } from '../src/auth.js';
import { passwordResetRouter, resetBaseUrl } from '../src/password-reset.js';
import { buildMessage, parseFrom, mailerFromEnv, sendViaSmtp, sendViaResend } from '../src/mailer.js';

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const silent = () => {};

async function withServer(router, fn) {
  const app = express(); app.use(express.json()); app.use('/auth', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { return await fn('http://127.0.0.1:' + server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post = (base, path, body) => fetch(base + '/auth' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function fakePool(users) {
  const calls = [];
  const resets = new Map();
  const pool = {
    calls,
    resets,
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT id,email,platform_role FROM users')) return [users.filter(u => u.email === params[0])];
      if (sql.startsWith('INSERT INTO password_resets')) { resets.set(params[0], { userId: params[1], used: false }); return [{}]; }
      if (sql.startsWith('DELETE FROM password_resets WHERE token_hash')) { resets.delete(params[0]); return [{}]; }
      return [{}];
    },
  };
  return pool;
}

test('forgot password refuses honestly when email delivery is not configured', async () => {
  const pool = fakePool([]);
  await withServer(passwordResetRouter(pool, { sendMail: null, baseUrl: 'https://mar-khoor.com', log: silent }), async base => {
    const response = await post(base, '/password/forgot', { email: 'owner@cafe.pk' });
    assert.equal(response.status, 503);
    assert.equal(pool.calls.length, 0);
  });
});

test('forgot password gives the same answer for unknown, super admin and real accounts', async () => {
  const sent = [];
  const pool = fakePool([
    { id: 7, email: 'owner@cafe.pk', platform_role: 'user' },
    { id: 1, email: 'boss@mar-khoor.com', platform_role: 'super_admin' },
  ]);
  const router = passwordResetRouter(pool, { sendMail: async mail => sent.push(mail), baseUrl: 'https://mar-khoor.com/', log: silent });
  await withServer(router, async base => {
    const bad = await post(base, '/password/forgot', { email: 'not-an-email' });
    assert.equal(bad.status, 400);
    const replies = [];
    for (const email of ['nobody@cafe.pk', 'BOSS@mar-khoor.com', ' Owner@Cafe.pk ']) {
      const response = await post(base, '/password/forgot', { email });
      assert.equal(response.status, 200);
      replies.push((await response.json()).message);
    }
    assert.equal(new Set(replies).size, 1);
    assert.equal(sent.length, 1, 'only the restaurant account receives an email');
    assert.equal(sent[0].to, 'owner@cafe.pk');
    const token = /https:\/\/mar-khoor\.com\/restaurant\.html#reset-token=([a-f0-9]{64})/.exec(sent[0].text)[1];
    assert.ok(sent[0].html.includes(token));
    assert.ok(pool.resets.has(sha256(token)), 'stores only the token hash');
    assert.ok(!pool.calls.some(call => JSON.stringify(call.params).includes(token)), 'raw token never reaches the database');
    assert.ok(pool.calls.some(call => call.sql.startsWith('DELETE FROM password_resets WHERE user_id=?')), 'older links are revoked');
  });
});

test('forgot password limits links per email and drops the token when sending fails', async () => {
  let attempts = 0;
  const pool = fakePool([{ id: 7, email: 'owner@cafe.pk', platform_role: 'user' }]);
  const router = passwordResetRouter(pool, { sendMail: async () => { attempts++; throw Error('smtp down'); }, baseUrl: 'https://mar-khoor.com', log: silent });
  await withServer(router, async base => {
    for (let i = 0; i < 5; i++) assert.equal((await post(base, '/password/forgot', { email: 'owner@cafe.pk' })).status, 200);
    assert.equal(attempts, 3);
    assert.equal(pool.resets.size, 0, 'failed sends leave no usable token');
  });
});

function resetPool({ valid = true, role = 'user' } = {}) {
  const log = [];
  const connection = {
    async beginTransaction() { log.push('begin'); },
    async execute(sql, params) {
      log.push(sql.split(' ').slice(0, 3).join(' '));
      if (sql.startsWith('SELECT r.user_id')) {
        assert.match(params[0], /^[a-f0-9]{64}$/);
        return [valid ? [{ user_id: 7, platform_role: role }] : []];
      }
      if (sql.startsWith('UPDATE users SET password_hash')) connection.newHash = params[0];
      return [{}];
    },
    async commit() { log.push('commit'); },
    async rollback() { log.push('rollback'); },
    release() { log.push('release'); },
  };
  return { pool: { getConnection: async () => connection, execute: async () => [[]] }, connection, log };
}

test('reset password updates the hash, burns the link and signs out every session', async () => {
  const { pool, connection, log } = resetPool();
  const token = 'a'.repeat(64);
  await withServer(passwordResetRouter(pool, { sendMail: null, log: silent }), async base => {
    assert.equal((await post(base, '/password/reset', { token: 'short', password: 'long-enough-password' })).status, 400);
    assert.equal((await post(base, '/password/reset', { token, password: 'short' })).status, 400);
    const ok = await post(base, '/password/reset', { token, password: 'brand-new-password-123' });
    assert.equal(ok.status, 200);
  });
  assert.match(connection.newHash, /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.deepEqual(log, ['begin', 'SELECT r.user_id, u.platform_role', 'UPDATE users SET', 'UPDATE password_resets SET', 'DELETE FROM sessions', 'commit', 'release']);
});

test('reset password rejects expired, used or super admin links', async () => {
  for (const options of [{ valid: false }, { role: 'super_admin' }]) {
    const { pool, log } = resetPool(options);
    await withServer(passwordResetRouter(pool, { sendMail: null, log: silent }), async base => {
      const response = await post(base, '/password/reset', { token: 'b'.repeat(64), password: 'brand-new-password-123' });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /invalid or has expired/);
    });
    assert.ok(log.includes('rollback'));
    assert.ok(!log.includes('UPDATE users SET'));
  }
});

test('new password works with the existing login endpoint', async () => {
  const { pool, connection } = resetPool();
  await withServer(passwordResetRouter(pool, { sendMail: null, log: silent }), async base => {
    await post(base, '/password/reset', { token: 'c'.repeat(64), password: 'brand-new-password-123' });
  });
  const loginPool = { execute: async sql => sql.includes('FROM users') ? [[{ id: 7, email: 'owner@cafe.pk', password_hash: connection.newHash, platform_role: 'user' }]] : [[]] };
  await withServer(authRouter(loginPool), async base => {
    assert.equal((await post(base, '/login', { email: 'owner@cafe.pk', password: 'old-password-xyz' })).status, 401);
    assert.equal((await post(base, '/login', { email: 'owner@cafe.pk', password: 'brand-new-password-123' })).status, 200);
  });
  assert.ok(await hashPassword('x'));
});

test('reset links only use an https public origin (http allowed for localhost)', () => {
  assert.equal(resetBaseUrl('https://mar-khoor.com/some/path'), 'https://mar-khoor.com');
  assert.equal(resetBaseUrl('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(resetBaseUrl('http://mar-khoor.com'), null);
  assert.equal(resetBaseUrl(undefined), null);
});

test('mailer builds safe MIME messages and needs MAIL_FROM plus a provider', () => {
  assert.equal(parseFrom('Mar-Khoor <no-reply@mar-khoor.com>').address, 'no-reply@mar-khoor.com');
  assert.equal(parseFrom('no-reply@mar-khoor.com').header, 'no-reply@mar-khoor.com');
  assert.equal(parseFrom('x@y.com\r\nBcc: evil@z.com'), null);
  const from = parseFrom('Mar-Khoor <no-reply@mar-khoor.com>');
  const message = buildMessage({ from, to: 'owner@cafe.pk', subject: 'Reset your password', text: 'hello', html: '<b>hello</b>' });
  assert.match(message, /^From: Mar-Khoor <no-reply@mar-khoor\.com>\r\nTo: owner@cafe\.pk\r\nSubject: Reset your password\r\n/);
  assert.ok(message.includes(Buffer.from('hello').toString('base64')));
  assert.equal(mailerFromEnv({}), null);
  assert.equal(mailerFromEnv({ MAIL_FROM: 'no-reply@mar-khoor.com' }), null);
  assert.equal(typeof mailerFromEnv({ MAIL_FROM: 'no-reply@mar-khoor.com', SMTP_HOST: 'smtp.hostinger.com', SMTP_USER: 'u', SMTP_PASSWORD: 'p' }), 'function');
  assert.equal(typeof mailerFromEnv({ MAIL_FROM: 'no-reply@mar-khoor.com', RESEND_API_KEY: 're_x' }), 'function');
});

test('SMTP client completes a full authenticated delivery conversation', async () => {
  const received = [];
  const server = net.createServer(socket => {
    let data = false; let buffer = '';
    socket.write('220 fake ready\r\n');
    socket.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        received.push(line);
        if (data) { if (line === '.') { data = false; socket.write('250 queued\r\n'); } continue; }
        if (line.startsWith('EHLO')) socket.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (line === 'AUTH LOGIN') socket.write('334 VXNlcm5hbWU6\r\n');
        else if (line === Buffer.from('user').toString('base64')) socket.write('334 UGFzc3dvcmQ6\r\n');
        else if (line === Buffer.from('secret').toString('base64')) socket.write('235 ok\r\n');
        else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) socket.write('250 ok\r\n');
        else if (line === 'DATA') { data = true; socket.write('354 go\r\n'); }
        else if (line === 'QUIT') socket.end('221 bye\r\n');
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    await sendViaSmtp({ host: '127.0.0.1', port, user: 'user', password: 'secret', connect: () => net.connect(port, '127.0.0.1') },
      { from: 'no-reply@mar-khoor.com', to: 'owner@cafe.pk', message: 'Subject: hi\r\n\r\n.leading dot' });
    assert.ok(received.includes('MAIL FROM:<no-reply@mar-khoor.com>'));
    assert.ok(received.includes('RCPT TO:<owner@cafe.pk>'));
    assert.ok(received.includes('..leading dot'), 'dot-stuffing applied');
  } finally { server.close(); }
});

test('SMTP client reports a rejected login', async () => {
  const server = net.createServer(socket => {
    socket.write('220 ready\r\n');
    socket.on('data', chunk => {
      const line = String(chunk);
      if (line.startsWith('EHLO')) socket.write('250 ok\r\n');
      else if (line.startsWith('AUTH')) socket.write('535 bad credentials\r\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    await assert.rejects(sendViaSmtp({ host: 'x', user: 'u', password: 'p', connect: () => net.connect(port, '127.0.0.1') }, { from: 'a@b.co', to: 'c@d.co', message: 'x' }), /535/);
  } finally { server.close(); }
});

test('Resend adapter sends JSON with bearer auth', async () => {
  let request;
  await sendViaResend({ apiKey: 're_test', fetchImpl: async (url, init) => { request = { url, init }; return { ok: true }; } },
    { from: 'Mar-Khoor <no-reply@mar-khoor.com>', to: 'owner@cafe.pk', subject: 's', text: 't', html: 'h' });
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.init.headers.Authorization, 'Bearer re_test');
  assert.deepEqual(JSON.parse(request.init.body).to, ['owner@cafe.pk']);
});

test('login card shows errors inside the card and offers forgot password', () => {
  const html = fs.readFileSync(new URL('../public/restaurant.html', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('../public/restaurant.js', import.meta.url), 'utf8');
  const form = html.slice(html.indexOf('<form id="login">'), html.indexOf('</form>', html.indexOf('<form id="login">')));
  assert.ok(form.indexOf('id="login-error"') > 0 && form.indexOf('id="login-error"') < form.indexOf('<button type="submit">Sign in'), 'error sits above the Sign in button');
  assert.ok(form.includes('id="forgot-link"'));
  for (const id of ['forgot-view', 'forgot-form', 'forgot-email', 'forgot-message', 'reset-view', 'reset-form', 'reset-password', 'reset-confirm', 'reset-message', 'login-notice'])
    assert.ok(html.includes('id="' + id + '"'), id);
  assert.ok(html.includes('src="/password-reset.js"'));
  const submit = js.slice(js.indexOf("const loginError"), js.indexOf("logoutButton.addEventListener('click'"));
  assert.ok(submit.includes("fetch('/auth/login'"));
  assert.ok(!submit.includes('status.textContent'), 'login errors no longer go to the page-bottom status line');
});
