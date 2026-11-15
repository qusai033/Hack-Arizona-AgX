import { assertSnapshot } from './contract.js';
import { analyze, assertSession, ENGINE_VERSION } from './engine/index.js';

export const AUDIT_SCHEMA_VERSION = 2;
const builtInSources = new Set(['demo', 'forecast']);
const timestampRoles = Object.freeze({
  demo:'simulation_clock', forecast:'forecast_valid_time',
  live:'connected_observation', imported:'imported_observation', unknown:'unverified'
});
const clone = value => structuredClone(value);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Capture evaluated evidence without pretending that an imported/live adapter used
 * the built-in engine. The record owns deep copies of all caller-provided context.
 * Only actual built-in results are attributed to ENGINE_VERSION and thresholds.
 */
export function buildAuditEvidence(snapshot, {
  source='unknown', session=null, evaluationContext={}, provenance=null, recordedAt=null
}={}) {
  assertSnapshot(snapshot);
  if(session !== null) assertSession(session);
  if(!isObject(evaluationContext))throw new TypeError('Evaluation context must be an object.');
  if(provenance !== null && !isObject(provenance))throw new TypeError('Source provenance must be an object or null.');
  if(recordedAt !== null && (!Number.isFinite(Date.parse(recordedAt))||typeof recordedAt!=='string')){
    throw new TypeError('Recording time must be ISO 8601.');
  }
  const context=clone(evaluationContext);
  if(session !== null){
    if('session' in context && JSON.stringify(context.session)!==JSON.stringify(session)){
      throw new TypeError('Evaluation context conflicts with recorded spray session.');
    }
    context.session=clone(session);
  }
  if('session' in context) assertSession(context.session);
  const builtIn=builtInSources.has(source);
  // An externally evaluated record has no verified built-in evaluation clock.
  // For built-in results, use ONLY the time passed into the source evaluator.
  // Legacy records without that context retain null; no backfilling from either
  // the snapshot valid/observation time or later action.recorded_at.
  const evaluationTimeMs=context.evaluationTimeMs;
  let evaluated_at=null;
  if(builtIn && evaluationTimeMs!==undefined){
    if(!Number.isSafeInteger(evaluationTimeMs)||evaluationTimeMs<0 ||
       !Number.isFinite(new Date(evaluationTimeMs).getTime())){
      throw new TypeError('Invalid explicit evaluationTimeMs for audit evidence.');
    }
    evaluated_at=new Date(evaluationTimeMs).toISOString();
    if(source==='demo' && evaluated_at!==snapshot.timestamp){
      throw new Error('Demo evaluator time must match the deterministic simulation clock.');
    }
  }
  let engine_version=null, effective_thresholds=null, diagnostics=null, reproduced_with_current_engine=false;
  if(builtIn){
    const examined=analyze(snapshot,context);
    if(examined.diagnostics.error || !examined.diagnostics.thresholds ||
       JSON.stringify(examined.evaluation)!==JSON.stringify(snapshot.evaluation)){
      throw new Error('Stored built-in evaluation does not match its recorded context; refusing unverifiable evidence.');
    }
    engine_version=ENGINE_VERSION;
    effective_thresholds=clone(examined.diagnostics.thresholds);
    diagnostics=clone(examined.diagnostics);
    reproduced_with_current_engine=true;
  }
  const timestamp_role=timestampRoles[source]??'unverified';
  return {
    schema_version:AUDIT_SCHEMA_VERSION,
    evaluator_kind:builtIn?'canopyguard_builtin':'external_or_unverified',
    engine_version,
    effective_thresholds,
    effective_profile:clone(context.session?.state==='SPRAYING_IN_PROGRESS'?
      context.session.pesticide_profile:snapshot.pesticide_profile),
    evaluation_context:context,
    diagnostics,
    reproduced_with_current_engine,
    provenance:clone(provenance),
    times:{
      recorded_at:recordedAt,
      snapshot_at:snapshot.timestamp,
      snapshot_time_role:timestamp_role,
      simulation_clock_at:source==='demo'?snapshot.timestamp:null,
      forecast_valid_at:source==='forecast'?snapshot.timestamp:null,
      observation_at:source==='live'?snapshot.timestamp:null,
      evaluated_at
    }
  };
}

/** Version-aware reader: v1 records are preserved with unavailable evidence,
 * never retroactively attributed to a version or a made-up session.
 */
export function normalizeAuditRecord(record){
  if(!isObject(record))throw new TypeError('Invalid audit record.');
  const row=clone(record);
  if(!('schema_version' in row) || row.schema_version===1){
    row.schema_version=1;
    row.evidence=null; // Historical engine/configuration provenance is unavailable.
    return row;
  }
  if(row.schema_version!==AUDIT_SCHEMA_VERSION || !isObject(row.evidence) ||
     row.evidence.schema_version!==AUDIT_SCHEMA_VERSION ||
     !isObject(row.evidence.times) ||
     row.evidence.times.snapshot_at!==row.snapshot?.timestamp ||
     row.evidence.times.recorded_at!==row.recorded_at ||
     !isObject(row.evidence.evaluation_context)){
    throw new TypeError('Invalid versioned audit evidence.');
  }
  if(row.session!==null && row.session!==undefined)assertSession(row.session);
  if(row.evidence.evaluation_context.session &&
     JSON.stringify(row.evidence.evaluation_context.session)!==JSON.stringify(row.session)){
    throw new TypeError('Stored evaluation context and session differ.');
  }
  if(builtInSources.has(row.source)){
    if(row.evidence.evaluator_kind!=='canopyguard_builtin' ||
       typeof row.evidence.engine_version!=='string' ||
       !isObject(row.evidence.effective_thresholds) ||
       row.evidence.reproduced_with_current_engine!==true){
      throw new TypeError('Built-in audit evidence is incomplete.');
    }
  }
  return row;
}
