import type { Editor as TiptapEditor } from '@tiptap/react';
import { Volume2, Play, Pause, Square, Gauge } from 'lucide-react';
import { useReadAloud } from '../../lib/speech/useReadAloud';
import { ctlBtn, ctlIcon, ctlLabel, ctlStyle, type CtlSize } from './ctl';

interface Props {
  editor: TiptapEditor | null;
  size?: CtlSize;
}

/** Read-Aloud (TTS) controls — play/pause/stop, voice picker, speed. */
function ReadAloudControls({ editor, size = 'sm' }: Props) {
  const readAloud = useReadAloud(editor);
  const btn = ctlBtn(size);
  const ic = ctlIcon(size);

  return (
    <div className="flex flex-col gap-2.5">
      <h4 className={ctlLabel}>Read Aloud</h4>

      {!readAloud.supported ? (
        <p className="text-3xs text-muted-foreground/70 leading-relaxed">
          Text-to-speech isn’t available on this device.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() =>
                readAloud.status === 'playing'
                  ? readAloud.pause()
                  : readAloud.status === 'paused'
                    ? readAloud.resume()
                    : readAloud.play()
              }
              title={readAloud.status === 'playing' ? 'Pause' : readAloud.status === 'paused' ? 'Resume' : 'Play'}
              style={ctlStyle(readAloud.status !== 'idle')}
              className={`${btn} gap-2 font-medium`}
            >
              {readAloud.status === 'playing' ? (
                <>
                  <Pause className={ic} /> Pause
                </>
              ) : (
                <>
                  <Play className={ic} />
                  {readAloud.status === 'paused' ? 'Resume' : 'Play'}
                </>
              )}
            </button>
            <button
              onClick={() => readAloud.stop()}
              disabled={readAloud.status === 'idle'}
              title="Stop"
              style={ctlStyle(false)}
              className={`${btn} gap-2 font-medium ${readAloud.status === 'idle' ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <Square className={`${ic} fill-current`} /> Stop
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-foreground/80 flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-primary/80" /> Voice
            </label>
            <select
              className="w-full bg-secondary/40 border border-border/30 text-foreground text-xs rounded-lg px-2.5 py-2 focus:border-primary/50 outline-none cursor-pointer"
              value={readAloud.voiceURI ?? ''}
              onChange={(e) => readAloud.setVoice(e.target.value || null)}
            >
              <option value="">System default</option>
              {readAloud.voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs text-foreground/80">
              <label className="flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-primary/80" /> Speed
              </label>
              <span className="font-mono font-medium text-primary text-xs">{readAloud.rate.toFixed(1)}×</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              className="w-full accent-primary h-1.5 bg-secondary rounded-lg cursor-pointer"
              value={readAloud.rate}
              onChange={(e) => readAloud.setRate(parseFloat(e.target.value))}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default ReadAloudControls;
