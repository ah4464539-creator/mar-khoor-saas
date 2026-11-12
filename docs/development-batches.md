# Mar-Khoor development batches

Work through these batches without requiring a separate user "next" for each small commit. Mark complete only after evidence from tests and provider/live checks.

| Batch | Scope | Acceptance |
|---|---|---|
| 1 | MariaDB, API, auth, tenant isolation, schema and CI fixes | Tests pass; tenant access checked |
| 2 | Vapi menu + order tool, call lifecycle, multilingual voice, WhatsApp | Verified provider contract and live sandbox call |
| 3 | Super admin tenant, plans, integrations and usage | Owner-only authorization tested |
| 4 | Restaurant menus, offers, staff, order management and analytics | Tenant workflows tested |
| 5 | Customer ordering, confirmation and order tracking | Checkout and order status verified |
| 6 | Responsive UI/UX, accessibility, mobile polish | Visual and keyboard review |
| 7 | Security, rate limits, audit, backups and observability | Security review and integration tests |
| 8 | Hostinger-compatible deployment, environment secrets, staging and production smoke checks | HTTPS deployment and live verification |

## Current evidence
- Core Express/MariaDB application, dashboards, voice order endpoints and Vapi-style adapter are committed.
- CI workflow exists, but its latest run status has not been confirmed here.
- Real Vapi, WhatsApp and phone calls have **not** been verified.
- No production deployment or payment integration has been confirmed.
- Never commit API secrets. Do not claim a feature is live based solely on a successful push.

## Execution protocol
1. Inspect existing code and current test results where available.
2. Complete several related fixes and tests per batch; commit with descriptive messages.
3. Verify via CI and/or local tests. Record blockers transparently.
4. Continue to the next independent task within the same request rather than stopping after each commit.
5. Ask the user only for essential external credentials, provider approval, or deployment choices.
