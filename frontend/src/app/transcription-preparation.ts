/** Serialize native preparation commands and skip superseded queued selections.
 * Preparing never invokes run_transcription; failure leaves the normal start path.
 */
export class TranscriptionPreparationQueue<T> {
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();
  private readonly send: (request: T | null) => Promise<unknown>;

  constructor(send: (request: T | null) => Promise<unknown>) {
    this.send = send;
  }

  schedule(request: T | null): void {
    const generation = ++this.generation;
    this.tail = this.tail.then(async () => {
      if (generation === this.generation) await this.send(request);
    }).catch(() => { /* Speculation must not prevent normal transcription. */ });
  }

  settled(): Promise<void> {
    return this.tail;
  }
}
