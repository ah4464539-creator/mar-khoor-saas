# Mar-Khoor Public Contact and About pages

This change adds **/contact.html** and **/about.html**, accessible from the public homepage/navigation, with responsive Night Karakoram styling. Contact displays the public support address **admin@mar-khoor.com** and an always-visible floating support launcher on the platform public pages.

## Platform-support AI (separate from restaurant order assistants)

- Endpoint: `GET /api/public/assistant/status` and `POST /api/public/assistant/chat`
- Required **server-only** environment variable: `OPENAI_API_KEY`. Optional: `OPENAI_ASSISTANT_MODEL`. Set `WEBSITE_AI_ASSISTANT_PAUSED=true` to turn the public AI support off in an emergency; the older `WEBSITE_AI_ASSISTANT_ENABLED` switch is no longer required.
- The key must be available for AI chat and the pause switch must not be active. Otherwise, the widget gives an email-support fallback rather than falsely showing a working agent.
- No customer restaurant data, orders, bookings, or account information is fetched by the public support agent.
- The public assistant uses the OpenAI Responses API with `store:false`. Chat history is limited to the last 8 messages, and the app does not persist transcripts.
- Both the endpoint and frontend are validated for short messages; rate limiting is already applied in `src/server.js`.
- Never add secrets to the HTML/JavaScript or this repository.

## Contact form delivery

- Public visitors can use the Contact Us form with their name, reply email, topic and message, plus privacy consent.
- The only mail recipient is fixed at `admin@mar-khoor.com`; user input never selects the destination.
- The existing transactional mailer requires `MAIL_FROM` plus **one of**: (preferred) `HOSTINGER_MAIL_API_TOKEN` and `HOSTINGER_MAILBOX_RESOURCE_ID`, or SMTP `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` (optional `SMTP_PORT`), or `RESEND_API_KEY`, all server-only.
- Contact submissions are rate limited to five per hour per visitor IP and protected by a honeypot. They are sent via the configured mailer without storing a support database record.
- Failure to send returns an error with a visible direct-email fallback. HTTP success means the SMTP/API provider accepted the message, **not** guaranteed mailbox delivery.
- After accepting an enquiry in the support mailbox, the server sends an automatic **"we will reply within 24 hours"** acknowledgement to the supplied email address. It suppresses repeat acknowledgements to one sender within 24 hours and does not send to `admin@mar-khoor.com` or common no-reply mailboxes. An acknowledgement failure does not make the already-sent original enquiry fail.
- **Direct inbound messages to `admin@mar-khoor.com` bypass this website endpoint.** For them, separately enable Hostinger's mailbox-level Automatic Reply (Webmail > Settings > All settings > Automatic reply; On; start immediately; never end). Use the same subject/body. This setup needs mailbox-owner access and should be verified with a separate external inbound email. Do not imply the mailbox-level setting is enabled just because the website form acknowledgement works.

## Deployment verification checklist

1. Check PR CI and source review. Deploy to a separate staging app first if available.
2. Load `/contact.html` and `/about.html` (HTTP 200), verify links and layouts on desktop/mobile.
3. Confirm floating chat icon on the homepage, contact page, about page, registration, pricing, and privacy pages.
4. With the AI pause flag active or key missing, verify that the email-support fallback appears without a sendable chat field.
5. With server-side AI enabled, use English and Roman Urdu prompts, verify actual answers, 429 limits and 503 fallback.
6. Submit one test contact message, confirm the HTTP provider accepted it and check the official inbox for delivery. If sending is unconfigured, verify the direct-email fallback.
7. Keep the customer-facing restaurant AI/order flows separate and unchanged.

**Important:** Merging GitHub changes does not itself confirm that Hostinger is running that commit. Confirm deployed commit and perform live smoke tests before reporting a live release.


## Hostinger Mail API transport (public support only)

- Hostinger Mail supports `POST https://api.mail.hostinger.com/api/v1/mailboxes/{mailboxResourceId}/send` with a mailbox-scoped Bearer token. Its success response is HTTP 204; no SMTP password is required.
- To repair a production SMTP password failure, create an API token scoped only to the official Mar-Khoor support mailbox under **hPanel → Emails → Agentic Mail → API access**. Keep the token in hPanel's **web application environment variables**, never in GitHub, public frontend code, docs, or chat.
- Set `HOSTINGER_MAIL_API_TOKEN` to that token and `HOSTINGER_MAILBOX_RESOURCE_ID` to the mailbox resource ID from the authenticated account API. Keep the existing `MAIL_FROM`; the code chooses Hostinger Mail API ahead of legacy SMTP whenever both API env vars are set.
- Saving environment variables may require/retrigger a deployment or restart. Verify the website Contact Form and visitor acknowledgement with a real test, check both mailboxes, and verify no token appears in public responses/logs. Never claim success solely from `/api/public/contact/status`.
- In case of failure, remove only `HOSTINGER_MAIL_API_TOKEN` to fall back to the previously configured transport. Do not rotate a personal mailbox password or affect unrelated restaurant, order, or admin systems.
