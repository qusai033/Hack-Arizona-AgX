import { useCallback, useEffect, useReducer, useState } from 'react';
import { buildRuleConfig, ILLUSTRATIVE_PROFILES } from '../config/ruleConfigs';
import { evaluateSprayConditions } from '../engine/riskEvaluator';
import { applyManualOverrides, getScenarioList, getScenarioSnapshot } from '../services/weatherSimulator';
import {
  appendLogEntryIdempotent, computeReasonSignature, createActivityLogEntry,
  exportActivityLogsToCsv, loadActivityLog, persistActivityLog,
  shouldTriggerAlertToast, triggerCsvDownload,
} from '../services/activityLogger';
import type { StoragePort } from '../services/activityLogger';
import type {
  ActivityLogEntry, AlertBannerState, ApplicationProfile, EvaluationResult,
  LogEventType, MeasurementHeight, ReadingPatch, RuleConfig, SpraySessionState, WeatherSnapshot,
} from '../types/canopy';

export const INITIAL_SIM_TIME = '2026-11-15T14:00:00.000Z';
export const DEFAULT_SCENARIO_ID = 'hidden_inversion_trap';
export const DEFAULT_PROFILE_ID = 'standard_orchard';

/** Ports allow team 4 tests to exercise orchestration independently of teammate stubs. */
export interface CanopyPorts {
  getScenarioList: typeof getScenarioList;
  getScenarioSnapshot: typeof getScenarioSnapshot;
  applyManualOverrides: typeof applyManualOverrides;
  buildRuleConfig: typeof buildRuleConfig;
  evaluateSprayConditions: typeof evaluateSprayConditions;
  profiles: ApplicationProfile[];
}
const DEFAULT_PORTS: CanopyPorts = {
  getScenarioList, getScenarioSnapshot, applyManualOverrides, buildRuleConfig,
  evaluateSprayConditions, profiles: ILLUSTRATIVE_PROFILES,
};

export interface CanopyState {
  activeScenarioId: string;
  activeProfileId: string;
  tickIndex: number;
  simClockIso: string;
  isPlaying: boolean;
  sessionState: SpraySessionState;
  manualOverrides: Partial<Record<MeasurementHeight, ReadingPatch>>;
  currentSnapshot: WeatherSnapshot;
  currentEvaluation: EvaluationResult;
  ruleConfig: RuleConfig;
  logEntries: ActivityLogEntry[];
  sequenceNumber: number;
  activeAlertBanner: AlertBannerState | null;
}

type EventAction =
  | { type: 'tick' | 'record' | 'reset'; eventId: string }
  | { type: 'scenario'; id: string; eventId: string }
  | { type: 'profile'; id: string; eventId: string }
  | { type: 'session'; value: SpraySessionState; eventId: string }
  | { type: 'override'; height: MeasurementHeight; patch: ReadingPatch; eventId: string };
export type CanopyAction = EventAction | { type: 'toggle-play' | 'dismiss-alert' | 'clear-log' };

function evaluate(state: CanopyState, ports: CanopyPorts): CanopyState {
  let currentSnapshot = ports.getScenarioSnapshot(state.activeScenarioId, state.tickIndex, state.simClockIso);
  for (const height of [5, 30] as const) {
    const patch = state.manualOverrides[height];
    if (patch) currentSnapshot = ports.applyManualOverrides(currentSnapshot, height, patch, state.simClockIso);
  }
  const ruleConfig = ports.buildRuleConfig(state.activeProfileId);
  const currentEvaluation = ports.evaluateSprayConditions(currentSnapshot, ruleConfig, state.sessionState, state.simClockIso);
  return { ...state, currentSnapshot, ruleConfig, currentEvaluation };
}

function record(state: CanopyState, eventId: string, eventType: LogEventType, alert = true): CanopyState {
  const candidate = createActivityLogEntry(eventId, state.sequenceNumber + 1, eventType,
    state.simClockIso, state.sessionState, state.currentSnapshot, state.ruleConfig, state.currentEvaluation);
  const logEntries = appendLogEntryIdempotent(state.logEntries, candidate);
  let activeAlertBanner = state.activeAlertBanner;
  if (alert) {
    if (state.currentEvaluation.status === 'GO') activeAlertBanner = null;
    else if (shouldTriggerAlertToast(activeAlertBanner, state.currentEvaluation)) {
      activeAlertBanner = {
        alert_id: eventId, source_event_id: eventId, triggered_at_sim_iso: state.simClockIso,
        severity: state.currentEvaluation.status, headline: state.currentEvaluation.headline,
        reason_signature: computeReasonSignature(state.currentEvaluation), dismissed: false,
      };
    }
  }
  return { ...state, logEntries, sequenceNumber: candidate.sequence_number, activeAlertBanner };
}

export function createInitialState(ports: CanopyPorts, entries: ActivityLogEntry[], eventId: string): CanopyState {
  const scenario = ports.getScenarioList().find(item => item.id === DEFAULT_SCENARIO_ID);
  if (!scenario) throw new Error(`The shared scaffold requires ${DEFAULT_SCENARIO_ID}`);
  const snapshot = ports.getScenarioSnapshot(scenario.id, scenario.default_tick_index, INITIAL_SIM_TIME);
  const config = ports.buildRuleConfig(DEFAULT_PROFILE_ID);
  const state: CanopyState = {
    activeScenarioId: scenario.id, activeProfileId: DEFAULT_PROFILE_ID,
    tickIndex: scenario.default_tick_index, simClockIso: INITIAL_SIM_TIME,
    isPlaying: false, sessionState: 'IDLE', manualOverrides: {},
    currentSnapshot: snapshot, ruleConfig: config,
    currentEvaluation: ports.evaluateSprayConditions(snapshot, config, 'IDLE', INITIAL_SIM_TIME),
    logEntries: entries, sequenceNumber: entries.reduce((max, entry) => Math.max(max, entry.sequence_number), 0),
    activeAlertBanner: null,
  };
  // Reload preserves the existing log; it does not manufacture another user action.
  return entries.length ? state : record(state, eventId, 'DEMO_INIT', false);
}

export function reduceCanopyState(state: CanopyState, action: CanopyAction, ports: CanopyPorts): CanopyState {
  if ('eventId' in action && state.logEntries.some(entry => entry.event_id === action.eventId)) return state;
  if (action.type === 'toggle-play') return { ...state, isPlaying: !state.isPlaying };
  if (action.type === 'dismiss-alert') return {
    ...state, activeAlertBanner: state.activeAlertBanner ? { ...state.activeAlertBanner, dismissed: true } : null,
  };
  if (action.type === 'clear-log') return { ...state, logEntries: [] };
  if (action.type === 'reset') return createInitialState(ports, [], action.eventId);

  let next = { ...state };
  let eventType: LogEventType;
  switch (action.type) {
    case 'tick':
      next.tickIndex++;
      next.simClockIso = new Date(Date.parse(state.simClockIso) + 60_000).toISOString();
      eventType = 'SIMULATION_TICK';
      break;
    case 'scenario': {
      const scenario = ports.getScenarioList().find(item => item.id === action.id);
      if (!scenario) return state;
      next.activeScenarioId = scenario.id;
      next.tickIndex = scenario.default_tick_index;
      next.manualOverrides = {};
      next.simClockIso = new Date(Date.parse(state.simClockIso) + 60_000).toISOString();
      eventType = 'SCENARIO_CHANGED';
      break;
    }
    case 'profile':
      if (!ports.profiles.some(profile => profile.id === action.id)) return state;
      next.activeProfileId = action.id;
      eventType = 'PROFILE_CHANGED';
      break;
    case 'session':
      next.sessionState = action.value;
      eventType = 'SESSION_STATE_CHANGED';
      break;
    case 'override':
      next.manualOverrides = { ...state.manualOverrides, [action.height]: { ...state.manualOverrides[action.height], ...action.patch } };
      eventType = 'MANUAL_OVERRIDE_APPLIED';
      break;
    case 'record':
      eventType = 'MANUAL_SNAPSHOT_RECORDED';
      break;
  }
  next = evaluate(next, ports);
  return record(next, action.eventId, eventType);
}

function browserStorage(): StoragePort | null {
  try { return window.localStorage; } catch { return null; }
}
const defaultMakeEventId = () => crypto.randomUUID();
interface Options { ports?: CanopyPorts; storage?: StoragePort | null; makeEventId?: () => string }
export function useCanopyGuard(options: Options = {}) {
  const ports = options.ports ?? DEFAULT_PORTS;
  const makeEventId = options.makeEventId ?? defaultMakeEventId;
  const [persistence] = useState(() => {
    const storage = options.storage === undefined ? browserStorage() : options.storage;
    return { storage, ...loadActivityLog(storage) };
  });
  const [state, dispatch] = useReducer(
    (previous: CanopyState, action: CanopyAction) => reduceCanopyState(previous, action, ports),
    undefined, () => createInitialState(ports, persistence.entries, makeEventId()),
  );
  const [storageWarning, setStorageWarning] = useState(persistence.warning);
  const sendEvent = useCallback((action: Omit<EventAction, 'eventId'>) => {
    dispatch({ ...action, eventId: makeEventId() } as EventAction);
  }, [makeEventId]);

  useEffect(() => {
    setStorageWarning(persistActivityLog(persistence.storage, state.logEntries) ?? persistence.warning);
  }, [state.logEntries, persistence]);

  useEffect(() => {
    if (!state.isPlaying) return;
    const timer = setInterval(() => sendEvent({ type: 'tick' }), 1000);
    return () => clearInterval(timer);
  }, [state.isPlaying, sendEvent]);

  return {
    ...state, storageWarning,
    scenarios: ports.getScenarioList(), profiles: ports.profiles,
    onSelectScenario: (id: string) => dispatch({ type: 'scenario', id, eventId: makeEventId() }),
    onSelectProfile: (id: string) => dispatch({ type: 'profile', id, eventId: makeEventId() }),
    onChangeSessionState: (value: SpraySessionState) => dispatch({ type: 'session', value, eventId: makeEventId() }),
    onOverrideReading: (height: MeasurementHeight, patch: ReadingPatch) => dispatch({ type: 'override', height, patch, eventId: makeEventId() }),
    onTogglePlay: () => dispatch({ type: 'toggle-play' }),
    onStepTick: () => sendEvent({ type: 'tick' }),
    resetDemo: () => sendEvent({ type: 'reset' }),
    onRecordManualSnapshot: () => sendEvent({ type: 'record' }),
    onClearLog: () => dispatch({ type: 'clear-log' }),
    onDismissAlert: () => dispatch({ type: 'dismiss-alert' }),
    onExportCsv: () => triggerCsvDownload(exportActivityLogsToCsv(state.logEntries), `canopyguard-${state.simClockIso.replaceAll(':', '-')}.csv`),
  };
}
