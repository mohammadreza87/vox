'use client';

import { useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { PackId } from '@/lib/studio/skills/types';
import { Icon, Sheet } from '../../ui';
import { packTitle, roleSummary, roleTitle, useCatalog, type CatalogRole } from './catalog';
import type { SpawnCopy } from './copy';
import { useBackGuard, useSheetA11y } from './hooks';
import { MiniCloud, SheetScroll } from './parts';
import { textAttrs } from './routing';

/** The role library, browsable by pack. Picking a row applies it at once (reversible on the card). */
export function RoleSheet({ t, open, onClose, initialPack, closest, selectedId, onPick, fa, returnFocus }: {
  t: SpawnCopy; open: boolean; onClose: () => void; initialPack?: PackId; closest: string[];
  selectedId: string | null; onPick: (roleId: string | null) => void; fa: boolean; returnFocus?: RefObject<HTMLElement | null>;
}) {
  useBackGuard(open, onClose);
  return (
    <Sheet open={open} onClose={onClose} label={t.roles}>
      {open && <RoleBody t={t} onClose={onClose} initialPack={initialPack} closest={closest} selectedId={selectedId} onPick={onPick} fa={fa} returnFocus={returnFocus} />}
    </Sheet>
  );
}

function RoleBody({ t, onClose, initialPack, closest, selectedId, onPick, fa, returnFocus }: {
  t: SpawnCopy; onClose: () => void; initialPack?: PackId; closest: string[]; selectedId: string | null;
  onPick: (roleId: string | null) => void; fa: boolean; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const catalog = useCatalog();
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const shelves = catalog.shelves;
  const selectedPack = selectedId ? catalog.roles.get(selectedId)?.pack : undefined;
  const [pack, setPack] = useState<PackId | undefined>(() =>
    [initialPack, selectedPack].find((p) => p && shelves.some((s) => s.pack === p)) ?? shelves[0]?.pack);
  useSheetA11y(true, ref, onClose, returnFocus);

  const near = [...new Set(closest)].map((rid) => catalog.roles.get(rid)).filter((r): r is CatalogRole => !!r).slice(0, 3);
  const shelf = shelves.find((s) => s.pack === pack);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const dir = (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0) * (getComputedStyle(e.currentTarget).direction === 'rtl' ? -1 : 1);
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + shelves.length) % shelves.length;
    setPack(shelves[next].pack);
    tabs.current[next]?.focus();
  };

  const row = (r: CatalogRole) => {
    const selected = r.id === selectedId;
    return (
      <button key={r.id} type="button" className="vx-pick-row" aria-pressed={selected} onClick={() => onPick(r.id)}>
        <MiniCloud hue={r.hue} id={r.id} size={36} />
        <div>
          <span {...textAttrs(roleTitle(r, fa))} className="vx-catalog-layout-3d9df89e">{roleTitle(r, fa)}</span>
          <span {...textAttrs(roleSummary(r, fa))} className="vx-small vx-2 vx-clamp2">{roleSummary(r, fa)}</span>
        </div>
        {selected && <span className="vx-pick-check" aria-hidden="true"><Icon name="check" size={20} width={2.25} /></span>}
      </button>
    );
  };

  return (
    <div ref={ref} className="vx-sheet-body">
      <h2 className="vx-title-m">{t.roles}</h2>
      {shelves.length > 1 && (
        <div className="vx-tabs" role="tablist" aria-label={t.roles}>
          {shelves.map((s, i) => (
            <button key={s.pack} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`${id}-tab-${s.pack}`}
              aria-selected={s.pack === pack} aria-controls={`${id}-panel`} tabIndex={s.pack === pack ? 0 : -1}
              className="vx-chip vx-hit" onClick={() => setPack(s.pack)} onKeyDown={(e) => onTabKey(e, i)}>
              {t.packShort[s.pack] ?? packTitle(catalog, s.pack, s.pack, fa)}
            </button>
          ))}
        </div>
      )}
      <SheetScroll>
        {near.length > 0 && (
          <section className="vx-catalog-layout-baf2fda5">
            <span className="vx-over">{t.closest}</span>
            <div className="vx-group vx-pick-list">{near.map(row)}</div>
          </section>
        )}
        {shelf && (
          <section id={`${id}-panel`} role={shelves.length > 1 ? 'tabpanel' : undefined}
            aria-labelledby={shelves.length > 1 ? `${id}-tab-${shelf.pack}` : undefined} className="vx-catalog-layout-baf2fda5">
            <span className="vx-over">{packTitle(catalog, shelf.pack, t.packFull[shelf.pack], fa)}</span>
            <div className="vx-group vx-pick-list">{shelf.roles.map(row)}</div>
          </section>
        )}
        <button type="button" className="vx-link vx-catalog-layout-3f7001a7"  onClick={() => onPick(null)}>{t.detach}</button>
      </SheetScroll>
    </div>
  );
}
