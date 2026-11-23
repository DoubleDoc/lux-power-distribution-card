# EG4 / Luxpower status, fault and warning names

The card itself doesn't name EG4 operating modes, faults or warnings beyond upstream's status table. This page gives a ready-made set of names for **EG4** inverters (Luxpower OEM hardware, e.g. the 18kPV and 12kPV) that you can paste into the card, plus the reasons where they differ from EG4's own wording.

## Where the names come from

- **Status codes** (the operating mode, input register 0): the labels of the `Operating State` sensor in **[EG4 Web Monitor](https://github.com/joyfulhouse/eg4_web_monitor) v3.5.0** (`translations/en.json`), which follow EG4/Luxpower's "Table 9 — Operational mode definitions", corrected against real hardware (its issue #262). The adjustments below are ours.
- **Fault and warning bits** (input registers 60-61 and 62-63, bitmasks): `constants/fault_codes.py` in **[pylxpweb](https://github.com/joyfulhouse/pylxpweb) 0.9.38** (MIT), the library EG4 Web Monitor 3.5.0 uses (it requires `pylxpweb>=0.9.38`; the table is unchanged up to 0.10.0b15). [lxp_modbus](https://github.com/ant0nkr/luxpower-ha-integration) 1.1.2 uses the same names.
- The names match the fault and alarm lists in the [EG4 18kPV manual](https://eg4electronics.com/wp-content/uploads/2024/04/EG4-18KPV-12LV-Manual.pdf) (section 12.4), which uses the inverter screen's shorter wording but doesn't give bit numbers. The bit numbers of E019, W000, W026 and W027 were also confirmed on the EG4 forum; the others are as pylxpweb decodes them.

If you use other names, change any line: entries you add to the card always win over its built-in names.

## Quick setup

1. Edit the card and switch the editor to YAML (**Show code editor**).
2. Paste the block below at the top level of the card's YAML. If the card already has a `status_codes:` section, put these keys inside it instead (keep your `entities`).
3. Add your fault and warning code entities, one per inverter in the same order as the other lists. With EG4 Web Monitor they're named like `sensor.<model>_<serial>_fault_code` and `…_warning_code`:

   ```yaml
   status_codes:
     entities:
       - sensor.18kpv_1234567890_status_code
     fault_entities:
       - sensor.18kpv_1234567890_fault_code
     warning_entities:
       - sensor.18kpv_1234567890_warning_code
   ```

4. Save. The names can also be edited in the UI editor, under **Temperature, Update Time and Status → Status code names and colours**.

```yaml
status_codes:
  # Status code names (EG4 Web Monitor 3.5.0 labels, adjusted; see the table above)
  code_names:
    0: Standby
    1: Fault
    2: Programming
    4: PV → Inverter
    8: PV → Battery
    12: PV → Battery + Inverter
    16: Battery → Inverter
    17: Standby
    20: PV + Battery → Inverter
    32: Grid → Battery
    40: PV + Grid → Battery
    64: "Off-grid: Battery"
    96: "Off-grid: AC-coupled charging"
    128: "Off-grid: PV only (unstable)"
    136: "Off-grid: PV + charging"
    192: "Off-grid: PV + Battery"
  # Colours that differ from the card's defaults
  overwrite_as_normal: [8, 17, 96]
  # Fault and warning bit names (pylxpweb 0.9.38, constants/fault_codes.py, MIT)
  fault_names:
    0: Internal communication failure 1
    1: Model fault
    8: Parallel CAN communication failure
    9: The host is missing
    10: Inconsistent rated power
    11: Inconsistent AC or safety settings
    12: UPS short circuit
    13: UPS reverse current
    14: BUS short circuit
    15: Abnormal phase in three-phase system
    16: Relay failure
    17: Internal communication failure 2
    18: Internal communication failure 3
    19: BUS overvoltage
    20: EPS connection fault
    21: PV overvoltage
    22: Overcurrent protection
    23: Neutral fault
    24: PV short circuit
    25: Heatsink temperature out of range
    26: Internal failure
    27: Consistency failure
    28: Inconsistent generator connection
    29: Parallel sync signal loss
    31: Internal communication failure 4
  warning_names:
    0: Battery communication failed
    1: AFCI communication failure
    2: Battery low temperature
    3: Meter communication failed
    4: Battery cannot be charged/discharged
    5: Automated test failed
    6: RSD Active
    7: LCD communication failure
    8: Software version mismatch
    9: Fan is stuck
    10: Grid overload
    11: Number of parallel secondaries exceeds limit
    12: Battery reverse MOS abnormal
    13: Radiator temperature out of range
    14: Multiple primary units set in parallel system
    15: Battery reverse
    16: No grid connection
    17: Grid voltage out of range
    18: Grid frequency out of range
    20: Insulation resistance low
    21: Leakage current too high
    22: DCI exceeded standard
    23: PV short circuit
    25: Battery overvoltage
    26: Battery undervoltage
    27: Battery open circuit
    28: EPS overload
    29: EPS voltage high
    30: Meter reversed
    31: DCV exceeded standard
```

### Alternatives

- **EG4's own wording, in your Home Assistant language:** leave out `code_names` and set `description_entities` to EG4 Web Monitor's operating-state sensor, one per inverter (e.g. `sensor.<model>_<serial>_operating_state`). The status line then shows exactly what that sensor shows ("PV → Grid", "AC → Battery", …). Keep `overwrite_as_normal` for the colours.
- **lxp_modbus:** it has text sensors for the active faults and warnings ("Active Fault (Text)", "Active Warning (Text)") and a descriptive status sensor. Point `fault_text_entities`, `warning_text_entities` and `description_entities` at them, alongside its fault and warning code sensors; you then don't need `fault_names` / `warning_names`.

## Status codes

| Code | EG4 Web Monitor label | Name here | Colour | Why |
|---:|---|---|---|---|
| 0 | Standby | Standby | normal |  |
| 1 | Fault | Fault | error |  |
| 2 | Programming | Programming | warning |  |
| 4 | PV → Grid | PV → Inverter | normal | The code says PV is going out the inverter's AC side; it can't tell loads from export (the house is fed first, only the surplus is exported). "Grid" reads like export. |
| 8 | PV → Battery | PV → Battery | **normal** (upstream: warning, "No power to home") | Table 9 and an EG4 user (upstream #81) say 8 is normal operation: PV charging the battery. |
| 12 | PV → Battery + Grid | PV → Battery + Inverter | normal | As 4. |
| 16 | Battery → Grid | Battery → Inverter | normal | As 4. |
| 17 | Standby (not in Table 9) | Standby | **normal** (upstream: error, "High temp") | Not in Table 9; EG4 Web Monitor and lxp_modbus both map it to Standby, as seen on real hardware. |
| 20 | PV + Battery → Grid | PV + Battery → Inverter | normal | As 4. |
| 32 | AC → Battery | Grid → Battery | normal | Charging from the AC side. Kept as "Grid"; with AC-coupled PV and no grid power the inverter reports this code too, so rename it if that's your setup. |
| 40 | PV + AC → Battery | PV + Grid → Battery | normal | As 32. |
| 64 | Off-Grid (Battery) | Off-grid: Battery | normal |  |
| 96 | Off-Grid (AC-Coupled Charging) | Off-grid: AC-coupled charging | **normal** (upstream: warning, unknown code) | Upstream doesn't know this code. |
| 128 | Off-Grid (PV, unstable) | Off-grid: PV only (unstable) | warning (upstream: unknown code) | Off-grid on PV alone; EG4 Web Monitor notes the inverter is inhibited. Left as a warning. |
| 136 | Off-Grid (PV + Charging) | Off-grid: PV + charging | normal |  |
| 192 | Off-Grid (PV + Battery) | Off-grid: PV + Battery | normal |  |

Codes 9 ("Normal (Selling)") and 10 ("Normal") are in upstream's table but not in Table 9; they keep upstream's names. Any other code shows as "Unknown code N" in orange until you add it to `code_names`.

## Fault bits

| Bit | Shown as | Name |
|---:|---|---|
| 0 | E000 | Internal communication failure 1 |
| 1 | E001 | Model fault |
| 8 | E008 | Parallel CAN communication failure |
| 9 | E009 | The host is missing |
| 10 | E010 | Inconsistent rated power |
| 11 | E011 | Inconsistent AC or safety settings |
| 12 | E012 | UPS short circuit |
| 13 | E013 | UPS reverse current |
| 14 | E014 | BUS short circuit |
| 15 | E015 | Abnormal phase in three-phase system |
| 16 | E016 | Relay failure |
| 17 | E017 | Internal communication failure 2 |
| 18 | E018 | Internal communication failure 3 |
| 19 | E019 | BUS overvoltage |
| 20 | E020 | EPS connection fault |
| 21 | E021 | PV overvoltage |
| 22 | E022 | Overcurrent protection |
| 23 | E023 | Neutral fault |
| 24 | E024 | PV short circuit |
| 25 | E025 | Heatsink temperature out of range |
| 26 | E026 | Internal failure |
| 27 | E027 | Consistency failure |
| 28 | E028 | Inconsistent generator connection |
| 29 | E029 | Parallel sync signal loss |
| 31 | E031 | Internal communication failure 4 |

## Warning bits

| Bit | Shown as | Name |
|---:|---|---|
| 0 | W000 | Battery communication failed |
| 1 | W001 | AFCI communication failure |
| 2 | W002 | Battery low temperature |
| 3 | W003 | Meter communication failed |
| 4 | W004 | Battery cannot be charged/discharged |
| 5 | W005 | Automated test failed |
| 6 | W006 | RSD Active |
| 7 | W007 | LCD communication failure |
| 8 | W008 | Software version mismatch |
| 9 | W009 | Fan is stuck |
| 10 | W010 | Grid overload |
| 11 | W011 | Number of parallel secondaries exceeds limit |
| 12 | W012 | Battery reverse MOS abnormal |
| 13 | W013 | Radiator temperature out of range |
| 14 | W014 | Multiple primary units set in parallel system |
| 15 | W015 | Battery reverse |
| 16 | W016 | No grid connection |
| 17 | W017 | Grid voltage out of range |
| 18 | W018 | Grid frequency out of range |
| 20 | W020 | Insulation resistance low |
| 21 | W021 | Leakage current too high |
| 22 | W022 | DCI exceeded standard |
| 23 | W023 | PV short circuit |
| 25 | W025 | Battery overvoltage |
| 26 | W026 | Battery undervoltage |
| 27 | W027 | Battery open circuit |
| 28 | W028 | EPS overload |
| 29 | W029 | EPS voltage high |
| 30 | W030 | Meter reversed |
| 31 | W031 | DCV exceeded standard |
