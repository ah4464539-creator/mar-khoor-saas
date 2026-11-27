# AI Caller on the business's own number (any country)

A business keeps its existing number. Nothing is bought from Telnyx and there is no monthly number fee.

This is the only way to get AI calling while new numbers are not sold (`VOICE_AUTOPROVISION_ENABLED` unset, the default): plans show "AI answers calls on your own number", the single-tool cart and the setup box have no "new number" option, and the server refuses any request for one (`src/number-sales.js`). Setting `VOICE_AUTOPROVISION_ENABLED=1` brings number sales back (the setup box option `new` would then need to be added back to `public/restaurant.html`). The AI answers calls on the business's own line through the internet (SIP).

## How it works
1. Owner: Dashboard → **AI receptionist** → **Use your own number** → enter the number with its country code and choose how it is connected:
   - **Spare SIM in a GSM gateway**: the SIM sits in a small 1-port GSM gateway (e.g. GoIP, Dinstar, Yeastar) connected to the internet.
   - **Landline through a phone adapter**: the landline cable goes into an FXO adapter (e.g. Grandstream HT813) connected to the internet.
   - **Office phone system or VoIP number**: a PBX or VoIP provider (FreePBX/Asterisk, 3CX, RingCentral, Zadarma, Twilio…) adds a SIP trunk. **No device needed.**
2. Mar-Khoor creates the business's AI assistant if it has none (copy of `VAPI_TEMPLATE_ASSISTANT_ID`). Then it creates a **free SIP address on Vapi** (`provider: "vapi"`) bound to that assistant, always protected by its own 20–40 character username and password (digest auth).
3. The card shows the device settings with Copy buttons: SIP server `sip.vapi.ai`, port 5060 (UDP/TCP) or 5061 (TLS), username, password, and the SIP destination. It also shows short steps per device type.
4. The owner sets up the device and calls the number from another phone. The first call that reaches the AI marks the line **Connected ✓** (matched on the Vapi `phoneNumberId` of the call).
5. Other numbers, like a personal mobile, can forward to the business line with one-tap codes:
   - `**21*` all calls, `**67*` busy, `**61*` no answer, `**62*` unreachable, `##21#` off. These are standard GSM codes that work in most countries.
   - Some US carriers use `*72`, which is also shown.

Changing the number or type keeps the same SIP address and password, so a configured device keeps working. **New password** rotates the device password (update the device afterwards). **Disconnect** deletes the SIP address on Vapi.

## Why a device is needed for a SIM or landline
A normal SIM or landline lives on the phone company's network and cannot be connected to an internet AI by software alone. Mobile operators also offer no API to switch call forwarding on remotely, so forwarding codes have to be dialled from that phone. A one-time gateway or adapter bridges the line to the internet. Office phone systems and VoIP numbers are already on the internet and need no device.

## API (restaurant admin)
- `GET /api/restaurants/:id/own-line` returns `{ available, missing, line_types, line }`.
- `PUT /api/restaurants/:id/own-line` with `{ phone_number: "+971501234567", line_type: "sim" | "landline" | "pbx" }`.
- `POST /api/restaurants/:id/own-line/reset-password`
- `DELETE /api/restaurants/:id/own-line`

## Data and security
- Table `restaurant_own_lines` (migration `db/migrations/2026-11-27-own-line.sql`, also created on first use).
- The device password is stored encrypted (AES-256-GCM, key from `DATA_ENCRYPTION_KEY` or `META_APP_SECRET`). It is shown only to the business's admins, because they must type it into their device. Every change is audited.
- Calls are tied to the business by the assistant mapping, like every other AI call. Usage limits (call minutes) apply.

## Server settings
`VAPI_API_KEY`, `VAPI_TEMPLATE_ASSISTANT_ID`, and `DATA_ENCRYPTION_KEY` or `META_APP_SECRET`. All three are already set on production.

## Verified
- The Vapi request was validated against the live API: a temporary SIP address was created (status `active`, authentication set) and deleted again.
- A real call through a GSM gateway, FXO adapter or PBX still needs one live test with real hardware.
