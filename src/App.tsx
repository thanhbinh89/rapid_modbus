import { useEffect, useRef, useState } from 'react';
import { downloadText, timestampSuffix } from './lib/csv';
import { buildReport } from './lib/report';
import { WorkspaceError, parseWorkspace, serializeWorkspace } from './lib/workspace';
import { useAppStore } from './store/appStore';
import type { Definition } from './store/types';
import { ConnectionBar } from './ui/ConnectionBar';
import { DefinitionDialog } from './ui/DefinitionDialog';
import { DefinitionTabs } from './ui/DefinitionTabs';
import { ProfileDialog } from './ui/ProfileDialog';
import { ScanDialog } from './ui/ScanDialog';
import { StatusBar } from './ui/StatusBar';
import { TrafficPanel } from './ui/TrafficPanel';
import { UpdatePrompt } from './ui/UpdatePrompt';
import { ValueGrid } from './ui/ValueGrid';
import { Banner, Button } from './ui/primitives';

export default function App() {
  const unsupported = useAppStore((s) => s.unsupportedReason);
  const connectionError = useAppStore((s) => s.connectionError);
  const definitions = useAppStore((s) => s.definitions);
  const activeId = useAppStore((s) => s.activeId);
  const theme = useAppStore((s) => s.theme);

  const [editing, setEditing] = useState<Definition | null>(null);
  const [scanning, setScanning] = useState(false);
  const [profiling, setProfiling] = useState(false);
  const [trafficOpen, setTrafficOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void useAppStore.getState().init();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const active = definitions.find((definition) => definition.id === activeId) ?? null;

  const importWorkspace = async (file: File) => {
    setImportError(null);
    try {
      const workspace = parseWorkspace(await file.text());
      await useAppStore.getState().applyWorkspace(workspace);
    } catch (error) {
      setImportError(
        error instanceof WorkspaceError ? error.message : `Could not read that file: ${error}`,
      );
    }
  };

  return (
    <div className="flex h-full flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-700">
        <h1 className="text-sm font-semibold tracking-tight">
          rapid<span className="text-sky-600 dark:text-sky-400">_modbus</span>
        </h1>
        <span className="text-xs text-zinc-400">Modbus RTU/ASCII master over Web Serial</span>

        <div className="ml-auto flex items-center gap-2">
          <Button onClick={() => setScanning(true)}>Scan…</Button>
          <Button onClick={() => setProfiling(true)}>Profile…</Button>
          <Button
            title="Config, totals, values and the hex log in one file"
            onClick={() => {
              const s = useAppStore.getState();
              downloadText(
                `diagnostic-${timestampSuffix()}.txt`,
                buildReport({
                  settings: s.settings,
                  mode: s.mode,
                  master: s.masterOptions,
                  stats: s.stats,
                  plcBase1: s.plcBase1,
                  definitions: s.definitions,
                  states: s.states,
                  traffic: s.traffic,
                }),
              );
            }}
          >
            Report
          </Button>
          <Button
            onClick={() =>
              downloadText(
                `workspace-${timestampSuffix()}.json`,
                serializeWorkspace(useAppStore.getState().currentWorkspace()),
                'application/json',
              )
            }
          >
            Save
          </Button>
          <Button onClick={() => fileInput.current?.click()}>Load</Button>
          <Button variant="ghost" onClick={() => useAppStore.getState().toggleTheme()}>
            {theme === 'dark' ? '☀' : '☾'}
          </Button>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importWorkspace(file);
            event.target.value = '';
          }}
        />
      </header>

      {unsupported && (
        <div className="p-3">
          <Banner tone="error">
            <div className="font-medium">Web Serial is not available</div>
            <div className="mt-1">{unsupported}</div>
          </Banner>
        </div>
      )}

      {!unsupported && <ConnectionBar />}

      {(connectionError || importError) && (
        <div className="px-3 pt-2">
          <Banner tone="error">{connectionError ?? importError}</Banner>
        </div>
      )}

      <DefinitionTabs onEdit={setEditing} />

      <div className="flex min-h-0 flex-1 flex-col">
        {active ? (
          <>
            <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-700">
              <span>
                Slave <strong className="text-zinc-800 dark:text-zinc-200">{active.slaveId}</strong>
              </span>
              <span>
                FC{' '}
                <strong className="text-zinc-800 dark:text-zinc-200">
                  {String(active.fc).padStart(2, '0')}
                </strong>
              </span>
              <span>
                Qty <strong className="text-zinc-800 dark:text-zinc-200">{active.quantity}</strong>
              </span>
              <span>
                Scan{' '}
                <strong className="text-zinc-800 dark:text-zinc-200">
                  {active.scanRateMs} ms
                </strong>
              </span>
              {!active.enabled && <span className="text-amber-600">disabled</span>}
              <Button variant="ghost" onClick={() => setEditing(active)}>
                Edit…
              </Button>
            </div>
            <ValueGrid definition={active} />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
            No definitions. Use + to add one.
          </div>
        )}
      </div>

      {trafficOpen && <TrafficPanel onClose={() => setTrafficOpen(false)} />}

      <StatusBar trafficOpen={trafficOpen} onToggleTraffic={() => setTrafficOpen((v) => !v)} />

      {editing && <DefinitionDialog definition={editing} onClose={() => setEditing(null)} />}
      {scanning && <ScanDialog onClose={() => setScanning(false)} />}
      {profiling && <ProfileDialog definition={active} onClose={() => setProfiling(false)} />}
      <UpdatePrompt />
    </div>
  );
}
