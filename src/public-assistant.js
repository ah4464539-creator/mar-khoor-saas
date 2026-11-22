import { Router } from 'express';

// Public Mar-Khoor website support only. No tenant context, credentials, or order tools.
// Enabling requires both WEBSITE_AI_ASSISTANT_ENABLED=true and an OpenAI server-side key.
export function publicAssistantRouter({ fetcher = fetch } = {}) {
  const router = Router();
  const isEnabled = () => process.env.WEBSITE_AI_ASSISTANT_ENABLED === 'true' && Boolean(process.env.OPENAI_API_KEY);
  router.get('/public/assistant/status', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ enabled: isEnabled() });
  });
  router.post('/public/assistant/chat', async (req, res) => {
    if (process.env.WEBSITE_AI_ASSISTANT_ENABLED !== 'true') return res.status(503).json({ error: 'Assistant is not enabled' });
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(503).json({ error: 'Assistant is not configured' });

    const message = req.body?.message;
    if (typeof message !== 'string' || !message.trim() || message.length > 1200) {
      return res.status(400).json({ error: 'Message must be 1-1200 characters' });
    }
    const previous = req.body?.history ?? [];
    if (!Array.isArray(previous) || previous.length > 8 || !previous.every(entry =>
      entry && (entry.role === 'user' || entry.role === 'assistant') &&
      typeof entry.content === 'string' && entry.content.trim().length > 0 && entry.content.length <= 2200
    )) return res.status(400).json({ error: 'Invalid chat history' });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetcher('https://api.openai.com/v1/responses', {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4.1-mini',
          max_output_tokens: 360,
          instructions: [
            'You are Mar-Khoor AI Support for the public Mar-Khoor.com website, not an order-taking assistant.',
            'Help visitors understand registration, business dashboard, plans, setup, AI website builder, WhatsApp, AI phone assistant, support, and the restaurant/clinic/salon/hotel business types.',
            'Use only general product guidance. Actual prices and integration availability depend on country and configuration; do not invent features, guarantees, prices, opening hours or setup status.',
            'For account-specific issues, billing disputes, integration errors, refunds, privacy or deletion requests, explain that they must email admin@mar-khoor.com or use https://mar-khoor.com/contact.html.',
            'Never take or confirm orders or bookings. Never request passwords, verification codes, payment details, health data or private customer information.',
            'Do not claim to check accounts, modify settings, escalate a ticket, or have contacted staff. Keep responses concise and match the visitor language, including Roman Urdu.',
          ].join(' '),
          input: [...previous.map(({ role, content }) => ({ role, content })), { role: 'user', content: message.trim() }],
          store: false,
        }),
      });
      if (!response.ok) return res.status(502).json({ error: 'Assistant provider unavailable' });
      const data = await response.json();
      const reply = (data.output || []).flatMap(item => item.content || [])
        .filter(item => item.type === 'output_text' && typeof item.text === 'string')
        .map(item => item.text).join('\n').trim();
      if (!reply) return res.status(502).json({ error: 'Assistant returned no reply' });
      res.set('Cache-Control', 'no-store');
      return res.json({ reply });
    } catch {
      return res.status(503).json({ error: 'Assistant temporarily unavailable' });
    } finally { clearTimeout(timeout); }
  });
  return router;
}
