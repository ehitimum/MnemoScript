# Fantasy Map Builder

A canvas-based map studio document type (`docType: 'fantasymap'`) for novelists,
worldbuilders, game devs and DnD planners. Create one from the explorer **+**
menu → **New Fantasy Map** (or any folder's right-click menu).

It mirrors the MindMap architecture: the whole map is serialised to a JSON string
in `Document.content`, auto-saved (debounced) through `onUpdateContent`, and
keyed by document id so it re-parses cleanly on open.

## Two art styles

Every map has an **art style** (switch it in **Generate** or the inspector's *Art style*):

- **Hand-drawn (ink)** — the default. A parchment/atlas look: bare paper land, a soft
  watercolour sea with **concentric ripple lines** hugging an **inked coastline**, faint
  relief shading on high ground, our own **hand-drawn ink icon set** (mountains drawn as
  *ranges*, conifer forests, towns/castles), **red serif place-names**, and optional
  decorative **chrome** — an ornate frame, a compass rose and a title cartouche. This mimics
  the popular hand-drawn asset-pack look without any third-party art.
- **Classic (colour)** — the original Inkarnate-style engine: sea-depth gradient, a soft
  coastline glow, elevation-banded **biome colours** and a mottled land texture.

Both engines share the same paintable heightmap, so you can generate or brush in either
style and switch between them at any time — nothing is lost.

## What you can do

- **Auto-generate** a map: open **Generate**, pick the **art style**, and set the numbers —
  **# regions**, **# biomes**, landmass shape (island / continent / archipelago),
  land amount, coastline detail, biome preset and icon-scatter density. Hit
  **Generate**, **Regenerate** (new seed) or **🎲 Randomize** (randomises every
  field). Everything it makes stays fully hand-editable.
- **Paint terrain with brushes**: the **Land brush** raises terrain & coastline, the
  **Sea brush** carves water — both edit a shared heightmap. A live **brush-size ring**
  follows the cursor; the brush **size** goes right down to a few pixels (great for thin
  rivers and inlets) and strokes are interpolated so fast drags stay continuous. Each dab
  eases the ground toward land/water, so even a tiny brush carves decisively. The terrain
  grid resolution scales with the map, so brushes stay fine on large/4K canvases. A
  generated map is fully paintable afterwards (and vice-versa).
- **Water features with the Sea brush**: pick a mode in the brush bar — **Sea** (deep
  open ocean), **Lake** (one click drops a contained, shallow pond; drag to enlarge) or
  **River** (a thin, shallow channel — just drag where it should flow). All three are the
  same heightmap water, so they connect and render with the coastline + ripples.
- **Scatter brush**: pick a library icon, then drag to paint many of it at once
  (jittered position + size) — great for forests, hills and clustered buildings.
- **Build by hand** with the rest of the toolbar: Select/move, Pan, Place one icon
  (Stamp), **Draw region** (freehand — press & drag to trace the boundary, release to
  close; rendered as a **dotted outline**), Draw road/river, Add label.
- **Name your assets**: **double-click** any placed icon to type a name that appears
  **below** it (or edit it in the inspector). The library includes **naming/site assets**
  — banner, signpost, scroll, site marker (✕) and monument — meant for labelling regions
  and points of interest.
- **Smart overlap**: by default a hand-drawn asset placed over another **occludes** it —
  its solid paper body hides the part of the asset behind it, so overlapping mountains and
  trees read as a range instead of a tangle of lines (front asset wins).
- **Icon library** (left panel): a large cohesive **Hand-drawn** ink set — relief
  (mountains/ranges/hills/volcano/pass), forests & trees, settlements from **hamlet →
  village → town → small city → great city**, **castle/fortress/keep/tower/watchtower**,
  **manor, port, windmill, abbey**, sites like **dungeon, temple, ritual stone-circle,
  shrine, graveyard, ruins, cave, mine, camp**, **river/lake/waterfall**, plus naming
  assets (banner/signpost/scroll/marker/monument) and a compass — alongside ~60 curated
  game-icons glyphs. All searchable, recolourable and usable in either style.
- **Inspector** (right panel): edit the selected object (size, rotation, colour,
  label, lock), plus map settings (kind, **canvas size** up to **4K**, art style,
  background, grid) and layer visibility. Changing size scales all content proportionally.
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

The **Hand-drawn** ink icon set ([inkIcons.ts](../app/src/components/fantasymap/inkIcons.ts))
is original work bundled with MnemoScript — no attribution required. The remaining built-in
icons come from **game-icons.net** (CC BY 3.0) via `react-icons/gi`; keep that attribution
(see [app/public/mapicons/CREDITS.md](../app/public/mapicons/CREDITS.md)). When you own a
commercial map-asset pack (e.g. Deface Games / Inkarnate exports), import it via **Import →
My Imports** rather than bundling it — its art stays under its own licence.
