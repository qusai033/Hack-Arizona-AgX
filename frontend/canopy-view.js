// Static dashboard markup only. The app owns rendering, events, and source-mode
// visibility, and mounts this view before it looks up or wires any controls.
// Forecast controls stay in index.html so production keeps its own visible UI.
const markup = `
<section id="orchard" class="orchard-panel" aria-labelledby="orchard-title">
  <div class="section-heading">
    <div>
      <p class="eyebrow">WHAT’S HAPPENING ABOVE YOUR TREES</p>
      <h2 id="orchard-title">The invisible, made visible.</h2>
    </div>
    <button id="motion-toggle" class="outline-button" aria-pressed="false">
      Pause animation <span aria-hidden="true">Ⅱ</span>
    </button>
  </div>
  <div class="orchard-layout">
    <div class="diagram-wrap">
      <div id="orchard-svg"></div>
      <p class="diagram-caption">Illustrative cross-section · Wind badges use compass direction · Not a plume model</p>
    </div>
    <aside class="sensor-inspector">
      <span class="eyebrow">INSPECT A SENSOR HEIGHT</span>
      <div class="sensor-tabs" role="group" aria-label="Sensor height">
        <button data-height="canopy_30ft" aria-pressed="true">30 ft</button>
        <button data-height="ground_5ft" aria-pressed="false">5 ft</button>
      </div>
      <h3 id="sensor-title">Above canopy</h3>
      <dl id="sensor-details"></dl>
      <div class="layer-note" id="layer-note"></div>
    </aside>
  </div>
  <section id="weather-panel" class="canopy-simulation" aria-labelledby="weather-title" hidden>
    <h3 id="weather-title">Weather simulator</h3>
    <p class="profile-hint">Adjust either sensor height to see the canopy view and spray decision update.</p>
    <div class="session-actions">
      <button id="weather-play" class="outline-button">Play</button>
      <button id="weather-step" class="outline-button">Step +1 minute</button>
      <button id="demo-reset" class="outline-button">Reset Demo</button>
      <button id="weather-reset" class="outline-button">Reset sliders</button>
      <label class="canopy-clock">
        <span class="canopy-clock-label">Time of day</span>
        <span class="clock-end" id="weather-start"></span>
        <input id="weather-minute" type="range" min="0" max="1440" step="1"
          value="0" aria-label="Scenario time of day">
        <span class="clock-end" id="weather-end"></span>
        <output id="weather-clock"></output>
      </label>
    </div>
    <div id="weather-sliders"></div>
    <p class="profile-hint">Reset Demo restarts this run and removes its demo activity. Other audit records stay.</p>
  </section>
</section>
`;

export function mountCanopyView(slot) {
  slot.outerHTML = markup;
}
