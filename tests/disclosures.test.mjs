import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
test('dashboard communicates prototype limitations and ground-only blind spots',async()=>{
 const html=await read('../frontend/index.html');
 assert.match(html,/Decision-support prototype using simulated\/regional inputs/);
 assert.match(html,/Does not replace pesticide product labels, on-site measurements, or local regulations/);
 assert.match(html,/Unobservable from 5 ft/);
 for(const phrase of ['Inversion gradients above the ground sensor','Upper-canopy wind conditions','Vertical and directional wind shear between heights'])assert.ok(html.includes(phrase));
});
test('GO copy describes configured checks, not spray safety or clearance',async()=>{
 const app=await read('../frontend/app.js');
 assert.match(app,/GO — CONFIGURED WEATHER CHECKS PASSED/);
 assert.doesNotMatch(app,/SAFE TO SPRAY NOW|Looks Safe/);
 assert.match(app,/Illustrative prototype preset/);
});
test('profiles and activity exports avoid unsupported compliance claims',async()=>{
 const html=await read('../frontend/index.html'),audit=await read('../frontend/audit-ui.js');
 assert.match(html,/Illustrative screening preset/);
 assert.match(html,/Illustrative — standard contact preset/);
 assert.match(html,/Activity &amp; Decision Log/);
 assert.match(html,/Export Activity Log \(CSV\)/);
 assert.match(html,/Generate Printable Activity Summary/);
 assert.match(audit,/canopyguard-activity-log\.csv/);
 assert.match(audit,/CanopyGuard Activity &amp; Decision Log/);
 assert.doesNotMatch(audit,/Spray Compliance Report|canopyguard-pca-audit\.csv/);
});
