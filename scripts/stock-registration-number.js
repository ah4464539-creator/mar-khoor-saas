import 'dotenv/config';
import mysql from 'mysql2/promise';

const [country, phoneId] = process.argv.slice(2);
if (!/^[A-Z]{2}$/.test(country ?? '') || !/^[a-zA-Z0-9_-]{1,64}$/.test(phoneId ?? '')) {
  throw Error('Usage: node scripts/stock-registration-number.js <country-code> <Vapi phone number ID>');
}
for (const name of ['DB_NAME', 'DB_USER', 'VAPI_API_KEY']) {
  if (!process.env[name]) throw Error('Missing ' + name);
}
const response = await fetch('https://api.vapi.ai/phone-number/' + encodeURIComponent(phoneId), {
  headers: { Authorization: 'Bearer ' + process.env.VAPI_API_KEY },
  redirect: 'error',
  signal: AbortSignal.timeout(10000),
});
if (!response.ok) throw Error('Vapi number lookup failed: HTTP ' + response.status);
const { number, assistantId, squadId, workflowId, status } = await response.json();
if (!/^\+[1-9]\d{6,14}$/.test(number ?? '') || !/^[a-zA-Z0-9_-]{1,128}$/.test(assistantId ?? '')
  || squadId || workflowId || (status && status !== 'active')) {
  throw Error('Use a ready inbound phone number attached to one dedicated assistant.');
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
try {
  const [result] = await connection.execute(
    'INSERT INTO registration_voice_inventory(country_code,phone_number,vapi_phone_id,assistant_id) '
    + 'SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM voice_assistants WHERE assistant_id=?) '
    + 'AND NOT EXISTS (SELECT 1 FROM restaurant_numbers WHERE phone_number=? OR vapi_phone_id=?)',
    [country, number, phoneId, assistantId, assistantId, number, phoneId]
  );
  if (!result.affectedRows) throw Error('Number or assistant is already in use.');
  console.log('Added one registration number to the ' + country + ' pool.');
} finally {
  await connection.end();
}
