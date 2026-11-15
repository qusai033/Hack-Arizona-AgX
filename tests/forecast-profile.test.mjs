import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getProfile} from '../frontend/engine/profiles.js';
import {scenario} from '../frontend/demo.js';
import {reevaluateForecastModel,currentForecastPeriod} from '../frontend/forecast-profile.js';

const hour=3600000;
const nowMs=Date.parse('2026-11-15T18:00:00Z');
const fromIso=new Date(nowMs).toISOString();
function model(name='marginal', source='nws') {
  const profile=getProfile('contact_fungicide');
  const snapshots=Array.from({length:24},(_,i)=>({
    ...scenario(name,profile),
    timestamp:new Date(nowMs+i*hour).toISOString()
  }));
  return {
    source, location_id:'fresno', location_label:'Fresno, CA',
    time_zone:'America/Los_Angeles',interval_minutes:60,
    fetched_at:fromIso,issued_at:new Date(nowMs-60000).toISOString(),
    issuance_source:'updateTime',issuance_age_minutes:1,
    snapshots,window:null
  };
}

test('re-screening a forecast changes decisions and thresholds without changing weather or original NWS evidence',()=>{
  const original=model();
  const before=structuredClone(original);
  const fine=reevaluateForecastModel(original,getProfile('fine_airblast'),nowMs);
  const volatile=reevaluateForecastModel(original,getProfile('volatile_formulation'),nowMs);
  assert.equal(original.snapshots[0].evaluation.multi_height_status,'CAUTION');
  assert.equal(fine.snapshots[0].evaluation.multi_height_status,'STOP');
  assert.equal(volatile.snapshots[0].evaluation.multi_height_status,'STOP');
  assert.ok(volatile.snapshots[0].evaluation.triggered_rules.some(rule=>rule.code==='UPPER_WIND_EXCEEDED'));
  for(const screened of [fine,volatile]){
    assert.equal(screened.snapshots.length,24);
    assert.equal(screened.source,'nws');
    assert.equal(screened.location_id,'fresno');
    assert.equal(screened.fetched_at,original.fetched_at);
    assert.equal(screened.issued_at,original.issued_at);
    assert.equal(screened.issuance_source,original.issuance_source);
    assert.deepEqual(screened.snapshots.map(row=>row.readings),original.snapshots.map(row=>row.readings));
    assert.ok(screened.snapshots.every(row=>row.pesticide_profile.name===screened.snapshots[0].pesticide_profile.name));
  }
  assert.deepEqual(original,before,'do not mutate the original NWS model');
});

test('all hourly GO-window decisions are re-screened for stricter selected profiles',()=>{
  const original=model('clear');
  assert.equal(original.snapshots[0].evaluation.multi_height_status,'GO');
  const normal=reevaluateForecastModel(original,getProfile('contact_fungicide'),nowMs);
  assert.ok(normal.window.start_iso);
  const strict={...getProfile('contact_fungicide'),name:'Custom strict screening',max_wind_mph:4};
  const rechecked=reevaluateForecastModel(original,strict,nowMs);
  assert.equal(rechecked.snapshots[0].evaluation.multi_height_status,'STOP');
  assert.equal(rechecked.window.start_iso,null);
  assert.ok(rechecked.snapshots.every(row=>row.evaluation.multi_height_status==='STOP'));
  assert.equal(original.snapshots[0].evaluation.multi_height_status,'GO');
});

test('city-specific modeled forecast metadata remains unchanged after a profile selection',()=>{
  const original={...model(),location_id:'modesto',location_label:'Modesto, CA'};
  const revised=reevaluateForecastModel(original,getProfile('volatile_formulation'),nowMs);
  assert.equal(revised.location_id,'modesto');
  assert.equal(revised.location_label,'Modesto, CA');
  assert.equal(currentForecastPeriod(revised,nowMs).pesticide_profile.volatility_class,'HIGH');
  assert.equal(currentForecastPeriod(revised,nowMs+hour).timestamp,new Date(nowMs+hour).toISOString());
  const cached={...model('clear','cached_nws'),location_id:'chico',location_label:'Chico, CA'};
  const selected=reevaluateForecastModel(cached,getProfile('fine_airblast'),nowMs);
  assert.equal(selected.source,'cached_nws');
  assert.equal(selected.location_id,'chico');
  assert.equal(selected.issued_at,cached.issued_at);
});

test('re-screening rejects expired, missing, and future NWS issuance',()=>{
  const original=model();
  assert.throws(()=>reevaluateForecastModel({...original,issued_at:null},getProfile('contact_fungicide'),nowMs),/issuance/i);
  assert.throws(()=>reevaluateForecastModel({...original,issued_at:new Date(nowMs-7*hour).toISOString()},getProfile('contact_fungicide'),nowMs),/too old/i);
  assert.throws(()=>reevaluateForecastModel({...original,issued_at:new Date(nowMs+6*60000).toISOString()},getProfile('contact_fungicide'),nowMs),/future/i);
  assert.throws(()=>reevaluateForecastModel({...original,issuance_source:null},getProfile('contact_fungicide'),nowMs),/missing/i);
});

test('no expired period or invalid profile can produce a fresh screen',()=>{
  const original=model('clear');
  assert.throws(()=>currentForecastPeriod(original,nowMs+25*hour),/expired/);
  assert.throws(()=>reevaluateForecastModel(original,{...getProfile('contact_fungicide'),max_wind_mph:-1},nowMs),/max_wind_mph|profile/i);
  assert.throws(()=>reevaluateForecastModel({...original,snapshots:[]},getProfile('contact_fungicide'),nowMs),/required/i);
});
