'use strict';

module.exports = {
  BASE_URL: 'https://idp2-apigw.cloud.grohe.com/v3/iot',
  LOGIN_URL: 'https://idp2-apigw.cloud.grohe.com/v3/iot/oidc/login',
  REFRESH_URL: 'https://idp2-apigw.cloud.grohe.com/v3/iot/oidc/refresh',

  REQUEST_TIMEOUT_MS: 15000,

  TYPE_SENSE: 101,
  TYPE_SENSE_PLUS: 102,
  TYPE_SENSE_GUARD: 103,
  TYPE_BLUE_HOME: 104,
  TYPE_BLUE_PROFESSIONAL: 105,

  DEFAULT_APPLIANCE_NAMES: {
    101: 'Grohe Sense',
    102: 'Grohe Sense+',
    103: 'Grohe Sense Guard',
  },

  NOTIFICATION_CATEGORY_FIRMWARE: 10,
  NOTIFICATION_CATEGORY_WARNING: 20,
  NOTIFICATION_CATEGORY_CRITICAL: 30,

  // Which alarm each notification drives, per device kind. A rule matches a notification's
  // category and (if `types` is set) its type. `label` is used as the alarm_type flow token.
  ALARM_RULES: {
    sense: [
      { alarm: 'water', category: 30, label: { en: 'Critical Alarm (Water Detected)', nl: 'Kritiek alarm (water gedetecteerd)', sv: 'Kritiskt larm (Vatten detekterat)' } },
      { alarm: 'water', category: 20, types: [430, 431], label: { en: 'Water Detected', nl: 'Water gedetecteerd', sv: 'Vatten detekterat' } },
      { alarm: 'frost', category: 20, types: [40, 340], label: { en: 'Frost Warning', nl: 'Vorstwaarschuwing', sv: 'Frostvarning' } },
    ],
    guard: [
      { alarm: 'water', category: 30, label: { en: 'Critical Alarm', nl: 'Kritiek alarm', sv: 'Kritiskt larm' } },
      { alarm: 'water', category: 20, types: [320, 321, 420, 421], label: { en: 'Unusual Consumption / Pressure Issue', nl: 'Ongebruikelijke consumptie / drukprobleem', sv: 'Ovanlig förbrukning / Tryckproblem' } },
      { alarm: 'micro_leak', category: 20, types: [330, 332], label: { en: 'Micro Leak', nl: 'Microlekkage', sv: 'Mikroläckage' } },
      { alarm: 'frost', category: 20, types: [40, 340], label: { en: 'Frost Warning', nl: 'Vorstwaarschuwing', sv: 'Frostvarning' } },
    ],
  },

  NOTIFICATIONS: {
    10: {
      10: { en: 'Sense integration successful', nl: 'Sense-integratie geslaagd', sv: 'Sense integration lyckades' },
      60: { en: 'Sense firmware update available', nl: 'Sense-firmware-update beschikbaar', sv: 'Sense firmware-uppdatering tillgänglig' },
      410: { en: 'Guard integration successful', nl: 'Guard-integratie geslaagd', sv: 'Sense Guard integration lyckades' },
      460: { en: 'Guard firmware update available', nl: 'Guard-firmware-update beschikbaar', sv: 'Sense Guard firmware-uppdatering tillgänglig' },
    },
    20: {
      11: { en: 'Battery is at critical level', nl: 'Batterij is op een kritiek niveau', sv: 'Batteriet är på en kritisk nivå' },
      12: { en: 'Battery is empty', nl: 'Batterij is leeg', sv: 'Batteriet är tomt' },
      20: { en: 'Temperature below minimum limit', nl: 'Temperatuur onder minimumgrens', sv: 'Temperatur under minimigräns' },
      21: { en: 'Temperature above maximum limit', nl: 'Temperatuur boven maximumgrens', sv: 'Temperatur över maximigräns' },
      30: { en: 'Humidity below minimum limit', nl: 'Luchtvochtigheid onder minimumgrens', sv: 'Luftfuktighet under minimigräns' },
      31: { en: 'Humidity above maximum limit', nl: 'Luchtvochtigheid boven maximumgrens', sv: 'Luftfuktighet över maximigräns' },
      40: { en: 'Frost warning! Freezing temperatures detected', nl: 'Vorstwaarschuwing! Bevriezingstemperaturen gedetecteerd', sv: 'Frostvarning! Mycket låg temperatur' },
      80: { en: 'Guard lost WiFi connection', nl: 'Guard verloor WiFi-verbinding', sv: 'Sense Guard tappade WiFi-anslutning' },
      91: { en: 'Guard is offline - no connection to GROHE cloud', nl: 'Guard is offline - geen verbinding met GROHE cloud', sv: 'Sense Guard är offline' },
      92: { en: 'Pressure test was skipped due to water usage', nl: 'Druktest is overgeslagen vanwege watergebruik', sv: 'Trycktest hoppades över pga vattenanvändning' },
      320: { en: 'Unusual water consumption detected - water shut off', nl: 'Ongebruikelijke waterverbruik gedetecteerd - water afgesloten', sv: 'Ovanlig vattenförbrukning - vattnet har stängts av' },
      321: { en: 'Unusual water consumption detected', nl: 'Ongebruikelijke waterverbruik gedetecteerd', sv: 'Ovanlig vattenförbrukning detekterad' },
      330: { en: 'Micro leakage detected', nl: 'Microlekkage gedetecteerd', sv: 'Mikroläckage upptäckt' },
      332: { en: 'Micro leakage detected over several days', nl: 'Microlekkage gedetecteerd over meerdere dagen', sv: 'Mikroläckage detekterat under flera dagar' },
      340: { en: 'Frost warning! Freezing temperatures detected', nl: 'Vorstwaarschuwing! Bevriezingstemperaturen gedetecteerd', sv: 'Frostvarning! Mycket låg temperatur' },
      420: { en: 'Repeated pressure problems - water shut off', nl: 'Herhaalde drukproblemen - water afgesloten', sv: 'Återkommande tryckproblem - vattnet har stängts av' },
      421: { en: 'Repeated pressure problems detected', nl: 'Herhaalde drukproblemen gedetecteerd', sv: 'Återkommande tryckproblem detekterade' },
    },
    30: {
      0: { en: 'Flooding detected - water shut off', nl: 'Overstroming gedetecteerd - water afgesloten', sv: 'Översvämning detekterad - vattnet har stängts av' },
      310: { en: 'Pipe break detected - water shut off', nl: 'Pijpbreuk gedetecteerd - water afgesloten', sv: 'Rörbrott detekterat - vattnet har stängts av' },
      400: { en: 'Maximum volume reached - water shut off', nl: 'Maximaal volume bereikt - water afgesloten', sv: 'Maximal vattenvolym nådd - vattnet har stängts av' },
      430: { en: 'Water detected by Sense sensor - water shut off', nl: 'Water gedetecteerd door Sense-sensor - water afgesloten', sv: 'Vatten detekterat av Sense-sensor - vattnet har stängts av' },
      431: { en: 'Water detected by Sense sensor', nl: 'Water gedetecteerd door Sense-sensor', sv: 'Vatten detekterat av Sense-sensor' },
    },
  },
};
