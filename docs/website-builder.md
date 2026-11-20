# AI website builder

Each restaurant can have a public page at `https://mar-khoor.com/r/<restaurant-slug>`.

**Status: tenant-scoped website storage, preview, four safe template presets and AI-generated draft are implemented. Live AI generation still requires an authorized OpenAI API key and end-to-end verification.**

## How it works
- The restaurant admin opens **My website** in the dashboard, describes the restaurant in a sentence or two and chooses **Classic Dark, Warm Bistro, Clean Editorial, Midnight Modern or Summit Light** before pressing **Write with AI**. The AI only returns a headline, tagline, about text, a colour theme and which sections to show. It is told to use only the facts it was given. Hours, phone and address are never taken from the AI; the owner types them.
- Everything is stored as a small JSON config of plain text and fixed choices (`restaurant_sites.config`). It is sanitised on every save and on every read.
- The public page is rendered by one fixed server-side template. Every value is HTML-escaped, colours come from a fixed table, there is no script on the page, and the response carries a strict Content-Security-Policy. The AI cannot add HTML, links, images or code.
- The menu on the page is the restaurant's live active menu. The **Order online** button opens `/menu.html?restaurant=<slug>`.
- **Preview draft** uses `POST /api/restaurants/:id/site/preview`, authenticates the restaurant admin, renders only that restaurant's active menu, returns a strict CSP and never writes to the database.
- **Write with AI** returns an **unsaved draft**, not a live edit. The owner must review it and explicitly Save. Browser auto-refresh must not overwrite unsaved changes. Saving while already published updates the live website; the dashboard tells the owner this.
- Saving never changes the published flag. Publishing still requires the owner to select Publish, and unpublishing does not save unsaved changes.
- Switching restaurants clears the builder form, and an AI draft, save or publish that finishes after a switch is never applied to the other restaurant's form.
- If Publish is refused (for example no active Website Builder plan), the owner is told the draft was saved but is not live.
- Existing published sites without a `template` property stay on the original **Classic Dark** design. No migration or automatic retheming.

## Publishing rule
Publishing needs an **active plan order that includes Website Builder** (the platform owner confirms payment in the super admin screen). Unpublishing is always allowed. For a pilot, set `SITE_PUBLISH_FREE=1` to let any restaurant admin publish. The platform owner can always publish.

## Settings
- `OPENAI_API_KEY` (same key as WhatsApp AI). Without it, generation saves a basic default draft and says so.
- `SITE_AI_MODEL` (default `gpt-4o-mini`).
- `SITE_PUBLISH_FREE=1` (optional, pilots only).
- Generation is limited to 10 per hour per visitor IP.

## Still requires integration / separate rollout
- A production `OPENAI_API_KEY` secret with suitable permissions and quota; without it, the builder visibly falls back to manual editing rather than claiming that AI succeeded.
- Real-provider smoke test on an authorized test restaurant and monitoring of AI API failures.
- Custom domain DNS verification, multilingual editor, website analytics and AI menu import from external URLs/PDF/photos are not included in this safe UI/template rollout.

## Photos (logo, cover, gallery, dish photos)
- Owners upload JPG, PNG or WebP. The browser fixes rotation, removes camera metadata and resizes before upload (logo 512 px square, cover 2000 px, dishes and gallery 1400 px).
- `POST /api/restaurants/:id/media?kind=menu|logo|cover|gallery` (restaurant admin only, 5 MB, format checked by file signature, 60 uploads / 10 min per IP). Limits: 400 images and 250 MB per restaurant.
- Images are stored in MariaDB table `restaurant_media` (created automatically on first use; additive only) and served at `/media/<id>-<token>.<ext>` with a one-year immutable cache and a sandbox CSP.
- Website config accepts only uploaded `/media/…` paths for `logo`, `cover` and up to 8 `gallery` photos. Menu items accept an uploaded path or an HTTPS URL.

## Website languages
Owners pick English, Urdu (اردو, right-to-left), Roman Urdu or Arabic (right-to-left). Buttons and headings on the public page switch to that language, the page gets the right `lang`/`dir`, and **Write with AI** writes the headline, tagline and about text in it. Existing sites without a language stay English.

## Website analytics
`restaurant_site_daily` (auto-created) counts page views of `/r/<slug>` and menu opens (`/api/public/restaurants/<slug>/menu`) per day. No cookies, IPs or user agents are stored; bots, link previews (WhatsApp, Facebook…) and HEAD requests are skipped. Owners see the last 30 days in AI Website, next to orders from all channels.

## Custom domains
Automatic when the Hostinger API is configured (env on the Node.js app: `HOSTINGER_API_TOKEN`, `HOSTINGER_USERNAME`, optional `HOSTINGER_WEBSITE_DOMAIN` (default `mar-khoor.com`) and `HOSTINGER_SERVER_IP`). A background job advances every domain every 3 minutes:
1. **Ownership** – domains outside the platform's Hostinger account must prove ownership: the owner adds the TXT record Hostinger returns. Domains in the platform account skip this step.
2. **Hosting** – the domain is parked on the mar-khoor.com website (the platform owner's hosting), so no separate hosting is needed.
3. **DNS** – for domains whose DNS is at Hostinger in the platform account, missing `@` A and `www` CNAME records are added with `overwrite:false` (email/MX/TXT records are never touched). For other domains the owner sees the exact records to add at their DNS provider.
4. **SSL** – requested once DNS points at Hostinger, then polled; a failed request is retried after 24 h. Routing starts as soon as DNS is right; the domain shows *connected* when SSL is active.
Owners can also search a new domain and send a purchase request. Buying spends real money from the platform's Hostinger account, so only the super admin can approve it (Super admin → Custom domains → Domain purchase requests). Without the Hostinger env vars the older manual flow is used (TXT `_mar-khoor.<domain>` check, then **Mark connected** in super admin). Optional env: `PRIMARY_HOSTS` (comma-separated extra platform hostnames).

## Widget for an existing website
Owners who already have a website turn on AI Website → **Use Mar-Khoor on your own website** and paste one line before `</body>`:
`<script src="https://mar-khoor.com/embed.js" data-restaurant="<slug>" async></script>`
- Buttons: AI Assistant chat (same assistant, ordering and tracking as the Mar-Khoor website), WhatsApp (`wa.me` link) and AI Caller (`tel:` link to the AI Caller number). Numbers default to the ones connected in setup.
- The widget lives in a Shadow DOM, so it cannot break the owner's styles. The chat runs in an iframe from mar-khoor.com; only `/embed/<slug>/chat` may be framed, and only by the website addresses the owner lists (any https site if none).
- Works without publishing a Mar-Khoor website. The AI Assistant still follows the plan's assistant entitlement.
- Settings are stored in `restaurant_widget` (created automatically; additive).

## AI menu import
Menu & items → Import menu with AI: photo (JPG/PNG/WebP), PDF (≤ 8 MB), a link to an existing menu page, or pasted text. The AI (`MENU_IMPORT_MODEL`, default `gpt-4.1-mini`, needs `OPENAI_API_KEY`) returns a draft; nothing is saved until the owner reviews it and presses **Add**. Links are fetched with SSRF protection (public addresses only, redirects re-checked, 2 MB / 10 s limits). 15 imports per hour per IP.
