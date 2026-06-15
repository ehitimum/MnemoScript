import { Extension } from '@tiptap/core';
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import SlashMenu, { type SlashMenuRef } from '../SlashMenu';
import { getSlashItems, type SlashItem, type SlashOptions } from './slashItems';

/**
 * Notion-style "/" command menu. Built on @tiptap/suggestion; the floating menu
 * is a React component (SlashMenu) mounted via ReactRenderer and positioned at
 * the caret using the suggestion's clientRect — the same manual-positioning
 * approach already used for the grammar popover and smooth caret in Editor.tsx,
 * so we avoid pulling in tippy.js.
 */
export const SlashCommand = Extension.create<SlashOptions>({
  name: 'slashCommand',

  addOptions() {
    return { onImage: () => {} };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        allowSpaces: false,
        command: ({ editor, range, props }) => {
          props.action(editor, range);
        },
        items: ({ query }) => {
          const all = getSlashItems(this.options);
          const q = query.toLowerCase();
          if (!q) return all;
          return all.filter(
            (i) => i.title.toLowerCase().includes(q) || i.keywords.some((k) => k.includes(q)),
          );
        },
        render: () => {
          let component: ReactRenderer<SlashMenuRef> | null = null;
          let popup: HTMLDivElement | null = null;

          const position = (clientRect?: (() => DOMRect | null) | null) => {
            if (!popup || !clientRect) return;
            const rect = clientRect();
            if (!rect) return;
            // Keep the menu on-screen vertically.
            const top = rect.bottom + 6;
            popup.style.left = `${rect.left}px`;
            popup.style.top = `${top}px`;
          };

          return {
            onStart: (props: SuggestionProps<SlashItem>) => {
              component = new ReactRenderer(SlashMenu, { props, editor: props.editor });
              popup = document.createElement('div');
              popup.className = 'slash-popup';
              popup.appendChild(component.element);
              document.body.appendChild(popup);
              position(props.clientRect);
            },
            onUpdate: (props: SuggestionProps<SlashItem>) => {
              component?.updateProps(props);
              position(props.clientRect);
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === 'Escape') {
                popup?.remove();
                return true;
              }
              return component?.ref?.onKeyDown({ event: props.event }) ?? false;
            },
            onExit: () => {
              popup?.remove();
              popup = null;
              component?.destroy();
              component = null;
            },
          };
        },
      }),
    ];
  },
});
