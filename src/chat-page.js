// Full-screen messenger chat with one business's AI (Mar-Khoor customer app): /r/<slug>/chat.
// Reuses the website assistant (same markup ids, restaurant-assistant-panel.js and the live
// voice script), so ordering, booking help, voice notes and the live call behave exactly as on
// the business website. Only the layout differs: a messenger header with a Call button, the
// conversation filling the screen, and the history kept on the phone (data-chat-persist).
import { assistantCss } from './site-builder.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const CHAT_THEME = { bg: '#0E1620', ink: '#EEF3F6', accent: '#F08A2E', accentInk: '#140C05', card: '#16212C', muted: '#A6B4C0' };

export function chatGreeting(category) {
  return category === 'hotel' ? 'Hi! Ask me about rooms and reservations.'
    : category === 'clinic' ? 'Hi! Ask me about services and appointments.'
    : category === 'salon' ? 'Hi! Ask me about services and appointments.'
    : 'Hi! What would you like to order today?';
}

export const MESSENGER_CSS = `
html,body{margin:0;height:100%;background:#0E1620;color:#EEF3F6;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.chat-top{position:fixed;inset:0 0 auto 0;z-index:5;display:flex;align-items:center;gap:10px;height:60px;padding:0 10px;padding-top:env(safe-area-inset-top);background:#0A1018;border-bottom:1px solid #22303D}
.chat-top a,.chat-top button{color:#EEF3F6;text-decoration:none}
.chat-back{display:grid;place-items:center;width:44px;height:44px;font-size:28px;line-height:1}
.chat-avatar{display:grid;place-items:center;flex:0 0 40px;width:40px;height:40px;border-radius:50%;background:#2A1E12;color:#FFB066;font-weight:700;font-size:18px}
.chat-who{flex:1;min-width:0;display:flex;flex-direction:column}
.chat-who strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:16px}
.chat-who small{color:#7FD1B3;font-size:12px}
.chat-call{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 14px;border-radius:999px;border:0;background:#F08A2E;color:#140C05!important;font:600 14px system-ui,sans-serif;cursor:pointer}
.chat-call[hidden]{display:none}
.chat-info{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;border:1px solid #3A4D5F;font-size:13px}
.restaurant-assistant.chat-full{position:fixed;inset:calc(60px + env(safe-area-inset-top)) 0 0 0;font-size:15px}
.restaurant-assistant.chat-full>summary,.chat-full .assistant-heading{display:none}
.chat-full .assistant-panel{position:absolute;inset:0;width:auto;height:auto;max-height:none;border:0;border-radius:0;box-shadow:none;background:#0E1620}
.chat-full .assistant-body{padding:12px 12px calc(10px + env(safe-area-inset-bottom))}
.chat-full [data-assistant-messages]{display:flex;flex-direction:column;gap:8px}
.chat-full .assistant-reply,.chat-full .assistant-question{max-width:82%;margin:0;padding:9px 13px;border-radius:18px;line-height:1.45;white-space:pre-wrap}
.chat-full .assistant-reply{align-self:flex-start;background:#16212C;color:#EEF3F6;border-bottom-left-radius:6px}
.chat-full .assistant-question{align-self:flex-end;background:#F08A2E;color:#140C05;border-bottom-right-radius:6px}
.chat-full .assistant-composer{border-radius:24px;background:#16212C;border:1px solid #3A4D5F}
.chat-day{align-self:center;color:#8C9BA8;font-size:12px;margin:4px 0}
.chat-top{z-index:30}
/* The website's mobile sheet sizes itself from the keyboard; in the messenger the page itself
   resizes with the keyboard (interactive-widget=resizes-content), so pin the chat under the header. */
.restaurant-assistant.chat-full[open]>.assistant-panel,.chat-full .assistant-panel{position:fixed!important;top:calc(60px + env(safe-area-inset-top))!important;left:0!important;right:0!important;bottom:0!important;width:auto!important;height:auto!important;max-height:none!important;border-radius:0!important;z-index:10}
.chat-full .assistant-body{height:100%;box-sizing:border-box}
`;

/** Complete HTML for the chat screen. All business text is escaped. */
export function renderChatPage({ slug, name, category, controls, voice, voiceScript = '', panelScript }) {
  const safeSlug = /^[a-z0-9-]{1,160}$/.test(slug) ? slug : '';
  const title = escapeHtml(String(name || 'Chat').slice(0, 160));
  const letter = escapeHtml(String(name || '?').trim().charAt(0).toUpperCase() || '?');
  const greeting = escapeHtml(chatGreeting(category));
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content">'
    + '<meta name="robots" content="noindex"><meta name="theme-color" content="#0A1018"><link rel="manifest" href="/customer.webmanifest">'
    + '<title>' + title + ' · Chat</title><style>' + assistantCss(CHAT_THEME) + MESSENGER_CSS + '</style></head>'
    + '<body data-chat-persist="1" data-chat-slug="' + safeSlug + '" data-chat-name="' + title + '" data-chat-category="' + escapeHtml(category || 'restaurant') + '">'
    + '<header class="chat-top"><a class="chat-back" href="/messages" aria-label="Back to chats">‹</a><span class="chat-avatar" aria-hidden="true">' + letter + '</span>'
    + '<div class="chat-who"><strong>' + title + '</strong><small>AI assistant · online</small></div>'
    + (voice ? '<button type="button" class="chat-call" data-chat-call aria-label="Call the AI assistant">📞 Call</button>' : '')
    + '<a class="chat-info" href="/r/' + safeSlug + '" aria-label="Open the business page">i</a></header>'
    + '<details id="assistant" class="restaurant-assistant chat-full" open><summary>Chat</summary><div class="assistant-panel"><div class="assistant-heading"><strong>' + title + '</strong><button type="button" data-close-assistant aria-label="Close">×</button></div>'
    + '<div class="assistant-body"><div data-assistant-messages role="log" aria-live="polite"><p class="assistant-reply">' + greeting + '</p></div>'
    + '<section id="assistant-order-card" class="assistant-order-card" aria-label="Order details and live tracking" hidden><strong>Order details &amp; live tracking</strong><div id="assistant-order-details"></div><p id="assistant-order-status" role="status"></p><a id="assistant-order-link" target="_self">Full order tracking</a></section>'
    + controls + '</div></div></details>' + panelScript + voiceScript + '</body></html>';
}
