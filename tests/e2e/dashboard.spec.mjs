import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { hourlyResponse, pointResponse } from './fixtures.mjs';

async function isolateNetwork(page, allowedOrigins = []) {
  const blocked = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4173' || allowedOrigins.includes(url.origin)) {
      return route.continue();
    }
    blocked.push(url.href);
    return route.abort();
  });
  return blocked;
}

function captureErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function expectWeatherOnlySessionView(page, notice = 'Weather forecasts do not include treatment history or post-application monitoring.') {
  await expect(page.locator('#session-panel')).toBeHidden();
  const message = page.locator('#forecast #forecast-session-notice');
  await expect(message).toBeVisible();
  await expect(message).toHaveText(notice);
}

function parseCsv(input) {
  const source = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\r' || character === '\n') {
      row.push(cell);
      cell = '';
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
      if (character === '\r' && source[index + 1] === '\n') index++;
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error('CSV ended inside a quoted cell');
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function stubNws(page, handler) {
  await page.route('https://api.weather.gov/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/points/')) return handler.points(route, url);
    if (url.pathname.endsWith('/forecast/hourly')) return handler.hourly(route, url);
    return route.abort();
  });
}

async function saveDownload(download, testInfo, name) {
  const path = testInfo.outputPath(name);
  await download.saveAs(path);
  return readFile(path, 'utf8');
}

test('runs the existing adapter regression page against the built dashboard', async ({ page }) => {
  const blocked = await isolateNetwork(page);
  const errors = captureErrors(page);
  await page.goto('/__qa');
  await expect(page.locator('#results')).toHaveText('Ready');
  await page.getByRole('button', { name: 'Run adapter checks' }).click();
  await expect(page.locator('#results')).toContainText('ALL BROWSER CHECKS PASSED', { timeout: 75000 });
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});

test('one canopy card connects the diagram, sensor inspector, simulator and reset controls', async ({ page }) => {
  const blocked = await isolateNetwork(page);
  const errors = captureErrors(page);
  await page.goto('/?mode=demo');
  const canopy = page.locator('#orchard');
  await expect(canopy.locator('#orchard-svg svg')).toBeVisible();
  await expect(canopy.locator('#weather-panel')).toBeVisible();
  await expect(canopy.locator('#weather-clock')).toContainText('simulation clock 6:45 AM');
  await expect(canopy.locator('#weather-start')).toHaveText('6:45 AM');
  await expect(canopy.locator('#weather-end')).toContainText('next day');

  await canopy.getByRole('button', { name: '5 ft', exact: true }).click();
  await expect(canopy.locator('#sensor-title')).toHaveText('Inside the orchard');
  await canopy.getByRole('button', { name: '30 ft', exact: true }).click();
  await expect(canopy.locator('#sensor-title')).toHaveText('Above canopy');
  await canopy.locator('[data-height-key="canopy_30ft"][data-field="temp_f"]').evaluate(slider => {
    slider.value = '80';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(canopy.locator('#sensor-details')).toContainText('80.0°F');
  await expect(page.locator('#canopy-readings')).toContainText('80.0');
  await canopy.getByRole('button', { name: 'Reset sliders', exact: true }).click();
  await expect(canopy.locator('#sensor-details')).not.toContainText('80.0°F');

  await canopy.getByRole('button', { name: 'Step +1 minute', exact: true }).click();
  await expect(canopy.locator('#weather-clock')).toContainText('simulation clock 6:46 AM');
  await canopy.getByRole('button', { name: 'Reset Demo', exact: true }).click();
  await expect(canopy.locator('#weather-clock')).toContainText('simulation clock 6:45 AM');
  expect(await page.evaluate(() => window.CanopyGuardAudit.list().map(row => row.event))).toEqual(['DEMO_INIT']);

  await canopy.getByRole('button', { name: 'Pause animation' }).click();
  await expect(canopy.locator('#motion-toggle')).toHaveAttribute('aria-pressed', 'true');
  await canopy.getByRole('button', { name: 'Resume animation' }).click();
  await expect(canopy.locator('#motion-toggle')).toHaveAttribute('aria-pressed', 'false');
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(canopy.locator('#weather-minute')).toBeVisible();
  }
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});

test('built demo preserves unique actions, idempotent events, v2 evidence, CSV contents and reloads', async ({ page }, testInfo) => {
  const blocked = await isolateNetwork(page);
  const errors = captureErrors(page);
  await page.goto('/?mode=demo');
  await expect(page.locator('#decision-title')).toContainText('DO NOT SPRAY');
  const initialCount = await page.evaluate(() => window.CanopyGuardAudit.list().length);

  await page.getByRole('button', { name: 'Record Snapshot', exact: true }).click();
  await page.getByRole('button', { name: 'Record Snapshot', exact: true }).click();
  const repeated = await page.evaluate(() => window.CanopyGuardAudit.list().slice(-2).map(row => ({
    id: row.id,
    timestamp: row.snapshot.timestamp
  })));
  expect(repeated).toHaveLength(2);
  expect(repeated[0].id).not.toBe(repeated[1].id);
  expect(repeated[0].timestamp).toBe(repeated[1].timestamp);
  expect(await page.evaluate(() => window.CanopyGuardAudit.list().length)).toBe(initialCount + 2);

  const duplicateResult = await page.evaluate(async () => {
    const { createEvent } = await import('/events.js');
    const before = window.CanopyGuardAudit.list().length;
    const action = createEvent('SIMULATION_TICK', {}, {
      id: () => 'e2e-one-tick-only',
      now: () => '2026-11-15T06:45:00.000Z'
    });
    const beforeTimestamp = window.CanopyGuardAudit.list().at(-1).snapshot.timestamp;
    const first = window.CanopyGuard.dispatchDemoEvent(action);
    const second = window.CanopyGuard.dispatchDemoEvent(action);
    const rows = window.CanopyGuardAudit.list();
    return {
      first,
      second,
      before,
      beforeTimestamp,
      after: rows.length,
      eventRows: rows.filter(row => row.id === action.event_id).length,
      lastTimestamp: rows.find(row => row.id === action.event_id)?.snapshot.timestamp
    };
  });
  expect(duplicateResult.first).toBe(true);
  expect(duplicateResult.second).toBe(false);
  expect(duplicateResult.after).toBe(duplicateResult.before + 1);
  expect(duplicateResult.eventRows).toBe(1);
  expect(Date.parse(duplicateResult.lastTimestamp) - Date.parse(duplicateResult.beforeTimestamp)).toBe(60_000);

  await page.getByRole('button', { name: 'Demo: treated 2 hrs ago', exact: true }).click();
  await expect(page.locator('#session-state')).toContainText('POST SPRAY CURING');
  const latest = await page.evaluate(() => structuredClone(window.CanopyGuardAudit.list().at(-1)));
  expect(latest.event).toBe('SESSION_EXAMPLE');
  expect(latest.evidence.schema_version).toBe(2);
  expect(latest.evidence.evaluation_context.session.state).toBe('POST_SPRAY_CURING');
  expect(latest.evidence.evaluation_context.session.started_at).toBeTruthy();
  expect(latest.evidence.evaluation_context.session.ended_at).toBeTruthy();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Activity Log (CSV)', exact: true }).click();
  const csv = parseCsv(await saveDownload(await downloadPromise, testInfo, 'audit.csv'));
  expect(csv.length).toBeGreaterThan(1);
  const header = csv[0];
  for (const column of [
    'Log ID', 'Event', 'Session state', 'Orchard block', 'Recorded UTC', 'Observation UTC',
    'Session JSON', 'Snapshot JSON', 'Effective thresholds JSON', 'Effective profile JSON',
    'Evaluation JSON', 'Evaluation context JSON', 'Diagnostics JSON',
    'Source provenance JSON', 'Timestamp evidence JSON', 'Audit evidence JSON'
  ]) expect(header).toContain(column);

  const row = csv.find(cells => cells[header.indexOf('Log ID')] === latest.id);
  expect(row).toBeTruthy();
  const cell = name => row[header.indexOf(name)];
  expect(cell('Event')).toBe('SESSION_EXAMPLE');
  expect(cell('Session state')).toBe('POST_SPRAY_CURING');
  expect(cell('Orchard block')).toBe(latest.snapshot.orchard_block);
  expect(JSON.parse(cell('Session JSON'))).toEqual(latest.session);
  expect(JSON.parse(cell('Snapshot JSON'))).toEqual(latest.snapshot);
  expect(JSON.parse(cell('Effective thresholds JSON'))).toEqual(latest.evidence.effective_thresholds);
  expect(JSON.parse(cell('Effective profile JSON'))).toEqual(latest.evidence.effective_profile);
  expect(JSON.parse(cell('Evaluation JSON'))).toEqual(latest.snapshot.evaluation);
  expect(JSON.parse(cell('Evaluation context JSON'))).toEqual(latest.evidence.evaluation_context);
  expect(JSON.parse(cell('Diagnostics JSON'))).toEqual(latest.evidence.diagnostics);
  expect(JSON.parse(cell('Source provenance JSON'))).toEqual(latest.evidence.provenance);
  expect(JSON.parse(cell('Timestamp evidence JSON'))).toEqual(latest.evidence.times);
  expect(JSON.parse(cell('Audit evidence JSON'))).toEqual(latest.evidence);

  const stored = await page.evaluate(() => ({
    ids: window.CanopyGuardAudit.list().map(row => row.id),
    evidenceKeys: Object.keys(localStorage).filter(key => key.startsWith('canopyguard.audit.v1.'))
  }));
  expect(stored.ids).toContain(latest.id);
  expect(stored.evidenceKeys.length).toBeGreaterThan(0);
  await page.reload();
  await page.waitForFunction(id => window.CanopyGuardAudit.list().some(row => row.id === id), latest.id);
  const restored = await page.evaluate(id => {
    const row = window.CanopyGuardAudit.list().find(item => item.id === id);
    return { id: row?.id, schema: row?.evidence?.schema_version, session: row?.evidence?.evaluation_context?.session?.state };
  }, latest.id);
  expect(restored).toEqual({ id: latest.id, schema: 2, session: 'POST_SPRAY_CURING' });

  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});

test('audit storage failures stay recoverable and use visible temporary-storage status', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (String(key).startsWith('canopyguard.audit.v1.')) {
        throw new DOMException('Test quota exhausted', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };
  });
  const blocked = await isolateNetwork(page);
  const errors = captureErrors(page);
  await page.goto('/?mode=demo');
  await expect(page.locator('#audit-count')).toContainText('Storage needs attention');
  await expect(page.locator('#audit-persistence')).toBeVisible();
  await expect(page.locator('#audit-persistence')).toContainText('Browser storage is full; new activity is kept in this tab.');
  await expect(page.locator('#audit-persistence')).toContainText('export CSV before closing');
  const before = await page.evaluate(() => window.CanopyGuardAudit.list().length);
  await page.getByRole('button', { name: 'Record Snapshot', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.CanopyGuardAudit.list().length)).toBe(before + 1);
  const state = await page.evaluate(() => ({
    count: window.CanopyGuardAudit.list().length,
    stored: Object.keys(localStorage).some(key => key.startsWith('canopyguard.audit.v1.'))
  }));
  expect(state.count).toBe(before + 1);
  expect(state.stored).toBe(false);
  expect(await page.locator('#decision-title').textContent()).toContain('DO NOT SPRAY');
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});

test('dismissed alerts recur on a new risky transition and both demo reset controls work', async ({ page }) => {
  const blocked = await isolateNetwork(page);
  const errors = captureErrors(page);
  await page.goto('/?mode=demo');
  const drawer = page.locator('#alert-drawer');
  await expect(drawer).toBeVisible();
  const initialCards = await drawer.locator('.alert-card').count();
  await page.getByRole('button', { name: 'Dismiss alert toasts' }).click();
  await expect(drawer).toBeHidden();

  await page.locator('[data-scenario="clear"]').click();
  await expect(page.locator('#decision-title')).toContainText('GO — configured weather checks passed');
  await page.locator('[data-scenario="trap"]').click();
  await expect(page.locator('#decision-title')).toContainText('DO NOT SPRAY');
  await expect(drawer).toBeVisible();
  await expect.poll(() => drawer.locator('.alert-card').count()).toBeGreaterThan(initialCards);

  const clockBeforeReset = await page.locator('#weather-clock').textContent();
  const firstSlider = page.locator('#weather-sliders input').first();
  const originalValue = await firstSlider.inputValue();
  await page.evaluate(() => {
    const slider = document.querySelector('#weather-sliders input');
    slider.value = '90';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await firstSlider.inputValue()).toBe('90');
  await page.getByRole('button', { name: 'Reset sliders', exact: true }).click();
  expect(await firstSlider.inputValue()).toBe(originalValue);
  expect(await page.locator('#weather-clock').textContent()).toBe(clockBeforeReset);

  await page.getByRole('button', { name: 'Demo: treated 2 hrs ago', exact: true }).click();
  await expect(page.locator('#session-state')).toContainText('POST SPRAY CURING');
  await page.getByRole('button', { name: 'Reset demo session', exact: true }).click();
  const resetSession = await page.evaluate(() => window.CanopyGuard.getSession());
  expect(resetSession === null || resetSession.state === 'BEFORE_SPRAY').toBe(true);
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});

test('four-step judge walkthrough keeps its anchored forecast and filtered audit download', async ({ page }, testInfo) => {
  const blocked = await isolateNetwork(page);
  const errors = captureErrors(page);
  await page.goto('/?mode=demo');

  await page.locator('[data-judge="1"]').click();
  await expect(page.locator('#judge-ground')).toBeVisible();
  await page.locator('[data-judge="2"]').click();
  await expect(page.locator('#decision-title')).toContainText('DO NOT SPRAY');
  await page.locator('[data-judge="3"]').click();
  await expect(page.locator('#rules')).toContainText('Post-spray volatility alert');
  await expect(page.locator('#next-window')).toContainText('9:00 AM');
  await expect(page.locator('#next-window')).toContainText('Bundled morning replay');

  const expectedHiddenIds = await page.evaluate(() => window.CanopyGuardAudit.list()
    .filter(row => row.snapshot.evaluation.caught_hidden_risk ??
      (row.snapshot.evaluation.single_station_5ft_status === 'GO' && row.snapshot.evaluation.multi_height_status === 'STOP'))
    .map(row => row.id));
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-judge="4"]').click();
  await expect(page.locator('[data-audit-filter="hidden"]')).toHaveAttribute('aria-pressed', 'true');
  const csv = parseCsv(await saveDownload(await downloadPromise, testInfo, 'judge-hidden-audit.csv'));
  expect(csv.length).toBeGreaterThan(1);
  const idColumn = csv[0].indexOf('Log ID');
  expect(idColumn).toBeGreaterThanOrEqual(0);
  const exportedIds = csv.slice(1).map(row => row[idColumn]);
  expect(exportedIds.every(id => expectedHiddenIds.includes(id))).toBe(true);
  expect(exportedIds.length).toBeGreaterThan(0);
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});

test('production loading and fresh NWS forecasts hide the inactive treatment card and expose every location', async ({ page }) => {
  const blocked = await isolateNetwork(page, ['https://api.weather.gov']);
  const errors = captureErrors(page);
  let hourlyRequests = 0;
  let releaseForecast;
  const forecastReady = new Promise(resolve => { releaseForecast = resolve; });
  await stubNws(page, {
    points: route => route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(pointResponse()) }),
    hourly: async route => {
      hourlyRequests++;
      await forecastReady;
      return route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(hourlyResponse()) });
    }
  });
  await page.goto('/');
  try {
    await expect.poll(() => hourlyRequests).toBe(1);
    await expect(page.locator('#weather-network')).toContainText('Loading NWS hourly forecast');
    await expectWeatherOnlySessionView(page);
  } finally {
    releaseForecast();
  }
  await expect(page.locator('#weather-network')).toContainText('Fresno, CA: NWS model retrieved', { timeout: 20000 });
  await expectWeatherOnlySessionView(page);
  await expect(page.locator('#source-badge')).toContainText('NWS FORECAST');
  await expect(page.locator('#orchard')).toBeVisible();
  await expect(page.locator('#orchard #weather-panel')).toBeHidden();
  await expect(page.locator('#weather-location')).toHaveCount(1);
  await expect(page.locator('#weather-fetch')).toHaveCount(1);
  await expect(page.locator('#weather-network')).toHaveCount(1);
  await expect(page.locator('#forecast #weather-location')).toBeVisible();
  await expect(page.locator('#forecast #weather-fetch')).toBeVisible();
  await expect(page.locator('#weather-location option')).toHaveText([
    'Fresno, CA', 'Modesto, CA', 'Merced, CA', 'Bakersfield, CA', 'Chico, CA', 'Yuba City, CA',
    'Yuma Valley, AZ', 'Yuma North Gila, AZ', 'Roll, AZ', 'Maricopa, AZ', 'Safford, AZ', 'Willcox Bench, AZ'
  ]);
  await expect(page.locator('#station-check')).toBeHidden();
  await page.getByLabel('Forecast city').selectOption('modesto');
  await expect(page.locator('#weather-network')).toContainText('Modesto, CA: NWS model retrieved');
  const beforeRefresh = hourlyRequests;
  await page.getByRole('button', { name: 'Refresh NWS forecast', exact: true }).click();
  await expect.poll(() => hourlyRequests).toBeGreaterThan(beforeRefresh);
  await expect(page.locator('#weather-network')).toContainText('Modesto, CA: NWS model retrieved');
  await expect(page.locator('#decision-title')).not.toContainText('DATA UNAVAILABLE');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectWeatherOnlySessionView(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});

test('Arizona locations show the AZMET station check without changing the modeled decision', async ({ page }) => {
  const blocked = await isolateNetwork(page, ['https://api.weather.gov', 'https://api.azmet.arizona.edu']);
  const errors = captureErrors(page);
  // Keep the five-minute-old station observation inside the first forecast hour,
  // even when CI runs just after the wall clock crosses an hour boundary.
  const nowMs = Date.parse('2026-11-15T18:30:00Z');
  await page.clock.setFixedTime(nowMs);
  await stubNws(page, {
    points: route => route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(pointResponse()) }),
    hourly: route => route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(hourlyResponse({ nowMs })) })
  });
  const stationRequests = [];
  await page.route('https://api.azmet.arizona.edu/**', route => {
    const url = new URL(route.request().url());
    stationRequests.push(url.pathname);
    const id = url.pathname.split('/')[4];
    if (id !== 'az02') return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    // AZMET timestamps are Arizona local time (MST, UTC-7) without a zone.
    const datetime = new Date(nowMs - 5 * 60_000 - 7 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{
      datetime, meta_needs_review: '0', meta_station_id: 'az02', meta_station_name: 'Yuma Valley',
      relative_humidity: '40', temp_airC: '25.0', temp_air_30cmC: '23.0',
      wind_2min_spd_mean_mps: '2.0', wind_2min_vector_dir: '286'
    }] }) });
  });
  await page.goto('/');
  await expect(page.locator('#weather-network')).toContainText('Fresno, CA: NWS model retrieved', { timeout: 20000 });
  expect(stationRequests).toEqual([]);

  await page.getByLabel('Forecast city').selectOption('yuma_valley');
  const check = page.locator('#station-check');
  await expect(check).toContainText('AZMET station check · Yuma Valley (az02)');
  await expect(check).toContainText('77.0°F and 40% RH at 4.9 ft · 4.5 mph from WNW at 9.8 ft');
  await expect(check).toContainText('NWS model for this hour estimates');
  await expect(check).toContainText('air is 3.6°F warmer above — a measured near-surface inversion signal');
  await expect(check).toContainText('Station-anchored screening:');
  await expect(check).toContainText('not the recorded decision');
  // The audited decision stays the NWS-modeled screening.
  await expect(page.locator('#source-badge')).toContainText('NWS FORECAST · MODELED HEIGHTS');
  await expect(page.locator('#decision-label')).toContainText('MODELED FORECAST SCREENING');
  await expect(page.locator('#block-name')).toHaveText('Yuma Valley, AZ · forecast area');
  expect(stationRequests.every(path => /^\/v1\/observations\/15min\/az02\/\d{4}-\d\d-\d\dT\d\d:\d\d\/\*$/.test(decodeURIComponent(path)))).toBe(true);

  // A station outage leaves the forecast in place and says so.
  await page.getByLabel('Forecast city').selectOption('roll');
  await expect(page.locator('#weather-network')).toContainText('Roll, AZ: NWS model retrieved');
  await expect(check).toContainText('Station observation unavailable: AZMET HTTP 503');
  await expect(page.locator('#decision-title')).not.toContainText('DATA UNAVAILABLE');

  await page.getByLabel('Forecast city').selectOption('fresno');
  await expect(page.locator('#weather-network')).toContainText('Fresno, CA: NWS model retrieved');
  await expect(check).toBeHidden();
  expect(blocked).toEqual([]);
  // The browser itself logs the deliberate 503 from the station stub; nothing else may be logged.
  expect(errors.filter(message => !message.includes('503'))).toEqual([]);
  expect(errors.length).toBeGreaterThan(0);
});

test('production startup fails closed for stale NWS issuance and for unavailable NWS', async ({ page }) => {
  const blocked = await isolateNetwork(page, ['https://api.weather.gov']);
  const errors = captureErrors(page);
  await stubNws(page, {
    points: route => route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(pointResponse()) }),
    hourly: route => route.fulfill({
      status: 200,
      contentType: 'application/geo+json',
      body: JSON.stringify(hourlyResponse({ issuedAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString() }))
    })
  });
  await page.goto('/');
  await expect(page.locator('#decision-title')).toContainText('DATA UNAVAILABLE', { timeout: 20000 });
  await expectWeatherOnlySessionView(page);

  await page.unroute('https://api.weather.gov/**');
  await stubNws(page, {
    points: route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'fixture offline' }) }),
    hourly: route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
  });
  await page.reload();
  await expect(page.locator('#decision-title')).toContainText('DATA UNAVAILABLE', { timeout: 20000 });
  await expectWeatherOnlySessionView(page);
  expect(blocked).toEqual([]);
  // The mocked 503 is the intentional network failure under test, not a page error.
  expect(errors.filter(error => !error.includes('status of 503 (Service Unavailable)'))).toEqual([]);
});

test('late response for the previous forecast city cannot replace the newly selected city', async ({ page }) => {
  const blocked = await isolateNetwork(page, ['https://api.weather.gov']);
  const errors = captureErrors(page);
  let pointRequests = 0;
  await page.route('https://api.weather.gov/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/points/')) {
      pointRequests++;
      if (pointRequests === 1) {
        try {
          await new Promise(resolve => setTimeout(resolve, 1200));
          await route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(pointResponse()) });
        } catch {}
        return;
      }
      return route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(pointResponse()) });
    }
    if (url.pathname.endsWith('/forecast/hourly')) {
      return route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(hourlyResponse()) });
    }
    return route.abort();
  });

  const firstRequest = page.waitForRequest(request => request.url().includes('api.weather.gov/points/'));
  await page.goto('/');
  await firstRequest;
  await page.getByLabel('Forecast city').selectOption('chico');
  await expect(page.locator('#weather-network')).toContainText('Chico, CA: NWS model retrieved', { timeout: 20000 });
  await page.waitForTimeout(1400);
  await expect(page.locator('#block-name')).toContainText('Chico, CA');
  await expect(page.locator('#source-badge')).toContainText('NWS FORECAST');
  expect(pointRequests).toBeGreaterThanOrEqual(2);
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});


test('forecast profile controls re-screen NWS weather, retain the profile through city changes, and do not offer fake treatment sessions',async({page})=>{
  const blocked=await isolateNetwork(page,['https://api.weather.gov']);
  const errors=captureErrors(page);
  await stubNws(page,{
    points:route=>route.fulfill({status:200,contentType:'application/geo+json',body:JSON.stringify(pointResponse())}),
    hourly:route=>route.fulfill({status:200,contentType:'application/geo+json',body:JSON.stringify(hourlyResponse())})
  });
  await page.goto('/');
  await expect(page.locator('#weather-network')).toContainText('Fresno, CA: NWS model retrieved',{timeout:20000});
  await expect(page.locator('#profile-preset')).toBeEnabled();
  await expect(page.locator('#volatility')).toBeEnabled();
  await expect(page.locator('#nozzle')).toBeEnabled();
  await expect(page.locator('#effective-limits')).toContainText('Modeled screening limits');
  await expect(page.locator('#profile-hint')).toContainText('NWS-derived heights are MODELED');
  await expectWeatherOnlySessionView(page);
  await expect(page.locator('#demo-session-actions')).toBeHidden();
  await expect(page.locator('#session-demo-disclaimer')).toBeHidden();
  await expect(page.locator('#forecast-session-notice')).toBeVisible();
  await expect(page.locator('#demo-entry')).toBeVisible();
  await expect(page.locator('#forecast-entry')).toBeHidden();

  await page.locator('#profile-preset').selectOption('volatile_formulation');
  await expect(page.locator('#profile-name')).toContainText('Volatile Ester');
  await expect(page.locator('#volatility')).toHaveValue('HIGH');
  await expect(page.locator('#effective-limits')).toContainText('Inversion STOP >0.2°F');
  const firstEvent=await page.evaluate(()=>{
    const rows=window.CanopyGuardAudit.list().filter(row=>row.event==='PROFILE_CHANGED'&&row.source==='forecast');
    const row=rows.at(-1);
    return row&&{engine:row.evidence?.engine_version,profile:row.snapshot.pesticide_profile,
      matched:row.evidence?.reproduced_with_current_engine,
      threshold:row.evidence?.effective_thresholds?.inversionStopAbove,
      provenance:row.evidence?.provenance};
  });
  expect(firstEvent).toBeTruthy();
  expect(firstEvent.profile.volatility_class).toBe('HIGH');
  expect(firstEvent.threshold).toBe(0.2);
  expect(firstEvent.matched).toBe(true);
  expect(firstEvent.engine).toBeTruthy();
  expect(firstEvent.provenance.location_id).toBe('fresno');

  // A custom change uses the same existing evaluator and remains selected.
  await page.locator('#nozzle').selectOption('FINE');
  await expect(page.locator('#profile-preset')).toHaveValue('custom');
  await expect(page.locator('#effective-limits')).toContainText('Speed-shear STOP ≥4.5 mph');
  await page.getByLabel('Forecast city').selectOption('merced');
  await expect(page.locator('#weather-network')).toContainText('Merced, CA: NWS model retrieved',{timeout:20000});
  await expect(page.locator('#profile-preset')).toHaveValue('custom');
  await expect(page.locator('#volatility')).toHaveValue('HIGH');
  await expect(page.locator('#nozzle')).toHaveValue('FINE');
  const before=await page.evaluate(()=>window.CanopyGuardAudit.list().length);
  await page.getByRole('button',{name:'Refresh NWS forecast',exact:true}).click();
  await expect(page.locator('#weather-network')).toContainText('Merced, CA: NWS model retrieved',{timeout:20000});
  await expect(page.locator('#nozzle')).toHaveValue('FINE');
  await expect(page.locator('#volatility')).toHaveValue('HIGH');
  await expect.poll(async()=>page.evaluate(()=>window.CanopyGuardAudit.list().length)).toBeGreaterThan(before);
  const after=await page.evaluate(()=>window.CanopyGuardAudit.list().at(-1));
  expect(after.snapshot.pesticide_profile.nozzle_droplet_size).toBe('FINE');
  expect(after.snapshot.pesticide_profile.volatility_class).toBe('HIGH');
  expect(after.evidence.provenance.location_id).toBe('merced');
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});

test('visible links switch treatment-session visibility between forecast and demo modes',async({page})=>{
  const blocked=await isolateNetwork(page,['https://api.weather.gov']);
  const errors=captureErrors(page);
  await stubNws(page,{
    points:route=>route.fulfill({status:200,contentType:'application/geo+json',body:JSON.stringify(pointResponse())}),
    hourly:route=>route.fulfill({status:200,contentType:'application/geo+json',body:JSON.stringify(hourlyResponse())})
  });
  await page.goto('/?mode=demo');
  await expect(page.locator('#demo-entry')).toBeHidden();
  await expect(page.locator('#forecast-entry')).toBeVisible();
  await expect(page.locator('#session-panel')).toBeVisible();
  await expect(page.locator('#demo-session-actions')).toBeVisible();
  await expect(page.locator('#forecast-session-notice')).toBeHidden();
  await expect(page.locator('#session-demo-disclaimer')).toBeVisible();
  await expect(page.locator('#session-start')).toBeDisabled(); // Default trap is STOP.

  // Switching to the forecast hides the disconnected session card and shows one clear note.
  await page.locator('#forecast-entry').click();
  await expect(page.locator('#weather-network')).toContainText('Fresno, CA: NWS model retrieved',{timeout:20000});
  await expect(page.locator('#session-panel')).toBeHidden();
  await expect(page.locator('#demo-session-actions')).toBeHidden();
  await expect(page.locator('#forecast-session-notice')).toBeVisible();

  // Returning to demo restores the original session walkthrough and controls.
  await page.locator('#demo-entry').click();
  await expect(page.locator('#session-panel')).toBeVisible();
  await expect(page.locator('#demo-session-actions')).toBeVisible();
  await expect(page.locator('#forecast-session-notice')).toBeHidden();
  await expect(page.locator('#session-demo-disclaimer')).toBeVisible();
  await page.locator('[data-scenario="clear"]').click();
  await expect(page.locator('#session-start')).toBeEnabled();
  await page.locator('#session-start').click();
  await expect(page.locator('#session-state')).toContainText('SPRAYING');
  await page.locator('#session-finish').click();
  await expect(page.locator('#session-state')).toHaveText('POST SPRAY CURING');
  await page.locator('#forecast-entry').click();
  await expect(page.locator('#weather-network')).toContainText('Fresno, CA: NWS model retrieved');
  await expectWeatherOnlySessionView(page);
  await page.locator('#demo-entry').click();
  await expect(page.locator('#session-panel')).toBeVisible();
  await expect(page.locator('#session-state')).toHaveText('BEFORE SPRAY');
  await expect(page.locator('#forecast-session-notice')).toBeHidden();
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});

test('a malformed JSON import hides the previous demo treatment card', async ({ page }) => {
  const blocked = await isolateNetwork(page);
  const errors = captureErrors(page);
  await page.goto('/?mode=demo');
  await page.locator('#session-example').click();
  await expect(page.locator('#session-state')).toHaveText('POST SPRAY CURING');
  await page.locator('#json-file').setInputFiles({
    name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{')
  });
  await expect(page.locator('#source-badge')).toContainText('IMPORTED SNAPSHOT');
  await expect(page.locator('#error-message')).toBeVisible();
  await expectWeatherOnlySessionView(page,
    'Imported snapshots do not include connected treatment history or post-application monitoring.');
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});

for (const source of ['imported', 'live']) {
  test(`switching from a demo session to ${source} weather hides the treatment card`, async ({ page }) => {
    const blocked = await isolateNetwork(page);
    const errors = captureErrors(page);
    await page.goto('/?mode=demo');
    await page.locator('#session-example').click();
    await expect(page.locator('#session-panel')).toBeVisible();
    await expect(page.locator('#session-state')).toHaveText('POST SPRAY CURING');

    await page.evaluate(async source => {
      const { createDemoState } = await import('/demo-controller.js');
      const { snapshot } = createDemoState({ clock_iso: new Date().toISOString() });
      if (source === 'imported') window.CanopyGuard.setSnapshot(snapshot);
      else await window.CanopyGuard.connect({ mode: 'live', loadSnapshot: async () => snapshot });
    }, source);
    await expectWeatherOnlySessionView(page, source === 'imported'
      ? 'Imported snapshots do not include connected treatment history or post-application monitoring.'
      : 'Weather observations do not include treatment history or post-application monitoring.');
    expect(await page.evaluate(() => window.CanopyGuard.getSession())).toBeNull();

    await page.evaluate(() => window.CanopyGuard.useDemo('clear'));
    await expect(page.locator('#session-panel')).toBeVisible();
    await expect(page.locator('#forecast-session-notice')).toBeHidden();
    await expect(page.locator('#session-start')).toBeEnabled();
    expect(blocked).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('audit calendar files records by day, follows the latest record, and scopes the CSV export', async ({ page }, testInfo) => {
  const blocked = await isolateNetwork(page);
  const errors = captureErrors(page);
  await page.goto('/?mode=demo');
  await expect(page.locator('#decision-title')).toContainText('DO NOT SPRAY');
  await page.getByRole('button', { name: 'Record Snapshot', exact: true }).click();

  const expected = await page.evaluate(async () => {
    const { recordDay, groupByDay } = await import('/audit-calendar.js');
    const rows = window.CanopyGuardAudit.list();
    const day = recordDay(rows.at(-1), 'America/Los_Angeles');
    return { day, count: groupByDay(rows, 'America/Los_Angeles').get(day).length };
  });
  // Without a manual choice the calendar opens on the day of the most recent record (the demo clock's day).
  const selected = page.locator('#cal-grid .cal-day.selected');
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAttribute('data-day', expected.day);
  await expect(selected.locator('.cal-mark')).toHaveText(String(expected.count));
  await expect(page.locator('#audit-day')).toContainText('Worst decision: STOP');
  await expect(page.locator('#audit-day')).toContainText('Precipitation');
  await expect(page.locator('#audit-rows tr')).toHaveCount(expected.count);
  await expect(page.locator('#audit-count')).toContainText('1 day with data');

  // A day without records says so and is never filled in.
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(page.locator('#audit-day')).toContainText('No records for this date.');
  await expect(page.locator('#audit-rows .audit-empty')).toHaveCount(1);
  await page.getByRole('button', { name: /Go to latest recorded day/ }).click();
  await expect(page.locator('#cal-grid .cal-day.selected')).toHaveAttribute('data-day', expected.day);

  // Ticking a day enables the checked-days scope.
  await expect(page.locator('#audit-export-scope option[value="selected"]')).toBeDisabled();
  await page.locator('#cal-grid .cal-day.selected .cal-check').check();
  await expect(page.locator('#audit-export-scope option[value="selected"]')).toBeEnabled();
  await expect(page.locator('#cal-selected-count')).toHaveText('1 day ticked');

  await page.locator('#audit-export-scope').selectOption('day');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Activity Log (CSV)', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`canopyguard-activity-log-${expected.day}.csv`);
  const csv = parseCsv(await saveDownload(download, testInfo, 'audit-day.csv'));
  const dateColumn = csv[0].indexOf('Observation date');
  expect(dateColumn).toBe(csv[0].length - 1);
  expect(csv.length - 1).toBe(expected.count);
  for (const row of csv.slice(1)) expect(row[dateColumn]).toBe(expected.day);

  await page.setViewportSize({ width: 390, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});


test('SPEC-EVALUATION-TIME: paused demo records capture evaluation clock without rewriting action time',async({page},testInfo)=>{
  const blocked=await isolateNetwork(page);
  const errors=captureErrors(page);
  await page.goto('/?mode=demo');
  const initial=await page.evaluate(()=>window.CanopyGuardAudit.list().at(-1));
  expect(initial.evidence.times.evaluated_at).toBe(initial.snapshot.timestamp);
  expect(initial.evidence.evaluation_context.evaluationTimeMs).toBe(Date.parse(initial.snapshot.timestamp));
  await page.getByRole('button',{name:'Record Snapshot',exact:true}).click();
  await page.getByRole('button',{name:'Record Snapshot',exact:true}).click();
  const rows=await page.evaluate(()=>window.CanopyGuardAudit.list().filter(row=>row.event==='MANUAL_SNAPSHOT_RECORDED').slice(-2));
  expect(rows).toHaveLength(2);
  expect(rows[0].id).not.toBe(rows[1].id);
  for(const row of rows){
    expect(row.evidence.times.evaluated_at).toBe(initial.snapshot.timestamp);
    expect(row.evidence.times.recorded_at).toBe(row.recorded_at);
    expect(row.evidence.times.evaluated_at).not.toBe(row.recorded_at);
    expect(row.evidence.evaluation_context.evaluationTimeMs).toBe(Date.parse(row.evidence.times.evaluated_at));
  }
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export Activity Log (CSV)',exact:true}).click();
  const csv=parseCsv(await saveDownload(await downloadPromise,testInfo,'evaluation-time-demo.csv'));
  const header=csv[0],idCol=header.indexOf('Log ID'),timeCol=header.indexOf('Evaluation UTC');
  expect(timeCol).toBeGreaterThanOrEqual(0);
  for(const row of rows)expect(csv.find(cells=>cells[idCol]===row.id)?.[timeCol]).toBe(row.evidence.times.evaluated_at);
  await page.reload();
  await page.waitForFunction(ids=>ids.every(id=>window.CanopyGuardAudit.list().some(r=>r.id===id)),rows.map(x=>x.id));
  const restored=await page.evaluate(ids=>window.CanopyGuardAudit.list().filter(row=>ids.includes(row.id)),rows.map(x=>x.id));
  expect(restored.map(r=>r.evidence.times.evaluated_at)).toEqual(rows.map(r=>r.evidence.times.evaluated_at));
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});

test('forecast evaluation timestamp is separate from hourly valid, NWS issue, fetch, and record times',async({page})=>{
  const blocked=await isolateNetwork(page,['https://api.weather.gov']);
  const errors=captureErrors(page);
  await stubNws(page,{
    points:route=>route.fulfill({status:200,contentType:'application/geo+json',body:JSON.stringify(pointResponse())}),
    hourly:route=>route.fulfill({status:200,contentType:'application/geo+json',body:JSON.stringify(hourlyResponse())})
  });
  await page.goto('/');
  await expect(page.locator('#weather-network')).toContainText('Fresno, CA: NWS model retrieved',{timeout:20000});
  const first=await page.evaluate(()=>window.CanopyGuardAudit.list().filter(r=>r.source==='forecast').at(-1));
  expect(first).toBeTruthy();
  expect(first.evidence.evaluation_context.evaluationTimeMs).toBe(Date.parse(first.evidence.times.evaluated_at));
  expect(first.evidence.times.evaluated_at).not.toBe(first.evidence.times.forecast_valid_at);
  expect(first.evidence.times.evaluated_at).not.toBe(first.evidence.provenance.issued_at);
  expect(first.evidence.times.recorded_at).toBe(first.recorded_at);
  await page.locator('#profile-preset').selectOption('volatile_formulation');
  const latest=await page.evaluate(()=>window.CanopyGuardAudit.list().filter(r=>r.source==='forecast'&&r.event==='PROFILE_CHANGED').at(-1));
  expect(latest).toBeTruthy();
  expect(latest.evidence.reproduced_with_current_engine).toBe(true);
  expect(latest.evidence.evaluation_context.evaluationTimeMs).toBe(Date.parse(latest.evidence.times.evaluated_at));
  expect(latest.evidence.provenance.location_id).toBe('fresno');
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});


test('SPEC-COPY and SPEC-DISCLOSURE: demo shows illustrative inputs, a no-clearance disclaimer and 5-ft blind spots',async({page})=>{
  const blocked=await isolateNetwork(page);
  const errors=captureErrors(page);
  await page.goto('/?mode=demo');
  const disclaimer='Decision-support prototype using simulated/regional inputs. Does not replace pesticide product labels, on-site measurements, or local regulations.';
  await expect(page.locator('.prototype-disclaimer')).toContainText(disclaimer);
  await expect(page.locator('footer')).toContainText(disclaimer);
  await expect(page.locator('.ground-limitations')).toContainText('Unobservable from 5 ft');
  for(const term of ['Inversion gradient','Upper-canopy wind','directional wind shear']){
    await expect(page.locator('.ground-limitations')).toContainText(term);
  }
  for(const id of ['contact_fungicide','volatile_formulation','fine_airblast','dormant_oil']){
    await page.locator('#profile-preset').selectOption(id);
    await expect(page.locator('#profile-name')).toContainText('Illustrative');
    await expect(page.locator('#profile-hint')).toContainText('Illustrative thresholds only');
  }
  await page.locator('#profile-preset').selectOption('contact_fungicide');
  await page.locator('[data-scenario="clear"]').click();
  await expect(page.locator('#decision-title')).toHaveText('GO — configured weather checks passed');
  await expect(page.locator('#decision-label')).toContainText('PROTOTYPE SCREENING STATUS');
  await expect(page.locator('#audit-title')).toHaveText('Activity & Decision Log');
  await expect(page.locator('#audit-download')).toHaveText('Export Activity Log (CSV)');
  await expect(page.locator('#audit-report')).toHaveText('Generate Printable Activity Summary');
  await page.evaluate(()=>{window.print=()=>{}});
  await page.locator('#audit-report').click();
  await expect(page.locator('#audit-print h1')).toHaveText('CanopyGuard Activity & Decision Log');
  for(const width of [1280,768,390]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  }
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});

test('production forecast keeps modeled-source warnings alongside the new configured-check wording',async({page})=>{
  const blocked=await isolateNetwork(page,['https://api.weather.gov']);
  const errors=captureErrors(page);
  await stubNws(page,{
    points:route=>route.fulfill({status:200,contentType:'application/geo+json',body:JSON.stringify(pointResponse())}),
    hourly:route=>route.fulfill({status:200,contentType:'application/geo+json',body:JSON.stringify(hourlyResponse())})
  });
  await page.goto('/');
  await expect(page.locator('#weather-network')).toContainText('NWS model retrieved',{timeout:20000});
  await expect(page.locator('#decision-label')).toContainText('MODELED FORECAST SCREENING');
  await expect(page.locator('#decision-note')).toContainText('NOT measured orchard conditions');
  await expect(page.locator('.prototype-disclaimer')).toContainText('not application clearance or a safety determination');
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});

test('a displayed NWS model is kept after a failed refresh only until its issuance passes the 6-hour limit (#47)', async ({ page }) => {
  const blocked = await isolateNetwork(page, ['https://api.weather.gov']);
  const errors = captureErrors(page);
  const startMs = Date.parse('2026-11-15T18:00:00Z');
  await page.clock.install({ time: startMs });
  let online = true;
  const offline = route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  await stubNws(page, {
    points: route => online ? route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(pointResponse()) }) : offline(route),
    // Issued 5 h 59 m 15 s before the page clock: 45 seconds inside the 6-hour issuance limit.
    hourly: route => online ? route.fulfill({ status: 200, contentType: 'application/geo+json',
      body: JSON.stringify(hourlyResponse({ nowMs: startMs, issuedAt: new Date(startMs - (6 * 3600 - 45) * 1000).toISOString() })) }) : offline(route)
  });
  const dropCache = () => page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('canopyguard-nws-')) localStorage.removeItem(key); });

  await page.goto('/');
  await expect(page.locator('#weather-network')).toContainText('NWS model retrieved', { timeout: 20000 });
  await expect(page.locator('#decision-title')).not.toContainText('DATA UNAVAILABLE');

  // NWS goes down and no cached copy exists: the displayed model stays, labelled, while still within the limit.
  online = false;
  await dropCache();
  await page.clock.runFor(30000); // issuance age 6 h − 15 s
  await expect(page.locator('#forecast-source')).toContainText('PREVIOUS NWS MODEL (REFRESH FAILED)');
  await expect(page.locator('#decision-title')).not.toContainText('DATA UNAVAILABLE');

  await dropCache();
  await page.clock.runFor(30000); // issuance age 6 h + 15 s
  await expect(page.locator('#decision-title')).toContainText('DATA UNAVAILABLE');
  await expect(page.locator('#forecast-source')).toContainText('FORECAST UNAVAILABLE');
  expect(blocked).toEqual([]);
  expect(errors.filter(error => !error.includes('status of 503 (Service Unavailable)'))).toEqual([]);
});


test('SPEC-BADGES: demo displays real evaluator version, per-height quality and illustrative rule provenance',async({page})=>{
  const blocked=await isolateNetwork(page);
  const errors=captureErrors(page);
  await page.goto('/?mode=demo');
  const last=await page.evaluate(()=>window.CanopyGuardAudit.list().at(-1));
  expect(last.evidence.engine_version).toBeTruthy();
  expect(last.snapshot.evaluation.data_quality.overall_status).toBe('VALID');
  await expect(page.locator('#decision')).toContainText(last.evidence.engine_version);
  await expect(page.locator('#decision-metadata')).toContainText('Input VALID');
  await expect(page.locator('#decision-metadata')).toContainText('5 ft VALID');
  await expect(page.locator('#decision-metadata')).toContainText('30 ft VALID');
  await expect(page.locator('#decision-metadata')).toContainText('Freshness not assessed');
  await expect(page.locator('#decision-metadata')).toContainText('ILLUSTRATIVE_THRESHOLD');
  await expect(page.locator('.rule-origin').first()).toContainText('Source heights:');
  await page.locator('[data-scenario="clear"]').click();
  await expect(page.locator('#decision-metadata')).toContainText('No rules triggered');
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});

test('source badges never invent input quality or rule origin for imported evaluations and rejected data',async({page})=>{
  const blocked=await isolateNetwork(page);
  const errors=captureErrors(page);
  await page.goto('/?mode=demo');
  const stored=await page.evaluate(()=>window.CanopyGuardAudit.list().at(-1).snapshot);
  // The same snapshot is now an *imported external result*: no built-in origin
  // can safely be claimed merely because its JSON contains optional metadata.
  await page.evaluate(snapshot=>window.CanopyGuard.setSnapshot(snapshot),stored);
  await expect(page.locator('#decision-metadata')).toContainText('Evaluator unverified');
  await expect(page.locator('#decision-metadata')).toContainText('Input quality unverified');
  await expect(page.locator('#decision-metadata')).toContainText('Rule provenance unavailable');
  await expect(page.locator('#decision-metadata')).not.toContainText('Input VALID');
  await page.evaluate(snapshot=>{
    const broken=structuredClone(snapshot);broken.readings.canopy_30ft.temp_f=null;
    try{window.CanopyGuard.setSnapshot(broken);}catch{}
  },stored);
  await expect(page.locator('#decision-title')).toContainText('DATA UNAVAILABLE');
  await expect(page.locator('#decision-metadata')).toContainText('Input quality unavailable');
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});

test('NWS model badges distinguish valid input structure from verified orchard sensor measurements',async({page})=>{
  const blocked=await isolateNetwork(page,['https://api.weather.gov']);
  const errors=captureErrors(page);
  await stubNws(page,{
    points:route=>route.fulfill({status:200,contentType:'application/geo+json',body:JSON.stringify(pointResponse())}),
    hourly:route=>route.fulfill({status:200,contentType:'application/geo+json',body:JSON.stringify(hourlyResponse())})
  });
  await page.goto('/');
  await expect(page.locator('#weather-network')).toContainText('NWS model retrieved',{timeout:20000});
  await expect(page.locator('#decision-metadata')).toContainText('Input VALID');
  await expect(page.locator('#decision-metadata')).toContainText('HEIGHTS MODELED');
  await expect(page.locator('#decision-metadata')).toContainText('Freshness not assessed');
  const record=await page.evaluate(()=>window.CanopyGuardAudit.list().filter(row=>row.source==='forecast').at(-1));
  expect(record.evidence.engine_version).toBeTruthy();
  await expect(page.locator('#decision-metadata')).toContainText(record.evidence.engine_version);
  expect(record.evidence.diagnostics.data_quality.overall_status).toBe('VALID');
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});
