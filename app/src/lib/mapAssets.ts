import { toAssetUrl } from './assets';
import { iconDataUrl } from '../components/fantasymap/iconLibrary';
import type { MapItem } from '../components/fantasymap/mapTypes';

/**
 * Resolve a map item to a URL the canvas can draw:
 *   • library glyphs → a tinted SVG data-URL (recoloured per item.tint)
 *   • imported assets → a Tauri asset-protocol URL (via toAssetUrl)
 */
export function toItemUrl(item: Pick<MapItem, 'libId' | 'assetPath' | 'tint'>): string {
  if (item.libId) return iconDataUrl(item.libId, item.tint || '#3a2f23');
  if (item.assetPath) return toAssetUrl(item.assetPath);
  return '';
}
