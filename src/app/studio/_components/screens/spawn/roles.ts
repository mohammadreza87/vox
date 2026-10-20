/**
 * The Brief step's role state as a pure reducer, so async route answers and
 * clarifier replies always act on the current state (and tests can drive it).
 */

import { MAX_AGENT_SKILLS, type RouteSuggestion } from '@/lib/studio/skills/types';
import type { CatalogRole } from './catalog';
import { changeRatio, isMatch, isNone, ROUTING, type RoutingSource } from './routing';

export interface SkillToggle { id: string; on: boolean }

export const onIds = (items: SkillToggle[]) => items.filter((i) => i.on).map((i) => i.id);

/** Applies a sheet selection to chips: new ids are appended, removed ones stay in place, off. */
export function mergeSelection(items: SkillToggle[], next: string[]): SkillToggle[] {
  const kept = items.map((i) => ({ id: i.id, on: next.includes(i.id) }));
  const added = next.filter((id) => !items.some((i) => i.id === id)).map((id) => ({ id, on: true }));
  return [...kept, ...added];
}

export interface Applied { roleId: string; source: RoutingSource; confidence?: number; /** brief text when it appeared */ text: string }

export interface RolesState {
  applied: Applied | null;
  /** Skill toggles per role id, remembered while the step is open. */
  skills: Record<string, SkillToggle[]>;
  /** Roles the creator dismissed: never suggested again this session. */
  exclude: string[];
  /** The role just detached, while Undo is offered. */
  undo: Applied | null;
  /** The creator chose "Keep it custom". */
  detached: boolean;
  /** Routed role plus alternatives, for "Closest to your brief". */
  closest: string[];
}

export type RolesAction =
  | { type: 'suggest'; s: RouteSuggestion; text: string; role?: CatalogRole }
  | { type: 'apply'; role: CatalogRole; source: RoutingSource; confidence?: number; text: string; skills?: string[] }
  | { type: 'detach' }
  /** The brief was cleared: a routed role goes with it (picked and carried roles stay). */
  | { type: 'clearRouted' }
  | { type: 'undo' }
  | { type: 'expire' }
  | { type: 'toggle'; id: string }
  | { type: 'setSkills'; ids: string[] };

export const INITIAL_ROLES: RolesState = { applied: null, skills: {}, exclude: [], undo: null, detached: false, closest: [] };

export const isLocked = (a: Applied | null) => a?.source === 'picked' || a?.source === 'successor';

function apply(state: RolesState, a: Extract<RolesAction, { type: 'apply' }>): RolesState {
  const preferred = a.skills?.length ? a.skills : a.role.skills;
  const items = state.skills[a.role.id] ?? [...new Set(preferred)].slice(0, MAX_AGENT_SKILLS).map((id) => ({ id, on: true }));
  return {
    ...state,
    applied: { roleId: a.role.id, source: a.source, confidence: a.confidence, text: a.text },
    skills: { ...state.skills, [a.role.id]: items },
    undo: null,
    detached: false,
  };
}

export function rolesReducer(state: RolesState, action: RolesAction): RolesState {
  switch (action.type) {
    case 'apply':
      return apply(state, action);
    case 'suggest': {
      const { s, role, text } = action;
      const next = { ...state, closest: [s.roleId, ...s.alternatives].filter((id): id is string => !!id) };
      const cur = state.applied;
      // A role the creator picked (or carried from a predecessor) is never auto-replaced.
      if (isLocked(cur)) return next;
      if (role && isMatch(s) && !state.exclude.includes(role.id)) {
        if (!cur) return apply(next, { type: 'apply', role, source: s.source, confidence: s.confidence, text, skills: s.skillIds });
        if (cur.roleId === role.id) return next;
        // Hysteresis: only a clearly better match replaces what is showing.
        if (s.confidence - (cur.confidence ?? 0) >= ROUTING.replaceMargin) {
          return apply(next, { type: 'apply', role, source: s.source, confidence: s.confidence, text, skills: s.skillIds });
        }
        return next;
      }
      if (cur && isNone(s) && changeRatio(cur.text, text) > ROUTING.clearChange) return { ...next, applied: null };
      return next;
    }
    case 'detach': {
      const cur = state.applied;
      if (!cur) return state;
      return { ...state, applied: null, undo: cur, detached: true, exclude: state.exclude.includes(cur.roleId) ? state.exclude : [...state.exclude, cur.roleId] };
    }
    case 'clearRouted':
      return state.applied && !isLocked(state.applied) ? { ...state, applied: null, closest: [] } : state;
    case 'undo': {
      const prev = state.undo;
      if (!prev) return state;
      return { ...state, applied: prev, undo: null, detached: false, exclude: state.exclude.filter((id) => id !== prev.roleId) };
    }
    case 'expire':
      return state.undo ? { ...state, undo: null } : state;
    case 'toggle': {
      const cur = state.applied;
      const items = cur && state.skills[cur.roleId];
      if (!cur || !items) return state;
      const target = items.find((i) => i.id === action.id);
      if (!target) return state;
      if (!target.on && items.filter((i) => i.on).length >= MAX_AGENT_SKILLS) return state;
      return { ...state, skills: { ...state.skills, [cur.roleId]: items.map((i) => (i.id === action.id ? { ...i, on: !i.on } : i)) } };
    }
    case 'setSkills': {
      const cur = state.applied;
      if (!cur) return state;
      const ids = [...new Set(action.ids)].slice(0, MAX_AGENT_SKILLS);
      return { ...state, skills: { ...state.skills, [cur.roleId]: mergeSelection(state.skills[cur.roleId] ?? [], ids) } };
    }
  }
}
