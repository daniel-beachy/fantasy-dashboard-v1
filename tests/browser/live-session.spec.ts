import { expect, test } from '@playwright/test';
import { demoData } from '../../src/data/demo';

const leagueResponse = { leagues: [{ id: 'sunday', name: 'Sunday Diehards', teamId: 1, teams: [{ id: 1, name: 'Sunday Scaries', owned: true }] }] };

test('official login retains leagues when authentication polling stops', async ({ page }) => {
  let stage = 0;
  await page.route('**/api/session', route => {
    const response = { authenticated: stage >= 2, loginPending: stage === 1, csrfToken: 'fixture-token' };
    if (stage === 1) stage = 2;
    return route.fulfill({ json: response });
  });
  await page.route('**/api/login', route => { stage = 1; return route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/leagues', async route => {
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.fulfill({ json: leagueResponse });
  });
  await page.route('**/api/dashboard', route => route.fulfill({ json: { ...demoData, source: 'espn', fetchedAt: new Date().toISOString() } }));
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Connect ESPN', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in with ESPN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open my gameday' })).toBeEnabled();
  await expect(page.getByRole('dialog')).toContainText('Sunday Diehards');
});

test('manage-leagues reload failure retains the ESPN snapshot', async ({ page }) => {
  let fail = false;
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: true, loginPending: false, csrfToken: 'fixture-token' } }));
  await page.route('**/api/leagues', route => route.fulfill({ json: leagueResponse }));
  await page.route('**/api/dashboard', route => fail
    ? route.fulfill({ status: 502, json: { error: 'ESPN unavailable.' } })
    : route.fulfill({ json: { ...demoData, source: 'espn', fetchedAt: new Date().toISOString() } }));
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="player-card"]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Manage leagues', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open my gameday' })).toBeEnabled();
  fail = true;
  await page.getByRole('button', { name: 'Open my gameday' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('ESPN unavailable');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('[data-testid="player-card"]').first()).toBeVisible();
});

test('a connected user can disconnect through the dialog at every viewport', async ({ page }) => {
  let authenticated = true;
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated, loginPending: false, csrfToken: 'fixture-token' } }));
  await page.route('**/api/leagues', route => route.fulfill({ json: leagueResponse }));
  await page.route('**/api/dashboard', route => route.fulfill({ json: { ...demoData, source: 'espn', fetchedAt: new Date().toISOString() } }));
  await page.route('**/api/logout', route => { authenticated = false; return route.fulfill({ json: { ok: true } }); });
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Manage leagues', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Disconnect ESPN', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('Demo mode', { exact: true })).toBeVisible();
});

test('applying league settings supersedes an older in-flight refresh', async ({ page }) => {
  let fetchCount = 0;
  let release: (() => void) | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: true, loginPending: false, csrfToken: 'fixture-token' } }));
  await page.route('**/api/leagues', route => route.fulfill({ json: leagueResponse }));
  await page.route('**/api/dashboard', async route => {
    const count = ++fetchCount;
    if (count === 2) await held;
    await route.fulfill({ json: { ...demoData, source: 'espn', week: count >= 3 ? 9 : 1, fetchedAt: new Date().toISOString() } });
  });
  try {
    await page.goto('./', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ESPN connected', { exact: true })).toBeVisible();
    await expect(page.locator('[data-testid="player-card"]').first()).toBeVisible();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(() => fetchCount).toBe(2);
    await page.getByRole('button', { name: 'Manage leagues', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open my gameday' })).toBeEnabled();
    await page.getByRole('button', { name: 'Open my gameday' }).click();
    await expect(page.locator('.week-chip')).toContainText('9');
    release?.();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('.week-chip')).toContainText('9');
  } finally { release?.(); }
});

test('authenticated ESPN data replaces demo and errors preserve the last snapshot', async ({ page }) => {
  let fail = false;
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: true, loginPending: false, csrfToken: 'fixture-token' } }));
  await page.route('**/api/dashboard', route => fail
    ? route.fulfill({ status: 502, json: { error: 'ESPN is temporarily unavailable.' } })
    : route.fulfill({ json: { ...demoData, source: 'espn', week: 8, fetchedAt: new Date().toISOString() } }));
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('ESPN connected', { exact: true })).toBeVisible();
  await expect(page.getByText('Demo mode', { exact: true })).not.toBeVisible();
  await expect(page.locator('.week-chip')).toContainText('8');
  await expect(page.locator('[data-testid="player-card"]').first()).toBeVisible();
  fail = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Showing the last successful snapshot');
  await expect(page.getByRole('alert')).toContainText('ESPN is temporarily unavailable.');
  await expect(page.locator('[data-testid="player-card"]').first()).toBeVisible();
  await expect(page.getByText('Demo mode', { exact: true })).not.toBeVisible();
});

test('first authenticated fetch failure never falls back to sample scores', async ({ page }) => {
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: true, loginPending: false, csrfToken: 'fixture-token' } }));
  await page.route('**/api/dashboard', route => route.fulfill({ status: 401, json: { error: 'Your ESPN session has expired. Sign in again.' } }));
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('alert')).toContainText('session has expired');
  await expect(page.locator('[data-testid="player-card"]')).toHaveCount(0);
  await expect(page.getByText('Demo mode', { exact: true })).not.toBeVisible();
});

test('local login sends the CSRF token and surfaces official-login errors', async ({ page }) => {
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: false, loginPending: false, csrfToken: 'fixture-token' } }));
  let token = '';
  await page.route('**/api/login', route => {
    token = route.request().headers()['x-dashboard-token'];
    return route.fulfill({ status: 503, json: { error: 'No browser available. Install Chromium with npx playwright install chromium.' } });
  });
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Connect ESPN', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in with ESPN', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No browser available');
  expect(token).toBe('fixture-token');
  await expect(page.getByText('Demo mode', { exact: true })).toBeVisible();
});
