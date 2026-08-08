import { useState } from 'react';
import { FC } from '../protocol/pdu';
import { QUANTITY_LIMITS } from '../protocol/pdu';
import { useAppStore } from '../store/appStore';
import type { Definition } from '../store/types';
import type { ReadFunctionCode } from '../core/scheduler';
import { formatAddress } from '../lib/plcAddress';
import { Banner, Button, Checkbox, Field, Modal, NumberInput, Select, TextInput } from './primitives';

const FUNCTION_OPTIONS = [
  { value: FC.READ_COILS, label: '01: Read Coils' },
  { value: FC.READ_DISCRETE_INPUTS, label: '02: Read Discrete Inputs' },
  { value: FC.READ_HOLDING_REGISTERS, label: '03: Read Holding Registers' },
  { value: FC.READ_INPUT_REGISTERS, label: '04: Read Input Registers' },
];

export function DefinitionDialog({
  definition,
  onClose,
}: {
  definition: Definition;
  onClose: () => void;
}) {
  const plcBase1 = useAppStore((s) => s.plcBase1);
  const [draft, setDraft] = useState<Definition>(definition);

  const limit = QUANTITY_LIMITS[draft.fc] ?? { min: 1, max: 125 };
  const overrun = draft.address + draft.quantity > 65536;
  const quantityBad = draft.quantity < limit.min || draft.quantity > limit.max;
  const invalid = overrun || quantityBad;

  const apply = () => {
    if (invalid) return;
    useAppStore.getState().updateDefinition(definition.id, draft);
    onClose();
  };

  return (
    <Modal
      title="Read definition"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply} disabled={invalid}>
            Apply
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Name">
            <TextInput
              value={draft.name}
              onChange={(name) => setDraft({ ...draft, name })}
              placeholder="e.g. Meter 1 — voltages"
            />
          </Field>
        </div>

        <Field label="Slave ID">
          <NumberInput
            value={draft.slaveId}
            min={0}
            max={255}
            onChange={(slaveId) => setDraft({ ...draft, slaveId })}
          />
        </Field>

        <Field label="Function">
          <Select
            value={draft.fc}
            onChange={(value) => setDraft({ ...draft, fc: Number(value) as ReadFunctionCode })}
            options={FUNCTION_OPTIONS}
          />
        </Field>

        <Field label="Address (base 0)">
          <NumberInput
            value={draft.address}
            min={0}
            max={65535}
            onChange={(address) => setDraft({ ...draft, address })}
          />
        </Field>

        <Field label={`Quantity (${limit.min}–${limit.max})`}>
          <NumberInput
            value={draft.quantity}
            min={limit.min}
            max={limit.max}
            onChange={(quantity) => setDraft({ ...draft, quantity })}
          />
        </Field>

        <Field label="Scan rate (ms)">
          <NumberInput
            value={draft.scanRateMs}
            min={0}
            max={3_600_000}
            onChange={(scanRateMs) => setDraft({ ...draft, scanRateMs })}
          />
        </Field>

        <div className="flex flex-col justify-end gap-1.5 pb-1">
          <Checkbox
            checked={draft.enabled}
            onChange={(enabled) => setDraft({ ...draft, enabled })}
            label="Enabled"
          />
          <Checkbox
            checked={draft.disableOnError}
            onChange={(disableOnError) => setDraft({ ...draft, disableOnError })}
            label="Disable on error"
          />
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="rounded bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          Reads{' '}
          <span className="tabular font-medium text-zinc-900 dark:text-zinc-100">
            {formatAddress(draft.fc, draft.address, plcBase1)}
          </span>{' '}
          to{' '}
          <span className="tabular font-medium text-zinc-900 dark:text-zinc-100">
            {formatAddress(draft.fc, draft.address + draft.quantity - 1, plcBase1)}
          </span>{' '}
          from slave {draft.slaveId}
          {plcBase1 && ' (PLC notation)'}
        </div>

        {quantityBad && (
          <Banner tone="error">
            Function {String(draft.fc).padStart(2, '0')} allows {limit.min}–{limit.max} per request.
          </Banner>
        )}
        {overrun && (
          <Banner tone="error">
            This range runs past address 65535. Reduce the quantity or the start address.
          </Banner>
        )}
      </div>
    </Modal>
  );
}
