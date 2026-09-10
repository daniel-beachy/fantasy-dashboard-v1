import { expect, test, type Page } from '@playwright/test';
import { demoData } from '../../src/data/demo';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function setup(page: Page) {
  const state = { failure: '', conflict: false, calls: [] as string[] };
  await page.route('**/api/session', route => route.fulfill({ json: { mode: 'cloud', authenticated: true, vaultAuthenticated: true, loginPending: false, csrfToken: 'fixture-csrf' } }));
  await page.route('**/api/leagues', route => route.fulfill({ json: { leagues: ['1', '2'].map(id => ({ id, name: `Private league ${id}`, teamId: 1, teams: [{ id: 1, name: 'My team', owned: true }] })) } }));
  await page.route('**/api/dashboard**', route => {
    const id = new URL(route.request().url()).searchParams.get('leagueId') ?? '';
    state.calls.push(id);
    if (id === '2' && state.failure) return route.fulfill({ status: state.failure === 'Session expired.' ? 401 : 502, json: { error: state.failure } });
    return route.fulfill({ json: {
      ...demoData, source: 'espn', week: id === '2' && state.conflict ? 9 : 8,
      fetchedAt: new Date(Date.now() - (id === '1' ? 180_000 : 0)).toISOString(),
      leagues: [{ ...demoData.leagues[0], id, name: `Private league ${id}` }],
      players: demoData.players.filter(player => player.leagueId === demoData.leagues[0].id).map(player => ({ ...player, id: `${id}-${player.id}`, leagueId: id })),
      warnings: ['Shared ESPN warning.'],
    } });
  });
  return state;
}

test('hosted gameday aggregates leagues with unique games and honest snapshot age', async ({ page }) => {
  const state = await setup(page);
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.week-chip')).toContainText('8');
  const startingSpots = demoData.players.filter(player => player.leagueId === demoData.leagues[0].id).length * 2;
  await expect(page.locator('.players-panel .outline-badge')).toHaveText(`${startingSpots} starting spots`);
  await expect(page.locator('[data-testid="player-card"]').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filter BAL at BUF', exact: true })).toHaveCount(1);
  await expect(page.getByText('Shared ESPN warning.', { exact: true })).toHaveCount(1);
  await expect(page.locator('.dashboard-status')).toContainText('Last successful sync 3m ago');
  expect(state.calls.sort()).toEqual(['1', '2']);
});

test('one failed league remains visible as a warning without fabricated scores', async ({ page }) => {
  const state = await setup(page);
  state.failure = 'ESPN is temporarily unavailable.';
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.week-chip')).toContainText('8');
  await expect(page.getByRole('status').filter({ hasText: 'Private league 2:' })).toContainText('ESPN is temporarily unavailable');
  await expect(page.getByText('Demo mode', { exact: true })).toHaveCount(0);
  await expect(page.locator('.overview-strip')).toContainText('1leagues in play');
});

test('conflicting weeks reject the refresh and preserve the prior ESPN snapshot', async ({ page }) => {
  const state = await setup(page);
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.week-chip')).toContainText('8');
  state.conflict = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('different seasons or weeks');
  await expect(page.getByRole('alert')).toContainText('Showing the last successful snapshot');
  await expect(page.locator('.week-chip')).toContainText('8');
  await expect(page.getByText('Demo mode', { exact: true })).toHaveCount(0);
});

test('a per-league 401 does not become a partial authenticated dashboard', async ({ page }) => {
  const state = await setup(page);
  state.failure = 'Session expired.';
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('alert')).toContainText('Session expired');
  await expect(page.locator('[data-testid="player-card"]')).toHaveCount(0);
  await expect(page.getByText('Demo mode', { exact: true })).toHaveCount(0);
});
