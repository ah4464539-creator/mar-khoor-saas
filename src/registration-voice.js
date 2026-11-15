const pending = { status: 'pending' };

// Each inventory row is a Vapi number already attached to its own unused assistant.
export async function assignRegistrationNumber(pool, restaurantId, country) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [restaurants] = await connection.execute(
      'SELECT id FROM restaurants WHERE id=? AND country_code=? FOR UPDATE', [restaurantId, country]
    );
    if (!restaurants.length) return pending;
    const [existing] = await connection.execute(
      'SELECT phone_number FROM registration_voice_inventory WHERE restaurant_id=?', [restaurantId]
    );
    if (existing.length) return { status: 'active', number: existing[0].phone_number };
    const [mapped] = await connection.execute(
      'SELECT assistant_id FROM voice_assistants WHERE restaurant_id=? AND active=1 LIMIT 1', [restaurantId]
    );
    if (mapped.length) return pending;

    const [available] = await connection.execute(
      'SELECT i.id,i.phone_number,i.assistant_id FROM registration_voice_inventory i WHERE i.country_code=? AND i.restaurant_id IS NULL '
      + 'AND NOT EXISTS (SELECT 1 FROM voice_assistants v WHERE v.assistant_id=i.assistant_id) '
      + 'AND NOT EXISTS (SELECT 1 FROM restaurant_numbers n WHERE n.phone_number=i.phone_number OR n.vapi_phone_id=i.vapi_phone_id) '
      + 'ORDER BY i.id LIMIT 1 FOR UPDATE', [country]
    );
    if (!available.length) return pending;
    const entry = available[0];
    await connection.execute(
      'INSERT INTO voice_assistants(assistant_id,restaurant_id,active) VALUES (?,?,TRUE)', [entry.assistant_id, restaurantId]
    );
    await connection.execute(
      'UPDATE registration_voice_inventory SET restaurant_id=? WHERE id=?', [restaurantId, entry.id]
    );
    await connection.commit();
    return { status: 'active', number: entry.phone_number };
  } catch (error) {
    console.warn('Registration number assignment failed:', error.code || error.name);
    return pending;
  } finally {
    if (connection) {
      await connection.rollback().catch(() => {});
      connection.release();
    }
  }
}
