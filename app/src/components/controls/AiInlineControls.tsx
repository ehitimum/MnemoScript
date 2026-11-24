import type { Editor as TiptapEditor } from '@tiptap/react';
import { INLINE_COMMANDS } from '../../lib/ai/inline';
import { inlineAi } from '../extensions/AiTarget';
import { INLINE_ICONS } from '../ai/inlineIcons';
import { ctlBtn, ctlIcon, ctlLabel, ctlStyle, type CtlSize } from './ctl';

interface Props {
  editor: TiptapEditor | null;
  size?: CtlSize;
  /** Called before a command starts (the phone closes the Tools sheet so the card is visible). */
  onStart?: () => void;
}

/** Inline AI commands (Polish, Proofread…) for the selection or the paragraph at the cursor. */
function AiInlineControls({ editor, size = 'sm', onStart }: Props) {
  // Only when the open project has an AI (the editor registered its inline controller).
  if (!inlineAi(editor)) return null;
  const btn = ctlBtn(size);
  const ic = ctlIcon(size);
  const run = (id: (typeof INLINE_COMMANDS)[number]['id']) => {
    onStart?.();
    const ai = inlineAi(editor);
    if (id === 'tone') ai?.openMenu({ tone: true });
    else ai?.start(id);
  };
  return (
    <div className="flex flex-col gap-2.5">
      <h4 className={ctlLabel}>AI</h4>
      <div className="grid grid-cols-2 gap-1.5">
        {INLINE_COMMANDS.map((c) => {
          const Icon = INLINE_ICONS[c.id];
          return (
            <button
              key={c.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(c.id)}
              title={c.description}
              style={ctlStyle(false)}
              className={`${btn} gap-2 font-medium justify-start px-2.5`}
            >
              <Icon className={`${ic} text-primary`} /> <span className="truncate">{c.label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-3xs text-muted-foreground/70 leading-relaxed">
        Works on the selected text, or the paragraph at the cursor. You see the result before anything changes.
      </p>
    </div>
  );
}

export default AiInlineControls;
