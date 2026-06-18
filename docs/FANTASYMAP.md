# Fantasy Map Builder

A canvas-based map studio document type (`docType: 'fantasymap'`) for novelists,
worldbuilders, game devs and DnD planners. Create one from the explorer **+**
menu → **New Fantasy Map** (or any folder's right-click menu).

It mirrors the MindMap architecture: the whole map is serialised to a JSON string
in `Document.content`, auto-saved (debounced) through `onUpdateContent`, and
keyed by document id so it re-parses cleanly on open.

## What you can do

- **Auto-generate** a map: open **Generate** and set the numbers you want —
  **# regions**, **# biomes**, landmass shape (island / continent / archipelago),
  land amount, coastline detail, biome preset and icon-scatter density. Hit
  **Generate**, **Regenerate** (new seed) or **🎲 Randomize** (randomises every
  field). Everything it makes stays fully hand-editable.
- **Build by hand** with the toolbar tools: Select/move, Pan, Place icon (Stamp),
  Draw region (named polygon), Draw road/river, Add label.
- **Icon library** (left panel): ~60 curated fantasy glyphs across Terrain,
  Settlements, Sites, Water, Creatures and Markers — searchable and recolourable.
- **Inspector** (right panel): edit the selected object (size, rotation, colour,
  label, lock), plus map settings (kind, background, grid) and layer visibility.
- **Undo/redo** (buttons + Ctrl+Z / Ctrl+Y), right-click/long-press **context
  menu** (copy, duplicate, bring to front/back, lock, delete), zoom & fit.
- **Export** the whole map to **PNG** from the inspector.

## Map kinds

`MAP_KINDS` in [mapTypes.ts](../app/src/components/fantasymap/mapTypes.ts) is a
registry. **World** and **Region** ship today; switch kind any time from the
inspector's *Type* dropdown. Future kinds (e.g. a gridded **Battlemap** with
tokens & VTT import) are a single registry entry — no rewrite needed.

## Importing art made elsewhere

The **Import** button (library panel) accepts one or many PNG/SVG/WebP/JPG files
and registers them under **My Imports**, ready to stamp. This covers the popular
ecosystems people make map assets in:

- Inkarnate / Wonderdraft / Dungeondraft symbol exports (PNG sets)
- 2-Minute Tabletop, Forgotten Adventures and itch.io asset packs
- Any finished map image → use **Import a base map image** to set it as the
  canvas background and trace/annotate over it

Imported files are copied into the project's `assets/` via the `save_asset`
backend command and referenced by path (resolved with `toAssetUrl` at draw time),
so they travel with the project and work offline on desktop and Android.

Planned later: Universal VTT (`.uvtt` / `.dd2vtt`) battlemap import with walls,
bulk folder/pack import as named sets, and Azgaar `.map` parsing.

## Credits

Built-in icons come from **game-icons.net** (CC BY 3.0) via `react-icons/gi`.
See [app/public/mapicons/CREDITS.md](../app/public/mapicons/CREDITS.md).
