// Transactional email without extra dependencies.
// Configure ONE of:
//   SMTP (e.g. Hostinger mailbox): SMTP_HOST, SMTP_PORT (default 465, implicit TLS), SMTP_USER, SMTP_PASSWORD
//   Resend HTTP API:               RESEND_API_KEY
// plus MAIL_FROM, e.g. "Mar-Khoor <no-reply@mar-khoor.com>".
import crypto from 'node:crypto';
import tls from 'node:tls';

const HEADER_UNSAFE = /[\r\n]/;
const ADDRESS = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export function parseFrom(from) {
  if (typeof from !== 'string' || HEADER_UNSAFE.test(from)) return null;
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>]+)>\s*$/.exec(from);
  const address = (match ? match[2] : from).trim();
  if (!ADDRESS.test(address)) return null;
  return { address, header: match && match[1] ? `${encodeWord(match[1].trim())} <${address}>` : address };
}

function encodeWord(value) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

const wrap76 = text => text.replace(/.{1,76}/g, '$&\r\n');

export function buildMessage({ from, to, subject, text, html, now = new Date() }) {
  const boundary = 'mk-' + crypto.randomBytes(12).toString('hex');
  const domain = from.address.split('@')[1];
  const lines = [
    `From: ${from.header}`,
    `To: ${to}`,
    `Subject: ${encodeWord(subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(16).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(text, 'utf8').toString('base64')),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(html, 'utf8').toString('base64')),
    `--${boundary}--`,
    '',
  ];
  return lines.join('\r\n');
}

// Minimal SMTP client: implicit TLS (port 465), AUTH LOGIN, one recipient.
export function sendViaSmtp({ host, port = 465, user, password, connect = tls.connect, timeoutMs = 20000 }, { from, to, message }) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port, servername: host });
    let buffer = '';
    const codes = [];
    const waiters = [];
    let settled = false;
    const finish = (error, graceful = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceful) socket.end('QUIT\r\n'); else socket.destroy();
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => finish(Error('SMTP timeout')), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('error', error => finish(error));
    socket.on('close', () => finish(Error('SMTP connection closed')));
    socket.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        // The last line of a reply is "NNN text" (space), continuation lines are "NNN-text".
        if (/^\d{3}(?: |$)/.test(line)) {
          const code = Number(line.slice(0, 3));
          const waiter = waiters.shift();
          if (waiter) waiter(code); else codes.push(code);
        }
      }
    });
    const reply = () => codes.length ? Promise.resolve(codes.shift()) : new Promise(r => waiters.push(r));
    const step = async (command, expected) => {
      if (command !== null) socket.write(command + '\r\n');
      const code = await reply();
      if (!expected.includes(code)) throw Error(`SMTP rejected step (${code})`);
    };
    (async () => {
      await step(null, [220]);
      await step('EHLO mar-khoor', [250]);
      await step('AUTH LOGIN', [334]);
      await step(Buffer.from(user).toString('base64'), [334]);
      await step(Buffer.from(password).toString('base64'), [235]);
      await step(`MAIL FROM:<${from}>`, [250]);
      await step(`RCPT TO:<${to}>`, [250, 251]);
      await step('DATA', [354]);
      // Dot-stuffing per RFC 5321.
      const body = message.replace(/\r\n\./g, '\r\n..');
      await step(body + '\r\n.', [250]);
      finish(null, true);
    })().catch(finish);
  });
}

export async function sendViaResend({ apiKey, fetchImpl = fetch }, { from, to, subject, text, html }) {
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error(`Resend rejected email (${response.status})`);
}

// Returns sendMail({to,subject,text,html}) or null when email is not configured.
export function mailerFromEnv(env = process.env) {
  const from = parseFrom(env.MAIL_FROM || '');
  if (!from) return null;
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD) {
    const config = { host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 465), user: env.SMTP_USER, password: env.SMTP_PASSWORD };
    return async ({ to, subject, text, html }) => {
      if (!ADDRESS.test(to) || HEADER_UNSAFE.test(to)) throw Error('Invalid recipient');
      await sendViaSmtp(config, { from: from.address, to, message: buildMessage({ from, to, subject, text, html }) });
    };
  }
  if (env.RESEND_API_KEY) {
    return async ({ to, subject, text, html }) => {
      if (!ADDRESS.test(to) || HEADER_UNSAFE.test(to)) throw Error('Invalid recipient');
      await sendViaResend({ apiKey: env.RESEND_API_KEY }, { from: env.MAIL_FROM, to, subject, text, html });
    };
  }
  return null;
}
