import { convertFileSrc } from '@tauri-apps/api/core';

/**
 * Turn an on-disk absolute path into a URL the webview can load via Tauri's
 * asset protocol. URLs that are already web/data/blob/asset URLs are returned
 * untouched. We store raw paths in document content (portable) and resolve to
 * asset URLs only at render time.
 */
export function toAssetUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return pathOrUrl;
  if (/^(https?:|data:|blob:|asset:)/i.test(pathOrUrl)) return pathOrUrl;
  try {
    return convertFileSrc(pathOrUrl);
  } catch {
    return pathOrUrl;
  }
}

/** Rewrite every <img src> in an HTML string to a loadable asset URL. */
export function resolveImagesInHtml(html: string): string {
  if (typeof document === 'undefined') return html;
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    const resolved = toAssetUrl(src);
    if (resolved !== src) img.setAttribute('src', resolved);
  });
  return div.innerHTML;
}
