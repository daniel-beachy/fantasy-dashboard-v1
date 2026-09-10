import { expect, test, type Page } from '@playwright/test';
import { demoData } from '../../src/data/demo';

// No traces, recordings or screenshots: even test recovery keys stay out of artifacts.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const recoveryKey = `hq_${'a'.repeat(43)}`;
const swid = '{12345678-1234-1234-1234-123456789012}';
const espnS2 = 'fixture-private-session';
const league = { id: '123', name: 'Private League', teamId: 1, teams: [{ id: 1, name: 'My team', owned: true }, { id: 2, name: 'Not mine', owned: false }] };

async function mockCloud(page: Page, initial = { vaultAuthenticated: false, authenticated: false }) {
  const state = { ...initial, failLogin: false, failConnect: false, deletes: 0, signouts: 0, disconnects: 0, mutations: [] as { path: string; token: string; body: Record<string, unknown> }[] };
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST') {
      state.mutations.push({ path, token: request.headers()['x-dashboard-token'], body: request.postDataJSON() });
    }
    if (path === '/api/session') return route.fulfill({ json: { mode: 'cloud', vaultAuthenticated: state.vaultAuthenticated, authenticated: state.vaultAuthenticated && state.authenticated, loginPending: false, csrfToken: state.vaultAuthenticated ? 'vault-csrf' : 'anonymous-csrf' } });
    if (path === '/api/vaults') {
      state.vaultAuthenticated = true;
      return route.fulfill({ json: { recoveryKey } });
    }
    if (path === '/api/vaults/login') {
      if (state.failLogin) return route.fulfill({ status: 401, json: { error: 'Recovery key not recognized.' } });
      state.vaultAuthenticated = true;
      return route.fulfill({ json: { ok: true } });
    }
    if (path === '/api/vaults/logout' || path === '/api/vaults/delete') {
      if (path.endsWith('delete')) { state.deletes++; state.authenticated = false; }
      else state.signouts++;
      state.vaultAuthenticated = false;
      return route.fulfill({ json: { ok: true } });
    }
    if (path === '/api/connect') {
      if (state.failConnect) return route.fulfill({ status: 401, json: { error: 'ESPN credentials could not be validated.' } });
      state.authenticated = true;
      return route.fulfill({ json: { ok: true } });
    }
    if (path === '/api/logout') { state.authenticated = false; state.disconnects++; return route.fulfill({ json: { ok: true } }); }
    if (path === '/api/leagues') return route.fulfill({ json: request.method() === 'POST' ? { ok: true } : { leagues: [league] } });
    if (path === '/api/dashboard') return route.fulfill({ json: { ...demoData, source: 'espn', week: 8, fetchedAt: new Date().toISOString(), leagues: [{ ...demoData.leagues[0], id: '123', name: 'Private League' }], players: demoData.players.map(player => ({ ...player, leagueId: '123' })) } });
    return route.fulfill({ status: 404, json: { error: 'Unexpected endpoint' } });
  });
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: initial.authenticated ? 'Manage leagues' : 'Connect ESPN', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your private gameday.' })).toBeVisible();
  await expect(page.getByText('Updating your private dashboard…', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  return state;
}

async function assertNoStoredSecrets(page: Page) {
  const clean = await page.evaluate(({ recoveryKey, swid, espnS2 }) => {
    const stored = `${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)} ${location.href}`;
    return ![recoveryKey, swid, espnS2].some(value => stored.includes(value));
  }, { recoveryKey, swid, espnS2 });
  expect(clean).toBe(true);
}

test('creates a private dashboard and requires saving the one-time recovery key before dismissal', async ({ page }) => {
  const state = await mockCloud(page);
  await expect(page.getByRole('button', { name: 'Sign in with ESPN', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toContainText('encrypted');
  await page.getByRole('button', { name: 'Create private dashboard', exact: true }).click();
  const key = page.getByLabel('Your recovery key', { exact: true });
  await expect(key).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to ESPN', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(key).toBeVisible();
  await assertNoStoredSecrets(page);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } }));
  await page.getByRole('button', { name: 'Copy recovery key', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copied recovery key', exact: true })).toBeVisible();
  await page.getByLabel('I saved my recovery key in a safe place.').check();
  await page.getByRole('button', { name: 'Continue to ESPN', exact: true }).click();
  await expect(key).toHaveCount(0);
  await expect(page.getByLabel('SWID', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Connect ESPN', exact: true }).click();
  await expect(key).toHaveCount(0);
  await assertNoStoredSecrets(page);
  expect(state.mutations.map(item => [item.path, item.token])).toEqual([['/api/vaults', 'anonymous-csrf']]);
});

test('recovery-key sign-in and ESPN cookie import use CSRF and only owned teams', async ({ page }) => {
  const state = await mockCloud(page);
  await page.getByRole('button', { name: 'Sign in with recovery key', exact: true }).click();
  await page.getByLabel('Recovery key', { exact: true }).fill(recoveryKey);
  await page.getByRole('button', { name: 'Unlock private dashboard', exact: true }).click();
  await expect(page.getByLabel('Recovery key', { exact: true })).toHaveCount(0);
  await page.getByLabel('SWID', { exact: true }).fill(swid);
  await page.getByLabel('espn_s2', { exact: true }).fill(espnS2);
  await page.getByRole('button', { name: 'Connect securely', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('ESPN session connected');
  await expect(page.getByRole('option', { name: 'Not mine' })).toHaveCount(0);
  await page.getByLabel('ESPN league ID', { exact: true }).fill('456');
  await page.getByRole('button', { name: 'Add league', exact: true }).click();
  await expect(page.getByLabel('ESPN league ID', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Open my gameday', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.week-chip')).toContainText('8');
  await expect(page.getByText('Demo mode', { exact: true })).not.toBeVisible();
  await assertNoStoredSecrets(page);
  expect(state.mutations.map(item => [item.path, item.token])).toEqual([
    ['/api/vaults/login', 'anonymous-csrf'], ['/api/connect', 'vault-csrf'], ['/api/leagues', 'vault-csrf'],
  ]);
  expect(state.mutations[1].body.swid === swid && state.mutations[1].body.espnS2 === espnS2).toBe(true);
});

test('disconnect clears ESPN but keeps the vault available for sign-out on every viewport', async ({ page }) => {
  const state = await mockCloud(page, { vaultAuthenticated: true, authenticated: true });
  await page.getByRole('dialog').getByRole('button', { name: 'Disconnect ESPN', exact: true }).click();
  await expect(page.getByLabel('SWID', { exact: true })).toBeVisible();
  expect(state.vaultAuthenticated).toBe(true);
  await expect(page.getByText('Demo mode', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out this browser', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(state.signouts).toBe(1);
  expect(state.disconnects).toBe(1);
  await page.getByRole('button', { name: 'Connect ESPN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create private dashboard', exact: true })).toBeVisible();
});

test('sign-out retains saved ESPN connection and discards in-flight private snapshots', async ({ page }) => {
  const state = await mockCloud(page, { vaultAuthenticated: true, authenticated: true });
  let release: (() => void) | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  await expect(page.locator('.week-chip')).toContainText('8');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.route('**/api/dashboard?**', async route => {
    started = true; await held;
    await route.fulfill({ json: { ...demoData, source: 'espn', week: 9 } });
  });
  try {
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(() => started).toBe(true);
    await page.getByRole('button', { name: 'Manage leagues', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out this browser', exact: true }).click();
    await expect(page.getByText('Demo mode', { exact: true })).toBeVisible();
    release?.();
    await expect(page.locator('.week-chip')).toContainText('1');
    expect(state.authenticated).toBe(true);
    expect(state.disconnects).toBe(0);
  } finally { release?.(); }
});

test('private dashboard deletion requires an explicit in-dialog confirmation', async ({ page }) => {
  const state = await mockCloud(page, { vaultAuthenticated: true, authenticated: false });
  await page.getByRole('button', { name: 'Delete private dashboard', exact: true }).click();
  expect(state.deletes).toBe(0);
  await expect(page.getByRole('button', { name: 'Permanently delete dashboard', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Keep my dashboard', exact: true }).click();
  expect(state.deletes).toBe(0);
  await page.getByRole('button', { name: 'Delete private dashboard', exact: true }).click();
  await page.getByLabel('I understand this permanently deletes my dashboard and saved ESPN connection.').check();
  await page.getByRole('button', { name: 'Permanently delete dashboard', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(state.deletes).toBe(1);
  expect(state.mutations.at(-1)?.body).toEqual({ confirm: true });
  await expect(page.getByText('Demo mode', { exact: true })).toBeVisible();
});

test('failed recovery and ESPN credentials stay honest and are cleared after each attempt', async ({ page }) => {
  const state = await mockCloud(page);
  state.failLogin = true;
  await page.getByRole('button', { name: 'Sign in with recovery key', exact: true }).click();
  await page.getByLabel('Recovery key', { exact: true }).fill(recoveryKey);
  await page.getByRole('button', { name: 'Unlock private dashboard', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Recovery key not recognized');
  await expect(page.getByLabel('Recovery key', { exact: true })).toHaveValue('');
  state.failLogin = false;
  await page.getByLabel('Recovery key', { exact: true }).fill(recoveryKey);
  await page.getByRole('button', { name: 'Unlock private dashboard', exact: true }).click();
  state.failConnect = true;
  await page.getByLabel('SWID', { exact: true }).fill(swid);
  await page.getByLabel('espn_s2', { exact: true }).fill(espnS2);
  await page.getByRole('button', { name: 'Connect securely', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('ESPN credentials could not be validated');
  await expect(page.getByLabel('SWID', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('espn_s2', { exact: true })).toHaveValue('');
  await expect(page.getByText('Demo mode', { exact: true })).toBeVisible();
  await assertNoStoredSecrets(page);
});

test('reopening account controls detects an expired vault and offers recovery-key sign-in', async ({ page }) => {
  const state = await mockCloud(page, { vaultAuthenticated: true, authenticated: true });
  await page.getByRole('button', { name: 'Close dialog' }).click();
  state.vaultAuthenticated = false;
  await page.getByRole('button', { name: 'Manage leagues', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in with recovery key', exact: true })).toBeVisible();
  await expect(page.getByText('Demo mode', { exact: true })).toBeVisible();
});

test('the newly created recovery key survives a failed session refresh', async ({ page }) => {
  await mockCloud(page);
  let fail = true;
  await page.route('**/api/session', route => fail
    ? route.fulfill({ status: 503, json: { error: 'Service temporarily unavailable.' } })
    : route.fulfill({ json: { mode: 'cloud', vaultAuthenticated: true, authenticated: false, loginPending: false, csrfToken: 'vault-csrf' } }));
  await page.getByRole('button', { name: 'Create private dashboard', exact: true }).click();
  await expect(page.getByLabel('Your recovery key', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Service temporarily unavailable');
  await page.getByLabel('I saved my recovery key in a safe place.').check();
  fail = false;
  await page.getByRole('button', { name: 'Continue to ESPN', exact: true }).click();
  await expect(page.getByLabel('Your recovery key', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('SWID', { exact: true })).toBeVisible();
  await assertNoStoredSecrets(page);
});

test('private data clears after successful disconnect even if refreshing the session fails', async ({ page }) => {
  await mockCloud(page, { vaultAuthenticated: true, authenticated: true });
  await expect(page.locator('.week-chip')).toContainText('8');
  await page.route('**/api/session', route => route.fulfill({ status: 503, json: { error: 'Service temporarily unavailable.' } }));
  await page.getByRole('dialog').getByRole('button', { name: 'Disconnect ESPN', exact: true }).click();
  await expect(page.getByText('Demo mode', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Service temporarily unavailable');
});
