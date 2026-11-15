/** One owned timer; queued callbacks from an older generation are harmless. */
export function createPlayback({tick, step, canAdvance, onChange = () => {},
  schedule = setInterval, cancel = clearInterval}) {
  let timer = null, generation = 0;
  function pause() {
    generation++;
    if (timer !== null) cancel(timer);
    timer = null;
    onChange(false);
  }
  function start(period) {
    if (timer !== null || !canAdvance()) return false;
    const token = ++generation;
    timer = schedule(() => {
      if (token !== generation || timer === null) return;
      if (!canAdvance()) { pause(); return; }
      tick();
    }, period);
    onChange(true);
    return true;
  }
  return Object.freeze({start, pause, isPlaying: () => timer !== null, step: () => {
    if (timer !== null || !canAdvance()) return false;
    return step();
  }});
}
