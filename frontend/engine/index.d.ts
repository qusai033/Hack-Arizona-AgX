import type { WeatherInput, CanopySnapshot, PesticideProfile, SpraySession, EvaluationContext } from '../types.js';
export type Evaluation = CanopySnapshot['evaluation'] & {caught_hidden_risk: boolean};
export type ProfileId = 'contact_fungicide' | 'volatile_formulation' | 'fine_airblast' | 'dormant_oil';
export const ENGINE_VERSION: string;
export const PROFILES: Readonly<Record<ProfileId, Readonly<PesticideProfile>>>;
export const SESSION_STATES: readonly SpraySession['state'][];
export function getProfile(id: ProfileId): PesticideProfile;
export interface Thresholds {
  minWind:number; maxWind:number; windCautionAbove:number; inversionStopAbove:number;
  speedShearCautionAt:number; speedShearStopAt:number; directionCautionAt:number;
  directionStopAt:number; directionStopMinUpperWind:number; monitorHours:number;
}
export function thresholdsFor(profile:PesticideProfile):Readonly<Thresholds>;
export function evaluate(input:unknown, context?:EvaluationContext):Evaluation;
export function evaluateSnapshot(input:WeatherInput, context?:EvaluationContext):CanopySnapshot & {evaluation:Evaluation};
export type WetBulb = {available:false;reason:string} | {available:true;dry_bulb_c:number;wet_bulb_c:number;depression_c:number;depression_f:number;method:string};
export interface SessionMonitor {
  state:SpraySession['state']; monitoring:boolean; expired:boolean; elapsed_hours:number|null;
  monitor_hours:number; alert:Evaluation['triggered_rules'][number]|null; message:string;
}
export type Diagnostics = {engine_version:string;error:string} | {
  engine_version:string;thresholds:Thresholds;inversion_delta_f:number;speed_shear_mph:number;
  signed_speed_delta_mph:number;direction_shear_deg:number;wet_bulb:Record<'ground_5ft'|'canopy_30ft',WetBulb>;session:SessionMonitor|null;
};
export function analyze(input:unknown,context?:EvaluationContext):{evaluation:Evaluation;diagnostics:Diagnostics};
export function wetBulbDepression(tempF:number,rh:number):WetBulb;
export function createSession(block:string,profile:PesticideProfile):Readonly<SpraySession>;
export function assertSession(session:SpraySession):SpraySession;
export function startSpray(session:SpraySession,at:string):Readonly<SpraySession>;
export function finishSpray(session:SpraySession,at:string,endObservation?:WeatherInput):Readonly<SpraySession>;
export function monitorSession(input:WeatherInput,session:SpraySession):SessionMonitor;
