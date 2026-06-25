import type { ThemeType } from '../App';
import type { Editor as TiptapEditor } from '@tiptap/react';
import {
  Sliders,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  ListTodo,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Baseline,
  Volume2,
  Play,
  Pause,
  Square,
  Gauge,
  Mic,
  MicOff,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useReadAloud } from '../lib/speech/useReadAloud';
import { useDictation } from '../lib/speech/useDictation';

interface RightSidebarProps {
  editor: TiptapEditor | null;
  isOpen: boolean;
  theme: ThemeType;
  editorFont: string;
  setEditorFont: (font: string) => void;
  editorSize: number;
  setEditorSize: (size: number) => void;
  lineHeight: number;
  setLineHeight: (lh: number) => void;
}

function RightSidebar({
  editor,
  isOpen,
  theme,
  editorFont,
  setEditorFont,
  editorSize,
  setEditorSize,
  lineHeight,
  setLineHeight,
}: RightSidebarProps) {
  // Called before the early return so hook order stays stable across renders.
  const readAloud = useReadAloud(editor);
  const dictation = useDictation(editor);

  if (!isOpen) return null;

  const getBtnStyle = (isActive: boolean) => {
    const isLight = theme === 'light';
    const activeBg = isLight ? '#0078d4' : 'var(--primary)';
    const activeColor = isLight ? '#ffffff' : 'var(--primary-foreground)';
    const baseBg = 'rgba(var(--secondary), 0.05)';
    const textColor = isLight && !isActive ? '#333' : 'inherit';

    return {
      background: isActive ? activeBg : baseBg,
      color: isActive ? activeColor : textColor,
    };
  };

  const iconBtn =
    'h-8 flex items-center justify-center rounded-lg border border-border/30 hover:bg-secondary/40 active:scale-95 transition-all cursor-pointer';

  const sectionLabel =
    'text-3xs font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase mb-1';

  return (
    <aside className="w-64 max-w-[85vw] shrink-0 h-full bg-sidebar border-l border-border/40 flex flex-col select-none transition-all duration-200 overflow-y-auto">
      {/* Sidebar Header */}
      <div className="h-10 flex items-center gap-2 px-4 border-b border-border/30">
        <Sliders className="w-3.5 h-3.5 text-primary" />
        <span className="text-3xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Text Controller
        </span>
      </div>

      <div className="p-4 flex flex-col gap-6">
        {editor && (
          <div className="flex flex-col gap-2.5">
            <h4 className={sectionLabel}>Formatting Options</h4>

            {/* Inline style actions */}
            <div className="grid grid-cols-4 gap-1.5">
              <button
                onClick={() => editor.chain().focus().toggleBold().run()}
                title="Bold (Ctrl+B)"
                style={getBtnStyle(editor.isActive('bold'))}
                className={iconBtn}
              >
                <Bold className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => editor.chain().focus().toggleItalic().run()}
                title="Italic (Ctrl+I)"
                style={getBtnStyle(editor.isActive('italic'))}
                className={iconBtn}
              >
                <Italic className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                title="Underline (Ctrl+U)"
                style={getBtnStyle(editor.isActive('underline'))}
                className={iconBtn}
              >
                <Underline className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                title="Bullet List"
                style={getBtnStyle(editor.isActive('bulletList'))}
                className={iconBtn}
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Ordered list + headings */}
            <div className="grid grid-cols-4 gap-1.5">
              <button
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                title="Numbered List"
                style={getBtnStyle(editor.isActive('orderedList'))}
                className={iconBtn}
              >
                <ListOrdered className="w-3.5 h-3.5" />
              </button>
              {([1, 2, 3] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
                  title={`Heading ${level} (Ctrl+${level})`}
                  style={getBtnStyle(editor.isActive('heading', { level }))}
                  className={`${iconBtn} text-3xs font-bold`}
                >
                  H{level}
                </button>
              ))}
            </div>

            {/* To-do list — Notes only. The right sidebar is rendered solely for
                text documents, so this stays out of mind maps / fantasy maps. */}
            <button
              onClick={() => editor.chain().focus().toggleTaskList().run()}
              title="To-do list (or type /todo)"
              style={getBtnStyle(editor.isActive('taskList'))}
              className={`${iconBtn} w-full gap-2 text-xs font-medium`}
            >
              <ListTodo className="w-3.5 h-3.5" />
              To-do List
            </button>
          </div>
        )}

        {/* Paragraph alignment */}
        {editor && (
          <div className="flex flex-col gap-2.5">
            <h4 className={sectionLabel}>Content Alignment</h4>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                onClick={() => editor.chain().focus().setTextAlign('left').run()}
                title="Align Left"
                style={getBtnStyle(editor.isActive({ textAlign: 'left' }))}
                className={iconBtn}
              >
                <AlignLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => editor.chain().focus().setTextAlign('center').run()}
                title="Align Center"
                style={getBtnStyle(editor.isActive({ textAlign: 'center' }))}
                className={iconBtn}
              >
                <AlignCenter className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => editor.chain().focus().setTextAlign('right').run()}
                title="Align Right"
                style={getBtnStyle(editor.isActive({ textAlign: 'right' }))}
                className={iconBtn}
              >
                <AlignRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => editor.chain().focus().setTextAlign('justify').run()}
                title="Justify"
                style={getBtnStyle(editor.isActive({ textAlign: 'justify' }))}
                className={iconBtn}
              >
                <AlignJustify className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Read Aloud (TTS) — Notes only, like the rest of this sidebar. */}
        {editor && (
          <div className="flex flex-col gap-2.5">
            <h4 className={sectionLabel}>Read Aloud</h4>

            {!readAloud.supported ? (
              <p className="text-3xs text-muted-foreground/70 leading-relaxed">
                Text-to-speech isn’t available on this device’s WebView.
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
                    title={
                      readAloud.status === 'playing'
                        ? 'Pause'
                        : readAloud.status === 'paused'
                          ? 'Resume'
                          : 'Play — reads the selection if any, else the whole document'
                    }
                    style={getBtnStyle(readAloud.status !== 'idle')}
                    className={`${iconBtn} gap-2 text-xs font-medium`}
                  >
                    {readAloud.status === 'playing' ? (
                      <>
                        <Pause className="w-3.5 h-3.5" /> Pause
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" />
                        {readAloud.status === 'paused' ? 'Resume' : 'Play'}
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => readAloud.stop()}
                    disabled={readAloud.status === 'idle'}
                    title="Stop"
                    className={`${iconBtn} gap-2 text-xs font-medium ${
                      readAloud.status === 'idle' ? 'opacity-40 cursor-not-allowed' : ''
                    }`}
                  >
                    <Square className="w-3 h-3 fill-current" /> Stop
                  </button>
                </div>

                {/* Voice picker */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-foreground/80 flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-primary/80" /> Voice
                  </label>
                  <select
                    className="w-full bg-secondary/40 border border-border/30 text-foreground text-xs rounded-lg px-2.5 py-1.5 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none cursor-pointer transition-all duration-200"
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

                {/* Speed slider */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs text-foreground/80">
                    <label className="flex items-center gap-1.5">
                      <Gauge className="w-3.5 h-3.5 text-primary/80" /> Speed
                    </label>
                    <span className="font-mono font-medium text-primary text-xs">
                      {readAloud.rate.toFixed(1)}×
                    </span>
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
        )}

        {/* Dictation (offline Voice-to-Text) — Notes only. */}
        {editor && (
          <div className="flex flex-col gap-2.5">
            <h4 className={sectionLabel}>Dictation</h4>

            {!dictation.supported ? (
              <p className="text-3xs text-muted-foreground/70 leading-relaxed">
                Microphone dictation isn’t available on this device’s WebView.
              </p>
            ) : (
              <>
                <button
                  onClick={() => dictation.toggle()}
                  disabled={dictation.status === 'loading'}
                  title={
                    dictation.status === 'listening'
                      ? 'Stop dictation'
                      : 'Start dictation (speech to text)'
                  }
                  style={getBtnStyle(dictation.status === 'listening')}
                  className={`${iconBtn} w-full gap-2 text-xs font-medium ${
                    dictation.status === 'loading' ? 'opacity-60 cursor-wait' : ''
                  }`}
                >
                  {dictation.status === 'loading' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading model…
                    </>
                  ) : dictation.status === 'listening' ? (
                    <>
                      <MicOff className="w-3.5 h-3.5" /> Stop Listening
                    </>
                  ) : (
                    <>
                      <Mic className="w-3.5 h-3.5" /> Start Dictation
                    </>
                  )}
                </button>

                {/* Model download / warmup progress (first run). */}
                {dictation.status === 'loading' && dictation.loadProgress > 0 && (
                  <div className="h-1.5 w-full rounded-full bg-secondary/60 overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-200"
                      style={{ width: `${Math.round(dictation.loadProgress * 100)}%` }}
                    />
                  </div>
                )}

                {/* Live status line. */}
                {dictation.status === 'listening' && (
                  <div className="flex items-center gap-2 text-3xs text-muted-foreground">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        dictation.speaking ? 'bg-red-500 animate-pulse' : 'bg-muted-foreground/40'
                      }`}
                    />
                    {dictation.transcribing
                      ? 'Transcribing…'
                      : dictation.speaking
                        ? 'Listening — speech detected'
                        : 'Listening…'}
                  </div>
                )}

                {/* Denoise toggle (stage ① gatekeeper). */}
                <label className="flex items-center gap-2 text-xs text-foreground/80 cursor-pointer group">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                    checked={dictation.denoise}
                    onChange={(e) => dictation.setDenoise(e.target.checked)}
                  />
                  <Sparkles className="w-3.5 h-3.5 text-primary/80" />
                  <span className="group-hover:text-primary transition-colors">Noise cleanup</span>
                </label>

                {dictation.error && (
                  <p className="text-3xs text-red-400/90 leading-relaxed">{dictation.error}</p>
                )}
                <p className="text-3xs text-muted-foreground/60 leading-relaxed">
                  Runs on-device. The first use downloads a small model, then works offline.
                </p>
              </>
            )}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <h4 className={sectionLabel}>Typography Layout</h4>

          {/* Font Size slider */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs text-foreground/80">
              <label className="flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5 text-primary/80" />
                Font Size
              </label>
              <span className="font-mono font-medium text-primary text-xs">{editorSize}px</span>
            </div>
            <input
              type="range"
              min="12"
              max="24"
              className="w-full accent-primary h-1.5 bg-secondary rounded-lg cursor-pointer"
              value={editorSize}
              onChange={(e) => setEditorSize(parseInt(e.target.value))}
            />
          </div>

          {/* Line Spacing slider */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs text-foreground/80">
              <label className="flex items-center gap-1.5">
                <Baseline className="w-3.5 h-3.5 text-primary/80" />
                Line Spacing
              </label>
              <span className="font-mono font-medium text-primary text-xs">
                {lineHeight.toFixed(1)}×
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="2.5"
              step="0.1"
              className="w-full accent-primary h-1.5 bg-secondary rounded-lg cursor-pointer"
              value={lineHeight}
              onChange={(e) => setLineHeight(parseFloat(e.target.value))}
            />
          </div>

          {/* Font Family selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-foreground/80">Font Family</label>
            <select
              className="w-full bg-secondary/40 border border-border/30 text-foreground text-xs rounded-lg px-2.5 py-1.5 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none cursor-pointer transition-all duration-200"
              value={editorFont}
              onChange={(e) => setEditorFont(e.target.value)}
            >
              <option value="Inter">Inter — clean sans</option>
              <option value="Georgia">Georgia — classic serif</option>
              <option value="'Times New Roman', serif">Times — manuscript serif</option>
              <option value="'Courier New', monospace">Courier — typewriter</option>
            </select>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default RightSidebar;
