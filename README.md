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

This is an initial API foundation, not yet a deployed or production-ready SaaS. Payment, Vapi, WhatsApp and telephony integrations are not yet implemented.
