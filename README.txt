Control and monitor your Grohe Sense Guard water security system from Homey Pro.

Protect your home from water damage by integrating your Grohe Sense Guard smart water controller with Homey. Monitor water consumption, detect leaks early, track water pressure and temperature, and automatically shut off the main water valve in emergency scenarios using Homey Flows.

FEATURES
• Valve Control: Open and close your main water valve from Homey and Flows.
• Water Leak Alarm: Instant detection of pipe breaks, flooding, unusual water consumption, and micro-leakages.
• Water Pressure & Flow: Real-time logging of water pressure (bar) and water flow rate (l/min) with Homey Insights.
• Temperature & Frost Warning: Water temperature monitoring (°C) and freeze protection warnings.
• Water Consumption: Track daily water consumption (l) and cumulative total consumption (l).
• Flow Cards: Complete set of triggers (When), conditions (And), and actions (Then) to automate your smart home water security.

HOW TO SETUP
1. In the Homey app, tap Devices → + → Grohe Sense → Grohe Sense Guard.
2. Follow the on-screen instructions to enter your Grohe Ondus Refresh Token:
   a. In your desktop browser, open developer tools (F12 → Network tab).
   b. Navigate to: https://idp2-apigw.cloud.grohe.com/v3/iot/oidc/login
   c. Log in to your GROHE Ondus account.
   d. In the Network tab, locate the redirect starting with "ondus://.../token?...".
   e. Open a new tab, paste that URL and replace "ondus://" with "https://".
   f. Copy the "refresh_token" value and paste it into the Homey pairing screen.
3. Select your Sense Guard to complete the setup.

VIBE CODING & ACKNOWLEDGEMENTS
This app was created using "vibe coding" (AI-assisted rapid software engineering). Full credit and heartfelt gratitude go to the brilliant open source community and the developers who previously reverse-engineered and documented the Grohe Ondus API:
• Frank Aune (@faune) – Author of the fantastic "homebridge-grohe-sense" plugin, whose API design, endpoint structures, and notification handling served as a primary reference.
• FlorianSW (@FlorianSW) – Pioneer of "grohe-ondus-api-java" and early Grohe Ondus API analysis.
• Gunnar Kreitz (@gkreitz) – Author of "homeassistant-grohe_sense".
• Patrick Nitsch (@patricknitsch) – Maintainer of "ioBroker.grohe-smarthome".

DISCLAIMER
This app is an independent community project and is not officially affiliated with, maintained, or endorsed by GROHE AG. Grohe and Grohe Sense are trademarks of GROHE AG.
