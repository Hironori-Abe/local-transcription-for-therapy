import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateDownloadProgressPercent,
  browserSetupStatus,
  browserVoiceInputPackStatus,
  needsFullSetup,
  projectSetupStatus,
  setupErrorProgress,
  unavailableSetupProjection,
  updateSetupProgress
} from './setup-state.ts';

test('download progress aggregation preserves zero handling and caps', () => {
  assert.equal(aggregateDownloadProgressPercent([]), null);
  assert.equal(aggregateDownloadProgressPercent([
    { downloadedBytes: 50, totalBytes: 100 },
    { downloadedBytes: 150, totalBytes: 300 },
    { downloadedBytes: 999 }
  ]), 50);
  assert.equal(aggregateDownloadProgressPercent([
    { downloadedBytes: -20, totalBytes: 100 }, { downloadedBytes: 300, totalBytes: 100 }
  ]), 100);
});

test('progress map updates are immutable and error entries are consistent', () => {
  const current = { first: { component: 'first', status: 'done' as const, message: 'ok' } };
  const next = updateSetupProgress(current, setupErrorProgress('_error', 'failed'));
  assert.notEqual(next, current);
  assert.equal(next.first, current.first);
  assert.deepEqual(next._error, { component: '_error', status: 'error', message: 'failed' });
});

test('setup is required only for the speech models of the Full edition', () => {
  const status = browserSetupStatus();
  const input = {
    editorOnlyBuild: false, tauriRuntime: true, setupChecked: true, status,
    transcriptionTabVisible: true
  };
  assert.equal(needsFullSetup(input), false);
  assert.equal(needsFullSetup({ ...input, editorOnlyBuild: true, status: null }), false);
  assert.equal(needsFullSetup({ ...input, tauriRuntime: false, status: null }), false);
  assert.equal(needsFullSetup({ ...input, setupChecked: false, status: null }), false);
  assert.equal(needsFullSetup({ ...input, status: null }), true);
  assert.equal(needsFullSetup({ ...input, status: { ...status, whisperTurbo: false } }), true);
  assert.equal(needsFullSetup({ ...input, status: { ...status, diarization: false } }), true);
  assert.equal(needsFullSetup({
    ...input, transcriptionTabVisible: false, status: { ...status, whisperTurbo: false, diarization: false }
  }), false);
});

test('setup status projections provide success, unavailable, and browser defaults', () => {
  const status = { ...browserSetupStatus(), diarization: false, diarizationExpectedPath: '/models/diar' };
  assert.deepEqual(projectSetupStatus(status), {
    diarizationExists: false,
    diarizationHasConfig: false,
    diarizationExpectedPath: '/models/diar',
    diarizationSetupVisible: true
  });
  assert.equal(unavailableSetupProjection().diarizationSetupVisible, true);
  assert.deepEqual(browserSetupStatus(), { whisperTurbo: true, diarization: true, diarizationExpectedPath: '' });
  assert.deepEqual(browserVoiceInputPackStatus(), { installed: false });
});

test('setup status projection reflects the refreshed post-download state', () => {
  const before = projectSetupStatus({
    ...browserSetupStatus(),
    diarization: false,
    diarizationExpectedPath: '/models/diar'
  });
  assert.equal(before.diarizationSetupVisible, true);

  const after = projectSetupStatus(browserSetupStatus());
  assert.equal(after.diarizationSetupVisible, false);
});
