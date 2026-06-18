import { useEffect, useState } from 'react';

/**
 * Load an image URL into an HTMLImageElement for use as a Konva image.
 * Returns undefined until the image is ready. Mirrors the `use-image` package
 * but without the extra dependency.
 */
export function useImage(src: string | undefined): HTMLImageElement | undefined {
  const [img, setImg] = useState<HTMLImageElement | undefined>(undefined);
  useEffect(() => {
    if (!src) {
      setImg(undefined);
      return;
    }
    const image = new Image();
    image.crossOrigin = 'anonymous';
    let active = true;
    image.onload = () => active && setImg(image);
    image.onerror = () => active && setImg(undefined);
    image.src = src;
    return () => {
      active = false;
    };
  }, [src]);
  return img;
}
