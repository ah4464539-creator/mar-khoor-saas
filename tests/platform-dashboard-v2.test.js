import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { platformDashboardV2Router } from '../src/platform-dashboard-v2.js';
import { useSessionStore } from '../src/auth.js';
import { hashToken } from '../src/sessions.js';

test('V2 dashboard requires super admin and returns real-query aggregates without currency mixing', async () => {
  const originalOwner = process.env.SUPER_ADMIN_OWNER_EMAIL;
  process.env.SUPER_ADMIN_OWNER_EMAIL = 'platform-owner@example.test';
  const adminToken = 'a'.repeat(64);
  const restaurantToken = 'b'.repeat(64);
  const sqlQueries = [];
  const mockPool = {
    async query(sql) {
      sqlQueries.push(sql);
      let rows;
      if (sql.startsWith('SELECT COUNT(*) AS n FROM restaurants')) rows = [{ n: 3 }];
      else if (sql.startsWith('SELECT COUNT(*) AS n FROM users')) rows = [{ n: 5 }];
      else if (sql.startsWith('SELECT COUNT(*) AS n FROM orders WHERE status')) rows = [{ n: 2 }];
      else if (sql.startsWith('SELECT COUNT(*) AS n FROM orders')) rows = [{ n: 11 }];
      else if (sql.includes('FROM restaurant_subscriptions')) rows = [{ n: 2 }];
      else if (sql.includes('FROM restaurant_sites')) rows = [{ n: 2 }];
      else if (sql.includes('FROM voice_assistants')) rows = [{ n: 1 }];
      else if (sql.includes("DATE_FORMAT(created_at") && sql.includes('FROM orders')) rows = [{ day: '2026-11-21', n: 4 }];
      else if (sql.includes("DATE_FORMAT(created_at") && sql.includes('FROM restaurants')) rows = [{ day: '2026-11-21', n: 1 }];
      else if (sql.includes('FROM voice_calls')) rows = [{ day: '2026-11-21', n: 2 }];
      else if (sql.includes('FROM whatsapp_inbound_messages')) rows = [{ day: '2026-11-21', n: 7 }];
      else if (sql.includes('FROM restaurant_site_daily')) rows = [{ page_views: 31, menu_views: 9 }];
      else if (sql.startsWith('SELECT o.id')) rows = [{
        id: 22, status: 'completed', total_minor: 599, created_at: '2026-11-21',
        restaurant_name: 'Sample Restaurant', currency: 'EUR'
      }];
      else if (sql.startsWith('SELECT id,name,slug')) rows = [{
        id: 1, name: 'Sample Restaurant', slug: 'sample', country_code: 'GR',
        currency: 'EUR', created_at: '2026-11-21'
      }];
      else if (sql.startsWith('SELECT r.currency')) rows = [
        { currency: 'EUR', total_minor: 599, order_count: 1 },
        { currency: 'PKR', total_minor: 100000, order_count: 4 }
      ];
      else if (sql.startsWith('SELECT status,COUNT(*)')) rows = [
        { status: 'completed', n: 9 }, { status: 'pending', n: 2 }
      ];
      else throw Error('Unexpected query: ' + sql);
      return [rows, []];
    }
  };
  const byHash = new Map([
    [hashToken(adminToken), { id: 1, email: 'platform-owner@example.test', platformRole: 'super_admin' }],
    [hashToken(restaurantToken), { id: 2, email: 'restaurant@example.test', platformRole: 'restaurant_owner' }]
  ]);
  useSessionStore({ get: async hash => byHash.get(hash) || null });
  const app = express();
  app.use('/api/platform/v2', platformDashboardV2Router(mockPool));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    let response = await fetch(origin + '/api/platform/v2/overview');
    assert.equal(response.status, 401);
    response = await fetch(origin + '/api/platform/v2/overview', { headers: { Authorization: 'Bearer ' + restaurantToken } });
    assert.equal(response.status, 403);
    response = await fetch(origin + '/api/platform/v2/overview?days=7', { headers: { Authorization: 'Bearer ' + adminToken } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.equal(result.period_days, 7);
    assert.equal(result.kpis.restaurants, 3);
    assert.equal(result.kpis.open_orders, 2);
    assert.equal(result.period_totals.calls, 2);
    assert.equal(result.period_totals.messages, 7);
    assert.equal(result.revenue_by_currency.length, 2);
    assert.deepEqual(result.revenue_by_currency.map(x => x.currency), ['EUR', 'PKR']);
    assert.equal(result.recent_orders[0].restaurant_name, 'Sample Restaurant');
    assert.ok(sqlQueries.length >= 16);
    assert.ok(sqlQueries.every(sql => sql.startsWith('SELECT')));
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (originalOwner === undefined) delete process.env.SUPER_ADMIN_OWNER_EMAIL;
    else process.env.SUPER_ADMIN_OWNER_EMAIL = originalOwner;
  }
});
