import { useRef, useState } from 'react';
import { DEFAULT_MASTER_OPTIONS, ModbusMaster } from '../core/master';
import type { MasterOpener, ScanProgress } from '../core/scanner';
import {
  AUTO_DETECT_BAUD_RATES,
  AUTO_DETECT_PARITIES,
  addressScanToCsv,
  autoDetect,
  scanAddresses,
  scanSlaveIds,
} from '../core/scanner';
import { exceptionText } from '../protocol/errors';
import { downloadText, timestampSuffix } from '../lib/csv';
import { useAppStore } from '../store/appStore';
import { WebSerialLink } from '../transport/webSerial';
import type { SerialSettings } from '../transport/link';
import { Banner, Button, Field, Modal, NumberInput } from './primitives';

type Tab = 'slave' | 'address' | 'auto';

export function ScanDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('slave');

  return (
    <Modal title="Scan" onClose={onClose} wide footer={<Button onClick={onClose}>Close</Button>}>
      <div className="mb-3 flex gap-1 border-b border-zinc-200 dark:border-zinc-700">
        <TabButton active={tab === 'slave'} onClick={() => setTab('slave')}>
          Slave ID scan
        </TabButton>
        <TabButton active={tab === 'address'} onClick={() => setTab('address')}>
          Address scan
        </TabButton>
        <TabButton active={tab === 'auto'} onClick={() => setTab('auto')}>
          Auto-detect
        </TabButton>
      </div>

      {tab === 'slave' && <SlaveScan />}
      {tab === 'address' && <AddressScan />}
      {tab === 'auto' && <AutoDetect onApplied={onClose} />}
    </Modal>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
        active
          ? 'border-sky-500 text-sky-600 dark:text-sky-400'
          : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  );
}

function useScanRun() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const abort = useRef<AbortController | null>(null);

  const start = async (work: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setProgress(null);
    try {
      await work(controller.signal);
    } finally {
      setRunning(false);
      abort.current = null;
    }
  };

  return { running, progress, setProgress, start, cancel: () => abort.current?.abort() };
}

function ProgressLine({ progress }: { progress: ScanProgress | null }) {
  if (!progress) return null;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-zinc-500">
        <span className="tabular">{progress.label}</span>
        <span className="tabular">
          {progress.done}/{progress.total}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
        <div className="h-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SlaveScan() {
  const connected = useAppStore((s) => s.status === 'connected');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(32);
  const [hits, setHits] = useState<Array<{ slaveId: number; note: string }>>([]);
  const run = useScanRun();

  const go = () =>
    void run.start(async (signal) => {
      setHits([]);
      const master = useAppStore.getState().master;
      if (!master) return;
      await scanSlaveIds(master, {
        from,
        to,
        signal,
        onProgress: run.setProgress,
        onHit: (hit) =>
          setHits((current) => [
            ...current,
            {
              slaveId: hit.slaveId,
              note:
                hit.via === 'data'
                  ? 'responded with data'
                  : `responded with exception ${hit.exceptionCode} (${exceptionText(hit.exceptionCode ?? 0)})`,
            },
          ]),
      });
    });

  return (
    <div className="space-y-3">
      {!connected && <Banner tone="warn">Connect to a port first.</Banner>}

      <div className="flex items-end gap-3">
        <Field label="From ID">
          <NumberInput value={from} min={1} max={247} onChange={setFrom} className="w-20" />
        </Field>
        <Field label="To ID">
          <NumberInput value={to} min={1} max={247} onChange={setTo} className="w-20" />
        </Field>
        {run.running ? (
          <Button variant="danger" onClick={run.cancel}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" disabled={!connected} onClick={go}>
            Scan
          </Button>
        )}
      </div>

      <ProgressLine progress={run.progress} />

      <Banner tone="info">
        A device that replies with an <em>exception</em> is still present — it is listening and
        simply lacks that register. Only silence means nothing is there.
      </Banner>

      <ResultList
        empty={run.running ? 'Scanning…' : 'No devices found yet.'}
        items={hits.map((hit) => ({
          key: hit.slaveId,
          primary: `Slave ${hit.slaveId}`,
          secondary: hit.note,
        }))}
      />
    </div>
  );
}

function AddressScan() {
  const connected = useAppStore((s) => s.status === 'connected');
  const definitions = useAppStore((s) => s.definitions);
  const activeId = useAppStore((s) => s.activeId);
  const active = definitions.find((d) => d.id === activeId);

  const [slaveId, setSlaveId] = useState(active?.slaveId ?? 1);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(127);
  const [hits, setHits] = useState<Array<{ address: number; text: string }>>([]);
  const csv = useRef('');
  const run = useScanRun();

  const go = () =>
    void run.start(async (signal) => {
      setHits([]);
      const master = useAppStore.getState().master;
      if (!master) return;
      const found = await scanAddresses(master, {
        slaveId,
        from,
        to,
        signal,
        onProgress: run.setProgress,
        onHit: (hit) =>
          setHits((current) => [
            ...current,
            {
              address: hit.address,
              text: hit.result.kind === 'echo' ? String(hit.result.value) : hit.result.values.join(', '),
            },
          ]),
      });
      csv.current = addressScanToCsv(found);
    });

  return (
    <div className="space-y-3">
      {!connected && <Banner tone="warn">Connect to a port first.</Banner>}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Slave ID">
          <NumberInput value={slaveId} min={1} max={247} onChange={setSlaveId} className="w-20" />
        </Field>
        <Field label="From">
          <NumberInput value={from} min={0} max={65535} onChange={setFrom} className="w-24" />
        </Field>
        <Field label="To">
          <NumberInput value={to} min={0} max={65535} onChange={setTo} className="w-24" />
        </Field>
        {run.running ? (
          <Button variant="danger" onClick={run.cancel}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" disabled={!connected} onClick={go}>
            Scan
          </Button>
        )}
        <Button
          disabled={hits.length === 0}
          onClick={() =>
            downloadText(`address-scan-${timestampSuffix()}.csv`, csv.current, 'text/csv')
          }
        >
          Export CSV
        </Button>
      </div>

      <ProgressLine progress={run.progress} />

      <ResultList
        empty={run.running ? 'Scanning…' : 'No readable addresses found yet.'}
        items={hits.map((hit) => ({
          key: hit.address,
          primary: String(hit.address),
          secondary: hit.text,
        }))}
      />
    </div>
  );
}

function AutoDetect({ onApplied }: { onApplied: () => void }) {
  const port = useAppStore((s) => s.port);
  const [hits, setHits] = useState<
    Array<{ key: string; settings: SerialSettings; slaveId: number; note: string }>
  >([]);
  const run = useScanRun();

  const go = () =>
    void run.start(async (signal) => {
      setHits([]);
      // The port can only be open once, and each candidate needs its own
      // baud rate, so the live session has to be torn down first.
      await useAppStore.getState().disconnect();
      const current = useAppStore.getState().port;
      if (!current) return;

      const open: MasterOpener = async (settings, mode) => {
        const link = await WebSerialLink.open(current, settings);
        const master = new ModbusMaster(link, {
          ...DEFAULT_MASTER_OPTIONS,
          mode,
          responseTimeoutMs: 150,
          interFrameDelayMs: 0,
        });
        return {
          master,
          close: async () => {
            master.stop();
            await link.close();
          },
        };
      };

      await autoDetect(open, {
        signal,
        onProgress: run.setProgress,
        onHit: (hit) =>
          setHits((current2) => [
            ...current2,
            {
              key: `${hit.settings.baudRate}-${hit.settings.parity}-${hit.slaveId}`,
              settings: hit.settings,
              slaveId: hit.slaveId,
              note: hit.via === 'data' ? 'data' : 'exception',
            },
          ]),
      });
    });

  const apply = async (settings: SerialSettings, slaveId: number) => {
    const store = useAppStore.getState();
    store.setSettings(settings);
    const active = store.definitions.find((d) => d.id === store.activeId);
    if (active) store.updateDefinition(active.id, { slaveId });
    await store.connect();
    onApplied();
  };

  return (
    <div className="space-y-3">
      <Banner tone="info">
        Sweeps {AUTO_DETECT_BAUD_RATES.length} baud rates × {AUTO_DETECT_PARITIES.length} parities ×
        slave IDs 1–32 looking for anything that answers. Use this when the datasheet is missing or
        somebody changed the settings. This disconnects the current session.
      </Banner>

      {!port && <Banner tone="warn">Choose a serial port first.</Banner>}

      <div className="flex items-end gap-3">
        {run.running ? (
          <Button variant="danger" onClick={run.cancel}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" disabled={!port} onClick={go}>
            Start sweep
          </Button>
        )}
        {run.running && (
          <span className="text-xs text-zinc-500">
            This takes a few minutes. Found devices appear as they are detected.
          </span>
        )}
      </div>

      <ProgressLine progress={run.progress} />

      {hits.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-300 py-6 text-center text-sm text-zinc-400 dark:border-zinc-700">
          {run.running ? 'Sweeping…' : 'Nothing found yet.'}
        </div>
      ) : (
        <div className="divide-y divide-zinc-200 rounded border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
          {hits.map((hit) => (
            <div key={hit.key} className="flex items-center gap-3 px-3 py-2">
              <span className="tabular text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {hit.settings.baudRate} {hit.settings.parity} 8-{hit.settings.stopBits}
              </span>
              <span className="tabular text-sm text-zinc-600 dark:text-zinc-400">
                slave {hit.slaveId}
              </span>
              <span className="text-xs text-zinc-400">({hit.note})</span>
              <div className="ml-auto">
                <Button
                  variant="primary"
                  disabled={run.running}
                  onClick={() => void apply(hit.settings, hit.slaveId)}
                >
                  Use these
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultList({
  items,
  empty,
}: {
  items: Array<{ key: number | string; primary: string; secondary: string }>;
  empty: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded border border-dashed border-zinc-300 py-6 text-center text-sm text-zinc-400 dark:border-zinc-700">
        {empty}
      </div>
    );
  }
  return (
    <div className="max-h-64 divide-y divide-zinc-200 overflow-auto rounded border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
      {items.map((item) => (
        <div key={item.key} className="flex gap-3 px-3 py-1.5 text-sm">
          <span className="tabular w-24 font-medium text-zinc-900 dark:text-zinc-100">
            {item.primary}
          </span>
          <span className="tabular text-zinc-600 dark:text-zinc-400">{item.secondary}</span>
        </div>
      ))}
    </div>
  );
}
