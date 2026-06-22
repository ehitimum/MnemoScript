import type { Editor, Range } from '@tiptap/core';
import type { LucideIcon } from 'lucide-react';
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
} from 'lucide-react';

export interface SlashItem {
  title: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
  action: (editor: Editor, range: Range) => void;
}

export interface SlashOptions {
  onImage: (editor: Editor, range: Range) => void;
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
