import type { Editor as TiptapEditor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  ListTodo,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
} from 'lucide-react';
import { ctlBtn, ctlIcon, ctlLabel, ctlStyle, type CtlSize } from './ctl';

interface Props {
  editor: TiptapEditor | null;
  size?: CtlSize;
}

/**
 * Text formatting controls (inline styles, lists, to-do, headings, alignment).
 * Presentational + theme-aware; shared by the desktop right panel and the mobile
 * Tools sheet. All actions go through the live TipTap `editor` commands.
 */
function FormatControls({ editor, size = 'sm' }: Props) {
  if (!editor) return null;
  const btn = ctlBtn(size);
  const ic = ctlIcon(size);

  return (
    <div className="flex flex-col gap-4">
      {/* Inline + lists */}
      <div className="flex flex-col gap-2.5">
        <h4 className={ctlLabel}>Format</h4>
        <div className="grid grid-cols-4 gap-1.5">
          <button onClick={() => editor.chain().focus().toggleBold().run()} title="Bold" style={ctlStyle(editor.isActive('bold'))} className={btn}>
            <Bold className={ic} />
          </button>
          <button onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic" style={ctlStyle(editor.isActive('italic'))} className={btn}>
            <Italic className={ic} />
          </button>
          <button onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline" style={ctlStyle(editor.isActive('underline'))} className={btn}>
            <Underline className={ic} />
          </button>
          <button onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list" style={ctlStyle(editor.isActive('bulletList'))} className={btn}>
            <List className={ic} />
          </button>
          <button onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list" style={ctlStyle(editor.isActive('orderedList'))} className={btn}>
            <ListOrdered className={ic} />
          </button>
          {([1, 2, 3] as const).map((level) => (
            <button
              key={level}
              onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
              title={`Heading ${level}`}
              style={ctlStyle(editor.isActive('heading', { level }))}
              className={`${btn} font-bold`}
            >
              H{level}
            </button>
          ))}
        </div>

        {/* To-do list — full width so it reads as its own action. */}
        <button
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          title="To-do list (or type /todo)"
          style={ctlStyle(editor.isActive('taskList'))}
          className={`${btn} w-full gap-2 font-medium`}
        >
          <ListTodo className={ic} />
          To-do List
        </button>
      </div>

      {/* Alignment */}
      <div className="flex flex-col gap-2.5">
        <h4 className={ctlLabel}>Alignment</h4>
        <div className="grid grid-cols-4 gap-1.5">
          <button onClick={() => editor.chain().focus().setTextAlign('left').run()} title="Align left" style={ctlStyle(editor.isActive({ textAlign: 'left' }))} className={btn}>
            <AlignLeft className={ic} />
          </button>
          <button onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Align center" style={ctlStyle(editor.isActive({ textAlign: 'center' }))} className={btn}>
            <AlignCenter className={ic} />
          </button>
          <button onClick={() => editor.chain().focus().setTextAlign('right').run()} title="Align right" style={ctlStyle(editor.isActive({ textAlign: 'right' }))} className={btn}>
            <AlignRight className={ic} />
          </button>
          <button onClick={() => editor.chain().focus().setTextAlign('justify').run()} title="Justify" style={ctlStyle(editor.isActive({ textAlign: 'justify' }))} className={btn}>
            <AlignJustify className={ic} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default FormatControls;
