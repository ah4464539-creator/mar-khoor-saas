import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { publicAssistantRouter } from '../src/public-assistant.js';

async function withServer(fn) {
  const app = express(); app.use(express.json()); app.use('/api', publicAssistantRouter());
  const server = app.listen(0);
  try { await new Promise(resolve => server.once('listening', resolve)); await fn('http://127.0.0.1:' + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())); }
}
const endpoint = base => base + '/api/public/assistant/chat';
const post = (base, message) => fetch(endpoint(base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });

test('public assistant remains off by default', async () => {
  const previous = process.env.WEBSITE_AI_ASSISTANT_ENABLED;
  delete process.env.WEBSITE_AI_ASSISTANT_ENABLED;
  try { await withServer(async base => assert.equal((await post(base, 'Hello')).status, 503)); }
  finally { if (previous === undefined) delete process.env.WEBSITE_AI_ASSISTANT_ENABLED; else process.env.WEBSITE_AI_ASSISTANT_ENABLED = previous; }
});

test('public assistant rejects invalid input without provider call', async () => {
  const oldFlag = process.env.WEBSITE_AI_ASSISTANT_ENABLED;
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.WEBSITE_AI_ASSISTANT_ENABLED = 'true'; process.env.OPENAI_API_KEY = 'test-only';
  try { await withServer(async base => { assert.equal((await post(base, '')).status, 400); assert.equal((await post(base, 'x'.repeat(1201))).status, 400); }); }
  finally { for (const [key, value] of [['WEBSITE_AI_ASSISTANT_ENABLED',oldFlag],['OPENAI_API_KEY',oldKey]]) { if(value===undefined) delete process.env[key]; else process.env[key]=value; } }
});
