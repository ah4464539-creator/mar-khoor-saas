import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { aiTestLabRouter } from '../src/ai-test-lab.js';
import { useSessionStore } from '../src/auth.js';
const token = 'a'.repeat(64);
function makeStore(role) {
  return { async get() { return { id: 1, email: 'test@example.invalid', platformRole: role }; } };
}
test('test lab rejects requests without authentication', async () => {
  const app = express();
  app.use('/api/admin/ai-test-lab', aiTestLabRouter());
  const server = app.listen(0);
  try {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/admin/ai-test-lab/status');
    assert.equal(response.status, 401);
  } finally { server.close(); }
});
test('test lab rejects restaurant admin sessions', async () => {
  useSessionStore(makeStore('restaurant_admin'));
  const app = express();
  app.use('/api/admin/ai-test-lab', aiTestLabRouter());
  const server = app.listen(0);
  try {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/admin/ai-test-lab/status', {headers: {Authorization: 'Bearer '+token}});
    assert.equal(response.status, 403);
  } finally { server.close(); }
});
