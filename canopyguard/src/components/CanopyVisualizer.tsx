/** TEAMMATE 3 STUB: schematic only; final wind/thermal visualization belongs to teammate 3. */
import type { EvaluationResult, WeatherSnapshot } from '../types/canopy';
export interface CanopyVisualizerProps { snapshot: WeatherSnapshot; evaluation: EvaluationResult }
export function CanopyVisualizer({ snapshot }: CanopyVisualizerProps) {
  return <section className="panel" aria-label="Orchard cross-section">
    <div className="eyebrow">TWO HEIGHTS · ONE ORCHARD</div>
    <svg viewBox="0 0 600 150" role="img" aria-label="Schematic orchard with 5-foot and 30-foot measurement heights">
      <path d="M20 130H580" stroke="#c8d6ca" strokeWidth="2" />
      {[150, 270, 390].map(x => <g key={x}><path d={`M${x} 125V60`} stroke="#876950" strokeWidth="10" /><ellipse cx={x} cy="58" rx="46" ry="34" fill="#d4e2c7" /></g>)}
      <path d="M30 22H570M30 110H570" stroke="#577b64" strokeDasharray="4 5" />
      <text x="32" y="16" fontSize="12" fill="#294f36">30 ft · {snapshot.canopy_30ft.temp_f ?? 'N/A'} °F</text>
      <text x="32" y="105" fontSize="12" fill="#294f36">5 ft · {snapshot.ground_5ft.temp_f ?? 'N/A'} °F</text>
    </svg>
  </section>;
}
