import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAlertLifecycle, reasonSignature} from '../frontend/alert-state.js';
import {simulateWeather} from '../frontend/weather.js';

let sequence=0;
const row=(snapshot=simulateWeather('trap'),extra={})=>({id:`alert-${++sequence}`,source:'demo',
  demo_run_id:'run-a',snapshot,session:null,...extra});
test('reason signatures ignore ordering, duplicate rules, and changing metric text',()=>{
  const a=simulateWeather('trap'),b=structuredClone(a);
  b.evaluation.triggered_rules.reverse();
  b.evaluation.triggered_rules.push({...b.evaluation.triggered_rules[0],metric:'Different numeric reading'});
  assert.equal(reasonSignature(a.evaluation),reasonSignature(b.evaluation));
  const alerts=createAlertLifecycle();
  assert.equal(alerts.accept(row(a)).notify,true);
  assert.equal(alerts.accept(row(b)).notify,false);
  b.evaluation.triggered_rules.push({code:'ADDITIONAL_HAZARD',severity:'STOP'});
  assert.equal(alerts.accept(row(b)).notify,true);
});
test('dismissal persists until GO clears the condition; repeated event processing is a no-op',()=>{
  const alerts=createAlertLifecycle(),first=row();
  assert.equal(alerts.accept(first).notify,true);
  alerts.dismiss(first.id);
  assert.equal(alerts.list()[0].dismissed,true);
  assert.equal(alerts.accept(row()).notify,false);
  assert.equal(alerts.accept(first,{force:true}).notify,false);
  assert.equal(alerts.accept(row(simulateWeather('clear'))).notify,false);
  assert.deepEqual(alerts.list(),[]);
  assert.equal(alerts.accept(row()).notify,true);
});
test('source, orchard, treatment state, and severity changes can independently notify',()=>{
  const alerts=createAlertLifecycle();
  assert.equal(alerts.accept(row()).notify,true);
  const other=simulateWeather('trap');other.orchard_block='Another orchard';
  assert.equal(alerts.accept(row(other)).notify,true);
  assert.equal(alerts.accept(row(undefined,{source:'live',demo_run_id:undefined})).notify,true);
  assert.equal(alerts.accept(row(undefined,{session:{state:'SPRAYING_IN_PROGRESS'}})).notify,true);
  const caution=simulateWeather('evaporation');caution.evaluation.multi_height_status='CAUTION';
  assert.equal(alerts.accept(row(caution)).notify,true);
});
test('one forced judge reveal notifies once; reset silences only its own demo condition',()=>{
  const alerts=createAlertLifecycle(),first=row(),live=row(undefined,{source:'live',demo_run_id:undefined});
  alerts.accept(first);alerts.accept(live);
  const reveal=row();
  assert.equal(alerts.accept(reveal,{force:true}).notify,true);
  assert.equal(alerts.accept(reveal,{force:true}).notify,false);
  alerts.resetDemo('run-a');
  assert.equal(alerts.list().length,1);
  assert.equal(alerts.list()[0].source,'live');
  assert.equal(alerts.accept(row(),{silent:true}).notify,false);
  assert.equal(alerts.list().find(a=>a.source==='demo').dismissed,true);
  assert.equal(alerts.accept(row()).notify,false);
});
