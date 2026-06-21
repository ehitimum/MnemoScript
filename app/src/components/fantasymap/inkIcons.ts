/**
 * Hand-authored ink map icons — our own cohesive line-art set for the
 * 'handdrawn' style (parchment / fantasy-atlas look). These are original SVGs
 * drawn in a consistent stroke-only style so they read like a single artist's
 * hand and tile into "ranges" (clustered mountains, forests, town blocks).
 *
 * They plug into the SAME pipeline as the bundled game-icons set: each is an
 * `IconType` component, so the library palette, search, recolouring and the
 * Konva rasteriser (`iconDataUrl`) all work unchanged. Ids are namespaced with
 * an `ink-` prefix and grouped under the 'Hand-drawn' category.
 *
 * Style rules (keep new icons consistent):
 *   • viewBox 0 0 100 100, ground objects "sit" near y≈84.
 *   • stroke = currentColor (recoloured per item.tint), fill = none by default;
 *     a path may opt into a solid with fill="currentColor".
 *   • round caps/joins, medium weight — see `inkIcon()` defaults.
 */
import { createElement } from 'react';
import type { CSSProperties } from 'react';
import type { IconType } from 'react-icons';
import type { IconDef } from './iconLibrary';

/** Default ink colour for scattered/stamped hand-drawn icons (dark sepia). */
export const INK_DARK = '#3a2a1c';

interface InkProps { size?: string | number; className?: string; style?: CSSProperties; color?: string }

/** Wrap a raw inner-SVG string into an `IconType` matching react-icons' shape. */
function inkIcon(inner: string): IconType {
  const Comp = (props: InkProps) =>
    createElement('svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: '0 0 100 100',
      width: props.size ?? '1em',
      height: props.size ?? '1em',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 4.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      className: props.className,
      style: props.style,
      dangerouslySetInnerHTML: { __html: inner },
    });
  return Comp as unknown as IconType;
}

function def(id: string, name: string, inner: string, tags: string[]): IconDef {
  return { id, name, category: 'Hand-drawn', Icon: inkIcon(inner), tags };
}

/* ── the set ─────────────────────────────────────────────────────────────── */
export const INK_ICONS: IconDef[] = [
  // Terrain / relief ────────────────────────────────────────────────────
  def('ink-mountains', 'Mountains', // a small range of peaks
    '<path d="M5 82 L24 44 L37 66 L55 33 L68 60 L95 82"/>' +
    '<path d="M24 44 L18 61 M24 44 L31 61"/>' +
    '<path d="M55 33 L47 57 M55 33 L63 57"/>',
    ['mountain', 'peak', 'range', 'alps', 'ridge']),
  def('ink-mountain', 'Peak', // single mountain with snowcap
    '<path d="M10 84 L46 28 L86 84"/>' +
    '<path d="M46 28 L35 58 M46 28 L57 58"/>' +
    '<path d="M38 45 L46 37 L54 45"/>',
    ['mountain', 'peak', 'summit']),
  def('ink-hills', 'Hills',
    '<path d="M6 72 Q22 48 40 72"/>' +
    '<path d="M34 74 Q56 46 80 74"/>' +
    '<path d="M68 72 Q82 58 96 72"/>',
    ['hill', 'highland', 'downs']),
  def('ink-volcano', 'Volcano',
    '<path d="M14 84 L40 40 L60 40 L86 84"/>' +
    '<path d="M40 41 Q50 34 60 41"/>' +
    '<path d="M45 40 Q43 26 49 17 M55 40 Q57 28 51 17"/>',
    ['lava', 'fire', 'eruption', 'mount']),
  def('ink-dunes', 'Dunes',
    '<path d="M6 62 Q28 46 50 62 T94 62"/>' +
    '<path d="M12 80 Q38 64 64 80 T98 78"/>' +
    '<circle cx="76" cy="30" r="8"/>',
    ['desert', 'sand', 'arid', 'wastes']),
  def('ink-cactus', 'Cactus',
    '<path d="M50 84 V40"/>' +
    '<path d="M50 60 Q36 60 36 47 V39"/>' +
    '<path d="M50 54 Q66 54 66 42 V34"/>' +
    '<path d="M40 84 H60"/>',
    ['desert', 'arid', 'plant']),

  // Forest / nature ─────────────────────────────────────────────────────
  def('ink-forest', 'Forest', // conifer cluster
    '<path d="M18 66 L26 40 L34 66 Z"/>' +
    '<path d="M40 60 L50 30 L60 60 Z"/>' +
    '<path d="M66 66 L74 40 L82 66 Z"/>' +
    '<path d="M30 84 L38 60 L46 84 Z"/>' +
    '<path d="M54 84 L62 60 L70 84 Z"/>',
    ['woods', 'trees', 'pines', 'taiga']),
  def('ink-pine', 'Pine tree',
    '<path d="M50 88 V72"/>' +
    '<path d="M34 72 L50 22 L66 72 Z"/>' +
    '<path d="M39 56 L50 38 L61 56"/>',
    ['tree', 'conifer', 'fir']),
  def('ink-tree', 'Tree',
    '<path d="M50 86 V58"/>' +
    '<path d="M50 62 C30 62 28 38 50 32 C72 38 70 62 50 62 Z"/>',
    ['tree', 'oak', 'deciduous', 'grove']),
  def('ink-swamp', 'Swamp',
    '<path d="M12 74 H88"/>' +
    '<path d="M40 82 H78"/>' +
    '<path d="M26 74 Q24 56 28 50 M32 74 Q36 58 32 52"/>' +
    '<path d="M58 78 Q56 62 60 56 M64 78 Q68 62 64 56"/>',
    ['marsh', 'bog', 'wetland', 'reeds']),

  // Settlements ─────────────────────────────────────────────────────────
  def('ink-hut', 'Hut',
    '<path d="M22 84 L50 56 L78 84"/>' +
    '<path d="M30 84 V72 H70 V84"/>',
    ['cottage', 'shack', 'hovel', 'camp']),
  def('ink-village', 'Village',
    '<path d="M16 78 L30 63 L44 78"/>' +
    '<path d="M20 78 V66 H40 V78"/>' +
    '<path d="M27 78 V71 H33 V78"/>' +
    '<path d="M52 82 L63 71 L74 82"/>' +
    '<path d="M55 82 V73 H71 V82"/>',
    ['hamlet', 'houses', 'town']),
  def('ink-town', 'Town',
    '<path d="M14 80 L26 67 L38 80"/>' +
    '<path d="M18 80 V69 H34 V80"/>' +
    '<path d="M44 82 L54 73 L64 82"/>' +
    '<path d="M47 82 V75 H61 V82"/>' +
    '<path d="M70 82 V50 H84 V82"/>' +
    '<path d="M70 50 L77 42 L84 50"/>' +
    '<path d="M74 64 H80"/>',
    ['town', 'borough', 'houses', 'tower']),
  def('ink-city', 'City',
    '<path d="M16 84 V40 H32 V84"/>' +
    '<path d="M68 84 V40 H84 V84"/>' +
    '<path d="M32 84 V54 H68 V84"/>' +
    '<path d="M42 84 V66 Q50 58 58 66 V84"/>' +
    '<path d="M16 40 V34 H21 V40 M27 40 V34 H32 V40"/>' +
    '<path d="M68 40 V34 H73 V40 M79 40 V34 H84 V40"/>' +
    '<path d="M32 54 V49 H38 V54 M46 54 V49 H54 V54 M62 54 V49 H68 V54"/>',
    ['city', 'capital', 'walls', 'metropolis']),
  def('ink-castle', 'Castle',
    '<path d="M18 84 V44 H34 V84"/>' +
    '<path d="M66 84 V44 H82 V84"/>' +
    '<path d="M34 84 V56 H66 V84"/>' +
    '<path d="M44 56 V40 H56 V56"/>' +
    '<path d="M44 84 V70 Q50 63 56 70 V84"/>' +
    '<path d="M56 40 V28"/>' +
    '<path d="M56 29 L70 33 L56 37 Z" fill="currentColor"/>' +
    '<path d="M18 44 V38 H23 V44 M29 44 V38 H34 V44 M66 44 V38 H71 V44 M77 44 V38 H82 V44"/>',
    ['fort', 'keep', 'stronghold', 'fortress']),
  def('ink-tower', 'Tower',
    '<path d="M38 86 V42 H62 V86"/>' +
    '<path d="M33 42 L50 22 L67 42 Z"/>' +
    '<path d="M45 56 H55 V70 H45 Z"/>',
    ['tower', 'watch', 'wizard', 'spire']),

  // Sites ───────────────────────────────────────────────────────────────
  def('ink-ruins', 'Ruins',
    '<path d="M16 84 H84"/>' +
    '<path d="M24 84 V50 L29 46 L34 50 V84"/>' +
    '<path d="M44 84 V42 H56 V60"/>' +
    '<path d="M66 84 V56 L70 52 L76 56"/>',
    ['ancient', 'columns', 'derelict', 'temple']),
  def('ink-cave', 'Cave',
    '<path d="M14 84 Q14 46 50 44 Q86 46 86 84"/>' +
    '<path d="M38 84 Q38 60 50 58 Q62 60 62 84 Z" fill="currentColor"/>',
    ['cavern', 'grotto', 'lair', 'entrance']),
  def('ink-mine', 'Mine',
    '<path d="M22 84 Q22 56 50 54 Q78 56 78 84"/>' +
    '<path d="M38 84 V64 H62 V84"/>' +
    '<path d="M38 64 H62"/>' +
    '<path d="M46 84 V72 H54 V84 Z" fill="currentColor"/>',
    ['mine', 'ore', 'quarry', 'adit']),
  def('ink-bridge', 'Bridge',
    '<path d="M8 60 H92"/>' +
    '<path d="M18 60 Q34 38 50 60 Q66 38 82 60"/>' +
    '<path d="M12 60 V78 M88 60 V78"/>',
    ['crossing', 'span', 'arch']),

  // Water ───────────────────────────────────────────────────────────────
  def('ink-lake', 'Lake',
    '<path d="M18 50 Q12 64 30 70 Q52 78 70 70 Q86 62 80 48 Q70 36 50 38 Q28 38 18 50 Z"/>' +
    '<path d="M30 56 q6 -4 12 0 M48 60 q6 -4 12 0 M36 66 q6 -4 12 0"/>',
    ['water', 'pond', 'tarn', 'mere']),
  def('ink-waves', 'Waves',
    '<path d="M8 42 q8 -8 16 0 t16 0 t16 0 t16 0 t16 0"/>' +
    '<path d="M8 60 q8 -8 16 0 t16 0 t16 0 t16 0 t16 0"/>' +
    '<path d="M8 78 q8 -8 16 0 t16 0 t16 0 t16 0 t16 0"/>',
    ['sea', 'ocean', 'tide', 'water']),

  // Markers ─────────────────────────────────────────────────────────────
  def('ink-compass', 'Compass rose',
    '<circle cx="50" cy="50" r="33"/>' +
    '<path d="M50 9 L58 42 L91 50 L58 58 L50 91 L42 58 L9 50 L42 42 Z"/>' +
    '<path d="M50 9 L58 42 L50 50 Z" fill="currentColor"/>' +
    '<circle cx="50" cy="50" r="3.5" fill="currentColor"/>',
    ['north', 'direction', 'navigation', 'rose']),
];

/** Quick lookup of which library ids belong to the hand-drawn set. */
export const INK_ICON_IDS = new Set(INK_ICONS.map((d) => d.id));

/** Sensible ink defaults per intent, used by the auto-scatter generator. */
export const INK_SCATTER_SETS = {
  mountains: ['ink-mountains', 'ink-mountain', 'ink-hills'],
  forest: ['ink-forest', 'ink-pine', 'ink-tree'],
  desert: ['ink-dunes', 'ink-cactus'],
  settlement: ['ink-village', 'ink-hut', 'ink-town'],
  city: ['ink-city', 'ink-castle'],
};
