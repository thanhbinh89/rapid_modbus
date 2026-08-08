import { useAppStore } from '../store/appStore';

export function StatusBar({
  trafficOpen,
  onToggleTraffic,
}: {
  trafficOpen: boolean;
  onToggleTraffic: () => void;
}) {
  const stats = useAppStore((s) => s.stats);
  const status = useAppStore((s) => s.status);
  const polling = useAppStore((s) => s.polling);

  return (
    <div className="flex items-center gap-4 border-t border-zinc-200 bg-zinc-50 px-3 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900">
      <span className="flex items-center gap-1.5">
        <span
          className={`h-2 w-2 rounded-full ${
            status === 'connected'
              ? polling
                ? 'animate-pulse bg-emerald-500'
                : 'bg-emerald-500'
              : 'bg-zinc-400'
          }`}
        />
        <span className="text-zinc-600 dark:text-zinc-400">
          {status === 'connected' ? (polling ? 'Polling' : 'Connected') : 'Disconnected'}
        </span>
      </span>

      <Stat label="Tx" value={stats.tx} />
      <Stat label="Rx" value={stats.rx} />
      <Stat label="Err" value={stats.errors} tone={stats.errors > 0 ? 'bad' : undefined} />

      {stats.avgResponseMs !== null && (
        <span className="tabular text-zinc-500 dark:text-zinc-400">
          response {fmt(stats.minResponseMs)} / {fmt(stats.avgResponseMs)} /{' '}
          {fmt(stats.maxResponseMs)} ms
          <span className="ml-1 text-zinc-400">(min/avg/max)</span>
        </span>
      )}

      <button
        type="button"
        onClick={() => useAppStore.getState().resetStats()}
        className="text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        reset
      </button>

      <button
        type="button"
        onClick={onToggleTraffic}
        className="ml-auto text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-300"
      >
        {trafficOpen ? 'Hide traffic' : 'Show traffic'}
      </button>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'bad' }) {
  return (
    <span className="tabular">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>{' '}
      <span
        className={
          tone === 'bad'
            ? 'font-semibold text-red-600 dark:text-red-400'
            : 'font-medium text-zinc-800 dark:text-zinc-200'
        }
      >
        {value}
      </span>
    </span>
  );
}

function fmt(value: number | null): string {
  return value === null ? '—' : String(Math.round(value));
}
