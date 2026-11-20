// Super admin: permanently delete a restaurant (e.g. demo accounts) with all of its data.
// No express import: testable with a mock pool.
//
// The delete plan is built from the live database's foreign keys (information_schema), so tables
// added later are covered without code changes. Children are deleted before parents inside one
// transaction; any failure rolls everything back. Audit logs and Stripe event records are kept
// (their restaurant_id becomes NULL or stays as a plain number) so the deletion stays traceable.

const KEEP_TABLES = new Set(['audit_logs', 'stripe_events']);
const ident = name => {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) throw new Error('Unexpected table name');
  return '`' + name + '`';
};

/** Foreign keys of the current database: [{table, column, refTable, refColumn, rule}]. */
export async function loadForeignKeys(db) {
  const [rows] = await db.query(
    'SELECT k.TABLE_NAME AS t, k.COLUMN_NAME AS c, k.REFERENCED_TABLE_NAME AS rt, k.REFERENCED_COLUMN_NAME AS rc, r.DELETE_RULE AS rule '
    + 'FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r '
    + 'ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME '
    + 'WHERE k.TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL');
  return rows.map(row => ({ table: row.t, column: row.c, refTable: row.rt, refColumn: row.rc, rule: String(row.rule).toUpperCase() }));
}

/** Tables with a plain restaurant_id column (some newer tables have no foreign key). */
export async function loadRestaurantIdTables(db) {
  const [rows] = await db.query("SELECT TABLE_NAME AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='restaurant_id'");
  return rows.map(row => row.t);
}

/**
 * Ordered DELETE statements (children first) for rows of `root` matching `where`.
 * Each step: { table, sql, params }. SET NULL references are left to the database.
 */
export function deletePlan(foreignKeys, root, where, params, { depth = 0, seen = new Set() } = {}) {
  if (depth > 6) throw new Error('Foreign keys nest too deeply');
  const steps = [];
  for (const fk of foreignKeys) {
    if (fk.refTable !== root || fk.rule === 'SET NULL' || fk.table === root || KEEP_TABLES.has(fk.table)) continue;
    const key = fk.table + '.' + fk.column + '>' + root;
    if (seen.has(key)) continue;
    const childWhere = ident(fk.column) + ' IN (SELECT ' + ident(fk.refColumn) + ' FROM ' + ident(root) + ' WHERE ' + where + ')';
    steps.push(...deletePlan(foreignKeys, fk.table, childWhere, params, { depth: depth + 1, seen: new Set([...seen, key]) }));
  }
  steps.push({ table: root, sql: 'DELETE FROM ' + ident(root) + ' WHERE ' + where, params });
  return steps;
}

/** Full plan for one restaurant: FK tree + loose restaurant_id tables, members' orphan users last. */
export function restaurantDeletePlan(foreignKeys, restaurantIdTables, restaurantId) {
  const steps = [];
  const planned = new Set();
  // Loose restaurant_id tables (no foreign key) first; their own children are handled too.
  const fkTables = new Set(foreignKeys.filter(fk => fk.refTable === 'restaurants').map(fk => fk.table));
  for (const table of restaurantIdTables) {
    if (table === 'restaurants' || fkTables.has(table) || KEEP_TABLES.has(table)) continue;
    for (const step of deletePlan(foreignKeys, table, '`restaurant_id`=?', [restaurantId])) steps.push(step);
  }
  steps.push(...deletePlan(foreignKeys, 'restaurants', '`id`=?', [restaurantId]));
  return steps.filter(step => { const key = step.sql; if (planned.has(key)) return false; planned.add(key); return true; });
}

/** What blocks deletion: paid Stripe plan, active AI number, custom domain. */
export async function deleteBlockers(db, restaurantId) {
  const blockers = [];
  const check = async (sql, message) => {
    try { const [rows] = await db.execute(sql, [restaurantId]); if (rows.length) blockers.push(message); }
    catch { /* table does not exist: nothing to block */ }
  };
  await check("SELECT 1 FROM restaurant_billing WHERE restaurant_id=? AND stripe_subscription_id IS NOT NULL AND stripe_status IN ('active','trialing','past_due','unpaid') LIMIT 1",
    'It has a paid Stripe subscription. Cancel it in Stripe first.');
  await check("SELECT 1 FROM restaurant_numbers WHERE restaurant_id=? AND status NOT IN ('failed','released','cancelled') LIMIT 1",
    'It has a dedicated AI phone number. Release the number first so it is not billed.');
  await check('SELECT 1 FROM restaurant_domains WHERE restaurant_id=? LIMIT 1',
    'It has a custom domain. Remove the domain first.');
  return blockers;
}

/** Counts shown before deleting. */
export async function deletePreview(db, restaurantId) {
  const [restaurants] = await db.execute('SELECT id,name,slug,created_at FROM restaurants WHERE id=? LIMIT 1', [restaurantId]);
  if (!restaurants.length) return null;
  const counts = {};
  for (const [label, sql] of [
    ['orders', 'SELECT COUNT(*) AS n FROM orders WHERE restaurant_id=?'],
    ['menu_items', 'SELECT COUNT(*) AS n FROM menu_items WHERE restaurant_id=?'],
    ['customers', 'SELECT COUNT(*) AS n FROM customers WHERE restaurant_id=?'],
    ['members', 'SELECT COUNT(*) AS n FROM restaurant_members WHERE restaurant_id=?'],
  ]) {
    try { const [rows] = await db.execute(sql, [restaurantId]); counts[label] = Number(rows[0]?.n ?? 0); } catch { counts[label] = 0; }
  }
  const [owners] = await db.execute(
    "SELECT u.email,(SELECT COUNT(*) FROM restaurant_members o WHERE o.user_id=u.id AND o.restaurant_id<>?) AS other FROM restaurant_members m JOIN users u ON u.id=m.user_id WHERE m.restaurant_id=? AND u.platform_role<>'super_admin'",
    [restaurantId, restaurantId]);
  return {
    restaurant: restaurants[0], counts,
    logins_removed: owners.filter(row => Number(row.other) === 0).map(row => row.email),
    blockers: await deleteBlockers(db, restaurantId),
  };
}

/**
 * Deletes the restaurant and everything that belongs to it in one transaction.
 * Owners/staff whose only restaurant this was lose their login too (never super admins).
 */
export async function deleteRestaurant(pool, restaurantId, { confirmName, protectedSlugs = [] } = {}) {
  if (!Number.isSafeInteger(restaurantId) || restaurantId < 1) return { status: 400, body: { error: 'Invalid restaurant' } };
  const preview = await deletePreview(pool, restaurantId);
  if (!preview) return { status: 404, body: { error: 'Restaurant not found' } };
  if (protectedSlugs.includes(preview.restaurant.slug)) return { status: 409, body: { error: 'This restaurant is protected and cannot be deleted here' } };
  if (typeof confirmName !== 'string' || confirmName.trim() !== preview.restaurant.name.trim())
    return { status: 400, body: { error: 'Type the restaurant name exactly to confirm' } };
  if (preview.blockers.length) return { status: 409, body: { error: preview.blockers.join(' '), blockers: preview.blockers } };

  const connection = await pool.getConnection();
  try {
    const [members] = await connection.execute(
      "SELECT m.user_id FROM restaurant_members m JOIN users u ON u.id=m.user_id WHERE m.restaurant_id=? AND u.platform_role<>'super_admin' "
      + 'AND NOT EXISTS (SELECT 1 FROM restaurant_members o WHERE o.user_id=m.user_id AND o.restaurant_id<>m.restaurant_id)', [restaurantId]);
    const foreignKeys = await loadForeignKeys(connection);
    const plan = restaurantDeletePlan(foreignKeys, await loadRestaurantIdTables(connection), restaurantId);
    const userIds = members.map(row => Number(row.user_id));
    await connection.beginTransaction();
    let rows = 0;
    for (const step of plan) { const [result] = await connection.execute(step.sql, step.params); rows += Number(result?.affectedRows ?? 0); }
    await connection.commit();
    // Logins of people who only belonged to this restaurant. Done after the commit and one by one:
    // if anything elsewhere still points at a user, that login is simply kept.
    const removed = [], kept = [];
    for (const userId of userIds) {
      try { await connection.execute("DELETE FROM users WHERE id=? AND platform_role<>'super_admin'", [userId]); removed.push(userId); }
      catch { kept.push(userId); }
    }
    return { status: 200, body: { deleted: preview.restaurant.name, rows, logins_removed: removed.length, logins_kept: kept.length } };
  } catch (error) {
    await connection.rollback().catch(() => {});
    return { status: 409, body: { error: 'Nothing was deleted: ' + String(error?.message || 'database error').slice(0, 200) } };
  } finally {
    connection.release();
  }
}
