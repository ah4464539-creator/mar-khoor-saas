import { Router } from 'express';

// Staging-only public FAQ assistant. Never expose credentials or tenant data.
export function publicAssistantRouter() {
  const router = Router();
  router.get('/public/assistant/status', (_req, res) => {
    const enabled = process.env.WEBSITE_AI_ASSISTANT_ENABLED === 'true' &&
      Boolean(process.env.OPENAI_API_KEY);
    res.set('Cache-Control', 'no-store').json({ enabled });
  });
  router.post('/public/assistant/chat', async (req, res) => {
    if (process.env.WEBSITE_AI_ASSISTANT_ENABLED !== 'true') return res.status(503).json({ error: 'Assistant is not enabled' });
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(503).json({ error: 'Assistant is not configured' });
    const message = req.body?.message;
    if (typeof message !== 'string' || !message.trim() || message.length > 1200) return res.status(400).json({ error: 'Message must be 1-1200 characters' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4.1-mini',
          max_output_tokens: 300,
          instructions: 'You are the Mar-Khoor public website information assistant. Explain only general Mar-Khoor capabilities for restaurants, clinics, salons and hotels: AI websites, WhatsApp AI (orders and bookings), AI phone calls (orders and bookings), the live order and booking desk, plans and registration. Never claim to know a business menu, price, order or booking status or availability. Never take or confirm orders, request payment details or reveal private data. Answer in the user language. Be concise.',
          input: message.trim(),
          store: false,
        }),
      });
      if (!response.ok) return res.status(502).json({ error: 'Assistant provider unavailable' });
      const data = await response.json();
      const reply = (data.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n').trim();
      if (!reply) return res.status(502).json({ error: 'Assistant returned no reply' });
      res.set('Cache-Control', 'no-store');
      return res.json({ reply });
    } catch { return res.status(503).json({ error: 'Assistant temporarily unavailable' }); }
    finally { clearTimeout(timeout); }
  });
  return router;
}
