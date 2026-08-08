import { useEffect, useRef } from 'react';
import { downloadText, timestampSuffix } from '../lib/csv';
import { useAppStore } from '../store/appStore';
import { clockTime, hex } from './format';
import { Button } from './primitives';

/**
 * The hex dump. When a device will not answer, this is the first place an
 * engineer looks — so it shows exactly what went out and what came back,
 * including the partial bytes captured before a timeout.
 */
export function TrafficPanel({ onClose }: { onClose: () => void }) {
  const traffic = useAppStore((s) => s.traffic);
  const paused = useAppStore((s) => s.trafficPaused);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    if (pinned.current && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [traffic]);

  return (
    <div className="flex h-56 flex-col border-t border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-700">
        <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
          Communication traffic
        </span>
        <span className="text-xs text-zinc-400">{traffic.length} entries</span>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => useAppStore.getState().toggleTrafficPaused()}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button onClick={() => useAppStore.getState().clearTraffic()}>Clear</Button>
          <Button
            onClick={() =>
              downloadText(`traffic-${timestampSuffix()}.txt`, traffic.map(lineOf).join('\n'))
            }
          >
            Save
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Hide
          </Button>
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="tabular min-h-0 flex-1 overflow-auto px-3 py-1 text-xs leading-5"
      >
        {traffic.length === 0 ? (
          <div className="py-4 text-center text-zinc-400">
            Nothing yet. Connect and start polling.
          </div>
        ) : (
          traffic.map((entry) => (
            <div key={entry.seq} className="flex gap-2 whitespace-nowrap">
              <span className="text-zinc-400">{clockTime(entry.at)}</span>
              <span
                className={
                  entry.direction === 'tx'
                    ? 'w-6 font-semibold text-sky-600 dark:text-sky-400'
                    : 'w-6 font-semibold text-emerald-600 dark:text-emerald-400'
                }
              >
                {entry.direction === 'tx' ? 'Tx' : 'Rx'}
              </span>
              <span
                className={
                  entry.error
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-zinc-700 dark:text-zinc-300'
                }
              >
                {entry.bytes.length > 0 ? hex(entry.bytes) : '(no data)'}
              </span>
              {entry.error && (
                <span className="text-red-500 dark:text-red-400">— {entry.error}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function lineOf(entry: { at: number; direction: string; bytes: Uint8Array; error?: string }) {
  const body = entry.bytes.length > 0 ? hex(entry.bytes) : '(no data)';
  const suffix = entry.error ? `  -- ${entry.error}` : '';
  return `${clockTime(entry.at)}  ${entry.direction.toUpperCase()}  ${body}${suffix}`;
}
