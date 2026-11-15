import { test as base, expect } from '@playwright/test';
import { SPEC_TIME } from './canonical.mjs';

export const test = base.extend({
  networkGuard: [async ({ page }, use) => {
    const unexpected = [], failed = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => failed.push(request.url()));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === 'http://127.0.0.1:4173') return route.continue();
      unexpected.push(route.request().url());
      return route.abort();
    });
    // Explicit NWS fixtures are registered later, so they take precedence over this route.
    await use();
    expect(errors, 'Uncaught browser errors').toEqual([]);
    expect(unexpected, 'Unmocked external dependencies').toEqual([]);
    expect(failed, 'Failed requests, including local assets').toEqual([]);
  }, { auto: true }]
});
export { expect };

export async function openDemo(page) {
  await page.goto('/?mode=demo');
  await expect(page.locator('#source-badge')).toContainText('SIMULATED DATA');
  await expect(page.locator('#weather-panel')).toBeVisible();
}

export async function evidence(testInfo, name, value) {
  await testInfo.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' });
}

export async function probe(page, fixture, { profileId = 'contact_fungicide', ageSeconds = 0, session = null } = {}) {
  return page.evaluate(async ({ fixture, profileId, ageSeconds, session, now }) => {
    const { analyze, getProfile } = await import('/engine/index.js');
    const compass = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    const mapReading = value => ({ ...value, wind_dir_cardinal: compass[Math.round(value.wind_dir_deg / 22.5) % 16] });
    const input = {
      timestamp: new Date(Date.parse(now) - ageSeconds * 1000).toISOString(),
      scenario_name: fixture.id ?? 'Canonical boundary probe', orchard_block: 'Specification test block',
      readings: { ground_5ft: mapReading(fixture.ground), canopy_30ft: mapReading(fixture.canopy) },
      pesticide_profile: getProfile(profileId)
    };
    const context = { nowMs: Date.parse(now), maxAgeMs: 300000 };
    if (session) context.session = { ...session, orchard_block: input.orchard_block, pesticide_profile: input.pesticide_profile };
    const output = analyze(input, context);
    return { input, context, ...output };
  }, { fixture, profileId, ageSeconds, session, now: SPEC_TIME });
}
