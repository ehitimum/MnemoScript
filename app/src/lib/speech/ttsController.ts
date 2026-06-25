import type { Editor } from '@tiptap/core';
import { buildFlatText } from '../proseFlatText';
import { setReadAloudHighlight, clearReadAloudHighlight } from '../../components/extensions/ReadAloudHighlight';

export type TtsStatus = 'idle' | 'playing' | 'paused';

export interface TtsState {
  status: TtsStatus;
  /** Whether the WebView exposes speechSynthesis at all. */
  supported: boolean;
  voices: SpeechSynthesisVoice[];
  /** Selected voice URI, or null to use the engine default. */
  voiceURI: string | null;
  rate: number;
}

interface Sentence {
  /** The exact text handed to the utterance (boundary charIndex is relative to this). */
  text: string;
  /** Flat-text offset of `text[0]`, used to map word boundaries back to the doc. */
  flatStart: number;
  /** ProseMirror span for the sentence highlight. */
  from: number;
  to: number;
}

type Listener = (state: TtsState) => void;

const hasSynthesis = typeof window !== 'undefined' && 'speechSynthesis' in window;

/**
 * Drives Read-Aloud via the WebView's `speechSynthesis`. Splits the active text
 * (current selection, else whole document) into sentences, speaks them one at a
 * time, and pushes karaoke highlight ranges into the ReadAloudHighlight plugin —
 * sentence-level always, word-level where the engine emits boundary events.
 */
class TtsController {
  private editor: Editor | null = null;
  private listeners = new Set<Listener>();

  private status: TtsStatus = 'idle';
  private voices: SpeechSynthesisVoice[] = [];
  private voiceURI: string | null = null;
  private rate = 1;

  private sentences: Sentence[] = [];
  private index = 0;
  private current: SpeechSynthesisUtterance | null = null;
  /** Guards the `end` handler so stop()/replacement doesn't auto-advance. */
  private speakToken = 0;

  constructor() {
    if (hasSynthesis) {
      this.loadVoices();
      window.speechSynthesis.addEventListener?.('voiceschanged', this.loadVoices);
    }
  }

  // ── public API ─────────────────────────────────────────────────────────────

  attachEditor(editor: Editor | null) {
    if (editor === this.editor) return;
    // Switching documents/editors must not leave speech running on stale positions.
    this.stop();
    this.editor = editor;
  }

  getState(): TtsState {
    return {
      status: this.status,
      supported: hasSynthesis,
      voices: this.voices,
      voiceURI: this.voiceURI,
      rate: this.rate,
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  play() {
    if (!hasSynthesis || !this.editor) return;
    if (this.status === 'paused') {
      this.resume();
      return;
    }
    if (this.status === 'playing') return;

    this.sentences = this.collectSentences();
    if (this.sentences.length === 0) return;
    this.index = 0;
    this.status = 'playing';
    this.emit();
    this.speakCurrent();
  }

  pause() {
    if (!hasSynthesis || this.status !== 'playing') return;
    window.speechSynthesis.pause();
    this.status = 'paused';
    this.emit();
  }

  resume() {
    if (!hasSynthesis || this.status !== 'paused') return;
    window.speechSynthesis.resume();
    this.status = 'playing';
    this.emit();
  }

  stop() {
    if (!hasSynthesis) return;
    this.speakToken++; // invalidate any in-flight end handler
    window.speechSynthesis.cancel();
    this.current = null;
    this.sentences = [];
    this.index = 0;
    if (this.status !== 'idle') {
      this.status = 'idle';
      this.emit();
    }
    clearReadAloudHighlight(this.editor);
  }

  toggle() {
    if (this.status === 'playing') this.pause();
    else if (this.status === 'paused') this.resume();
    else this.play();
  }

  setRate(rate: number) {
    this.rate = rate;
    this.emit();
    // Apply mid-playback by restarting from the current sentence.
    if (this.status === 'playing') this.restartFromCurrent();
  }

  setVoice(uri: string | null) {
    this.voiceURI = uri;
    this.emit();
    if (this.status === 'playing') this.restartFromCurrent();
  }

  dispose() {
    this.stop();
    if (hasSynthesis) {
      window.speechSynthesis.removeEventListener?.('voiceschanged', this.loadVoices);
    }
    this.listeners.clear();
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private emit() {
    const state = this.getState();
    this.listeners.forEach((fn) => fn(state));
  }

  private loadVoices = () => {
    if (!hasSynthesis) return;
    this.voices = window.speechSynthesis.getVoices();
    if (this.voiceURI && !this.voices.some((v) => v.voiceURI === this.voiceURI)) {
      this.voiceURI = null;
    }
    this.emit();
  };

  private resolveVoice(): SpeechSynthesisVoice | null {
    if (this.voiceURI) {
      return this.voices.find((v) => v.voiceURI === this.voiceURI) ?? null;
    }
    return null; // let the engine pick its default
  }

  /** Split the active text into sentences with their doc positions. */
  private collectSentences(): Sentence[] {
    if (!this.editor) return [];
    const { doc, selection } = this.editor.state;
    const { text, map } = buildFlatText(doc);
    if (!text.trim()) return [];

    // Read the selection if the user has one, else the whole document.
    const hasSelection = !selection.empty;
    const selFrom = hasSelection ? selection.from : 1;
    const selTo = hasSelection ? selection.to : doc.content.size;

    const segments = segmentSentences(text);
    const out: Sentence[] = [];

    for (const seg of segments) {
      const spoken = seg.text.trim();
      if (!spoken) continue;
      // Re-anchor flat offsets to the trimmed text so boundary charIndex lines up.
      const lead = seg.text.length - seg.text.trimStart().length;
      const flatStart = seg.start + lead;
      const flatEnd = flatStart + spoken.length;

      const from = map[flatStart];
      const to = map[flatEnd];
      if (from == null || to == null || from >= to) continue;

      // Keep only sentences that fall within the active range.
      if (to <= selFrom || from >= selTo) continue;

      out.push({ text: spoken, flatStart, from, to });
    }
    return out;
  }

  private speakCurrent() {
    if (!hasSynthesis) return;
    const sentence = this.sentences[this.index];
    if (!sentence) {
      this.finish();
      return;
    }

    const token = ++this.speakToken;
    const utt = new SpeechSynthesisUtterance(sentence.text);
    utt.rate = this.rate;
    const voice = this.resolveVoice();
    if (voice) utt.voice = voice;

    utt.onstart = () => {
      if (token !== this.speakToken) return;
      setReadAloudHighlight(this.editor, { sentence: { from: sentence.from, to: sentence.to }, word: null });
    };

    utt.onboundary = (ev) => {
      if (token !== this.speakToken) return;
      if (ev.name && ev.name !== 'word') return;
      const wordFrom = this.posFromFlat(sentence.flatStart + ev.charIndex);
      const len = ev.charLength && ev.charLength > 0 ? ev.charLength : wordLengthAt(sentence.text, ev.charIndex);
      const wordTo = this.posFromFlat(sentence.flatStart + ev.charIndex + len);
      if (wordFrom != null && wordTo != null && wordFrom < wordTo) {
        setReadAloudHighlight(this.editor, {
          sentence: { from: sentence.from, to: sentence.to },
          word: { from: wordFrom, to: wordTo },
        });
      }
    };

    utt.onend = () => {
      if (token !== this.speakToken) return;
      this.index++;
      this.speakCurrent();
    };

    utt.onerror = () => {
      if (token !== this.speakToken) return;
      // Skip the offending sentence rather than stalling the whole read.
      this.index++;
      this.speakCurrent();
    };

    this.current = utt;
    window.speechSynthesis.speak(utt);
  }

  private restartFromCurrent() {
    if (!hasSynthesis) return;
    this.speakToken++;
    window.speechSynthesis.cancel();
    // speak() right after cancel() is flaky on some engines; defer a tick.
    setTimeout(() => {
      if (this.status === 'playing') this.speakCurrent();
    }, 0);
  }

  private finish() {
    this.status = 'idle';
    this.current = null;
    this.emit();
    clearReadAloudHighlight(this.editor);
  }

  /** Map a flat-text offset back to a ProseMirror position via the current doc map. */
  private posFromFlat(flat: number): number | null {
    if (!this.editor) return null;
    const { map } = buildFlatText(this.editor.state.doc);
    return map[flat] ?? null;
  }
}

// ── sentence segmentation ──────────────────────────────────────────────────────

interface Segment {
  text: string;
  start: number;
}

const SentenceSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'sentence' })
    : null;

function segmentSentences(text: string): Segment[] {
  if (SentenceSegmenter) {
    const out: Segment[] = [];
    for (const s of SentenceSegmenter.segment(text)) {
      out.push({ text: s.segment, start: s.index });
    }
    return out;
  }
  // Fallback: split on sentence-ending punctuation, keeping offsets.
  const out: Segment[] = [];
  const re = /[^.!?\n]+[.!?\n]*\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ text: m[0], start: m.index });
  }
  return out.length > 0 ? out : [{ text, start: 0 }];
}

/** When the engine omits charLength, measure to the next whitespace. */
function wordLengthAt(text: string, charIndex: number): number {
  const rest = text.slice(charIndex);
  const m = /^\S+/.exec(rest);
  return m ? m[0].length : 1;
}

/** Process-wide singleton; the editor is (re)attached per active document. */
export const ttsController = new TtsController();
