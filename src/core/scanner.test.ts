import { describe, expect, it } from 'vitest';
import { FC } from '../protocol/pdu';
import { FakeDevice, FakeSerialLink } from '../testing/fakeLink';
import type { SerialSettings } from '../transport/link';
import { DEFAULT_MASTER_OPTIONS, ModbusMaster } from './master';
import type { AutoDetectHit, ScanProgress } from './scanner';
import { addressScanToCsv, autoDetect, probe, scanAddresses, scanSlaveIds } from './scanner';

function makeMaster(devices: FakeDevice[], timeoutMs = 20) {
  const link = new FakeSerialLink(devices, 'rtu');
  const master = new ModbusMaster(link, {
    ...DEFAULT_MASTER_OPTIONS,
    responseTimeoutMs: timeoutMs,
    interFrameDelayMs: 0,
  });
  return { link, master };
}

describe('probe', () => {
  it('reports data when the device answers', async () => {
    const { master } = makeMaster([new FakeDevice({ slaveId: 3, holdingRegisters: [42] })]);
    const presence = await probe(master, 3, FC.READ_HOLDING_REGISTERS, 0, 1);
    expect(presence).toMatchObject({ kind: 'data' });
  });

  it('reports an exception as presence, not absence', async () => {
    // A device that refuses the read is still a device on the wire.
    const { master } = makeMaster([new FakeDevice({ slaveId: 3, exceptionCode: 0x02 })]);
    const presence = await probe(master, 3, FC.READ_HOLDING_REGISTERS, 0, 1);
    expect(presence).toEqual({ kind: 'exception', exceptionCode: 0x02 });
  });

  it('reports silence when nothing is there', async () => {
    const { master } = makeMaster([new FakeDevice({ slaveId: 3, holdingRegisters: [1] })]);
    expect(await probe(master, 9, FC.READ_HOLDING_REGISTERS, 0, 1)).toEqual({ kind: 'silent' });
  });
});

describe('scanSlaveIds', () => {
  it('finds every device in the range', async () => {
    const { master } = makeMaster([
      new FakeDevice({ slaveId: 2, holdingRegisters: [1] }),
      new FakeDevice({ slaveId: 5, holdingRegisters: [1] }),
    ]);

    const hits = await scanSlaveIds(master, { from: 1, to: 8 });
    expect(hits.map((h) => h.slaveId)).toEqual([2, 5]);
    expect(hits.every((h) => h.via === 'data')).toBe(true);
  });

  it('counts a device that only returns exceptions as found', async () => {
    const { master } = makeMaster([new FakeDevice({ slaveId: 4, exceptionCode: 0x02 })]);

    const hits = await scanSlaveIds(master, { from: 1, to: 6 });
    expect(hits).toEqual([{ slaveId: 4, via: 'exception', exceptionCode: 0x02 }]);
  });

  it('ignores a device that stays silent', async () => {
    const { master } = makeMaster([new FakeDevice({ slaveId: 4, silent: true })]);
    expect(await scanSlaveIds(master, { from: 1, to: 6 })).toEqual([]);
  });

  it('reports progress and streams hits as they are found', async () => {
    const { master } = makeMaster([new FakeDevice({ slaveId: 2, holdingRegisters: [1] })]);
    const progress: ScanProgress[] = [];
    const streamed: number[] = [];

    await scanSlaveIds(master, {
      from: 1,
      to: 4,
      onProgress: (p) => progress.push(p),
      onHit: (h) => streamed.push(h.slaveId),
    });

    expect(streamed).toEqual([2]);
    expect(progress.at(-1)).toEqual({ done: 4, total: 4, label: 'Done' });
  });

  it('stops early when aborted', async () => {
    const { link, master } = makeMaster([new FakeDevice({ slaveId: 200, holdingRegisters: [1] })]);
    const controller = new AbortController();

    const scan = scanSlaveIds(master, {
      from: 1,
      to: 247,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.done >= 3) controller.abort();
      },
    });

    await scan;
    // Aborting returns what was found so far rather than throwing away the run.
    expect(link.written.length).toBeLessThan(20);
  });
});

describe('scanAddresses', () => {
  it('records the addresses that read back', async () => {
    const { master } = makeMaster([
      new FakeDevice({ slaveId: 1, holdingRegisters: [0x11, 0x22, 0x33] }),
    ]);

    const hits = await scanAddresses(master, { slaveId: 1, from: 0, to: 5 });
    expect(hits.map((h) => h.address)).toEqual([0, 1, 2]);
    expect(hits[0].result).toEqual({ kind: 'registers', values: [0x11] });
  });

  it('gives up after a run of silence', async () => {
    const { link, master } = makeMaster([new FakeDevice({ slaveId: 1, silent: true })]);

    await scanAddresses(master, { slaveId: 1, from: 0, to: 1000, abortAfterSilent: 3 });
    expect(link.written).toHaveLength(3);
  });

  it('keeps going through exception replies', async () => {
    // Out-of-range addresses answer with an exception; the scan must not stop.
    const { link, master } = makeMaster([
      new FakeDevice({ slaveId: 1, holdingRegisters: [0x11] }),
    ]);

    const hits = await scanAddresses(master, { slaveId: 1, from: 0, to: 5 });
    expect(hits.map((h) => h.address)).toEqual([0]);
    expect(link.written).toHaveLength(6);
  });

  it('exports hits as CSV', async () => {
    const { master } = makeMaster([
      new FakeDevice({ slaveId: 1, holdingRegisters: [0x11, 0x22] }),
    ]);

    const hits = await scanAddresses(master, { slaveId: 1, from: 0, to: 1 });
    expect(addressScanToCsv(hits)).toBe('address,values\n0,"17"\n1,"34"');
  });
});

describe('autoDetect', () => {
  /** Opens a link only when the settings match what the device expects. */
  function makeOpener(expected: SerialSettings, device: FakeDevice) {
    const attempts: SerialSettings[] = [];
    let closed = 0;

    const open = async (settings: SerialSettings) => {
      attempts.push(settings);
      const matches =
        settings.baudRate === expected.baudRate && settings.parity === expected.parity;
      // Wrong settings produce garbage, which on a real line means silence.
      const devices = matches ? [device] : [new FakeDevice({ slaveId: 1, silent: true })];
      const link = new FakeSerialLink(devices, 'rtu');
      const master = new ModbusMaster(link, {
        ...DEFAULT_MASTER_OPTIONS,
        responseTimeoutMs: 10,
        interFrameDelayMs: 0,
      });
      return {
        master,
        close: async () => {
          closed++;
          master.stop();
          await link.close();
        },
      };
    };

    return { open, attempts, closedCount: () => closed };
  }

  it('finds the baud rate, parity and slave ID', async () => {
    const expected: SerialSettings = {
      baudRate: 19200,
      dataBits: 8,
      stopBits: 1,
      parity: 'even',
    };
    const { open } = makeOpener(expected, new FakeDevice({ slaveId: 7, holdingRegisters: [1] }));

    const hits = await autoDetect(open, {
      baudRates: [9600, 19200],
      parities: ['none', 'even'],
      slaveIds: [1, 7],
    });

    expect(hits).toEqual<AutoDetectHit[]>([
      { settings: expected, mode: 'rtu', slaveId: 7, via: 'data' },
    ]);
  });

  it('stops at the first match when asked', async () => {
    const expected: SerialSettings = { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' };
    const device = new FakeDevice({ slaveId: 1, holdingRegisters: [1] });
    const { open } = makeOpener(expected, device);

    const hits = await autoDetect(open, {
      baudRates: [9600, 19200],
      parities: ['none', 'even'],
      slaveIds: [1, 2, 3],
      stopOnFirst: true,
    });

    expect(hits).toHaveLength(1);
  });

  it('closes every session it opens, including the one that matched', async () => {
    const expected: SerialSettings = { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' };
    const { open, attempts, closedCount } = makeOpener(
      expected,
      new FakeDevice({ slaveId: 1, holdingRegisters: [1] }),
    );

    await autoDetect(open, {
      baudRates: [9600, 19200],
      parities: ['none'],
      slaveIds: [1],
    });

    expect(attempts).toHaveLength(2);
    expect(closedCount()).toBe(2);
  });

  it('skips a settings combination the port refuses to open', async () => {
    const open = async (settings: SerialSettings) => {
      if (settings.baudRate === 9600) throw new Error('port busy');
      const link = new FakeSerialLink([new FakeDevice({ slaveId: 1, holdingRegisters: [1] })]);
      const master = new ModbusMaster(link, {
        ...DEFAULT_MASTER_OPTIONS,
        responseTimeoutMs: 10,
        interFrameDelayMs: 0,
      });
      return {
        master,
        close: async () => {
          master.stop();
          await link.close();
        },
      };
    };

    const hits = await autoDetect(open, {
      baudRates: [9600, 19200],
      parities: ['none'],
      slaveIds: [1],
    });

    expect(hits).toEqual([
      {
        settings: { baudRate: 19200, dataBits: 8, stopBits: 1, parity: 'none' },
        mode: 'rtu',
        slaveId: 1,
        via: 'data',
      },
    ]);
  });

  it('reports progress across the whole sweep', async () => {
    const expected: SerialSettings = { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' };
    const { open } = makeOpener(expected, new FakeDevice({ slaveId: 1, holdingRegisters: [1] }));
    const progress: ScanProgress[] = [];

    await autoDetect(open, {
      baudRates: [9600, 19200],
      parities: ['none', 'even'],
      slaveIds: [1, 2],
      onProgress: (p) => progress.push(p),
    });

    expect(progress[0].total).toBe(8);
    expect(progress.at(-1)).toMatchObject({ done: 8, total: 8, label: 'Done' });
  });
});
