# AI website builder

Each restaurant can have a public page at `https://mar-khoor.com/r/<restaurant-slug>`.

**Status: built and unit-tested; not yet tried against the live database or the live OpenAI API.**

## How it works
- The restaurant admin opens **My website** in the dashboard, describes the restaurant in a sentence or two and presses **Write with AI**. The AI only returns a headline, tagline, about text, a colour theme and which sections to show. It is told to use only the facts it was given. Hours, phone and address are never taken from the AI; the owner types them.
- Everything is stored as a small JSON config of plain text and fixed choices (`restaurant_sites.config`). It is sanitised on every save and on every read.
- The public page is rendered by one fixed server-side template. Every value is HTML-escaped, colours come from a fixed table, there is no script on the page, and the response carries a strict Content-Security-Policy. The AI cannot add HTML, links, images or code.
- The menu on the page is the restaurant's live active menu. The **Order online** button opens `/menu.html?restaurant=<slug>`.
- Saving never changes the published flag.

## Publishing rule
Publishing needs an **active plan order that includes Website Builder** (the platform owner confirms payment in the super admin screen). Unpublishing is always allowed. For a pilot, set `SITE_PUBLISH_FREE=1` to let any restaurant admin publish. The platform owner can always publish.

## Settings
- `OPENAI_API_KEY` (same key as WhatsApp AI). Without it, generation saves a basic default draft and says so.
- `SITE_AI_MODEL` (default `gpt-4o-mini`).
- `SITE_PUBLISH_FREE=1` (optional, pilots only).
- Generation is limited to 10 per hour per visitor IP.

## Not built yet
Custom domains, photos/logo upload, multiple languages, page analytics.
