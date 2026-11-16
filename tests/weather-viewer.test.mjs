import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SAMPLE_OBSERVATIONS,validateWeatherRecord,assessWeatherDataset,formatObservationAge} from '../frontend/weather-viewer.js';

const now=Date.parse('2026-11-15T16:00:00Z');
test('sample records carry coordinates, weather values, source, and timestamps',()=>{
  assert.equal(SAMPLE_OBSERVATIONS.length,12);
  for(const record of SAMPLE_OBSERVATIONS) assert.equal(validateWeatherRecord(record).valid,true);
});
test('record validation reports missing and out-of-range fields without filling them',()=>{
  const result=validateWeatherRecord({...SAMPLE_OBSERVATIONS[0],temperatureF:null,humidityPct:140,source:''});
  assert.equal(result.valid,false);
  assert.ok(result.errors.some(message=>message.includes('Temperature')));
  assert.ok(result.errors.some(message=>message.includes('humidity')));
  assert.ok(result.errors.some(message=>message.includes('Source')));
});
test('dataset assessment flags stale, future, and duplicate records',()=>{
  const records=[
    {...SAMPLE_OBSERVATIONS[0],id:'same'},
    {...SAMPLE_OBSERVATIONS[1],id:'same'},
    {...SAMPLE_OBSERVATIONS[2],observedAt:'2026-11-15T08:00:00Z'},
    {...SAMPLE_OBSERVATIONS[3],observedAt:'2026-11-15T17:00:00Z'}
  ];
  const result=assessWeatherDataset(records,now);
  assert.equal(result.total,4);
  assert.equal(result.validCount,1);
  assert.equal(result.invalidCount,3);
  assert.ok(result.entries[1].errors.includes('Duplicate record ID'));
  assert.ok(result.entries[2].errors.some(message=>message.includes('older')));
  assert.ok(result.entries[3].errors.some(message=>message.includes('future')));
});
test('empty datasets and invalid clocks are handled explicitly',()=>{
  assert.deepEqual(assessWeatherDataset([],now),{total:0,validCount:0,invalidCount:0,entries:[]});
  assert.throws(()=>assessWeatherDataset([],NaN),/clock/);
  assert.equal(validateWeatherRecord(null).valid,false);
});
test('observation age formatting is explicit for old and future timestamps',()=>{
  assert.equal(formatObservationAge('2026-11-15T15:30:00Z',now),'30 min ago');
  assert.equal(formatObservationAge('2026-11-15T13:00:00Z',now),'3 hr ago');
  assert.equal(formatObservationAge('2026-11-15T17:00:00Z',now),'Future timestamp');
});
