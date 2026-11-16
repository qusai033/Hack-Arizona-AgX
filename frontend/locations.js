/** Stable city IDs shared by the selector, NWS fetches, cache, and audit source labels.
 * California coordinates locate city centers, not verified orchard sensor installations.
 * Arizona entries sit at an AZMET station (published coordinates) and name it in
 * `azmet_station`, so the regional forecast can be checked against that station.
 */
export const locations = Object.freeze({
  fresno: Object.freeze({label:'Fresno, CA',state:'CA',latitude:36.7378,longitude:-119.7871,zone:'America/Los_Angeles',block:'Fresno, CA · forecast area'}),
  modesto: Object.freeze({label:'Modesto, CA',state:'CA',latitude:37.6391,longitude:-120.9969,zone:'America/Los_Angeles',block:'Modesto, CA · forecast area'}),
  merced: Object.freeze({label:'Merced, CA',state:'CA',latitude:37.3022,longitude:-120.4830,zone:'America/Los_Angeles',block:'Merced, CA · forecast area'}),
  bakersfield: Object.freeze({label:'Bakersfield, CA',state:'CA',latitude:35.3733,longitude:-119.0187,zone:'America/Los_Angeles',block:'Bakersfield, CA · forecast area'}),
  chico: Object.freeze({label:'Chico, CA',state:'CA',latitude:39.7285,longitude:-121.8375,zone:'America/Los_Angeles',block:'Chico, CA · forecast area'}),
  yuba_city: Object.freeze({label:'Yuba City, CA',state:'CA',latitude:39.1404,longitude:-121.6169,zone:'America/Los_Angeles',block:'Yuba City, CA · forecast area'}),
  yuma_valley: Object.freeze({label:'Yuma Valley, AZ',state:'AZ',latitude:32.71,longitude:-114.7,zone:'America/Phoenix',block:'Yuma Valley, AZ · forecast area',azmet_station:'az02'}),
  yuma_north_gila: Object.freeze({label:'Yuma North Gila, AZ',state:'AZ',latitude:32.78,longitude:-114.52,zone:'America/Phoenix',block:'Yuma North Gila, AZ · forecast area',azmet_station:'az14'}),
  roll: Object.freeze({label:'Roll, AZ',state:'AZ',latitude:32.76,longitude:-113.97,zone:'America/Phoenix',block:'Roll, AZ · forecast area',azmet_station:'az24'}),
  maricopa: Object.freeze({label:'Maricopa, AZ',state:'AZ',latitude:33.07,longitude:-111.97,zone:'America/Phoenix',block:'Maricopa, AZ · forecast area',azmet_station:'az06'}),
  safford: Object.freeze({label:'Safford, AZ',state:'AZ',latitude:32.81,longitude:-109.68,zone:'America/Phoenix',block:'Safford, AZ · forecast area',azmet_station:'az04'}),
  willcox_bench: Object.freeze({label:'Willcox Bench, AZ',state:'AZ',latitude:32.12,longitude:-109.71,zone:'America/Phoenix',block:'Willcox Bench, AZ · forecast area',azmet_station:'az39'})
});
