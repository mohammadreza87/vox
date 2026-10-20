'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, type CatalogView } from '../../../_lib/client';
import type { PackId, SkillPack } from '@/lib/studio/skills/types';
import { PACK_IDS } from '@/lib/studio/skills/types';

export type CatalogRole = CatalogView['roles'][number];
export type CatalogSkill = CatalogView['skills'][number];

export interface Catalog {
  /** True once the fetch settled (successfully or not). */
  loaded: boolean;
  roles: Map<string, CatalogRole>;
  skills: Map<string, CatalogSkill>;
  packs: Map<PackId, SkillPack>;
  /** Packs that have at least one role, in catalog order, with their roles in pack order. */
  shelves: Array<{ pack: PackId; roles: CatalogRole[] }>;
}

const EMPTY: CatalogView = { version: '', packs: [], roles: [], skills: [] };

const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Defensive: the catalog is written in parallel and may be partial or empty. */
export function indexCatalog(view: CatalogView | null | undefined, loaded = true): Catalog {
  const v = view && typeof view === 'object' ? view : EMPTY;
  const roles = new Map<string, CatalogRole>();
  for (const r of list<CatalogRole>(v.roles)) {
    if (r && typeof r.id === 'string' && typeof r.title === 'string') {
      roles.set(r.id, { ...r, skills: list<string>(r.skills), optionalSkills: list<string>(r.optionalSkills), starters: list<string>(r.starters) });
    }
  }
  const skills = new Map<string, CatalogSkill>();
  for (const s of list<CatalogSkill>(v.skills)) if (s && typeof s.id === 'string' && typeof s.title === 'string') skills.set(s.id, s);
  const packs = new Map<PackId, SkillPack>();
  for (const p of list<SkillPack>(v.packs)) if (p && PACK_IDS.includes(p.id)) packs.set(p.id, p);
  const order = [...packs.keys(), ...PACK_IDS.filter((id) => !packs.has(id))];
  const shelves = order.map((pack) => {
    const ordered = list<string>(packs.get(pack)?.roles).map((id) => roles.get(id)).filter((r): r is CatalogRole => !!r && r.pack === pack);
    const rest = [...roles.values()].filter((r) => r.pack === pack && !ordered.includes(r));
    return { pack, roles: [...ordered, ...rest] };
  }).filter((s) => s.roles.length > 0);
  return { loaded, roles, skills, packs, shelves };
}

/**
 * Fetches the catalog once per Spawn session. A failure degrades to an empty
 * library and is retried when the device comes back online.
 */
export function useCatalogLoader(): Catalog {
  const [state, setState] = useState<{ view: CatalogView | null; loaded: boolean; failed: boolean }>({ view: null, loaded: false, failed: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => api.catalog())
      .then((view) => { if (!cancelled) setState({ view: view ?? null, loaded: true, failed: false }); })
      .catch(() => { if (!cancelled) setState((s) => ({ view: s.view, loaded: true, failed: true })); });
    return () => { cancelled = true; };
  }, [attempt]);
  useEffect(() => {
    if (!state.failed) return;
    const retry = () => setAttempt((n) => n + 1);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [state.failed]);
  return useMemo(() => indexCatalog(state.view, state.loaded), [state.view, state.loaded]);
}

export const CatalogContext = createContext<Catalog>(indexCatalog(null, false));
export const useCatalog = () => useContext(CatalogContext);

/** Persian titles when the brief (or agent) is Persian and the content has them. */
export const roleTitle = (r: CatalogRole, fa: boolean) => (fa && r.fa?.title) || r.title;
export const roleSummary = (r: CatalogRole, fa: boolean) => (fa && r.fa?.summary) || r.summary;
export const skillTitle = (s: CatalogSkill, fa: boolean) => (fa && s.fa?.title) || s.title;
export const skillSummary = (s: CatalogSkill, fa: boolean) => (fa && s.fa?.summary) || s.summary;
export const packTitle = (catalog: Catalog, pack: PackId, fallback: string, fa: boolean) => {
  const p = catalog.packs.get(pack);
  return (fa && p?.fa?.title) || p?.title || fallback;
};

/** A stable cloud family per role, so neighbouring mini clouds differ in shape too. */
export function familyFor(id: string): 'puff' | 'tower' | 'drift' {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (['puff', 'tower', 'drift'] as const)[Math.abs(h) % 3];
}
