import test from 'node:test';
import assert from 'node:assert/strict';
import { restaurantDeletePlan, deleteRestaurant } from '../src/restaurant-delete.js';

const fks = [
  { table: 'restaurant_members', column: 'restaurant_id', refTable: 'restaurants', refColumn: 'id', rule: 'CASCADE' },
  { table: 'orders', column: 'restaurant_id', refTable: 'restaurants', refColumn: 'id', rule: 'RESTRICT' },
  { table: 'order_items', column: 'order_id', refTable: 'orders', refColumn: 'id', rule: 'RESTRICT' },
  { table: 'menu_items', column: 'restaurant_id', refTable: 'restaurants', refColumn: 'id', rule: 'RESTRICT' },
  { table: 'order_items', column: 'menu_item_id', refTable: 'menu_items', refColumn: 'id', rule: 'RESTRICT' },
  { table: 'audit_logs', column: 'restaurant_id', refTable: 'restaurants', refColumn: 'id', rule: 'SET NULL' },
];

test('children are deleted before parents; audit logs are kept', () => {
  const plan = restaurantDeletePlan(fks, ['orders', 'menu_items', 'site_events', 'audit_logs', 'stripe_events'], 5).map(step => step.sql);
  const at = needle => plan.findIndex(sql => sql.startsWith('DELETE FROM `' + needle + '`'));
  assert.ok(at('order_items') < at('orders'));
  assert.ok(at('order_items') < at('menu_items'));
  assert.ok(at('orders') < at('restaurants'));
  assert.ok(at('site_events') >= 0, 'loose restaurant_id tables are cleaned');
  assert.equal(at('audit_logs'), -1);
  assert.equal(at('stripe_events'), -1);
  assert.equal(plan[plan.length - 1], 'DELETE FROM `restaurants` WHERE `id`=?');
  assert.ok(plan.some(sql => sql === 'DELETE FROM `order_items` WHERE `order_id` IN (SELECT `id` FROM `orders` WHERE `restaurant_id` IN (SELECT `id` FROM `restaurants` WHERE `id`=?))'));
});

function mockPool({ slug = 'demo', name = 'Demo Cafe', blocked = false, failAt = null } = {}) {
  const log = [];
  const execute = async (sql, args) => {
    log.push(sql);
    if (/FROM restaurants WHERE id=/.test(sql)) return [[{ id: 5, name, slug }]];
    if (/COUNT\(\*\)/.test(sql) && !/restaurant_members o WHERE o.user_id=u.id/.test(sql)) return [[{ n: 3 }]];
    if (/JOIN users u ON u.id=m.user_id WHERE m.restaurant_id=\? AND u.platform_role/.test(sql) && /SELECT u.email/.test(sql)) return [[{ email: 'demo@x.pk', other: 0 }]];
    if (/restaurant_billing/.test(sql)) return [blocked ? [{ 1: 1 }] : []];
    if (/restaurant_numbers|restaurant_domains/.test(sql)) return [[]];
    if (/SELECT m.user_id/.test(sql)) return [[{ user_id: 9 }]];
    if (failAt && sql.includes(failAt)) throw new Error('fk violation');
    return [{ affectedRows: 1 }];
  };
  const connection = {
    execute, query: async sql => /KEY_COLUMN_USAGE/.test(sql) ? [fks.map(fk => ({ t: fk.table, c: fk.column, rt: fk.refTable, rc: fk.refColumn, rule: fk.rule }))] : [[{ t: 'orders' }]],
    beginTransaction: async () => log.push('BEGIN'), commit: async () => log.push('COMMIT'), rollback: async () => log.push('ROLLBACK'), release: () => {},
  };
  return { log, execute, getConnection: async () => connection };
}

test('delete needs the exact name, refuses protected and paid restaurants, and rolls back on errors', async () => {
  assert.equal((await deleteRestaurant(mockPool(), 5, { confirmName: 'demo cafe' })).status, 400);
  assert.equal((await deleteRestaurant(mockPool({ slug: 'urban-cafe' }), 5, { confirmName: 'Demo Cafe', protectedSlugs: ['urban-cafe'] })).status, 409);
  assert.equal((await deleteRestaurant(mockPool({ blocked: true }), 5, { confirmName: 'Demo Cafe' })).status, 409);
  const failing = mockPool({ failAt: 'DELETE FROM `menu_items`' });
  const failed = await deleteRestaurant(failing, 5, { confirmName: 'Demo Cafe' });
  assert.equal(failed.status, 409);
  assert.ok(failing.log.includes('ROLLBACK') && !failing.log.includes('COMMIT'));
  const pool = mockPool();
  const ok = await deleteRestaurant(pool, 5, { confirmName: ' Demo Cafe ' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.logins_removed, 1);
  assert.ok(pool.log.indexOf('COMMIT') < pool.log.findIndex(sql => /DELETE FROM users/.test(sql)), 'logins removed only after the commit');
  assert.ok(pool.log.some(sql => /DELETE FROM users WHERE id=\? AND platform_role<>'super_admin'/.test(sql)));
});
