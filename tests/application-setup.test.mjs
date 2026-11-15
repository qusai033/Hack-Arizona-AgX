import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../frontend/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../frontend/styles.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../frontend/app.js', import.meta.url), 'utf8');
const start = html.indexOf('<section class="profile-panel"');
const end = html.indexOf('</section>', start);
const panel = html.slice(start, end);

test('Application Setup separates its heading, aligned selectors and helper text', () => {
  assert.ok(start >= 0 && end > start, 'Application Setup section exists');
  const heading = panel.indexOf('class="profile-heading"');
  const controls = panel.indexOf('class="profile-controls"');
  const help = panel.indexOf('class="profile-help"');
  assert.ok(heading >= 0 && heading < controls && controls < help);
  assert.ok(panel.indexOf('id="profile-name"') < controls);
  assert.ok(panel.indexOf('id="effective-limits"') > controls);
  assert.ok(panel.indexOf('id="profile-hint"') > help);
  const preset = panel.indexOf('id="profile-preset"');
  const volatility = panel.indexOf('id="volatility"');
  const nozzle = panel.indexOf('id="nozzle"');
  assert.ok(controls < preset && preset < volatility && volatility < nozzle && nozzle < help);
});

test('all three controls preserve associated labels, options, and change handlers', () => {
  for (const id of ['profile-preset', 'volatility', 'nozzle']) {
    assert.equal(html.split('id="' + id + '"').length - 1, 1, id + ' ID is unique');
    assert.match(panel, new RegExp('<label[^>]*for="' + id + '"[\\s\\S]*?<select id="' + id + '"'));
    assert.ok(app.includes("$('" + id + "').addEventListener('change'"), id + ' event handler is retained');
  }
  assert.match(panel, /<option value="custom" disabled>/);
  assert.match(panel, /<option value="HIGH">High volatility<\/option>/);
  assert.match(panel, /<option value="FINE">Fine droplets<\/option>/);
});

test('profile controls share sizing and responsive rules for tablet and mobile', () => {
  assert.match(css, /\.profile-panel \.profile-controls\s*\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.profile-panel \.profile-controls \.selectors\s*\{[^}]*display:contents/);
  assert.match(css, /\.profile-panel \.profile-controls select\s*\{[^}]*height:50px;[^}]*width:100%|\.profile-panel \.profile-controls select\s*\{[^}]*width:100%;[^}]*height:50px/);
  assert.match(css, /@media\(max-width:980px\)\s*\{\s*\.profile-panel \.profile-controls/);
  assert.match(css, /@media\(max-width:600px\)\s*\{[\s\S]*?\.profile-panel \.profile-controls \.selectors/);
  assert.match(css, /\.profile-panel \.profile-heading #profile-name\s*\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.profile-panel \.profile-controls select:disabled/);
});
