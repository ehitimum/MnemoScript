import type { Editor as TiptapEditor } from '@tiptap/react';
import BottomSheet from './BottomSheet';
import FormatControls from '../controls/FormatControls';
import ReadAloudControls from '../controls/ReadAloudControls';
import DictationControls from '../controls/DictationControls';

interface Props {
  open: boolean;
  onClose: () => void;
  editor: TiptapEditor | null;
}

/** Mobile replacement for the desktop right panel — format, read-aloud and
 *  dictation in a thumb-friendly bottom sheet. Reuses the shared control groups. */
function ToolsSheet({ open, onClose, editor }: Props) {
  if (!open) return null;
  return (
    <BottomSheet onClose={onClose} title="Tools">
      <div className="flex flex-col gap-7 pt-1">
        <FormatControls editor={editor} size="lg" />
        <ReadAloudControls editor={editor} size="lg" />
        <DictationControls editor={editor} size="lg" />
      </div>
    </BottomSheet>
  );
}

export default ToolsSheet;
