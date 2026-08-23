import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateDownloadProgressPercent,
  browserSetupStatus,
  browserVoiceInputPackStatus,
  downloadProgressBytesLabel,
  downloadProgressPercent,
  llmBackendInstallPlan,
  llmBackendLabel,
  needsFullSetup,
  projectSetupStatus,
  setupErrorProgress,
  unavailableSetupProjection,
  updateSetupProgress
} from './setup-state.ts';

test('download progress preserves zero handling, rounding, aggregation, and caps', () => {
  assert.equal(downloadProgressPercent(undefined), 0);
  assert.equal(downloadProgressPercent({ downloadedBytes: 50, totalBytes: 200 }), 25);
  assert.equal(downloadProgressPercent({ downloadedBytes: 300, totalBytes: 200 }), 100);
  assert.equal(downloadProgressBytesLabel({}), '');
  assert.equal(downloadProgressBytesLabel({ downloadedBytes: 1_048_576 }), '1 MB');
  assert.equal(downloadProgressBytesLabel({ downloadedBytes: 1_572_864, totalBytes: 3_145_728 }), '2 / 3 MB');
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

test('setup requirements preserve build-specific dependencies', () => {
  const status = browserSetupStatus();
  const input = {
    editorOnlyBuild: false, tauriRuntime: true, setupChecked: true, status,
    transcriptionTabVisible: true, aiProofreadBuild: true, buildVariant: 'cuda'
  };
  assert.equal(needsFullSetup(input), false);
  assert.equal(needsFullSetup({ ...input, editorOnlyBuild: true, status: null }), false);
  assert.equal(needsFullSetup({ ...input, setupChecked: false, status: null }), false);
  assert.equal(needsFullSetup({ ...input, status: null }), true);
  assert.equal(needsFullSetup({ ...input, status: { ...status, whisperTurbo: false } }), true);
  assert.equal(needsFullSetup({
    ...input, transcriptionTabVisible: false, status: { ...status, whisperTurbo: false, diarization: false }
  }), false);
  assert.equal(needsFullSetup({ ...input, status: { ...status, gemmaMtpGguf: false } }), true);
  assert.equal(needsFullSetup({
    ...input, buildVariant: 'rocm', status: { ...status, gemmaMtpGguf: false }
  }), false);
  // CPU版は後付けGemma/llama.cppを文字起こしの必須条件にしない。
  assert.equal(needsFullSetup({
    ...input,
    aiProofreadBuild: false,
    buildVariant: 'cpu',
    status: { ...status, gemmaGguf: false, gemmaMtpGguf: false, llmBackend: false }
  }), false);
});

test('setup status projections provide success, unavailable, and browser defaults', () => {
  const status = { ...browserSetupStatus(), diarization: false, diarizationExpectedPath: '/models/diar' };
  assert.deepEqual(projectSetupStatus(status), {
    llmBackendInstalled: true,
    diarizationExists: false,
    diarizationHasConfig: false,
    diarizationExpectedPath: '/models/diar',
    diarizationSetupVisible: true
  });
  assert.equal(unavailableSetupProjection().diarizationSetupVisible, true);
  assert.equal(browserSetupStatus().pythonEnv, true);
  assert.deepEqual(browserVoiceInputPackStatus(true), {
    installed: false, cpuBackendRequired: true, cpuBackend: false, cpuBackendExpectedPath: '',
    gemmaGguf: false, gemmaGgufExpectedPath: '', mmprojGguf: false, mmprojGgufExpectedPath: '',
    ffmpegRequired: true, ffmpeg: false, ffmpegExpectedPath: ''
  });
});

test('LLM backend install plan preserves primary and optional fallback ordering', () => {
  assert.deepEqual(llmBackendInstallPlan(true, false), {
    status: 'bundled',
    unavailable: false,
    primary: null,
    fallbacks: [],
    reason: 'CUDA版のllama-serverはアプリに同梱されています。見つからない場合はアプリを再インストールしてください。'
  });
  assert.deepEqual(llmBackendInstallPlan(false, true), {
    status: 'ready', unavailable: false,
    primary: 'llamacpp:rocm', fallbacks: ['llamacpp:vulkan']
  });
  assert.deepEqual(llmBackendInstallPlan(null, null), {
    status: 'checking', unavailable: false, primary: null, fallbacks: [],
    reason: 'CUDA / ROCm GPUランタイムを確認中です。判定が終わるまでダウンロードできません。'
  });
  const unavailable = llmBackendInstallPlan(false, false);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.unavailable, true);
  assert.equal(unavailable.primary, null);
  assert.deepEqual(unavailable.fallbacks, []);
  assert.match(unavailable.reason, /AI校正実行エンジン.*ダウンロード/);
  assert.equal(llmBackendLabel('llamacpp:cuda'), 'CUDA (NVIDIA)');
  assert.equal(llmBackendLabel('llamacpp:vulkan'), 'Vulkan');
  assert.equal(llmBackendLabel('llamacpp:rocm'), 'AMD GPU (ROCm)');
  assert.equal(llmBackendLabel('llamacpp:cpu'), 'CPU');
  assert.equal(llmBackendLabel(null), '未選択');
});
