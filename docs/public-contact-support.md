# Mar-Khoor Public Contact and About pages

This change adds **/contact.html** and **/about.html**, accessible from the public homepage/navigation, with responsive Night Karakoram styling. Contact displays the public support address **admin@mar-khoor.com** and an always-visible floating support launcher on the platform public pages.

## Platform-support AI (separate from restaurant order assistants)

- Endpoint: `GET /api/public/assistant/status` and `POST /api/public/assistant/chat`
- Required **server-only** environment variable names: `OPENAI_API_KEY`, `WEBSITE_AI_ASSISTANT_ENABLED`. Optional: `OPENAI_ASSISTANT_MODEL`.
- The flag must equal `true` and the key must be available for AI chat. Otherwise, the widget gives an email-support fallback rather than falsely showing a working agent.
- No customer restaurant data, orders, bookings, or account information is fetched by the public support agent.
- The public assistant uses the OpenAI Responses API with `store:false`. Chat history is limited to the last 8 messages, and the app does not persist transcripts.
- Both the endpoint and frontend are validated for short messages; rate limiting is already applied in `src/server.js`.
- Never add secrets to the HTML/JavaScript or this repository.

## Deployment verification checklist

1. Check PR CI and source review. Deploy to a separate staging app first if available.
2. Load `/contact.html` and `/about.html` (HTTP 200), verify links and layouts on desktop/mobile.
3. Confirm floating chat icon on the homepage, contact page, about page, registration, pricing, and privacy pages.
4. With the AI flag disabled or key missing, verify that the email-support fallback appears without a sendable chat field.
5. With server-side AI enabled, use English and Roman Urdu prompts, verify actual answers, 429 limits and 503 fallback.
6. Keep the customer-facing restaurant AI/order flows separate and unchanged.

**Important:** Merging GitHub changes does not itself confirm that Hostinger is running that commit. Confirm deployed commit and perform live smoke tests before reporting a live release.
