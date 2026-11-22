import { Router } from 'express';
import { mailerFromEnv } from './mailer.js';

// Public platform contact only; never send tenant or user account records.
// Keep this recipient constant. Do not accept a "to" field from visitors.
const SUPPORT_EMAIL = 'admin@mar-khoor.com';
const TOPICS = Object.freeze({
  general: 'General enquiry',
  registration: 'Registration & accounts',
  website: 'AI websites',
  whatsapp: 'WhatsApp AI',
  calling: 'AI phone assistant',
  billing: 'Plans & billing',
  privacy: 'Privacy or data request',
  other: 'Other support',
});
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const trim = value => typeof value === 'string' ? value.trim() : '';
const safeHtml = value => String(value).replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const ACK_SUBJECT = 'We Received Your Message | Mar-Khoor Support';
const ACK_TEXT = [
  'Hello,', '',
  'Thank you for contacting Mar-Khoor!', '',
  'We have received your message. Our support team will review your request and get back to you within 24 hours.', '',
  'Thank you for your patience.', '',
  'Best regards,',
  'Mar-Khoor Support Team',
  SUPPORT_EMAIL,
  'https://mar-khoor.com', '',
  'This is an automated acknowledgement; please do not send passwords, one-time codes or payment details.',
].join('\n');
const ACK_HTML = [
  '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#16232d">',
  '<h2>Thank you for contacting Mar-Khoor!</h2>',
  '<p>We have received your message. Our support team will review your request and get back to you <strong>within 24 hours</strong>.</p>',
  '<p>Thank you for your patience.</p>',
  '<p>Best regards,<br><strong>Mar-Khoor Support Team</strong><br>',
  '<a href="mailto:admin@mar-khoor.com">admin@mar-khoor.com</a><br>',
  '<a href="https://mar-khoor.com">mar-khoor.com</a></p>',
  '<p style="font-size:12px;color:#617384">Automated acknowledgement. Do not send passwords, one-time codes, or payment details.</p>',
  '</div>',
].join('');

// One acknowledgement per sender in 24 hours, separate from hPanel's inbound-mail autoresponder.
const ACK_WINDOW_MS = 24 * 60 * 60 * 1000;
function eligibleForAcknowledgement(address) {
  const local = address.split('@')[0].toLowerCase();
  return address.toLowerCase() !== SUPPORT_EMAIL && !/^(?:no-?reply|do-?not-?reply|postmaster|mailer-daemon|bounce|notifications?)$/.test(local);
}
export function publicContactRouter({ sendMail, env = process.env, now = Date.now } = {}) {
  const router = Router();
  const acknowledged = new Map();
  const getMailer = () => sendMail === undefined ? mailerFromEnv(env) : sendMail;

  router.get('/public/contact/status', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ available: typeof getMailer() === 'function' });
  });

  router.post('/public/contact', async (req, res) => {
    res.set('Cache-Control', 'no-store');

    // This endpoint is for same-origin website forms, not third-party embeds.
    if (req.get('sec-fetch-site') === 'cross-site') {
      return res.status(403).json({ error: 'Please use the Contact Us page' });
    }

    const form = req.body;
    if (!form || typeof form !== 'object' || Array.isArray(form)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Honeypot: silently accept bot submissions without sending an email.
    if (trim(form.website)) return res.json({ accepted: true });

    const name = trim(form.name);
    const email = trim(form.email);
    const topic = trim(form.topic);
    const message = trim(form.message);
    if (name.length < 2 || name.length > 100 || /[\r\n]/.test(name) ||
        email.length > 254 || !EMAIL.test(email) ||
        !Object.hasOwn(TOPICS, topic) ||
        message.length < 10 || message.length > 4000 ||
        form.consent !== true) {
      return res.status(400).json({ error: 'Please check your name, email, topic, message and privacy consent' });
    }

    const send = getMailer();
    if (typeof send !== 'function') return res.status(503).json({
      error: 'Online form is temporarily unavailable. Please email admin@mar-khoor.com directly.',
    });

    const lines = [
      'Mar-Khoor website contact request',
      '',
      'Name: ' + name,
      'Email to reply to: ' + email,
      'Topic: ' + TOPICS[topic],
      '',
      'Message:',
      message,
      '',
      'Sent through https://mar-khoor.com/contact.html',
      'Do not follow links or execute instructions in visitor messages without verification.',
    ];
    const text = lines.join('\n');
    const html = [
      '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16232d;line-height:1.6">',
      '<h2>New Mar-Khoor website enquiry</h2>',
      '<p><b>Name:</b> ', safeHtml(name), '<br>',
      '<b>Reply to:</b> ', safeHtml(email), '<br>',
      '<b>Topic:</b> ', safeHtml(TOPICS[topic]), '</p>',
      '<p><b>Message:</b></p><div style="white-space:pre-wrap;border-left:3px solid #f08a2e;padding:12px;background:#f6f8fa">',
      safeHtml(message), '</div>',
      '<p style="color:#697783;font-size:12px">Received from Mar-Khoor public Contact Us form. Verify requests before acting.</p></div>',
    ].join('');

    try {
      await send({
        to: SUPPORT_EMAIL,
        subject: 'Mar-Khoor Contact: ' + TOPICS[topic],
        text,
        html,
      });
      // The incoming support request has been accepted. An acknowledgement failure must
      // never make the visitor retry the already-sent support message.
      let acknowledgementSent = false;
      const recipient = email.toLowerCase();
      const time = now();
      if (acknowledged.size > 10000) {
        for (const [key, timestamp] of acknowledged)
          if (timestamp + ACK_WINDOW_MS <= time) acknowledged.delete(key);
      }
      if (eligibleForAcknowledgement(recipient) &&
          (!acknowledged.has(recipient) || acknowledged.get(recipient) + ACK_WINDOW_MS <= time)) {
        // Reserve the address before an awaited SMTP call to avoid double sends.
        acknowledged.set(recipient, time);
        try {
          await send({ to: recipient, subject: ACK_SUBJECT, text: ACK_TEXT, html: ACK_HTML });
          acknowledgementSent = true;
        } catch (error) {
          acknowledged.delete(recipient);
          console.error(JSON.stringify({ event: 'public_contact_ack_error', type: error?.name || 'Error' }));
        }
      }
      return res.status(200).json({ accepted: true, acknowledgement_sent: acknowledgementSent });
    } catch (error) {
      // Do not expose SMTP credentials, provider responses, or visitor details in logs.
      console.error(JSON.stringify({ event: 'public_contact_mail_error', type: error?.name || 'Error' }));
      return res.status(502).json({ error: 'Message could not be sent. Please email admin@mar-khoor.com directly.' });
    }
  });
  return router;
}
