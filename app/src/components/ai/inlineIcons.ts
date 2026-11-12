import { BookCheck, Maximize2, Minimize2, Palette, PenLine, SpellCheck, Wand2, type LucideIcon } from 'lucide-react';
import type { InlineCommandId } from '../../lib/ai/inline';

export const INLINE_ICONS: Record<InlineCommandId, LucideIcon> = {
  polish: Wand2,
  proofread: SpellCheck,
  grammar: BookCheck,
  shorten: Minimize2,
  expand: Maximize2,
  tone: Palette,
  continue: PenLine,
};
