import Image from '@tiptap/extension-image';
import { toAssetUrl } from '../../lib/assets';

/**
 * Image node that stores the raw on-disk path in `src` (kept in the saved
 * document for portability) but renders it through Tauri's asset protocol via a
 * node view, so the live editor actually displays the picture.
 */
export const ImageWithAsset = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('img');
      const src = (node.attrs.src as string) || '';
      dom.src = toAssetUrl(src);
      dom.setAttribute('data-src', src);
      if (node.attrs.alt) dom.alt = node.attrs.alt as string;
      if (node.attrs.title) dom.title = node.attrs.title as string;
      dom.className = 'editor-image';
      return { dom };
    };
  },
});
