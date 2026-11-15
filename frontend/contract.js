export const STATUSES = ['GO', 'CAUTION', 'STOP'];
const fail = (path, message) => { throw new TypeError(`${path}: ${message}`); };
function object(value, path, keys, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
  for (const key of keys) if (!(key in value)) fail(`${path}.${key}`, 'required');
  for (const key of Object.keys(value)) if (!keys.includes(key) && !optional.includes(key)) fail(`${path}.${key}`, 'unexpected field');
}
function text(value, path) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) fail(path, 'expected nonempty text (max 2000 characters)');
}
function number(value, path, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) fail(path, `expected a finite number from ${min} to ${max}`);
}
function enumeration(value, path, choices) {
  if (!choices.includes(value)) fail(path, `expected ${choices.join(', ')}`);
}
export function assertWeatherInput(data) {
  object(data, 'snapshot', ['timestamp', 'scenario_name', 'orchard_block', 'readings', 'pesticide_profile'], ['evaluation']);
  for (const k of ['timestamp','scenario_name','orchard_block']) text(data[k], k);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(data.timestamp) || !Number.isFinite(Date.parse(data.timestamp))) fail('timestamp', 'expected ISO 8601 with timezone');
  object(data.readings, 'readings', ['ground_5ft','canopy_30ft']);
  for (const height of ['ground_5ft','canopy_30ft']) assertReading(data.readings[height],height);
  assertProfile(data.pesticide_profile);
  return data;
}
/** The same field contract for a single height, reused by the evaluator's
 * independent-quality preflight. Do not infer missing measurements.
 */
export function assertReading(r,height) {
  if(!['ground_5ft','canopy_30ft'].includes(height))fail('height','unknown weather height');
  const p=`readings.${height}`;
  object(r, p, ['temp_f','humidity_pct','wind_speed_mph','wind_dir_deg','wind_dir_cardinal']);
  number(r.temp_f, `${p}.temp_f`, -100, 180);
  number(r.humidity_pct, `${p}.humidity_pct`, 0, 100);
  number(r.wind_speed_mph, `${p}.wind_speed_mph`, 0, 250);
  number(r.wind_dir_deg, `${p}.wind_dir_deg`, 0, 359.999999);
  enumeration(r.wind_dir_cardinal, `${p}.wind_dir_cardinal`, ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']);
  return r;
}
export function assertProfile(p) {
  object(p, 'pesticide_profile', ['name','volatility_class','nozzle_droplet_size','min_wind_mph','max_wind_mph','post_spray_monitor_hours']);
  text(p.name, 'pesticide_profile.name');
  enumeration(p.volatility_class, 'volatility_class', ['LOW','MEDIUM','HIGH']);
  enumeration(p.nozzle_droplet_size, 'nozzle_droplet_size', ['COARSE','MEDIUM','FINE']);
  number(p.min_wind_mph, 'min_wind_mph', 0, 250);
  number(p.max_wind_mph, 'max_wind_mph', p.min_wind_mph, 250);
  number(p.post_spray_monitor_hours, 'post_spray_monitor_hours', 0, 168);
  return p;
}
const qualityIssues=(value,path)=>{
  if(!Array.isArray(value)||value.length>16)fail(path,'expected an array of up to 16 issues');
  value.forEach((item,i)=>text(item,`${path}[${i}]`));
};
function assertDataQuality(q){
  object(q,'data_quality',['overall_status','assessment','age_ms','evaluated_at','issues','ground_5ft','canopy_30ft']);
  enumeration(q.overall_status,'data_quality.overall_status',['VALID','INVALID_OR_STALE']);
  enumeration(q.assessment,'data_quality.assessment',['STRUCTURE_ONLY','STRUCTURE_AND_AGE']);
  if(q.age_ms!==null&&!Number.isFinite(q.age_ms))fail('data_quality.age_ms','expected finite milliseconds or null');
  if(q.evaluated_at!==null&&(typeof q.evaluated_at!=='string'||!Number.isFinite(Date.parse(q.evaluated_at))))
    fail('data_quality.evaluated_at','expected ISO timestamp or null');
  qualityIssues(q.issues,'data_quality.issues');
  for(const height of ['ground_5ft','canopy_30ft']){
    const p=`data_quality.${height}`,layer=q[height];
    object(layer,p,['status','age_ms','issues']);
    enumeration(layer.status,`${p}.status`,['VALID','INVALID','STALE','FUTURE']);
    if(layer.age_ms!==null&&!Number.isFinite(layer.age_ms))fail(`${p}.age_ms`,'expected finite milliseconds or null');
    qualityIssues(layer.issues,`${p}.issues`);
    if(layer.status==='VALID'&&layer.issues.length)fail(p,'valid height cannot have errors');
  }
  const allValid=!q.issues.length&&q.ground_5ft.status==='VALID'&&q.canopy_30ft.status==='VALID';
  if((q.overall_status==='VALID')!==allValid)fail('data_quality.overall_status','must reflect independent input checks');
}

export function assertSnapshot(data) {
  assertWeatherInput(data);
  const e = data.evaluation;
  object(e, 'evaluation', ['single_station_5ft_status','single_station_5ft_reason','multi_height_status','headline_reason','triggered_rules','post_spray_volatility_risk'], ['caught_hidden_risk','data_quality']);
  enumeration(e.single_station_5ft_status, 'single_station_5ft_status', STATUSES);
  enumeration(e.multi_height_status, 'multi_height_status', STATUSES);
  if('data_quality' in e)assertDataQuality(e.data_quality);
  const qualifies=e.triggered_rules?.some(r=>r.severity==='STOP'&&r.is_upper_or_cross_height_hazard===true&&r.provenance!=='SAFETY_FAILSAFE');
  const honestHidden=e.single_station_5ft_status==='GO'&&e.multi_height_status==='STOP' &&
    e.data_quality?.overall_status==='VALID'&&qualifies;
  const expectedHidden=e.data_quality?!!honestHidden:
    e.single_station_5ft_status==='GO'&&e.multi_height_status==='STOP';
  if('caught_hidden_risk' in e && (typeof e.caught_hidden_risk!=='boolean'||e.caught_hidden_risk!==expectedHidden))
    fail('caught_hidden_risk','must reflect qualified upper-height STOP with valid readings, or legacy statuses');
  for (const k of ['single_station_5ft_reason','headline_reason','post_spray_volatility_risk']) text(e[k], `evaluation.${k}`);
  if (!Array.isArray(e.triggered_rules) || e.triggered_rules.length > 30) fail('triggered_rules', 'expected up to 30 rules');
  for (const [i,r] of e.triggered_rules.entries()) {
    object(r, `triggered_rules[${i}]`, ['code','severity','metric','explanation'],
      ['provenance','source_heights','is_upper_or_cross_height_hazard']);
    for (const k of ['code','metric','explanation']) text(r[k], `triggered_rules[${i}].${k}`);
    enumeration(r.severity, `triggered_rules[${i}].severity`, STATUSES);
    const metadata=['provenance','source_heights','is_upper_or_cross_height_hazard'];
    if(metadata.some(k=>k in r)){
      if(!metadata.every(k=>k in r))fail(`triggered_rules[${i}]`,'rule provenance must be complete');
      enumeration(r.provenance,`triggered_rules[${i}].provenance`,
        ['ILLUSTRATIVE_THRESHOLD','SAFETY_FAILSAFE']);
      if(!Array.isArray(r.source_heights)||r.source_heights.length>2 ||
        new Set(r.source_heights).size!==r.source_heights.length ||
        r.source_heights.some(h=>h!==5&&h!==30))fail(`triggered_rules[${i}].source_heights`,'expected unique 5/30 ft heights');
      if(typeof r.is_upper_or_cross_height_hazard!=='boolean')fail(`triggered_rules[${i}].is_upper_or_cross_height_hazard`,'expected boolean');
      if(r.provenance==='SAFETY_FAILSAFE' && r.is_upper_or_cross_height_hazard)
        fail(`triggered_rules[${i}]`,'integrity errors are not confirmed upper-height hazards');
      if(r.provenance==='ILLUSTRATIVE_THRESHOLD' &&
         r.is_upper_or_cross_height_hazard!==r.source_heights.includes(30))
        fail(`triggered_rules[${i}]`,'rule height classification conflicts with source heights');
    }
    if (STATUSES.indexOf(r.severity) > STATUSES.indexOf(e.multi_height_status)) fail('multi_height_status', 'cannot be lower than a triggered rule severity');
  }
  return data;
}
export function windDifference(a, b) { return Math.abs(((a - b + 540) % 360) - 180); }
export function deltas(snapshot) {
  const { ground_5ft: g, canopy_30ft: c } = snapshot.readings;
  return { temperature: c.temp_f - g.temp_f, speed: c.wind_speed_mph - g.wind_speed_mph, direction: windDifference(g.wind_dir_deg, c.wind_dir_deg) };
}
export function assertFresh(snapshot, now = Date.now(), maxAgeMs = 300000) {
  const age = now - Date.parse(snapshot.timestamp);
  if (age > maxAgeMs) throw new Error('Sensor readings are stale. Check the station connection.');
  if (age < -60000) throw new Error('Sensor timestamp is in the future. Check the station clock.');
}
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const signed = (n, digits = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`;
