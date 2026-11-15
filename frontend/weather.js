import { evaluateSnapshot, createSession, startSpray, finishSpray, getProfile } from './engine/index.js';
import { nextWindow, formatTime, validateForecast } from './timeline.js';

/** Stable city IDs shared by the selector, NWS fetches, cache, and audit source labels.
 * Coordinates locate city centers, not verified orchard sensor installations.
 */
export const locations = Object.freeze({
  fresno: Object.freeze({label:'Fresno, CA',latitude:36.7378,longitude:-119.7871,zone:'America/Los_Angeles',block:'Fresno, CA · forecast area'}),
  modesto: Object.freeze({label:'Modesto, CA',latitude:37.6391,longitude:-120.9969,zone:'America/Los_Angeles',block:'Modesto, CA · forecast area'}),
  merced: Object.freeze({label:'Merced, CA',latitude:37.3022,longitude:-120.4830,zone:'America/Los_Angeles',block:'Merced, CA · forecast area'}),
  bakersfield: Object.freeze({label:'Bakersfield, CA',latitude:35.3733,longitude:-119.0187,zone:'America/Los_Angeles',block:'Bakersfield, CA · forecast area'}),
  chico: Object.freeze({label:'Chico, CA',latitude:39.7285,longitude:-121.8375,zone:'America/Los_Angeles',block:'Chico, CA · forecast area'}),
  yuba_city: Object.freeze({label:'Yuba City, CA',latitude:39.1404,longitude:-121.6169,zone:'America/Los_Angeles',block:'Yuba City, CA · forecast area'})
});
const compass = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const bearing = degrees => ((degrees % 360) + 360) % 360;
export function reading(temp_f, wind_speed_mph, degrees, humidity_pct) {
  const wind_dir_deg = bearing(degrees);
  return {temp_f, humidity_pct, wind_speed_mph, wind_dir_deg, wind_dir_cardinal:compass[Math.round(wind_dir_deg / 22.5) % 16]};
}

const anchors = {
  trap: ['False ground safe vs. canopy inversion', [64,4.8,0,68], [68.5,12.4,95,52]],
  calm: ['Dead calm radiation inversion', [55,1.2,0,82], [59.2,2,15,70]],
  clear: ['Ideal mid-morning mixing', [71,5.5,315,52], [69.2,6.8,315,57]],
  evaporation: ['Marginal shear and high evaporation', [86,6,270,22], [84.5,9.4,225,24]]
};
export const presetNames = Object.freeze([...Object.keys(anchors), 'afternoon']);
const hour = 3600000;
const smooth = x => x*x*(3-2*x);
function frame(name, minute) {
  if(name === 'afternoon') {
    const cooling = smooth(clamp((minute-75)/60,0,1));
    return ['Afternoon inversion onset', [75-7*cooling,5.5-2*cooling,315,45+20*cooling], [73.5-1.7*cooling,6.8-1.3*cooling,315,50+6*cooling]];
  }
  const [label, ground, upper] = anchors[name] ?? [];
  if(!label) throw new TypeError('Unknown weather preset');
  const phase = minute * Math.PI / 720;
  const solar = Math.sin(phase), turbulence = Math.sin(2*phase);
  return [label, [ground[0]+5*solar,Math.max(0,ground[1]+0.8*turbulence),ground[2]+9*solar,clamp(ground[3]-10*solar,0,100)],
    [upper[0]+2*solar,Math.max(0,upper[1]+0.6*turbulence),upper[2]+4*solar,clamp(upper[3]-4*solar,0,100)]];
}
/** Minute 0 is the preset anchor. E starts at 3 PM PST and reaches the inversion at minute 135. */
export function simulateWeather(name, minute = 0, profile, overrides = {}, session) {
  if(!Number.isInteger(minute)||minute<0||minute>1440) throw new RangeError('Minute must be an integer from 0 to 1440');
  const [label, ground, upper] = frame(name, minute);
  const start = Date.parse(name==='afternoon'?'2026-11-15T23:00:00Z':'2026-11-15T06:45:00Z');
  const block = 'Block 4B - Nonpareil Almonds (Fresno, CA)';
  const timestamp = new Date(start+minute*60000).toISOString();
  const selected = profile ?? getProfile(name==='afternoon'?'volatile_formulation':'contact_fungicide');
  const readings = Object.fromEntries([['ground_5ft',ground],['canopy_30ft',upper]].map(([key, values])=>{
    const [temperature, speed, direction, humidity] = values;
    const edit = overrides[key] ?? {};
    return [key, reading(edit.temp_f??temperature,edit.wind_speed_mph??speed,edit.wind_dir_deg??direction,edit.humidity_pct??humidity)];
  }));
  if(name==='afternoon' && !session) {
    const applied = getProfile('volatile_formulation');
    const started = startSpray(createSession(block,applied),new Date(start).toISOString());
    const end = new Date(start+15*60000).toISOString();
    session = minute<15?started:finishSpray(started,end,simulateWeather(name,15,applied,{},started));
  }
  return evaluateSnapshot({timestamp, scenario_name:label, orchard_block:block, readings, pesticide_profile:selected},session?{session}:{});
}

/** Solar elevation approximation from UTC date, longitude and latitude. */
function solarSignal(timestamp, location) {
  const date = new Date(timestamp);
  const day = (Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())-Date.UTC(date.getUTCFullYear(),0,0))/86400000;
  const rad = Math.PI/180;
  const declination = 23.44*rad*Math.sin(2*Math.PI*(day-81)/365.25);
  const solarHour = date.getUTCHours()+date.getUTCMinutes()/60+location.longitude/15;
  const latitude = location.latitude*rad;
  return Math.sin(latitude)*Math.sin(declination)+Math.cos(latitude)*Math.cos(declination)*Math.cos((solarHour-12)*15*rad);
}
const vaporPressure = celsius => 6.112*Math.exp(17.67*celsius/(celsius+243.5));
export function estimateLayers(row, location) {
  const sun = solarSignal(row.timestamp,location);
  const clear = row.sky === 'clear' ? 1 : row.sky === 'cloudy' ? 0.25 : 0.55;
  const night = 1-smooth(clamp((sun+0.10)/0.23,0,1));
  const cooling = 4*night*clear/(1+(row.wind/6)**2);
  const heating = 2*clear*clamp(sun/0.65,0,1);
  const groundTemp = row.temperature+heating-cooling;
  const upperTemp = row.temperature+0.25*heating-0.15*cooling;
  const rh = temp => clamp(row.humidity*vaporPressure((row.temperature-32)*5/9)/vaporPressure((temp-32)*5/9),0,100);
  return {
    ground_5ft:reading(groundTemp,row.wind*(0.75-0.20*night),row.direction,rh(groundTemp)),
    canopy_30ft:reading(upperTemp,row.wind*0.98,row.direction,rh(upperTemp))
  };
}

export function normalizeHourly(period) {
  const match = typeof period.windSpeed==='string' && /^(\d+(?:\.\d+)?)(?:\s+to\s+(\d+(?:\.\d+)?))?\s+mph$/i.exec(period.windSpeed.trim());
  const wind = match ? Number(match[2]??match[1]) : NaN;
  // A zero-length wind vector has no bearing. Use 0° for the fixed contract.
  const direction = wind===0 ? 0 : compass.indexOf(period.windDirection);
  const humidity = period.relativeHumidity?.value;
  const time = Date.parse(period.startTime);
  if(!match||direction<0||!Number.isFinite(humidity)||humidity<0||humidity>100||
     !Number.isFinite(period.temperature)||!['F','C'].includes(period.temperatureUnit)||
     !Number.isFinite(time)||Date.parse(period.endTime)-time!==hour) throw new Error('Unsupported or incomplete NWS hourly period');
  const skyText = period.shortForecast ?? '';
  return {timestamp:new Date(time).toISOString(), temperature:period.temperatureUnit==='F'?period.temperature:period.temperature*1.8+32,
    wind, direction:direction*22.5, humidity,
    sky:/cloudy|overcast|rain|snow/i.test(skyText)?'cloudy':/sunny|clear/i.test(skyText)?'clear':'unknown'};
}
function offlineRows(start, location) {
  return Array.from({length:24},(_,index)=>{
    const timestamp = new Date(start+index*hour).toISOString();
    const sun = clamp(solarSignal(timestamp,location),0,1);
    return {timestamp,temperature:59+23*sun,wind:4.4+4*sun,direction:315,humidity:70-27*sun,sky:'clear'};
  });
}

export function forecastWindow(snapshots, nowMs, zone) {
  const window = nextWindow(snapshots,60,nowMs);
  const inversion = snapshots.find(row=>Date.parse(row.timestamp)>nowMs && row.readings.canopy_30ft.temp_f-row.readings.ground_5ft.temp_f>1);
  return {next_safe_window_start:window?formatTime(window.start,zone):null,
    next_safe_window_end:window?formatTime(window.end,zone):null,
    duration_hours:window?.hours??0,
    warning_countdown:inversion?`Modeled inversion in ${Math.ceil((Date.parse(inversion.timestamp)-nowMs)/60000)} mins`:null,
    start_iso:window?new Date(window.start).toISOString():null,end_iso:window?new Date(window.end).toISOString():null};
}

/** One source envelope per request; each snapshot conforms to the shared contract. */
export async function loadOrchardForecast(id, profile, {nowMs=Date.now(), fetchImpl=fetch, cache, signal}={}) {
  if(!Object.hasOwn(locations,id)||!Number.isFinite(nowMs)) throw new TypeError('Invalid location or clock');
  const location=locations[id], start=Math.floor(nowMs/hour)*hour;
  const key=`canopyguard-nws-v1-${id}`;
  const covers = rows => Array.isArray(rows)&&rows.length===24&&rows.every((row,index)=>
    Date.parse(row.timestamp)===start+index*hour && Number.isFinite(row.temperature) &&
    Number.isFinite(row.wind)&&row.wind>=0&&row.wind<=250&&Number.isFinite(row.direction)&&
    Number.isFinite(row.humidity)&&row.humidity>=0&&row.humidity<=100);
  const request = async url => {
    const response=await fetchImpl(url,{headers:{Accept:'application/geo+json'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(4500)]):AbortSignal.timeout(4500)});
    if(!response.ok)throw new Error(`NWS HTTP ${response.status}`);
    return response.json();
  };
  let rows, fetched_at=null, error=null, source='nws';
  try {
    const point = await request(`https://api.weather.gov/points/${location.latitude},${location.longitude}`);
    const url = new URL(point.properties.forecastHourly);
    if(url.origin!=='https://api.weather.gov'||!/^\/gridpoints\/[A-Z]+\/\d+,\d+\/forecast\/hourly$/.test(url.pathname)) throw new Error('Unexpected NWS hourly URL');
    const result = await request(url.href);
    const current = result.properties.periods.filter(period=>Date.parse(period.startTime)>=start);
    // The API can start at the next hour. Leave that first gap explicit rather than backfilling it.
    rows=current.slice(0,24).map(normalizeHourly);
    if(!covers(rows) && !(rows.length>=23 && rows.every((row,index)=>Date.parse(row.timestamp)===start+(index+1)*hour)))throw new Error('Incomplete or noncontiguous NWS coverage');
    fetched_at=new Date(nowMs).toISOString();
    try{cache?.setItem(key,JSON.stringify({rows,fetched_at}));}catch{}
  }catch(cause){
    if(signal?.aborted)throw cause;
    error=cause.message; source='synthetic';
    try{
      const saved=JSON.parse(cache?.getItem(key)??'null');
      const remaining=saved?.rows?.filter(row=>Date.parse(row.timestamp)>=start);
      if(remaining?.length && Date.parse(saved.fetched_at)<=nowMs && nowMs-Date.parse(saved.fetched_at)<=6*hour &&
         remaining.every((row,index)=>Date.parse(row.timestamp)===Date.parse(remaining[0].timestamp)+index*hour) &&
         Date.parse(remaining[0].timestamp)<=start+hour && remaining.length>=20){
        rows=remaining;fetched_at=saved.fetched_at;source='cached_nws';
      }
    }catch{}
    if(source==='synthetic'){rows=offlineRows(start,location);fetched_at=null;}
  }
  const snapshots=rows.map(row=>evaluateSnapshot({timestamp:row.timestamp,scenario_name:`${source} · modeled orchard heights`,orchard_block:location.block,readings:estimateLayers(row,location),pesticide_profile:profile}));
  validateForecast(snapshots,60);
  return {location_id:id,location_label:location.label,source,fetched_at,error,time_zone:location.zone,interval_minutes:60,snapshots,window:forecastWindow(snapshots,nowMs,location.zone)};
}

# Automated fix for issue #7: Refresh forecast windows when simulation time advances
