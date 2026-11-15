import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('local production build runs with external networking blocked and preserves/exports activity', async ({ page, context }, testInfo) => {
  const externalRequests: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Disabling Wi-Fi leaves loopback available. This route reproduces that boundary,
  // and disables the HTTP cache so a hard reload really loads the local build.
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:4173') return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'CanopyGuard / Spray or wait?' })).toBeVisible();
  await expect(page.getByLabel('Activity entry count')).toHaveText('1');
  await expect(page.getByLabel('Integration status')).toContainText('placeholders');
  await page.getByRole('button', { name: 'Record Snapshot', exact: true }).click();
  await page.getByRole('button', { name: 'Record Snapshot', exact: true }).click();
  await expect(page.getByLabel('Activity entry count')).toHaveText('3');
  await page.getByLabel('Application profile', { exact: true }).selectOption('high_volatility_demo');
  await page.getByLabel('Application profile', { exact: true }).selectOption('standard_orchard');
  await expect(page.getByLabel('Activity entry count')).toHaveText('5');
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(page.getByLabel('Simulation clock', { exact: true })).toHaveText('14:01:00');
  for (const scenario of ['favorable_mixing', 'excessive_upper_wind', 'threshold_boundary', 'missing_stale_sensor', 'hidden_inversion_trap']) {
    await page.getByLabel('Scenario', { exact: true }).selectOption(scenario);
  }
  await expect(page.getByLabel('Simulation clock', { exact: true })).toHaveText('14:06:00');
  await page.getByLabel('30 ft Temperature (°F)', { exact: true }).fill('');
  await expect(page.getByLabel('Activity entry count')).toHaveText('12');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const download = await downloadPromise;
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('"rule_config_json"');
  expect(csv).toContain('""temp_f"":null');
  expect(csv).toContain('PROFILE_CHANGED');
  const ids = await page.evaluate(() => JSON.parse(localStorage.getItem('canopyguard_activity_log_v1')!).entries.map((entry: { event_id: string }) => entry.event_id));
  expect(new Set(ids).size).toBe(12);
  await page.reload();
  await expect(page.getByLabel('Activity entry count')).toHaveText('12');
  await page.getByRole('button', { name: 'Reset Demo', exact: true }).click();
  await expect(page.getByLabel('Activity entry count')).toHaveText('1');
  await expect(page.getByLabel('Simulation clock', { exact: true })).toHaveText('14:00:00');
  await expect(page.getByLabel('Application profile', { exact: true })).toHaveValue('standard_orchard');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('corrupt browser storage is handled without a blank screen', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('canopyguard_activity_log_v1', '{broken'));
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'could not be restored' })).toBeVisible();
  await expect(page.getByLabel('Activity entry count')).toHaveText('1');
  await page.getByRole('button', { name: 'Record Snapshot', exact: true }).click();
  await expect(page.getByLabel('Activity entry count')).toHaveText('2');
});
