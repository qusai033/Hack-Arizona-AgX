/** Stull (2011), standard sea-level pressure. Diagnostic, not a label rule.
 * Deliberately restricted to 0..50 C and 5..99% RH to exclude the cold/dry caveat.
 * 100% RH uses the exact saturated identity Tw=T. No extrapolation.
 */
export function wetBulbDepression(tempF,rh) {
  if(!Number.isFinite(tempF)||!Number.isFinite(rh)||rh<0||rh>100)throw new TypeError('Finite temperature and RH 0–100 required.');
  const t=(tempF-32)*5/9;
  if(rh===100)return {available:true,dry_bulb_c:t,wet_bulb_c:t,depression_c:0,depression_f:0,method:'saturated identity'};
  if(t<0||t>50||rh<5||rh>99)return {available:false,reason:'Outside supported Stull range (0–50°C and 5–99% RH).'};
  const tw=t*Math.atan(.151977*Math.sqrt(rh+8.313659))+Math.atan(t+rh)-Math.atan(rh-1.676331)+.00391838*Math.pow(rh,1.5)*Math.atan(.023101*rh)-4.686035;
  if(tw>t)return {available:false,reason:'Approximation exceeds dry-bulb temperature near saturation.'};
  return {available:true,dry_bulb_c:t,wet_bulb_c:tw,depression_c:t-tw,depression_f:(t-tw)*9/5,method:'Stull 2011, standard sea-level pressure'};
}
