/** Wave C server needs: Guess rounds, access moments only for real access asks, P10 visits, and the pet-signed look edit. */
import { describe, expect, it } from 'vitest';
import type { InitDataUser } from '../auth';
import { agentInit } from './initdata-keys';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { handlePetRequest, RESERVED_PET_SEGMENTS } from '../pet-http';
import { ACCESS_ASKS, applyPlay, GAME_IDS, newPlay, sanitizePlay, type PlayContext } from '../../pet/play';
import type { LookResponse, PetView } from '../../pet/types';
import { hire, ID, makeStudio, seedOrg } from './helpers';

const ORIGIN = 'https://vox.example';
const ctx = (o: Partial<PlayContext> = {}): PlayContext => ({ now: Date.parse('2026-10-26T10:00:00Z'), tz: 'Asia/Tehran', stage: 4, formed: true, bond: 0, ...o });

describe('play', () => {
  it('records Guess rounds and its best page', () => {
    expect(GAME_IDS).toContain('guess');
    const r = applyPlay(newPlay('a', 1, 0), { op: 'gameRound', game: 'guess', outcome: 'best', round: 'round-0001' }, ctx());
    expect(r.play.games.guess).toMatchObject({ rounds: 1, best: true });
    expect(r.play.book.map((b) => b.id)).toEqual(['bestGuess']);
  });

  it('lights an access moment only for real access grants', () => {
    expect(ACCESS_ASKS).toEqual(['P1', 'P2', 'P3', 'P3b', 'P5']);
    const moments = ['access-1', 'access-2'];
    for (const ask of ['P7', 'P8', 'P9', 'P10', 'P4', 'P6'] as const) {
      const r = applyPlay(newPlay('a', 1, 0), { op: 'askAccepted', ask }, ctx({ accessMoments: moments }));
      expect(r.play.asks[ask]?.acceptedAt).toBeDefined();
      expect(r.play.litMine).toEqual([]);
    }
    for (const ask of ACCESS_ASKS) expect(applyPlay(newPlay('a', 1, 0), { op: 'askAccepted', ask }, ctx({ accessMoments: moments })).play.litMine.map((l) => l.id)).toEqual(['access-1']);
  });

  it('P10 visits: a content-free flag, idempotent, kept by the sanitizer', () => {
    const open = applyPlay(newPlay('a', 1, 0), { op: 'setVisits', open: true }, ctx());
    expect(open.play.visitsOpen).toBe(true);
    expect(applyPlay(open.play, { op: 'setVisits', open: true }, ctx()).guard).toBe('noop');
    expect(applyPlay(open.play, { op: 'setVisits', open: false }, ctx()).play.visitsOpen).toBeUndefined();
    expect(sanitizePlay({ ...open.play }, 'a', 1)?.visitsOpen).toBe(true);
    expect(sanitizePlay({ ...open.play, visitsOpen: 'yes' }, 'a', 1)?.visitsOpen).toBeUndefined();
  });
});

describe('the pet routes', () => {
  async function setup() {
    const h = makeStudio();
    h.studio.deps.webAppUrl = `${ORIGIN}/studio`;
    const org = await seedOrg(h);
    const mochi = await hire(h, org.alice, { name: 'Mochi' }, undefined, 'public');
    const call = (path: string[], as: number, body?: unknown) => handlePetRequest(h.studio, new Request(`${ORIGIN}/api/studio/pet/${mochi.agent.id}${path.length ? `/${path.join('/')}` : ''}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-pet-tz': 'Asia/Tehran', 'x-telegram-init-data': agentInit({ id: as, first_name: 'U' } as InitDataUser, mochi.token) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }), mochi.agent.id, path);
    return { h, mochi, call };
  }

  it('the check-in trigger route never clashes with an agent id (static `checkins` beside `[agentId]`)', async () => {
    const { h, mochi, call } = await setup();
    // every static sibling of [agentId] is reserved; Studio's own ids can never take one of those names
    const siblings = readdirSync(join(process.cwd(), 'src/app/api/studio/pet'), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('[')).map((d) => d.name).sort();
    expect(siblings).toEqual(['checkins', 'launch']);
    expect([...RESERVED_PET_SEGMENTS].sort()).toEqual(siblings);
    expect(mochi.agent.id).toMatch(/^ag[0-9a-f]{10}$/);
    expect(RESERVED_PET_SEGMENTS.has(mochi.agent.id)).toBe(false);
    for (const id of siblings) {
      for (const path of [[], ['run'], ['checkins']]) {
        const res = await handlePetRequest(h.studio, new Request(`${ORIGIN}/api/studio/pet/${id}/${path.join('/')}`, { method: path.length ? 'POST' : 'GET', headers: { origin: ORIGIN } }), id, path);
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ error: 'pet_unavailable' });
      }
    }
    expect((await call([], ID.alice)).status).toBe(200);
  });

  it('POST play takes setVisits and Guess rounds', async () => {
    const { call } = await setup();
    expect(await (await call(['play'], ID.alice, { op: 'setVisits', open: true })).json()).toMatchObject({ play: { visitsOpen: true } });
    expect((await call(['play'], ID.alice, { op: 'setVisits', open: 'yes' })).status).toBe(400);
    expect(await (await call(['play'], ID.alice, { op: 'gameRound', game: 'guess', outcome: 'finished', round: 'round-0002' })).json()).toMatchObject({ play: { games: { guess: { rounds: 'one' } } } });
  });

  it('canEditLook on the view: the creator and an admin (who opens as member); not a member or a guest', async () => {
    const { call } = await setup();
    expect(await (await call([], ID.alice)).json()).toMatchObject({ role: 'owner', canEditLook: true });
    expect(await (await call([], ID.admin)).json()).toMatchObject({ role: 'member', canEditLook: true });
    expect(((await (await call([], ID.bob)).json()) as PetView).canEditLook).toBe(false);
    expect(((await (await call([], ID.stranger)).json()) as PetView).canEditLook).toBe(false);
  });

  it('POST look saves the real look for the creator or an admin only, validated', async () => {
    const { h, call, mochi } = await setup();
    const res = await call(['look'], ID.alice, { look: { hue: 'matcha', features: { cheeks: false } }, sync: false });
    expect(res.status).toBe(200);
    const body = await res.json() as LookResponse;
    expect(body.look).toMatchObject({ hue: 'matcha', features: { cheeks: false } });
    expect((await h.store.read()).agents.find((a) => a.id === mochi.agent.id)!.look).toMatchObject({ hue: 'matcha' });
    expect((await call(['look'], ID.admin, { look: { hue: 'sky' } })).status).toBe(200);
    expect(await (await call(['look'], ID.bob, { look: { hue: 'sky' } })).json()).toEqual({ error: 'look_forbidden' });
    expect((await call(['look'], ID.stranger, { look: { hue: 'sky' } })).status).toBe(403);
    expect((await call(['look'], ID.alice, { look: { hue: 'not-a-colour' } })).status).toBe(400);
    expect((await call(['look'], ID.alice, { look: { avatar: 'x.png' } })).status).toBe(400);
    expect((await call(['look'], ID.alice, { hue: 'sky' })).status).toBe(400);
  });
});
