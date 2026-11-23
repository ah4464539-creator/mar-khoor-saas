# Personal SIM AI calling staging gate (Vodafone Greece)

Status: **NOT CONNECTED**. This document contains no personal phone number, secrets, or production credentials.

## Architecture / prerequisites
- The user's existing mobile SIM remains with their carrier. A Vapi assistant ID is not a PSTN forwarding destination.
- Confirm with Vodafone Greece whether unconditional or conditional call forwarding can target the selected **real E.164 inbound PSTN number**; forwarding to an arbitrary SIP URI may not be supported.
- Confirm whether the existing Vapi/telephony account has a callable destination that can legally receive forwarded calls. **Do not buy or reserve a new number** without explicit approval.
- A caller's personal calls may also be forwarded; obtain explicit consent for scope, charges, and an emergency stop procedure.
- Route only one staging test business at a time, with an explicit active-business selection. No automatic production tenant mapping.
- Verify carrier deactivation codes and service state with Vodafone documentation or support before enabling forwarding. Never guess USSD codes.

## Staging safety gate
1. Separate staging Node.js app, staging MariaDB credentials and database; verify no production DB hostname/DB name or shared mutation keys.
2. Super Admin-only test control with server-side authorization and audit; never expose personal number or provider secrets in frontend or git.
3. Provider-verified Vapi event authenticity and tenant mapping; validate call IDs server-side.
4. Verify live voice conversation, explicit order confirmation, tenant menu isolation, and recording default OFF with caller consent.
5. Verify restaurant open/closed status at the *final transactional order write*, consistently across voice, WhatsApp and web checkout.
6. Demonstrate call transfer, forwarding disable, and rollback. Check inbound calls reach normal mobile service again.
7. Perform a consented real test call. Never place a test order against production.

## Release gate
Only after staging health, isolation, and end-to-end call verification pass, review a production deployment separately. Do not merge this draft PR into production merely because unit tests pass.
