# Weather simulator and hourly forecast

The dashboard runs the shared decision engine on every simulated minute and slider change. Presets reproduce the requested anchors. Unspecified humidity and direction values are illustrative. The first four presets use a smooth repeating 24-hour cycle around their anchors. The afternoon replay starts at 3:00 PM Pacific, records a simulated volatile treatment ending at 3:15 PM, and reaches a +3.8°F inversion at 5:15 PM.

Import the service directly in browser or Node modules:

```js
import { simulateWeather, loadOrchardForecast } from '../frontend/weather.js';
import { getProfile } from '../frontend/engine/index.js';
const profile = getProfile('contact_fungicide');
const snapshot = simulateWeather('clear', 0, profile, {
  canopy_30ft: { wind_speed_mph: 2 }
});
const { snapshots, window, source, time_zone } =
  await loadOrchardForecast('fresno', profile);
```

The simulator returns one complete shared snapshot per call. A caller can request the next integer minute or supply an explicit spray session. The forecast returns a separate envelope with evaluated snapshots, source, fetch time, interval length, timezone, and a calculated window. Use the ISO boundaries for storage. Clock labels use the orchard timezone. Forecast windows are based on whole hourly source periods and may be empty. The current period is clipped to the supplied reference time. A forecast starting at the next hour leaves the current gap unfilled.

The forecast requests NWS points metadata and follows its hourly URL. Wind speed ranges use their upper bound. Calm periods have no physical bearing. For compatibility the payload uses 0° and the dashboard labels the wind Calm. Unsupported or missing input invokes the fallback rather than fabricating a field in a live row. A successful response is cached per location when storage is available. Recent, contiguous cached periods can cover a shorter horizon. If neither source is available, a deterministic 24-hour synthetic forecast uses the requested location and reference hour. Pass a storage-compatible cache, an explicit nowMs, or an injected fetch implementation as needed. Server callers can inject fetch with a User-Agent identifying their application and contact.

The orchard estimate uses solar elevation from UTC and coordinates as a heating proxy. Nighttime surface cooling increases in clearer conditions and decreases as regional wind grows. A larger temperature response and wind attenuation near the ground create a vertical gradient. Relative humidity is recalculated with approximately constant vapor pressure. Both levels inherit the regional wind direction because hourly input cannot resolve directional shear. Coefficients and cloud classes are illustrative and uncalibrated. NWS supplies regional hourly input. The 5 ft and 30 ft values, inversion countdown, and screening windows are local model outputs. The model does not use physical sensors or verify pesticide label compliance.

- [NWS API documentation](https://www.weather.gov/documentation/services-web-API)
- [NWS explanation of radiation inversions](https://www.weather.gov/lmk/inversion)
