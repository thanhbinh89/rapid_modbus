/**
 * Application state.
 *
 * The runtime objects (link, master, scheduler) live here too but are never
 * rendered from — they are handles, not view state.
 */

import { create } from 'zustand';
import { DEFAULT_MASTER_OPTIONS, ModbusMaster } from '../core/master';
import type { MasterOptions, MasterStats, SerialMode, TrafficEvent } from '../core/master';
import { PollScheduler } from '../core/scheduler';
import type { ReadFunctionCode } from '../core/scheduler';
import type { FormatId } from '../protocol/formats';
import { FC } from '../protocol/pdu';
import { DEFAULT_SERIAL_SETTINGS } from '../transport/link';
import type { SerialSettings } from '../transport/link';
import { WebSerialLink, requestPort, webSerialUnavailableReason } from '../transport/webSerial';
import { debounce, loadWorkspace, saveWorkspace } from '../lib/persistence';
import { buildWorkspace } from '../lib/workspace';
import type { Workspace } from '../lib/workspace';
import type { Definition, DefinitionState } from './types';
import { EMPTY_STATE, defaultDisplay } from './types';

/** Bounded so a session left running overnight cannot exhaust memory. */
const MAX_TRAFFIC_ENTRIES = 500;

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface TrafficEntry extends TrafficEvent {
  seq: number;
}

interface AppState {
  // Environment
  initialized: boolean;
  unsupportedReason: string | null;

  // Connection
  status: ConnectionStatus;
  connectionError: string | null;
  port: SerialPort | null;
  settings: SerialSettings;
  mode: SerialMode;
  masterOptions: MasterOptions;

  // Runtime handles — not view state.
  link: WebSerialLink | null;
  master: ModbusMaster | null;
  scheduler: PollScheduler | null;

  // Definitions
  definitions: Definition[];
  states: Record<string, DefinitionState>;
  activeId: string | null;

  // Diagnostics
  traffic: TrafficEntry[];
  trafficPaused: boolean;
  stats: MasterStats;
  polling: boolean;

  // Preferences
  plcBase1: boolean;
  theme: 'light' | 'dark';

  // Actions
  init: () => Promise<void>;
  setSettings: (settings: Partial<SerialSettings>) => void;
  setMode: (mode: SerialMode) => void;
  setMasterOptions: (options: Partial<MasterOptions>) => void;
  choosePort: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;

  addDefinition: () => void;
  updateDefinition: (id: string, patch: Partial<Definition>) => void;
  removeDefinition: (id: string) => void;
  setActive: (id: string) => void;
  setRowFormat: (id: string, offset: number, format: FormatId) => void;
  setDefaultFormat: (id: string, format: FormatId) => void;
  setRowName: (id: string, offset: number, name: string) => void;

  startPolling: () => void;
  stopPolling: () => Promise<void>;
  pollOnce: () => Promise<void>;
  writeRegisters: (slaveId: number, address: number, values: number[]) => Promise<void>;
  writeCoil: (slaveId: number, address: number, value: boolean) => Promise<void>;

  clearTraffic: () => void;
  toggleTrafficPaused: () => void;
  resetStats: () => void;

  togglePlcBase1: () => void;
  toggleTheme: () => void;

  applyWorkspace: (workspace: Workspace) => Promise<void>;
  currentWorkspace: () => Workspace;
}

const EMPTY_STATS: MasterStats = {
  tx: 0,
  rx: 0,
  errors: 0,
  lastResponseMs: null,
  minResponseMs: null,
  maxResponseMs: null,
  avgResponseMs: null,
};

let definitionCounter = 0;
let trafficCounter = 0;

function newDefinition(index: number): Definition {
  definitionCounter++;
  return {
    id: `def-${definitionCounter}-${Date.now().toString(36)}`,
    name: `Definition ${index + 1}`,
    slaveId: 1,
    fc: FC.READ_HOLDING_REGISTERS as ReadFunctionCode,
    address: 0,
    quantity: 10,
    scanRateMs: 1000,
    enabled: true,
    disableOnError: false,
    display: defaultDisplay(),
  };
}

export const useAppStore = create<AppState>((set, get) => {
  const persist = debounce(() => void saveWorkspace(get().currentWorkspace()), 400);

  /** Pushes the current definitions into a live scheduler. */
  const syncScheduler = () => {
    const { scheduler, definitions } = get();
    if (!scheduler) return;
    const ids = new Set(definitions.map((d) => d.id));
    for (const existing of scheduler.definitions) {
      if (!ids.has(existing.id)) scheduler.remove(existing.id);
    }
    for (const definition of definitions) scheduler.set(definition);
  };

  return {
    initialized: false,
    unsupportedReason: null,
    status: 'disconnected',
    connectionError: null,
    port: null,
    settings: { ...DEFAULT_SERIAL_SETTINGS },
    mode: 'rtu',
    masterOptions: { ...DEFAULT_MASTER_OPTIONS },

    link: null,
    master: null,
    scheduler: null,

    definitions: [],
    states: {},
    activeId: null,

    traffic: [],
    trafficPaused: false,
    stats: EMPTY_STATS,
    polling: false,

    plcBase1: true,
    theme: 'dark',

    async init() {
      // StrictMode runs mount effects twice in development; without this guard
      // the seeded definition is created twice.
      if (get().initialized) return;
      set({ initialized: true, unsupportedReason: webSerialUnavailableReason() });

      const restored = await loadWorkspace();
      if (restored && restored.definitions.length > 0) {
        set({
          settings: restored.connection.settings,
          mode: restored.connection.mode,
          masterOptions: restored.connection.master,
          plcBase1: restored.plcBase1,
          definitions: restored.definitions,
          states: Object.fromEntries(restored.definitions.map((d) => [d.id, { ...EMPTY_STATE }])),
          activeId: restored.definitions[0].id,
        });
      } else {
        get().addDefinition();
      }
    },

    setSettings(patch) {
      set((state) => ({ settings: { ...state.settings, ...patch } }));
      persist();
    },

    setMode(mode) {
      set({ mode });
      get().master?.setOptions({ mode });
      persist();
    },

    setMasterOptions(patch) {
      set((state) => ({ masterOptions: { ...state.masterOptions, ...patch } }));
      get().master?.setOptions(patch);
      persist();
    },

    async choosePort() {
      try {
        const port = await requestPort();
        set({ port, connectionError: null });
      } catch (error) {
        // The user dismissing the picker is not an error worth shouting about.
        if (error instanceof DOMException && error.name === 'NotFoundError') return;
        set({ connectionError: describeError(error) });
      }
    },

    async connect() {
      const { port, settings, mode, masterOptions } = get();
      if (!port) {
        set({ connectionError: 'Choose a serial port first.' });
        return;
      }

      set({ status: 'connecting', connectionError: null });
      try {
        const link = await WebSerialLink.open(port, settings);
        const master = new ModbusMaster(link, { ...masterOptions, mode }, (event) => {
          const state = get();
          if (!state.trafficPaused) {
            const entry: TrafficEntry = { ...event, seq: ++trafficCounter };
            const traffic = [...state.traffic, entry];
            if (traffic.length > MAX_TRAFFIC_ENTRIES) {
              traffic.splice(0, traffic.length - MAX_TRAFFIC_ENTRIES);
            }
            set({ traffic });
          }
          set({ stats: master.stats });
        });

        const scheduler = new PollScheduler(master, (update) => {
          set((state) => ({
            states: {
              ...state.states,
              [update.definitionId]: {
                values:
                  update.result && update.result.kind !== 'echo'
                    ? update.result.values
                    : (state.states[update.definitionId]?.values ?? null),
                error: update.error,
                at: update.at,
                consecutiveErrors: update.consecutiveErrors,
              },
            },
            // disableOnError flips the flag inside the scheduler; mirror it.
            definitions: state.definitions.map((definition) =>
              definition.id === update.definitionId && update.error && definition.disableOnError
                ? { ...definition, enabled: false }
                : definition,
            ),
          }));
        });

        set({ link, master, scheduler, status: 'connected' });
        syncScheduler();
      } catch (error) {
        set({ status: 'disconnected', connectionError: describeError(error) });
      }
    },

    async disconnect() {
      const { scheduler, master, link } = get();
      await scheduler?.stop();
      master?.stop();
      await link?.close();
      set({
        scheduler: null,
        master: null,
        link: null,
        status: 'disconnected',
        polling: false,
      });
    },

    addDefinition() {
      set((state) => {
        const definition = newDefinition(state.definitions.length);
        return {
          definitions: [...state.definitions, definition],
          states: { ...state.states, [definition.id]: { ...EMPTY_STATE } },
          activeId: definition.id,
        };
      });
      syncScheduler();
      persist();
    },

    updateDefinition(id, patch) {
      set((state) => ({
        definitions: state.definitions.map((definition) =>
          definition.id === id ? { ...definition, ...patch } : definition,
        ),
        // Changing what is read invalidates whatever is on screen.
        states:
          patch.address !== undefined || patch.quantity !== undefined || patch.fc !== undefined
            ? { ...state.states, [id]: { ...EMPTY_STATE } }
            : state.states,
      }));
      syncScheduler();
      persist();
    },

    removeDefinition(id) {
      get().scheduler?.remove(id);
      set((state) => {
        const definitions = state.definitions.filter((definition) => definition.id !== id);
        const states = { ...state.states };
        delete states[id];
        return {
          definitions,
          states,
          activeId: state.activeId === id ? (definitions[0]?.id ?? null) : state.activeId,
        };
      });
      persist();
    },

    setActive(id) {
      set({ activeId: id });
    },

    setRowFormat(id, offset, format) {
      set((state) => ({
        definitions: state.definitions.map((definition) =>
          definition.id === id
            ? {
                ...definition,
                display: {
                  ...definition.display,
                  formats: { ...definition.display.formats, [offset]: format },
                },
              }
            : definition,
        ),
      }));
      persist();
    },

    setDefaultFormat(id, format) {
      set((state) => ({
        definitions: state.definitions.map((definition) =>
          definition.id === id
            ? {
                ...definition,
                // A new default replaces per-row overrides, which is what
                // "apply this format to the whole window" has to mean.
                display: { ...definition.display, defaultFormat: format, formats: {} },
              }
            : definition,
        ),
      }));
      persist();
    },

    setRowName(id, offset, name) {
      set((state) => ({
        definitions: state.definitions.map((definition) =>
          definition.id === id
            ? {
                ...definition,
                display: {
                  ...definition.display,
                  names: { ...definition.display.names, [offset]: name },
                },
              }
            : definition,
        ),
      }));
      persist();
    },

    startPolling() {
      const { scheduler } = get();
      if (!scheduler) return;
      syncScheduler();
      scheduler.start();
      set({ polling: true });
    },

    async stopPolling() {
      await get().scheduler?.stop();
      set({ polling: false });
    },

    async pollOnce() {
      const { scheduler } = get();
      if (!scheduler) return;
      syncScheduler();
      await scheduler.pollOnce();
    },

    async writeRegisters(slaveId, address, values) {
      const { master } = get();
      if (!master) throw new Error('Not connected.');
      if (values.length === 1) {
        await master.execute({
          fc: FC.WRITE_SINGLE_REGISTER,
          slaveId,
          address,
          value: values[0],
        });
      } else {
        await master.execute({ fc: FC.WRITE_MULTIPLE_REGISTERS, slaveId, address, values });
      }
    },

    async writeCoil(slaveId, address, value) {
      const { master } = get();
      if (!master) throw new Error('Not connected.');
      await master.execute({ fc: FC.WRITE_SINGLE_COIL, slaveId, address, value });
    },

    clearTraffic() {
      set({ traffic: [] });
    },

    toggleTrafficPaused() {
      set((state) => ({ trafficPaused: !state.trafficPaused }));
    },

    resetStats() {
      get().master?.resetStats();
      set({ stats: EMPTY_STATS });
    },

    togglePlcBase1() {
      set((state) => ({ plcBase1: !state.plcBase1 }));
      persist();
    },

    toggleTheme() {
      set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' }));
    },

    async applyWorkspace(workspace) {
      await get().stopPolling();
      get().scheduler?.clear();
      set({
        settings: workspace.connection.settings,
        mode: workspace.connection.mode,
        masterOptions: workspace.connection.master,
        plcBase1: workspace.plcBase1,
        definitions: workspace.definitions,
        states: Object.fromEntries(workspace.definitions.map((d) => [d.id, { ...EMPTY_STATE }])),
        activeId: workspace.definitions[0]?.id ?? null,
      });
      get().master?.setOptions({ ...workspace.connection.master, mode: workspace.connection.mode });
      syncScheduler();
      persist();
    },

    currentWorkspace() {
      const { settings, mode, masterOptions, definitions, plcBase1 } = get();
      return buildWorkspace({ settings, mode, master: masterOptions }, definitions, plcBase1);
    },
  };
});

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
