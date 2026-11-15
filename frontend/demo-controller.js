import { assertEvent } from './events.js';
import { scenario } from './demo.js';
import { reading, simulateWeather } from './weather.js';
import { evaluateSnapshot, getProfile, createSession, startSpray, finishSpray } from './engine/index.js';

export const INITIAL_SIM_TIME = '2026-11-15T06:45:00.000Z';
export const AFTERNOON_REPLAY_TIME = '2026-11-15T23:00:00.000Z';
const MINUTE = 60000;
const scenarios = ['trap', 'marginal', 'clear', 'calm', 'evaporation', 'afternoon'];
const shift = (iso, minutes) => new Date(Date.parse(iso) + minutes * MINUTE).toISOString();
export const lastFrame = name => name === 'afternoon' ? 135 : 1440;

function frame(state) {
  if (state.scenario !== 'marginal') {
    return simulateWeather(state.scenario, state.minute, state.profile, state.overrides);
  }
  // Preserve the legacy marginal fixture while applying explicit manual edits.
  const input = scenario('marginal', state.profile);
  for (const height of ['ground_5ft', 'canopy_30ft']) {
    const r = {...input.readings[height], ...state.overrides[height]};
    input.readings[height] = reading(r.temp_f, r.wind_speed_mph, r.wind_dir_deg, r.humidity_pct);
  }
  return input;
}

function evaluateState(state) {
  const input = {...frame(state), timestamp: state.clock_iso};
  let session = state.session_source === 'replay' ? null : state.session;
  let session_source = session ? 'manual' : null;
  if (state.scenario === 'afternoon' && !session) {
    // This fixture carries its own treatment. Rebase it with the frame so seeking
    // never creates future treatment times or changes a user's manual session.
    const applied = getProfile('volatile_formulation');
    const started = shift(state.clock_iso, -state.minute);
    session = startSpray(createSession(input.orchard_block, applied), started);
    if (state.minute >= 15) {
      const ended = shift(started, 15);
      const endObservation = {...simulateWeather('afternoon', 15, applied), timestamp: ended};
      session = finishSpray(session, ended, endObservation);
    }
    session_source = 'replay';
  }
  const snapshot = evaluateSnapshot(input, session ? {session} : {});
  if (snapshot.evaluation.triggered_rules.some(rule => rule.code === 'DATA_INVALID')) {
    throw new Error(snapshot.evaluation.triggered_rules.find(rule => rule.code === 'DATA_INVALID').explanation);
  }
  return {...state, session, session_source, snapshot};
}

export function createDemoState({scenario: name = 'trap', clock_iso = INITIAL_SIM_TIME, profile} = {}) {
  if (!scenarios.includes(name)) throw new TypeError('Unknown demo scenario');
  if (!Number.isFinite(Date.parse(clock_iso))) throw new TypeError('Invalid simulation time');
  return evaluateState({
    scenario: name, minute: 0, clock_iso,
    profile: structuredClone(profile ?? getProfile(name === 'afternoon' ? 'volatile_formulation' : 'contact_fungicide')),
    overrides: {}, session: null, session_source: null, handled_events: new Set()
  });
}

/** Pure transition ported from Team 4; wall-clock time and IDs arrive in the event. */
export function reduceDemoState(state, event) {
  assertEvent(event);
  if (state.handled_events.has(event.event_id)) return state;
  const payload = event.payload ?? {};
  let next = {...state};
  switch (event.event_type) {
    case 'SCENARIO_SELECTED':
      if (!scenarios.includes(payload.name)) throw new TypeError('Unknown demo scenario');
      next.scenario = payload.name;
      next.minute = 0;
      next.overrides = {};
      next.clock_iso = shift(state.clock_iso, 1);
      if (state.session_source === 'replay') {
        next.session = null;
        next.session_source = null;
      }
      if (payload.name === 'afternoon' && !next.session) next.profile = getProfile('volatile_formulation');
      break;
    case 'SIMULATION_TICK':
      if (state.minute >= lastFrame(state.scenario)) return state;
      next.minute++;
      next.clock_iso = shift(state.clock_iso, 1);
      break;
    case 'FRAME_SELECTED': {
      const minute = payload.minute;
      if (!Number.isInteger(minute) || minute < 0 || minute > lastFrame(state.scenario)) {
        throw new RangeError('Invalid simulation frame');
      }
      next.minute = minute;
      // Forward scrubbing advances by the frame distance. Earlier frames are new
      // observations one minute later; they cannot backdate an active treatment.
      next.clock_iso = shift(state.clock_iso, minute < state.minute ? 1 : minute - state.minute);
      break;
    }
    case 'PROFILE_CHANGED':
      if (state.session?.state === 'SPRAYING_IN_PROGRESS') throw new Error('The applied profile is locked while spraying.');
      next.profile = structuredClone(payload.profile);
      break;
    case 'READING_CHANGED':
      if (!['ground_5ft', 'canopy_30ft'].includes(payload.height)) throw new TypeError('Unknown sensor height');
      if (!['temp_f', 'wind_speed_mph', 'wind_dir_deg', 'humidity_pct'].includes(payload.field) || !Number.isFinite(payload.value)) {
        throw new TypeError('Invalid reading override');
      }
      next.overrides = {...state.overrides,
        [payload.height]: {...state.overrides[payload.height], [payload.field]: payload.value}};
      break;
    case 'OVERRIDES_RESET':
      next.overrides = {};
      break;
    case 'SESSION_STARTED':
      if (state.session || state.snapshot.evaluation.multi_height_status !== 'GO') throw new Error('A demo session requires GO and no active treatment.');
      next.session = startSpray(createSession(state.snapshot.orchard_block, state.profile), state.clock_iso);
      next.session_source = 'manual';
      break;
    case 'SESSION_FINISHED':
      if (state.session_source !== 'manual') throw new Error('No manual treatment to finish.');
      next.session = finishSpray(state.session, state.clock_iso, state.snapshot);
      break;
    case 'SESSION_RESET':
      next.session = null;
      next.session_source = null;
      break;
    case 'SESSION_EXAMPLE': {
      if (state.session?.state === 'SPRAYING_IN_PROGRESS') throw new Error('Finish the active treatment first.');
      const profile = getProfile('volatile_formulation');
      const ended = shift(state.clock_iso, -120), started = shift(ended, -30);
      const prior = {...scenario('clear', profile), timestamp: ended};
      next.session = finishSpray(startSpray(createSession(prior.orchard_block, profile), started), ended, prior);
      next.session_source = 'manual';
      break;
    }
    case 'MANUAL_SNAPSHOT_RECORDED':
      break;
    default:
      throw new TypeError(`Unknown demo event: ${event.event_type}`);
  }
  next = evaluateState(next);
  return {...next, handled_events: new Set([...state.handled_events, event.event_id])};
}
