# Local setup and verification

1. Create an empty MariaDB database: `CREATE DATABASE markhoor_saas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
2. Grant a dedicated application DB user permissions on that database. Never commit credentials.
3. Copy `.env.example` to `.env` and set `DB_USER`, `DB_PASSWORD`, and `DB_NAME`.
4. Run `npm install`, `npm run migrate`, `npm test`.
5. Create platform owner with `npm run create-super-admin -- owner@example.com YOUR_STRONG_PASSWORD`.
6. Create a restaurant with `npm run onboard -- admin@example.com YOUR_STRONG_PASSWORD "Example Cafe" example-cafe PK PKR en`.
7. Run `npm run dev`, open `http://localhost:3001` and visit the platform, restaurant and customer pages.

## Integration note
`/integrations/webhooks/vapi` stores Vapi call lifecycle events (`status-update`, `end-of-call-report`) behind a shared secret. It does not yet verify a Vapi HMAC signature and has not been tested against a live call. See [Vapi integration status](vapi-integration.md).

## Security note
The login sessions are currently in-memory. Production requires durable session storage, HTTPS, CSRF/cookie strategy if switching to cookies, rate limiting, operational logging, and authorization tests.
