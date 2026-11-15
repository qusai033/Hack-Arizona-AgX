/** Deterministic playback for the standalone synthetic weather viewer only.
 * Each tick advances exactly one simulated minute. Speed changes wall-clock cadence,
 * never simulation-time increments. This module has no evaluator or treatment hooks.
 */
export const PLAYBACK_SPEEDS = Object.freeze([1, 5, 10]);

export const SYNTHETIC_WEATHER_FRAMES = Object.freeze([
  Object.freeze({minute:0,temperatureF:76,humidityPct:28,windMph:6}),
  Object.freeze({minute:1,temperatureF:76,humidityPct:28,windMph:6}),
  Object.freeze({minute:2,temperatureF:77,humidityPct:27,windMph:5}),
  Object.freeze({minute:3,temperatureF:77,humidityPct:27,windMph:5}),
  Object.freeze({minute:4,temperatureF:77,humidityPct:26,windMph:4}),
  Object.freeze({minute:5,temperatureF:78,humidityPct:26,windMph:4}),
  Object.freeze({minute:6,temperatureF:78,humidityPct:25,windMph:5}),
  Object.freeze({minute:7,temperatureF:78,humidityPct:25,windMph:5})
]);

const isSpeed = value => PLAYBACK_SPEEDS.includes(value);

export function createWeatherPlayback({
  totalFrames = SYNTHETIC_WEATHER_FRAMES.length,
  onChange = () => {},
  setIntervalFn = (callback, delay) => setInterval(callback, delay),
  clearIntervalFn = handle => clearInterval(handle)
} = {}) {
  if (!Number.isInteger(totalFrames) || totalFrames < 2) {
    throw new TypeError('totalFrames must be an integer of at least two');
  }
  if (typeof onChange !== 'function' || typeof setIntervalFn !== 'function' ||
      typeof clearIntervalFn !== 'function') {
    throw new TypeError('Playback callbacks must be functions');
  }

  let timer = null;
  let generation = 0;
  let runId = 1;
  const state = {
    frameIndex: 0,
    elapsedMinutes: 0,
    speed: 1,
    playing: false,
    tickCount: 0,
    lastEventId: null
  };

  const snapshot = () => ({
    ...state,
    frameCount: totalFrames,
    completed: state.frameIndex >= totalFrames - 1,
    intervalMs: 1000 / state.speed
  });
  const emit = () => onChange(snapshot());

  function clearTimer() {
    generation += 1;
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
  }

  function schedule() {
    const scheduledGeneration = generation;
    timer = setIntervalFn(() => {
      if (scheduledGeneration !== generation || !state.playing) return;
      advanceOneMinute();
    }, 1000 / state.speed);
  }

  function advanceOneMinute() {
    if (state.frameIndex >= totalFrames - 1) return false;
    state.frameIndex += 1;
    state.elapsedMinutes += 1;
    state.tickCount += 1;
    state.lastEventId = `weather-demo-run-${runId}-tick-${state.tickCount}`;
    if (state.frameIndex >= totalFrames - 1) {
      state.playing = false;
      clearTimer();
    }
    emit();
    return true;
  }

  function start() {
    if (state.playing || state.frameIndex >= totalFrames - 1) return false;
    state.playing = true;
    schedule();
    emit();
    return true;
  }

  function pause() {
    if (!state.playing) return false;
    state.playing = false;
    clearTimer();
    emit();
    return true;
  }

  function step() {
    if (state.playing) return false;
    return advanceOneMinute();
  }

  function setSpeed(speed) {
    if (!isSpeed(speed)) throw new RangeError(`Unsupported playback speed: ${speed}`);
    if (state.speed === speed) return false;
    state.speed = speed;
    if (state.playing) {
      clearTimer();
      schedule();
    }
    emit();
    return true;
  }

  function reset() {
    clearTimer();
    runId += 1;
    state.frameIndex = 0;
    state.elapsedMinutes = 0;
    state.playing = false;
    state.tickCount = 0;
    state.lastEventId = null;
    emit();
  }

  function dispose() {
    state.playing = false;
    clearTimer();
  }

  return Object.freeze({
    start, pause, step, setSpeed, reset, dispose,
    getState: snapshot
  });
}
