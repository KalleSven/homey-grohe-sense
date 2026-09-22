# Grohe Sense & Sense Guard for Athom Homey Pro

Integrates the **Grohe Sense** water sensor and **Grohe Sense Guard** smart water controller with **Athom Homey Pro** (Homey SDK v3).

<p align="center">
  <img src="assets/images/large.png" width="300" alt="Grohe Sense Homey App">
</p>

## Features

### Grohe Sense (Water Sensor)
- 🚨 **Water Leak Alarm** (`alarm_water`)
- 🌡 **Temperature Measurement** (`measure_temperature`, `°C`)
- 💧 **Humidity Measurement** (`measure_humidity`, `%`)
- 🔋 **Battery Monitoring** (`measure_battery`, `%`)
- ❄️ **Frost Warning** (`alarm_frost`)

### Grohe Sense Guard (Smart Water Controller)
- **Valve Control**: Open and close your main water supply valve directly from Homey and Flows.
- **Insights & Metrics**:
  - 🌡 **Water Temperature** (`°C`)
  - ⏱ **Water Pressure** (`bar`)
  - 🌊 **Flow Rate** (`l/min`)
  - 📊 **Water Consumption Today** (`l`)
- **Alarms**:
  - 🚨 **Water Leak Alarm** (Pipe break, flooding, unusual water consumption, Sense sensor detections)
  - 🔬 **Micro Leak Alarm**
  - ❄️ **Frost Warning**

### Flow Cards
- **Triggers (When)**: Valve opened/closed, leak detected, leak alarm cleared, micro leak detected, frost warning, pressure changed, today's consumption changed.
- **Conditions (And)**: Valve is open/closed, leak alarm active, pressure above/below, micro leak active, frost warning active.
- **Actions (Then)**: Open valve, Close valve, Toggle valve, Refresh data from cloud, Silence / Reset alarms.

## Installation & Setup

1. In the Homey app, go to **Devices** &rarr; **+** &rarr; **Grohe Sense** &rarr; select **Grohe Sense** or **Grohe Sense Guard**.
2. **Log in**:
   - **Simple Login (Recommended)**: Enter your Grohe Ondus account **Email** and **Password** directly and tap *Log in with GROHE*.
   - **Social Login / Token**: If using Apple/Google sign-in, switch to the *Link / Token* tab, click the login link in your browser, copy the redirect link (`ondus://...`) or token, and paste it into Homey.
3. Select your device from the discovered list.

## Community & Support

- 💬 **Homey Community Forum Thread**: [https://community.homey.app/t/app-pro-grohe-sense-grohe-sense-guard/159363](https://community.homey.app/t/app-pro-grohe-sense-grohe-sense-guard/159363)
- 🐛 **Issues & Feature Requests**: [https://github.com/KalleSven/homey-grohe-sense/issues](https://github.com/KalleSven/homey-grohe-sense/issues)

## Disclaimer

This app is an independent community project and is not officially affiliated with, endorsed by, or maintained by GROHE AG. Grohe and Grohe Sense are registered trademarks of GROHE AG.

## Development

```bash
# Clone the repository
git clone https://github.com/KalleSven/homey-grohe-sense.git
cd homey-grohe-sense

# Validate and test run app
homey app validate -l debug
homey app run
```
