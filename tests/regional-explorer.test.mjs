import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locations } from '../frontend/locations.js';
import { locations as dashboardLocations } from '../frontend/weather.js';
import { loadNwsHourly } from '../frontend/nws.js';
import { REGION_STATES } from '../frontend/region-boundaries.js';
import { createRegionProjection, spreadMarkers, MAP_WIDTH, MAP_HEIGHT } from '../frontend/region-map.js';
import { SAMPLE_OBSERVATIONS, DEMO_REFERENCE_TIME, assessWeatherDataset, validateWeatherRecord } from '../frontend/weather-viewer.js';
import { hourlyResponse, pointResponse } from './e2e/fixtures.mjs';

const nowMs=Date.parse('2026-11-15T18:10:00Z');
const mockFetch = (hourly=hourlyResponse({nowMs}),points=pointResponse()) => async url =>
  ({ok:true,json:async()=>url.includes('/points/')?points:hourly});

test('explorer and dashboard share all twelve locations and demo fixtures use an explicit clock',()=>{
  assert.equal(locations,dashboardLocations);
  assert.deepEqual(SAMPLE_OBSERVATIONS.map(row=>row.id),Object.keys(locations));
  assert.equal(assessWeatherDataset(SAMPLE_OBSERVATIONS,DEMO_REFERENCE_TIME).validCount,12);
  assert.equal(Object.values(locations).filter(place=>place.state==='CA').length,6);
  assert.equal(Object.values(locations).filter(place=>place.state==='AZ').length,6);
  assert.equal(validateWeatherRecord({...SAMPLE_OBSERVATIONS[0],latitude:80}).valid,false);
});

test('Census outlines and coordinate projection preserve regional geography',()=>{
  assert.deepEqual(REGION_STATES.map(state=>state.id),['AZ','CA','NV','UT']);
  assert.ok(REGION_STATES.find(state=>state.id==='AZ').rings[0].length>30);
  const project=createRegionProjection();
  const chico=project(locations.chico.longitude,locations.chico.latitude);
  const fresno=project(locations.fresno.longitude,locations.fresno.latitude);
  const willcox=project(locations.willcox_bench.longitude,locations.willcox_bench.latitude);
  assert.ok(chico[0]<fresno[0] && chico[1]<fresno[1]);
  assert.ok(fresno[0]<willcox[0] && fresno[1]<willcox[1]);
  assert.ok(project(-114.6277,32.6927)[1]<project(-110.9747,32.2226)[1],'Yuma must be north of Tucson');
  for (const region of ['all','CA','AZ']) {
    const transform=createRegionProjection(region);
    for (const place of Object.values(locations).filter(place=>region==='all'||place.state===region)) {
      const [x,y]=transform(place.longitude,place.latitude);
      assert.ok(x>0&&x<MAP_WIDTH&&y>0&&y<MAP_HEIGHT,place.label);
    }
  }
});

test('mobile map labels separate nearby Yuma stations without changing their anchors',()=>{
  const project=createRegionProjection();
  const anchors=Object.entries(locations).map(([id,place])=>{
    const [x,y]=project(place.longitude,place.latitude);return {id,x:x/800*284,y:y/640*227.2};
  });
  const original=structuredClone(anchors),points=spreadMarkers(anchors,284,227.2);
  assert.deepEqual(anchors,original);
  for(let i=0;i<points.length;i++) for(let j=i+1;j<points.length;j++) {
    assert.ok(Math.hypot(points[i].x-points[j].x,points[i].y-points[j].y)>=35.8,`${points[i].id} / ${points[j].id}`);
  }
});

test('regional NWS loader returns raw weather with separate issuance, validity, and retrieval times',async()=>{
  const result=await loadNwsHourly('fresno',{nowMs,fetchImpl:mockFetch()});
  assert.equal(result.location_id,'fresno');
  assert.equal(result.rows[0].temperature,70);
  assert.equal(result.rows[0].timestamp,'2026-11-15T18:00:00.000Z');
  assert.equal(result.issued_at,'2026-11-15T18:09:00.000Z');
  assert.equal(result.fetched_at,'2026-11-15T18:10:00.000Z');
  assert.ok(!('snapshots' in result));
});

test('regional NWS failures, stale issuance, and bad coverage never become synthetic weather',async()=>{
  await assert.rejects(loadNwsHourly('fresno',{nowMs,fetchImpl:async()=>{throw new Error('offline');}}),/offline/);
  await assert.rejects(loadNwsHourly('fresno',{nowMs,fetchImpl:mockFetch(hourlyResponse({nowMs,issuedAt:'2026-11-14T18:00:00Z'}))}),/too old/);
  const missing=hourlyResponse({nowMs});delete missing.properties.updateTime;
  await assert.rejects(loadNwsHourly('fresno',{nowMs,fetchImpl:mockFetch(missing)}),/issuance.*missing/);
  const gap=hourlyResponse({nowMs});gap.properties.periods.splice(1,1);
  await assert.rejects(loadNwsHourly('fresno',{nowMs,fetchImpl:mockFetch(gap)}),/coverage/);
  await assert.rejects(loadNwsHourly('fresno',{nowMs,fetchImpl:mockFetch(hourlyResponse({nowMs}),pointResponse('https://example.com/hourly'))}),/Unexpected NWS/);
  const future=hourlyResponse({nowMs});future.properties.periods.shift();
  assert.equal((await loadNwsHourly('fresno',{nowMs,fetchImpl:mockFetch(future)})).rows[0].timestamp,'2026-11-15T19:00:00.000Z');
});
