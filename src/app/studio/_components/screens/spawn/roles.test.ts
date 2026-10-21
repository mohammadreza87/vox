import { describe, expect, it } from 'vitest';
import type { RouteSuggestion } from '@/lib/studio/skills/types';
import type { CatalogRole } from './catalog';
import { INITIAL_ROLES, rolesReducer, type RolesState } from './roles';
import { asSuggestion, changeRatio, routable } from './routing';

const role = (id: string, skills: string[]): CatalogRole => ({
  id, pack: 'mobile', space: 'work', title: id, summary: '', mission: '', skills, optionalSkills: [], starters: [], hue: 'lagoon',
  traits: { warmDirect: 50, playfulSerious: 50, conciseExpansive: 50 },
});
const UA = role('mobile.ua', ['a', 'b', 'c']);
const OPS = role('mobile.ops', ['d', 'e']);
const match = (roleId: string, confidence: number): RouteSuggestion => ({ roleId, skillIds: [], confidence, alternatives: [], source: 'local' });
const suggest = (state: RolesState, s: RouteSuggestion, text: string, r?: CatalogRole) => rolesReducer(state, { type: 'suggest', s, text, role: r });

describe('role routing rules', () => {
  it('applies only confident matches and keeps the showing role unless a new one is clearly better', () => {
    expect(suggest(INITIAL_ROLES, match(UA.id, 0.6), 'run ua for us', UA).applied).toBeNull();
    const shown = suggest(INITIAL_ROLES, match(UA.id, 0.8), 'run ua for us', UA);
    expect(shown.applied).toMatchObject({ roleId: UA.id, source: 'local' });
    expect(shown.skills[UA.id]).toEqual([{ id: 'a', on: true }, { id: 'b', on: true }, { id: 'c', on: true }]);
    expect(suggest(shown, match(OPS.id, 0.85), 'run ua and live ops', OPS).applied?.roleId).toBe(UA.id);
    expect(suggest(shown, match(OPS.id, 0.92), 'run ua and live ops', OPS).applied?.roleId).toBe(OPS.id);
  });

  it('clears a routed role only when the text changed a lot and nothing fits', () => {
    const shown = suggest(INITIAL_ROLES, match(UA.id, 0.8), 'run ua for our game', UA);
    const none: RouteSuggestion = { skillIds: [], confidence: 0.1, alternatives: [], source: 'local' };
    expect(suggest(shown, none, 'run ua for our game launch', undefined).applied?.roleId).toBe(UA.id);
    expect(suggest(shown, none, 'a tutor for my daughter', undefined).applied).toBeNull();
  });

  it('never replaces a picked role, excludes detached roles and restores them with their toggles on undo', () => {
    const picked = rolesReducer(INITIAL_ROLES, { type: 'apply', role: UA, source: 'picked', text: '' });
    expect(suggest(picked, match(OPS.id, 0.99), 'live ops', OPS).applied?.roleId).toBe(UA.id);
    const toggled = rolesReducer(picked, { type: 'toggle', id: 'b' });
    const detached = rolesReducer(toggled, { type: 'detach' });
    expect(detached).toMatchObject({ applied: null, detached: true, exclude: [UA.id] });
    expect(suggest(detached, match(UA.id, 0.99), 'ua', UA).applied).toBeNull();
    const back = rolesReducer(detached, { type: 'undo' });
    expect(back).toMatchObject({ applied: { roleId: UA.id, source: 'picked' }, exclude: [] });
    expect(back.skills[UA.id]).toContainEqual({ id: 'b', on: false });
  });

  it('routes only after a few words and treats malformed answers as no suggestion', () => {
    expect(routable('ua lead')).toBe(false);
    expect(routable('a ua lead')).toBe(true);
    expect(routable('مدیر محصول ارشد')).toBe(true);
    expect(asSuggestion(null)).toBeNull();
    expect(asSuggestion({ roleId: 'x' })).toBeNull();
    // A one-option clarify is a deliberate "did you mean…?"; Skip is the other answer.
    expect(asSuggestion({ confidence: 0.5, clarify: { question: 'Q', options: [{ value: 'a', label: 'A' }] } })?.clarify?.options).toHaveLength(1);
    expect(asSuggestion({ confidence: 0.5, clarify: { question: 'Q', options: [] } })).not.toHaveProperty('clarify');
    expect(changeRatio('a b c', 'a b c')).toBe(0);
    expect(changeRatio('a b', 'c d')).toBe(1);
  });
});
