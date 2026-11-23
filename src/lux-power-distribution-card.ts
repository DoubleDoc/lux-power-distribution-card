import { LitElement, html, nothing, PropertyValues, TemplateResult } from 'lit';
import { property, customElement, state } from 'lit/decorators.js';

import { HomeAssistant, LovelaceCard, LovelaceCardEditor } from './lib/types';

import {
  CodeNames,
  collectWarnings,
  isIncomplete,
  LuxCardConfig,
  normalizeConfig,
  RefreshAction,
  validateConfig,
} from './config';
import {
  CARD_NAME,
  EDITOR_NAME,
  getBase64Data,
  base64Images,
  getBatteryImage,
  ARROW_NONE,
  ARROW_LEFT,
  ARROW_RIGHT,
  ARROW_DOWN,
  getStatusMessage,
  CLEAR_TEXTS,
  statusLevels,
  StatusMessageType,
  CARD_FULL_NAME,
} from './const';
import { afterNextRender } from './lib/render-status';

// Shown in the dashboard's card picker ("Add card"), where the card has no entities yet.
const EXAMPLE_CONFIG: LuxCardConfig = {
  type: `custom:${CARD_NAME}`,
  inverter_count: 1,
  battery: {
    soc_entities: ['sensor.example_battery'],
    flow_entities: ['sensor.example_battery_flow'],
    voltage_entities: ['sensor.example_battery_voltage'],
    capacity_ah_entities: ['sensor.example_battery_capacity'],
    runtime_location: 'bottom',
  },
  grid: { flow_entities: ['sensor.example_grid_flow'], voltage_entities: ['sensor.example_grid_voltage'] },
  consumption: { home_entities: ['sensor.example_home'] },
  pv: { combined_entities: ['sensor.example_solar'] },
  temp: { entities: ['sensor.example_temperature'] },
  status_codes: { entities: ['sensor.example_status'] },
};
const example = (state: string, unit = '') => ({ state, attributes: unit ? { unit_of_measurement: unit } : {} });
const EXAMPLE_STATES: Record<string, { state: string; attributes: Record<string, any> }> = {
  'sensor.example_battery': example('72', '%'),
  'sensor.example_battery_flow': example('900', 'W'),
  'sensor.example_battery_voltage': example('52.8', 'V'),
  'sensor.example_battery_capacity': example('100', 'Ah'),
  'sensor.example_grid_flow': example('150', 'W'),
  'sensor.example_grid_voltage': example('231', 'V'),
  'sensor.example_home': example('1650', 'W'),
  'sensor.example_solar': example('2400', 'W'),
  'sensor.example_temperature': example('38', '°C'),
  'sensor.example_status': example('4'),
};

// Power entities reported in a larger unit are converted to W.
const POWER_UNITS_TO_W: Record<string, number> = { kW: 1000, MW: 1_000_000, GW: 1_000_000_000 };
// Imported statically so the editor is bundled into the single file HACS installs.
import './editor';
import { mdiTheater } from '@mdi/js';

@customElement(CARD_NAME)
class LuxPowerDistributionCard extends LitElement implements LovelaceCard {
  constructor() {
    super();
  }

  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() public _config?: LuxCardConfig;
  @state() private _updated = false;
  @state() private _index = 0;

  private _interval?: number;

  public getCardSize(): number {
    return 4;
  }

  connectedCallback() {
    super.connectedCallback();
    if (this._inCardPicker()) this.requestUpdate();
    this._updateState();
    // Only "updated ... ago" changes without an entity changing, so only it needs a timer.
    this._interval = setInterval(() => {
      if (this._config?.update_time?.show_time_since) this._updateState();
    }, 1000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._interval) clearInterval(this._interval);
  }

  public static getConfigElement(): LovelaceCardEditor {
    return document.createElement(EDITOR_NAME) as LovelaceCardEditor;
  }

  public static async getStubConfig(): Promise<LuxCardConfig> {
    return {
      type: `custom:${CARD_NAME}`,
      inverter_count: 1,
      battery: {
        soc_entities: [],
      },
      grid: {
        flow_entities: [],
      },
      consumption: {
        home_entities: [],
      },
    };
  }

  // Set while required entities haven't been chosen yet; shown instead of the diagram.
  @state() private _incomplete?: string;
  // Config problems that don't stop the card (see collectWarnings), shown above the diagram.
  @state() private _configWarnings: string[] = [];

  // Every entity in the config: the card only re-draws when one of these changes.
  private _entityIds: string[] = [];

  protected shouldUpdate(changed: PropertyValues): boolean {
    if (changed.size === 1 && changed.has('hass')) {
      const old = changed.get('hass') as HomeAssistant | undefined;
      if (old && this.hass) return this._entityIds.some((entity) => old.states[entity] !== this.hass!.states[entity]);
    }
    return true;
  }

  setConfig(config: LuxCardConfig): void {
    this._incomplete = undefined;
    this._configWarnings = collectWarnings(config);
    // The fork's `generator` block is mapped onto battery_generator / grid.generator_* first.
    let normalized = config;
    try {
      normalized = normalizeConfig(config);
      validateConfig(normalized);
    } catch (err) {
      // Not chosen yet (e.g. mid-setup in the UI editor) is not an error; anything else is.
      if (!isIncomplete(err)) throw err;
      this._incomplete = (err as Error).message;
    }
    this._entityIds = this.getConfigEntities(normalized);
    this._config = normalized;
    this._updated = false;
  }

  protected willUpdate(_changedProperties: PropertyValues): void {
    super.willUpdate(_changedProperties);
    if (!this._config) return;
    this._updated = false;
    // In the card picker, show what the card looks like instead of "finish the setup".
    if (this._config !== EXAMPLE_CONFIG && this._inCardPicker()) {
      this._config = EXAMPLE_CONFIG;
      this._incomplete = undefined;
      this._configWarnings = [];
      this._entityIds = this.getConfigEntities(EXAMPLE_CONFIG);
    }
  }

  private _picker = false;

  // True inside "Add card" > "By card". HA's own `preview` flag is also set on dashboards in edit
  // mode and in the edit dialog, so look for the picker element instead.
  private _inCardPicker(): boolean {
    if (this._picker) return true;
    const up = (node: Node): Node | null =>
      node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentNode;
    for (let node = up(this), i = 0; node && i < 40; node = up(node), i++) {
      if ((node as Element).localName === 'hui-card-picker') return (this._picker = true);
    }
    return false;
  }

  // Entity states: the example's own while showing the example, otherwise Home Assistant's.
  private get _states(): Record<string, any> {
    return this._config === EXAMPLE_CONFIG ? EXAMPLE_STATES : (this.hass?.states ?? {});
  }

  private _update() {
    this.getIndex();
    this.requestUpdate();
  }

  protected firstUpdated(changedProperties: PropertyValues) {
    super.firstUpdated(changedProperties);
    afterNextRender(() => {
      this._updated = true;
    });
  }

  protected updated(changedProperties: PropertyValues): void {
    super.updated(changedProperties);
    this._bindHistoryClicks();
  }

  private _historyBound = new WeakSet<Element>();

  // Bound after every update, not just the first: the diagram replaces the "finish the setup"
  // hint, so its elements may not exist on the first render.
  private _bindHistoryClicks() {
    const history_graph = [
      '#solar-image',
      '#solar-info',
      '#battery-charge-info',
      '#temp-info',
      '#battery-image',
      '#battery-soc-info',
      '#home-info',
      '#home-image',
      '#grid-image',
      '#grid-info',
      '#power-allocation-image',
    ];
    history_graph.forEach((name) => {
      const element = this.renderRoot.querySelector(name);
      if (element && !this._historyBound.has(element)) {
        element.addEventListener('click', () => this._selectHistory(name));
        this._historyBound.add(element);
      }
    });
  }

  private _updateState() {
    this._update();
  }

  // Refresh one inverter: its own action, else the shared `action`, else its LuxPower dongle.
  // `allowShared` is false in Parallel, where the shared `action` has already been ruled out.
  _refreshInverter(index: number, allowShared: boolean) {
    const refresh = this._config?.refresh;
    const isSet = (action?: RefreshAction): action is RefreshAction => !!action && action.action !== 'none';
    const own = refresh?.inverter_actions?.[index];
    if (isSet(own)) this._runAction(own);
    else if (allowShared && isSet(refresh?.action)) this._runAction(refresh!.action);
    else if (refresh?.lux_dongles?.[index]) {
      (this.hass as any).callService('luxpower', 'luxpower_refresh_registers', { dongle: refresh.lux_dongles[index] });
    }
  }

  // Let the HA frontend run it, so every action type (and confirmation) works as on built-in cards.
  _runAction(action: RefreshAction) {
    this.dispatchEvent(
      new CustomEvent('hass-action', {
        bubbles: true,
        composed: true,
        detail: { config: { tap_action: action }, action: 'tap' },
      }),
    );
  }

  _handleRefresh() {
    const action = this._config?.refresh?.action;
    if (this._index != -1) {
      this._refreshInverter(this._index, true);
    } else if (action && action.action !== 'none') {
      this._runAction(action);
    } else {
      // Parallel without a shared action: refresh every inverter the way its own view would.
      for (let i = 0; i < (this._config?.inverter_count ?? 0); i++) this._refreshInverter(i, false);
    }
    this._update();
  }

  _selectHistory(source: string) {
    switch (source) {
      case '#solar-image':
      case '#solar-info':
        if (this._index == -1) {
          if (this._config?.pv?.combined_parallel_entity) {
            this._openHistory(this._config.pv.combined_parallel_entity);
          }
        } else {
          if (this._config?.pv?.combined_entities) {
            this._openHistory(this._config.pv.combined_entities[this._index]);
          } else if (
            this._config?.pv?.array_1_entities ||
            this._config?.pv?.array_2_entities ||
            this._config?.pv?.array_3_entities
          ) {
            let solar_array_list: string[] = [];
            if (this._config?.pv?.array_1_entities) {
              solar_array_list.push(this._config?.pv?.array_1_entities[this._index]);
            }
            if (this._config?.pv?.array_2_entities) {
              solar_array_list.push(this._config?.pv?.array_2_entities[this._index]);
            }
            if (this._config?.pv?.array_3_entities) {
              solar_array_list.push(this._config?.pv?.array_3_entities[this._index]);
            }
            this._openHistoryMulti(solar_array_list);
          }
        }
        break;
      case '#temp-info':
        if (this._config?.temp?.entities) {
          if (this._index == -1) {
            this._openHistoryMulti(this._config.temp.entities);
          } else {
            this._openHistory(this._config.temp.entities[this._index]);
          }
        }
        break;
      case '#home-info':
      case '#home-image':
        if (this._index == -1) {
          if (this._config?.consumption?.combined_consumption_entity) {
            this._openHistory(this._config.consumption.combined_consumption_entity);
          }
        } else {
          let consumption_list: string[] = [];
          if (this._config?.consumption.home_entities) {
            consumption_list.push(this._config.consumption.home_entities[this._index]);
          }
          if (this._config?.consumption.backup_entities) {
            consumption_list.push(this._config.consumption.backup_entities[this._index]);
          }
          this._openHistoryMulti(consumption_list);
        }
        break;
      case '#battery-charge-info':
        if (this._index == -1) {
          if (this._config?.battery.parallel_flow_entity) {
            this._openHistory(this._config.battery.parallel_flow_entity);
          }
        } else {
          if (this._config?.battery.flow_entities) {
            this._openHistory(this._config.battery.flow_entities[this._index]);
          } else if (this._config?.battery.charge_live_entities && this._config?.battery.discharge_live_entities) {
            this._openHistoryMulti([
              this._config.battery.charge_live_entities[this._index],
              this._config.battery.discharge_live_entities[this._index],
            ]);
          }
        }
        break;
      case '#battery-image':
        if (this._index == -1) {
          if (this._config?.battery.parallel_soc_entity) {
            this._openHistory(this._config.battery.parallel_soc_entity);
          }
        } else {
          if (this._config?.battery.soc_entities) {
            this._openHistory(this._config.battery.soc_entities[this._index]);
          }
        }
        break;
      case '#battery-soc-info':
        if (this._index != -1) {
          if (this._config?.battery.voltage_entities) {
            this._openHistory(this._config.battery.voltage_entities[this._index]);
          }
        }
        break;
      case '#grid-image':
        if (this._index == -1) {
          if (this._config?.grid.parallel_flow_entity) {
            this._openHistory(this._config.grid.parallel_flow_entity);
          }
        } else {
          let grid_list: string[] = [];
          if (this._config?.grid.flow_entities) {
            grid_list.push(this._config.grid.flow_entities[this._index]);
          }
          if (this._config?.grid.generator_power_entities) {
            grid_list.push(this._config.grid.generator_power_entities[this._index]);
          }
          this._openHistoryMulti(grid_list);
        }
        break;
      case '#grid-info':
        if (this._index != -1) {
          let grid_list: string[] = [];
          if (this._config?.grid.voltage_entities) {
            grid_list.push(this._config.grid.voltage_entities[this._index]);
          }
          if (this._config?.grid.generator_voltage_entities) {
            grid_list.push(this._config.grid.generator_voltage_entities[this._index]);
          }
          this._openHistoryMulti(grid_list);
        }
        break;
      case '#power-allocation-image':
        if (this._config?.consumption.allocated_power_entity) {
          this._openHistory(this._config.consumption.allocated_power_entity);
        }
        break;
      default:
        break;
    }
  }

  _openHistory(entityId: string) {
    const event = new CustomEvent('hass-more-info', {
      detail: { entityId },
      bubbles: true,
      composed: true,
    });

    this.dispatchEvent(event);
  }

  private _openHistoryMulti(entityIds: string[]) {
    let currentIndex = 0;

    const openNext = () => {
      if (currentIndex >= entityIds.length) return;

      const entityId = entityIds[currentIndex++];
      this._openHistory(entityId);

      const appRoot = document.querySelector('home-assistant');
      if (appRoot) {
        const listener = () => {
          appRoot.removeEventListener('dialog-closed', listener);
          openNext();
        };
        appRoot.addEventListener('dialog-closed', listener);
      }
    };

    openNext();
  }

  // Missing entities are caught in render(); these stay safe for unavailable or unknown states.
  getEntityState(entity: string): string {
    return this._states[entity]?.state ?? '';
  }

  // Rounded, not cut off (52.9 V is 53 V, as in HA), and power in kW/MW/GW converted to W.
  // Unknown or unavailable values read as 0; check isKnown() where 0 would be misleading.
  getEntityStateInt(entity: string) {
    const value = parseFloat(this.getEntityState(entity));
    if (isNaN(value)) return 0;
    return Math.round(value * (POWER_UNITS_TO_W[this.getEntityUnit(entity)] ?? 1));
  }

  // The entity exists and has a number as its state (not unavailable/unknown).
  isKnown(entity: string | undefined): boolean {
    return !!entity && !isNaN(parseFloat(this.getEntityState(entity)));
  }

  // A SoC setting (%): a number, an entity id ("number.x"), or a list of entity
  // ids, one per inverter (the parallel view uses the first). Returns the
  // fallback when the value or the entity's state isn't a number.
  getSocSetting(cfg: number | string | string[] | undefined, fallback: number): number {
    let value: number = NaN;
    if (typeof cfg === 'number') {
      value = cfg;
    } else if (typeof cfg === 'string') {
      value = isNaN(Number(cfg)) ? parseFloat(this.hass?.states[cfg]?.state ?? '') : Number(cfg);
    } else if (Array.isArray(cfg) && cfg.length > 0) {
      const entity = cfg[Math.min(Math.max(this._index, 0), cfg.length - 1)];
      value = parseFloat(this.hass?.states[entity]?.state ?? '');
    }
    return isNaN(value) ? fallback : value;
  }

  // depth_of_discharge: how far the battery discharges, for the runtime estimate. Default 20%.
  getDepthOfDischarge(): number {
    return this.getSocSetting(this._config?.battery.depth_of_discharge, 20);
  }

  // Numeric state of an optional entity, or null when it's missing or not numeric.
  getOptionalFloat(entity?: string): number | null {
    if (!entity) return null;
    const value = parseFloat(this.hass?.states[entity]?.state ?? '');
    return isNaN(value) ? null : value;
  }

  //////////////////////////////
  // Battery generator (charges the batteries directly, not through the inverter)
  //////////////////////////////

  // It belongs to the whole battery bank, so it's shown (and added to the battery
  // flow) in the parallel view or when there's a single inverter.
  getBatteryGenerator() {
    const gen = this._config?.battery_generator;
    if (!gen || !(this._index == -1 || this._config!.inverter_count == 1)) return null;
    const power = this.getOptionalFloat(gen.power_entity) ?? 0;
    // running_entity on: always shown, with every configured reading (zeros too).
    // Otherwise (off or not set): shown only while power > active_threshold, and
    // zero voltage/frequency are left out.
    const running = gen.running_entity ? this.hass?.states[gen.running_entity]?.state === 'on' : false;
    const active = running || power > (gen.active_threshold ?? 0);
    const reading = (entity?: string) => {
      const value = this.getOptionalFloat(entity);
      return running ? value : value || null;
    };
    return {
      active,
      power: Math.round(power),
      voltage: reading(gen.voltage_entity),
      frequency: reading(gen.frequency_entity),
      // THD is shown whenever the generator is (0% included) if it's configured
      thd: this.getOptionalFloat(gen.thd_entity),
      addToBattery: gen.add_to_battery_flow ?? true,
    };
  }

  getEntityParallelStateInt(entity_list: string[]) {
    let total = 0;
    if (this._config) {
      entity_list.forEach((entity) => {
        total += this.getEntityStateInt(entity);
      });
    }
    return total;
  }

  getEntityStateFloat(entity: string) {
    const value = parseFloat(this.getEntityState(entity));
    return isNaN(value) ? 0 : value;
  }

  // Decimals to show for an entity's value: its display precision in Home Assistant
  // when set, otherwise as many as its state has (at most 2).
  getDisplayDecimals(entity?: string): number {
    if (!entity) return 0;
    const precision = (this.hass as any)?.entities?.[entity]?.display_precision;
    if (typeof precision === 'number') return precision;
    const match = /\.(\d+)$/.exec(this.hass?.states[entity]?.state ?? '');
    return match ? Math.min(match[1].length, 2) : 0;
  }

  formatValue(value: number, entity?: string): string {
    return isNaN(value) ? '—' : value.toFixed(this.getDisplayDecimals(entity));
  }

  getEntityUnit(entity: string) {
    return this._states[entity]?.attributes?.unit_of_measurement ?? '';
  }

  getEntityAttribute(entity: string, attribute: string) {
    return this._states[entity]?.attributes?.[attribute] || '';
  }

  // Config warnings plus the ones that depend on the entities' current state.
  getWarnings(): string[] {
    const warnings = [...this._configWarnings];
    const missing = this.getMissingEntities();
    if (missing.length) warnings.push(`Entities not found: ${missing.join(', ')}`);
    if (this._config?.update_time?.has_timestamp_attribute) {
      const without = (this._config.update_time.entities ?? []).filter((entity) => {
        const state = this._states[entity];
        return state && state.attributes?.timestamp === undefined;
      });
      if (without.length)
        warnings.push(
          `'update_time.has_timestamp_attribute' is on, but these have no 'timestamp' attribute, so "updated" times are wrong: ${without.join(', ')}`,
        );
    }
    return warnings;
  }

  // Every entity ID in the config (keys ending in _entity or _entities).
  getConfigEntities(config: LuxCardConfig | undefined): string[] {
    const found: string[] = [];
    const walk = (value: unknown, key = '') => {
      if (Array.isArray(value)) value.forEach((item) => walk(item, key));
      else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => walk(v, k));
      // Fork: plain `entities` lists (status_codes, temp, update_time) are watched too, and
      // depth_of_discharge can be an entity (or one per inverter).
      else if (typeof value === 'string' && /(^|_)entit(y|ies)$|^depth_of_discharge$/.test(key) && value.includes('.'))
        found.push(value);
    };
    walk(config);
    return [...new Set(found)];
  }

  // Configured entities that HA doesn't know about.
  getMissingEntities(): string[] {
    return this._entityIds.filter((entity) => !this._states[entity]);
  }

  generateArrows(): TemplateResult[] {
    const arrowSrc = getBase64Data(base64Images.Arrow);
    return [1, 2, 3, 4].map((i) => html`<div class="arrow-${i}"><img src=${arrowSrc} /></div>`);
  }

  generateLongArrows(): TemplateResult[] {
    const arrowSrc = getBase64Data(base64Images.Arrow);
    return [1, 2, 3, 4, 5, 6, 7, 8].map((i) => html`<div class="arrow-long-${i}"><img src=${arrowSrc} /></div>`);
  }

  getIndex() {
    let index = 0;
    if (this._config) {
      if (this._config.inverter_count && this._config.inverter_count > 1) {
        const selector = this.renderRoot.querySelector('#inverter-selector') as HTMLSelectElement;
        if (selector) {
          const selector_value = selector.value;
          if (!isNaN(parseInt(selector_value))) {
            index = parseInt(selector_value);
            if (index == this._config.inverter_count) {
              index = -1;
            }
          } else {
            if (this._config.parallel?.parallel_first) {
              index = -1;
            } else {
              index = 0;
            }
          }
        } else {
          if (this._config.parallel?.parallel_first) {
            index = -1;
          } else {
            index = 0;
          }
        }
      }
    }
    this._index = index;
  }

  //////////////////////////////
  // Update time
  //////////////////////////////

  getTimeSince(timestamp: number) {
    if (!timestamp || isNaN(timestamp)) return 'at an unknown time';
    const diff = Date.now() / 1000 - timestamp;
    const plural = (value: number, unit: string) => `${value} ${unit}${value == 1 ? '' : 's'} ago`;
    if (diff <= 2) return 'just now';
    if (diff < 60) return plural(Math.round(diff), 'second');
    if (diff < 3600) return plural(Math.floor(diff / 60), 'minute');
    if (diff < 86400) return plural(Math.floor(diff / 3600), 'hour');
    return plural(Math.floor(diff / 86400), 'day');
  }

  // Name shown for an inverter: its alias, else its dongle serial, else "Inverter N".
  getInverterAlias(index: number): string {
    return (
      this._config?.parallel?.aliases?.[index] || this._config?.refresh?.lux_dongles?.[index] || `Inverter ${index + 1}`
    );
  }

  //////////////////////////////
  // Status
  //////////////////////////////

  // Name lookup in a code -> name map; YAML keys are numbers, stored (JSON) keys strings.
  lookupName(names: CodeNames | undefined, code: number): string | undefined {
    const name = names?.[code] ?? names?.[String(code)];
    return typeof name === 'string' && name.trim() ? name.trim() : undefined;
  }

  // Text of an entity as Home Assistant shows it (translated enum labels), or undefined
  // when it's missing or unavailable.
  entityText(entity?: string): string | undefined {
    const stateObj = entity ? this.hass?.states[entity] : undefined;
    if (!stateObj || ['unknown', 'unavailable', ''].includes(stateObj.state)) return undefined;
    const formatted = (this.hass as any)?.formatEntityState?.(stateObj);
    return typeof formatted === 'string' && formatted ? formatted : stateObj.state;
  }

  // Status for one inverter's code. The colour comes from upstream's table and overwrite_as_*;
  // the name from (first match) status_codes.code_names, that inverter's description entity,
  // or upstream's table.
  getStatus(code: number, index: number = 0) {
    const status_dict = getStatusMessage(code);
    const name =
      this.lookupName(this._config?.status_codes?.code_names, code) ??
      this.entityText(this._config?.status_codes?.description_entities?.[index]);
    if (name) status_dict.desc = name;
    if (this._config?.status_codes?.overwrite_as_normal) {
      if (this._config?.status_codes?.overwrite_as_normal.includes(code)) {
        status_dict.level = statusLevels.Clear;
      }
    }
    if (this._config?.status_codes?.overwrite_as_warning) {
      if (this._config?.status_codes?.overwrite_as_warning.includes(code)) {
        status_dict.level = statusLevels.Warning;
      }
    }
    if (this._config?.status_codes?.overwrite_as_error) {
      if (this._config?.status_codes?.overwrite_as_error.includes(code)) {
        status_dict.level = statusLevels.Error;
      }
    }
    return status_dict;
  }

  // Fault and warning lines. Per inverter (same order as the other lists): a bitmask entity,
  // where set bit n shows as E0nn / W0nn with its name from fault_names / warning_names, and/or a
  // text entity shown as written. An inverter's view shows its own lines; the Parallel view shows
  // every inverter's, as one "(all)" line when they're identical. The raw value is the tooltip.
  getCodeAlerts(): TemplateResult[] {
    const codes = this._config?.status_codes;
    if (!codes) return [];
    const count = this._config!.inverter_count;
    const out: TemplateResult[] = [];
    const kinds = [
      {
        masks: codes.fault_entities,
        texts: codes.fault_text_entities,
        names: codes.fault_names,
        prefix: 'E',
        dot: '🔴',
        label: 'Fault',
      },
      {
        masks: codes.warning_entities,
        texts: codes.warning_text_entities,
        names: codes.warning_names,
        prefix: 'W',
        dot: '🟠',
        label: 'Warning',
      },
    ];
    for (const kind of kinds) {
      // The first inverter_count entries belong to the inverters' views. Extra entries (e.g. every
      // inverter of a parallel group shown as one) belong to no view, so they're shown in all.
      const length = Math.max(kind.masks?.length ?? 0, kind.texts?.length ?? 0);
      const own = this._index == -1 ? Array.from({ length: count }, (_, i) => i) : [Math.max(this._index, 0)];
      const indexes = [
        ...own.filter((i) => i < Math.max(length, 1)),
        ...Array.from({ length: Math.max(length - count, 0) }, (_, n) => count + n),
      ];
      const lines = indexes.map((i) => this.describeCodes(kind, i));
      const active = indexes.map((i, n) => ({ i, line: lines[n] })).filter((x) => x.line);
      if (!active.length) continue;
      const same =
        indexes.length > 1 &&
        active.length == indexes.length &&
        active.every((x) => x.line!.text == active[0].line!.text);
      const shown = same ? [{ i: -1, line: active[0].line! }] : active.map((x) => ({ i: x.i, line: x.line! }));
      for (const { i, line } of shown) {
        const who = indexes.length > 1 ? (i == -1 ? ' (all)' : ` (${this.getInverterAlias(i)})`) : '';
        out.push(html`<br /><span title=${line.raw}>${kind.dot} ${kind.label} ${line.text}${who}</span>`);
      }
    }
    return out;
  }

  // One inverter's active faults or warnings, or null when there are none.
  describeCodes(
    kind: { masks?: string[]; texts?: string[]; names?: CodeNames; prefix: string },
    index: number,
  ): { text: string; raw: string } | null {
    const mask_entity = kind.masks?.[index];
    const value = mask_entity ? parseInt(this.hass?.states[mask_entity]?.state ?? '') : NaN;
    const bits: string[] = [];
    let named = false;
    if (!isNaN(value) && value > 0) {
      for (let b = 0; b < 32; b++) {
        if (Math.floor(value / 2 ** b) % 2) {
          const name = this.lookupName(kind.names, b);
          if (name) named = true;
          bits.push(`${kind.prefix}${String(b).padStart(3, '0')}${name ? ` ${name}` : ''}`);
        }
      }
    }
    let text = this.entityText(kind.texts?.[index]);
    if (text && CLEAR_TEXTS.includes(text.trim().toLowerCase())) text = undefined;
    if (!bits.length && !text) return null;
    // Names from the map already say it; otherwise add the text entity's words.
    const parts = [bits.join(', '), named ? '' : (text ?? '')].filter(Boolean);
    const raw = !isNaN(value) && value > 0 ? `0x${value.toString(16).toUpperCase().padStart(8, '0')}` : '';
    return { text: parts.join(': '), raw };
  }

  getStatusMessage(status: StatusMessageType) {
    let status_message = ``;
    switch (status.level) {
      case statusLevels.Clear:
        status_message = `🟢 ${status.desc}`;
        break;
      case statusLevels.Warning:
        status_message = `🟠 ${status.desc}`;
        break;
      case statusLevels.Error:
        status_message = `🔴 ${status.desc}`;
        break;
    }
    return status_message;
  }

  //////////////////////////////
  // Grid
  //////////////////////////////

  getGridFlow() {
    let flow: number = 0;
    if (this._config && this._config?.grid.flow_entities) {
      if (this._index == -1) {
        flow = this.getEntityParallelStateInt(this._config.grid.flow_entities);
      } else {
        flow = this.getEntityStateInt(this._config.grid.flow_entities[this._index]);
      }
    }
    if (this._config?.grid.invert_flow) {
      flow = flow * -1;
    }
    return flow;
  }

  getGeneratorPower() {
    if (this._config && this._config.grid.generator_power_entities) {
      if (this._index == -1) {
        return this.getEntityParallelStateInt(this._config.grid.generator_power_entities);
      } else {
        return this.getEntityStateInt(this._config.grid.generator_power_entities[this._index]);
      }
    }
    return null;
  }

  // Voltages are whole numbers unless the section's voltage_decimal option is on.
  // NaN when the entity is unavailable: shown as "–" and never taken for 0 V ("no grid").
  // Fork: with voltage_decimal not set, the full value is kept and shown with the entity's
  // display precision (see formatVoltage); voltage_decimal: true/false behaves as upstream.
  readVoltage(entity: string, decimal?: boolean): number {
    if (!this.isKnown(entity)) return NaN;
    return decimal === false ? this.getEntityStateInt(entity) : this.getEntityStateFloat(entity);
  }

  // Sum of all entities divided by the inverter count, as the card has always averaged.
  averageVoltage(entities: string[], decimal?: boolean): number {
    const sum = entities.reduce((total, entity) => total + this.readVoltage(entity, decimal), 0);
    const average = sum / (this._config?.inverter_count || 1);
    return decimal === false ? Math.round(average) : average;
  }

  formatVoltage(value: number, decimal?: boolean, entity?: string): string {
    if (isNaN(value)) return '–';
    if (decimal === true) return value.toFixed(1);
    if (decimal === false) return String(Math.round(value));
    return this.formatValue(value, entity);
  }

  getGridVoltage() {
    const decimal = this._config?.grid.voltage_decimal;
    if (this._config?.grid.voltage_entities) {
      if (this._index == -1) {
        return this.averageVoltage(this._config.grid.voltage_entities, decimal);
      } else {
        return this.readVoltage(this._config.grid.voltage_entities[this._index], decimal);
      }
    }
    return null;
  }

  getGeneratorVoltage() {
    if (this._config?.grid.generator_voltage_entities) {
      if (this._index == -1) {
        // Averaged like the grid voltage (it used to be summed: 2 x 230 V showed 460 V).
        return this.averageVoltage(this._config.grid.generator_voltage_entities, this._config.grid.voltage_decimal);
      } else {
        return this.readVoltage(
          this._config.grid.generator_voltage_entities[this._index],
          this._config.grid.voltage_decimal,
        );
      }
    }
    return null;
  }

  //////////////////////////////
  // Consumption
  //////////////////////////////

  getHomeConsumption(index: number) {
    if (this._config && this._config.consumption.home_entities) {
      if (index == -1) {
        return this.getEntityParallelStateInt(this._config.consumption.home_entities);
      } else {
        return this.getEntityStateInt(this._config.consumption.home_entities[index]);
      }
    }
    return 0;
  }

  getBackupConsumption(index: number) {
    if (this._config && this._config.consumption.backup_entities) {
      if (index == -1) {
        return this.getEntityParallelStateInt(this._config.consumption.backup_entities);
      } else {
        return this.getEntityStateInt(this._config.consumption.backup_entities[index]);
      }
    }
    return 0;
  }

  getHomeArrow(index: number) {
    if (this._config) {
      const home_consumption = this.getHomeConsumption(index);
      const backup_consumption = this.getBackupConsumption(index);
      if (home_consumption > 0 || backup_consumption > 0) {
        return ARROW_DOWN;
      }
    }
    return ARROW_NONE;
  }

  //////////////////////////////
  // Solar
  //////////////////////////////

  getSolarProductionCombined(index: number) {
    if (this._config && this._config.pv && this._config.pv.combined_entities) {
      if (index != -1) {
        return this.getEntityStateInt(this._config.pv.combined_entities[index]);
      } else {
        return this.getEntityParallelStateInt(this._config.pv.combined_entities);
      }
    }
    return 0;
  }

  getSolarProductionIndividual(index: number) {
    let total: number = 0;
    if (this._config && this._config.pv) {
      if (index == -1) {
        if (this._config.pv.array_1_entities) {
          total += this.getEntityParallelStateInt(this._config.pv.array_1_entities);
        }
        if (this._config.pv.array_2_entities) {
          total += this.getEntityParallelStateInt(this._config.pv.array_2_entities);
        }
        if (this._config.pv.array_3_entities) {
          total += this.getEntityParallelStateInt(this._config.pv.array_3_entities);
        }
        return total;
      } else {
        if (this._config.pv.array_1_entities) {
          total += this.getEntityStateInt(this._config.pv.array_1_entities[index]);
        }
        if (this._config.pv.array_2_entities) {
          total += this.getEntityStateInt(this._config.pv.array_2_entities[index]);
        }
        if (this._config.pv.array_3_entities) {
          total += this.getEntityStateInt(this._config.pv.array_3_entities[index]);
        }
        return total;
      }
    }
    return total;
  }

  //////////////////////////////
  // Battery
  //////////////////////////////

  getBatteryFlow(index: number) {
    let flow = 0;
    if (this._config?.battery.flow_entities) {
      if (index == -1) {
        for (let i = 0; i < this._config.inverter_count; i++) {
          flow += this.getEntityStateInt(this._config.battery.flow_entities[i]);
        }
        if (this._config?.battery.invert_flow) {
          return flow * -1;
        }
        return flow;
      } else {
        flow = this.getEntityStateInt(this._config.battery.flow_entities[index]);
      }
      if (this._config?.battery.invert_flow) {
        return flow * -1;
      }
      return flow;
    }
    if (this._config?.battery.discharge_live_entities && this._config?.battery.charge_live_entities) {
      if (index == -1) {
        for (let i = 0; i < this._config.inverter_count; i++) {
          flow += this.getEntityStateInt(this._config.battery.charge_live_entities[i]);
          flow -= this.getEntityStateInt(this._config.battery.discharge_live_entities[i]);
        }
        return flow;
      } else {
        let charge = this.getEntityStateInt(this._config.battery.charge_live_entities[index]);
        let discharge = this.getEntityStateInt(this._config.battery.discharge_live_entities[index]);
        flow = charge - discharge;
        return flow;
      }
    }
    return 0;
  }

  // Index of the inverter that reports the shared battery, or null when each inverter has its own.
  getSharedBatteryIndex(): number | null {
    if (!this._config?.battery.shared) return null;
    return this._config.battery.shared_index ?? 0;
  }

  // NaN when the SOC entity is unavailable: shown as "–", with no runtime (rather than 0 %).
  getBatterySoc(index: number) {
    if (!this._config?.battery.soc_entities) return 0;
    const read = (entity: string | undefined) => (this.isKnown(entity) ? this.getEntityStateInt(entity!) : NaN);
    const shared = this.getSharedBatteryIndex();
    if (shared !== null) return read(this._config.battery.soc_entities[shared]);
    if (index != -1) return read(this._config.battery.soc_entities[index]);
    if (this._config.battery.parallel_soc_entity && this._config.battery.show_parallel_soc_entity) {
      return read(this._config.battery.parallel_soc_entity);
    }
    const all = this._config.battery.soc_entities.map(read);
    return Math.round(all.reduce((total, soc) => total + soc, 0) / this._config.inverter_count);
  }

  getBatteryVoltage(index: number) {
    const decimal = this._config?.battery.voltage_decimal;
    if (this._config?.battery.voltage_entities) {
      const shared = this.getSharedBatteryIndex();
      if (shared !== null) {
        const entity = this._config.battery.voltage_entities[shared];
        const battery_v = this.readVoltage(entity, decimal);
        return `${this.formatVoltage(battery_v, decimal, entity)} Vdc`;
      } else if (index == -1) {
        if (this._config?.battery?.parallel_average_voltage) {
          const average = this.averageVoltage(this._config.battery.voltage_entities, decimal);
          return `${this.formatVoltage(average, decimal, this._config.battery.voltage_entities[0])} Vdc (avg)`;
        }
      } else {
        const entity = this._config.battery.voltage_entities[index];
        const battery_v = this.readVoltage(entity, decimal);
        return `${this.formatVoltage(battery_v, decimal, entity)} Vdc`;
      }
    }
    return ``;
  }

  convertRuntimeToString(runtime: number, format: string) {
    // Count whole minutes first, so rounding can't produce "2h, 60m".
    const total = Math.round(runtime * 60);
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    switch (format) {
      case 'short':
        return `${hours}:${String(minutes).padStart(2, '0')} remaining`;
      case 'long':
        return `${hours}h, ${minutes}m`;
      default:
        return '';
    }
  }

  //////////////////////////////
  // Render
  //////////////////////////////

  protected render() {
    if (!this._config || !this.hass) return nothing;

    if (this._incomplete) {
      return html`
        <ha-card>
          <div style="padding: 16px; color: var(--secondary-text-color);">
            <p style="margin: 0 0 4px; font-weight: 500; color: var(--primary-text-color);">Finish the setup</p>
            <p style="margin: 0;">${this._incomplete}</p>
          </div>
        </ha-card>
      `;
    }

    // Warn but keep rendering (missing values read as 0), so configs that worked before still show.
    const warnings = this.getWarnings();
    const missing_warning = warnings.length
      ? html`<div style="padding: 8px 16px 0; color: var(--warning-color, #ffa600); font-size: 13px; line-height: 1.4;">
          ${warnings.map((warning) => html`<div>⚠ ${warning}</div>`)}
        </div>`
      : nothing;

    // ----- Selector and index
    this.getIndex();
    let parallel_selector: TemplateResult | typeof nothing = nothing;
    // Every multi-inverter card gets the selector, with a name for every inverter.
    if (this._config.inverter_count > 1) {
      const parallelFirst = Boolean(this._config.parallel?.parallel_first);
      parallel_selector = html`
        <select class="inv-select" name="Inverters" id="inverter-selector" @change=${() => this._update()}>
          ${parallelFirst ? html`<option value=${String(this._config.inverter_count)}>Parallel</option>` : nothing}
          ${Array.from(
            { length: this._config.inverter_count },
            (_, i) => html`<option value=${String(i)}>${this.getInverterAlias(i)}</option>`,
          )}
          ${!parallelFirst ? html`<option value=${String(this._config.inverter_count)}>Parallel</option>` : nothing}
        </select>
      `;
    }

    // ----- Title
    const title = this._config?.title ? html`<h1 class="card-header">${this._config.title}</h1>` : nothing;

    // ----- Refresh button
    const refresh_button_location = this._config.refresh?.button_location || 'none';
    const refresh_button_right = html`
      <button id="refresh-button-right" class="icon-button" @click=${() => this._handleRefresh()}>
        <ha-icon icon="mdi:cloud-refresh"></ha-icon>
      </button>
    `;
    const refresh_button_left = html`
      <button id="refresh-button-left" class="icon-button" @click=${() => this._handleRefresh()}>
        <ha-icon icon="mdi:cloud-refresh"></ha-icon>
      </button>
    `;

    // ----- Status codes
    let status_code = '';
    if (this._config.status_codes?.entities) {
      if (this._index == -1) {
        const sts_arr: StatusMessageType[] = this._config.status_codes.entities.map((entity, i) =>
          this.getStatus(this.getEntityStateInt(entity), i),
        );
        const disct_count = new Set(sts_arr.map((obj) => JSON.stringify(Object.entries(obj).sort()))).size;
        if (disct_count == 1 && sts_arr.length > 0) {
          status_code = this.getStatusMessage(sts_arr[0]);
        } else if (sts_arr.length > 0) {
          const sts_arr_sorted = [...sts_arr].sort((a, b) => b.level - a.level);
          const highest_level = sts_arr_sorted[0].level;
          const top_level_messages = sts_arr_sorted.filter((m) => m.level === highest_level);
          if (top_level_messages.length === 1) {
            status_code = this.getStatusMessage(sts_arr_sorted[0]);
          }
        }
      } else {
        const code = this.getEntityStateInt(this._config.status_codes.entities[this._index]);
        status_code = this.getStatusMessage(this.getStatus(code, this._index));
      }
    }

    // ----- Solar
    let solar_info: TemplateResult | typeof nothing = nothing;
    let solar_arrow = ARROW_NONE;
    if (
      this._config.pv &&
      (this._config.pv.combined_entities ||
        this._config.pv.array_1_entities ||
        this._config.pv.array_2_entities ||
        this._config.pv.array_3_entities)
    ) {
      const combined_solar_flow = this.getSolarProductionCombined(this._index);
      const individual_solar_flow = this.getSolarProductionIndividual(this._index);
      solar_arrow = combined_solar_flow > 0 || individual_solar_flow > 0 ? ARROW_DOWN : ARROW_NONE;

      if (this._config.pv.combined_entities) {
        solar_info = html`
          <div>
            <p class="header-text">${combined_solar_flow} W</p>
            <p class="sub-text">${combined_solar_flow > 0 ? 'PV Power' : ''}</p>
          </div>
        `;
      } else if (this._index == -1) {
        const total = this.getSolarProductionIndividual(this._index);
        solar_info = html`
          <div>
            <p class="header-text">${total} W</p>
            <p class="sub-text">${total > 0 ? 'PV Power' : ''}</p>
          </div>
        `;
      } else {
        solar_info = html`
          <div>
            ${
              this._config.pv.array_1_entities
                ? html`<p class="header-text">
                    A1: ${this.getEntityStateInt(this._config.pv.array_1_entities[this._index])} W
                  </p>`
                : nothing
            }
            ${
              this._config.pv.array_2_entities
                ? html`<p class="header-text">
                    A2: ${this.getEntityStateInt(this._config.pv.array_2_entities[this._index])} W
                  </p>`
                : nothing
            }
            ${
              this._config.pv.array_3_entities
                ? html`<p class="header-text">
                    A3: ${this.getEntityStateInt(this._config.pv.array_3_entities[this._index])} W
                  </p>`
                : nothing
            }
          </div>
        `;
      }
    }

    // ----- Battery generator
    const gen_configured = Boolean(this._config.battery_generator);
    const gen = this.getBatteryGenerator();
    let gen_image: TemplateResult | typeof nothing = nothing;
    let gen_info: TemplateResult | typeof nothing = nothing;
    let gen_arrow = ARROW_NONE;
    if (gen?.active) {
      // Shown while running (running_entity on), but the feed only animates while it delivers power.
      gen_arrow = gen.power > 0 ? ARROW_DOWN : ARROW_NONE;
      gen_image = html`<img
        src=${getBase64Data(base64Images.Generator)}
        @click=${() => this._openHistory(this._config!.battery_generator!.power_entity)}
      />`;
      gen_info = html`
        <div>
          <p class="header-text">${gen.power} W</p>
          <p class="sub-text">Generator</p>
          ${
            gen.voltage != null
              ? html`<p class="sub-text">
                  ${this.formatValue(gen.voltage, this._config.battery_generator!.voltage_entity)} Vac
                </p>`
              : nothing
          }
          ${gen.frequency != null ? html`<p class="sub-text">${gen.frequency.toFixed(1)} Hz</p>` : nothing}
          ${gen.thd != null ? html`<p class="sub-text">THD ${gen.thd.toFixed(1)}%</p>` : nothing}
        </div>
      `;
    }

    // ----- Battery
    let battery_flow_info: TemplateResult | typeof nothing = nothing;
    let battery_image = html`<img src=${getBase64Data(base64Images.Battery5)} />`;
    let battery_arrow = ARROW_NONE;
    let battery_soc_info: TemplateResult | typeof nothing = nothing;
    let battery_bottom_runtime: TemplateResult | typeof nothing = nothing;
    if (this._config.battery) {
      const battery_soc = this.getBatterySoc(this._index);
      const battery_flow = this.getBatteryFlow(this._index) + (gen?.active && gen.addToBattery ? gen.power : 0);
      battery_image = isNaN(battery_soc)
        ? html`<img src=${getBase64Data(base64Images.Battery5)} style="opacity: 0.35" />`
        : html`<img src=${getBatteryImage(battery_soc)} />`;

      let header_text = '0 W';
      let sub_text = 'Idle';
      if (battery_flow < 0) {
        header_text = `${Math.abs(battery_flow)} W`;
        sub_text = 'Discharge Power';
        battery_arrow = ARROW_RIGHT;
      } else if (battery_flow > 0) {
        header_text = `${battery_flow} W`;
        sub_text = 'Charge Power';
        battery_arrow = ARROW_LEFT;
      }
      battery_flow_info = html`
        <div>
          <p class="header-text">${header_text}</p>
          <p class="sub-text">${sub_text}</p>
        </div>
      `;

      let battery_top_runtime: TemplateResult | typeof nothing = nothing;
      // A shared battery is drained by every inverter, so its runtime uses the combined flow in every view.
      const shared = this.getSharedBatteryIndex();
      const runtime_flow =
        shared === null ? battery_flow : this.getBatteryFlow(-1) + (gen?.active && gen.addToBattery ? gen.power : 0);
      if (
        this._config.battery.capacity_ah_entities &&
        this._config.battery.voltage_entities &&
        runtime_flow != 0 &&
        !isNaN(battery_soc) &&
        this._config.battery.soc_entities &&
        battery_soc != 100 &&
        this._config.battery.runtime_location &&
        ['bottom', 'left', 'both'].includes(this._config.battery.runtime_location)
      ) {
        let total_cap_wh = 0;
        if (shared !== null) {
          // Count the shared bank once, not once per inverter.
          const cap_ah = this.getEntityStateInt(this._config.battery.capacity_ah_entities[shared]);
          total_cap_wh = cap_ah * this.getEntityStateInt(this._config.battery.voltage_entities[shared]);
        } else if (this._index == -1) {
          for (let i = 0; i < this._config.inverter_count; i++) {
            const cap_ah = this.getEntityStateInt(this._config.battery.capacity_ah_entities[i]);
            total_cap_wh += cap_ah * this.getEntityStateFloat(this._config.battery.voltage_entities[i]);
          }
        } else {
          const cap_ah = this.getEntityStateInt(this._config.battery.capacity_ah_entities[this._index]);
          total_cap_wh = cap_ah * this.getEntityStateFloat(this._config.battery.voltage_entities[this._index]);
        }
        const dod = this.getDepthOfDischarge();
        const charge_target = this._config.battery.charge_target_soc ?? 90;
        if (runtime_flow < 0 && battery_soc <= dod) {
          // Still discharging below the depth of discharge: say so, rather than show a negative time.
          // It usually means the inverter's cut-off is set lower than depth_of_discharge.
          const where = battery_soc == dod ? 'At' : 'Below';
          if (['bottom', 'both'].includes(this._config.battery.runtime_location)) {
            battery_bottom_runtime = html`<p id="time-info" class="header-text">
              ${where} the ${dod}% depth of discharge
            </p>`;
          }
          if (['left', 'both'].includes(this._config.battery.runtime_location)) {
            battery_top_runtime = html`<p class="header-text">${where} ${dod}%</p>`;
          }
        } else if (runtime_flow < 0 && total_cap_wh > 0) {
          const avail_wh = (total_cap_wh * (battery_soc - dod)) / 100;
          const rem_h = avail_wh / Math.abs(runtime_flow);
          if (['bottom', 'both'].includes(this._config.battery.runtime_location)) {
            battery_bottom_runtime = html`<p id="time-info" class="header-text">
              ${this.convertRuntimeToString(rem_h, 'long')} remaining battery usage
            </p>`;
          }
          if (['left', 'both'].includes(this._config.battery.runtime_location)) {
            battery_top_runtime = html`<p class="header-text">${this.convertRuntimeToString(rem_h, 'short')}</p>`;
          }
        } else if (runtime_flow > 0 && battery_soc < charge_target && total_cap_wh > 0) {
          const avail_wh = (total_cap_wh * (charge_target - battery_soc)) / 100;
          const rem_h = avail_wh / Math.abs(runtime_flow);
          if (['bottom', 'both'].includes(this._config.battery.runtime_location)) {
            battery_bottom_runtime = html`<p id="time-info" class="header-text">
              ${this.convertRuntimeToString(rem_h, 'long')} remaining to charge to ${charge_target}%
            </p>`;
          }
          if (['left', 'both'].includes(this._config.battery.runtime_location)) {
            battery_top_runtime = html`<p class="header-text">${this.convertRuntimeToString(rem_h, 'short')}</p>`;
          }
        }
      }
      battery_soc_info = html`
        <div>
          <p class="header-text">${isNaN(battery_soc) ? '–' : battery_soc} %</p>
          <p class="header-text">${this.getBatteryVoltage(this._index)}</p>
          ${battery_top_runtime}
        </div>
      `;
    }

    // ----- Temp
    let temp_info: TemplateResult | string = '';
    if (this._config.temp?.entities) {
      if (this._index == -1) {
        temp_info = html`${Array.from({ length: this._config.inverter_count }, (_, i) => {
          const entity = this._config!.temp!.entities![i];
          const temp = this.isKnown(entity) ? this.getEntityStateFloat(entity) : '–';
          return html`<br />${this.getInverterAlias(i)}: ${temp}${this.getEntityUnit(entity)}`;
        })}`;
      } else {
        const entity = this._config.temp.entities[this._index];
        const temp = this.isKnown(entity) ? this.getEntityStateFloat(entity) : '–';
        temp_info = `${temp}${this.getEntityUnit(entity)}`;
      }
    }

    // ----- Inverter (rendered declaratively via Lit html template)
    const inverter_image = html`<img
      src=${getBase64Data(this._index == -1 ? base64Images.ParallelInverter : base64Images.Inverter)}
    />`;

    // ----- Grid
    let grid_arrow = ARROW_NONE;
    let grid_image_class = '';
    const grid_flow = this.getGridFlow();
    const gen_power = this.getGeneratorPower();
    const grid_voltage = this.getGridVoltage();
    const gen_voltage = this.getGeneratorVoltage();
    const voltage_slot = Math.max(this._index, 0);
    const grid_voltage_entity = this._config.grid.voltage_entities?.[voltage_slot];
    const gen_voltage_entity = this._config.grid.generator_voltage_entities?.[voltage_slot];
    let grid_emoji = '';
    let grid_voltage_str = '';
    // Generator in the grid's place (grid.generator_* / generator architecture: grid):
    // shown while it produces power and the grid is idle (0 W) or down (0 V).
    const gen_in_grid_place = gen_power != null && gen_power > 0 && (grid_flow == 0 || grid_voltage == 0);
    // Fork: the generator's own frequency and THD (single entities), shown only when configured.
    const gen_frequency = this.getOptionalFloat(this._config.grid.generator_frequency_entity);
    const gen_thd = this.getOptionalFloat(this._config.grid.generator_thd_entity);
    if (gen_in_grid_place) {
      grid_arrow = ARROW_LEFT;
    } else if (grid_flow < 0) {
      grid_arrow = ARROW_LEFT;
    } else if (grid_flow > 0) {
      grid_arrow = ARROW_RIGHT;
    }
    if (gen_in_grid_place) {
      // A running generator isn't a "no grid" state: no hue/dot indicators.
      grid_voltage_str =
        gen_voltage != null
          ? `${this.formatVoltage(gen_voltage, this._config.grid.voltage_decimal, gen_voltage_entity)} Vac`
          : '';
    } else if (grid_voltage != null) {
      if (grid_voltage == 0) {
        if (this._config.grid.indicators?.hue) grid_image_class = 'blend-overlay';
        if (this._config.grid.indicators?.dot) grid_emoji = ' 🔴';
      }
      grid_voltage_str = `${this.formatVoltage(grid_voltage, this._config.grid.voltage_decimal, grid_voltage_entity)} Vac`;
    } else if (gen_voltage != null) {
      if (gen_voltage == 0) {
        if (this._config.grid.indicators?.hue) grid_image_class = 'blend-overlay';
        if (this._config.grid.indicators?.dot) grid_emoji = ' 🔴';
      }
      grid_voltage_str = `${this.formatVoltage(gen_voltage, this._config.grid.voltage_decimal, gen_voltage_entity)} Vac`;
    }
    if (this._index == -1) {
      grid_voltage_str = this._config.grid.parallel_average_voltage ? `${grid_voltage_str} (avg)${grid_emoji}` : '';
    } else {
      grid_voltage_str = `${grid_voltage_str}${grid_emoji}`;
    }
    const grid_info = html`
      <div>
        <p class="header-text">${gen_in_grid_place ? Math.abs(gen_power!) : Math.abs(grid_flow)} W</p>
        ${gen_in_grid_place ? html`<p class="sub-text">Generator</p>` : nothing}
        <p class="header-text">${grid_voltage_str}</p>
        ${gen_in_grid_place && gen_frequency != null ? html`<p class="sub-text">${gen_frequency.toFixed(1)} Hz</p>` : nothing}
        ${gen_in_grid_place && gen_thd != null ? html`<p class="sub-text">THD ${gen_thd.toFixed(1)}%</p>` : nothing}
      </div>
    `;

    // ----- Consumption
    const home_consumption = this.getHomeConsumption(this._index);
    const backup_consumption = this.getBackupConsumption(this._index);
    const consumption_arrow = home_consumption > 0 || backup_consumption > 0 ? ARROW_DOWN : ARROW_NONE;
    const consumption_header =
      home_consumption > 0
        ? `${Math.abs(home_consumption)} W`
        : backup_consumption > 0
          ? `${Math.abs(backup_consumption)} W`
          : '0 W';
    const consumption_sub = home_consumption > 0 ? 'Home Usage' : backup_consumption > 0 ? 'Backup Power' : '';
    const consumption_info = html`
      <div>
        <p class="header-text">${consumption_header}</p>
        <p class="sub-text">${consumption_sub}</p>
      </div>
    `;

    // ----- Allocated Power
    let allocated_arrow = ARROW_NONE;
    let allocated_info: TemplateResult | typeof nothing = nothing;
    if (this._config.consumption.allocated_power_entity) {
      const allocated_power = this.getEntityStateInt(this._config.consumption.allocated_power_entity);
      if (allocated_power > 0) allocated_arrow = ARROW_RIGHT;
      allocated_info = html`
        <div>
          <p class="header-text">${allocated_power} W</p>
          <p class="sub-text">Allocated Power</p>
        </div>
      `;
    }

    // ----- Updated time and Battery runtime
    let updated_time_block: TemplateResult | typeof nothing = nothing;
    if (this._config.update_time?.entities) {
      if (this._index == -1 && this._config.update_time.has_timestamp_attribute) {
        let oldest_update_ts = Number(this.getEntityAttribute(this._config.update_time.entities[0], 'timestamp'));
        let oldest_update_index = 0;
        let latest_update_ts = oldest_update_ts;
        for (let i = 1; i < this._config.inverter_count; i++) {
          const test_time = Number(this.getEntityAttribute(this._config.update_time.entities[i], 'timestamp'));
          if (test_time < oldest_update_ts) {
            oldest_update_ts = test_time;
            oldest_update_index = i;
          }
          if (test_time > latest_update_ts) {
            latest_update_ts = test_time;
          }
        }
        const biggest_diff_sec = Math.abs(latest_update_ts - oldest_update_ts);
        const update_state = this.getEntityState(this._config.update_time.entities[oldest_update_index]);
        const prefix = biggest_diff_sec < 3 ? '' : `${this.getInverterAlias(oldest_update_index)} `;
        const label_dt = biggest_diff_sec < 3 ? 'Last update at:' : `${prefix}last update at:`;
        const label_since = biggest_diff_sec < 3 ? 'Updated' : `${prefix}updated`;
        updated_time_block = html`
          ${
            this._config.update_time.show_datetime
              ? html`<p id="time-info" class="header-text">${label_dt} ${update_state}</p>`
              : nothing
          }
          ${
            this._config.update_time.show_time_since && this._config.update_time.show_datetime ? html`<p></p>` : nothing
          }
          ${
            this._config.update_time.show_time_since
              ? html`<p id="since-info" class="header-text">${label_since} ${this.getTimeSince(oldest_update_ts)}</p>`
              : nothing
          }
        `;
      } else if (this._index != -1) {
        const update_time = this.getEntityState(this._config.update_time.entities[this._index]);
        const last_time_ts = Number(
          this.getEntityAttribute(this._config.update_time.entities[this._index], 'timestamp'),
        );
        const show_since = Boolean(
          this._config.update_time.show_time_since && this._config.update_time.has_timestamp_attribute,
        );
        updated_time_block = html`
          ${
            this._config.update_time.show_datetime
              ? html`<p id="time-info" class="header-text">Last update at: ${update_time}</p>`
              : nothing
          }
          ${show_since && this._config.update_time.show_datetime ? html`<p></p>` : nothing}
          ${
            show_since
              ? html`<p id="since-info" class="header-text">Updated ${this.getTimeSince(last_time_ts)}</p>`
              : nothing
          }
        `;
      }
    }
    const updated_time_battery_runtime = html`
      ${updated_time_block}
      ${updated_time_block !== nothing && battery_bottom_runtime !== nothing ? html`<p></p>` : nothing}
      ${battery_bottom_runtime}
    `;

    return html`
      <ha-card>
        <style>
          /* CARD */
          ha-card {
            width: auto;
            padding-left: 15px;
            padding-right: 15px;
            padding-top: ${this._config.title ? 0 : 15}px;
            padding-bottom: 15px;
          }

          /* GRID */
          .diagram-grid {
            display: grid;
            grid-template-columns: repeat(6, 1fr);
            grid-template-rows: repeat(${this._config.pv || gen_configured ? 5 : 4}, 1fr);
            padding-left: 5px;
            padding-right: 5px;
          }
          .status-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            grid-template-rows: repeat(1, 1fr);
            padding-left: 5px;
            padding-right: 5px;
            padding-top: ${this._config.title ? 0 : 10}px;
          }
          .diagram-grid img {
            max-width: 100%;
            max-height: 100%;
          }

          /* CELLS */
          .cell {
            /* border: 1px solid #ccc; */
            width: 100%;
            height: auto;
          }

          /* TEXT */
          .text-cell {
            /*max-height: 100%;*/
            display: flex;
            /*text-overflow: ellipsis;
            flex-wrap: wrap;
            word-wrap: break-word;*/ /* Allow the text to wrap within the cell */
          }
          .temp-cell {
            align-self: end;
            align-content: left;
            font-size: min(4vw, 1em);
            font-weight: bold;
            line-height: 1;
            margin: 0;
          }
          .header-text {
            font-size: min(4vw, 1em);
            font-weight: bold;
            line-height: 1;
            margin: 0;
            padding-left: 3px;
            padding-right: 3px;
            padding-top: 1.5px;
            padding-bottom: 1.5px;
          }
          .sub-text {
            font-size: min(2.5vw, 0.95em);
            color: var(--secondary-text-color);
            line-height: 1;
            margin: 0;
            padding-left: 3px;
            padding-right: 3px;
            padding-top: 1.5px;
            padding-bottom: 1.5px;
          }
          .battery-runtime-text {
            font-size: min(2vw, 0.8em);
            color: var(--secondary-text-color);
            line-height: 1;
            margin: 0;
            padding-left: 3px;
            padding-right: 3px;
            padding-top: 1px;
            padding-bottom: 1px;
            text-align: center;
          }
          .pv-main-text {
            font-size: min(4vw, 1em);
            font-weight: bold;
          }

          /* IMAGE CELLS */
          .image-cell img {
            margin: auto;
            display: flex;
            align-items: center;
            text-align: center;
            justify-content: center;
            width: auto;
            object-fit: contain;
            position: relative;
          }

          .blend-overlay {
            mix-blend-mode: overlay;
          }

          /* ARROWS */
          .arrow-cell {
            margin: auto;
            display: flex;
            align-items: center;

            text-align: center;
            justify-content: center;
            width: auto;
            object-fit: contain;
            position: relative;
          }
          .arrow-long-cell {
            margin: auto;
            display: flex;
            align-items: center;

            text-align: center;
            justify-content: center;
            width: auto;
            object-fit: contain;
            position: relative;
            grid-column: span 2;
          }
          .arrows-left {
            transform: rotate(0deg);
          }
          .arrows-up {
            transform: rotate(90deg);
          }
          .arrows-right {
            transform: rotate(180deg);
          }
          .arrows-down {
            transform: rotate(-90deg);
          }
          .arrows-none {
            opacity: 0;
          }
          /* feed_spacing: vertical feeds (PV -> inverter, inverter -> home) shorter so
             they don't touch the icons at either end, like the grid feed */
          .feed-spacing #solar-arrows.arrows-down,
          .feed-spacing #home-arrows.arrows-down {
            transform: rotate(-90deg) scale(0.8);
          }
          /* Battery generator: feed stops short of the battery like the other feeds */
          .gen-arrow-cell.arrows-down {
            transform: rotate(-90deg) scale(0.8) translateX(12%);
          }
          /* Battery generator: icon at 80% of its normal size. A transform scales it
             about its own centre, so it stays level with the solar icon and tracks
             the other icons at any card width. */
          #generator-image img,
          #grid-image.gen-in-grid img {
            transform: scale(0.8);
          }
          /* Battery generator: charge label sits low in its cell, next to the battery */
          .gen-charge-info {
            align-items: flex-end;
          }

          /* ARROW ANIMATIONS CELL*/
          @keyframes arrow-flash {
            0% {
              opacity: 1;
            }
            16% {
              opacity: 0.65;
            }
            32% {
              opacity: 0.3;
            }
            48% {
              opacity: 0.3;
            }
            64% {
              opacity: 0.3;
            }
            80% {
              opacity: 0.3;
            }
            100% {
              opacity: 1;
            }
          }
          .arrow-1 {
            animation: arrow-flash 1.5s infinite;
            animation-delay: 0.75s;
          }
          .arrow-2 {
            animation: arrow-flash 1.5s infinite;
            animation-delay: 0.5s;
          }
          .arrow-3 {
            animation: arrow-flash 1.5s infinite;
            animation-delay: 0.25s;
          }
          .arrow-4 {
            animation: arrow-flash 1.5s infinite;
          }

          @keyframes arrow-long-flash {
            0% {
              opacity: 1;
            }
            16% {
              opacity: 0.65;
            }
            32% {
              opacity: 0.3;
            }
            48% {
              opacity: 0.3;
            }
            64% {
              opacity: 0.3;
            }
            80% {
              opacity: 0.3;
            }
            100% {
              opacity: 1;
            }
          }
          .arrow-long-1 {
            animation: arrow-long-flash 1.5s infinite;
            animation-delay: 1.75s;
          }
          .arrow-long-2 {
            animation: arrow-long-flash 1.5s infinite;
            animation-delay: 1.5s;
          }
          .arrow-long-3 {
            animation: arrow-long-flash 1.5s infinite;
            animation-delay: 1.25s;
          }
          .arrow-long-4 {
            animation: arrow-long-flash 1.5s infinite;
            animation-delay: 1s;
          }
          .arrow-long-5 {
            animation: arrow-long-flash 1.5s infinite;
            animation-delay: 0.75s;
          }
          .arrow-long-6 {
            animation: arrow-long-flash 1.5s infinite;
            animation-delay: 0.5s;
          }
          .arrow-long-7 {
            animation: arrow-long-flash 1.5s infinite;
            animation-delay: 0.25s;
          }
          .arrow-long-8 {
            animation: arrow-long-flash 1.5s infinite;
          }

          /* TIME AND DATE */
          .update-time {
            text-align: left;
            margin: 0;
            padding-left: 5px;
            padding-right: 5px;
          }
          .grid-status {
            text-align: right;
            margin: 0;
            line-height: 1;
          }
          .temp {
            text-align: right;
            margin: 0;
            line-height: 1;
          }
          .inv-select {
            align-items: left;
            margin: 0;
            line-height: 1;
          }
        </style>
        <div>
          ${title} ${missing_warning}
          <card-content>
            <div id="taskbar-grid" class="status-grid">
              <div id="select-cell" class="cell">${parallel_selector}</div>
              <div id="status-cell" class="cell grid-status">${status_code}${this.getCodeAlerts()}</div>
            </div>
            <div id="card-grid" class="diagram-grid ${this._config.feed_spacing ? 'feed-spacing' : ''}">
              ${
                gen_configured
                  ? html`
                      <div id="generator-image" class="cell image-cell">${gen_image}</div>
                      <div id="generator-info" class="cell text-cell">${gen_info}</div>
                      ${
                        this._config?.pv && (this._config?.pv?.array_1_entities || this._config?.pv?.combined_entities)
                          ? html`
                              <div id="solar-image" class="cell image-cell">
                                <img src=${getBase64Data(base64Images.Solar)} />
                              </div>
                              <div id="solar-info" class="cell text-cell">${solar_info}</div>
                            `
                          : html`<div class="cell"></div>
                              <div class="cell"></div>`
                      }
                      <div class="cell"></div>
                      <div class="cell"></div>
                      <div id="generator-arrows" class="cell arrow-cell gen-arrow-cell ${gen_arrow}">
                        ${this.generateArrows()}
                      </div>
                      <div id="battery-charge-info" class="cell text-cell gen-charge-info">${battery_flow_info}</div>
                      ${
                        this._config?.pv && (this._config?.pv?.array_1_entities || this._config?.pv?.combined_entities)
                          ? html`<div id="solar-arrows" class="cell arrow-cell ${solar_arrow}">
                              ${this.generateArrows()}
                            </div>`
                          : html`<div class="cell"></div>`
                      }
                      <div id="temp-info" class="cell temp-cell">${temp_info}</div>
                      <div class="cell temp-cell"></div>
                      <div class="cell">
                        ${['right', 'both'].includes(refresh_button_location) ? refresh_button_right : nothing}
                      </div>
                    `
                  : this._config?.pv && (this._config?.pv?.array_1_entities || this._config?.pv?.combined_entities)
                    ? html`
                        <div class="cell"></div>
                        <div class="cell"></div>
                        <div id="solar-image" class="cell image-cell">
                          <img src=${getBase64Data(base64Images.Solar)} />
                        </div>
                        <div id="solar-info" class="cell text-cell">${solar_info}</div>
                        <div class="cell"></div>
                        <div class="cell"></div>
                        <div id="battery-charge-info" class="cell text-cell">${battery_flow_info}</div>
                        <div class="cell"></div>
                        <div id="solar-arrows" class="cell arrow-cell ${solar_arrow}">${this.generateArrows()}</div>
                        <div id="temp-info" class="cell temp-cell">${temp_info}</div>
                        <div class="cell temp-cell"></div>
                        <div class="cell">
                          ${['right', 'both'].includes(refresh_button_location) ? refresh_button_right : nothing}
                        </div>
                      `
                    : html`
                        <div id="battery-charge-info" class="cell text-cell">${battery_flow_info}</div>
                        <div class="cell"></div>
                        <div class="cell"></div>
                        <div id="temp-info" class="cell temp-cell">${temp_info}</div>
                        <div class="cell"></div>
                        <div class="cell">
                          ${['right', 'both'].includes(refresh_button_location) ? refresh_button_right : nothing}
                        </div>
                      `
              }

              <div id="battery-image" class="cell image-cell">${battery_image}</div>
              <div id="battery-arrows" class="cell arrow-cell ${battery_arrow}">${this.generateArrows()}</div>
              <div id="inverter-image" class="cell image-cell">${inverter_image}</div>
              <div id="grid-arrows" class="cell arrow-long-cell ${grid_arrow}">${this.generateLongArrows()}</div>
              <div
                id="grid-image"
                class="cell image-cell ${grid_image_class} ${gen_in_grid_place ? 'gen-in-grid' : ''}"
              >
                <img src=${getBase64Data(gen_in_grid_place ? base64Images.Generator : base64Images.Grid)} />
              </div>

              <div id="battery-soc-info" class="cell text-cell">${battery_soc_info}</div>
              <div class="cell"></div>
              <div id="home-arrows" class="cell arrow-cell ${consumption_arrow}">${this.generateArrows()}</div>
              <div class="cell"></div>
              <div class="cell"></div>
              <div id="grid-info" class="cell text-cell">${grid_info}</div>

              ${
                this._config?.consumption.allocated_power_entity
                  ? html`
                      <div class="cell">
                        ${['left', 'both'].includes(refresh_button_location) ? refresh_button_left : nothing}
                      </div>
                      <div id="home-info" class="cell text-cell">${consumption_info}</div>
                      <div id="home-image" class="cell image-cell">
                        <img src=${getBase64Data(base64Images.HomeNormal)} />
                      </div>
                      <div id="power-allocation-arrows" class="cell arrow-cell ${allocated_arrow}">
                        ${this.generateArrows()}
                      </div>
                      <div id="power-allocation-image" class="cell image-cell">
                        <img src=${getBase64Data(base64Images.HomeNormal)} />
                      </div>
                      <div id="power-allocation-info" class="cell text-cell">${allocated_info}</div>
                    `
                  : html`
                      <div class="cell">
                        ${['left', 'both'].includes(refresh_button_location) ? refresh_button_left : nothing}
                      </div>
                      <div id="home-info" class="cell text-cell">${consumption_info}</div>
                      <div id="home-image" class="cell image-cell">
                        <img src=${getBase64Data(base64Images.HomeNormal)} />
                      </div>
                      <div class="cell"></div>
                      <div class="cell"></div>
                      <div class="cell"></div>
                    `
              }
            </div>
            <div class="update-time">${updated_time_battery_runtime}</div>
          </card-content>
        </div>
      </ha-card>
    `;
  }
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: CARD_NAME,
  name: CARD_FULL_NAME,
  description: 'Power-distribution card based on the LuxpowerTek UI',
  preview: true,
});
