import test from 'node:test';
import assert from 'node:assert/strict';
import { TranscriptionPreparationQueue } from './transcription-preparation.ts';

test('only the latest queued file/settings are prepared; no transcription is invoked', async () => {
  const sent: (string | null)[] = [];
  const queue = new TranscriptionPreparationQueue<string>(async request => { sent.push(request); });
  queue.schedule('old-file');
  queue.schedule('new-file');
  await queue.settled();
  assert.deepEqual(sent, ['new-file']);
});

test('an in-flight preparation is followed by the latest request and discard in order', async () => {
  const sent: (string | null)[] = [];
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const queue = new TranscriptionPreparationQueue<string>(async request => {
    sent.push(request);
    if (request === 'first') await blocked;
  });
  queue.schedule('first');
  await Promise.resolve();
  queue.schedule('superseded-settings');
  queue.schedule('latest-settings');
  release();
  await queue.settled();
  queue.schedule(null);
  await queue.settled();
  assert.deepEqual(sent, ['first', 'latest-settings', null]);
});

test('failure does not poison later preparation or block normal start', async () => {
  const sent: (string | null)[] = [];
  const queue = new TranscriptionPreparationQueue<string>(async request => {
    sent.push(request);
    if (request === 'unavailable-model') throw new Error('not installed');
  });
  queue.schedule('unavailable-model');
  await queue.settled();
  queue.schedule('ready-model');
  await queue.settled();
  assert.deepEqual(sent, ['unavailable-model', 'ready-model']);
});
