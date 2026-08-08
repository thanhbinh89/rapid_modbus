import { describe, expect, it } from 'vitest';
import { FC } from '../protocol/pdu';
import { FakeDevice, FakeSerialLink } from '../testing/fakeLink';
import { DEFAULT_MASTER_OPTIONS, ModbusMaster } from './master';
import type { PollDefinition, PollUpdate } from './scheduler';
import { PollScheduler } from './scheduler';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeScheduler(devices: FakeDevice[], timeoutMs = 30) {
  const link = new FakeSerialLink(devices, 'rtu');
  const master = new ModbusMaster(link, {
    ...DEFAULT_MASTER_OPTIONS,
    responseTimeoutMs: timeoutMs,
    interFrameDelayMs: 0,
  });
  const updates: PollUpdate[] = [];
  const scheduler = new PollScheduler(master, (update) => updates.push(update));
  return { link, master, scheduler, updates };
}

function definition(overrides: Partial<PollDefinition> = {}): PollDefinition {
  return {
    id: 'd1',
    name: 'Test',
    slaveId: 1,
    fc: FC.READ_HOLDING_REGISTERS,
    address: 0,
    quantity: 2,
    scanRateMs: 0,
    enabled: true,
    disableOnError: false,
    ...overrides,
  };
}

const meter = () => new FakeDevice({ slaveId: 1, holdingRegisters: [0x1111, 0x2222, 0x3333] });

describe('pollOnce', () => {
  it('reads every enabled definition exactly once', async () => {
    const { link, scheduler, updates } = makeScheduler([meter()]);
    scheduler.set(definition({ id: 'a', address: 0, quantity: 1 }));
    scheduler.set(definition({ id: 'b', address: 1, quantity: 1 }));

    await scheduler.pollOnce();

    expect(link.written).toHaveLength(2);
    expect(updates.map((u) => u.definitionId).sort()).toEqual(['a', 'b']);
    expect(updates.every((u) => u.error === null)).toBe(true);
  });

  it('skips disabled definitions', async () => {
    const { link, scheduler } = makeScheduler([meter()]);
    scheduler.set(definition({ id: 'a' }));
    scheduler.set(definition({ id: 'b', enabled: false }));

    await scheduler.pollOnce();
    expect(link.written).toHaveLength(1);
  });

  it('delivers decoded register values', async () => {
    const { scheduler, updates } = makeScheduler([meter()]);
    scheduler.set(definition({ quantity: 3 }));

    await scheduler.pollOnce();
    expect(updates[0].result).toEqual({ kind: 'registers', values: [0x1111, 0x2222, 0x3333] });
  });
});

describe('continuous polling', () => {
  it('keeps polling until stopped', async () => {
    const { link, scheduler } = makeScheduler([meter()]);
    scheduler.set(definition());

    scheduler.start();
    await sleep(60);
    await scheduler.stop();

    const count = link.written.length;
    expect(count).toBeGreaterThan(1);

    // Nothing more goes out once stopped.
    await sleep(40);
    expect(link.written).toHaveLength(count);
  });

  it('services every definition rather than starving one', async () => {
    const { scheduler, updates } = makeScheduler([meter()]);
    scheduler.set(definition({ id: 'a', address: 0, quantity: 1 }));
    scheduler.set(definition({ id: 'b', address: 1, quantity: 1 }));
    scheduler.set(definition({ id: 'c', address: 2, quantity: 1 }));

    scheduler.start();
    await sleep(80);
    await scheduler.stop();

    for (const id of ['a', 'b', 'c']) {
      expect(updates.filter((u) => u.definitionId === id).length).toBeGreaterThan(0);
    }
  });

  it('honours a slow scan rate', async () => {
    const { scheduler, updates } = makeScheduler([meter()]);
    scheduler.set(definition({ scanRateMs: 10_000 }));

    scheduler.start();
    await sleep(80);
    await scheduler.stop();

    // First poll is immediate, the next is 10 s away.
    expect(updates).toHaveLength(1);
  });

  it('reports isRunning', async () => {
    const { scheduler } = makeScheduler([meter()]);
    expect(scheduler.isRunning).toBe(false);
    scheduler.start();
    expect(scheduler.isRunning).toBe(true);
    await scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
  });
});

describe('error handling', () => {
  it('surfaces a Modbus exception with its code and hint', async () => {
    const { scheduler, updates } = makeScheduler([
      new FakeDevice({ slaveId: 1, exceptionCode: 0x02 }),
    ]);
    scheduler.set(definition());

    await scheduler.pollOnce();

    expect(updates[0].result).toBeNull();
    expect(updates[0].error).toMatchObject({ exceptionCode: 0x02 });
    expect(updates[0].error?.hint).toContain('base-0 vs base-1');
  });

  it('surfaces a timeout with a wiring hint', async () => {
    const { scheduler, updates } = makeScheduler([new FakeDevice({ slaveId: 1, silent: true })]);
    scheduler.set(definition());

    await scheduler.pollOnce();
    expect(updates[0].error?.hint).toContain('A/B wiring');
  });

  it('counts consecutive errors and resets on success', async () => {
    const device = new FakeDevice({ slaveId: 1, silent: true });
    const { scheduler, updates } = makeScheduler([device]);
    scheduler.set(definition());

    await scheduler.pollOnce();
    await scheduler.pollOnce();
    expect(updates.at(-1)?.consecutiveErrors).toBe(2);

    // Bring the device back to life.
    device.options.silent = false;
    device.holdingRegisters = [1, 2];
    await scheduler.pollOnce();
    expect(updates.at(-1)?.consecutiveErrors).toBe(0);
    expect(updates.at(-1)?.error).toBeNull();
  });

  it('disables the definition on error when asked', async () => {
    const { link, scheduler } = makeScheduler([new FakeDevice({ slaveId: 1, silent: true })]);
    scheduler.set(definition({ disableOnError: true }));

    await scheduler.pollOnce();
    expect(scheduler.definitions[0].enabled).toBe(false);

    // Now disabled, so a second pass sends nothing.
    await scheduler.pollOnce();
    expect(link.written).toHaveLength(1);
  });

  it('keeps polling other definitions when one fails', async () => {
    const { scheduler, updates } = makeScheduler([meter()]);
    scheduler.set(definition({ id: 'good', slaveId: 1 }));
    scheduler.set(definition({ id: 'absent', slaveId: 9 }));

    await scheduler.pollOnce();

    expect(updates.find((u) => u.definitionId === 'good')?.error).toBeNull();
    expect(updates.find((u) => u.definitionId === 'absent')?.error).not.toBeNull();
  });
});

describe('definition management', () => {
  it('replaces a definition with the same id', async () => {
    const { scheduler } = makeScheduler([meter()]);
    scheduler.set(definition({ id: 'a', name: 'First' }));
    scheduler.set(definition({ id: 'a', name: 'Second' }));

    expect(scheduler.definitions).toHaveLength(1);
    expect(scheduler.definitions[0].name).toBe('Second');
  });

  it('removes and clears definitions', async () => {
    const { scheduler } = makeScheduler([meter()]);
    scheduler.set(definition({ id: 'a' }));
    scheduler.set(definition({ id: 'b' }));

    scheduler.remove('a');
    expect(scheduler.definitions.map((d) => d.id)).toEqual(['b']);

    scheduler.clear();
    expect(scheduler.definitions).toHaveLength(0);
  });

  it('polls an edited definition immediately instead of waiting out the old timer', async () => {
    const { scheduler, updates } = makeScheduler([meter()]);
    scheduler.set(definition({ id: 'a', address: 0, quantity: 1, scanRateMs: 10_000 }));

    scheduler.start();
    await sleep(30);
    expect(updates).toHaveLength(1);

    // Editing the address must not leave the operator staring at stale data
    // for another 10 seconds.
    scheduler.set(definition({ id: 'a', address: 1, quantity: 1, scanRateMs: 10_000 }));
    await sleep(60);
    await scheduler.stop();

    expect(updates).toHaveLength(2);
    expect(updates[1].result).toEqual({ kind: 'registers', values: [0x2222] });
  });
});
