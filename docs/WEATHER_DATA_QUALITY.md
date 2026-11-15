# Weather data quality

This document describes a source-agnostic quality layer for general environmental weather feeds. It is intentionally separate from the application's decision engine.

## What it checks

- **Provenance:** source label and whether values are observed, forecast, modeled, or synthetic.
- **Time semantics:** optional provider issuance-time, record valid-time, response retrieval-time, and the explicit evaluation clock stay separate.
- **Freshness:** missing, invalid, stale, expired, or implausibly future retrieval timestamps are surfaced.
- **Observation age:** for `observed` feeds, the newest valid record is aged against the same limits, and records timestamped ahead of the reference clock are invalid. A fresh response from a station that stopped reporting is not fresh data.
- **Coverage:** required measurement fields, invalid numeric values, unsupported fields, duplicate timestamps, out-of-order records, gaps in an expected time series, and (optionally) fewer records than expected are reported.

The result is metadata and quality status only. The module does not estimate unmeasured conditions, calculate environmental risk, produce operational thresholds, or recommend actions.

## Input contract

A provider adapter can normalize its response to this envelope:

```js
{
  source: {
    label: 'Station or provider name',
    kind: 'observed' // observed | forecast | modeled | synthetic
  },
  issuedAt: '2026-11-15T16:00:00Z', // optional provider issuance time
  retrievedAt: '2026-11-15T18:00:00Z',
  records: [{
    validAt: '2026-11-15T17:00:00Z',
    values: {
      temperatureC: 22.1,
      relativeHumidityPct: 45,
      windSpeedMps: 3.2,
      windDirectionDeg: 315,
      precipitationMm: 0
    }
  }]
}
```

`issuedAt` (optional) identifies when the provider published the forecast or response. `validAt` identifies the time represented by each row. `retrievedAt` records when the application received the response. The `referenceTimeMs` option is the caller-supplied evaluation clock and is returned as `evaluatedAt`. Do not replace or infer one timestamp from another. All supplied timestamps must be ISO 8601 strings with seconds and a UTC offset (`Z` or `±hh:mm`); impossible calendar dates such as February 30 are rejected.

The helper reports `issuanceAgeMs` as metadata and marks whether optional issuance metadata is missing, valid, or malformed. It does **not** decide whether an issuance is sufficiently recent or apply any issuance-age limit. Its configurable freshness classification applies to `retrievedAt`, and observed-record freshness applies to valid observation age; forecast valid-times remain separate. This generic utility is disconnected from the CanopyGuard application forecast/evaluator flow, and its example options are not application policy.

Values are SI. The rest of the application uses °F and mph (`temp_f`, `wind_speed_mph`), so an adapter must convert units in both directions explicitly; this module never converts. Fields outside the table below are not range-checked: they are listed per record in `unknownFields` and produce a `warning`, so a misspelled or wrong-unit field cannot pass unnoticed.

Supported numeric fields and broad integrity bounds are:

| Field | Range |
| --- | ---: |
| `temperatureC` | -90 to 65 |
| `relativeHumidityPct` | 0 to 100 |
| `windSpeedMps` | 0 to 150 |
| `windDirectionDeg` | 0 to 360 (meteorological FROM) |
| `precipitationMm` | 0 to 1000 |

Temperature, relative humidity, and wind speed are required by default. Wind direction and precipitation are optional unless a caller explicitly includes them in `requiredFields`.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `referenceTimeMs` | `Date.now()` | Clock used for all age checks. |
| `staleAfterMs` | 2 hours | Older than this is `stale` (warning). |
| `expireAfterMs` | 3 × `staleAfterMs` | Older than this is `expired` (unavailable). Must be at least `staleAfterMs`. |
| `futureToleranceMs` | 5 minutes | Allowed clock skew before a timestamp counts as future. |
| `expectedIntervalMinutes` | 60 | Spacing used to count missing intervals. |
| `expectedRecordCount` | none | When set, fewer distinct record times than this is reported as `recordShortfall`. Without it, a truncated feed cannot be detected: only interior gaps are. |
| `requiredFields` | temperature, humidity, wind speed | Fields every record must carry. |

Gaps and duplicates are counted on the time-sorted series, so row order cannot invent or hide a gap; out-of-order rows are counted separately in input order.

## Example

```js
import { assessWeatherEnvelope } from '../frontend/weather-data-quality.js';

const quality = assessWeatherEnvelope(normalizedFeed, {
  referenceTimeMs: Date.now(),
  staleAfterMs: 2 * 60 * 60 * 1000,
  expectedIntervalMinutes: 60
});

// Keep this label visible wherever the feed is presented.
console.log(quality.sourceKindLabel, quality.freshness, quality.status);
```

Possible retrieval `freshness` values are `fresh`, `stale`, `expired`, `future`, and `unknown`. `observationFreshness` uses the same values for the newest valid record of an `observed` feed and is `null` for other source kinds. Provider issuance age is returned for provenance but does not change `freshness` or `status`. A good freshness result does not make forecast, modeled, or synthetic values observations: only `source.kind === 'observed'` sets `isMeasured` to true, and `isMeasured` describes provenance only, not usability.

Overall status:

- `unavailable`: the retrieval timestamp is missing, invalid, future, or expired; there is no valid record; or the newest valid observation is expired. Do not present the feed as usable data.
- `warning`: any other reported issue (stale response or observation, invalid or future records, unsupported fields, gaps, shortfall, duplicates, ordering). The application's existing flows fail closed on stale data, so a consumer feeding a decision path must treat `warning` as blocking unless it has inspected `issues`.
- `ok`: no issue was found.

## Integration boundary

This change provides validation and tests before connecting a new weather provider. It does not add provider credentials, fetch additional datasets, or change the existing application forecast and decision flows. Provider-specific work should preserve each source's license, attribution, station identity, coordinates, units, observation time, and retrieval time. Unknown, stale, incomplete, or non-observation data must remain visibly labelled rather than being silently converted into measurements.
