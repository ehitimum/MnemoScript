import type { MicVAD } from '@ricky0123/vad-web';
import { getMicStream, isMicSupported, humanizeMicError } from './audioCapture';
import { Transcriber } from './transcriber';

export type DictationStatus = 'idle' | 'loading' | 'listening' | 'error';

export interface DictationState {
  /** Whether the device can capture a microphone at all. */
  supported: boolean;
  status: DictationStatus;
  /** Browser noise-suppression DSP on/off (stage ① denoise). */
  denoise: boolean;
  /** VAD currently hears speech. */
  speaking: boolean;
  /** One or more segments are being transcribed right now. */
  transcribing: boolean;
  /** Model load/warmup progress, 0..1. */
  loadProgress: number;
  error: string | null;
}

type Listener = (s: DictationState) => void;

/**
 * Orchestrates the two-stage offline dictation pipeline:
 *
 *   mic → [① browser denoise] → [② Silero VAD gate] → [Whisper worker] → text
 *
 * The VAD ("gatekeeper" model) drops silence, gaps and dud sounds and only emits
 * real speech segments; each segment is transcribed by the Whisper worker (the
 * "main" model) and handed to `onText`. Heavy libs are dynamically imported so
 * they stay out of the main bundle until dictation is first used.
 */
class DictationController {
  private listeners = new Set<Listener>();
  private vad: MicVAD | null = null;
  private transcriber: Transcriber | null = null;
  private stream: MediaStream | null = null;

  private status: DictationStatus = 'idle';
  private denoise = true;
  private speaking = false;
  private transcribing = 0;
  private loadProgress = 0;
  private error: string | null = null;

  /** Called with each finalized transcript segment. */
  onText?: (text: string) => void;

  // ── public API ───────────────────────────────────────────────────────────

  getState(): DictationState {
    return {
      supported: isMicSupported(),
      status: this.status,
      denoise: this.denoise,
      speaking: this.speaking,
      transcribing: this.transcribing > 0,
      loadProgress: this.loadProgress,
      error: this.error,
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  setDenoise(value: boolean) {
    if (value === this.denoise) return;
    this.denoise = value;
    this.emit();
    // The constraint is baked into the live stream, so re-acquire it.
    if (this.status === 'listening') void this.restart();
  }

  async start() {
    if (!isMicSupported()) {
      this.fail('Dictation is not available on this device’s WebView.');
      return;
    }
    if (this.status === 'listening' || this.status === 'loading') return;

    this.status = 'loading';
    this.error = null;
    this.emit();

    // Stage A — load the heavy libs + warm up the Whisper model.
    let MicVADCtor!: typeof import('@ricky0123/vad-web').MicVAD;
    try {
      ({ MicVAD: MicVADCtor } = await import('@ricky0123/vad-web'));
      if (!this.transcriber) {
        this.transcriber = new Transcriber();
        this.transcriber.onProgress = (p) => {
          if (typeof p.progress === 'number') {
            this.loadProgress = Math.min(1, Math.max(this.loadProgress, p.progress / 100));
            this.emit();
          }
        };
      }
      await this.transcriber.load();
      this.loadProgress = 1;
      this.emit();
    } catch (e) {
      console.error('[dictation] speech model failed to load', e);
      this.cleanupAudio();
      this.fail('Could not load the speech model. The first run needs internet to download it (then it works offline).');
      return;
    }

    // Stage B — open the mic and start the VAD gate.
    try {
      this.vad = await MicVADCtor.new({
        model: 'v5',
        baseAssetPath: '/vad/',
        onnxWASMBasePath: '/ort/',
        getStream: async () => {
          this.stream = await getMicStream({ denoise: this.denoise });
          return this.stream;
        },
        onSpeechStart: () => {
          this.speaking = true;
          this.emit();
        },
        onVADMisfire: () => {
          this.speaking = false;
          this.emit();
        },
        onSpeechEnd: async (audio: Float32Array) => {
          this.speaking = false;
          this.transcribing++;
          this.emit();
          try {
            const text = await this.transcriber!.transcribe(audio);
            if (text) this.onText?.(text);
          } catch (e) {
            console.error('[dictation] transcription failed', e);
          } finally {
            this.transcribing = Math.max(0, this.transcribing - 1);
            this.emit();
          }
        },
      });

      await this.vad.start();
      this.status = 'listening';
      this.emit();
    } catch (e) {
      console.error('[dictation] microphone / VAD failed to start', e);
      this.cleanupAudio();
      this.fail(humanizeMicError(e));
    }
  }

  async stop() {
    this.cleanupAudio();
    if (this.status !== 'idle') {
      this.status = 'idle';
      this.speaking = false;
      this.emit();
    }
  }

  async toggle() {
    if (this.status === 'listening' || this.status === 'loading') await this.stop();
    else await this.start();
  }

  dispose() {
    void this.stop();
    this.transcriber?.dispose();
    this.transcriber = null;
    this.listeners.clear();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async restart() {
    await this.stop();
    await this.start();
  }

  private cleanupAudio() {
    try {
      void this.vad?.destroy();
    } catch {
      /* ignore */
    }
    this.vad = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private fail(message: string) {
    this.error = message;
    this.status = 'error';
    this.emit();
  }

  private emit() {
    const state = this.getState();
    this.listeners.forEach((fn) => fn(state));
  }
}

/** Process-wide singleton; the editor binding lives in the useDictation hook. */
export const dictationController = new DictationController();
