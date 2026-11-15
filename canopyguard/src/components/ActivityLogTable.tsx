/** TEAMMATE 3 STUB: table uses the full teammate 4 event contract. */
import type { ActivityLogEntry } from '../types/canopy';
export interface ActivityLogTableProps {
  entries: ActivityLogEntry[]; onRecordManualSnapshot: () => void; onExportCsv: () => void; onClearLog: () => void;
}
export function ActivityLogTable({ entries, onRecordManualSnapshot, onExportCsv, onClearLog }: ActivityLogTableProps) {
  return <section className="panel activity" aria-label="Activity and decision log">
    <div className="section-heading"><div><div className="eyebrow">ACTIVITY & DECISION LOG</div><p><output aria-label="Activity entry count">{entries.length}</output> recorded events</p></div>
      <div className="button-row"><button onClick={onRecordManualSnapshot}>Record Snapshot</button><button onClick={onExportCsv}>Export CSV</button><button onClick={onClearLog}>Clear Log</button></div>
    </div>
    <div className="table-scroll"><table><thead><tr><th>#</th><th>Simulation time (UTC)</th><th>Event</th><th>Scenario</th><th>Status / reason</th></tr></thead>
      <tbody>{entries.slice(-50).reverse().map(entry => <tr key={entry.event_id}>
        <td>{entry.sequence_number}</td><td>{entry.recorded_at_sim_iso.slice(11, 19)}</td><td>{entry.event_type.replaceAll('_', ' ').toLowerCase()}</td>
        <td>{entry.snapshot.scenario_label}</td><td><span className={`badge status-${entry.evaluation.status.toLowerCase()}`}>{entry.evaluation.status}</span><br />{entry.evaluation.headline}</td>
      </tr>)}</tbody></table></div>
    {!entries.length && <p className="muted">No recorded events. Step the simulation or record a snapshot.</p>}
    {entries.length > 50 && <p className="small muted">Showing the latest 50 events. CSV includes the full log.</p>}
  </section>;
}
