import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AsyncCleanupSlot,
  OneShotTimer,
  RepeatingTimer,
  type IntervalHandle,
  type TimeoutHandle
} from './lifecycle-resources.ts';

test('async cleanup slot coalesces concurrent initialization and clears once', async () => {
  const slot = new AsyncCleanupSlot();
  let factoryCalls = 0;
  let cleanupCalls = 0;
  let releaseFactory: ((cleanup: () => void) => void) | null = null;
  const factory = () => {
    factoryCalls += 1;
    return new Promise<() => void>((resolve) => { releaseFactory = resolve; });
  };

  const first = slot.ensure(factory);
  const second = slot.ensure(factory);
  assert.equal(factoryCalls, 1);
  assert.equal(slot.active, true);
  releaseFactory?.(() => { cleanupCalls += 1; });
  await Promise.all([first, second]);

  await slot.ensure(factory);
  assert.equal(factoryCalls, 1);
  slot.clear();
  slot.clear();
  assert.equal(cleanupCalls, 1);
  assert.equal(slot.active, false);
});

test('async cleanup slot disposes a subscription that resolves after clear', async () => {
  const slot = new AsyncCleanupSlot();
  let cleanupCalls = 0;
  let releaseFactory: ((cleanup: () => void) => void) | null = null;
  const pending = slot.ensure(() => new Promise<() => void>((resolve) => {
    releaseFactory = resolve;
  }));

  slot.clear();
  releaseFactory?.(() => { cleanupCalls += 1; });
  await pending;
  assert.equal(cleanupCalls, 1);
  assert.equal(slot.active, false);
});

test('async cleanup slot can retry after initialization failure', async () => {
  const slot = new AsyncCleanupSlot();
  await assert.rejects(slot.ensure(async () => { throw new Error('listen failed'); }), /listen failed/);
  let cleanupCalls = 0;
  await slot.ensure(async () => () => { cleanupCalls += 1; });
  slot.clear();
  assert.equal(cleanupCalls, 1);
});

test('async cleanup slot contains cleanup errors so other teardown can continue', async () => {
  const slot = new AsyncCleanupSlot();
  await slot.ensure(async () => () => { throw new Error('cleanup failed'); });
  assert.doesNotThrow(() => slot.clear());
  assert.equal(slot.active, false);
});

test('repeating timer replaces an existing interval and stops idempotently', () => {
  let nextHandle = 1;
  const scheduled: Array<{ handle: number; milliseconds: number; callback: () => void }> = [];
  const canceled: number[] = [];
  const timer = new RepeatingTimer(
    (callback, milliseconds) => {
      const handle = nextHandle++;
      scheduled.push({ handle, milliseconds, callback });
      return handle as unknown as IntervalHandle;
    },
    (handle) => canceled.push(handle as unknown as number)
  );

  timer.start(() => {}, 500);
  timer.start(() => {}, 1000);
  assert.deepEqual(scheduled.map(({ handle, milliseconds }) => ({ handle, milliseconds })), [
    { handle: 1, milliseconds: 500 },
    { handle: 2, milliseconds: 1000 }
  ]);
  assert.deepEqual(canceled, [1]);
  timer.stop();
  timer.stop();
  assert.deepEqual(canceled, [1, 2]);
});

test('one-shot timer replaces pending work and releases its handle after firing', () => {
  let nextHandle = 1;
  const scheduled = new Map<number, () => void>();
  const canceled: number[] = [];
  const calls: string[] = [];
  const timer = new OneShotTimer(
    (callback) => {
      const handle = nextHandle++;
      scheduled.set(handle, callback);
      return handle as unknown as TimeoutHandle;
    },
    (handle) => {
      const numericHandle = handle as unknown as number;
      canceled.push(numericHandle);
      scheduled.delete(numericHandle);
    }
  );

  timer.schedule(() => calls.push('old'), 40);
  timer.schedule(() => calls.push('new'), 40);
  assert.deepEqual(canceled, [1]);
  assert.equal(scheduled.has(1), false);

  scheduled.get(2)?.();
  timer.cancel();
  assert.deepEqual(calls, ['new']);
  assert.deepEqual(canceled, [1]);
});

test('one-shot timer cancellation is idempotent and removes scheduled work', () => {
  const scheduled = new Map<number, () => void>();
  const canceled: number[] = [];
  const timer = new OneShotTimer(
    (callback) => {
      scheduled.set(7, callback);
      return 7 as unknown as TimeoutHandle;
    },
    (handle) => {
      const numericHandle = handle as unknown as number;
      canceled.push(numericHandle);
      scheduled.delete(numericHandle);
    }
  );
  let called = false;

  timer.schedule(() => { called = true; }, 15_000);
  timer.cancel();
  timer.cancel();
  assert.deepEqual(canceled, [7]);
  assert.equal(scheduled.has(7), false);
  assert.equal(called, false);
});
