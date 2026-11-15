/** TEAMMATE 3 STUB: replace presentation while preserving this props contract. */
import type { EvaluationResult, SpraySessionState, WeatherSnapshot } from '../types/canopy';
export interface DecisionBannerProps {
  evaluation: EvaluationResult; snapshot: WeatherSnapshot; sessionState: SpraySessionState;
}
export function DecisionBanner({ evaluation, snapshot, sessionState }: DecisionBannerProps) {
  return <section className={`panel decision decision-${evaluation.status.toLowerCase()}`} aria-label="Weather decision">
    <div className="eyebrow">CURRENT ASSESSMENT · {sessionState.replaceAll('_', ' ')}</div>
    <div className="decision-line"><span className={`badge status-${evaluation.status.toLowerCase()}`}>{evaluation.status}</span><h2>{evaluation.headline}</h2></div>
    <p className="muted">{snapshot.source.replaceAll('_', ' ')} · Rules {evaluation.rule_version}</p>
    {evaluation.data_quality.issues.length > 0 && <p>{evaluation.data_quality.issues.join(' ')}</p>}
    {evaluation.triggered_rules.map(rule => <p key={rule.code}><strong>{rule.metric_summary}</strong> — {rule.plain_reason}</p>)}
    <p className="disclaimer">Decision-support prototype using simulated/regional inputs. Does not replace pesticide product labels, on-site measurements, or local regulations.</p>
  </section>;
}
