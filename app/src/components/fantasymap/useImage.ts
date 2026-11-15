import { useEffect, useState } from 'react';

/**
 * Load an image URL into an HTMLImageElement for use as a Konva image.
 * Returns undefined until the image is ready.
 *
 * Decoded images are cached process-wide by URL. A generated map can hold
 * several hundred icons that share a handful of tinted SVG data-URLs; without
 * the cache every <ItemNode> decoded its own copy (slow first paint, and a
 * visible pop-in cascade after undo/redo or a style switch).
 */
const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const hit = cache.get(src);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(src);
  if (inflight) return inflight;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      cache.set(src, image);
      pending.delete(src);
      resolve(image);
    };
    image.onerror = () => {
      pending.delete(src);
      reject(new Error(`Failed to load image: ${src.slice(0, 80)}`));
    };
    image.src = src;
  });
  pending.set(src, p);
  return p;
}

export function useImage(src: string | undefined): HTMLImageElement | undefined {
  // Store the URL alongside the image so a changed `src` never shows a stale
  // picture for a frame (and so no synchronous setState is needed in the effect).
  const [loaded, setLoaded] = useState<{ src: string; img: HTMLImageElement } | null>(() => {
    const hit = src ? cache.get(src) : undefined;
    return hit && src ? { src, img: hit } : null;
  });

  useEffect(() => {
    if (!src) return;
    let active = true;
    loadImage(src)
      .then((img) => {
        if (active) setLoaded({ src, img });
      })
      .catch(() => {
        /* leave the previous/undefined image */
      });
    return () => {
      active = false;
    };
  }, [src]);

  if (!src) return undefined;
  if (loaded && loaded.src === src) return loaded.img;
  return cache.get(src);
}
