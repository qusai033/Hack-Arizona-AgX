/** TEAMMATE 3 STUB: functional integration controls; replace with final presentation. */
import type {
  ApplicationProfile, MeasurementHeight, ReadingPatch, ScenarioDefinition,
  SpraySessionState, WeatherSnapshot,
} from '../types/canopy';
export interface ControlPanelProps {
  scenarios: ScenarioDefinition[]; activeScenarioId: string; tickIndex: number; isPlaying: boolean;
  onSelectScenario: (id: string) => void; onTogglePlay: () => void; onStepTick: () => void; onResetDemo: () => void;
  profiles: ApplicationProfile[]; activeProfileId: string; onSelectProfile: (id: string) => void;
  sessionState: SpraySessionState; onChangeSessionState: (value: SpraySessionState) => void;
  snapshot: WeatherSnapshot; onOverrideReading: (height: MeasurementHeight, patch: ReadingPatch) => void;
}
export function ControlPanel(props: ControlPanelProps) {
  return <section className="panel controls" aria-label="Demo controls">
    <div className="eyebrow">DEMO CONTROLS</div>
    <label>Scenario<select aria-label="Scenario" value={props.activeScenarioId} onChange={e => props.onSelectScenario(e.target.value)}>
      {props.scenarios.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label>
    <div className="button-row">
      <button className="primary" onClick={props.onTogglePlay}>{props.isPlaying ? 'Pause' : 'Play'}</button>
      <button onClick={props.onStepTick}>Step</button>
      <button onClick={props.onResetDemo}>Reset Demo</button>
    </div>
    <p className="muted small">Step {props.tickIndex} · Each step advances simulation time by one minute.</p>
    <label>Application profile<select aria-label="Application profile" value={props.activeProfileId} onChange={e => props.onSelectProfile(e.target.value)}>
      {props.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
    </select></label>
    <label>Spray session<select aria-label="Spray session" value={props.sessionState} onChange={e => props.onChangeSessionState(e.target.value as SpraySessionState)}>
      <option value="IDLE">Before spraying</option><option value="ACTIVE_SPRAY">Spraying</option><option value="POST_SPRAY_WATCH">Post-spray watch</option>
    </select></label>
    {([5, 30] as const).map(height => {
      const reading = height === 5 ? props.snapshot.ground_5ft : props.snapshot.canopy_30ft;
      return <fieldset key={height}>
        <legend>{height} ft manual readings</legend>
        <div className="input-grid">
          {([['temp_f', 'Temperature (°F)'], ['wind_speed_mph', 'Wind (mph)'], ['wind_dir_deg', 'Direction (°)'], ['humidity_pct', 'Humidity (%)']] as const).map(([key, label]) =>
            <label key={key}>{label}<input type="number" step="any" aria-label={`${height} ft ${label}`} value={reading[key] ?? ''}
              onChange={e => props.onOverrideReading(height, { [key]: e.target.value === '' ? null : e.target.valueAsNumber })} /></label>)}
        </div>
        <button className="text-button" onClick={() => props.onOverrideReading(height, { temp_f: null })}>Simulate missing {height} ft temperature</button>
      </fieldset>;
    })}
  </section>;
}
