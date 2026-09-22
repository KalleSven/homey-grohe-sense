# Changelog

All notable changes to this project will be documented in this file.

## [1.1.3] - 2026-09-22

### Changed
- Refined app description into a clear, engaging tagline in English and Swedish.
- Modernized and simplified README according to Athom App Store Guidelines.
- Redesigned app and driver icons into clean vector outlines (960x960, solid black on transparent background).
- Updated app store banners and added real product photos on white background for device pairing.
- Standardized pairing views with English base language and complete Swedish localization via Homey i18n (`locales/`).
- Removed redundant `alarm_battery` capability on Grohe Sense in favor of `measure_battery` to avoid duplicate UI components.

## [1.1.2] - 2026-09-20

### Changed
- Removed redundant cumulative total consumption meter (`meter_water`) on Grohe Sense Guard to focus on accurate and reliable daily water consumption (`meter_water_today`) tracking.
- Automatically cleans up deprecated total consumption capability on existing paired devices without requiring re-pairing.

## [1.1.1] - 2026-09-15

### Added
- **Silence Alarms Button**: Dedicated button on device controls to quickly silence and reset active alarms.
- **Flow Action Card**: Added *Silence / Reset alarms* action card to mute/clear all or specific alarms via Flows and automations.
- **Smart Cloud Acknowledge & Local Snooze**: Muted alarms remain silenced across polling cycles and dismiss notifications/buzzer via Grohe Cloud API.
- **Community Forum Link**: Added direct integration with the Homey Community forum thread.

## [1.1.0] - 2026-09-08

### Added
- Support for **Grohe Sense** and **Grohe Sense+** water sensor devices (Type 101 & 102).
- **Direct Login with Email & Password**: Simplified pairing flow that automatically authenticates with Grohe Cloud without manual token extraction.
- **Smart Link / Token Parser**: Support for pasting `ondus://` redirect links, JSON payloads, or raw tokens directly.
- Monitoring of ambient temperature (`measure_temperature`, °C) and humidity (`measure_humidity`, %).
- Water leak detection (`alarm_water`) and frost alarm (`alarm_frost`).
- Battery percentage (`measure_battery`, %) and low battery alert (`alarm_battery`).
- Automatic discovery during pairing with Grohe Ondus account.

## [1.0.0] - 2026-08-28

### Added
- Initial release for Athom Homey Pro (Homey SDK v3).
- Full integration with Grohe Ondus Cloud API for Grohe Sense Guard (Type 103).
- **Valve Control**: Open and close the main water valve with instant status sync.
- **Insights & Telemetry**:
  - Water temperature (`measure_temperature`, °C)
  - Water pressure (`measure_pressure`, bar)
  - Water flow rate (`measure_water_flow`, l/min)
  - Daily water consumption (`meter_water_today`, l)
  - Cumulative total water consumption (`meter_water`, l)
- **Alarms**:
  - Water leak alarms (`alarm_water`)
  - Micro leak detection (`alarm_micro_leak`)
  - Frost warning protection (`alarm_frost`)
- **Flow Cards**:
  - Triggers for valve opened/closed, leak alarms, frost warnings, pressure changes, and daily consumption updates.
  - Conditions for valve open/closed, leak active, pressure threshold comparisons, and frost warnings.
  - Actions for opening, closing, toggling the valve, and manual cloud sync.
- Interactive pairing flow with Grohe Ondus Refresh Token authentication.
- Localization in English (`en`) and Swedish (`sv`).
