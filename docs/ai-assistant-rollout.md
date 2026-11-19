# AI Assistant rollout — Mar-Khoor

Status: design proposal only. This PR does not enable AI chat, modify production settings, or deploy code.

## Surfaces and scope
1. Public website: anonymous FAQ assistant answering published pricing, product capabilities, and registration questions. No tenant or account data; no privileged actions. Explicitly distinguish staged voice calling from live features.
2. Restaurant dashboard: authenticated, tenant-scoped assistant for onboarding, menu guidance, order explanations, WhatsApp setup and analytics. Read-only initial release; no order edits or messaging sends.
3. Platform Super Admin: authenticated platform-role-only assistant for aggregate operational insights and onboarding guidance. Sensitive cross-tenant information must require existing privileged authorization; no raw credentials or tokens.

## Architecture
- Shared accessible chat drawer UI (launcher, messages, loading, error, keyboard and mobile behavior) with separate context per surface.
- Backend POST /api/assistant/chat (final route subject to existing server conventions), accepting message and bounded conversation history. Server derives role, user and tenant identity from verified session, never from client-provided role/tenant fields.
- Explicit allowlisted tools: public knowledge retrieval; tenant-scoped menu/order summaries; privileged aggregate analytics. No arbitrary SQL, filesystem or web browsing.
- Server-side model API credential only. Input size limits, output escaping, rate limits, abuse handling, timeouts and minimal redacted audit logs.
- Reject unauthenticated private requests (401), unauthorized role access (403), and tenant cross-access. No prompts or client messages can override permission checks.
- Keep REGISTRATION_VOICE_POOL_ENABLED disabled; no phone-number purchases or provisioning.

## Incremental PR sequence
- PR A: shared UI component + public assistant backed by published knowledge; feature flag default OFF.
- PR B: authenticated restaurant assistant + server-enforced tenant isolation and read-only tool calls.
- PR C: Super Admin assistant + role authorization, safe aggregate data access and audit events.
- PR D: staged rollout, monitoring, rate-limit/error checks, production verification; flags enabled only after approval and tests.

## Acceptance tests
- Desktop 1440px and mobile 375px; accessible focus, escape-to-close, visible errors and responsive layout.
- Public visitor cannot access tenant data; restaurant A cannot query restaurant B; ordinary restaurant admin cannot access Super Admin operations.
- Session expiry and tampered tenant/role values are rejected; prompt-injection attempts cannot bypass tool authorization.
- No API keys in HTML, JS, logs, or commits. No model invocation without configured server-side credentials.
- Existing registration, order submission and WhatsApp workflows unchanged; feature flags default OFF.
- Verify real backend responses in staging before production rollout; do not present static UI as a working AI assistant.

## Open integration decisions
Confirm existing Node.js API route conventions, session middleware, tenant identifiers, model provider/credentials, knowledge source, budget/rate limits and hosting environment before implementation.
