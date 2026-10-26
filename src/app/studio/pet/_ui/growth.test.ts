import { describe, expect, it } from 'vitest';
import { BOOK_MOMENT_IDS } from '@/lib/pet/play';
import type { PetGrowthView } from './contract';
import { bestTaught, detailsOf, isLit, momentWhy, newlyLit, pageKeys } from './growth';
import { EN } from './strings/en';
import { FA } from './strings/fa';

const g = (o: Partial<PetGrowthView> = {}): PetGrowthView => ({
  moments: [
    { id: 'release', kind: 'taught', title: 'I learned how you plan a release', hint: 'Tell me how your team plans a release' },
    { id: 'standup', kind: 'taught', title: 'I learned how your standup runs', hint: 'Tell me how your daily standup runs' },
    { id: 'report', kind: 'task', title: 'I wrote our first report', hint: 'Ask me for a report', lit: { at: '2026-10-20T10:00:00Z' } },
    { id: 'room-play', kind: 'room', title: 'We found the Play room together', hint: 'Peek into the Play room' },
  ],
  ...o,
});

describe('growth moments on the page (§4.11)', () => {
  it('lit means lit for the agent or only for this person (`mine`)', () => {
    const v = g({ mine: ['room-play'] });
    expect(isLit(v.moments[3], v)).toBe(true);
    expect(isLit(v.moments[0], v)).toBe(false);
  });

  it('newlyLit: nothing on the first view; afterwards what lit since (agent-wide or mine)', () => {
    expect(newlyLit(null, g())).toEqual([]);
    const next = g({ mine: ['room-play'] });
    next.moments[0] = { ...next.moments[0], lit: { at: '2026-10-26T10:00:00Z' } };
    expect(newlyLit(g(), next).map((m) => m.id)).toEqual(['release', 'room-play']);
    expect(newlyLit(next, next)).toEqual([]);
  });

  it('the confirm step proposes the unlit taught moment the saved words match, the server\'s proposal first, never a blind guess', () => {
    expect(bestTaught(g(), 'remember this: we plan a release on Tuesdays with QA sign-off')?.id).toBe('release');
    expect(bestTaught(g(), 'remember this: the standup runs at nine')?.id).toBe('standup');
    expect(bestTaught(g(), 'remember this: my cat is called Pashmak')).toBeNull();
    expect(bestTaught(g(), 'anything', 'standup')?.id).toBe('standup');
    const lit = g();
    lit.moments[0] = { ...lit.moments[0], lit: { at: 'x' } };
    expect(bestTaught(lit, 'plan a release')).toBeNull();
  });

  it('why lines say "you" for this person\'s own moments; every page id has its title and why in both languages', () => {
    expect(momentWhy(g().moments[0], g({ mine: ['release'] }))).toBe('growth.why.taughtMine');
    expect(momentWhy(g().moments[0], g())).toBe('growth.why.taught');
    expect(momentWhy(g().moments[3], g())).toBe('growth.why.room');
    for (const id of BOOK_MOMENT_IDS) {
      const k = pageKeys(id);
      for (const key of [k.title, k.why]) { expect(EN[key], key).toBeTruthy(); expect(FA[key], key).toBeTruthy(); }
      expect(`${EN[k.title]}${FA[k.title]}`).not.toMatch(/[0-9۰-۹]/);
    }
  });

  it('lit kinds become detail parts: taught a glint, task a pin, access a charm, rooms keepsakes, a season its keepsake', () => {
    const v = g({ mine: ['room-play'] });
    v.moments.push({ id: 'season-yalda', kind: 'season', title: 't', hint: 'h', lit: { at: '2026-12-21T00:00:00Z' } });
    expect(detailsOf(v)).toEqual({ glint: false, pin: true, charm: false, keepsakes: ['play'], seasonal: 'yalda' });
  });
});
