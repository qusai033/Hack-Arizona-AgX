/** TEAMMATE 3 STUB: replace presentation while preserving this props contract. */
import type { EvaluationResult, WeatherSnapshot } from '../types/canopy';
export interface ComparisonCardsProps { snapshot: WeatherSnapshot; evaluation: EvaluationResult }
export function ComparisonCards({ snapshot, evaluation }: ComparisonCardsProps) {
  return <section className="comparison" aria-label="Height comparison">
    {([['Ground-only station', snapshot.ground_5ft, evaluation.ground_only_baseline.status],
      ['Above the canopy', snapshot.canopy_30ft, evaluation.status]] as const).map(([label, reading, status]) =>
      <article className="panel" key={label}>
        <div className="eyebrow">{reading.height_ft} FT · {label}</div>
        <div className="reading">{reading.temp_f ?? 'N/A'}<small> °F</small></div>
        <p>{reading.wind_speed_mph ?? 'N/A'} mph · {reading.wind_dir_deg ?? 'N/A'}° wind</p>
        <span className={`badge status-${status.toLowerCase()}`}>{status}</span>
        {reading.height_ft === 5 && <p className="muted small">Unobservable from 5 ft: {evaluation.ground_only_baseline.unobservable_checks.join(', ')}.</p>}
        {reading.height_ft === 30 && evaluation.hidden_risk_caught && <p>Hidden upper-canopy hazard detected</p>}
      </article>)}
  </section>;
}
