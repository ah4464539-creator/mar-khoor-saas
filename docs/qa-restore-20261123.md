# Mar-Khoor — Four-business QA state and restore checklist

Recorded: 2026-11-23
Repository: `ah4464539-creator/mar-khoor-saas`
Production: `https://mar-khoor.com`
This file is a **non-secret change log and restoration runbook**, not an environment or database backup.

## Owner's explicit requirements

- Four demo businesses will be tested using **real telephone calls made by the owner**, and WhatsApp messages as appropriate.
- **Do not buy, provision, reserve or stock any new telephone number.** Test with an already-owned, verified number, and later trial carrier call-forwarding only after checking current mapping, destination, fees, consent and an immediate revert method.
- **All services temporarily turned off for QA must be brought back into their intended normal operating state after tests**, when the owner approves. Do not confuse an environment **enable flag** with a secret API key: existing keys should be preserved; never copy them into this file or chat, revoke or rotate them to toggle services.
- Before every future change, note pre-change values of **non-secret flags** and how to undo it. The prior values of some settings were **not recorded** and must not be invented.
- Keep real businesses, existing restaurant/Meta mappings, production customer data and unrelated projects unchanged.

## Temporary feature settings and restoration

| Setting / integration | Known QA setting | Later restoration |
|---|---|---|
| `STRIPE_BILLING_ENABLED` | Set `0` in Hostinger environment | Later review Stripe test/live mode, provider keys, signed webhooks, products/prices and billing flows; only then restore the intended ON value with owner approval. The exact pre-QA value was not captured. |
| `STRIPE_CHECKOUT_ENABLED` | Set `0` in Hostinger environment | Reconfirm if current code uses this switch before turning it on; do not assume it alone gates payment processing. |
| `VOICE_AUTOPROVISION_ENABLED` | Default OFF unless exactly `1` | **Keep OFF throughout the planned real-number/call-forwarding tests.** Enable only if the owner later explicitly authorizes buying numbers; never turn it on merely to restore calling via an existing number. |
| `REGISTRATION_VOICE_POOL_ENABLED` | Previously requested OFF; current production value **not verified in this batch** | Verify OFF before new test registration. Do not authorize stock/purchase of numbers without owner approval. |
| WhatsApp AI worker `WHATSAPP_AI_WORKER_ENABLED` | Observed `0` on earlier audit; later value not reverified | Preserve real tenant mappings. When the owner wants it running, verify worker/scheduler state, test number and delivery before setting the intended value. |
| Provider API keys and tokens | No keys intentionally disabled, deleted, rotated or posted during four-business QA | Revalidate securely in Hostinger/Meta/Vapi/Telnyx; do not print values. Enabled flags alone do not prove valid keys or working integrations. |
| Other real website features | Existing Contact Us, AI help and email autoresponder kept | Do not undo unrelated fixes. |

**Restore procedure:** Take verified Hostinger env and DB backups first; review currently deployed commit and provider configuration; decide which features actually need re-enabling; change one feature at a time; redeploy/restart if required; test **real** provider outcomes (charge/refund, call/forward, WhatsApp delivered, etc.); log final flags and rollback point. **Never blindly set every flag to 1**, since purchase automation and live billing can incur costs or affect real tenants.

## Four test businesses

These demo entries were recorded in the existing production MariaDB with zero-price Premium QA entitlements under the existing Super Admin. They are **not** independently registered owner accounts or evidence of four completed provider connections.

| ID | Business / category | QA slug | Sample inventory |
|---|---|---|---|
| 19 | Mar-Khoor QA Bistro / restaurant | `mkqa-bistro-20261123` | Burger €9.90, other items, one demo table |
| 20 | Mar-Khoor QA Clinic / clinic | `mkqa-clinic-20261123` | Consultation €40, dental €65, Dr Demo |
| 21 | Mar-Khoor QA Salon / salon | `mkqa-salon-20261123` | Haircut €20, styling €35, Demo Stylist |
| 22 | Mar-Khoor QA Hotel / hotel | `mkqa-hotel-20261123` | Double room €85/night, family suite €140/night, QA rooms |

All four published sites have category-specific services and AI assistants. The software tools were marked active but **WhatsApp phone mappings and AI Caller routing were left pending**; do not describe them as live-connected. Do not share a personal phone number across tenant mappings without approval. The sample businesses are not real public businesses and must not receive real customer bookings.

## Changes made in GitHub

- PR #161: `https://github.com/ah4464539-creator/mar-khoor-saas/pull/161`, merged `51bebfae578a8709ba6f3dd13e19326f750f6c4d`. Phone-number auto-purchase now requires explicit `VOICE_AUTOPROVISION_ENABLED=1`; guard covers retries.
- PR #162: `https://github.com/ah4464539-creator/mar-khoor-saas/pull/162`, merged `a0c9129bea5c7ef5933292918e1555e65b79d089`. Fixed clinic/salon/hotel storefront empty food menus and grounded their AI chat in own services/room rates.
- CI passed; real production OpenAI **text** replies successfully answered verified sample prices for all four business types.
- Availability endpoints returned actual sample slots for 2026-11-24 and two hotel rooms for 2026-11-24–25.
- **Not yet passed in this round:** real telephone AI calling, forward to staff, Meta WhatsApp send/receive on each demo tenant, actual booking submitted and visible in admin, payments/Stripe. An attempted automated booking submission was blocked and must not be reported as successful.

## Real call / WhatsApp testing protocol — owner will place calls

1. **Before calling:** confirm the currently owned number and its provider, which test tenant is mapped, Vapi assistant ID, WhatsApp Business Phone Number ID, and no accidental production restaurant mapping. Verify call minutes/fees, consent and recording notice. Do not show phone numbers, API tokens or secret mappings in public logs.
2. **One tenant at a time:** Bistro, Clinic, Salon, Hotel. Owner personally places the test call. Confirm greeting uses correct business name and language; asks relevant restaurant order, clinic appointment, salon appointment, or hotel room enquiry. Confirm no data leakage from any other tenant and that prices/services match QA records.
3. **Actions:** test a handoff to real staff only to an authorized forwarding destination and with consent. If enabling carrier forwarding on an existing number, note existing settings, activate temporarily, call both AI and destination, and immediately restore the original route on test completion/failure.
4. **WhatsApp:** owner sends to a verified existing Meta number. Confirm incoming message, correct tenant-specific AI reply, provider delivery status, confirmations, retry and duplicate handling. **Never attach an existing real customer business number to another tenant without a reversible documented mapping.**
5. **Result log per test:** local time, QA tenant ID, channel (phone/WhatsApp), test scenario, expected behavior, actual result, usage/cost, call/booking/order ID if safe, PASS/FAIL, incident, rollback action.
6. **After each phase:** restore temporary provider routing and worker state, check live business endpoints, and later re-enable any deliberately disabled business features as individually approved. Preserve this runbook so the exact same test setup can be repeated.

## Repeat QA later versus restore normal operation

- **Repeat:** retain QA tenants 19–22, Premium zero-price entries, no purchases, no payment collection, and existing website/AI fixes. Recheck user-created data and number routes first.
- **Restore normal operation:** backup first; review Stripe and other enable switches; return desired features to service one at a time; unpublish QA demo sites or deactivate demo entitlements only after explicit approval (do not delete them by default). Keep PR #162 bug fixes.
- This runbook does not guarantee an exact historical rollback because the **original env flag values were not all captured**, and it contains **no** secrets or DB snapshot.

## Change log

| Date | Change / verification |
|---|---|
| 2026-11-23 | Stripe billing and checkout flags set to `0`; Hostinger app redeployed. |
| 2026-11-23 | Default-OFF number-purchase safety via PR #161; CI/deployment checked. |
| 2026-11-23 | Four QA Premium tenants, published sites, menus/services/room fixtures created. No separate test owner credentials or numbers purchased. |
| 2026-11-23 | PR #162 fixed business storefronts and AI; CI and real text reply testing passed. |
| 2026-11-23 | Owner confirmed they will personally place **all real calls** and wants temporarily disabled features/keys reviewed and re-enabled later. |
