import { useState } from 'react';
import { FORMATS, WORD_ORDERS, getFormat } from '../protocol/formats';
import type { FormatId, WordOrder } from '../protocol/formats';
import { definitionToCsv, downloadText, timestampSuffix } from '../lib/csv';
import { formatAddress } from '../lib/plcAddress';
import { buildRows } from '../lib/rows';
import type { GridRow } from '../lib/rows';
import { useAppStore } from '../store/appStore';
import { EMPTY_STATE, isIdentityScaling } from '../store/types';
import type { Definition } from '../store/types';
import { DisplayDialog } from './DisplayDialog';
import { COLOR_CLASSES } from './format';
import { RowConfigDialog } from './RowConfigDialog';
import { Banner, Button, Select } from './primitives';
import { WriteDialog } from './WriteDialog';

const FORMAT_OPTIONS = FORMATS.map((format) => ({ value: format.id, label: format.label }));

export function ValueGrid({ definition }: { definition: Definition }) {
  const state = useAppStore((s) => s.states[definition.id]) ?? EMPTY_STATE;
  const plcBase1 = useAppStore((s) => s.plcBase1);
  const connected = useAppStore((s) => s.status === 'connected');

  const [writing, setWriting] = useState<GridRow | null>(null);
  const [configuring, setConfiguring] = useState<GridRow | null>(null);
  const [displayRules, setDisplayRules] = useState(false);

  const rows = buildRows(definition, state);
  const defaultSpec = getFormat(definition.display.defaultFormat);
  const writable = definition.fc === 3 || definition.fc === 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-700">
        <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
          Format
        </span>
        <Select
          value={definition.display.defaultFormat}
          onChange={(value) =>
            useAppStore.getState().setDefaultFormat(definition.id, value as FormatId)
          }
          options={FORMAT_OPTIONS}
          className="w-64"
        />

        {defaultSpec.order && (
          <div className="flex items-center gap-1">
            <span
              className="text-[11px] text-zinc-500"
              title="Word order is the usual reason a float reads as garbage — flip through these."
            >
              order
            </span>
            {WORD_ORDERS.map((order) => (
              <WordOrderButton
                key={order}
                order={order}
                active={defaultSpec.order === order}
                onClick={() => {
                  const kind = definition.display.defaultFormat.split('_')[0];
                  useAppStore
                    .getState()
                    .setDefaultFormat(definition.id, `${kind}_${order}` as FormatId);
                }}
              />
            ))}
          </div>
        )}

        <Button onClick={() => setDisplayRules(true)}>Display rules…</Button>

        <div className="ml-auto flex items-center gap-2">
          <LastPolled at={state.at} />
          <Button
            onClick={() =>
              downloadText(
                `${slug(definition.name)}-${timestampSuffix()}.csv`,
                definitionToCsv(definition, rows, plcBase1),
                'text/csv',
              )
            }
          >
            Export CSV
          </Button>
        </div>
      </div>

      {state.error && (
        <div className="px-3 pt-2">
          <Banner tone={state.error.exceptionCode !== undefined ? 'warn' : 'error'}>
            <div className="font-medium">{state.error.message}</div>
            {state.error.hint && <div className="mt-0.5 opacity-90">{state.error.hint}</div>}
            {state.consecutiveErrors > 1 && (
              <div className="mt-0.5 text-xs opacity-75">
                {state.consecutiveErrors} consecutive failures
              </div>
            )}
          </Banner>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800">
            <tr className="text-left text-[11px] tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              <th className="w-28 px-3 py-1.5 font-medium">Address</th>
              <th className="w-56 px-3 py-1.5 font-medium">Name</th>
              <th className="px-3 py-1.5 font-medium">Value</th>
              <th className="w-52 px-3 py-1.5 font-medium">Format</th>
              <th className="w-10 px-1 py-1.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row
                key={row.offset}
                definition={definition}
                row={row}
                plcBase1={plcBase1}
                canWrite={connected && writable}
                onWrite={() => setWriting(row)}
                onConfigure={() => setConfiguring(row)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {writing && (
        <WriteDialog definition={definition} row={writing} onClose={() => setWriting(null)} />
      )}
      {configuring && (
        <RowConfigDialog
          definition={definition}
          row={configuring}
          onClose={() => setConfiguring(null)}
        />
      )}
      {displayRules && (
        <DisplayDialog definition={definition} onClose={() => setDisplayRules(false)} />
      )}
    </div>
  );
}

function Row({
  definition,
  row,
  plcBase1,
  canWrite,
  onWrite,
  onConfigure,
}: {
  definition: Definition;
  row: GridRow;
  plcBase1: boolean;
  canWrite: boolean;
  onWrite: () => void;
  onConfigure: () => void;
}) {
  const scaled = !isIdentityScaling(row.scaling);

  return (
    <tr className="border-b border-zinc-100 hover:bg-sky-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60">
      <td className="tabular px-3 py-1 text-zinc-500 dark:text-zinc-400">
        {formatAddress(definition.fc, row.address, plcBase1)}
      </td>
      <td className="px-3 py-0.5">
        <input
          value={row.name}
          placeholder="—"
          onChange={(event) =>
            useAppStore
              .getState()
              .setRowConfig(definition.id, row.offset, { name: event.target.value })
          }
          className="w-full rounded bg-transparent px-1 py-0.5 text-zinc-700 outline-none placeholder:text-zinc-400 focus:bg-white focus:ring-1 focus:ring-sky-500 dark:text-zinc-300 dark:focus:bg-zinc-800"
        />
      </td>
      <td
        onDoubleClick={canWrite ? onWrite : undefined}
        title={
          canWrite
            ? scaled
              ? `Raw ${row.decoded?.text ?? '—'} — double-click to write`
              : 'Double-click to write'
            : scaled
              ? `Raw ${row.decoded?.text ?? '—'}`
              : undefined
        }
        className={`px-3 py-1 ${canWrite ? 'cursor-cell' : ''}`}
      >
        <span
          className={`tabular rounded px-1.5 py-0.5 font-medium ${
            row.color
              ? COLOR_CLASSES[row.color]
              : row.decoded
                ? 'text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-400 dark:text-zinc-600'
          }`}
        >
          {row.text || '—'}
        </span>
      </td>
      <td className="px-3 py-0.5">
        <Select
          value={row.format}
          onChange={(value) =>
            useAppStore
              .getState()
              .setRowConfig(definition.id, row.offset, { format: value as FormatId })
          }
          options={FORMAT_OPTIONS}
          className="w-full text-xs"
        />
      </td>
      <td className="px-1 py-0.5 text-center">
        <button
          type="button"
          onClick={onConfigure}
          title={
            scaled
              ? `Scaled by ${row.scaling?.factor}${row.scaling?.offset ? ` + ${row.scaling.offset}` : ''}`
              : 'Set scaling and unit'
          }
          className={`rounded px-1.5 py-0.5 text-xs ${
            scaled || row.unit
              ? 'font-medium text-sky-600 dark:text-sky-400'
              : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
          }`}
        >
          {scaled ? '×' : row.unit ? 'u' : '·'}
        </button>
      </td>
    </tr>
  );
}

function WordOrderButton({
  order,
  active,
  onClick,
}: {
  order: WordOrder;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tabular rounded px-1.5 py-0.5 text-xs font-medium ${
        active
          ? 'bg-sky-600 text-white'
          : 'bg-zinc-200 text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600'
      }`}
    >
      {order}
    </button>
  );
}

function LastPolled({ at }: { at: number | null }) {
  if (!at) return <span className="text-xs text-zinc-400">not polled</span>;
  return <span className="tabular text-xs text-zinc-500">{new Date(at).toLocaleTimeString()}</span>;
}

function slug(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
}
