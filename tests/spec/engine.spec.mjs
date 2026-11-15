import { test, expect, openDemo, probe, evidence } from './browser.mjs';
import { CASES, PROFILES, CONFIG, resultView, sortRules, ruleName } from './canonical.mjs';

test.beforeEach(async ({ page }) => { await openDemo(page); });

for (const fixture of CASES) {
  test(`[SPEC-RESULT] ${fixture.id}: canonical initial-frame result (§2.2)`, async ({ page }, testInfo) => {
    const actual = await probe(page, fixture);
    await evidence(testInfo, 'engine-input-context-and-output', actual);
    expect(resultView(actual.evaluation)).toEqual({ ...fixture.expected, rules: sortRules(fixture.expected.rules) });
    if (fixture.canopy.temp_f !== null) {
      // Render the real engine output, not a fabricated expected evaluation.
      await page.evaluate(value => window.CanopyGuard.setSnapshot({ ...value.input, evaluation: value.evaluation }), actual);
      await expect(page.locator('#decision')).toHaveClass(`decision ${fixture.expected.multi}`);
      await expect(page.locator('#ground-status')).toContainText(fixture.expected.ground);
      await expect(page.locator('#canopy-status')).toContainText(fixture.expected.multi);
    }
  });
}

for (const profile of PROFILES) {
  test(`[SPEC-CONFIG] ${profile.id}: effective numeric limits (§2.1)`, async ({ page }, testInfo) => {
    const actual = await page.evaluate(async id => {
      const { getProfile, thresholdsFor } = await import('/engine/index.js');
      const profile = getProfile(id), limits = thresholdsFor(profile);
      return {
        volatility: profile.volatility_class, minWind: limits.minWind, maxWind: limits.maxWind,
        windCautionAbove: limits.windCautionAbove, inversionStopAbove: limits.inversionStopAbove,
        speedShearStopAt: limits.speedShearStopAt, directionStopAt: limits.directionStopAt,
        monitorHours: limits.monitorHours
      };
    }, profile.appId);
    const expected = {
      volatility: profile.volatility_level === 'MODERATE' ? 'MEDIUM' : profile.volatility_level,
      minWind: profile.min_wind_mph, maxWind: profile.max_wind_mph,
      windCautionAbove: profile.max_wind_mph - CONFIG.caution_wind_buffer_mph,
      inversionStopAbove: profile.max_inversion_delta_f, speedShearStopAt: profile.max_speed_shear_mph,
      directionStopAt: profile.max_dir_shear_deg, monitorHours: profile.post_spray_watch_hours
    };
    await evidence(testInfo, 'profile-limits', { canonical: profile, expected, actual });
    expect(actual).toEqual(expected);
  });
}

const normal = () => ({
  ground: { temp_f: 70, wind_speed_mph: 5, wind_dir_deg: 0, humidity_pct: 60 },
  canopy: { temp_f: 69, wind_speed_mph: 5, wind_dir_deg: 0, humidity_pct: 60 }
});
const boundaries = [
  { label: 'ground 3.0 mph passes', g: { wind_speed_mph: 3 }, rules: [], status: 'GO' },
  { label: 'ground 2.9 mph stops', g: { wind_speed_mph: 2.9 }, rules: ['WIND_5FT_TOO_LOW'], status: 'STOP' },
  { label: 'canopy 8.5 mph passes', c: { wind_speed_mph: 8.5 }, rules: [], status: 'GO' },
  { label: 'canopy 8.6 mph cautions', c: { wind_speed_mph: 8.6 }, rules: ['WIND_30FT_NEAR_LIMIT'], status: 'CAUTION' },
  { label: 'inversion +1.0 F cautions', c: { temp_f: 71 }, rules: ['INVERSION_CAUTION'], status: 'CAUTION' },
  { label: 'inversion +1.1 F stops', c: { temp_f: 71.1 }, rules: ['INVERSION_STOP'], status: 'STOP' },
  { label: '75-degree shear at 3 mph stops', g: { wind_speed_mph: 3 },
    c: { wind_speed_mph: 3, wind_dir_deg: 75 }, rules: ['DIRECTIONAL_SHEAR_STOP'], status: 'STOP' },
  { label: 'direction rules suppressed below 3 mph at both heights', g: { wind_speed_mph: 2 },
    c: { wind_speed_mph: 2, wind_dir_deg: 90 }, rules: ['WIND_5FT_TOO_LOW', 'WIND_30FT_TOO_LOW'], status: 'STOP' }
];
for (const boundary of boundaries) {
  test(`[SPEC-BOUNDARY] ${boundary.label} (Team 2)`, async ({ page }, testInfo) => {
    const input = normal();
    Object.assign(input.ground, boundary.g);
    Object.assign(input.canopy, boundary.c);
    const actual = await probe(page, input);
    await evidence(testInfo, 'boundary-probe', actual);
    expect(actual.evaluation.multi_height_status).toBe(boundary.status);
    expect(actual.evaluation.triggered_rules.map(ruleName).sort()).toEqual([...boundary.rules].sort());
  });
}

// Future skew is an approved deviation from the handoff (§3.1.2 allows 5 s ahead; the application
// allows 60 s). The handoff's -6 s → STOP case is therefore replaced by the approved boundary,
// -60 s → GO and -61 s → STOP. Decision record: docs/FRESHNESS_POLICY.md (issue #47).
for (const [ageSeconds, expected] of [[300, 'GO'], [301, 'STOP'], [-5, 'GO'], [-60, 'GO'], [-61, 'STOP']]) {
  test(`[SPEC-FRESHNESS] observation age ${ageSeconds}s yields ${expected} (§3.1.2; future skew per approved deviation #47)`, async ({ page }, testInfo) => {
    const actual = await probe(page, normal(), { ageSeconds });
    await evidence(testInfo, 'explicit-clock-freshness', actual);
    expect(actual.evaluation.multi_height_status).toBe(expected);
    expect(actual.evaluation.caught_hidden_risk).toBe(false);
  });
}

test('[SPEC-PURITY] repeated evaluation is deterministic and direction wraps 355 to 10 (Team 2)', async ({ page }, testInfo) => {
  const input = normal();
  input.ground.wind_dir_deg = 355;
  input.canopy.wind_dir_deg = 10;
  const first = await probe(page, input), second = await probe(page, input);
  await evidence(testInfo, 'repeat-evaluation', { first, second });
  expect(first).toEqual(second);
  expect(first.diagnostics.direction_shear_deg).toBe(15);
  expect(first.evaluation.multi_height_status).toBe('GO');
});

test('[SPEC-PROVENANCE] numeric rules disclose illustrative cutoffs and source heights (§1.2)', async ({ page }, testInfo) => {
  const { evaluation } = await probe(page, CASES[0]);
  await evidence(testInfo, 'numeric-rule-provenance', evaluation.triggered_rules);
  for (const rule of evaluation.triggered_rules) {
    expect.soft(rule.provenance, rule.code).toBe('ILLUSTRATIVE_THRESHOLD');
    expect.soft(rule.is_upper_or_cross_height_hazard, rule.code).toBe(true);
    expect.soft(rule.source_heights, rule.code).toEqual(ruleName(rule) === 'WIND_30FT_TOO_HIGH' ? [30] : [5, 30]);
  }
});

test('[SPEC-DATA] invalid data has explicit quality, failsafe provenance and no hidden-risk credit (§3.1.1)', async ({ page }, testInfo) => {
  const { evaluation } = await probe(page, CASES[4]);
  await evidence(testInfo, 'invalid-data-evaluation', evaluation);
  expect.soft(evaluation.multi_height_status).toBe('STOP');
  expect.soft(evaluation.caught_hidden_risk).toBe(false);
  expect.soft(evaluation.data_quality?.overall_status).toBe('INVALID_OR_STALE');
  expect.soft(evaluation.triggered_rules[0].provenance).toBe('SAFETY_FAILSAFE');
});

test('[SPEC-ORDER] STOP reasons precede CAUTION reasons (Team 2)', async ({ page }, testInfo) => {
  const { evaluation } = await probe(page, CASES[3]);
  const severities = evaluation.triggered_rules.map(rule => rule.severity);
  await evidence(testInfo, 'rule-order', evaluation.triggered_rules);
  expect(severities).toEqual([...severities].sort((a, b) => (a === 'STOP' ? 0 : 1) - (b === 'STOP' ? 0 : 1)));
});

test('[SPEC-POST-SPRAY] high-volatility watch triggers on any positive gradient (Team 2)', async ({ page }, testInfo) => {
  const input = normal();
  input.canopy.temp_f = 70.1;
  const actual = await probe(page, input, {
    profileId: 'volatile_formulation',
    session: { state: 'POST_SPRAY_CURING', started_at: '2026-11-15T11:30:00.000Z',
      ended_at: '2026-11-15T12:00:00.000Z', inversion_at_end_f: -1 }
  });
  await evidence(testInfo, 'post-spray-probe', actual);
  expect(actual.evaluation.triggered_rules.map(ruleName)).toContain('POST_SPRAY_VOLATILITY_WATCH');
  expect(actual.evaluation.multi_height_status).toBe('STOP');
});
