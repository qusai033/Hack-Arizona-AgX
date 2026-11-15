import { test, expect, openDemo, evidence } from './browser.mjs';
import { CASES, PROFILES } from './canonical.mjs';

for (const fixture of CASES) {
  test(`[SPEC-SCENARIO] ${fixture.id}: selectable fixture matches the handoff (Team 1)`, async ({ page }, testInfo) => {
    await openDemo(page);
    const choices = await page.locator('[data-scenario]').evaluateAll(nodes => nodes.map(node => ({
      id: node.dataset.scenario, label: node.textContent.trim()
    })));
    await evidence(testInfo, 'available-scenarios', choices);
    const button = page.locator(`[data-scenario="${fixture.appId}"]`);
    expect(await button.count(), `Required scenario ${fixture.id} is selectable`).toBe(1);
    await button.click();
    const actual = await page.evaluate(() => {
      const snapshot = window.CanopyGuardAudit.list().at(-1).snapshot;
      const numbers = ({ temp_f, wind_speed_mph, wind_dir_deg, humidity_pct }) =>
        ({ temp_f, wind_speed_mph, wind_dir_deg, humidity_pct });
      return { ground: numbers(snapshot.readings.ground_5ft), canopy: numbers(snapshot.readings.canopy_30ft) };
    });
    await evidence(testInfo, 'selected-initial-frame', actual);
    expect(actual).toEqual({ ground: fixture.ground, canopy: fixture.canopy });
  });
}

test('[SPEC-OFFLINE] built demo reloads without external requests and each shipped scenario advances eight frames (§3.1.5)', async ({ page }, testInfo) => {
  await openDemo(page);
  await page.reload();
  await expect(page.locator('#source-badge')).toContainText('SIMULATED DATA');
  const ids = await page.locator('[data-scenario]').evaluateAll(nodes => nodes.map(node => node.dataset.scenario));
  expect(ids).toHaveLength(5);
  const results = [];
  for (const id of ids) {
    await page.locator(`[data-scenario="${id}"]`).click();
    const before = await page.evaluate(() => window.CanopyGuardAudit.list().at(-1).snapshot);
    for (let frame = 0; frame < 8; frame++) await page.locator('#weather-step').click();
    const after = await page.evaluate(() => window.CanopyGuardAudit.list().at(-1).snapshot);
    expect(Date.parse(after.timestamp) - Date.parse(before.timestamp)).toBe(8 * 60000);
    results.push({ id, before, after });
  }
  await evidence(testInfo, 'shipped-offline-scenarios-not-canonical-catalog', results);
  await page.locator('#demo-reset').click();
  await expect(page.locator('#weather-clock')).toContainText('6:45 AM');
  expect(await page.evaluate(() => window.CanopyGuardAudit.list().map(row => row.event))).toEqual(['DEMO_INIT']);
});

test('[SPEC-COPY] GO headline uses the configured-checks wording (§1.2, Team 3)', async ({ page }, testInfo) => {
  await openDemo(page);
  await page.locator('[data-scenario="clear"]').click();
  const actual = await page.locator('#decision-title').textContent();
  await evidence(testInfo, 'go-headline', { expected: 'GO — configured weather checks passed', actual });
  expect(actual).toBe('GO — configured weather checks passed');
});

test('[SPEC-COPY] records use Activity & Decision Log and make no compliance claim (§1.2)', async ({ page }, testInfo) => {
  await openDemo(page);
  const title = await page.locator('#audit-title').textContent();
  const controls = await page.locator('#audit-panel button').allTextContents();
  await evidence(testInfo, 'activity-log-labels', { title, controls });
  expect.soft(title).toBe('Activity & Decision Log');
  expect.soft(controls.join(' ')).not.toMatch(/compliance|immutable/i);
});

test('[SPEC-COPY] footer contains the canonical prototype disclaimer (§1.2)', async ({ page }, testInfo) => {
  await openDemo(page);
  const actual = await page.locator('footer').innerText();
  await evidence(testInfo, 'disclaimer', { actual });
  expect(actual).toContain('Decision-support prototype using simulated/regional inputs. Does not replace pesticide product labels, on-site measurements, or local regulations.');
});

test('[SPEC-PROFILE-LABELS] each demo profile is explicitly labeled Illustrative (§1.2)', async ({ page }, testInfo) => {
  await openDemo(page);
  const actual = [];
  for (const profile of PROFILES) {
    await page.locator('#profile-preset').selectOption(profile.appId);
    const option = await page.locator(`#profile-preset option[value="${profile.appId}"]`).textContent();
    const label = await page.locator('#profile-name').textContent();
    actual.push({ id: profile.id, option, label });
    expect.soft(option, profile.id).toMatch(/Illustrative/i);
    expect.soft(label, profile.id).toMatch(/Illustrative/i);
  }
  await evidence(testInfo, 'profile-labels', actual);
});

test('[SPEC-DISCLOSURE] ground card lists what cannot be observed from 5 ft (Team 3)', async ({ page }, testInfo) => {
  await openDemo(page);
  const actual = await page.locator('.ground-card').innerText();
  await evidence(testInfo, 'ground-only-disclosures', { actual });
  expect.soft(actual).toContain('Unobservable from 5 ft');
  for (const term of ['inversion', 'upper-canopy wind', 'directional wind shear']) {
    expect.soft(actual.toLowerCase()).toContain(term);
  }
});

test('[SPEC-BADGES] decision exposes evaluator version and data-quality status (Team 3)', async ({ page }, testInfo) => {
  await openDemo(page);
  const actual = await page.locator('#decision').innerText();
  const version = await page.evaluate(() => window.CanopyGuardAudit.list().at(-1).evidence.engine_version);
  await evidence(testInfo, 'decision-badges', { actual, version });
  expect.soft(actual).toContain(version);
  expect.soft(actual).toContain('VALID');
});

test('[SPEC-MISSING-CONTROL] missing-sensor simulation is accessible in the UI (Team 3)', async ({ page }, testInfo) => {
  await openDemo(page);
  await evidence(testInfo, 'simulator-controls', await page.locator('#weather-panel').innerText());
  expect(await page.getByRole('button', { name: /simulate missing sensor/i }).count()).toBe(1);
});

test('[SPEC-CLOCK] scenario switch clears overrides, adds 60s, and preserves history (§3.1.2)', async ({ page }, testInfo) => {
  await openDemo(page);
  await page.locator('[data-height-key="ground_5ft"][data-field="temp_f"]').evaluate(slider => {
    slider.value = '100'; slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const before = await page.evaluate(() => window.CanopyGuardAudit.list());
  await page.locator('[data-scenario="clear"]').click();
  const after = await page.evaluate(() => window.CanopyGuardAudit.list());
  await evidence(testInfo, 'scenario-switch', { before, after });
  expect(after.map(row => row.id)).toEqual(expect.arrayContaining(before.map(row => row.id)));
  expect(after).toHaveLength(before.length + 1);
  expect(Date.parse(after.at(-1).snapshot.timestamp) - Date.parse(before.at(-1).snapshot.timestamp)).toBe(60000);
  expect(after.at(-1).snapshot.readings.ground_5ft.temp_f).not.toBe(100);
  await expect(page.locator('#weather-minute')).toHaveValue('0');
});

test('[SPEC-EVENTS] identical-result profile changes retain separate action IDs (§3.1.3)', async ({ page }, testInfo) => {
  await openDemo(page);
  await page.locator('#profile-preset').selectOption('dormant_oil');
  await page.locator('#profile-preset').selectOption('contact_fungicide');
  const rows = await page.evaluate(() => window.CanopyGuardAudit.list().filter(row => row.event === 'PROFILE_CHANGED'));
  await evidence(testInfo, 'profile-events', rows);
  expect(rows).toHaveLength(2);
  expect(rows[0].id).not.toBe(rows[1].id);
  expect(rows[0].snapshot.evaluation).toEqual(rows[1].snapshot.evaluation);
  expect(rows[0].snapshot.timestamp).toBe(rows[1].snapshot.timestamp);
});

test('[SPEC-PLAYBACK] Play advances one frame per 1000ms (Team 4)', async ({ page }, testInfo) => {
  const time = new Date('2026-11-15T14:45:00.000Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 1000));
  await openDemo(page);
  await page.locator('#weather-play').click();
  await page.clock.runFor(1000);
  await page.locator('#weather-play').click();
  const ticks = await page.evaluate(() => window.CanopyGuardAudit.list().filter(row => row.event === 'SIMULATION_TICK'));
  await evidence(testInfo, 'one-second-playback', ticks);
  expect(ticks).toHaveLength(1);
});

test('[SPEC-PAUSE] Pause freezes the simulation during extended inspection (§3.1.2)', async ({ page }, testInfo) => {
  const time = new Date('2026-11-15T14:45:00.000Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 1000));
  await openDemo(page);
  await page.locator('#weather-play').click();
  await page.clock.runFor(1000);
  await page.locator('#weather-play').click();
  const before = await page.locator('#weather-clock').textContent();
  const count = await page.evaluate(() => window.CanopyGuardAudit.list().length);
  await page.clock.runFor(10 * 60000);
  const after = await page.locator('#weather-clock').textContent();
  await evidence(testInfo, 'paused-clock', { before, after, count });
  expect(after).toBe(before);
  expect(await page.evaluate(() => window.CanopyGuardAudit.list().length)).toBe(count);
  await expect(page.locator('#error-message')).toBeHidden();
});

test('[SPEC-EVALUATION-TIME] activity evidence records the explicit evaluation time (§1 contracts)', async ({ page }, testInfo) => {
  await openDemo(page);
  const row = await page.evaluate(() => window.CanopyGuardAudit.list().at(-1));
  await evidence(testInfo, 'evaluation-time-evidence', row.evidence);
  expect(row.evidence.times.evaluated_at).toBe(row.snapshot.timestamp);
});

test('[SPEC-LAYOUT] dashboard and SVG fit at 1280x800 without invalid geometry (Team 3)', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDemo(page);
  const actual = await page.evaluate(() => ({
    width: innerWidth, contentWidth: document.documentElement.scrollWidth,
    svg: document.getElementById('orchard-svg').innerHTML
  }));
  await evidence(testInfo, 'geometry', actual);
  expect(actual.contentWidth).toBeLessThanOrEqual(actual.width);
  expect(actual.svg).not.toMatch(/NaN|Infinity/);
  await expect(page.locator('#orchard-svg svg')).toBeVisible();
});
