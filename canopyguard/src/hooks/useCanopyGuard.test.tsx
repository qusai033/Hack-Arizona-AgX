import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState, INITIAL_SIM_TIME, reduceCanopyState, useCanopyGuard } from './useCanopyGuard';
import { makePorts, memoryStorage } from '../test/fixtures';
import { loadActivityLog } from '../services/activityLogger';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('simulation event lifecycle', () => {
  it('advances the clock on steps and scenario changes while preserving events', () => {
    const ports = makePorts();
    let state = createInitialState(ports, [], 'init');
    state = reduceCanopyState(state, { type: 'tick', eventId: 'tick' }, ports);
    expect(state.tickIndex).toBe(1);
    expect(state.currentEvaluation.evaluated_at_iso).toBe('2026-11-15T14:01:00.000Z');
    state = reduceCanopyState(state, { type: 'override', height: 5, patch: { temp_f: 90 }, eventId: 'override' }, ports);
    expect(state.currentSnapshot.ground_5ft.temp_f).toBe(90);
    const oldCount = state.logEntries.length;
    state = reduceCanopyState(state, { type: 'scenario', id: 'second_scenario', eventId: 'scenario' }, ports);
    expect(state.simClockIso).toBe('2026-11-15T14:02:00.000Z');
    expect(state.tickIndex).toBe(0);
    expect(state.manualOverrides).toEqual({});
    expect(state.currentSnapshot.ground_5ft.temp_f).toBe(64);
    expect(state.logEntries).toHaveLength(oldCount + 1);
  });
  it('records profile switches and repeated snapshots even when evaluations match', () => {
    const ports = makePorts(); let state = createInitialState(ports, [], 'init');
    state = reduceCanopyState(state, { type: 'profile', id: 'second_profile', eventId: 'a' }, ports);
    state = reduceCanopyState(state, { type: 'profile', id: 'standard_orchard', eventId: 'b' }, ports);
    state = reduceCanopyState(state, { type: 'record', eventId: 'c' }, ports);
    state = reduceCanopyState(state, { type: 'record', eventId: 'd' }, ports);
    expect(state.logEntries).toHaveLength(5);
    expect(state.logEntries.map(e => e.evaluation.status)).toEqual(['GO', 'GO', 'GO', 'GO', 'GO']);
    expect(state.logEntries[1].rule_config.profile.id).toBe('second_profile');
    expect(state.logEntries[2].rule_config.profile.id).toBe('standard_orchard');
    expect(state.simClockIso).toBe(INITIAL_SIM_TIME);
  });
  it('reprocessing a tick is idempotent for both time and logging', () => {
    const ports = makePorts();
    const state = reduceCanopyState(createInitialState(ports, [], 'init'), { type: 'tick', eventId: 'tick' }, ports);
    expect(reduceCanopyState(state, { type: 'tick', eventId: 'tick' }, ports)).toBe(state);
  });
  it('resets all demo state and writes exactly one fresh initial event', () => {
    const ports = makePorts(); let state = createInitialState(ports, [], 'init');
    state = reduceCanopyState(state, { type: 'toggle-play' }, ports);
    state = reduceCanopyState(state, { type: 'tick', eventId: 'tick' }, ports);
    state = reduceCanopyState(state, { type: 'profile', id: 'second_profile', eventId: 'profile' }, ports);
    state = reduceCanopyState(state, { type: 'session', value: 'ACTIVE_SPRAY', eventId: 'session' }, ports);
    state = reduceCanopyState(state, { type: 'override', height: 5, patch: { temp_f: 90 }, eventId: 'override' }, ports);
    state = reduceCanopyState(state, { type: 'reset', eventId: 'reset' }, ports);
    expect(state).toMatchObject({ isPlaying: false, activeScenarioId: 'hidden_inversion_trap', activeProfileId: 'standard_orchard',
      tickIndex: 0, simClockIso: INITIAL_SIM_TIME, manualOverrides: {}, sessionState: 'IDLE', activeAlertBanner: null });
    expect(state.logEntries).toHaveLength(1);
    expect(state.logEntries[0]).toMatchObject({ event_id: 'reset', sequence_number: 1, event_type: 'DEMO_INIT' });
  });
  it('allows a new STOP notification after returning to GO', () => {
    const ports = makePorts(); let state = createInitialState(ports, [], 'init');
    state = reduceCanopyState(state, { type: 'override', height: 5, patch: { temp_f: 90 }, eventId: 'stop1' }, ports);
    state = reduceCanopyState(state, { type: 'dismiss-alert' }, ports);
    state = reduceCanopyState(state, { type: 'tick', eventId: 'tick' }, ports);
    expect(state.activeAlertBanner?.dismissed).toBe(true);
    state = reduceCanopyState(state, { type: 'override', height: 5, patch: { temp_f: 64 }, eventId: 'go' }, ports);
    expect(state.activeAlertBanner).toBeNull();
    state = reduceCanopyState(state, { type: 'override', height: 5, patch: { temp_f: 90 }, eventId: 'stop2' }, ports);
    expect(state.activeAlertBanner).toMatchObject({ source_event_id: 'stop2', dismissed: false });
  });
});

describe('React wiring and persistence', () => {
  it('has one timer in StrictMode, pauses correctly, and preserves stored records on remount', () => {
    vi.useFakeTimers(); const storage = memoryStorage(), ports = makePorts();
    let id = 0; const makeEventId = () => `event-${++id}`;
    const options = { ports, storage, makeEventId };
    const { result, unmount } = renderHook(() => useCanopyGuard(options), { wrapper: StrictMode });
    expect(result.current.logEntries).toHaveLength(1);
    act(() => result.current.onTogglePlay());
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.tickIndex).toBe(3);
    expect(result.current.logEntries).toHaveLength(4);
    act(() => result.current.onTogglePlay());
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.tickIndex).toBe(3);
    expect(loadActivityLog(storage).entries).toHaveLength(4);
    unmount();
    const reopened = renderHook(() => useCanopyGuard(options));
    expect(reopened.result.current.logEntries).toHaveLength(4);
    act(() => reopened.result.current.resetDemo());
    expect(loadActivityLog(storage).entries).toHaveLength(1);
    expect(loadActivityLog(storage).entries[0].event_type).toBe('DEMO_INIT');
  });
  it('keeps working in memory when persistence fails', () => {
    const storage = { ...memoryStorage(), setItem: () => { throw new Error('Quota'); } };
    const { result } = renderHook(() => useCanopyGuard({ ports: makePorts(), storage }));
    act(() => { result.current.onRecordManualSnapshot(); result.current.onRecordManualSnapshot(); });
    expect(result.current.logEntries).toHaveLength(3);
    expect(result.current.storageWarning).toContain('export CSV');
  });
});
