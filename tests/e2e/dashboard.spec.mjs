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
    const first = window.CanopyGuard.dispatchDemoEvent(action);
    const second = window.CanopyGuard.dispatchDemoEvent(action);
    const rows = window.CanopyGuardAudit.list();
    return {
      first,
      second,
      before,
      beforeTimestamp: window.CanopyGuardAudit.list().at(-1).snapshot.timestamp,
      after: rows.length,
      eventRows: rows.filter(row => row.id === action.event_id).length,
      lastTimestamp: rows.at(-1).snapshot.timestamp
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
  await page.getByRole('button', { name: 'Export PCA Audit Log (CSV)', exact: true }).click();
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
  await expect(page.locator('#audit-count')).toContainText('Temporary storage');
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
  await expect(page.locator('#decision-title')).toContainText('SAFE TO SPRAY');
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

test('production startup accepts a controlled fresh NWS response and exposes all six cities', async ({ page }) => {
  const blocked = await isolateNetwork(page, ['https://api.weather.gov']);
  const errors = captureErrors(page);
  await stubNws(page, {
    points: route => route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(pointResponse()) }),
    hourly: route => route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(hourlyResponse()) })
  });
  await page.goto('/');
  await expect(page.locator('#weather-network')).toContainText('Fresno, CA: NWS model retrieved', { timeout: 20000 });
  await expect(page.locator('#source-badge')).toContainText('NWS FORECAST');
  await expect(page.locator('#weather-location option')).toHaveCount(6);
  await expect(page.locator('#decision-title')).not.toContainText('DATA UNAVAILABLE');
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
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

  await page.unroute('https://api.weather.gov/**');
  await stubNws(page, {
    points: route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'fixture offline' }) }),
    hourly: route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
  });
  await page.reload();
  await expect(page.locator('#decision-title')).toContainText('DATA UNAVAILABLE', { timeout: 20000 });
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
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
