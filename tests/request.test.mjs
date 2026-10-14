import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequester } from '../apps/web/request.mjs';

for (const failure of ['connection', 'body', 'server']) {
  test(`unknown write outcome (${failure}) retries with original identity and payload`, async () => {
    const calls = [], pendingKeys = new Map();
    const request = createRequester({ pendingKeys, createKey: () => 'test-key-' + calls.length, fetcher: async (path, options) => {
      calls.push({ path, ...options });
      if (calls.length === 1) {
        if (failure === 'connection') throw new TypeError('Failed to fetch');
        if (failure === 'body') return { ok: true, status: 200, json: async () => { throw new SyntaxError('Truncated JSON'); } };
        return Response.json({ error: { code: 'INTERNAL_ERROR' } }, { status: 500 });
      }
      return Response.json({ weight: 70, version: 1 });
    } });
    const body = { date: '2026-10-14', weight: 70, version: 0 };
    await assert.rejects(request('/rooms/a/records', 'PUT', body), e => e.code === 'NETWORK');
    assert.equal(pendingKeys.size, 1);
    assert.equal((await request('/rooms/a/records', 'PUT', body)).version, 1);
    assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
    assert.equal(calls[0].body, calls[1].body); assert.equal(pendingKeys.size, 0);
  });
}
test('confirmed conflict releases key and preserves latest server value', async () => {
  const pendingKeys = new Map();
  const request = createRequester({ pendingKeys, createKey: () => 'conflict-key', fetcher: async () => Response.json({ error: { code: 'VERSION_CONFLICT', message: '记录已更新', details: { latest: { weight: 69, version: 2 } } } }, { status: 409 }) });
  await assert.rejects(request('/records', 'PUT', {}), e => e.status === 409 && e.details.latest.weight === 69);
  assert.equal(pendingKeys.size, 0);
});
test('old session response cannot release a new session request identity', async () => {
  const pendingKeys = new Map(), resolvers = []; let sequence = 0;
  const request = createRequester({ pendingKeys, createKey: () => 'session-key-' + ++sequence, fetcher: () => new Promise(resolve => resolvers.push(resolve)) });
  const old = request('/rooms', 'POST', {}); pendingKeys.clear();
  const current = request('/rooms', 'POST', {});
  resolvers[0](Response.json({ roomId: 'old' })); await old;
  assert.equal([...pendingKeys.values()][0], 'session-key-2');
  resolvers[1](Response.json({ roomId: 'new' })); await current; assert.equal(pendingKeys.size, 0);
});
