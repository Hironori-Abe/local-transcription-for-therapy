import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BestEffortBrowserStorage,
  loadAudioMetadataDuration,
  waitForAudioSeek,
  type AudioMetadataElement,
  type KeyValueStorage
} from './browser-adapters.ts';

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test('browser storage reads and writes text, JSON objects, and flags', () => {
  const memory = new MemoryStorage();
  const storage = new BestEffortBrowserStorage(memory);

  assert.equal(storage.readText('missing'), null);
  assert.equal(storage.writeText('text', 'value'), true);
  assert.equal(storage.readText('text'), 'value');

  assert.equal(storage.writeJson('settings', { theme: 'dark' }), true);
  assert.deepEqual(storage.readObject('settings'), { theme: 'dark' });

  assert.equal(storage.readFlag('enabled'), false);
  assert.equal(storage.writeFlag('enabled'), true);
  assert.equal(storage.readFlag('enabled'), true);
});

test('browser storage migrates legacy values without overriding current values', () => {
  const memory = new MemoryStorage();
  const storage = new BestEffortBrowserStorage(memory);
  memory.values.set('legacy-settings', JSON.stringify({ theme: 'dark' }));
  memory.values.set('legacy-flag', '1');

  assert.deepEqual(
    storage.readObjectWithLegacy('settings', 'legacy-settings'),
    { theme: 'dark' }
  );
  assert.equal(memory.values.get('settings'), JSON.stringify({ theme: 'dark' }));
  assert.equal(storage.readFlagWithLegacy('flag', 'legacy-flag'), true);
  assert.equal(memory.values.get('flag'), '1');

  memory.values.set('settings', JSON.stringify({ theme: 'light' }));
  assert.deepEqual(
    storage.readObjectWithLegacy('settings', 'legacy-settings'),
    { theme: 'light' }
  );
});

class FakeSeekableAudio {
  private value = 0;
  readonly listeners = new Set<() => void>();
  throwOnSet = false;

  get currentTime(): number { return this.value; }
  set currentTime(value: number) {
    if (this.throwOnSet) throw new Error('seek rejected');
    this.value = value;
  }
  addEventListener(_type: 'seeked', listener: () => void): void { this.listeners.add(listener); }
  removeEventListener(_type: 'seeked', listener: () => void): void { this.listeners.delete(listener); }
  emitSeeked(): void { for (const listener of [...this.listeners]) listener(); }
}

test('audio seek waiter resolves on seeked and removes its listener', async () => {
  const audio = new FakeSeekableAudio();
  const pending = waitForAudioSeek(audio, 12.5, 1000);
  assert.equal(audio.currentTime, 12.5);
  assert.equal(audio.listeners.size, 1);
  audio.emitSeeked();
  await pending;
  assert.equal(audio.listeners.size, 0);
});

test('audio seek waiter releases its listener on timeout and assignment failure', async () => {
  const timeoutAudio = new FakeSeekableAudio();
  await waitForAudioSeek(timeoutAudio, 4, 1);
  assert.equal(timeoutAudio.listeners.size, 0);

  const failingAudio = new FakeSeekableAudio();
  failingAudio.throwOnSet = true;
  await assert.rejects(waitForAudioSeek(failingAudio, 4, 1000), /seek rejected/);
  assert.equal(failingAudio.listeners.size, 0);
});

test('browser storage preserves best-effort behavior for invalid and unavailable storage', () => {
  const throwingStorage: KeyValueStorage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('quota'); }
  };
  const storage = new BestEffortBrowserStorage(throwingStorage);

  assert.equal(storage.readText('key'), null);
  assert.equal(storage.readObject('key'), null);
  assert.equal(storage.writeText('key', 'value'), false);
  assert.equal(storage.writeJson('key', { value: 1 }), false);
  assert.equal(storage.writeFlag('key'), false);

  const unavailable = new BestEffortBrowserStorage(null);
  assert.equal(unavailable.readText('key'), null);
  assert.equal(unavailable.writeText('key', 'value'), false);
});

test('browser storage rejects malformed and non-object JSON values', () => {
  const memory = new MemoryStorage();
  const storage = new BestEffortBrowserStorage(memory);
  memory.values.set('malformed', '{');
  memory.values.set('null', 'null');
  memory.values.set('number', '42');

  assert.equal(storage.readObject('malformed'), null);
  assert.equal(storage.readObject('null'), null);
  assert.equal(storage.readObject('number'), null);
});

function fakeAudio(): AudioMetadataElement {
  return {
    preload: '',
    duration: Number.NaN,
    src: '',
    onloadedmetadata: null,
    onerror: null
  };
}

test('audio metadata loader resolves duration and releases browser resources', async () => {
  const audio = fakeAudio();
  const pending = loadAudioMetadataDuration('blob:audio', 1000, () => audio);
  assert.equal(audio.preload, 'metadata');
  assert.equal(audio.src, 'blob:audio');

  audio.duration = 12.5;
  audio.onloadedmetadata?.(new Event('loadedmetadata'));
  assert.equal(await pending, 12.5);
  assert.equal(audio.src, '');
  assert.equal(audio.onloadedmetadata, null);
  assert.equal(audio.onerror, null);
});

test('audio metadata loader rejects invalid duration, error, and timeout with cleanup', async () => {
  const invalidAudio = fakeAudio();
  const invalidPending = loadAudioMetadataDuration('blob:invalid', 1000, () => invalidAudio);
  invalidAudio.duration = 0;
  invalidAudio.onloadedmetadata?.(new Event('loadedmetadata'));
  await assert.rejects(invalidPending, /duration unavailable/);
  assert.equal(invalidAudio.src, '');

  const errorAudio = fakeAudio();
  const errorPending = loadAudioMetadataDuration('blob:error', 1000, () => errorAudio);
  errorAudio.onerror?.(new Event('error'));
  await assert.rejects(errorPending, /audio load failed/);
  assert.equal(errorAudio.src, '');

  const timeoutAudio = fakeAudio();
  await assert.rejects(
    loadAudioMetadataDuration('blob:timeout', 1, () => timeoutAudio),
    /audio metadata timeout/
  );
  assert.equal(timeoutAudio.src, '');
  assert.equal(timeoutAudio.onloadedmetadata, null);
  assert.equal(timeoutAudio.onerror, null);
});
