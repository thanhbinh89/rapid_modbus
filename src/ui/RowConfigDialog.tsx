import { useState } from 'react';
import { formatNumber } from '../lib/number';
import { formatAddress } from '../lib/plcAddress';
import type { GridRow } from '../lib/rows';
import { applyScaling } from '../lib/rows';
import { useAppStore } from '../store/appStore';
import type { Definition } from '../store/types';
import { Banner, Button, Field, Modal, TextInput } from './primitives';

/**
 * Per-row scaling and unit.
 *
 * Devices report engineering values as integers — 2314 for 231.4 V — and a
 * factor plus a unit is what turns that back into something readable. The
 * preview shows the current reading through the proposed scaling so a wrong
 * factor is obvious before it is applied.
 */
export function RowConfigDialog({
  definition,
  row,
  onClose,
}: {
  definition: Definition;
  row: GridRow;
  onClose: () => void;
}) {
  const plcBase1 = useAppStore((s) => s.plcBase1);

  const [factor, setFactor] = useState(String(row.scaling?.factor ?? 1));
  const [offset, setOffset] = useState(String(row.scaling?.offset ?? 0));
  const [unit, setUnit] = useState(row.unit);

  const factorValue = Number(factor);
  const offsetValue = Number(offset);
  const factorBad = !Number.isFinite(factorValue) || factorValue === 0;
  const offsetBad = !Number.isFinite(offsetValue);

  const raw = row.decoded?.numeric ?? null;
  const preview =
    raw === null || factorBad || offsetBad
      ? null
      : applyScaling(raw, { factor: factorValue, offset: offsetValue });

  const apply = () => {
    if (factorBad || offsetBad) return;
    const identity = factorValue === 1 && offsetValue === 0;
    useAppStore.getState().setRowConfig(definition.id, row.offset, {
      scaling: identity ? undefined : { factor: factorValue, offset: offsetValue },
      unit: unit.trim() || undefined,
    });
    onClose();
  };

  return (
    <Modal
      title="Scaling and unit"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply} disabled={factorBad || offsetBad}>
            Apply
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">
          <span className="text-zinc-500">Address </span>
          <span className="tabular font-medium text-zinc-900 dark:text-zinc-100">
            {formatAddress(definition.fc, row.address, plcBase1)}
          </span>
          {row.name && <span className="ml-2 text-zinc-500">{row.name}</span>}
        </div>

        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          Engineering value = <span className="tabular">factor × raw + offset</span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Factor">
            <TextInput value={factor} onChange={setFactor} className="tabular w-full" autoFocus />
          </Field>
          <Field label="Offset">
            <TextInput value={offset} onChange={setOffset} className="tabular w-full" />
          </Field>
          <Field label="Unit">
            <TextInput value={unit} onChange={setUnit} placeholder="V" className="w-full" />
          </Field>
        </div>

        {factorBad && (
          <Banner tone="error">
            Factor must be a non-zero number. A zero factor would flatten every reading to a
            constant.
          </Banner>
        )}
        {offsetBad && <Banner tone="error">Offset must be a number.</Banner>}

        {preview !== null && raw !== null && (
          <div className="rounded bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">
            <span className="text-zinc-500">Preview </span>
            <span className="tabular text-zinc-600 dark:text-zinc-400">{formatNumber(raw)}</span>
            <span className="mx-2 text-zinc-400">→</span>
            <span className="tabular font-medium text-zinc-900 dark:text-zinc-100">
              {formatNumber(preview)}
              {unit.trim() && ` ${unit.trim()}`}
            </span>
          </div>
        )}
        {raw === null && (
          <div className="text-xs text-zinc-400">Poll the device to see a live preview.</div>
        )}
      </div>
    </Modal>
  );
}
