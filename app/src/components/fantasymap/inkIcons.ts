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
 * OCCLUSION: most icons carry an opaque silhouette painted in the `PAPERFILL`
 * token colour behind the line work. `iconDataUrl` swaps `PAPERFILL` for the
 * map's paper colour, so when one icon overlaps another the front icon's solid
 * body hides the part of the back icon behind it — overlapping mountains/trees
 * read as a range instead of a tangle of lines. (In palette thumbnails the
 * token isn't a real colour, so only the outlines show — which is fine.)
 *
 * Style rules (keep new icons consistent):
 *   • viewBox 0 0 100 100, ground objects "sit" near y≈84.
 *   • stroke = currentColor (recoloured per item.tint); backing = fill="PAPERFILL".
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

/** `back` is an opaque silhouette (uses PAPERFILL) drawn under the line work. */
function def(id: string, name: string, inner: string, tags: string[], back = ''): IconDef {
  return { id, name, category: 'Hand-drawn', Icon: inkIcon(back + inner), tags };
}
const fill = (d: string) => `<path d="${d}" fill="PAPERFILL" stroke="none"/>`;

/* ── the set ─────────────────────────────────────────────────────────────── */
export const INK_ICONS: IconDef[] = [
  // Terrain / relief ────────────────────────────────────────────────────
  def('ink-mountains', 'Mountains',
    '<path d="M5 82 L24 44 L37 66 L55 33 L68 60 L95 82"/>' +
    '<path d="M24 44 L18 61 M24 44 L31 61"/>' +
    '<path d="M55 33 L47 57 M55 33 L63 57"/>',
    ['mountain', 'peak', 'range', 'alps', 'ridge'],
    fill('M5 82 L24 44 L37 66 L55 33 L68 60 L95 82 Z')),
  def('ink-mountain', 'Peak',
    '<path d="M10 84 L46 28 L86 84"/>' +
    '<path d="M46 28 L35 58 M46 28 L57 58"/>' +
    '<path d="M38 45 L46 37 L54 45"/>',
    ['mountain', 'peak', 'summit'],
    fill('M10 84 L46 28 L86 84 Z')),
  def('ink-hills', 'Hills',
    '<path d="M6 72 Q22 48 40 72"/>' +
    '<path d="M34 74 Q56 46 80 74"/>' +
    '<path d="M68 72 Q82 58 96 72"/>',
    ['hill', 'highland', 'downs'],
    fill('M4 74 Q22 47 40 73 Q58 47 80 73 Q88 60 97 72 L97 78 L4 78 Z')),
  def('ink-volcano', 'Volcano',
    '<path d="M14 84 L40 40 L60 40 L86 84"/>' +
    '<path d="M40 41 Q50 34 60 41"/>' +
    '<path d="M45 40 Q43 26 49 17 M55 40 Q57 28 51 17"/>',
    ['lava', 'fire', 'eruption', 'mount'],
    fill('M14 84 L40 40 L60 40 L86 84 Z')),
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
  def('ink-forest', 'Forest',
    '<path d="M18 66 L26 40 L34 66 Z"/>' +
    '<path d="M40 60 L50 30 L60 60 Z"/>' +
    '<path d="M66 66 L74 40 L82 66 Z"/>' +
    '<path d="M30 84 L38 60 L46 84 Z"/>' +
    '<path d="M54 84 L62 60 L70 84 Z"/>',
    ['woods', 'trees', 'pines', 'taiga'],
    fill('M14 68 L26 36 L40 62 L50 28 L60 62 L74 36 L86 68 L70 86 L30 86 Z')),
  def('ink-pine', 'Pine tree',
    '<path d="M50 88 V72"/>' +
    '<path d="M34 72 L50 22 L66 72 Z"/>' +
    '<path d="M39 56 L50 38 L61 56"/>',
    ['tree', 'conifer', 'fir'],
    fill('M34 72 L50 22 L66 72 Z')),
  def('ink-tree', 'Tree',
    '<path d="M50 86 V58"/>' +
    '<path d="M50 62 C30 62 28 38 50 32 C72 38 70 62 50 62 Z"/>',
    ['tree', 'oak', 'deciduous', 'grove'],
    fill('M46 86 H54 V58 H46 Z') + fill('M50 62 C30 62 28 38 50 32 C72 38 70 62 50 62 Z')),
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
    ['cottage', 'shack', 'hovel', 'camp'],
    fill('M22 84 L50 56 L78 84 Z')),
  def('ink-village', 'Village',
    '<path d="M16 78 L30 63 L44 78"/>' +
    '<path d="M20 78 V66 H40 V78"/>' +
    '<path d="M27 78 V71 H33 V78"/>' +
    '<path d="M52 82 L63 71 L74 82"/>' +
    '<path d="M55 82 V73 H71 V82"/>',
    ['hamlet', 'houses', 'town'],
    fill('M16 78 L30 62 L44 78 Z') + fill('M52 82 L63 70 L74 82 Z')),
  def('ink-town', 'Town',
    '<path d="M14 80 L26 67 L38 80"/>' +
    '<path d="M18 80 V69 H34 V80"/>' +
    '<path d="M44 82 L54 73 L64 82"/>' +
    '<path d="M47 82 V75 H61 V82"/>' +
    '<path d="M70 82 V50 H84 V82"/>' +
    '<path d="M70 50 L77 42 L84 50"/>' +
    '<path d="M74 64 H80"/>',
    ['town', 'borough', 'houses', 'tower'],
    fill('M14 80 L26 66 L38 80 Z') + fill('M44 82 L54 72 L64 82 Z') + fill('M70 82 V50 L77 42 L84 50 V82 Z')),
  def('ink-city', 'City',
    '<path d="M16 84 V40 H32 V84"/>' +
    '<path d="M68 84 V40 H84 V84"/>' +
    '<path d="M32 84 V54 H68 V84"/>' +
    '<path d="M42 84 V66 Q50 58 58 66 V84"/>' +
    '<path d="M16 40 V34 H21 V40 M27 40 V34 H32 V40"/>' +
    '<path d="M68 40 V34 H73 V40 M79 40 V34 H84 V40"/>' +
    '<path d="M32 54 V49 H38 V54 M46 54 V49 H54 V54 M62 54 V49 H68 V54"/>',
    ['city', 'capital', 'walls', 'metropolis'],
    fill('M16 84 V40 H32 V84 Z') + fill('M68 84 V40 H84 V84 Z') + fill('M32 84 V54 H68 V84 Z')),
  def('ink-castle', 'Castle',
    '<path d="M18 84 V44 H34 V84"/>' +
    '<path d="M66 84 V44 H82 V84"/>' +
    '<path d="M34 84 V56 H66 V84"/>' +
    '<path d="M44 56 V40 H56 V56"/>' +
    '<path d="M44 84 V70 Q50 63 56 70 V84"/>' +
    '<path d="M56 40 V28"/>' +
    '<path d="M56 29 L70 33 L56 37 Z" fill="currentColor"/>' +
    '<path d="M18 44 V38 H23 V44 M29 44 V38 H34 V44 M66 44 V38 H71 V44 M77 44 V38 H82 V44"/>',
    ['fort', 'keep', 'stronghold', 'fortress'],
    fill('M18 84 V44 H34 V84 Z') + fill('M66 84 V44 H82 V84 Z') + fill('M34 84 V56 H66 V84 Z') + fill('M44 56 V40 H56 V56 Z')),
  def('ink-tower', 'Tower',
    '<path d="M38 86 V42 H62 V86"/>' +
    '<path d="M33 42 L50 22 L67 42 Z"/>' +
    '<path d="M45 56 H55 V70 H45 Z"/>',
    ['tower', 'watch', 'wizard', 'spire'],
    fill('M38 86 V42 H62 V86 Z') + fill('M33 42 L50 22 L67 42 Z')),

  // Sites ───────────────────────────────────────────────────────────────
  def('ink-ruins', 'Ruins',
    '<path d="M16 84 H84"/>' +
    '<path d="M24 84 V50 L29 46 L34 50 V84"/>' +
    '<path d="M44 84 V42 H56 V60"/>' +
    '<path d="M66 84 V56 L70 52 L76 56"/>',
    ['ancient', 'columns', 'derelict', 'temple'],
    fill('M24 84 V50 L29 46 L34 50 V84 Z') + fill('M44 84 V42 H56 V60 L44 60 Z')),
  def('ink-cave', 'Cave',
    '<path d="M14 84 Q14 46 50 44 Q86 46 86 84"/>' +
    '<path d="M38 84 Q38 60 50 58 Q62 60 62 84 Z" fill="currentColor"/>',
    ['cavern', 'grotto', 'lair', 'entrance'],
    fill('M14 84 Q14 46 50 44 Q86 46 86 84 Z')),
  def('ink-mine', 'Mine',
    '<path d="M22 84 Q22 56 50 54 Q78 56 78 84"/>' +
    '<path d="M38 84 V64 H62 V84"/>' +
    '<path d="M38 64 H62"/>' +
    '<path d="M46 84 V72 H54 V84 Z" fill="currentColor"/>',
    ['mine', 'ore', 'quarry', 'adit'],
    fill('M22 84 Q22 56 50 54 Q78 56 78 84 Z')),
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

  // Detailed settlements ────────────────────────────────────────────────
  def('ink-metropolis', 'Great city',
    '<path d="M10 84 V52 H90 V84"/>' +
    '<path d="M10 52 V46 H16 V52 M22 52 V46 H28 V52 M72 52 V46 H78 V52 M84 52 V46 H90 V52"/>' +
    '<path d="M10 84 V40 H24 V84"/>' +
    '<path d="M76 84 V40 H90 V84"/>' +
    '<path d="M46 84 V68 Q50 62 54 68 V84"/>' +
    '<path d="M40 52 V28 H50 V52"/>' +
    '<path d="M40 28 L45 16 L50 28"/>' +
    '<path d="M45 16 V9 M42 12 H48"/>' +
    '<path d="M28 84 V62 H36 V84"/>' +
    '<path d="M58 84 V62 H66 V84"/>',
    ['city', 'capital', 'metropolis', 'walls', 'cathedral', 'big'],
    fill('M10 84 V52 H90 V84 Z') + fill('M10 84 V40 H24 V84 Z') + fill('M76 84 V40 H90 V84 Z') +
    fill('M40 52 V28 H50 V52 Z') + fill('M40 28 L45 16 L50 28 Z') + fill('M28 84 V62 H36 V84 Z') + fill('M58 84 V62 H66 V84 Z')),
  def('ink-smallcity', 'Small city',
    '<path d="M22 84 V50 H78 V84"/>' +
    '<path d="M22 50 V45 H28 V50 M34 50 V45 H40 V50 M60 50 V45 H66 V50 M72 50 V45 H78 V50"/>' +
    '<path d="M22 84 V42 H34 V84"/>' +
    '<path d="M66 84 V42 H78 V84"/>' +
    '<path d="M44 84 V70 Q50 64 56 70 V84"/>',
    ['city', 'town', 'walled', 'small'],
    fill('M22 84 V50 H78 V84 Z') + fill('M22 84 V42 H34 V84 Z') + fill('M66 84 V42 H78 V84 Z')),
  def('ink-hamlet', 'Hamlet',
    '<path d="M20 84 L34 66 L48 84"/>' +
    '<path d="M25 84 V72 H43 V84"/>' +
    '<path d="M56 84 L66 72 L76 84"/>' +
    '<path d="M60 84 V75 H72 V84"/>',
    ['hamlet', 'houses', 'small', 'village'],
    fill('M20 84 L34 66 L48 84 Z') + fill('M56 84 L66 72 L76 84 Z')),
  def('ink-manor', 'Manor',
    '<path d="M24 84 V52 L50 34 L76 52 V84"/>' +
    '<path d="M44 84 V66 H56 V84"/>' +
    '<path d="M30 60 H38 V68 H30 Z"/>' +
    '<path d="M62 60 H70 V68 H62 Z"/>' +
    '<path d="M64 44 V30 H72 V48"/>',
    ['manor', 'estate', 'mansion', 'house', 'hall'],
    fill('M24 84 V52 L50 34 L76 52 V84 Z') + fill('M64 48 V30 H72 V48 Z')),
  def('ink-port', 'Port',
    '<path d="M12 64 H56"/>' +
    '<path d="M20 64 V80 M34 64 V80 M48 64 V80"/>' +
    '<circle cx="74" cy="30" r="6"/>' +
    '<path d="M74 36 V74"/>' +
    '<path d="M62 62 Q74 84 86 62"/>' +
    '<path d="M64 44 H84"/>',
    ['port', 'harbour', 'dock', 'anchor', 'sea']),
  def('ink-windmill', 'Windmill',
    '<path d="M40 84 V44 H60 V84"/>' +
    '<path d="M40 44 L50 32 L60 44"/>' +
    '<path d="M50 38 L26 20 M50 38 L74 20 M50 38 L26 56 M50 38 L74 56"/>',
    ['windmill', 'mill', 'farm'],
    fill('M40 84 V44 L50 32 L60 44 V84 Z')),
  def('ink-abbey', 'Abbey',
    '<path d="M30 84 V46 H70 V84"/>' +
    '<path d="M30 46 L50 28 L70 46"/>' +
    '<path d="M50 28 V16 M44 20 H56"/>' +
    '<circle cx="50" cy="60" r="6"/>' +
    '<path d="M44 84 V70 H56 V84"/>',
    ['abbey', 'church', 'monastery', 'cathedral', 'temple'],
    fill('M30 84 V46 L50 28 L70 46 V84 Z')),
  def('ink-watchtower', 'Watchtower',
    '<path d="M42 84 V40 H58 V40"/>' +
    '<path d="M42 84 V40 H58 V84"/>' +
    '<path d="M38 40 H62"/>' +
    '<path d="M38 40 V32 H62 V40"/>' +
    '<path d="M38 32 V28 H42 V32 M46 32 V28 H50 V32 M54 32 V28 H58 V32"/>' +
    '<path d="M48 60 H52 V72 H48 Z"/>',
    ['watchtower', 'tower', 'outpost', 'watch', 'lookout'],
    fill('M42 84 V40 H58 V84 Z') + fill('M38 40 V32 H62 V40 Z')),

  // Detailed sites ────────────────────────────────────────────────────────
  def('ink-dungeon', 'Dungeon',
    '<path d="M38 84 V62 Q50 52 62 62 V84 Z" fill="currentColor"/>' +
    '<path d="M46 84 V62" stroke="PAPERFILL"/>' +
    '<path d="M54 84 V62" stroke="PAPERFILL"/>' +
    '<path d="M16 84 Q20 50 50 48 Q80 50 84 84"/>' +
    '<path d="M38 84 V62 Q50 52 62 62 V84"/>',
    ['dungeon', 'lair', 'entrance', 'crypt', 'gate'],
    fill('M16 84 Q20 50 50 48 Q80 50 84 84 Z')),
  def('ink-temple', 'Temple',
    '<path d="M20 84 H80"/>' +
    '<path d="M24 78 H76"/>' +
    '<path d="M28 78 V46 M40 78 V46 M52 78 V46 M64 78 V46"/>' +
    '<path d="M22 46 H78"/>' +
    '<path d="M22 46 L50 28 L78 46"/>',
    ['temple', 'shrine', 'sanctuary', 'greek', 'ruins', 'holy'],
    fill('M22 46 L50 28 L78 46 Z') + fill('M20 78 H80 V84 H20 Z')),
  def('ink-ritual', 'Ritual site',
    '<path d="M22 74 V58 H32 V74 Z"/>' +
    '<path d="M68 74 V58 H78 V74 Z"/>' +
    '<path d="M38 50 V36 H46 V50 Z"/>' +
    '<path d="M54 50 V36 H62 V50 Z"/>' +
    '<path d="M36 36 H64 V31 H36 Z"/>' +
    '<path d="M44 78 H56 V72 H44 Z"/>',
    ['ritual', 'stone circle', 'henge', 'standing stones', 'druid', 'altar'],
    fill('M22 74 V58 H32 V74 Z') + fill('M68 74 V58 H78 V74 Z') + fill('M38 50 V36 H46 V50 Z') +
    fill('M54 50 V36 H62 V50 Z') + fill('M36 36 H64 V31 H36 Z') + fill('M44 78 H56 V72 H44 Z')),
  def('ink-shrine', 'Shrine',
    '<path d="M30 84 V42"/>' +
    '<path d="M70 84 V42"/>' +
    '<path d="M22 42 Q50 36 78 42"/>' +
    '<path d="M26 52 H74"/>',
    ['shrine', 'torii', 'temple', 'holy', 'gate']),
  def('ink-graveyard', 'Graveyard',
    '<path d="M16 84 H84"/>' +
    '<path d="M22 84 V62 Q22 54 30 54 Q38 54 38 62 V84 Z"/>' +
    '<path d="M50 84 V52 M42 60 H58"/>' +
    '<path d="M66 84 V64 H78 V84 Z"/>',
    ['graveyard', 'cemetery', 'tombs', 'crypt', 'undead'],
    fill('M22 84 V62 Q22 54 30 54 Q38 54 38 62 V84 Z') + fill('M66 84 V64 H78 V84 Z')),
  def('ink-fortress', 'Fortress',
    '<path d="M12 84 V46 H26 V84"/>' +
    '<path d="M74 84 V46 H88 V84"/>' +
    '<path d="M26 84 V56 H74 V84"/>' +
    '<path d="M40 56 V36 H60 V56"/>' +
    '<path d="M48 84 V68 Q50 62 52 68 V84"/>' +
    '<path d="M12 46 V40 H17 V46 M21 46 V40 H26 V46"/>' +
    '<path d="M74 46 V40 H79 V46 M83 46 V40 H88 V46"/>' +
    '<path d="M40 36 V31 H46 V36 M54 36 V31 H60 V36"/>' +
    '<path d="M50 36 V24"/>' +
    '<path d="M50 25 L62 28 L50 31 Z" fill="currentColor"/>',
    ['fortress', 'castle', 'citadel', 'stronghold', 'big'],
    fill('M12 84 V46 H26 V84 Z') + fill('M74 84 V46 H88 V84 Z') + fill('M26 84 V56 H74 V84 Z') + fill('M40 56 V36 H60 V56 Z')),
  def('ink-keep', 'Keep',
    '<path d="M32 84 V40 H68 V84"/>' +
    '<path d="M28 40 V30 H36 V40"/>' +
    '<path d="M64 40 V30 H72 V40"/>' +
    '<path d="M28 30 V26 H32 V30 M64 30 V26 H68 V30"/>' +
    '<path d="M44 84 V66 Q50 60 56 66 V84"/>' +
    '<path d="M40 50 H46 V58 H40 Z M54 50 H60 V58 H54 Z"/>',
    ['keep', 'tower', 'castle', 'donjon'],
    fill('M32 84 V40 H68 V84 Z') + fill('M28 40 V30 H36 V40 Z') + fill('M64 40 V30 H72 V40 Z')),
  def('ink-camp', 'Camp',
    '<path d="M16 80 L30 52 L44 80 Z"/>' +
    '<path d="M30 52 V80"/>' +
    '<path d="M52 80 L64 58 L76 80 Z"/>' +
    '<path d="M64 58 V80"/>',
    ['camp', 'tents', 'encampment', 'war', 'rest'],
    fill('M16 80 L30 52 L44 80 Z') + fill('M52 80 L64 58 L76 80 Z')),
  def('ink-pass', 'Mountain pass',
    '<path d="M6 82 L30 40 L46 70"/>' +
    '<path d="M54 70 L70 40 L94 82"/>' +
    '<path d="M42 84 Q50 79 58 84"/>',
    ['pass', 'gap', 'mountain', 'road', 'route'],
    fill('M6 82 L30 40 L50 82 Z') + fill('M50 82 L70 40 L94 82 Z')),

  // River / falls ─────────────────────────────────────────────────────────
  def('ink-river', 'River',
    '<path d="M18 14 Q40 36 30 56 Q20 76 44 88"/>' +
    '<path d="M34 12 Q56 34 46 54 Q36 74 60 86"/>' +
    '<path d="M27 40 q4 -3 8 0 M31 64 q4 -3 8 0"/>',
    ['river', 'stream', 'water', 'flow', 'brook']),
  def('ink-waterfall', 'Waterfall',
    '<path d="M28 20 H72"/>' +
    '<path d="M30 22 V70 M42 22 V74 M54 22 V70 M66 22 V74"/>' +
    '<path d="M26 78 q6 -5 12 0 t12 0 t12 0 t12 0"/>' +
    '<path d="M24 86 q6 -5 12 0 t12 0 t12 0 t12 0"/>',
    ['waterfall', 'cascade', 'falls', 'river', 'water']),

  // Markers & naming (banners / signs for regions & sites) ──────────────
  def('ink-compass', 'Compass rose',
    '<circle cx="50" cy="50" r="33"/>' +
    '<path d="M50 9 L58 42 L91 50 L58 58 L50 91 L42 58 L9 50 L42 42 Z"/>' +
    '<path d="M50 9 L58 42 L50 50 Z" fill="currentColor"/>' +
    '<circle cx="50" cy="50" r="3.5" fill="currentColor"/>',
    ['north', 'direction', 'navigation', 'rose']),
  def('ink-banner', 'Banner',
    '<path d="M30 88 V18"/>' +
    '<path d="M30 22 H76 L67 33 L76 44 H30 Z"/>',
    ['name', 'banner', 'flag', 'region', 'standard'],
    fill('M30 22 H76 L67 33 L76 44 H30 Z')),
  def('ink-signpost', 'Signpost',
    '<path d="M48 88 V34"/>' +
    '<path d="M30 38 H64 L72 46 L64 54 H30 Z"/>' +
    '<path d="M52 60 H82 L74 68 L82 76 H52 Z"/>',
    ['name', 'sign', 'site', 'marker', 'road'],
    fill('M30 38 H64 L72 46 L64 54 H30 Z') + fill('M52 60 H82 L74 68 L82 76 H52 Z')),
  def('ink-scroll', 'Scroll',
    '<path d="M24 28 Q15 33 24 38 V62 Q15 67 24 72 H72 Q81 67 72 62 V38 Q81 33 72 28 Z"/>' +
    '<path d="M34 42 H62 M34 50 H62 M34 58 H54"/>',
    ['name', 'lore', 'quest', 'note', 'region'],
    fill('M24 28 Q15 33 24 38 V62 Q15 67 24 72 H72 Q81 67 72 62 V38 Q81 33 72 28 Z')),
  def('ink-marker', 'Site marker',
    '<path d="M30 30 L70 70 M70 30 L30 70"/>' +
    '<circle cx="50" cy="50" r="6" fill="currentColor"/>',
    ['name', 'x', 'site', 'treasure', 'point']),
  def('ink-obelisk', 'Monument',
    '<path d="M40 84 L42 36 Q50 26 58 36 L60 84"/>' +
    '<path d="M36 84 H64"/>' +
    '<path d="M44 52 H56"/>',
    ['name', 'monument', 'standing stone', 'site', 'menhir'],
    fill('M40 84 L42 36 Q50 26 58 36 L60 84 Z')),
];

/** Quick lookup of which library ids belong to the hand-drawn set. */
export const INK_ICON_IDS = new Set(INK_ICONS.map((d) => d.id));

/** Sensible ink defaults per intent, used by the auto-scatter generator. */
export const INK_SCATTER_SETS = {
  mountains: ['ink-mountains', 'ink-mountain', 'ink-hills'],
  forest: ['ink-forest', 'ink-pine', 'ink-tree'],
  desert: ['ink-dunes', 'ink-cactus'],
  settlement: ['ink-village', 'ink-hut', 'ink-town', 'ink-hamlet', 'ink-manor'],
  city: ['ink-city', 'ink-castle', 'ink-smallcity', 'ink-metropolis', 'ink-fortress'],
};
