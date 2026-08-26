/**
 * Linux GPU packages can finish installing before the first CUDA/ROCm context
 * is ready. The immediate bounded probe handles the usual case; this policy
 * describes the single delayed safety-net probe used after setup completes.
 */
export const DELAYED_GPU_RECHECK_DELAY_MS = 60_000;

export type DelayedGpuRecheckState = {
  platform: 'windows' | 'linux' | 'macos' | 'other' | 'unknown';
  buildVariant: 'cuda' | 'rocm' | 'cpu' | null;
  cudaAvailable: boolean | null;
  rocmAvailable: boolean | null;
  transcriptionRuntimeAvailable: boolean;
  noCudaEmulation: boolean;
};

export function shouldScheduleDelayedGpuRecheck(state: DelayedGpuRecheckState): boolean {
  if (
    state.platform !== 'linux'
    || (state.buildVariant !== 'cuda' && state.buildVariant !== 'rocm')
    || state.noCudaEmulation
  ) {
    return false;
  }
  return !isGpuRuntimeResolved(state);
}

export function isGpuRuntimeResolved(state: DelayedGpuRecheckState): boolean {
  const driverAvailable = state.buildVariant === 'rocm'
    ? state.rocmAvailable === true
    : state.cudaAvailable === true;
  return driverAvailable && state.transcriptionRuntimeAvailable === true;
}
