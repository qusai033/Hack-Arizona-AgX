import { useCanopyGuard } from './hooks/useCanopyGuard';
import { DecisionBanner } from './components/DecisionBanner';
import { ComparisonCards } from './components/ComparisonCards';
import { CanopyVisualizer } from './components/CanopyVisualizer';
import { ControlPanel } from './components/ControlPanel';
import { ActivityLogTable } from './components/ActivityLogTable';

export function App() {
  const app = useCanopyGuard();
  return <main>
    <header className="app-header">
      <div><div className="eyebrow">ORCHARD WEATHER · SOFTWARE PROTOTYPE</div><h1>CanopyGuard<span> / </span><small>Spray or wait?</small></h1></div>
      <div className="clock"><span className="eyebrow">SIMULATION CLOCK · UTC</span><time dateTime={app.simClockIso} aria-label="Simulation clock">{app.simClockIso.slice(11, 19)}</time></div>
    </header>
    <aside className="scaffold-notice" aria-label="Integration status">
      <strong>Team 4 integration preview.</strong> Weather playback, the risk evaluator, and final dashboard components are placeholders for teammates 1–3. Current STOP labels indicate pending evaluation.
    </aside>
    {app.storageWarning && <p className="storage-warning" role="status">{app.storageWarning}</p>}
    {app.activeAlertBanner && !app.activeAlertBanner.dismissed && <div className="alert-toast" role="alert">
      <strong>{app.activeAlertBanner.severity}</strong> {app.activeAlertBanner.headline}
      <button onClick={app.onDismissAlert} aria-label="Dismiss alert">Dismiss</button>
    </div>}
    <div className="workspace">
      <div className="dashboard">
        <DecisionBanner evaluation={app.currentEvaluation} snapshot={app.currentSnapshot} sessionState={app.sessionState} />
        <ComparisonCards snapshot={app.currentSnapshot} evaluation={app.currentEvaluation} />
        <CanopyVisualizer snapshot={app.currentSnapshot} evaluation={app.currentEvaluation} />
      </div>
      <ControlPanel {...app} snapshot={app.currentSnapshot} onResetDemo={app.resetDemo} />
    </div>
    <ActivityLogTable entries={app.logEntries} onRecordManualSnapshot={app.onRecordManualSnapshot}
      onExportCsv={app.onExportCsv} onClearLog={app.onClearLog} />
    <footer>Local demo · Simulated inputs · Activity stays in this browser unless exported</footer>
  </main>;
}
