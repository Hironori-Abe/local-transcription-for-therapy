import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DELAYED_GPU_RECHECK_DELAY_MS,
  isGpuRuntimeResolved,
  shouldScheduleDelayedGpuRecheck,
  type DelayedGpuRecheckState
} from './gpu-runtime-recheck.ts';

const linuxNvidia: DelayedGpuRecheckState = {
  platform: 'linux',
  buildVariant: 'cuda',
  cudaAvailable: false,
  rocmAvailable: false,
  transcriptionRuntimeAvailable: false,
  noCudaEmulation: false
};

test('delayed GPU recheck is a single one-minute safety net for unresolved Linux NVIDIA setup', () => {
  assert.equal(DELAYED_GPU_RECHECK_DELAY_MS, 60_000);
  assert.equal(shouldScheduleDelayedGpuRecheck(linuxNvidia), true);
  assert.equal(shouldScheduleDelayedGpuRecheck({
    ...linuxNvidia,
    cudaAvailable: true,
    transcriptionRuntimeAvailable: false
  }), true);
  assert.equal(shouldScheduleDelayedGpuRecheck({
    ...linuxNvidia,
    cudaAvailable: true,
    transcriptionRuntimeAvailable: true
  }), false);
});

test('delayed GPU recheck supports Linux AMD and is disabled for Windows, CPU, and emulation', () => {
  assert.equal(shouldScheduleDelayedGpuRecheck({
    ...linuxNvidia,
    buildVariant: 'rocm',
    rocmAvailable: false
  }), true);
  assert.equal(shouldScheduleDelayedGpuRecheck({
    ...linuxNvidia,
    buildVariant: 'rocm',
    rocmAvailable: true,
    transcriptionRuntimeAvailable: true
  }), false);
  for (const state of [
    { ...linuxNvidia, platform: 'windows' as const },
    { ...linuxNvidia, buildVariant: 'cpu' as const },
    { ...linuxNvidia, noCudaEmulation: true }
  ]) {
    assert.equal(shouldScheduleDelayedGpuRecheck(state), false);
  }
});

test('GPU runtime is resolved only when both CUDA and transcription probes succeed', () => {
  assert.equal(isGpuRuntimeResolved({
    ...linuxNvidia,
    cudaAvailable: true,
    transcriptionRuntimeAvailable: true
  }), true);
  assert.equal(isGpuRuntimeResolved({ ...linuxNvidia, cudaAvailable: true }), false);
  assert.equal(isGpuRuntimeResolved({
    ...linuxNvidia,
    transcriptionRuntimeAvailable: true
  }), false);
  assert.equal(isGpuRuntimeResolved({
    ...linuxNvidia,
    buildVariant: 'rocm',
    rocmAvailable: true,
    transcriptionRuntimeAvailable: true
  }), true);
});

test('vulkan build is resolved by the bundled engines alone and never schedules a delayed recheck', () => {
  const vulkan: DelayedGpuRecheckState = {
    ...linuxNvidia,
    buildVariant: 'vulkan',
    transcriptionRuntimeAvailable: true
  };
  assert.equal(isGpuRuntimeResolved(vulkan), true);
  assert.equal(isGpuRuntimeResolved({ ...vulkan, transcriptionRuntimeAvailable: false }), false);
  assert.equal(shouldScheduleDelayedGpuRecheck({ ...vulkan, transcriptionRuntimeAvailable: false }), false);
});
