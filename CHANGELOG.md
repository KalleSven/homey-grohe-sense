# Changelog

All notable changes to this project will be documented in this file.

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
