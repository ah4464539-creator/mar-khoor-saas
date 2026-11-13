# Mar-Khoor SaaS

Multi-restaurant AI ordering platform. Initial backend foundation uses MariaDB (no Supabase).

## Roles
- Platform super admin: controls tenants, plans, usage and integrations.
- Restaurant admin: manages own restaurant, menu, offers and orders.
- Customer: browses restaurant menu and places orders.

## Setup
1. Install Node.js 20+ and MariaDB.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and fill in your own MariaDB credentials.
4. Run `npm run dev`.
5. Visit `http://localhost:3001/health`.

This is an initial API foundation, not yet a deployed or production-ready SaaS. Payments are deferred. Vapi and WhatsApp integration foundations and a WhatsApp AI worker exist, but live provider setup and end-to-end verification are pending. The Vapi webhook still acknowledges events without processing them. See [Hostinger deployment guide](docs/hostinger-deployment.md) and [WhatsApp AI staging](docs/whatsapp-ai-staging.md).

### Restaurant AI ordering and staff transfer

Assign each restaurant its own inbound Vapi phone number with a provider that supports transfers in that market. Attach the restaurant's active mapped assistant to the number in Vapi. In Super Admin, save the public ordering number, then save the Vapi phone number ID and the private staff destination under **AI call transfer**.

On that Vapi assistant, enable `keypadInputPlan` with `enabled: true` and `delimiters: [""]` for single-key input. Add the `transferCall` tool with no stored destinations or number parameters. Include `transfer-destination-request` in the assistant's existing server messages and route it to `/integrations/vapi/transfer` with the existing authenticated server credential. Preserve the existing menu and order tool URLs and other event handling when wiring the transfer event.

Tell the assistant to announce the staff option in the restaurant's language. When the caller asks for the owner or staff, say “Press 0 to speak to staff.” When Vapi supplies the keypad entry `0`, invoke the transfer tool without a destination. For a refusal, explain that staff transfer is unavailable and offer to continue taking the order. The server checks both the active assistant and the inbound provider line before returning the staff destination.

Before publishing a new ordering number, apply the additive schema on staging and test with an actual phone call. Verify that pressing 0 makes the configured staff phone ring and that the staff member can answer. Verify that normal ordering still reaches the same restaurant.

### Regional line assignment on paid restaurant login

With `REGIONAL_VOICE_ONBOARDING=true`, a restaurant admin's login assigns an available activated line for the restaurant's country. The assignment is atomic across the line inventory, public number and assistant mapping. Existing public numbers are preserved. If the country inventory is empty, login returns `awaiting_local_number`; subsequent logins can retry after inventory is replenished.

The billing integration must maintain `restaurant_paid_voice_access` from verified payment and subscription events. The regional telephony integration must stock `regional_voice_lines` with activated numbers, each already connected to its own Vapi assistant configured with the `get_menu` and `place_order` tools. Instruct assistants to fetch the current menu and restaurant locale before discussing items, and to use the returned item IDs and confirm orders before submission. MariaDB supplies active items and current prices at request time, and order submission validates them again.

Super admins can register a dedicated line in **Regional AI number inventory** using the country code and Vapi phone number ID. The server uses `VAPI_PRIVATE_KEY` to verify the active Vapi line and its assistant before adding it to inventory. Enter the country verified by the phone provider. Register only unused assistants configured for the live menu and order tools.

### WhatsApp chatbot ordering

Map the Meta phone number ID to the restaurant in Super Admin and enable WhatsApp AI in that restaurant's dashboard. The worker reads the latest active menu from MariaDB. When a customer wants to order, the chatbot includes the restaurant's storefront link, where the customer reviews and submits their order. Set `WHATSAPP_STOREFRONT_URL` to the staging HTTPS origin for staging tests. Use `npm run whatsapp-ai:once` to process queued messages in a test run. Schedule the worker on the deployment for ongoing replies.

### Website chatbot

Set `WEB_CHAT_ENABLED=true` and `OPENAI_API_KEY` on the server. The chatbot appears on each restaurant's ordering page after its menu loads. Website and WhatsApp share the restaurant-scoped reply logic. Chat replies can direct customers to the ordering form, where they submit their orders.
