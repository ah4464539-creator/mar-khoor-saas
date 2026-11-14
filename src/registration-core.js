// Restaurant self-registration: validation and the transactional insert.
// No express import here, so it can be tested with a mock pool.

const RESERVED = new Set(['admin', 'api', 'auth', 'r', 'public', 'health', 'integrations', 'voice-tools', 'login', 'register', 'super-admin', 'menu', 'restaurant', 'build-plan', 'www']);
const EUR = new Set('AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK'.split(' '));
const CURRENCIES = { PK: 'PKR', AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR', GB: 'GBP', US: 'USD', IN: 'INR', BD: 'BDT', MY: 'MYR', SG: 'SGD', TR: 'TRY', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', EG: 'EGP', JO: 'JOD', LK: 'LKR', ID: 'IDR', TH: 'THB', PH: 'PHP', CA: 'CAD', AU: 'AUD' };

export const defaultCurrency = country => EUR.has(country) ? 'EUR' : CURRENCIES[country] ?? 'USD';

export function slugify(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

// Returns { value } or { error }.
export function validateRegistration(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid registration' };
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'Enter a valid email address' };
  const { password } = body;
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) return { error: 'Password must be at least 12 characters' };
  const name = typeof body.restaurant_name === 'string' ? body.restaurant_name.trim() : '';
  if (!name || name.length > 160) return { error: 'Enter the restaurant name' };
  const country = typeof body.country === 'string' ? body.country.trim().toUpperCase() : '';
  if (!/^[A-Z]{2}$/.test(country)) return { error: 'Select the restaurant country' };
  const slug = body.slug === undefined || body.slug === '' ? slugify(name) : body.slug;
  if (typeof slug !== 'string' || slug.length < 2 || slug.length > 60 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return { error: 'Choose a web address using letters, numbers and dashes' };
  if (RESERVED.has(slug)) return { error: 'That web address is reserved; choose another' };
  const currency = body.currency === undefined ? defaultCurrency(country) : body.currency;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return { error: 'Invalid currency' };
  return { value: { email, password, name, slug, country, currency, locale: 'en' } };
}

export async function registerRestaurant(pool, body, hashPassword) {
  const parsed = validateRegistration(body);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  const { email, password, name, slug, country, currency, locale } = parsed.value;
  const passwordHash = await hashPassword(password);
  let connection;
  let step = 'user';
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [user] = await connection.execute('INSERT INTO users(email,password_hash) VALUES (?,?)', [email, passwordHash]);
    step = 'restaurant';
    const [restaurant] = await connection.execute('INSERT INTO restaurants(name,slug,country_code,currency,locale) VALUES (?,?,?,?,?)', [name, slug, country, currency, locale]);
    step = 'member';
    await connection.execute("INSERT INTO restaurant_members(restaurant_id,user_id,role) VALUES (?,?,'admin')", [restaurant.insertId, user.insertId]);
    await connection.commit();
    return { status: 201, body: { restaurant_id: restaurant.insertId, slug, country, currency } };
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (error?.code === 'ER_DUP_ENTRY' && step === 'user') return { status: 409, body: { error: 'This email is already registered' } };
    if (error?.code === 'ER_DUP_ENTRY' && step === 'restaurant') return { status: 409, body: { error: 'That web address is taken; choose another' } };
    return { status: 503, body: { error: 'Registration unavailable' } };
  } finally {
    connection?.release();
  }
}
