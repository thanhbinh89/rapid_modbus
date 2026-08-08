import { useState } from 'react';
import { encode, getFormat } from '../protocol/formats';
import { formatAddress } from '../lib/plcAddress';
import type { GridRow } from '../lib/rows';
import { useAppStore } from '../store/appStore';
import type { Definition } from '../store/types';
import { Banner, Button, Field, Modal, Select, TextInput } from './primitives';

/**
 * Writing to a live device is the one irreversible thing this tool does, so
 * the dialog spells out exactly what will be sent — slave, address, function
 * and the encoded register words — before the operator commits.
 */
export function WriteDialog({
  definition,
  row,
  onClose,
}: {
  definition: Definition;
  row: GridRow;
  onClose: () => void;
}) {
  const plcBase1 = useAppStore((s) => s.plcBase1);
  const isCoil = definition.fc === 1;

  const [text, setText] = useState(row.decoded?.text ?? '');
  const [coilValue, setCoilValue] = useState(row.bit ? '1' : '0');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  let preview: number[] | null = null;
  let encodeError: string | null = null;
  if (!isCoil) {
    try {
      preview = encode(text, row.format);
    } catch (problem) {
      encodeError = problem instanceof Error ? problem.message : String(problem);
    }
  }

  const spec = getFormat(row.format);
  const functionLabel = isCoil
    ? '05: Write Single Coil'
    : spec.registerCount > 1
      ? '16: Write Multiple Registers'
      : '06: Write Single Register';

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const store = useAppStore.getState();
      if (isCoil) {
        await store.writeCoil(definition.slaveId, row.address, coilValue === '1');
      } else {
        if (!preview) throw new Error(encodeError ?? 'Value is not valid for this format.');
        await store.writeRegisters(definition.slaveId, row.address, preview);
      }
      await store.pollOnce();
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Write value"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || (!isCoil && preview === null)}
            onClick={() => void submit()}
          >
            {busy ? 'Writing…' : 'Write'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">
          <Detail label="Slave" value={String(definition.slaveId)} />
          <Detail
            label="Address"
            value={formatAddress(definition.fc, row.address, plcBase1)}
          />
          <Detail label="Function" value={functionLabel} />
          {!isCoil && <Detail label="Format" value={spec.label} />}
        </div>

        {isCoil ? (
          <Field label="Value">
            <Select
              value={coilValue}
              onChange={setCoilValue}
              options={[
                { value: '1', label: 'ON (1)' },
                { value: '0', label: 'OFF (0)' },
              ]}
              className="w-32"
            />
          </Field>
        ) : (
          <Field label="Value">
            <TextInput
              value={text}
              onChange={setText}
              autoFocus
              onEnter={() => void submit()}
              className="tabular w-full"
            />
          </Field>
        )}

        {!isCoil && preview && (
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Sends{' '}
            <span className="tabular font-medium text-zinc-900 dark:text-zinc-100">
              {preview.map((word) => word.toString(16).toUpperCase().padStart(4, '0')).join(' ')}
            </span>{' '}
            ({preview.length} register{preview.length > 1 ? 's' : ''})
          </div>
        )}

        {!isCoil && encodeError && <Banner tone="error">{encodeError}</Banner>}
        {error && <Banner tone="error">{error}</Banner>}
      </div>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 py-0.5">
      <span className="w-16 text-zinc-500">{label}</span>
      <span className="font-medium text-zinc-900 dark:text-zinc-100">{value}</span>
    </div>
  );
}
