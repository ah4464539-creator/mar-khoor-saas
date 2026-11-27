// One switch for selling new phone numbers (Telnyx) to businesses.
//
// Off by default: every business uses its own number for AI calling (spare SIM, landline or office
// phone system, see src/own-line.js), so no number is bought and nobody pays a number fee.
// While it is off, plans show no number add-on, the single-tool cart has no "new number" option,
// setup cannot ask for one, and neither automatic nor super-admin purchases run.
// Set VOICE_AUTOPROVISION_ENABLED=1 to sell numbers again (the same flag the automatic purchase uses).
export function numberSalesEnabled(env = process.env) {
  return env.VOICE_AUTOPROVISION_ENABLED === '1';
}

export const NUMBER_SALES_OFF_MESSAGE = 'New numbers are not sold right now. Connect your own number (a spare SIM, a landline or your office phone system) for AI calling.';
