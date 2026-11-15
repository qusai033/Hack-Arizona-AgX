import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=path=>readFile(new URL(path,import.meta.url),'utf8');

test('SPEC-COPY: configured-check GO message and no misleading safety assurance',async()=>{
  const app=await source('../frontend/app.js');
  assert.match(app,/GO — configured weather checks passed/);
  assert.match(app,/PROTOTYPE SCREENING STATUS/);
  assert.doesNotMatch(app,/SAFE TO SPRAY NOW|CANOPYGUARD RECOMMENDATION|Looks Safe|CanopyGuard Says/);
  assert.match(app,/MODELED FORECAST SCREENING/);
  assert.match(app,/Never treat forecast GO as spray clearance/);
  assert.match(app,/Illustrative thresholds only; not product-label limits or application clearance/);
});

test('SPEC-DISCLOSURE: exact prototype disclaimer is visible in top notice and footer',async()=>{
  const html=await source('../frontend/index.html');
  const phrase='Decision-support prototype using simulated/regional inputs. Does not replace pesticide product labels, on-site measurements, or local regulations.';
  assert.equal(html.split(phrase).length-1,2,'disclaimer is both prominent and in the footer');
  assert.match(html,/<aside class="prototype-disclaimer" aria-label="Prototype limitations">/);
  assert.match(html,/<footer>[^]*Decision-support prototype using simulated\/regional inputs/);
  assert.match(html,/Forecast heights are modeled, not orchard sensor measurements/);
  assert.match(html,/not application clearance or a safety determination/);
});

test('SPEC-DISCLOSURE: ground-only limitations name every unobservable hazard',async()=>{
  const html=await source('../frontend/index.html');
  assert.match(html,/<div class="ground-limitations"><strong>Unobservable from 5 ft<\/strong>/);
  for(const name of ['Inversion gradient between 5 ft and 30 ft',
      'Upper-canopy wind speed and direction','Vertical and directional wind shear between heights']){
    assert.ok(html.includes(name),name);
  }
});

test('SPEC-PROFILE-LABELS: each built-in profile is explicitly illustrative',async()=>{
  const [html,app]=await Promise.all([source('../frontend/index.html'),source('../frontend/app.js')]);
  for(const id of ['contact_fungicide','volatile_formulation','fine_airblast','dormant_oil']){
    const match=html.match(new RegExp('<option value="'+id+'">([^<]+)<\\/option>'));
    assert.ok(match, 'missing '+id);
    assert.match(match[1],/Illustrative/);
  }
  assert.match(app,/Illustrative screening preset/);
});

test('SPEC-COPY: activity log, scoped exports and printable report avoid unsupported certification',async()=>{
  const [html,audit]=await Promise.all([source('../frontend/index.html'),source('../frontend/audit-ui.js')]);
  assert.match(html,/id="audit-title">Activity &amp; Decision Log/);
  assert.match(html,/id="audit-download"[^>]*>Export Activity Log \(CSV\)/);
  assert.match(html,/id="audit-report"[^>]*>Generate Printable Activity Summary/);
  assert.match(audit,/canopyguard-activity-log\$\{label\?'-'\+label:''\}\.csv/);
  assert.match(audit,/CanopyGuard Activity &amp; Decision Log/);
  assert.match(audit,/not compliance certification or application clearance/i);
  assert.doesNotMatch(audit,/Spray Compliance Report|canopyguard-pca-audit/);
  assert.doesNotMatch(html,/Generate Printable Spray Compliance Report|Time-stamped audit log/);
});

test('copy changes preserve all original controls, history filters, and calendar UI',async()=>{
  const html=await source('../frontend/index.html');
  const ids=['decision','decision-title','source-badge','profile-preset','volatility','nozzle',
    'weather-location','weather-fetch','canopy-view-slot','session-start','session-finish',
    'audit-panel','audit-rows','audit-record','audit-download','audit-report','audit-export-scope',
    'cal-grid','cal-prev','cal-next','cal-jump','judge-bar'];
  for(const id of ids){
    assert.equal(html.split('id="'+id+'"').length-1,1,'expected one #'+id);
  }
  const css=await source('../frontend/styles.css');
  assert.match(css,/\.prototype-disclaimer/);
  assert.match(css,/\.ground-limitations/);
  assert.match(css,/@media\(max-width:760px\)/);
});
