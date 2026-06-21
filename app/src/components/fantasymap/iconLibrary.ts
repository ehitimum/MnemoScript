/**
 * Bundled map-icon library.
 *
 * We vendor the icons through `react-icons/gi` — the "Game Icons" set, which is
 * game-icons.net's artwork (CC BY 3.0) packaged as React components. This ships
 * the whole set offline with zero asset files to manage, and lets us recolour
 * each glyph on the fly.
 *
 * Attribution (required by CC BY 3.0) lives in `app/public/mapicons/CREDITS.md`
 * and the in-app credits line.
 *
 * Two consumers:
 *   • LibraryPanel renders the React component directly for palette thumbnails.
 *   • The Konva canvas needs a bitmap, so `iconDataUrl(libId, color)` renders the
 *     glyph to a tinted SVG data-URL (cached) that an <img>/Konva.Image can load.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IconType } from 'react-icons';
import {
  GiMountains, GiHills, GiVolcano, GiForest, GiPineTree, GiPalmTree, GiCactus,
  GiIsland, GiSwamp, GiOasis, GiThreeLeaves, GiMapleLeaf, GiFlowers, GiMushroomGills,
  GiRiver, GiWaterfall, GiBigWave, GiAnchor, GiSailboat, GiGalley, GiOctopus,
  GiCastle, GiVillage, GiHut, GiWoodCabin, GiFamilyHouse, GiTreehouse, GiBarn,
  GiWindmill, GiLighthouse, GiTowerFlag, GiStoneTower, GiCapitol,
  GiCaveEntrance, GiDungeonGate, GiDungeonLight, GiGreekTemple, GiAncientColumns,
  GiBrokenWall, GiCampingTent, GiMineWagon, GiMining, GiBridge, GiStoneBridge,
  GiTowerBridge, GiWoodenSign, GiCrossroad,
  GiDragonHead, GiSeaDragon, GiWyvern, GiHydra, GiGriffinSymbol, GiGriffinShield,
  GiUnicorn, GiGiant, GiCyclops, GiSpectre, GiSnowman, GiSeaSerpent, GiSkullCrossedBones,
  GiCompass, GiPositionMarker, GiCrossedSwords, GiShield, GiBlackFlag,
  GiScrollUnfurled, GiTreasureMap, GiTwoCoins,
} from 'react-icons/gi';
import { INK_ICONS } from './inkIcons';

export type IconCategory =
  | 'Hand-drawn' | 'Terrain' | 'Settlements' | 'Sites' | 'Water' | 'Creatures' | 'Markers';

export interface IconDef {
  id: string;            // stable id stored in MapItem.libId
  name: string;
  category: IconCategory;
  Icon: IconType;
  tags: string[];
}

/** Helper to keep the table terse. id is derived from name (kebab). */
function ic(name: string, category: IconCategory, Icon: IconType, tags: string[] = []): IconDef {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { id, name, category, Icon, tags };
}

export const ICONS: IconDef[] = [
  // ── Hand-drawn (our own cohesive ink set; see inkIcons.ts) ───────────
  ...INK_ICONS,

  // ── Terrain ──────────────────────────────────────────────────────────
  ic('Mountains', 'Terrain', GiMountains, ['mountain', 'peak', 'range', 'alps']),
  ic('Hills', 'Terrain', GiHills, ['hill', 'highland']),
  ic('Volcano', 'Terrain', GiVolcano, ['lava', 'fire', 'eruption']),
  ic('Forest', 'Terrain', GiForest, ['woods', 'trees', 'jungle']),
  ic('Pine Tree', 'Terrain', GiPineTree, ['tree', 'conifer', 'taiga']),
  ic('Palm Tree', 'Terrain', GiPalmTree, ['tree', 'tropical', 'beach']),
  ic('Cactus', 'Terrain', GiCactus, ['desert', 'arid']),
  ic('Island', 'Terrain', GiIsland, ['isle', 'atoll']),
  ic('Swamp', 'Terrain', GiSwamp, ['marsh', 'bog', 'wetland']),
  ic('Oasis', 'Terrain', GiOasis, ['desert', 'water', 'palm']),
  ic('Leaves', 'Terrain', GiThreeLeaves, ['plant', 'foliage', 'grass']),
  ic('Maple Leaf', 'Terrain', GiMapleLeaf, ['autumn', 'forest']),
  ic('Flowers', 'Terrain', GiFlowers, ['meadow', 'bloom', 'field']),
  ic('Mushrooms', 'Terrain', GiMushroomGills, ['fungus', 'cave', 'grove']),

  // ── Water ────────────────────────────────────────────────────────────
  ic('River', 'Water', GiRiver, ['stream', 'water', 'flow']),
  ic('Waterfall', 'Water', GiWaterfall, ['cascade', 'falls']),
  ic('Waves', 'Water', GiBigWave, ['sea', 'ocean', 'tide']),
  ic('Anchor', 'Water', GiAnchor, ['harbour', 'port', 'dock']),
  ic('Sailboat', 'Water', GiSailboat, ['ship', 'boat', 'sea']),
  ic('Galley', 'Water', GiGalley, ['ship', 'warship', 'fleet']),
  ic('Kraken', 'Water', GiOctopus, ['octopus', 'tentacle', 'monster', 'sea']),

  // ── Settlements ──────────────────────────────────────────────────────
  ic('Capital', 'Settlements', GiCapitol, ['city', 'capital', 'metropolis']),
  ic('Castle', 'Settlements', GiCastle, ['fort', 'keep', 'stronghold']),
  ic('Village', 'Settlements', GiVillage, ['hamlet', 'town', 'houses']),
  ic('Hut', 'Settlements', GiHut, ['cottage', 'shack', 'hovel']),
  ic('Cabin', 'Settlements', GiWoodCabin, ['lodge', 'house', 'wood']),
  ic('House', 'Settlements', GiFamilyHouse, ['home', 'dwelling']),
  ic('Treehouse', 'Settlements', GiTreehouse, ['elf', 'forest', 'home']),
  ic('Barn', 'Settlements', GiBarn, ['farm', 'granary', 'stable']),
  ic('Windmill', 'Settlements', GiWindmill, ['mill', 'farm']),
  ic('Lighthouse', 'Settlements', GiLighthouse, ['beacon', 'coast', 'port']),
  ic('Tower with Flag', 'Settlements', GiTowerFlag, ['tower', 'outpost', 'watch']),
  ic('Stone Tower', 'Settlements', GiStoneTower, ['tower', 'wizard', 'spire']),

  // ── Sites ────────────────────────────────────────────────────────────
  ic('Cave', 'Sites', GiCaveEntrance, ['cavern', 'grotto', 'lair']),
  ic('Dungeon Gate', 'Sites', GiDungeonGate, ['dungeon', 'gate', 'entrance']),
  ic('Dungeon', 'Sites', GiDungeonLight, ['dungeon', 'torch', 'crypt']),
  ic('Temple', 'Sites', GiGreekTemple, ['shrine', 'church', 'sanctuary']),
  ic('Ruins', 'Sites', GiAncientColumns, ['ancient', 'columns', 'derelict']),
  ic('Broken Wall', 'Sites', GiBrokenWall, ['ruin', 'rubble', 'wall']),
  ic('Camp', 'Sites', GiCampingTent, ['tent', 'encampment', 'rest']),
  ic('Mine', 'Sites', GiMineWagon, ['mine', 'ore', 'cart']),
  ic('Mining', 'Sites', GiMining, ['pickaxe', 'quarry', 'ore']),
  ic('Bridge', 'Sites', GiBridge, ['crossing', 'span']),
  ic('Stone Bridge', 'Sites', GiStoneBridge, ['crossing', 'arch']),
  ic('Tower Bridge', 'Sites', GiTowerBridge, ['gate', 'crossing']),
  ic('Signpost', 'Sites', GiWoodenSign, ['sign', 'marker', 'road']),
  ic('Crossroad', 'Sites', GiCrossroad, ['road', 'junction', 'path']),

  // ── Creatures ────────────────────────────────────────────────────────
  ic('Dragon', 'Creatures', GiDragonHead, ['wyrm', 'drake', 'beast']),
  ic('Sea Dragon', 'Creatures', GiSeaDragon, ['leviathan', 'serpent', 'sea']),
  ic('Wyvern', 'Creatures', GiWyvern, ['drake', 'dragon', 'flying']),
  ic('Hydra', 'Creatures', GiHydra, ['serpent', 'heads', 'monster']),
  ic('Griffin', 'Creatures', GiGriffinSymbol, ['gryphon', 'eagle', 'lion']),
  ic('Griffin Shield', 'Creatures', GiGriffinShield, ['heraldry', 'crest']),
  ic('Unicorn', 'Creatures', GiUnicorn, ['horse', 'magic', 'fey']),
  ic('Giant', 'Creatures', GiGiant, ['ogre', 'titan', 'colossus']),
  ic('Cyclops', 'Creatures', GiCyclops, ['monster', 'giant']),
  ic('Spectre', 'Creatures', GiSpectre, ['ghost', 'wraith', 'undead']),
  ic('Yeti', 'Creatures', GiSnowman, ['snow', 'ice', 'beast']),
  ic('Sea Serpent', 'Creatures', GiSeaSerpent, ['snake', 'monster', 'sea']),
  ic('Skull', 'Creatures', GiSkullCrossedBones, ['danger', 'death', 'graveyard']),

  // ── Markers ──────────────────────────────────────────────────────────
  ic('Compass Rose', 'Markers', GiCompass, ['north', 'direction', 'navigation']),
  ic('Pin', 'Markers', GiPositionMarker, ['marker', 'location', 'point']),
  ic('Crossed Swords', 'Markers', GiCrossedSwords, ['battle', 'war', 'conflict']),
  ic('Shield', 'Markers', GiShield, ['defense', 'heraldry', 'crest']),
  ic('Flag', 'Markers', GiBlackFlag, ['banner', 'claim', 'territory']),
  ic('Scroll', 'Markers', GiScrollUnfurled, ['quest', 'note', 'lore']),
  ic('Treasure Map', 'Markers', GiTreasureMap, ['quest', 'loot', 'x marks']),
  ic('Treasure', 'Markers', GiTwoCoins, ['gold', 'coins', 'loot']),
];

export const CATEGORIES: IconCategory[] =
  ['Hand-drawn', 'Terrain', 'Settlements', 'Sites', 'Water', 'Creatures', 'Markers'];

const BY_ID = new Map(ICONS.map((d) => [d.id, d]));

export function getIcon(id: string): IconDef | undefined {
  return BY_ID.get(id);
}

/** Case-insensitive search over name + tags, optionally within a category. */
export function searchIcons(query: string, category?: IconCategory | 'All'): IconDef[] {
  const q = query.trim().toLowerCase();
  return ICONS.filter((d) => {
    if (category && category !== 'All' && d.category !== category) return false;
    if (!q) return true;
    return d.name.toLowerCase().includes(q) || d.tags.some((t) => t.includes(q));
  });
}

/** A few sensible defaults per intent, used by the auto-scatter generator. */
export const SCATTER_SETS = {
  mountains: ['mountains', 'hills', 'volcano'],
  forest: ['forest', 'pine-tree', 'leaves'],
  desert: ['cactus', 'oasis'],
  settlement: ['village', 'hut', 'cabin', 'house'],
  city: ['castle', 'capital'],
  coast: ['lighthouse', 'anchor', 'sailboat'],
};

/* ── Canvas rasterisation ──────────────────────────────────────────────── */

const urlCache = new Map<string, string>();

/**
 * Render a library glyph to a tinted SVG data-URL (cached by id+colour). The Gi
 * components emit `fill="currentColor"`; we bake the literal colour in so the
 * image is self-contained when loaded by Konva (where `currentColor` has no
 * context and would fall back to black).
 */
export function iconDataUrl(libId: string, color = '#3a2f23'): string {
  const key = `${libId}|${color}`;
  const hit = urlCache.get(key);
  if (hit) return hit;
  const def = BY_ID.get(libId);
  if (!def) return '';
  let svg = renderToStaticMarkup(createElement(def.Icon, { size: 256 }));
  svg = svg.replace(/currentColor/g, color);
  if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  urlCache.set(key, url);
  return url;
}
