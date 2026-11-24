import type { Editor, Range } from '@tiptap/core';
import type { LucideIcon } from 'lucide-react';
import { INLINE_COMMANDS } from '../../lib/ai/inline';
import { INLINE_ICONS } from '../ai/inlineIcons';
import { inlineAi } from './AiTarget';
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code,
  Minus,
  Image as ImageIcon,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  CodeXml,
  RemoveFormatting,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
} from 'lucide-react';

export interface SlashItem {
  title: string;
  /**
   * Listed under a label: 'format' = text formatting, 'ai' = inline AI commands (only when the
   * project has an AI). Ungrouped items are blocks.
   */
  group?: 'format' | 'ai';
  description: string;
  icon: LucideIcon;
  keywords: string[];
  action: (editor: Editor, range: Range) => void;
}

export interface SlashOptions {
  onImage: (editor: Editor, range: Range) => void;
}

/** Inline AI commands (/polish, /proofread …). They act on the paragraph the slash was typed in. */
export function getAiSlashItems(): SlashItem[] {
  return INLINE_COMMANDS.map((c) => ({
    title: c.label,
    description: c.description,
    icon: INLINE_ICONS[c.id],
    keywords: [c.id, ...c.keywords],
    group: 'ai' as const,
    action: (e: Editor, r: Range) => {
      e.chain().focus().deleteRange(r).run();
      const ai = inlineAi(e);
      if (c.id === 'tone') ai?.openMenu({ tone: true });
      else ai?.start(c.id);
    },
  }));
}

type Chain = ReturnType<Editor['chain']>;

/**
 * A formatting command: removes the "/query" and turns the style on (or off) for what is typed
 * next, like pressing Ctrl+B. Alignment applies to the current paragraph.
 */
const fmt = (title: string, description: string, icon: LucideIcon, keywords: string[], apply: (c: Chain) => Chain): SlashItem => ({
  title,
  description,
  icon,
  keywords,
  group: 'format',
  action: (e, r) => {
    apply(e.chain().focus().deleteRange(r)).run();
  },
});

/** Bold, italic … under a "Format" label. */
export function getFormatSlashItems(): SlashItem[] {
  return [
    fmt('Bold', 'Strong emphasis · Ctrl+B', Bold, ['bold', 'strong', 'b'], (c) => c.toggleBold()),
    fmt('Italic', 'Emphasis · Ctrl+I', Italic, ['italic', 'emphasis', 'em', 'i'], (c) => c.toggleItalic()),
    fmt('Underline', 'Underlined text · Ctrl+U', Underline, ['underline', 'u'], (c) => c.toggleUnderline()),
    fmt('Strikethrough', 'Crossed-out text', Strikethrough, ['strike', 'strikethrough', 'del', 's'], (c) => c.toggleStrike()),
    fmt('Inline code', 'Monospaced words', CodeXml, ['inline', 'mono', 'code'], (c) => c.toggleCode()),
    fmt('Clear formatting', 'Back to plain text', RemoveFormatting, ['clear', 'plain', 'reset', 'remove'], (c) => c.unsetAllMarks()),
    fmt('Align left', 'Left-aligned paragraph', AlignLeft, ['left', 'align'], (c) => c.setTextAlign('left')),
    fmt('Align center', 'Centred paragraph', AlignCenter, ['center', 'centre', 'middle', 'align'], (c) => c.setTextAlign('center')),
    fmt('Align right', 'Right-aligned paragraph', AlignRight, ['right', 'align'], (c) => c.setTextAlign('right')),
    fmt('Justify', 'Justified paragraph', AlignJustify, ['justify', 'align'], (c) => c.setTextAlign('justify')),
  ];
}

/** The Notion-style command palette items, mapped to TipTap StarterKit nodes. */
export function getSlashItems(opts: SlashOptions): SlashItem[] {
  return [
    {
      title: 'Text',
      description: 'Plain paragraph',
      icon: Type,
      keywords: ['paragraph', 'body', 'p'],
      action: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run(),
    },
    {
      title: 'Heading 1',
      description: 'Large section title',
      icon: Heading1,
      keywords: ['title', 'h1', 'big'],
      action: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 1 }).run(),
    },
    {
      title: 'Heading 2',
      description: 'Medium section title',
      icon: Heading2,
      keywords: ['h2', 'subtitle'],
      action: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 2 }).run(),
    },
    {
      title: 'Heading 3',
      description: 'Small section title',
      icon: Heading3,
      keywords: ['h3'],
      action: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 3 }).run(),
    },
    {
      title: 'Bulleted list',
      description: 'Unordered list',
      icon: List,
      keywords: ['bullet', 'unordered', 'ul'],
      action: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
    },
    {
      title: 'Numbered list',
      description: 'Ordered list',
      icon: ListOrdered,
      keywords: ['ordered', 'ol', 'number'],
      action: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
    },
    {
      title: 'To-do list',
      description: 'Track tasks with checkboxes',
      icon: ListTodo,
      keywords: ['todo', 'todolist', 'task', 'tasks', 'checkbox', 'checklist', 'check', 'tick'],
      action: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
    },
    {
      title: 'Quote',
      description: 'Block quotation',
      icon: Quote,
      keywords: ['blockquote', 'citation'],
      action: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
    },
    {
      title: 'Code block',
      description: 'Monospaced code',
      icon: Code,
      keywords: ['code', 'snippet', 'pre'],
      action: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
    },
    {
      title: 'Divider',
      description: 'Horizontal rule',
      icon: Minus,
      keywords: ['hr', 'separator', 'line', 'rule'],
      action: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
    },
    {
      title: 'Image',
      description: 'Embed an image from disk',
      icon: ImageIcon,
      keywords: ['image', 'photo', 'picture', 'img', 'media'],
      action: (e, r) => opts.onImage(e, r),
    },
  ];
}
