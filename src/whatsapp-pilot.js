// Restaurants the super admin lets use WhatsApp AI without a paid plan (a pilot), stored in the
// additive app_settings table so no environment change is needed.
import { VOICE_SETTINGS_SQL } from './vapi-voice.js';

const KEY = 'whatsapp_ai_pilot';
const clean = list => [...new Set((Array.isArray(list) ? list : []).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 50);

export async function getPilotIds(pool) {
  try {
    const [rows] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key=?', [KEY]);
    return clean(JSON.parse(rows[0]?.setting_value || '[]'));
  } catch { return []; }
}

export async function setPilot(pool, restaurantId, on) {
  await pool.query(VOICE_SETTINGS_SQL);
  const ids = new Set(await getPilotIds(pool));
  if (on) ids.add(restaurantId); else ids.delete(restaurantId);
  const list = clean([...ids]);
  await pool.query('INSERT INTO app_settings (setting_key,setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [KEY, JSON.stringify(list)]);
  // Turning the pilot on also switches the restaurant's AI replies on.
  if (on) await pool.query('INSERT INTO whatsapp_ai_settings(restaurant_id,enabled) VALUES (?,TRUE) ON DUPLICATE KEY UPDATE enabled=TRUE', [restaurantId]);
  return list;
}

// Super-admin on/off switch for WhatsApp AI replies (all restaurants). On unless switched off.
const SWITCH = 'whatsapp_ai_worker';
export async function workerSwitch(pool) {
  try {
    const [rows] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key=?', [SWITCH]);
    return rows[0]?.setting_value === 'off' ? 'off' : 'on';
  } catch { return 'on'; }
}
export async function setWorkerSwitch(pool, on) {
  await pool.query(VOICE_SETTINGS_SQL);
  await pool.query('INSERT INTO app_settings (setting_key,setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [SWITCH, on ? 'on' : 'off']);
  return on ? 'on' : 'off';
}
