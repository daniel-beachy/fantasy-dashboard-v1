import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = new URL(process.env.TEST_URL || 'http://127.0.0.1:8787');
const jar = new Map();
let csrf = '';
let recoveryKey;
let authenticated = false;
async function request(path, body) {
  const response = await fetch(new URL(`/api/${path}`, base), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
      Origin: base.origin, 'Content-Type': 'application/json', 'X-Dashboard-Token': csrf,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0];
    const index = pair.indexOf('=');
    jar.set(pair.slice(0, index), pair.slice(index + 1));
    assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  }
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const result = await response.json();
  return { status: response.status, result };
}
async function session() {
  const response = await request('session');
  assert.equal(response.status, 200);
  assert.equal(response.result.mode, 'cloud');
  csrf = response.result.csrfToken;
  authenticated = response.result.vaultAuthenticated;
  return response.result;
}
try {
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await session()).vaultAuthenticated, false);
  const created = await request('vaults', {});
  assert.equal(created.status, 200, 'Could not create the disposable dashboard.');
  recoveryKey = created.result.recoveryKey;
  assert.match(recoveryKey, /^hq_[A-Za-z0-9_-]{43}$/);
  assert.equal((await session()).vaultAuthenticated, true);
  if (process.env.SMOKE_ESPN === '1') {
    const denied = await request('connect', { swid: `{${randomUUID()}}`, espnS2: 'deliberately-invalid-smoke-cookie' });
    assert.equal(denied.status, 401, denied.result.error || 'ESPN must reject fabricated account credentials.');
    assert.match(denied.result.error, /profile.*SWID/i, 'The deployed Worker must use profile discovery, not the removed anonymous-status gate.');
    assert.equal((await session()).authenticated, false);
    console.log('Fabricated ESPN credentials correctly rejected by the hosted connection flow.');
  }
  assert.equal((await request('vaults/logout', {})).status, 200);
  assert.equal((await session()).vaultAuthenticated, false);
  assert.equal((await request('vaults/login', { recoveryKey })).status, 200);
  assert.equal((await session()).vaultAuthenticated, true);
  assert.equal((await request('vaults/delete', { confirm: true })).status, 200);
  recoveryKey = undefined;
  assert.equal((await session()).vaultAuthenticated, false);
  console.log('Cloud runtime smoke passed: create, recovery, sign-out, deletion, and cookie protections.');
} finally {
  if (recoveryKey) {
    if (!authenticated) { await session(); await request('vaults/login', { recoveryKey }); await session(); }
    const removed = await request('vaults/delete', { confirm: true });
    if (removed.status !== 200) throw new Error('The disposable smoke-test dashboard could not be removed.');
  }
}
