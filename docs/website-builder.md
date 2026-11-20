# AI website builder

Each restaurant can have a public page at `https://mar-khoor.com/r/<restaurant-slug>`.

**Status: tenant-scoped website storage, preview, four safe template presets and AI-generated draft are implemented. Live AI generation still requires an authorized OpenAI API key and end-to-end verification.**

## How it works
- The restaurant admin opens **My website** in the dashboard, describes the restaurant in a sentence or two and chooses **Classic Dark, Warm Bistro, Clean Editorial or Midnight Modern** before pressing **Write with AI**. The AI only returns a headline, tagline, about text, a colour theme and which sections to show. It is told to use only the facts it was given. Hours, phone and address are never taken from the AI; the owner types them.
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
- Custom domain DNS verification, image/logo uploads, multilingual editor, website analytics and AI menu import from external URLs/PDF/photos are not included in this safe UI/template rollout.
