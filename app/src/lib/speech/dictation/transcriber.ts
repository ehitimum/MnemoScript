/**
 * Main-thread handle to the Whisper transcription worker. Owns the Worker,
 * matches `transcribe()` calls to their results by id, and surfaces model
 * download/warmup progress.
 */

export interface ProgressInfo {
  status?: string;
  name?: string;
  file?: string;
  /** 0..100 while a file downloads. */
  progress?: number;
  loaded?: number;
  total?: number;
}

interface ProgressOut { type: 'progress'; payload: ProgressInfo }
interface ReadyOut { type: 'ready' }
interface ResultOut { type: 'result'; id: number; text: string }
interface ErrorOut { type: 'error'; id?: number; error: string }
type WorkerOut = ProgressOut | ReadyOut | ResultOut | ErrorOut;

export class Transcriber {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (t: string) => void; reject: (e: unknown) => void }>();
  private ready = false;
  private loadError: Error | null = null;
  private loadWaiters: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  onProgress?: (p: ProgressInfo) => void;

  constructor() {
    this.worker = new Worker(new URL('./transcriber.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerOut>) => this.handle(e.data);
    // A module-evaluation failure (e.g. a dep that won't load) surfaces here, not
    // as a posted message — make sure it doesn't leave load() hanging forever.
    this.worker.onerror = (e) => this.failLoad(new Error(e.message || 'Speech worker failed to load'));
  }

  private handle(msg: WorkerOut) {
    switch (msg.type) {
      case 'progress':
        this.onProgress?.(msg.payload);
        break;
      case 'ready':
        this.ready = true;
        this.loadWaiters.splice(0).forEach((w) => w.resolve());
        break;
      case 'result':
        this.pending.get(msg.id)?.resolve(msg.text);
        this.pending.delete(msg.id);
        break;
      case 'error':
        if (msg.id != null) {
          this.pending.get(msg.id)?.reject(new Error(msg.error));
          this.pending.delete(msg.id);
        } else {
          // A load-phase error (no request id). Reject load() AND any pending work
          // so the UI shows the failure instead of spinning indefinitely.
          this.failLoad(new Error(msg.error));
        }
        break;
    }
  }

  private failLoad(err: Error) {
    this.loadError = err;
    this.loadWaiters.splice(0).forEach((w) => w.reject(err));
    this.pending.forEach((p) => p.reject(err));
    this.pending.clear();
  }

  /** Load + warm up the model. Resolves when the worker reports ready, rejects on failure. */
  load(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.loadError) return Promise.reject(this.loadError);
    this.worker.postMessage({ type: 'load' });
    return new Promise((resolve, reject) => {
      this.loadWaiters.push({ resolve, reject });
    });
  }

  /** Transcribe one 16 kHz mono segment. The buffer is transferred (zero-copy). */
  transcribe(audio: Float32Array): Promise<string> {
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
    });
  }

  dispose() {
    this.worker.terminate();
    this.pending.clear();
    this.loadWaiters = [];
  }
}
