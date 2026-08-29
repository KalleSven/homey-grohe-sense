'use strict';

module.exports = {
  BASE_URL: 'https://idp2-apigw.cloud.grohe.com/v3/iot',
  LOGIN_URL: 'https://idp2-apigw.cloud.grohe.com/v3/iot/oidc/login',
  REFRESH_URL: 'https://idp2-apigw.cloud.grohe.com/v3/iot/oidc/refresh',

  TYPE_SENSE: 101,
  TYPE_SENSE_PLUS: 102,
  TYPE_SENSE_GUARD: 103,
  TYPE_BLUE_HOME: 104,
  TYPE_BLUE_PROFESSIONAL: 105,

  NOTIFICATION_CATEGORY_FIRMWARE: 10,
  NOTIFICATION_CATEGORY_WARNING: 20,
  NOTIFICATION_CATEGORY_CRITICAL: 30,

  NOTIFICATIONS: {
    10: {
      10: { en: 'Sense integration successful', sv: 'Sense integration lyckades' },
      60: { en: 'Sense firmware update available', sv: 'Sense firmware-uppdatering tillgänglig' },
      410: { en: 'Guard integration successful', sv: 'Sense Guard integration lyckades' },
      460: { en: 'Guard firmware update available', sv: 'Sense Guard firmware-uppdatering tillgänglig' },
    },
    20: {
      11: { en: 'Battery is at critical level', sv: 'Batteriet är på en kritisk nivå' },
      12: { en: 'Battery is empty', sv: 'Batteriet är tomt' },
      20: { en: 'Temperature below minimum limit', sv: 'Temperatur under minimigräns' },
      21: { en: 'Temperature above maximum limit', sv: 'Temperatur över maximigräns' },
      40: { en: 'Frost warning! Freezing temperatures detected', sv: 'Frostvarning! Mycket låg temperatur' },
      80: { en: 'Guard lost WiFi connection', sv: 'Sense Guard tappade WiFi-anslutning' },
      91: { en: 'Guard is offline - no connection to GROHE cloud', sv: 'Sense Guard är offline' },
      92: { en: 'Pressure test was skipped due to water usage', sv: 'Trycktest hoppades över pga vattenanvändning' },
      320: { en: 'Unusual water consumption detected - water shut off', sv: 'Ovanlig vattenförbrukning - vattnet har stängts av' },
      321: { en: 'Unusual water consumption detected', sv: 'Ovanlig vattenförbrukning detekterad' },
      330: { en: 'Micro leakage detected', sv: 'Mikroläckage upptäckt' },
      332: { en: 'Micro leakage detected over several days', sv: 'Mikroläckage detekterat under flera dagar' },
      340: { en: 'Frost warning! Freezing temperatures detected', sv: 'Frostvarning! Mycket låg temperatur' },
      420: { en: 'Repeated pressure problems - water shut off', sv: 'Återkommande tryckproblem - vattnet har stängts av' },
      421: { en: 'Repeated pressure problems detected', sv: 'Återkommande tryckproblem detekterade' },
    },
    30: {
      0: { en: 'Flooding detected - water shut off', sv: 'Översvämning detekterad - vattnet har stängts av' },
      310: { en: 'Pipe break detected - water shut off', sv: 'Rörbrott detekterat - vattnet har stängts av' },
      400: { en: 'Maximum volume reached - water shut off', sv: 'Maximal vattenvolym nådd - vattnet har stängts av' },
      430: { en: 'Water detected by Sense sensor - water shut off', sv: 'Vatten detekterat av Sense-sensor - vattnet har stängts av' },
      431: { en: 'Water detected by Sense sensor', sv: 'Vatten detekterat av Sense-sensor' },
    },
  },
};
