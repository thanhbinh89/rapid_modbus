import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { COMMON_BAUD_RATES } from '../transport/link';
import { describePort, getGrantedPorts, onPortDisconnect } from '../transport/webSerial';
import { Button, Checkbox, Field, NumberInput, Select } from './primitives';

export function ConnectionBar() {
  const status = useAppStore((s) => s.status);
  const port = useAppStore((s) => s.port);
  const settings = useAppStore((s) => s.settings);
  const mode = useAppStore((s) => s.mode);
  const masterOptions = useAppStore((s) => s.masterOptions);
  const polling = useAppStore((s) => s.polling);
  const plcBase1 = useAppStore((s) => s.plcBase1);

  const [grantedCount, setGrantedCount] = useState(0);
  const connected = status === 'connected';

  // A port the user approved in an earlier session can be reused without a
  // second prompt — one click to get going at the next panel.
  useEffect(() => {
    void getGrantedPorts().then((ports) => {
      setGrantedCount(ports.length);
      if (ports.length > 0 && !useAppStore.getState().port) {
        useAppStore.setState({ port: ports[0] });
      }
    });
  }, []);

  // Pulling the USB adapter must stop polling immediately rather than pile up
  // timeouts that look like a device fault.
  useEffect(
    () =>
      onPortDisconnect(() => {
        const state = useAppStore.getState();
        if (state.status === 'connected') {
          void state.disconnect();
          useAppStore.setState({
            connectionError: 'Serial adapter disconnected. Re-plug it and connect again.',
          });
        }
      }),
    [],
  );

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
      <Field label="Port">
        <div className="flex items-center gap-1.5">
          <Button onClick={() => void useAppStore.getState().choosePort()} disabled={connected}>
            {port ? describePort(port) : 'Choose port…'}
          </Button>
          {!port && grantedCount === 0 && (
            <span className="text-xs text-zinc-500">no port selected</span>
          )}
        </div>
      </Field>

      <Field label="Baud">
        <Select
          value={settings.baudRate}
          disabled={connected}
          onChange={(value) => useAppStore.getState().setSettings({ baudRate: Number(value) })}
          options={COMMON_BAUD_RATES.map((rate) => ({ value: rate, label: String(rate) }))}
          className="w-24"
        />
      </Field>

      <Field label="Data">
        <Select
          value={settings.dataBits}
          disabled={connected}
          onChange={(value) =>
            useAppStore.getState().setSettings({ dataBits: Number(value) as 7 | 8 })
          }
          options={[
            { value: 8, label: '8' },
            { value: 7, label: '7' },
          ]}
          className="w-14"
        />
      </Field>

      <Field label="Parity">
        <Select
          value={settings.parity}
          disabled={connected}
          onChange={(value) =>
            useAppStore.getState().setSettings({ parity: value as 'none' | 'even' | 'odd' })
          }
          options={[
            { value: 'none', label: 'None' },
            { value: 'even', label: 'Even' },
            { value: 'odd', label: 'Odd' },
          ]}
          className="w-20"
        />
      </Field>

      <Field label="Stop">
        <Select
          value={settings.stopBits}
          disabled={connected}
          onChange={(value) =>
            useAppStore.getState().setSettings({ stopBits: Number(value) as 1 | 2 })
          }
          options={[
            { value: 1, label: '1' },
            { value: 2, label: '2' },
          ]}
          className="w-14"
        />
      </Field>

      <Field label="Mode">
        <Select
          value={mode}
          disabled={connected}
          onChange={(value) => useAppStore.getState().setMode(value as 'rtu' | 'ascii')}
          options={[
            { value: 'rtu', label: 'RTU' },
            { value: 'ascii', label: 'ASCII' },
          ]}
          className="w-20"
        />
      </Field>

      <Field label="Timeout ms">
        <NumberInput
          value={masterOptions.responseTimeoutMs}
          min={50}
          max={60000}
          onChange={(value) => useAppStore.getState().setMasterOptions({ responseTimeoutMs: value })}
          className="w-20"
        />
      </Field>

      <Field label="Retries">
        <NumberInput
          value={masterOptions.retries}
          min={0}
          max={10}
          onChange={(value) => useAppStore.getState().setMasterOptions({ retries: value })}
          className="w-16"
        />
      </Field>

      <div className="flex items-center gap-2 pb-0.5">
        {connected ? (
          <Button variant="danger" onClick={() => void useAppStore.getState().disconnect()}>
            Disconnect
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={status === 'connecting' || !port}
            onClick={() => void useAppStore.getState().connect()}
          >
            {status === 'connecting' ? 'Connecting…' : 'Connect'}
          </Button>
        )}

        {polling ? (
          <Button onClick={() => void useAppStore.getState().stopPolling()}>Stop</Button>
        ) : (
          <Button disabled={!connected} onClick={() => useAppStore.getState().startPolling()}>
            Start poll
          </Button>
        )}

        <Button
          disabled={!connected || polling}
          title="Read every definition once"
          onClick={() => void useAppStore.getState().pollOnce()}
        >
          Read once
        </Button>
      </div>

      <div className="ml-auto flex items-center gap-3 pb-1">
        <Checkbox
          checked={plcBase1}
          onChange={() => useAppStore.getState().togglePlcBase1()}
          label="PLC addresses (4xxxx)"
        />
      </div>
    </div>
  );
}
