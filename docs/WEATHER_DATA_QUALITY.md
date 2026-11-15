# Weather data quality

This document describes a source-agnostic quality layer for general environmental weather feeds. It is intentionally separate from the application's decision engine.

## What it checks

- **Provenance:** source label and whether values are observed, forecast, modeled, or synthetic.
- **Time semantics:** record valid-time and response retrieval-time stay separate.
- **Freshness:** missing, invalid, stale, or implausibly future retrieval timestamps are surfaced.
- **Coverage:** required measurement fields, invalid numeric values, duplicate timestamps, out-of-order records, and gaps in an expected time series are reported.

The result is metadata and quality status only. The module does not estimate unmeasured conditions, calculate environmental risk, produce operational thresholds, or recommend actions.

## Input contract

A provider adapter can normalize its response to this envelope:

```js
{
  source: {
    label: 'Station or provider name',
    kind: 'observed' // observed | forecast | modeled | synthetic
  },
  retrievedAt: '2026-11-15T18:00:00Z',
  records: [{
    validAt: '2026-11-15T17:00:00Z',
    values: {
      temperatureC: 22.1,
      relativeHumidityPct: 45,
      windSpeedMps: 3.2,
      precipitationMm: 0
    }
  }]
}
```

`validAt` identifies the time represented by each row. `retrievedAt` records when the application received the response. Do not replace one with the other.

Supported numeric fields and broad integrity bounds are:

| Field | Range |
| --- | ---: |
| `temperatureC` | -90 to 65 |
| `relativeHumidityPct` | 0 to 100 |
| `windSpeedMps` | 0 to 150 |
| `precipitationMm` | 0 to 1000 |

Temperature, relative humidity, and wind speed are required by default. Precipitation is optional unless a caller explicitly includes it in `requiredFields`.

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

Possible freshness values are `fresh`, `stale`, `future`, and `unknown`. Overall status is `ok`, `warning`, or `unavailable`. A good freshness result does not make forecast, modeled, or synthetic values observations: only `source.kind === 'observed'` sets `isMeasured` to true.

## Integration boundary

This change provides validation and tests before connecting a new weather provider. It does not add provider credentials, fetch additional datasets, or change the existing application forecast and decision flows. Provider-specific work should preserve each source's license, attribution, station identity, coordinates, units, observation time, and retrieval time. Unknown, stale, incomplete, or non-observation data must remain visibly labelled rather than being silently converted into measurements.
