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
  runtime_location?: string;
  depth_of_discharge?: number | string | string[];
  parallel_flow_entity?: string;
  parallel_soc_entity?: string;
  show_parallel_soc_entity?: string;
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
//                            (generator replaces the grid, the original behaviour)
export type GeneratorConfig = Partial<BatteryGeneratorConfig> & {
  architecture: 'battery' | 'grid';
  power_entities?: string[]; // grid: one per inverter (or use power_entity with one inverter)
  voltage_entities?: string[]; // grid: one per inverter (or use voltage_entity with one inverter)
};

export type ParallelConfig = {
  parallel_first?: boolean;
  aliases?: string[];
};

export type RefreshConfig = {
  lux_dongles?: string[];
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
  parallel_average_voltage?: boolean;
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
};

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
  if (config.battery_generator || config.grid?.generator_power_entities || config.grid?.generator_voltage_entities)
    throw new Error(`Use either 'generator' or the older 'battery_generator' / 'grid.generator_*' options, not both.`);
  const { architecture, power_entities, voltage_entities, ...rest } = gen;
  if (architecture === 'battery') {
    if (!rest.power_entity) throw new Error(`'power_entity' is required within 'generator'.`);
    return { ...config, battery_generator: rest as BatteryGeneratorConfig };
  }
  if (architecture === 'grid') {
    const powers = power_entities ?? (rest.power_entity ? [rest.power_entity] : undefined);
    if (!powers) throw new Error(`'power_entities' (or 'power_entity') is required within 'generator'.`);
    validateEntityCount(powers, 'generator.power_entities', config.inverter_count);
    const volts = voltage_entities ?? (rest.voltage_entity ? [rest.voltage_entity] : undefined);
    if (volts) validateEntityCount(volts, 'generator.voltage_entities', config.inverter_count);
    return {
      ...config,
      grid: {
        ...config.grid,
        generator_power_entities: powers,
        ...(volts ? { generator_voltage_entities: volts } : {}),
      },
    };
  }
  throw new Error(`'generator.architecture' must be 'battery' or 'grid'.`);
}

function validateEntityCount(object_list: string[], object_name: string, inv_count: number) {
  if (object_list.length != inv_count) throw new Error(`'${object_name}' list must be equal to the 'inverter_count'.`);
}

export function validateConfig(config: LuxCardConfig) {
  // Inverter count
  if (config.inverter_count < 1) throw new Error(`'inverter_count' must be positive value.`);

  // Battery
  if (!config.battery) throw new Error(`'battery' is a required object.`);

  // Battery SOC
  if (!config.battery.soc_entities) throw new Error(`'battery_soc' is a required list within 'battery'.`);
  validateEntityCount(config.battery.soc_entities, 'battery.soc_entities', config.inverter_count);

  // Battery Flow
  if (
    !(config.battery.flow_entities || (config.battery.charge_live_entities && config.battery.discharge_live_entities))
  )
    throw new Error(`Battery flow is required. Instruction in the README explains battery flow.`);
  if (config.battery.flow_entities)
    validateEntityCount(config.battery.flow_entities, 'battery.flow_entities', config.inverter_count);
  if (config.battery.charge_live_entities)
    validateEntityCount(config.battery.charge_live_entities, 'battery.charge_live_entities', config.inverter_count);
  if (config.battery.discharge_live_entities)
    validateEntityCount(
      config.battery.discharge_live_entities,
      'battery.discharge_live_entities',
      config.inverter_count
    );

  // Consumption
  if (!config.consumption) throw new Error(`'consumption' is a required object.`);
  if (!config.consumption.home_entities) throw new Error(`'home_entities' is a required list within 'consumption'.`);
  validateEntityCount(config.consumption.home_entities, 'consumption.home_entities', config.inverter_count);

  // Grid
  if (!config.grid) throw new Error(`'grid' is a required object.`);
  if (!config.grid.flow_entities) throw new Error(`'flow_entities' is a required list within 'grid'.`);
  validateEntityCount(config.grid.flow_entities, 'grid.flow_entities', config.inverter_count);

  // Battery generator
  if (config.battery_generator && !config.battery_generator.power_entity)
    throw new Error(`'power_entity' is required within 'battery_generator'.`);
}
