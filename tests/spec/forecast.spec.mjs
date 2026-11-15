import { test, expect, evidence } from './browser.mjs';
import { hourlyResponse, pointResponse } from '../e2e/fixtures.mjs';

async function controlledNws(page, issuedAgeSeconds = 60) {
  const now = Date.now();
  let requests = 0;
  await page.clock.install({ time: new Date(now) });
  await page.clock.pauseAt(new Date(now + 1000));
  await page.route('https://api.weather.gov/**', route => {
    const url = new URL(route.request().url());
    const body = url.pathname.startsWith('/points/') ? pointResponse() : hourlyResponse({
      nowMs: now, issuedAt: new Date(now - issuedAgeSeconds * 1000).toISOString()
    });
    if (url.pathname.endsWith('/forecast/hourly')) requests++;
    return route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(body) });
  });
  return () => requests;
}

test('[SPEC-FORECAST-REFRESH] production loads initially and refreshes at 30 seconds (later requirement)', async ({ page }, testInfo) => {
  const requests = await controlledNws(page);
  await page.goto('/');
  await expect(page.locator('#weather-network')).toContainText('NWS model retrieved');
  expect(requests()).toBe(1);
  await page.clock.runFor(29999);
  expect(requests()).toBe(1);
  await page.clock.runFor(1);
  await expect.poll(requests).toBe(2);
  await expect(page.locator('#weather-network')).toContainText('NWS model retrieved');
  await expect(page.locator('#weather-panel')).toBeHidden();
  await expect(page.locator('#weather-location')).toBeVisible();
  await evidence(testInfo, 'refresh', { hourlyRequests: requests(), status: await page.locator('#weather-network').textContent() });
});

for (const [ageSeconds, label] of [[7201, 'issuance older than two hours'], [-7, 'issuance more than five seconds ahead']]) {
  test(`[SPEC-FORECAST-AGE] reject ${label} independently of valid time (§3.1.4)`, async ({ page }, testInfo) => {
    await controlledNws(page, ageSeconds);
    await page.goto('/');
    await page.waitForFunction(() => {
      const text = document.getElementById('weather-network').textContent;
      return text.length > 0 && !text.startsWith('Loading');
    });
    const actual = {
      decision: await page.locator('#decision-title').textContent(),
      source: await page.locator('#source-badge').textContent(),
      network: await page.locator('#weather-network').textContent()
    };
    await evidence(testInfo, 'issuance-age-policy', { ageSeconds, actual });
    expect(actual.decision).toContain('DATA UNAVAILABLE');
  });
}
