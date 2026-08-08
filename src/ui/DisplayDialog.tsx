import { useState } from 'react';
import { useAppStore } from '../store/appStore';
import type { ColorRule, ConditionalColor, Definition } from '../store/types';
import { CONDITIONAL_COLORS } from '../store/types';
import { COLOR_CLASSES } from './format';
import { Banner, Button, Field, Modal, NumberInput, Select, TextInput } from './primitives';

/**
 * Value names and colour rules — the two settings that turn a wall of numbers
 * into something an operator can scan. Both apply to the whole definition,
 * because status codes and alarm bands describe a device, not one register.
 */
export function DisplayDialog({
  definition,
  onClose,
}: {
  definition: Definition;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'names' | 'colors'>('names');

  return (
    <Modal title="Display rules" onClose={onClose} wide footer={<Button onClick={onClose}>Done</Button>}>
      <div className="mb-3 flex gap-1 border-b border-zinc-200 dark:border-zinc-700">
        <TabButton active={tab === 'names'} onClick={() => setTab('names')}>
          Value names
        </TabButton>
        <TabButton active={tab === 'colors'} onClick={() => setTab('colors')}>
          Conditional colours
        </TabButton>
      </div>

      {tab === 'names' ? (
        <ValueNames definition={definition} />
      ) : (
        <ColorRules definition={definition} />
      )}
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

function ValueNames({ definition }: { definition: Definition }) {
  const entries = Object.entries(definition.display.valueNames)
    .map(([value, label]) => ({ value: Number(value), label }))
    .sort((a, b) => a.value - b.value);

  const [draftValue, setDraftValue] = useState(0);
  const [draftLabel, setDraftLabel] = useState('');

  const commit = (next: Array<{ value: number; label: string }>) => {
    useAppStore
      .getState()
      .setValueNames(
        definition.id,
        Object.fromEntries(next.map((entry) => [entry.value, entry.label])),
      );
  };

  const add = () => {
    if (!draftLabel.trim()) return;
    commit([
      ...entries.filter((entry) => entry.value !== draftValue),
      { value: draftValue, label: draftLabel.trim() },
    ]);
    setDraftLabel('');
    setDraftValue(draftValue + 1);
  };

  return (
    <div className="space-y-3">
      <Banner tone="info">
        Replaces a raw register value with a label — 0 = Off, 1 = Run, 2 = Fault. Matching is on the
        raw value, before scaling.
      </Banner>

      <div className="flex items-end gap-2">
        <Field label="Value">
          <NumberInput value={draftValue} onChange={setDraftValue} className="w-24" />
        </Field>
        <Field label="Label">
          <TextInput
            value={draftLabel}
            onChange={setDraftLabel}
            onEnter={add}
            placeholder="Running"
            className="w-56"
          />
        </Field>
        <Button variant="primary" onClick={add} disabled={!draftLabel.trim()}>
          Add
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-300 py-6 text-center text-sm text-zinc-400 dark:border-zinc-700">
          No value names yet.
        </div>
      ) : (
        <div className="max-h-56 divide-y divide-zinc-200 overflow-auto rounded border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
          {entries.map((entry) => (
            <div key={entry.value} className="flex items-center gap-3 px-3 py-1.5 text-sm">
              <span className="tabular w-20 text-zinc-500">{entry.value}</span>
              <span className="text-zinc-900 dark:text-zinc-100">{entry.label}</span>
              <button
                type="button"
                onClick={() => commit(entries.filter((other) => other.value !== entry.value))}
                className="ml-auto text-xs text-zinc-400 hover:text-red-500"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ColorRules({ definition }: { definition: Definition }) {
  const rules = definition.display.colorRules;
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(0);
  const [color, setColor] = useState<ConditionalColor>('red');

  const commit = (next: ColorRule[]) =>
    useAppStore.getState().setColorRules(definition.id, next);

  const add = () => {
    commit([
      ...rules,
      {
        id: `rule-${Date.now().toString(36)}`,
        min: Math.min(min, max),
        max: Math.max(min, max),
        color,
      },
    ]);
  };

  const move = (index: number, delta: number) => {
    const next = [...rules];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  };

  return (
    <div className="space-y-3">
      <Banner tone="info">
        Colours a cell when its value falls inside a band. Bands are checked top to bottom and the
        first match wins, so put the narrower ones first. Compared against the scaled value.
      </Banner>

      <div className="flex items-end gap-2">
        <Field label="Min">
          <NumberInput value={min} onChange={setMin} className="w-28" />
        </Field>
        <Field label="Max">
          <NumberInput value={max} onChange={setMax} className="w-28" />
        </Field>
        <Field label="Colour">
          <Select
            value={color}
            onChange={(value) => setColor(value as ConditionalColor)}
            options={CONDITIONAL_COLORS.map((name) => ({ value: name, label: name }))}
            className="w-28"
          />
        </Field>
        <Button variant="primary" onClick={add}>
          Add
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-300 py-6 text-center text-sm text-zinc-400 dark:border-zinc-700">
          No colour rules yet.
        </div>
      ) : (
        <div className="max-h-56 divide-y divide-zinc-200 overflow-auto rounded border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
          {rules.map((rule, index) => (
            <div key={rule.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
              <span className={`tabular rounded px-2 py-0.5 ${COLOR_CLASSES[rule.color]}`}>
                {rule.min} … {rule.max}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  className="rounded px-1.5 text-zinc-400 hover:bg-zinc-200 disabled:opacity-30 dark:hover:bg-zinc-700"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === rules.length - 1}
                  className="rounded px-1.5 text-zinc-400 hover:bg-zinc-200 disabled:opacity-30 dark:hover:bg-zinc-700"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => commit(rules.filter((other) => other.id !== rule.id))}
                  className="ml-1 text-xs text-zinc-400 hover:text-red-500"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
