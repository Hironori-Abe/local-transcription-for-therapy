/**
 * Linux NVIDIA packages can finish installing before the first CUDA context
 * is ready.  The immediate bounded probe handles the usual case; this policy
 * describes the single delayed safety-net probe used after setup completes.
 */
export const DELAYED_GPU_RECHECK_DELAY_MS = 60_000;

export type DelayedGpuRecheckState = {
  platform: 'windows' | 'linux' | 'macos' | 'other' | 'unknown';
  buildVariant: 'cuda' | 'rocm' | 'cpu' | null;
  cudaAvailable: boolean | null;
  transcriptionRuntimeAvailable: boolean;
  noCudaEmulation: boolean;
};

export function shouldScheduleDelayedGpuRecheck(state: DelayedGpuRecheckState): boolean {
  if (state.platform !== 'linux' || state.buildVariant !== 'cuda' || state.noCudaEmulation) {
    return false;
  }
  return state.cudaAvailable !== true || state.transcriptionRuntimeAvailable !== true;
}

export function isGpuRuntimeResolved(state: DelayedGpuRecheckState): boolean {
  return state.cudaAvailable === true && state.transcriptionRuntimeAvailable === true;
}
