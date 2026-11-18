# LuxPower Distribution Card

> **Fork of [DanteWinters/lux-power-distribution-card](https://github.com/DanteWinters/lux-power-distribution-card)** adding a DC-coupled generator (charging the batteries directly, with the grid still shown), operating-mode and fault/warning status, entity-based depth of discharge and optional feed spacing; existing configs look and work as before. See [Fork changes](#fork-changes).
>
> It's developed and used with **EG4** inverters, which are Luxpower OEM hardware, using the [EG4 Web Monitor](https://github.com/joyfulhouse/eg4_web_monitor) integration. Until these changes are merged upstream, install this fork as a custom repository (see [Installation](#installation)).

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=flat-square)](https://github.com/hacs/integration)
![GitHub release (latest by date including pre-releases)](https://img.shields.io/github/v/release/DoubleDoc/lux-power-distribution-card?include_prereleases&style=flat-square)
![Github stars](https://img.shields.io/github/stars/DanteWinters/lux-power-distribution-card?style=flat-square)
![Github issues](https://img.shields.io/github/issues/DanteWinters/lux-power-distribution-card?style=flat-square)

A simple power distribution card of an inverter and battery system, for [Home Assistant](https://home-assistant.io/). The card is modelled after LuxpowerTek's app and website.

<img src="https://raw.githubusercontent.com/DanteWinters/lux-power-distribution-card/main/docs/images/full-card-allocated-power.png" width="450" />

## Fork changes

All additions are optional; a config without them renders exactly like upstream. Details are in the [config](/docs/config/config.md) document.

- **`generator`** with `architecture: battery` draws a generator that charges the batteries directly on the DC bus (through its own chargers and the BMSs, not the inverter). It sits above the battery with an animated feed and appears only while running (power above a threshold, or forced on by a `running_entity`). It shows power plus optional voltage, frequency and THD, and its power is added to the battery flow. The grid stays visible. `architecture: grid` gives upstream's original behaviour, where the generator replaces the grid.
- **`status_codes.show_operating_mode`** names the operating mode (e.g. `PV → Battery + Load`) instead of "Normal"; **`fault_entities`** / **`warning_entities`** show non-zero fault and warning codes as red/orange lines.
- **`battery.depth_of_discharge`** also accepts an entity (e.g. the inverter's cut-off SOC setting) or one per inverter.
- **`battery.charge_target`** sets the SoC the charge-time estimate counts up to, instead of a fixed 90% (upstream [#103](https://github.com/DanteWinters/lux-power-distribution-card/issues/103)). It takes a number, an entity (e.g. the inverter's charge SOC limit) or one per inverter.
- **`refresh.button_entities`** makes the refresh button press button entities, one per inverter (plus an optional `parallel_button_entity`), so it works with integrations other than LuxpowerTek, such as EG4 Web Monitor (upstream [#104](https://github.com/DanteWinters/lux-power-distribution-card/issues/104)).
- **Generator in the grid's place** (`grid.generator_*`, or `generator: architecture: grid`): while the generator runs and the grid is idle or down, the grid slot shows the generator's icon, power and voltage.
- **`feed_spacing: true`** leaves a gap between the PV/home feeds and their icons.
- Fixes: a non-numeric SoC shows `—` instead of `NaN`; runtime minutes are zero-padded (`1:05`, not `1:5`).

<img src="https://raw.githubusercontent.com/DoubleDoc/lux-power-distribution-card/main/docs/images/battery-generator-simulated.png" width="400" /> <img src="https://raw.githubusercontent.com/DoubleDoc/lux-power-distribution-card/main/docs/images/battery-generator-live.png" width="300" />

## Installation

Upstream's card is in the default HACS and Marketplace lists, but this fork isn't, so add it as a custom repository. How you do that depends on your Home Assistant version: Home Assistant 2026.11 replaced HACS with the built-in **Marketplace**, and existing HACS installs move over automatically when you update.

The fork uses the same card type (`custom:lux-power-distribution-card`) as upstream, so only one of them can be loaded. If upstream's card is installed, remove it first; your dashboard YAML keeps working unchanged.

### Home Assistant 2026.11 and later (Marketplace)

1. Go to **Settings → Marketplace**. The first time, accept the warning about community projects.
2. Select **Add from link** (top right), enter `DoubleDoc/lux-power-distribution-card` and select **Add**. This needs a GitHub connection; follow the prompt to sign in with a code on GitHub. If asked for a type, choose **Dashboards**.
3. Open **lux-power-distribution-card** under **Custom repositories** and select **Install**.
4. Reload your browser. No restart is needed; the dashboard resource is added for you.

Updates appear in the Marketplace and as an update entity. Reload your browser after updating.

### Home Assistant 2026.10 and earlier (HACS)

1. Open **HACS**, select the **three dots** menu (top right) and choose **Custom repositories**.
2. Add `https://github.com/DoubleDoc/lux-power-distribution-card` with type **Dashboard**.
3. Search for **lux-power-distribution-card**, open it and select **Download**.
4. Reload your browser. No restart is needed; HACS adds the dashboard resource.

Updates appear in HACS and as an update entity; reload your browser after updating.

If you manage dashboard resources in YAML (a `resources:` list under `lovelace:` in `configuration.yaml`), neither store adds the resource for you; add it as in the manual steps, with the URL the install dialog shows.

### Manual

1. Download `lux-power-distribution-card.js` from the [latest release](https://github.com/DoubleDoc/lux-power-distribution-card/releases) and copy it into your Home Assistant `config/www/` folder (for example `config/www/lux-power-distribution-card/`).
2. Go to **Settings → Dashboards**, open the **three dots** menu (top right) and choose **Resources**. Add `/local/lux-power-distribution-card/lux-power-distribution-card.js` as a **JavaScript module**.
3. Reload your browser.

After replacing the file, change the resource URL (for example add `?v=2`) so browsers load the new version.

## Adding the card to the dashboard

Currently, the UI editor does not work. The only way to add the card is to add the `yaml` code. There are examples in [config](/docs/config/config.md) document.

## Sensor sources

The card doesn't need any particular integration. Every value is an entity you choose, so sensors from any integration, or your own template sensors, can be linked. Two common sources:

- **LuxpowerTek integration:** hosted in a private repository by [Guy Wells](https://github.com/guybw). The [example configs](/docs/config/config.md#example-configs) are written for it, and the refresh button's `lux_dongles` option calls its refresh service.
- **[EG4 Web Monitor](https://github.com/joyfulhouse/eg4_web_monitor):** for EG4 inverters (Luxpower OEM hardware). It reads the inverters over local Modbus and/or EG4's cloud and polls on its own, so a refresh button is optional. If you want one, point `refresh.button_entities` at the integration's refresh buttons (see [Refresh](#refresh-and-the-dongle-serial-number)).

### Example with EG4 Web Monitor

This is the config used on a parallel group of two EG4 18kPV inverters, with the master's serial replaced by `1234567890`. Entity names depend on your model, serials and parallel group, so check yours under **Settings → Devices & services**.

```yaml
type: custom:lux-power-distribution-card
inverter_count: 1
battery:
  soc_entities:
    - sensor.18kpv_1234567890_state_of_charge
  flow_entities:
    - sensor.parallel_group_a_battery_power
  voltage_entities:
    - sensor.parallel_group_a_battery_voltage
  capacity_ah_entities:
    - sensor.parallel_group_a_battery_max_capacity
  runtime_location: left
  depth_of_discharge: number.18kpv_1234567890_off_grid_soc_cut_off
  charge_target: number.18kpv_1234567890_system_charge_soc_limit
grid:
  flow_entities:
    - sensor.parallel_group_a_grid_power
  voltage_entities:
    - sensor.18kpv_1234567890_grid_voltage
  invert_flow: true
  indicators:
    hue: true
    dot: true
consumption:
  home_entities:
    - sensor.parallel_group_a_consumption_power
  backup_entities:
    - sensor.parallel_group_a_eps_power
pv:
  combined_entities:
    - sensor.parallel_group_a_pv_total_power
temp:
  entities:
    - sensor.18kpv_1234567890_internal_temperature
status_codes:
  entities:
    - sensor.18kpv_1234567890_status_code
  show_operating_mode: true
update_time:
  entities:
    - sensor.eg4_last_update_display
  show_time_since: true
  show_datetime: true
  has_timestamp_attribute: true
refresh:
  button_entities:
    - button.parallel_group_a_refresh_data
  button_location: right
feed_spacing: true
```

With `inverter_count: 1` covering the whole parallel group, the group's refresh button refreshes both inverters. With one card per inverter view (`inverter_count: 2`), list each inverter's `button.18kpv_<serial>_refresh_data` in order and set `parallel_button_entity: button.parallel_group_a_refresh_data`.

### Last-update time from other integrations

`update_time` prints its entity's state as-is, and `show_time_since` reads a `timestamp` attribute holding Unix epoch seconds. A plain timestamp sensor (such as EG4 Web Monitor's `Last Polled`) therefore shows a raw UTC string and a huge "Updated … ago". A template sensor in `configuration.yaml` gives the card what it expects:

```yaml
template:
  - sensor:
      - name: EG4 Last Update Display
        unique_id: eg4_last_update_display
        default_entity_id: sensor.eg4_last_update_display
        icon: mdi:clock-check
        availability: "{{ states('sensor.parallel_group_a_last_polled') | as_datetime(none) is not none }}"
        state: "{{ as_local(states('sensor.parallel_group_a_last_polled') | as_datetime).strftime('%b %-d, %-I:%M:%S %p') }}"
        attributes:
          timestamp: "{{ as_timestamp(states('sensor.parallel_group_a_last_polled'), 0) | int(0) }}"
```

Then use it with `has_timestamp_attribute: true`, as in the example above.

## Refresh and the Dongle serial number

The refresh button can work in two ways, and both can be set:

- **`lux_dongles`:** calls the LuxpowerTek integration's refresh service for each dongle serial. The service name and call format are hard-coded, so this only works with that integration.
- **`button_entities`:** presses button entities, one per inverter, for any integration that exposes a refresh button, such as EG4 Web Monitor. In the parallel view it presses all of them, or `parallel_button_entity` if set.

The location of the refresh button can be set with the *refresh_button_location* config value. There are 4 accepted values for this config:

- left (Displayed on the left hand side, below the battery text.)
- right (Displayed on the right hand side, above the grid image.)
- both (Displayed on both sides, as described on the above two points.)
- none (Removes the refresh button.)

## Allocated power entity

The *allocated_power_entity* is an entity for allocated power in your house. It is a helper group of summed entities, that allow you to see how much of your power is assigned to devices. The reason this is a single grouped item, is because then it works well with the history graph.

## Grid indicators

Below are 2 pictures of the grid image. The first is the grid in a normal state, and the second is the grid image with both indicators active.

| Normal Grid | No Grid Input |
|---|---|
| <img src="https://raw.githubusercontent.com/DanteWinters/lux-power-distribution-card/main/docs/images/grid-normal.png" /> | <img src="https://raw.githubusercontent.com/DanteWinters/lux-power-distribution-card/main/docs/images/grid-no-ac.png" /> |

## Gallery

| The card with only required entities | The card with all required and optional entities | The card using all the LuxPower integration options and entities |
|---|---|---|
| <img src="https://raw.githubusercontent.com/DanteWinters/lux-power-distribution-card/main/docs/images/base-card.png" /> | <img src="https://raw.githubusercontent.com/DanteWinters/lux-power-distribution-card/main/docs/images/base-card-with-extras.png" /> | <img src="https://raw.githubusercontent.com/DanteWinters/lux-power-distribution-card/main/docs/images/full-card.png" /> |

## Interactive Card

Most of the images can be clicked to show the history of the entity. There are special configs for parallel inverters.

## FAQ's

The FAQ's can be found [here](/docs/FAQ.md).
