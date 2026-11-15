# Weather simulator and hourly forecast

The dashboard runs the shared decision engine on every simulated minute and slider change. Presets reproduce the requested anchors. Unspecified humidity and direction values are illustrative. Each preset is anchored at the Fresno local time its story describes: trap 6:45 AM, calm 6:30 AM, clear 10:00 AM, hot and dry 2:00 PM, post-spray 3:00 PM. From the anchor, the first four presets follow a day/night cycle driven by solar elevation, so the modeled gradient is a lapse through midday and an inversion can return at night. `simulateWeather` accepts offsets from -1440 to 1440 minutes around the anchor, and `presetTimeOfDay(name, minute)` returns the local time a frame models. The dashboard slider plays forward from the anchor only and labels that modeled time of day. The controller's simulation clock stays separate and forward-only (see TEAM4_CONTROLLER.md), so the two times can differ after switching scenarios. The afternoon replay starts at 3:00 PM Pacific, records a simulated volatile treatment ending at 3:15 PM, and reaches a +3.8°F inversion at 5:15 PM.

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

## NWS issuance-time qualification (Issue #8)

The loader distinguishes **period valid time** (`snapshots[].timestamp`), **source issuance/update time** (`issued_at`), and **retrieval time** (`fetched_at`). `validateForecastIssuance(properties, nowMs)` uses `properties.updateTime` as the authoritative source, otherwise `generatedAt`, otherwise `updated`; malformed authoritative values are rejected rather than bypassed by a lower-priority field. The chosen source property is returned as `issuance_source`.

The project freshness policy is **maximum 6 hours since issuance**, using an explicit real-world `nowMs` (not the demo replay clock). An issuance more than 5 minutes ahead of `nowMs` fails. A missing, malformed, future, or too-old issuance is not accepted as current even when the response contains valid future forecast periods. These thresholds are project screening limits, not guarantees of when NWS will publish a new forecast.

The city-specific cache stores `issued_at`, `issuance_source`, and `fetched_at` separately. Fallback reevaluates the **original issue age** at every access; a cache read does not renew the issue time. Legacy cache entries without verifiable issuance are not eligible. A failed live NWS request uses a qualified cached NWS source when available; otherwise the service returns `source: 'synthetic'` only for the explicit local simulator. The normal production dashboard refuses synthetic fallback, shows an unavailable state, and never displays synthetic values as observations.

The returned `issuance_age_minutes` is the age at the caller's supplied `nowMs`; it is recomputed on every fetch. The UI displays issuance and retrieval independently. A previously displayed forecast may be kept on a transient refresh failure only until its original issuance expires, after which the dashboard fails closed. Older records remain in local storage but are ineligible for use after expiry.
