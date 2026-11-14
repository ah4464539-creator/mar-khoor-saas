// Customer order tracking. Each order made through the public checkout gets a random
// tracking token; only its SHA-256 hash is stored. Knowing the order number alone is not enough.
import crypto from 'node:crypto';

export const newTrackingToken = () => crypto.randomBytes(24).toString('hex');
export const hashTrackingToken = token => crypto.createHash('sha256').update(token).digest('hex');
const TOKEN = /^[a-f0-9]{48}$/;

export const STATUS_LABELS = {
  pending: 'Received',
  accepted: 'Accepted',
  preparing: 'Being prepared',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// Returns { status, body }. Wrong token and unknown order give the same 404.
export async function getOrderTracking(pool, orderId, token) {
  if (!Number.isSafeInteger(orderId) || orderId < 1 || typeof token !== 'string' || !TOKEN.test(token)) {
    return { status: 404, body: { error: 'Order not found' } };
  }
  try {
    const [rows] = await pool.execute(
      'SELECT o.id,o.status,o.total_minor,o.created_at,r.name AS restaurant_name,r.currency FROM orders o JOIN order_tracking t ON t.order_id=o.id JOIN restaurants r ON r.id=o.restaurant_id WHERE o.id=? AND t.token_hash=? LIMIT 1',
      [orderId, hashTrackingToken(token)]
    );
    if (!rows.length) return { status: 404, body: { error: 'Order not found' } };
    const [items] = await pool.execute('SELECT name_snapshot AS name,quantity FROM order_items WHERE order_id=? ORDER BY id LIMIT 50', [orderId]);
    const order = rows[0];
    return {
      status: 200,
      body: {
        order_id: order.id,
        status: order.status,
        status_label: STATUS_LABELS[order.status] ?? order.status,
        total_minor: Number(order.total_minor),
        currency: order.currency,
        restaurant_name: order.restaurant_name,
        placed_at: order.created_at,
        items,
      },
    };
  } catch {
    return { status: 503, body: { error: 'Tracking unavailable' } };
  }
}
