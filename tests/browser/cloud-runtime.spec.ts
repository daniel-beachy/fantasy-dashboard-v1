import { expect, test } from '@playwright/test';
import path from 'node:path';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.REAL_CLOUD !== '1', 'Opt-in test creates and deletes a disposable dashboard against a real Worker.');

test('real Worker recovery flow persists across browser sign-out', async ({ page }, testInfo) => {
  let created = false;
  let recoveryKey = '';
  const screenshot = async (name: string) => {
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `${testInfo.project.name}-${name}.png`), fullPage: false });
  };
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Connect ESPN', exact: true })).toBeVisible();
  await screenshot('cloud-dashboard');
  await page.getByRole('button', { name: 'Connect ESPN', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your private gameday.' })).toBeVisible();
  await screenshot('cloud-welcome');
  try {
    await page.getByRole('button', { name: 'Create private dashboard', exact: true }).click();
    const field = page.getByLabel('Your recovery key', { exact: true });
    await expect(field).toBeVisible();
    created = true;
    recoveryKey = await field.inputValue();
    expect(/^hq_[A-Za-z0-9_-]{43}$/.test(recoveryKey)).toBe(true);
    await expect(page.getByRole('button', { name: 'Continue to ESPN', exact: true })).toBeDisabled();
    await page.getByLabel('I saved my recovery key in a safe place.').check();
    await page.getByRole('button', { name: 'Continue to ESPN', exact: true }).click();
    await expect(field).toHaveCount(0);
    await expect(page.getByLabel('SWID', { exact: true })).toBeVisible();
    await expect(page.getByLabel('SWID', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('espn_s2', { exact: true })).toHaveValue('');
    await screenshot('cloud-cookie-import');
    expect(await page.evaluate(key => JSON.stringify(localStorage).includes(key) || JSON.stringify(sessionStorage).includes(key), recoveryKey)).toBe(false);
    await page.getByRole('button', { name: 'Sign out this browser', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button', { name: 'Connect ESPN', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in with recovery key', exact: true }).click();
    await page.getByLabel('Recovery key', { exact: true }).fill(recoveryKey);
    await page.getByRole('button', { name: 'Unlock private dashboard', exact: true }).click();
    await expect(page.getByLabel('Recovery key', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('SWID', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Delete private dashboard', exact: true }).click();
    await page.getByLabel('I understand this permanently deletes my dashboard and saved ESPN connection.').check();
    await page.getByRole('button', { name: 'Permanently delete dashboard', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    created = false;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(testInfo.project.use.viewport!.width);
  } finally {
    if (created) {
      const removed = await page.evaluate(async key => {
        let session = await (await fetch('/api/session')).json();
        if (!session.vaultAuthenticated) {
          const login = await fetch('/api/vaults/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': session.csrfToken },
            body: JSON.stringify({ recoveryKey: key }),
          });
          if (!login.ok) return false;
          session = await (await fetch('/api/session')).json();
        }
        return (await fetch('/api/vaults/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': session.csrfToken },
          body: JSON.stringify({ confirm: true }),
        })).ok;
      }, recoveryKey);
      if (!removed) throw new Error('Disposable runtime-test dashboard cleanup failed.');
    }
  }
});
