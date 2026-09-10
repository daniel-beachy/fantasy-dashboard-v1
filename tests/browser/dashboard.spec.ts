import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('./', { waitUntil: 'domcontentloaded' });
});

test('renders an honest, responsive gameday view', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Every player. Every league. One view.' })).toBeVisible();
  await expect(page.getByText('Demo mode', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Currently playing' })).toBeVisible();
  await expect(page.locator('[data-testid="player-card"]').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('search, side filters, and empty-state reset work', async ({ page }) => {
  await page.getByPlaceholder('Find a player, team, or position').fill('Josh Allen');
  const cards = page.locator('[data-testid="player-card"]');
  await expect(cards).toHaveCount(2);
  await page.getByRole('button', { name: 'Opponents', exact: true }).click();
  await expect(cards).toHaveCount(1);
  await page.getByPlaceholder('Find a player, team, or position').fill('NoSuchPlayer');
  await expect(page.getByText('No players in this huddle')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
  await expect(cards.first()).toBeVisible();
});

test('watchlist is persistent and player details are actionable', async ({ page }) => {
  await page.getByRole('button', { name: 'Watch Josh Allen' }).first().click();
  await page.getByRole('button', { name: 'Watchlist', exact: true }).click();
  await expect(page.locator('[data-testid="player-card"]')).toHaveCount(2);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Watchlist', exact: true }).click();
  await expect(page.locator('[data-testid="player-card"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'View Josh Allen details' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Josh Allen', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('league selection and game selection are composable', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter Sunday Diehards' }).click();
  await expect(page.locator('[data-testid="player-card"]').first()).toBeVisible();
  expect(await page.locator('[data-testid="player-card"]').evaluateAll(cards => cards.every(c => c.textContent?.includes('Sunday Diehards')))).toBe(true);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
  await page.getByRole('button', { name: 'Filter BAL at BUF' }).click();
  expect(await page.locator('[data-testid="player-card"]').evaluateAll(cards => cards.every(c => /BAL|BUF/.test(c.textContent || '')))).toBe(true);
});

test('theme toggle and connection dialog work without claiming authentication', async ({ page }) => {
  const before = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  expect(await page.locator('html').getAttribute('data-theme')).not.toBe(before);
  await page.getByRole('button', { name: 'Connect ESPN', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your leagues. Connected.' })).toBeVisible();
  await expect(page.getByText(/password/i).first()).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByText('Demo mode', { exact: true })).toBeVisible();
});
