export type CleanupCallback = () => void;

/**
 * 非同期に取得する購読解除関数を1つだけ所有する。
 * 同時に ensure されても生成処理は1回にまとめ、生成中に clear された場合は
 * 遅れて返った購読を即座に解除する。
 */
export class AsyncCleanupSlot {
  private cleanup: CleanupCallback | null = null;
  private pending: Promise<void> | null = null;
  private generation = 0;

  get active(): boolean {
    return this.cleanup !== null || this.pending !== null;
  }

  ensure(factory: () => Promise<CleanupCallback>): Promise<void> {
    if (this.cleanup) {
      return Promise.resolve();
    }
    if (this.pending) {
      return this.pending;
    }
    const generation = this.generation;
    const pending = factory()
      .then((cleanup) => {
        if (generation !== this.generation) {
          safelyCleanup(cleanup);
          return;
        }
        this.cleanup = cleanup;
      })
      .finally(() => {
        if (this.pending === pending) {
          this.pending = null;
        }
      });
    this.pending = pending;
    return pending;
  }

  clear(): void {
    this.generation += 1;
    this.pending = null;
    const cleanup = this.cleanup;
    this.cleanup = null;
    safelyCleanup(cleanup);
  }
}

function safelyCleanup(cleanup: CleanupCallback | null): void {
  if (!cleanup) {
    return;
  }
  try {
    cleanup();
  } catch {
    // 1つの解除失敗で、残りの終了処理を止めない。
  }
}

export type IntervalHandle = ReturnType<typeof setInterval>;
export type SetIntervalCallback = (callback: () => void, milliseconds: number) => IntervalHandle;
export type ClearIntervalCallback = (handle: IntervalHandle) => void;

/** 重複起動を防ぎ、再開時と終了時に必ず以前のintervalを解放する。 */
export class RepeatingTimer {
  private handle: IntervalHandle | null = null;
  private readonly schedule: SetIntervalCallback;
  private readonly cancel: ClearIntervalCallback;

  constructor(
    schedule: SetIntervalCallback = setInterval,
    cancel: ClearIntervalCallback = clearInterval
  ) {
    this.schedule = schedule;
    this.cancel = cancel;
  }

  start(callback: () => void, milliseconds: number): void {
    this.stop();
    this.handle = this.schedule(callback, milliseconds);
  }

  stop(): void {
    if (this.handle === null) {
      return;
    }
    this.cancel(this.handle);
    this.handle = null;
  }
}
