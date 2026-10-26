/**
 * Growth moments (design §4.11): the drafter's block with its lint and fallback, the default sets, the agent-wide lit
 * store, PetView.growth, and every lighting trigger (room, season, access, taught only through confirm), with dimming
 * when the source note is erased and clearing when the agent is fired.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { receiptIdFor } from '../../circles/codec';
import type { InitDataUser } from '../auth';
import { agentInit } from './initdata-keys';
import { handlePetRequest } from '../pet-http';
import { draftedGrowth, lintMoment, noteRef, validateGrowthEdit } from '../growth';
import { FilePetGrowthStore, petGrowthStoreFor } from '../pet-growth-store';
import { petPlayStoreFor } from '../pet-play-store';
import { draftPersona } from '../persona';
import {
  defaultMoments, GROWTH_LIMITS, growthView, MAX_DRAFTED, MIN_DRAFTED, roleFamily, templateMoments, type GrowthLang, type GrowthMoment, type RoleFamily,
} from '../../pet/growth';
import type { PlayResponse } from '../../pet/play';
import type { GrowthConfirmResponse, PetView } from '../../pet/types';
import { draftJson, hire, ID, makeStudio, personaSpec, ScriptedLLM, SECRET, seedOrg, tempDir } from './helpers';

const ORIGIN = 'https://vox.example';
const user = (id: number): InitDataUser => ({ id, first_name: `U${id}` });

const FAMILY_ROLES: Record<RoleFamily, string> = { support: 'Customer Support', analysis: 'Data Analyst', creative: 'Game Designer',
  engineering: 'Backend Engineer', lead: 'Producer', people: 'People Coach', general: 'Assistant' };

const moment = (i: number, o: Partial<GrowthMoment> = {}): GrowthMoment =>
  ({ id: `taught-thing-${String.fromCharCode(97 + i)}`, kind: 'taught', title: 'We learned how we plan a release', hint: 'Tell me how your team plans a release', ...o });

describe('default sets and templates', () => {
  it.each(Object.entries(FAMILY_ROLES))('%s defaults pass the lint in both languages and make 15 to 25 moments with the templates', (family, role) => {
    expect(roleFamily(role)).toBe(family);
    for (const lang of ['en', 'fa'] as GrowthLang[]) {
      const moments = defaultMoments(role, lang);
      expect(moments.length).toBeGreaterThanOrEqual(MIN_DRAFTED);
      expect(moments.length).toBeLessThanOrEqual(MAX_DRAFTED);
      for (const m of moments) expect([m.id, lintMoment(m, lang)]).toEqual([m.id, []]);
      expect(new Set(moments.map((m) => m.id)).size).toBe(moments.length);
      const total = moments.length + templateMoments(lang).length;
      expect(total).toBeGreaterThanOrEqual(GROWTH_LIMITS.minMoments);
      expect(total).toBeLessThanOrEqual(GROWTH_LIMITS.maxMoments);
    }
  });

  it('templates: five rooms (no Home) and three festivals, fixed ids, linted', () => {
    for (const lang of ['en', 'fa'] as GrowthLang[]) {
      const t = templateMoments(lang);
      expect(t.map((m) => m.id)).toEqual(['room-play', 'room-garden', 'room-closet', 'room-bedroom', 'room-book', 'season-yalda', 'season-suri', 'season-nowruz']);
      for (const m of t) expect(lintMoment(m, lang)).toEqual([]);
    }
  });
});

describe('the lint', () => {
  it.each([
    [{ title: 'We closed 3 tickets together' }, 'digit'],
    [{ title: 'We learned about your health plans' }, 'sensitive_topic'],
    [{ hint: 'Tell me how you feel about the launch' }, 'sensitive_topic'],
    [{ hint: 'Tell me who votes in the election' }, 'sensitive_topic'],
    [{ title: 'We learned your performance targets' }, 'sensitive_topic'],
    [{ hint: 'Last chance: teach me this today' }, 'banned-fomo'],
    [{ hint: 'Come back now and tell me' }, 'banned-pressure'],
    [{ title: 'I learned how you plan a release' }, 'title_not_we'],
    [{ title: 'We learned how our whole studio plans every release' }, 'title_length'],
    [{ hint: 'See https://example.com and tell me' }, 'link'],
    [{ title: 'یاد گرفتیم ۳ تا کار رو' }, 'digit'],
    [{ title: 'یاد گرفتیم دربارهٔ سلامت تیم' }, 'sensitive_topic'],
  ])('%o fails with %s', (patch, rule) => {
    const lang: GrowthLang = /[؀-ۿ]/.test(Object.values(patch).join('')) ? 'fa' : 'en';
    expect(lintMoment({ ...moment(0), ...patch }, lang)).toContain(rule);
  });
});

describe('draftedGrowth', () => {
  const persona = { role: 'Backend Engineer', languages: ['English'] };
  const good = Array.from({ length: 12 }, (_, i) => moment(i));

  it('keeps the linted taught/task/access moments, drops room/season and bad ones, slugs ids', () => {
    const raw = { moments: [...good, moment(20, { kind: 'room', id: 'room-x' }), moment(21, { title: 'We fixed 2 bugs' }), { ...moment(22), id: 'Taught Thing Z!' }] };
    const g = draftedGrowth(raw, persona);
    expect(g).toMatchObject({ v: 1, lang: 'en', source: 'drafted' });
    expect(g.moments.map((m) => m.id)).toEqual([...good.map((m) => m.id), 'taught-thing-z']);
  });

  it('falls back to the role family default when the block is missing, malformed or too thin; never throws', () => {
    for (const raw of [undefined, 'nope', { moments: [] }, { moments: good.slice(0, MIN_DRAFTED - 1) }, { moments: good.map((m) => ({ ...m, title: 'I did it' })) }]) {
      const g = draftedGrowth(raw, persona);
      expect(g.source).toBe('default');
      expect(g.moments).toEqual(defaultMoments('Backend Engineer', 'en'));
    }
    expect(draftedGrowth(undefined, { role: 'Producer', languages: ['Persian', 'English'] })).toMatchObject({ lang: 'fa', source: 'default' });
  });

  it('caps the count at MAX_DRAFTED and the stored size at about 6 KB', () => {
    const many = Array.from({ length: 25 }, (_, i) => moment(i));
    const g = draftedGrowth({ moments: many }, persona);
    expect(g.moments.length).toBe(MAX_DRAFTED);
    expect(Buffer.byteLength(JSON.stringify(g))).toBeLessThanOrEqual(GROWTH_LIMITS.maxBytes);
  });

  it('draftPersona drafts growth in the same call, and a draft without it still succeeds with the default set', async () => {
    const llm = new ScriptedLLM().push(JSON.stringify({ ...JSON.parse(draftJson({ role: 'Backend Engineer' })), growth: { moments: good } }));
    const draft = await draftPersona(llm, {}, 'HOOR');
    expect(draft.growth.source).toBe('drafted');
    expect(draft.growth.moments).toHaveLength(12);
    expect(llm.requests[0].system).toContain('Also draft "growth"');
    const plain = await draftPersona(new ScriptedLLM().push(draftJson({ role: 'Backend Engineer' })), {}, 'HOOR');
    expect(plain.growth).toMatchObject({ source: 'default', lang: 'en' });
  });

  it('a creator edit uses the same lint and refuses instead of dropping', () => {
    const agent = { persona: personaSpec(), growth: undefined };
    expect(validateGrowthEdit({ moments: good }, agent)).toMatchObject({ ok: true });
    expect(validateGrowthEdit({ moments: [...good.slice(0, 11), moment(11, { title: 'We shipped 2 builds' })] }, agent)).toMatchObject({ ok: false, error: expect.stringMatching(/^growth\.moments\.11: digit/) });
    expect(validateGrowthEdit({ moments: [...good.slice(0, 11), moment(11, { kind: 'room' })] }, agent)).toMatchObject({ ok: false });
  });
});

describe('the lit store', () => {
  it('lights once, relights only after dimming, dims by note reference, clears on fire', async () => {
    const store = new FilePetGrowthStore(tempDir());
    const light = (id: string, at: number, ref?: string) => store.update('ag1', (lit) => {
      const exists = lit.find((l) => l.id === id && l.dimmedAt === undefined);
      return exists ? { lit: null, result: false } : { lit: [...lit.filter((l) => l.id !== id), { id, kind: 'taught' as const, at, ...(ref ? { ref } : {}) }], result: true };
    });
    expect(await light('taught-a', 1, noteRef(SECRET, 'x'))).toBe(true);
    expect(await light('taught-a', 2)).toBe(false);
    expect(await store.get('ag1')).toEqual([{ id: 'taught-a', kind: 'taught', at: 1, ref: noteRef(SECRET, 'x') }]);
    expect(Object.keys((await store.get('ag1'))[0]).sort()).toEqual(['at', 'id', 'kind', 'ref']);
    expect(await store.clearAgent('ag1')).toBe(1);
    expect(await store.get('ag1')).toEqual([]);
  });

  it('the view shows lit dates as ISO, hides dimmed moments, and lists personal ids only when defined', () => {
    const moments = [moment(0), moment(1), ...templateMoments('en')];
    const view = growthView(moments, [{ id: moment(0).id, kind: 'taught', at: Date.UTC(2026, 9, 26) }, { id: moment(1).id, kind: 'taught', at: 5, dimmedAt: 6 }],
      [{ id: 'room-play' }, { id: 'unknown-id' }]);
    expect(view.moments[0].lit).toEqual({ at: '2026-10-26T00:00:00.000Z' });
    expect(view.moments[1].lit).toBeUndefined();
    expect(view.mine).toEqual(['room-play']);
    expect(JSON.stringify(view)).not.toMatch(/\d+ of \d+|percent/);
  });
});

async function setup() {
  const h = makeStudio();
  h.studio.deps.webAppUrl = `${ORIGIN}/studio`;
  const org = await seedOrg(h);
  const mochi = await hire(h, org.alice, { name: 'Mochi', role: 'Backend Engineer' }, undefined, 'public');
  const call = (path: string[] = [], body?: unknown, as = ID.alice) => handlePetRequest(h.studio, new Request(
    `${ORIGIN}/api/studio/pet/${mochi.agent.id}${path.length ? `/${path.join('/')}` : ''}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-pet-tz': 'Asia/Tehran', 'x-telegram-init-data': agentInit(user(as), mochi.token) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }), mochi.agent.id, path);
  const view = async (as = ID.alice) => (await (await call([], undefined, as)).json() as PetView).growth!;
  const play = async (body: unknown, as = ID.alice) => (await (await call(['play'], body, as)).json()) as PlayResponse;
  const confirm = async (body: unknown, as = ID.alice) => { const res = await call(['growth', 'confirm'], body, as); return { status: res.status, body: await res.json() as GrowthConfirmResponse & { error?: string; message?: string } }; };
  const saveNote = async (owner: number, origin: 'dm' | 'group') => {
    const at = h.clock.now;
    const r = await h.studio.deps.notesLedger!.save(owner, { eventId: receiptIdFor(owner), noteId: randomBytes(12).toString('base64url'), text: 'We plan releases on Mondays.', origin,
      savedByAgentId: mochi.agent.id, agentIds: [mochi.agent.id], ...(origin === 'group' ? { fromGroupId: 'g1', groupTitle: 'Team' } : {}), authorTelegramId: owner, at });
    if (!r.ok) throw new Error('save failed');
    return r.copyId;
  };
  const lit = (g: PetView['growth'], id: string) => g!.moments.find((m) => m.id === id)?.lit;
  return { h, org, mochi, call, view, play, confirm, saveNote, lit };
}

describe('PetView.growth and the lighting triggers', () => {
  it('the view carries every moment (defaults plus templates for an agent without a drafted block), none lit, no mine', async () => {
    const { view } = await setup();
    const g = await view();
    expect(g.moments.length).toBeGreaterThanOrEqual(15);
    expect(g.moments.length).toBeLessThanOrEqual(25);
    expect(g.moments.every((m) => m.lit === undefined)).toBe(true);
    expect(g.mine).toBeUndefined();
    expect(g.moments.find((m) => m.id === 'taught-release')).toMatchObject({ kind: 'taught', title: 'We learned how we plan a release' });
  });

  it('room: a first visit lights the personal moment and, the first time anyone visits, the agent-wide one', async () => {
    const { h, mochi, view, play, lit } = await setup();
    const first = await play({ op: 'roomVisited', room: 'garden' });
    expect(first.guard).toBeUndefined();
    expect(first.growth!.mine).toEqual(['room-garden']);
    const at = lit(first.growth, 'room-garden')!.at;
    expect(at).toBe(h.clock.now.toISOString());
    h.advanceDays(1);
    // Bob's first visit is his own; the agent-wide moment keeps its first date
    const bob = await play({ op: 'roomVisited', room: 'garden' }, ID.bob);
    expect(bob.growth!.mine).toEqual(['room-garden']);
    expect(lit(bob.growth, 'room-garden')!.at).toBe(at);
    expect(lit(await view(ID.bob), 'room-garden')!.at).toBe(at);
    expect((await (await petGrowthStoreFor(h.studio)).get(mochi.agent.id))).toEqual([{ id: 'room-garden', kind: 'room', at: Date.parse(at) }]);
  });

  it('season: a first celebration lights the agent-wide festival moment; out of season lights nothing', async () => {
    const { h, play, lit } = await setup();
    const out = await play({ op: 'seasonCelebrated', season: 'nowruz' });
    expect(out.guard).toBe('out_of_season');
    expect(lit(out.growth, 'season-nowruz')).toBeUndefined();
    h.clock.now = new Date('2027-03-22T08:00:00Z');
    const on = await play({ op: 'seasonCelebrated', season: 'nowruz' });
    expect(on.guard).toBeUndefined();
    expect(lit(on.growth, 'season-nowruz')).toEqual({ at: '2027-03-22T08:00:00.000Z' });
  });

  it('access: an accepted ask lights the next access moment for that person only, once', async () => {
    const { play, view } = await setup();
    // P4 (speak out loud) is a convenience, not an access grant: accepted, but nothing lights (ACCESS_ASKS)
    const convenience = await play({ op: 'askAccepted', ask: 'P4' });
    expect(convenience.play.asks.P4).toMatchObject({ accepted: true });
    expect(convenience.growth!.mine ?? []).toEqual([]);
    await play({ op: 'askSeen', ask: 'P3' });
    const accepted = await play({ op: 'askAccepted', ask: 'P3' });
    expect(accepted.play.asks.P3).toMatchObject({ accepted: true });
    expect(accepted.growth!.mine).toEqual(['access-calendar']);
    expect((await play({ op: 'askAccepted', ask: 'P3' })).guard).toBe('noop');
    const second = await play({ op: 'askAccepted', ask: 'P3b' });
    expect(second.growth!.mine).toEqual(['access-calendar', 'access-checkins']);
    expect((await view(ID.bob)).mine).toBeUndefined();
    expect((await view()).moments.find((m) => m.id === 'access-calendar')!.lit).toBeUndefined();
  });

  it('taught: only through confirm; a group note lights the whole agent, a DM note or none only the person', async () => {
    const { h, mochi, confirm, saveNote, view, lit } = await setup();
    expect((await confirm({ momentId: 'room-play' })).status).toBe(404);
    expect((await confirm({ momentId: 'nope-not-here' })).body).toMatchObject({ message: 'moment_not_found' });
    // somebody else's copy, or one that does not exist, is never used
    const bobs = await saveNote(ID.bob, 'group');
    expect((await confirm({ momentId: 'taught-release', noteId: bobs })).body).toMatchObject({ message: 'note_not_found' });

    const group = await saveNote(ID.alice, 'group');
    const shared = await confirm({ momentId: 'taught-release', noteId: group });
    expect(shared.status).toBe(200);
    expect(shared.body.lit).toBe('agent');
    expect(lit(await view(ID.bob), 'taught-release')).toEqual({ at: h.clock.now.toISOString() });
    expect((await confirm({ momentId: 'taught-release', noteId: group })).body.lit).toBeNull();
    const stored = await (await petGrowthStoreFor(h.studio)).get(mochi.agent.id);
    expect(stored).toEqual([{ id: 'taught-release', kind: 'taught', at: h.clock.now.getTime(), ref: noteRef(SECRET, group) }]);
    expect(JSON.stringify(stored)).not.toContain(group);

    const dm = await saveNote(ID.alice, 'dm');
    const own = await confirm({ momentId: 'taught-team-ways', noteId: dm });
    expect(own.body).toMatchObject({ lit: 'mine', growth: { mine: ['taught-team-ways'] } });
    expect((await view(ID.bob)).mine).toBeUndefined();
    expect((await confirm({ momentId: 'taught-words' })).body.lit).toBe('mine');
  });

  it('taught: guests cannot confirm', async () => {
    const { confirm } = await setup();
    expect((await confirm({ momentId: 'taught-release' }, ID.stranger)).status).toBe(403);
  });

  it('erasing the source note dims the moment: agent-wide and personal', async () => {
    const { h, confirm, saveNote, view, lit } = await setup();
    const group = await saveNote(ID.alice, 'group');
    const dm = await saveNote(ID.alice, 'dm');
    await confirm({ momentId: 'taught-release', noteId: group });
    await confirm({ momentId: 'taught-team-ways', noteId: dm });
    expect(lit(await view(), 'taught-release')).toBeDefined();
    expect((await view()).mine).toEqual(['taught-team-ways']);

    expect(await h.studio.circleNotes.eraseOwn(ID.alice, group)).toBe(true);
    expect(lit(await view(), 'taught-release')).toBeUndefined();
    expect(await h.studio.circleNotes.eraseOwn(ID.alice, dm)).toBe(true);
    expect((await view()).mine).toBeUndefined();
    // taught again from a new note: it lights again
    const again = await saveNote(ID.alice, 'group');
    expect((await confirm({ momentId: 'taught-release', noteId: again })).body.lit).toBe('agent');
    // forget me (all notes) dims it too
    await h.studio.circleNotes.eraseFor(ID.alice);
    expect(lit(await view(), 'taught-release')).toBeUndefined();
  });

  it('firing the agent clears its lit moments', async () => {
    const { h, org, mochi, play } = await setup();
    await play({ op: 'roomVisited', room: 'play' });
    expect(await (await petGrowthStoreFor(h.studio)).get(mochi.agent.id)).toHaveLength(1);
    await h.studio.fire(org.superadmin, mochi.agent.id, { confirmName: 'Mochi', reason: 'test', memoryPolicy: 'delete' });
    expect(await (await petGrowthStoreFor(h.studio)).get(mochi.agent.id)).toEqual([]);
    expect(await (await petPlayStoreFor(h.studio)).get(mochi.agent.id, ID.alice)).toBeNull();
  });
});

describe('creator edits while forming', () => {
  it('PATCH-path updateGrowth: allowed while forming with the lint, refused after the lock', async () => {
    const { h, org, mochi, view } = await setup();
    const moments = Array.from({ length: 10 }, (_, i) => moment(i));
    const updated = await h.studio.updateGrowth(org.alice, mochi.agent.id, { moments });
    expect(updated.growth?.moments.map((m) => m.id)).toEqual(moments.map((m) => m.id));
    expect((await view()).moments.filter((m) => m.kind === 'taught').map((m) => m.id)).toEqual(moments.map((m) => m.id));
    await expect(h.studio.updateGrowth(org.alice, mochi.agent.id, { moments: [...moments.slice(0, 9), moment(9, { hint: 'Hurry, tell me now' })] })).rejects.toThrow(/banned-pressure/);
    await expect(h.studio.updateGrowth(org.bob, mochi.agent.id, { moments })).rejects.toThrow();
    h.advanceDays(8);
    await expect(h.studio.updateGrowth(org.alice, mochi.agent.id, { moments })).rejects.toThrow();
  });
});
