import { useAppStore } from '../store/appStore';
import type { Definition } from '../store/types';

export function DefinitionTabs({ onEdit }: { onEdit: (definition: Definition) => void }) {
  const definitions = useAppStore((s) => s.definitions);
  const states = useAppStore((s) => s.states);
  const activeId = useAppStore((s) => s.activeId);

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-2 pt-1.5 dark:border-zinc-700 dark:bg-zinc-950">
      {definitions.map((definition) => {
        const state = states[definition.id];
        const active = definition.id === activeId;
        return (
          <div
            key={definition.id}
            className={`group flex items-center gap-1.5 rounded-t border border-b-0 px-2.5 py-1 text-sm whitespace-nowrap ${
              active
                ? 'border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100'
                : 'border-transparent text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <button
              type="button"
              onClick={() => useAppStore.getState().setActive(definition.id)}
              onDoubleClick={() => onEdit(definition)}
              className="flex items-center gap-1.5"
              title="Double-click to edit"
            >
              <StatusDot
                enabled={definition.enabled}
                error={Boolean(state?.error)}
                fresh={Boolean(state?.at)}
              />
              {definition.name}
            </button>
            <button
              type="button"
              aria-label={`Close ${definition.name}`}
              onClick={() => useAppStore.getState().removeDefinition(definition.id)}
              className="rounded px-1 text-xs text-zinc-400 opacity-0 group-hover:opacity-100 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700"
            >
              ×
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => useAppStore.getState().addDefinition()}
        title="New definition"
        className="rounded px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        +
      </button>
    </div>
  );
}

function StatusDot({
  enabled,
  error,
  fresh,
}: {
  enabled: boolean;
  error: boolean;
  fresh: boolean;
}) {
  const color = !enabled
    ? 'bg-zinc-400'
    : error
      ? 'bg-red-500'
      : fresh
        ? 'bg-emerald-500'
        : 'bg-zinc-300 dark:bg-zinc-600';
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />;
}
