import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAuditLog,auditCSV} from '../frontend/audit.js';
import {dayKey,recordDay,groupByDay,monthGrid,summarizeDay,shiftMonth,shiftDay} from '../frontend/audit-calendar.js';
import {simulateWeather} from '../frontend/weather.js';

const memoryStorage=()=>{const store=new Map();return {get length(){return store.size;},key:i=>[...store.keys()][i],getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k),store};};
const at=(snapshot,timestamp)=>({...structuredClone(snapshot),timestamp});
const counter=()=>{let n=0;return()=>String(++n);};

test('records are filed under their observation date in the dashboard time zone',()=>{
  // 11:30 PM Nov 14 in Fresno is already Nov 15 in UTC: it must stay on Nov 14.
  assert.equal(dayKey('2026-11-15T07:30:00Z','America/Los_Angeles'),'2026-11-14');
  assert.equal(dayKey('2026-11-15T07:30:00Z','America/Phoenix'),'2026-11-15');
  const log=createAuditLog(null,{id:counter()});
  const trap=simulateWeather('trap');
  for(const time of ['2026-11-14T18:00:00Z','2026-11-15T07:30:00Z','2026-11-15T18:00:00Z']) log.append(at(trap,time),{source:'imported'});
  const days=groupByDay(log.list(),'America/Los_Angeles');
  assert.deepEqual([...days.keys()].sort(),['2026-11-14','2026-11-15']);
  assert.equal(days.get('2026-11-14').length,2);
  assert.equal(days.get('2026-11-15').length,1);
  assert.deepEqual(days.get('2026-11-14').map(r=>r.snapshot.timestamp),['2026-11-14T18:00:00Z','2026-11-15T07:30:00Z']);
});

test('a time zone recorded in v2 source provenance decides the day; other records use the fallback',()=>{
  const log=createAuditLog(null,{id:counter()});
  const snapshot=at(simulateWeather('trap'),'2026-11-15T07:30:00Z');
  const withZone=log.append(snapshot,{source:'imported',provenance:{time_zone:'America/Los_Angeles'}});
  const without=log.append(snapshot,{source:'imported'});
  assert.equal(recordDay(withZone,'UTC'),'2026-11-14');
  assert.equal(recordDay(without,'UTC'),'2026-11-15');
  // A stored zone the runtime cannot use falls back instead of breaking the calendar.
  assert.equal(recordDay({...without,evidence:{provenance:{time_zone:'Not/AZone'}}},'UTC'),'2026-11-15');
});

test('distinct recorded events stay distinct even when their readings match',()=>{
  const log=createAuditLog(null,{id:counter()});
  const trap=at(simulateWeather('trap'),'2026-11-15T18:00:00Z');
  log.append(trap,{source:'imported'});log.append(structuredClone(trap),{source:'imported'});
  const rows=groupByDay(log.list(),'America/Los_Angeles').get('2026-11-15');
  assert.equal(rows.length,2);
  assert.equal(summarizeDay(rows).count,2);
});

test('legacy v1 records are preserved and filed by their own dates',()=>{
  const storage=memoryStorage();
  const trap=at(simulateWeather('trap'),'2026-11-15T23:00:00Z');
  for(const [id,recorded] of [['a','2026-11-15T21:56:06Z'],['b','2026-11-15T21:56:21Z']])
    storage.setItem('canopyguard.audit.v1.'+id,JSON.stringify({id,recorded_at:recorded,event:'periodic tick',source:'demo',session:null,snapshot:trap}));
  storage.setItem('canopyguard.audit.v1.c',JSON.stringify({id:'c',recorded_at:'2026-10-02T17:00:00Z',event:'observation',source:'live',session:null,snapshot:at(trap,'2026-10-02T16:45:00Z')}));
  const rows=createAuditLog(storage).list();
  assert.equal(rows.length,3,'nothing is dropped from storage');
  const days=groupByDay(rows,'America/Los_Angeles');
  assert.deepEqual([...days.keys()].sort(),['2026-10-02','2026-11-15']);
  assert.equal(days.get('2026-11-15').length,2);
  assert.equal(recordDay(rows.find(r=>r.id==='c'),'America/Los_Angeles'),'2026-10-02');
});

test('day summary uses only that day\'s records, and a day with nothing has no summary',()=>{
  const log=createAuditLog(null,{id:counter()});
  for(const [minute,time] of [[0,'2026-11-15T16:00:00Z'],[120,'2026-11-15T18:00:00Z'],[360,'2026-11-15T22:00:00Z']])
    log.append(at(simulateWeather('clear',minute),time),{source:'imported'});
  log.append(at(simulateWeather('trap'),'2026-11-16T18:00:00Z'),{source:'imported'});
  const days=groupByDay(log.list(),'America/Los_Angeles');
  const rows=days.get('2026-11-15'), s=summarizeDay(rows);
  const temps=rows.map(r=>r.snapshot.readings.ground_5ft.temp_f);
  assert.equal(s.count,3);
  assert.equal(s.ground.temp.high,Math.max(...temps));assert.equal(s.ground.temp.low,Math.min(...temps));
  assert.equal(s.status.GO+s.status.CAUTION+s.status.STOP,3);
  assert.equal(s.first,'2026-11-15T16:00:00Z');assert.equal(s.last,'2026-11-15T22:00:00Z');
  const next=summarizeDay(days.get('2026-11-16'));
  assert.equal(next.worst,'STOP');assert.equal(next.hiddenRisks,1);assert.ok(next.maxInversion>0);
  assert.equal(summarizeDay([]),null);assert.equal(summarizeDay(undefined),null);
});

test('month grid is whole weeks, Sunday first, covering the month',()=>{
  const weeks=monthGrid('2026-11');
  assert.equal(weeks[0][0].key,'2026-11-01'); // Nov 1 2026 is a Sunday
  assert.ok(weeks.every(w=>w.length===7));
  const inMonth=weeks.flat().filter(c=>c.inMonth);
  assert.equal(inMonth.length,30);assert.equal(inMonth.at(-1).key,'2026-11-30');
  assert.equal(monthGrid('2027-02')[0][1].key,'2027-02-01');
  assert.equal(monthGrid('2026-02').length,4); // Feb 2026 is exactly four Sunday-first weeks
  assert.equal(shiftMonth('2026-01',-1),'2025-12');assert.equal(shiftMonth('2026-12',1),'2027-01');
  assert.equal(shiftDay('2026-03-01',-1),'2026-02-28');assert.equal(shiftDay('2026-12-31',1),'2027-01-01');
});

test('CSV export keeps its columns and adds each record\'s observation date last',()=>{
  const row=createAuditLog(null,{id:()=> 'r1'}).append(at(simulateWeather('trap'),'2026-11-15T07:30:00Z'),{source:'imported'});
  const [header,line]=auditCSV([row],'America/Los_Angeles').trim().split('\r\n');
  assert.ok(header.startsWith('"Log ID","Recorded UTC"'));
  assert.ok(header.endsWith('"Demo run ID","Observation date"'));
  assert.ok(line.endsWith('"2026-11-14"'));
});
