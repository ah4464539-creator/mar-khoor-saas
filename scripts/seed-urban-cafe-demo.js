import 'dotenv/config';
import mysql from 'mysql2/promise';

const database = process.env.DB_NAME;
if (!database || database !== process.env.URBAN_CAFE_DEMO_DATABASE ||
    !/(?:stage|staging|sandbox)/i.test(database)) {
  throw new Error('Set URBAN_CAFE_DEMO_DATABASE to the dedicated staging DB_NAME.');
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database,
});
try {
  const [[selected]] = await connection.query('SELECT DATABASE() AS name');
  if (selected.name !== database) throw new Error('Unexpected target database.');
  await connection.beginTransaction();
  await connection.execute(
    'INSERT INTO restaurants(name,slug,country_code,currency,locale) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE slug=slug',
    ['Urban Cafe', 'urban-cafe', 'PK', 'PKR', 'en']
  );
  const [[restaurant]] = await connection.execute(
    'SELECT id,currency FROM restaurants WHERE slug=? FOR UPDATE', ['urban-cafe']
  );
  if (!restaurant || restaurant.currency !== 'PKR') throw new Error('Expected an Urban Cafe record using PKR.');
  const products = [
    ['Demo Cappuccino', 'Espresso and steamed milk.', 42000],
    ['Demo Mocha', 'Espresso with milk and chocolate.', 49000],
    ['Demo Butter Croissant', 'Flaky butter pastry.', 35000],
    ['Demo Grilled Chicken Sandwich', 'Grilled chicken on toasted bread.', 72000],
  ];
  for (const [name, description, price] of products) {
    await connection.execute(
      'INSERT INTO menu_items(restaurant_id,name,description,price_minor) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE restaurant_id=? AND name=?)',
      [restaurant.id, name, description, price, restaurant.id, name]
    );
  }
  const config = {
    headline: 'Urban Cafe',
    tagline: 'Coffee, pastries and light bites',
    about: 'This is a sample storefront. Prices are illustrative and orders are for testing.',
  };
  await connection.execute(
    'INSERT INTO restaurant_sites(restaurant_id,config,published) VALUES (?,?,1) ON DUPLICATE KEY UPDATE published=1',
    [restaurant.id, JSON.stringify(config)]
  );
  await connection.commit();
  console.log('Urban Cafe staging menu seeded at /r/urban-cafe.');
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
