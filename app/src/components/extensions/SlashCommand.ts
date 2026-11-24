import { Extension } from '@tiptap/core';
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import SlashMenu, { type SlashMenuRef } from '../SlashMenu';
import { getAiSlashItems, getFormatSlashItems, getSlashItems, type SlashItem, type SlashOptions } from './slashItems';
import { inlineAi } from './AiTarget';
import { placeFloating, visibleArea } from '../../lib/floating';

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
        items: ({ query, editor }) => {
          const all = [...getSlashItems(this.options), ...getFormatSlashItems(), ...(inlineAi(editor) ? getAiSlashItems() : [])];
          const q = query.toLowerCase();
          if (!q) return all;
          return all.filter(
            (i) => i.title.toLowerCase().includes(q) || i.keywords.some((k) => k.includes(q)),
          );
        },
        render: () => {
          let component: ReactRenderer<SlashMenuRef> | null = null;
          let popup: HTMLDivElement | null = null;

          const position = (props: SuggestionProps<SlashItem>) => {
            const rect = props.clientRect?.();
            if (!popup || !rect) return;
            // Below the caret when it fits, else above it (typing on the last line), never off
            // an edge or under the phone keyboard.
            const area = visibleArea(props.editor.view.dom.closest('.mn-editor-scroll'));
            const menu = popup.querySelector<HTMLElement>('.slash-menu') ?? popup;
            menu.style.maxHeight = ''; // measure the natural height (CSS caps it at 340px)
            const p = placeFloating(
              { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.left + 280 },
              Math.min(menu.offsetWidth || 280, 320),
              menu.offsetHeight || 320,
              area,
              'target',
              6,
            );
            popup.style.left = `${Math.round(p.left)}px`;
            popup.style.top = `${Math.round(p.top)}px`;
            menu.style.maxHeight = `${Math.round(Math.min(340, p.maxHeight))}px`;
          };

          return {
            onStart: (props: SuggestionProps<SlashItem>) => {
              component = new ReactRenderer(SlashMenu, { props, editor: props.editor });
              popup = document.createElement('div');
              popup.className = 'slash-popup';
              popup.appendChild(component.element);
              document.body.appendChild(popup);
              position(props);
              requestAnimationFrame(() => position(props));
            },
            onUpdate: (props: SuggestionProps<SlashItem>) => {
              component?.updateProps(props);
              // The list shrinks while filtering: place it once React has rendered the new size.
              requestAnimationFrame(() => position(props));
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
