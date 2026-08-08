import { describe, expect, it } from 'vitest';
import { ModbusExceptionError, ModbusTransportError } from '../protocol/errors';
import { FC } from '../protocol/pdu';
import { FakeDevice, FakeSerialLink } from '../testing/fakeLink';
import type { MasterOptions, TrafficEvent } from './master';
import { DEFAULT_MASTER_OPTIONS, ModbusMaster } from './master';

function makeMaster(
  devices: FakeDevice[],
  options: Partial<MasterOptions> = {},
  traffic?: TrafficEvent[],
) {
  const mode = options.mode ?? 'rtu';
  const link = new FakeSerialLink(devices, mode);
  const master = new ModbusMaster(
    link,
    { ...DEFAULT_MASTER_OPTIONS, responseTimeoutMs: 100, interFrameDelayMs: 0, ...options },
    traffic ? (event) => traffic.push(event) : undefined,
  );
  return { link, master };
}

const meter = () =>
  new FakeDevice({
    slaveId: 1,
    holdingRegisters: [0x022b, 0x0000, 0x0064, 0x0001],
    inputRegisters: [0x1234, 0x5678],
    coils: [true, false, true, true],
    discreteInputs: [false, true],
  });

describe('reads', () => {
  it('reads holding registers', async () => {
    const { master } = makeMaster([meter()]);
    await expect(
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 3 }),
    ).resolves.toEqual({ kind: 'registers', values: [0x022b, 0x0000, 0x0064] });
  });

  it('reads input registers', async () => {
    const { master } = makeMaster([meter()]);
    await expect(
      master.execute({ fc: FC.READ_INPUT_REGISTERS, slaveId: 1, address: 0, quantity: 2 }),
    ).resolves.toEqual({ kind: 'registers', values: [0x1234, 0x5678] });
  });

  it('reads coils', async () => {
    const { master } = makeMaster([meter()]);
    await expect(
      master.execute({ fc: FC.READ_COILS, slaveId: 1, address: 0, quantity: 4 }),
    ).resolves.toEqual({ kind: 'bits', values: [true, false, true, true] });
  });

  it('works in ASCII mode', async () => {
    const { master } = makeMaster([meter()], { mode: 'ascii' });
    await expect(
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 3 }),
    ).resolves.toEqual({ kind: 'registers', values: [0x022b, 0x0000, 0x0064] });
  });
});

describe('writes', () => {
  it('writes a single register and reads it back', async () => {
    const device = meter();
    const { master } = makeMaster([device]);

    await expect(
      master.execute({ fc: FC.WRITE_SINGLE_REGISTER, slaveId: 1, address: 1, value: 0x0abc }),
    ).resolves.toEqual({ kind: 'echo', address: 1, value: 0x0abc });

    await expect(
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 1, quantity: 1 }),
    ).resolves.toEqual({ kind: 'registers', values: [0x0abc] });
  });

  it('writes multiple registers', async () => {
    const device = meter();
    const { master } = makeMaster([device]);

    await master.execute({
      fc: FC.WRITE_MULTIPLE_REGISTERS,
      slaveId: 1,
      address: 0,
      values: [0x1111, 0x2222],
    });
    expect(device.holdingRegisters.slice(0, 2)).toEqual([0x1111, 0x2222]);
  });

  it('writes a single coil', async () => {
    const device = meter();
    const { master } = makeMaster([device]);

    await master.execute({ fc: FC.WRITE_SINGLE_COIL, slaveId: 1, address: 1, value: true });
    expect(device.coils[1]).toBe(true);
  });

  it('does not wait for a reply to a broadcast', async () => {
    const device = meter();
    const { master } = makeMaster([device], { responseTimeoutMs: 5000 });

    const started = Date.now();
    await master.execute({ fc: FC.WRITE_SINGLE_REGISTER, slaveId: 0, address: 0, value: 1 });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('failure handling', () => {
  it('times out when nothing answers', async () => {
    const { master } = makeMaster([new FakeDevice({ slaveId: 1, silent: true })]);
    await expect(
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 1 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('times out when the slave ID does not exist on the line', async () => {
    const { master } = makeMaster([meter()]);
    await expect(
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 9, address: 0, quantity: 1 }),
    ).rejects.toBeInstanceOf(ModbusTransportError);
  });

  it('surfaces a CRC error when the checksum is corrupted', async () => {
    const device = new FakeDevice({
      slaveId: 1,
      holdingRegisters: [1, 2, 3],
      corruptChecksum: true,
    });
    const { master } = makeMaster([device]);
    await expect(
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 3 }),
    ).rejects.toMatchObject({ code: 'CRC_ERROR' });
  });

  it('surfaces a Modbus exception with its hint', async () => {
    const device = new FakeDevice({ slaveId: 1, exceptionCode: 0x02 });
    const { master } = makeMaster([device]);
    await expect(
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 1 }),
    ).rejects.toBeInstanceOf(ModbusExceptionError);
  });

  it('reports an out-of-range address as illegal data address', async () => {
    const { master } = makeMaster([meter()]);
    await expect(
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 900, quantity: 1 }),
    ).rejects.toMatchObject({ exceptionCode: 0x02 });
  });
});

describe('retry', () => {
  it('does not retry a Modbus exception — the device already answered', async () => {
    const device = new FakeDevice({ slaveId: 1, exceptionCode: 0x01 });
    const { link, master } = makeMaster([device], { retries: 3 });

    await expect(
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 1 }),
    ).rejects.toBeInstanceOf(ModbusExceptionError);
    expect(link.written).toHaveLength(1);
  });

  it('retries a timeout the configured number of times', async () => {
    const { link, master } = makeMaster([new FakeDevice({ slaveId: 1, silent: true })], {
      retries: 2,
      responseTimeoutMs: 20,
    });

    await expect(
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 1 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(link.written).toHaveLength(3);
  });
});

describe('framing under real-world stream behaviour', () => {
  it('reassembles a response delivered one byte at a time', async () => {
    const device = new FakeDevice({
      slaveId: 1,
      holdingRegisters: [0x022b, 0x0000, 0x0064],
      chunkSize: 1,
    });
    const { master } = makeMaster([device]);
    await expect(
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 3 }),
    ).resolves.toEqual({ kind: 'registers', values: [0x022b, 0x0000, 0x0064] });
  });

  it('does not let a late reply leak into the next transaction', async () => {
    // The device answers after the master has already given up. That stray
    // 2-register frame is still on the wire when the next request goes out —
    // it must be discarded, not mistaken for the new answer.
    const slow = new FakeDevice({
      slaveId: 1,
      holdingRegisters: [0xdead, 0xbeef],
      responseDelayMs: 60,
    });
    const { master } = makeMaster([slow], { responseTimeoutMs: 20 });

    await expect(
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 2 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });

    // Let the abandoned reply arrive and sit in the receive buffer.
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Give the next exchange room to complete on its own terms.
    master.setOptions({ responseTimeoutMs: 500 });

    // A leaked frame would surface here as [0xdead, 0xbeef] or a byte-count
    // mismatch; a correct master answers this request from a fresh reply.
    await expect(
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 1 }),
    ).resolves.toEqual({ kind: 'registers', values: [0xdead] });
  });
});

describe('serialisation', () => {
  it('runs queued transactions one at a time, in order', async () => {
    const { link, master } = makeMaster([meter()]);

    const results = await Promise.all([
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 1 }),
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 1, quantity: 1 }),
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 2, quantity: 1 }),
    ]);

    expect(results).toEqual([
      { kind: 'registers', values: [0x022b] },
      { kind: 'registers', values: [0x0000] },
      { kind: 'registers', values: [0x0064] },
    ]);
    expect(link.written).toHaveLength(3);
  });

  it('keeps the queue alive after a failed transaction', async () => {
    const { master } = makeMaster([meter()]);

    const failure = master.execute({
      fc: FC.READ_HOLDING_REGISTERS,
      slaveId: 7,
      address: 0,
      quantity: 1,
    });
    const success = master.execute({
      fc: FC.READ_HOLDING_REGISTERS,
      slaveId: 1,
      address: 0,
      quantity: 1,
    });

    await expect(failure).rejects.toBeInstanceOf(ModbusTransportError);
    await expect(success).resolves.toEqual({ kind: 'registers', values: [0x022b] });
  });
});

describe('traffic and stats', () => {
  it('emits a tx event and an rx event per exchange', async () => {
    const traffic: TrafficEvent[] = [];
    const { master } = makeMaster([meter()], {}, traffic);

    await master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 1 });

    expect(traffic.map((e) => e.direction)).toEqual(['tx', 'rx']);
    expect(traffic[0].bytes[0]).toBe(0x01);
    expect(traffic[1].error).toBeUndefined();
  });

  it('attaches the error message to a failed rx event', async () => {
    const traffic: TrafficEvent[] = [];
    const { master } = makeMaster([new FakeDevice({ slaveId: 1, silent: true })], {}, traffic);

    await expect(
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 1 }),
    ).rejects.toThrow();

    expect(traffic[1].direction).toBe('rx');
    expect(traffic[1].error).toContain('TIMEOUT');
  });

  it('counts transactions and tracks response times', async () => {
    const { master } = makeMaster([meter()]);

    await master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 1 });
    await master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 1 });

    const stats = master.stats;
    expect(stats.tx).toBe(2);
    expect(stats.rx).toBe(2);
    expect(stats.errors).toBe(0);
    expect(stats.avgResponseMs).not.toBeNull();
  });

  it('counts errors separately', async () => {
    const { master } = makeMaster([new FakeDevice({ slaveId: 1, silent: true })], {
      responseTimeoutMs: 20,
    });

    await expect(
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 1 }),
    ).rejects.toThrow();

    expect(master.stats.errors).toBe(1);
    expect(master.stats.rx).toBe(0);
  });

  it('resets stats on demand', async () => {
    const { master } = makeMaster([meter()]);
    await master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 1 });
    master.resetStats();
    expect(master.stats).toMatchObject({ tx: 0, rx: 0, errors: 0, avgResponseMs: null });
  });
});

describe('closed port', () => {
  it('refuses to transact on a closed link', async () => {
    const { link, master } = makeMaster([meter()]);
    await link.close();

    await expect(
      master.execute({ fc: FC.READ_HOLDING_REGISTERS, slaveId: 1, address: 0, quantity: 1 }),
    ).rejects.toMatchObject({ code: 'PORT_CLOSED' });
  });
});
