import { useMemo, useState } from 'react';
import { Search, Upload, ImagePlus } from 'lucide-react';
import { CATEGORIES, searchIcons, type IconCategory } from './iconLibrary';
import { toAssetUrl } from '../../lib/assets';
import type { ImportedAsset } from './mapTypes';

export interface PickedIcon {
  libId?: string;
  assetPath?: string;
  /** base pixel size to stamp at */
  size: number;
  label: string;
}

interface Props {
  active: PickedIcon | null;
  imports: ImportedAsset[];
  onPick: (sel: PickedIcon | null) => void;
  onImport: () => void;        // bulk image import → adds to `imports`
  onImportBackground: () => void; // import a finished/base map as the background
}

type Tab = IconCategory | 'All' | 'Imports';

export default function LibraryPanel({ active, imports, onPick, onImport, onImportBackground }: Props) {
  const [tab, setTab] = useState<Tab>('All');
  const [query, setQuery] = useState('');

  const results = useMemo(
    () => (tab === 'Imports' ? [] : searchIcons(query, tab === 'All' ? 'All' : tab)),
    [query, tab],
  );

  const isActive = (libId?: string, assetPath?: string) =>
    active && active.libId === libId && active.assetPath === assetPath;

  return (
    <div className="fm-panel flex flex-col h-full">
      <div className="fm-panel-head">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Library</span>
        <button className="fm-btn fm-btn-sm" onClick={onImport} title="Import your own icons (PNG/SVG)">
          <Upload className="w-3.5 h-3.5" /> Import
        </button>
      </div>

      <div className="px-2 pb-1.5">
        <div className="fm-search">
          <Search className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search icons…"
            className="bg-transparent outline-none text-sm w-full"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="fm-tabs">
        {(['All', ...CATEGORIES, 'Imports'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`fm-tab ${tab === t ? 'is-active' : ''}`}
          >
            {t === 'Imports' ? `Imports${imports.length ? ` (${imports.length})` : ''}` : t}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
        {tab === 'Imports' ? (
          imports.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground/70 py-8 px-3 leading-relaxed">
              <ImagePlus className="w-6 h-6 mx-auto mb-2 opacity-50" />
              No imported icons yet. Use <b>Import</b> to add PNG/SVG art from Inkarnate,
              2-Minute Tabletop, Forgotten Adventures or any pack.
              <div className="mt-3">
                <button className="fm-btn fm-btn-sm mx-auto" onClick={onImportBackground}>
                  Import a base map image
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {imports.map((a) => (
                <button
                  key={a.id}
                  title={a.name}
                  onClick={() => onPick({ assetPath: a.path, size: 64, label: a.name })}
                  className={`fm-iconcell ${isActive(undefined, a.path) ? 'is-active' : ''}`}
                >
                  <img src={toAssetUrl(a.path)} alt={a.name} className="w-full h-full object-contain p-0.5" />
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="grid grid-cols-4 gap-1.5">
            {results.map((d) => {
              const Icon = d.Icon;
              return (
                <button
                  key={d.id}
                  title={d.name}
                  onClick={() => onPick({ libId: d.id, size: d.category === 'Markers' ? 40 : 46, label: d.name })}
                  className={`fm-iconcell ${isActive(d.id) ? 'is-active' : ''}`}
                >
                  <Icon className="w-6 h-6" />
                </button>
              );
            })}
            {results.length === 0 && (
              <div className="col-span-4 text-center text-xs text-muted-foreground/70 py-8">
                No icons match “{query}”.
              </div>
            )}
          </div>
        )}
      </div>

      {active ? (
        <div className="fm-panel-foot">
          <span className="text-[11px] text-muted-foreground truncate">
            Stamping: <b className="text-foreground">{active.label}</b> — click the map to place
          </span>
          <button className="fm-btn fm-btn-sm" onClick={() => onPick(null)}>Done</button>
        </div>
      ) : (
        tab !== 'Imports' && (
          <div className="px-2.5 py-1.5 border-t border-border/30 text-[9px] text-muted-foreground/55 leading-tight">
            Icons: game-icons.net (CC BY 3.0)
          </div>
        )
      )}
    </div>
  );
}
