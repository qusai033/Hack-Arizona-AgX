// Freshness tolerances: the single source for every age / future-skew check in the application.
// Decision record and rationale: docs/FRESHNESS_POLICY.md (issue #47: retain the implemented policy).
// These are project policy values, not NWS publication guarantees.
const second = 1000, minute = 60 * second, hour = 60 * minute;

export const FRESHNESS_POLICY = Object.freeze({
  /** Current sensor observations (live adapter, connected snapshots, evaluate() with an explicit nowMs). */
  observation: Object.freeze({
    maxAgeMs: 5 * minute,       // older -> "stale", decision suppressed (DATA UNAVAILABLE)
    maxFutureMs: 60 * second    // further ahead of the clock -> rejected as a station clock error
  }),
  /** NWS forecast issuance (updateTime / generatedAt / updated), never the valid period or retrieval time. */
  forecastIssuance: Object.freeze({
    maxAgeMs: 6 * hour,         // older issuance -> forecast not used, even if its periods are still valid
    maxFutureMs: 5 * minute     // issuance further ahead of the clock -> rejected
  }),
  /** Per-city cached NWS response: retrieval age limit. Issuance is rechecked separately on every read. */
  forecastCache: Object.freeze({
    maxRetrievalAgeMs: 6 * hour
  })
});

const label = ms => ms % hour === 0 ? `${ms / hour} hour${ms === hour ? '' : 's'}`
  : ms % minute === 0 ? `${ms / minute} minute${ms === minute ? '' : 's'}` : `${ms / second} seconds`;
/** Human wording of a limit, used in visible messages so they always match the configured values. */
export const describeLimit = label;
