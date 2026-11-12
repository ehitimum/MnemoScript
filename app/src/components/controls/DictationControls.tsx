import type { Editor as TiptapEditor } from '@tiptap/react';
import { Mic, MicOff, Loader2, Sparkles } from 'lucide-react';
import { useDictation } from '../../lib/speech/useDictation';
import { ctlBtn, ctlIcon, ctlLabel, ctlStyle, type CtlSize } from './ctl';

interface Props {
  editor: TiptapEditor | null;
  size?: CtlSize;
}

/** Offline Voice-to-Text controls — mic toggle, denoise, model progress, status. */
function DictationControls({ editor, size = 'sm' }: Props) {
  const dictation = useDictation(editor);
  const btn = ctlBtn(size);
  const ic = ctlIcon(size);

  return (
    <div className="flex flex-col gap-2.5">
      <h4 className={ctlLabel}>Dictation</h4>

      {!dictation.supported ? (
        <p className="text-3xs text-muted-foreground/70 leading-relaxed">
          Microphone dictation isn’t available on this device.
        </p>
      ) : (
        <>
          <button
            onClick={() => dictation.toggle()}
            disabled={dictation.status === 'loading'}
            title={dictation.status === 'listening' ? 'Stop dictation' : 'Start dictation'}
            style={ctlStyle(dictation.status === 'listening')}
            className={`${btn} w-full gap-2 font-medium ${dictation.status === 'loading' ? 'opacity-60 cursor-wait' : ''}`}
          >
            {dictation.status === 'loading' ? (
              <>
                <Loader2 className={`${ic} animate-spin`} /> Loading model…
              </>
            ) : dictation.status === 'listening' ? (
              <>
                <MicOff className={ic} /> Stop Listening
              </>
            ) : (
              <>
                <Mic className={ic} /> Start Dictation
              </>
            )}
          </button>

          {dictation.status === 'loading' && dictation.loadProgress > 0 && (
            <div className="h-1.5 w-full rounded-full bg-secondary/60 overflow-hidden">
              <div className="h-full bg-primary transition-all duration-200" style={{ width: `${Math.round(dictation.loadProgress * 100)}%` }} />
            </div>
          )}

          {dictation.status === 'listening' && (
            <div className="flex items-center gap-2 text-3xs text-muted-foreground">
              <span className={`w-2 h-2 rounded-full ${dictation.speaking ? 'bg-red-500 animate-pulse' : 'bg-muted-foreground/40'}`} />
              {dictation.transcribing ? 'Transcribing…' : dictation.speaking ? 'Listening — speech detected' : 'Listening…'}
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-foreground/80 cursor-pointer group">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
              checked={dictation.denoise}
              onChange={(e) => dictation.setDenoise(e.target.checked)}
            />
            <Sparkles className="w-3.5 h-3.5 text-primary/80" />
            <span className="group-hover:text-primary transition-colors">Noise cleanup</span>
          </label>

          {dictation.error && <p className="text-3xs text-red-400/90 leading-relaxed">{dictation.error}</p>}
          <p className="text-3xs text-muted-foreground/60 leading-relaxed">Runs on-device, fully offline.</p>
        </>
      )}
    </div>
  );
}

export default DictationControls;
