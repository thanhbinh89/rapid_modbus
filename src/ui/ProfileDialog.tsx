import { useRef, useState } from 'react';
import { downloadText, timestampSuffix } from '../lib/csv';
import {
  ProfileError,
  applyProfile,
  definitionToProfile,
  parseProfile,
  profileToCsv,
  profileToDefinition,
  serializeProfile,
} from '../lib/profile';
import type { ProfileRegister } from '../lib/profile';
import { formatAddress } from '../lib/plcAddress';
import { useAppStore } from '../store/appStore';
import type { Definition } from '../store/types';
import { Banner, Button, Modal } from './primitives';

/**
 * Device profiles: import a register map once, reuse it on every one of that
 * model you ever commission.
 */
export function ProfileDialog({
  definition,
  onClose,
}: {
  definition: Definition | null;
  onClose: () => void;
}) {
  const plcBase1 = useAppStore((s) => s.plcBase1);
  const fileInput = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    device: string;
    applied: number;
    skipped: ProfileRegister[];
    createdNew: boolean;
  } | null>(null);

  const importFile = async (file: File) => {
    setError(null);
    setResult(null);
    try {
      const profile = parseProfile(await file.text());
      const store = useAppStore.getState();

      // A profile that carries its own block layout describes a whole device,
      // so give it its own tab rather than overwriting what is on screen.
      const describesBlock = profile.fc !== undefined && profile.address !== undefined;

      if (describesBlock || !definition) {
        const created = profileToDefinition(profile, `def-${Date.now().toString(36)}`);
        store.addDefinitionFrom(created);
        setResult({
          device: profile.device,
          applied: profile.registers.length,
          skipped: [],
          createdNew: true,
        });
        return;
      }

      const { display, applied, skipped } = applyProfile(definition, profile);
      store.replaceDisplay(definition.id, display);
      setResult({ device: profile.device, applied, skipped, createdNew: false });
    } catch (problem) {
      setError(
        problem instanceof ProfileError
          ? problem.message
          : `Could not read that file: ${problem}`,
      );
    }
  };

  const exportJson = () => {
    if (!definition) return;
    const profile = definitionToProfile(definition);
    downloadText(
      `${slug(definition.name)}-profile-${timestampSuffix()}.json`,
      serializeProfile(profile),
      'application/json',
    );
  };

  const exportCsv = () => {
    if (!definition) return;
    const profile = definitionToProfile(definition);
    downloadText(
      `${slug(definition.name)}-profile-${timestampSuffix()}.csv`,
      profileToCsv(profile, definition.fc, plcBase1),
      'text/csv',
    );
  };

  const namedRows = definition
    ? Object.values(definition.display.rows).filter(
        (row) => row.name || row.unit || row.scaling || row.format,
      ).length
    : 0;

  return (
    <Modal
      title="Device profile"
      onClose={onClose}
      wide
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="space-y-4">
        <Banner tone="info">
          A profile is a register map for a device model — name, format, scaling and unit per
          address. Import it and the grid reads{' '}
          <span className="font-medium">Voltage L1 231.4 V</span> instead of{' '}
          <span className="tabular font-medium">40001 2314</span>.
        </Banner>

        <section>
          <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
            Import
          </h3>
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={() => fileInput.current?.click()}>
              Choose file…
            </Button>
            <span className="text-xs text-zinc-500">JSON or CSV</span>
          </div>
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            CSV needs a header row with <code className="tabular">address</code> (base 0) or{' '}
            <code className="tabular">plc_address</code> (4xxxx), plus any of{' '}
            <code className="tabular">name, format, factor, offset, unit</code>.
          </p>

          <input
            ref={fileInput}
            type="file"
            accept=".json,.csv,application/json,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
              event.target.value = '';
            }}
          />
        </section>

        {error && <Banner tone="error">{error}</Banner>}

        {result && (
          <Banner tone={result.skipped.length > 0 ? 'warn' : 'info'}>
            <div className="font-medium">
              {result.createdNew
                ? `Created a new definition from "${result.device}".`
                : `Applied ${result.applied} register${result.applied === 1 ? '' : 's'} from "${result.device}".`}
            </div>
            {result.skipped.length > 0 && definition && (
              <div className="mt-1">
                {result.skipped.length} register
                {result.skipped.length === 1 ? '' : 's'} fell outside this definition's range (
                {formatAddress(definition.fc, definition.address, plcBase1)} …{' '}
                {formatAddress(
                  definition.fc,
                  definition.address + definition.quantity - 1,
                  plcBase1,
                )}
                ). Widen the range and import again, or they will stay unmapped.
              </div>
            )}
          </Banner>
        )}

        <section>
          <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
            Export
          </h3>
          {definition ? (
            <>
              <div className="flex items-center gap-2">
                <Button onClick={exportJson} disabled={namedRows === 0}>
                  JSON
                </Button>
                <Button onClick={exportCsv} disabled={namedRows === 0}>
                  CSV
                </Button>
                <span className="text-xs text-zinc-500">
                  {namedRows === 0
                    ? 'Nothing to export yet — name some registers first.'
                    : `${namedRows} configured register${namedRows === 1 ? '' : 's'}`}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                JSON carries the block layout too, so importing it elsewhere recreates the whole
                definition. CSV is just the register table.
              </p>
            </>
          ) : (
            <p className="text-sm text-zinc-500">No definition selected.</p>
          )}
        </section>
      </div>
    </Modal>
  );
}

function slug(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile';
}
