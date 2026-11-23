import { CARD_NAME } from './const';
import { HomeAssistant, LovelaceCardConfig } from './lib/types';

export type BatteryConfig = {
  soc_entities: string[];
  combined_soc_entity?: string;
  flow_entities?: string[];
  invert_flow?: boolean;
  discharge_live_entities?: string[];
  combined_discharge_live_entity?: string;
  charge_live_entities?: string[];
  combined_charge_live_entity?: string;
  capacity_ah_entities?: string[];
  voltage_entities?: string[];
  parallel_average_voltage?: boolean;
  voltage_decimal?: boolean; // show the voltage with 1 decimal
  runtime_location?: string;
  depth_of_discharge?: number | string | string[];
  charge_target_soc?: number;
  parallel_flow_entity?: string;
  parallel_soc_entity?: string;
  show_parallel_soc_entity?: boolean | string;
  // One battery bank shared by all inverters: its SOC, voltage and capacity are read from
  // the inverter at shared_index (default 0), and the runtime uses the combined flow.
  shared?: boolean;
  shared_index?: number;
};

// A generator that charges the batteries directly on the DC bus (through its own
// chargers and the BMSs), not through the inverter. Unlike grid.generator_*,
// it's drawn beside the battery and the grid stays visible.
export type BatteryGeneratorConfig = {
  power_entity: string; // W into the batteries
  voltage_entity?: string; // Vac
  frequency_entity?: string; // Hz
  thd_entity?: string; // %
  running_entity?: string; // on/off; while on, always shown with all configured readings (zeros too)
  active_threshold?: number; // W; otherwise shown while power > this (default 0), zero readings hidden
  add_to_battery_flow?: boolean; // add generator power to the battery flow (default true)
};

// One block for either generator wiring. Normalised in normalizeConfig() into the
// older options, which keep working on their own:
//   architecture: battery -> battery_generator (DC-coupled, drawn above the battery)
//   architecture: grid    -> grid.generator_power_entities / generator_voltage_entities
//                            (+ generator_frequency_entity / generator_thd_entity)
//                            (generator replaces the grid, the original behaviour)
// One generator: in grid mode each inverter reports the power (and voltage) it takes from it,
// while frequency and THD are the generator's own, so they're single entities.
export type GeneratorConfig = Partial<BatteryGeneratorConfig> & {
  architecture: 'battery' | 'grid';
  power_entities?: string[]; // grid: one per inverter (or use power_entity with one inverter)
  voltage_entities?: string[]; // grid: one per inverter (or use voltage_entity with one inverter)
};

export type ParallelConfig = {
  parallel_first?: boolean;
  aliases?: string[];
};

export type RefreshAction = { action: string; [key: string]: any };

export type RefreshConfig = {
  lux_dongles?: string[];
  // Standard HA actions (perform-action, navigate, url, ...) run by the refresh button instead of
  // the LuxPower refresh service. `action` is for the Parallel view (and any inverter without its
  // own), `inverter_actions` has one per inverter. Configs with only lux_dongles work as before.
  action?: RefreshAction;
  inverter_actions?: RefreshAction[];
  button_location?: string;
};

export type GridHueConfig = {
  hue?: boolean;
  dot?: boolean;
};

export type GridConfig = {
  flow_entities: string[];
  parallel_flow_entity?: string;
  invert_flow?: boolean;
  voltage_entities?: string[];
  indicators?: GridHueConfig;
  generator_power_entities?: string[];
  generator_voltage_entities?: string[];
  generator_frequency_entity?: string; // fork: the generator's frequency (Hz), shown while it replaces the grid
  generator_thd_entity?: string; // fork: the generator's voltage THD (%), shown while it replaces the grid
  parallel_average_voltage?: boolean;
  voltage_decimal?: boolean; // show grid and generator voltage with 1 decimal
};

export type ConsumptionConfig = {
  home_entities: string[];
  combined_consumption_entity?: string;
  backup_entities?: string[];
  allocated_power_entity?: string;
};

export type PvConfig = {
  combined_entities?: string[];
  combined_parallel_entity?: string;
  array_1_entities?: string[];
  array_2_entities?: string[];
  array_3_entities?: string[];
};

export type UpdateTimeConfig = {
  entities?: string[];
  show_datetime?: boolean;
  show_time_since?: boolean;
  has_timestamp_attribute?: boolean;
};

export type StatusCodesConfig = {
  entities?: string[];
  overwrite_as_normal?: number[];
  overwrite_as_warning?: number[];
  overwrite_as_error?: number[];
  // Fork options. Names entered here win over every built-in name and over description_entities.
  code_names?: CodeNames; // status code -> name
  description_entities?: string[]; // one per inverter: its state (as HA shows it) names the status
  fault_entities?: string[]; // one per inverter: fault code bitmask; set bit n shows as E0nn
  warning_entities?: string[]; // one per inverter: warning code bitmask; set bit n shows as W0nn
  fault_names?: CodeNames; // fault bit -> name
  warning_names?: CodeNames; // warning bit -> name
  fault_text_entities?: string[]; // one per inverter: text of the active faults (e.g. "No Faults" when clear)
  warning_text_entities?: string[]; // one per inverter: text of the active warnings
};

// Code -> name. YAML gives number keys; JSON (stored dashboards) gives strings, so both are read.
export type CodeNames = Record<string, string>;

export type TempConfig = {
  entities?: string[];
};

export type LuxCardConfig = LovelaceCardConfig & {
  inverter_count: number;
  battery: BatteryConfig;
  parallel?: ParallelConfig;
  refresh?: RefreshConfig;
  grid: GridConfig;
  consumption: ConsumptionConfig;
  pv?: PvConfig;
  battery_generator?: BatteryGeneratorConfig;
  generator?: GeneratorConfig;
  feed_spacing?: boolean; // leave a gap between the PV/home feeds and their icons (default false)
  temp?: TempConfig;
  update_time?: UpdateTimeConfig;
  status_codes?: StatusCodesConfig;
  title?: string;
};

export function normalizeConfig(config: LuxCardConfig): LuxCardConfig {
  const gen = config.generator;
  if (!gen) return config;
  if (
    config.battery_generator ||
    config.grid?.generator_power_entities ||
    config.grid?.generator_voltage_entities ||
    config.grid?.generator_frequency_entity ||
    config.grid?.generator_thd_entity
  )
    throw new Error(`Use either 'generator' or the older 'battery_generator' / 'grid.generator_*' options, not both.`);
  const { architecture, power_entities, voltage_entities, ...rest } = gen;
  if (architecture === 'battery') {
    if (!rest.power_entity) throw incomplete('generator.power_entity', 1, 1);
    return { ...config, battery_generator: rest as BatteryGeneratorConfig };
  }
  if (architecture === 'grid') {
    const powers = power_entities ?? (rest.power_entity ? [rest.power_entity] : undefined);
    if (!powers) throw incomplete('generator.power_entities', 1, config.inverter_count);
    validateEntityCount(powers, 'generator.power_entities', config.inverter_count);
    const volts = voltage_entities ?? (rest.voltage_entity ? [rest.voltage_entity] : undefined);
    if (volts) validateEntityCount(volts, 'generator.voltage_entities', config.inverter_count);
    return {
      ...config,
      grid: {
        ...config.grid,
        generator_power_entities: powers,
        ...(volts ? { generator_voltage_entities: volts } : {}),
        ...(rest.frequency_entity ? { generator_frequency_entity: rest.frequency_entity } : {}),
        ...(rest.thd_entity ? { generator_thd_entity: rest.thd_entity } : {}),
      },
    };
  }
  throw new Error(`'generator.architecture' must be 'battery' or 'grid'.`);
}

/**
 * A required entity hasn't been chosen yet, e.g. while setting the card up in the UI editor.
 * The card shows this as a "finish the setup" hint instead of a configuration error.
 */
export class IncompleteConfigError extends Error {
  // Checked by name: the build's Babel step can break `instanceof` for subclasses of Error.
  name = 'IncompleteConfigError';
}

export const isIncomplete = (err: unknown): boolean => (err as Error)?.name === 'IncompleteConfigError';

const ENTITY_NAMES: Record<string, string> = {
  'battery.soc_entities': 'battery SOC',
  'battery.flow_entities': 'battery flow',
  'battery.charge_live_entities': 'battery charge',
  'battery.discharge_live_entities': 'battery discharge',
  'consumption.home_entities': 'home consumption',
  'grid.flow_entities': 'grid flow',
  'generator.power_entity': 'generator power',
  'generator.power_entities': 'generator power',
};

function incomplete(object_name: string, inverter: number, inv_count: number): IncompleteConfigError {
  const which = inv_count > 1 ? ` for inverter ${inverter}` : '';
  return new IncompleteConfigError(
    `Choose the ${ENTITY_NAMES[object_name] ?? object_name} entity${which} ('${object_name}').`,
  );
}

function validateEntityCount(object_list: string[], object_name: string, inv_count: number) {
  // Too few entries or a blank one: not chosen yet. An empty entry would crash rendering otherwise.
  const missing = Array.from({ length: inv_count }, (_, i) => object_list[i]).findIndex((entity) => !entity);
  if (missing != -1) throw incomplete(object_name, missing + 1, inv_count);
  if (object_list.length != inv_count) throw new Error(`'${object_name}' list must be equal to the 'inverter_count'.`);
}

export function validateConfig(config: LuxCardConfig) {
  // Inverter count
  if (!Number.isInteger(config.inverter_count) || config.inverter_count < 1)
    throw new Error(`'inverter_count' must be a whole number of 1 or more.`);

  // Battery
  if (!config.battery) throw new Error(`'battery' is a required object.`);

  // Battery SOC
  if (!config.battery.soc_entities) throw incomplete('battery.soc_entities', 1, config.inverter_count);
  validateEntityCount(config.battery.soc_entities, 'battery.soc_entities', config.inverter_count);

  // Battery Flow
  if (!(
    config.battery.flow_entities ||
    (config.battery.charge_live_entities && config.battery.discharge_live_entities)
  ))
    throw incomplete('battery.flow_entities', 1, config.inverter_count);
  if (config.battery.flow_entities)
    validateEntityCount(config.battery.flow_entities, 'battery.flow_entities', config.inverter_count);
  if (config.battery.charge_live_entities)
    validateEntityCount(config.battery.charge_live_entities, 'battery.charge_live_entities', config.inverter_count);
  if (config.battery.discharge_live_entities)
    validateEntityCount(
      config.battery.discharge_live_entities,
      'battery.discharge_live_entities',
      config.inverter_count,
    );

  // Charge target. Up to 150, since some inverters use e.g. 101% for top balancing; the charge
  // time is then calculated up to that value.
  if (config.battery.charge_target_soc !== undefined) {
    const target = config.battery.charge_target_soc;
    if (typeof target !== 'number' || target <= 0 || target > 150)
      throw new Error(`'battery.charge_target_soc' must be a number from 1 to 150.`);
  }

  // Refresh actions
  const isAction = (value: unknown) => typeof (value as RefreshAction)?.action === 'string';
  if (config.refresh?.action !== undefined && !isAction(config.refresh.action))
    throw new Error(`'refresh.action' must be an action, e.g. 'action: perform-action'.`);
  if (config.refresh?.inverter_actions !== undefined) {
    const list = config.refresh.inverter_actions;
    if (!Array.isArray(list) || list.length != config.inverter_count)
      throw new Error(`'refresh.inverter_actions' list must be equal to the 'inverter_count'.`);
    const bad = list.findIndex((item) => !isAction(item));
    if (bad != -1)
      throw new Error(
        `'refresh.inverter_actions' entry ${bad + 1} must be an action (use 'action: none' to skip one).`,
      );
  }

  // Shared battery
  if (config.battery.shared_index !== undefined) {
    const index = config.battery.shared_index;
    if (!Number.isInteger(index) || index < 0 || index >= config.inverter_count)
      throw new Error(`'battery.shared_index' must be a whole number from 0 to ${config.inverter_count - 1}.`);
  }

  // Consumption
  if (!config.consumption) throw new Error(`'consumption' is a required object.`);
  if (!config.consumption.home_entities) throw incomplete('consumption.home_entities', 1, config.inverter_count);
  validateEntityCount(config.consumption.home_entities, 'consumption.home_entities', config.inverter_count);

  // Grid
  if (!config.grid) throw new Error(`'grid' is a required object.`);
  if (!config.grid.flow_entities) throw incomplete('grid.flow_entities', 1, config.inverter_count);
  validateEntityCount(config.grid.flow_entities, 'grid.flow_entities', config.inverter_count);

  // Battery generator
  if (config.battery_generator && !config.battery_generator.power_entity)
    throw new Error(`'power_entity' is required within 'battery_generator'.`);
}

//////////////////////////////
// Warnings
//////////////////////////////

// Options the card reads, per section. Anything else is a typo or an old option and gets a warning.
const KNOWN_OPTIONS: Record<string, string[]> = {
  '': [
    'type',
    'title',
    'inverter_count',
    'battery',
    'parallel',
    'refresh',
    'grid',
    'consumption',
    'pv',
    'temp',
    'update_time',
    'status_codes',
    // Fork options
    'generator',
    'battery_generator',
    'feed_spacing',
    // Options Home Assistant (or popular add-ons) put on every card.
    'view_layout',
    'layout_options',
    'grid_options',
    'visibility',
    'card_mod',
    'index',
    'view_index',
  ],
  battery: [
    'soc_entities',
    'flow_entities',
    'invert_flow',
    'charge_live_entities',
    'discharge_live_entities',
    'capacity_ah_entities',
    'voltage_entities',
    'parallel_average_voltage',
    'voltage_decimal',
    'runtime_location',
    'depth_of_discharge',
    'charge_target_soc',
    'parallel_flow_entity',
    'parallel_soc_entity',
    'show_parallel_soc_entity',
    'shared',
    'shared_index',
  ],
  parallel: ['parallel_first', 'aliases'],
  refresh: ['lux_dongles', 'action', 'inverter_actions', 'button_location'],
  grid: [
    'flow_entities',
    'parallel_flow_entity',
    'invert_flow',
    'voltage_entities',
    'indicators',
    'generator_power_entities',
    'generator_voltage_entities',
    'generator_frequency_entity',
    'generator_thd_entity',
    'parallel_average_voltage',
    'voltage_decimal',
  ],
  'grid.indicators': ['hue', 'dot'],
  consumption: ['home_entities', 'combined_consumption_entity', 'backup_entities', 'allocated_power_entity'],
  pv: ['combined_entities', 'combined_parallel_entity', 'array_1_entities', 'array_2_entities', 'array_3_entities'],
  temp: ['entities'],
  update_time: ['entities', 'show_datetime', 'show_time_since', 'has_timestamp_attribute'],
  status_codes: [
    'entities',
    'overwrite_as_normal',
    'overwrite_as_warning',
    'overwrite_as_error',
    // Fork options
    'code_names',
    'description_entities',
    'fault_entities',
    'warning_entities',
    'fault_names',
    'warning_names',
    'fault_text_entities',
    'warning_text_entities',
  ],
  // Fork options
  generator: [
    'architecture',
    'power_entity',
    'power_entities',
    'voltage_entity',
    'voltage_entities',
    'frequency_entity',
    'thd_entity',
    'running_entity',
    'active_threshold',
    'add_to_battery_flow',
  ],
  battery_generator: [
    'power_entity',
    'voltage_entity',
    'frequency_entity',
    'thd_entity',
    'running_entity',
    'active_threshold',
    'add_to_battery_flow',
  ],
};

// Options that were documented but never read by the card, and what to use instead.
const REPLACED_OPTIONS: Record<string, string> = {
  'battery.combined_soc_entity': "'battery.parallel_soc_entity'",
  'battery.combined_flow_entity': "'battery.parallel_flow_entity'",
  'battery.combined_charge_live_entity': "'battery.parallel_flow_entity' (used for the parallel history graph)",
  'battery.combined_discharge_live_entity': "'battery.parallel_flow_entity' (used for the parallel history graph)",
  'consumption.allocated_power_entities': "'consumption.allocated_power_entity' with a Sum helper (see the README)",
};

// Optional lists with one entry per inverter; required lists are checked by validateConfig.
const PER_INVERTER_LISTS = [
  'battery.capacity_ah_entities',
  'battery.voltage_entities',
  'grid.voltage_entities',
  'grid.generator_power_entities',
  'grid.generator_voltage_entities',
  'consumption.backup_entities',
  'pv.combined_entities',
  'pv.array_1_entities',
  'pv.array_2_entities',
  'pv.array_3_entities',
  'temp.entities',
  'update_time.entities',
  'status_codes.entities',
  'status_codes.description_entities',
  'parallel.aliases',
  'refresh.lux_dongles',
];

function valueAt(config: LuxCardConfig, path: string): unknown {
  return path.split('.').reduce<any>((value, key) => (value == null ? undefined : value[key]), config);
}

/**
 * Problems that don't stop the card from showing, but make it show something wrong or ignore an option.
 * They never reject a config, so cards that worked before keep working.
 */
export function collectWarnings(config: LuxCardConfig): string[] {
  const warnings: string[] = [];
  const count = config.inverter_count;

  // Unknown and replaced options.
  for (const [section, known] of Object.entries(KNOWN_OPTIONS)) {
    const value = section ? valueAt(config, section) : config;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const key of Object.keys(value)) {
      if (known.includes(key)) continue;
      const path = section ? `${section}.${key}` : key;
      const replacement = REPLACED_OPTIONS[path];
      warnings.push(
        replacement
          ? `'${path}' isn't used by the card; use ${replacement} instead.`
          : `'${path}' isn't an option of this card and is ignored (typo?).`,
      );
    }
  }

  // Per-inverter lists with the wrong number of entries.
  for (const path of PER_INVERTER_LISTS) {
    const list = valueAt(config, path);
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      warnings.push(`'${path}' should be a list with one entry per inverter.`);
      continue;
    }
    const blank = Array.from({ length: count }, (_, i) => list[i]).findIndex(
      (entry) => entry === undefined || entry === '',
    );
    if (blank != -1) {
      warnings.push(`'${path}' has no entry for inverter ${blank + 1}, so it shows 0 or nothing there.`);
    } else if (list.length > count) {
      warnings.push(`'${path}' has ${list.length} entries for ${count} inverter(s); the extra ones are ignored.`);
    }
  }

  // Values the card doesn't understand.
  const oneOf = (path: string, allowed: string[]) => {
    const value = valueAt(config, path);
    if (value !== undefined && !allowed.includes(value as string))
      warnings.push(`'${path}' should be one of ${allowed.join(', ')}; '${value}' is ignored.`);
  };
  oneOf('battery.runtime_location', ['left', 'bottom', 'both']);
  oneOf('refresh.button_location', ['left', 'right', 'both', 'none']);
  // A refresh button that has nothing to do.
  const refresh = config.refresh;
  const hasAction = (action?: RefreshAction) => !!action && action.action !== 'none';
  if (
    refresh?.button_location &&
    refresh.button_location !== 'none' &&
    !refresh.lux_dongles?.length &&
    !hasAction(refresh.action) &&
    !(refresh.inverter_actions ?? []).some(hasAction)
  )
    warnings.push(`The refresh button has nothing to do: add 'refresh.lux_dongles' (LuxPower) or a 'refresh.action'.`);

  // Fork: depth_of_discharge may also be an entity id or a list of them (one per inverter).
  const dod = config.battery?.depth_of_discharge;
  const isEntityId = (value: unknown) => typeof value === 'string' && value.includes('.');
  const dodOk =
    dod === undefined ||
    (typeof dod === 'number' && dod >= 0 && dod < 100) ||
    isEntityId(dod) ||
    (Array.isArray(dod) && dod.every(isEntityId));
  if (!dodOk)
    warnings.push(
      `'battery.depth_of_discharge' should be a number from 0 to 99, an entity, or a list of entities (one per inverter).`,
    );
  for (const key of ['overwrite_as_normal', 'overwrite_as_warning', 'overwrite_as_error'] as const) {
    const codes = config.status_codes?.[key];
    if (codes !== undefined && !(Array.isArray(codes) && codes.every((code) => typeof code === 'number')))
      warnings.push(`'status_codes.${key}' should be a list of numbers (status codes).`);
  }
  // Fork: code -> name maps. Keys must be whole numbers (YAML numbers or stored strings).
  for (const key of ['code_names', 'fault_names', 'warning_names'] as const) {
    const names = config.status_codes?.[key];
    if (names === undefined) continue;
    if (!names || typeof names !== 'object' || Array.isArray(names)) {
      warnings.push(`'status_codes.${key}' should be a list of 'code: name' entries.`);
      continue;
    }
    const bad = Object.keys(names).filter((code) => !/^\d+$/.test(code.trim()));
    if (bad.length)
      warnings.push(`'status_codes.${key}' entries need a whole-number code; ignored: ${bad.join(', ')}.`);
  }
  return warnings;
}
