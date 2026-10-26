/** POST/GET …/play and PetView.play (design §3.4): the play record beside care, authorised exactly like care. */
import { describe, expect, it } from 'vitest';
import type { InitDataUser } from '../auth';
import { agentInit } from './initdata-keys';
import { handleMyDataRequest } from '../my-data-http';
import { handlePetRequest } from '../pet-http';
import { petPlayStoreFor } from '../pet-play-store';
import { petStoreFor } from '../pet-store';
import type { MyDataForgetResponse, MyDataResponse } from '../my-data-contract';
import type { PlayResponse } from '../../pet/play';
import type { PetView } from '../../pet/types';
import type { AgentVisibility } from '../types';
import { hire, ID, makeStudio, seedOrg, type Harness } from './helpers';

const ORIGIN = 'https://vox.example';
const MANAGER = '123:synthetic-manager';
const user = (id: number): InitDataUser => ({ id, first_name: `U${id}` });

interface Call { method?: string; as?: number; body?: unknown; raw?: string; headers?: Record<string, string>; agent?: { agent: { id: string }; token: string } }

async function setup(o: { visibility?: AgentVisibility; harness?: Harness } = {}) {
  const h = o.harness ?? makeStudio();
  h.studio.deps.webAppUrl = `${ORIGIN}/studio`;
  const org = await seedOrg(h);
  const mochi = await hire(h, org.alice, { name: 'Mochi' }, undefined, o.visibility ?? 'public');
  const pip = await hire(h, org.alice, { name: 'Pip' }, undefined, o.visibility ?? 'public');
  const call = (path: string[] = [], c: Call = {}) => {
    const agent = c.agent ?? mochi;
    const method = c.method ?? (c.body === undefined && c.raw === undefined ? 'GET' : 'POST');
    const request = new Request(`${ORIGIN}/api/studio/pet/${agent.agent.id}${path.length ? `/${path.join('/')}` : ''}`, {
      method,
      headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-pet-tz': 'Asia/Tehran', 'x-telegram-init-data': agentInit(user(c.as ?? ID.alice), agent.token), ...c.headers },
      ...(c.raw !== undefined ? { body: c.raw } : c.body !== undefined ? { body: JSON.stringify(c.body) } : {}),
    });
    return handlePetRequest(h.studio, request, agent.agent.id, path);
  };
  const play = async (body: unknown, c: Omit<Call, 'body'> = {}) => {
    const res = await call(['play'], { ...c, body });
    return { status: res.status, body: await res.json() as PlayResponse & { error?: string } };
  };
  const mine = (path: string[] = [], body?: unknown) => handleMyDataRequest(h.studio, new Request(`${ORIGIN}/api/studio/my-data${path.length ? `/${path.join('/')}` : ''}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-telegram-init-data': agentInit(user(ID.alice), MANAGER) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), path, MANAGER);
  return { h, org, mochi, pip, call, play, mine };
}

describe('the play record on open', () => {
  it('rides on the view, empty before any play, without creating a record', async () => {
    const { h, call, mochi } = await setup();
    const view = await (await call()).json() as PetView;
    expect(view.play).toEqual({ items: [], wearing: {}, garden: null, book: [], games: {}, tips: {}, asks: {}, seasons: {}, litMine: [], tipsToday: 0 });
    expect(await (await petPlayStoreFor(h.studio)).get(mochi.agent.id, ID.alice)).toBeNull();
    // every existing field is still there
    expect(view).toMatchObject({ agentId: mochi.agent.id, name: 'Mochi', role: 'owner', care: { tummy: 75 } });
  });

  it('a broken play store never closes the pet: the view opens without play', async () => {
    const { h, call } = await setup();
    h.studio.deps.petPlay = { get: async () => { throw new Error('disk'); } } as never;
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty('play');
    expect(h.logger.warn).toHaveBeenCalledWith('[studio] pet_play_read_failed');
  });

  it('an open moves the record seenAt (the guest sweep clock) at most twice a day', async () => {
    const { h, call, play, mochi } = await setup();
    await play({ op: 'roomVisited', room: 'garden' });
    const plays = await petPlayStoreFor(h.studio);
    const first = (await plays.get(mochi.agent.id, ID.alice))!.seenAt;
    h.clock.now = new Date(h.clock.now.getTime() + 3_600_000);
    await call();
    expect((await plays.get(mochi.agent.id, ID.alice))!.seenAt).toBe(first);
    h.advanceDays(1);
    await call();
    expect((await plays.get(mochi.agent.id, ID.alice))!.seenAt).toBe(h.clock.now.getTime());
  });
});

describe('POST play', () => {
  it('applies one idempotent mutation and answers the view, a guard, and the server clock', async () => {
    const { h, call, play } = await setup();
    const planted = await play({ op: 'plantSeed', seed: 'flower' });
    expect(planted.status).toBe(200);
    expect(planted.body).toMatchObject({ now: h.clock.now.getTime(), play: { garden: { seed: 'flower', waterings: 0, state: 'seeded' } } });
    expect(planted.body.guard).toBeUndefined();
    expect((await play({ op: 'plantSeed', seed: 'flower' })).body.guard).toBe('noop');
    expect((await play({ op: 'waterSeed' })).body.play.garden).toMatchObject({ waterings: 1, state: 'watered' });
    expect((await play({ op: 'waterSeed' })).body.guard).toBe('noop');
    expect((await play({ op: 'lightItem', item: 'starPin' })).body.guard).toBe('locked');
    expect((await play({ op: 'bookMoment', moment: 'met' })).body.play.book).toEqual([{ id: 'met', at: h.clock.now.getTime() }]);
    const read = await (await call(['play'])).json() as PlayResponse;
    expect(read.play.garden).toMatchObject({ waterings: 1 });
    expect(((await (await call()).json()) as PetView).play?.book).toHaveLength(1);
  });

  it('never touches PetCare', async () => {
    const { h, call, play, mochi } = await setup();
    await call();
    const before = await (await petStoreFor(h.studio)).get(mochi.agent.id, ID.alice);
    for (const body of [{ op: 'plantSeed', seed: 'flower' }, { op: 'waterSeed' }, { op: 'gameRound', game: 'bop', outcome: 'best', round: 'abcdefgh' },
      { op: 'tipSeen', tip: 'T1' }, { op: 'askSeen', ask: 'P8' }, { op: 'roomVisited', room: 'play' }]) expect((await play(body)).status).toBe(200);
    expect(await (await petStoreFor(h.studio)).get(mochi.agent.id, ID.alice)).toEqual(before);
  });

  it('accepts only catalogue ids: no free text, no unknown ops, no extra fields, JSON only', async () => {
    const { h, call, play, mochi } = await setup();
    for (const body of [
      { op: 'note', text: 'hello' }, { op: 'plantSeed', seed: 'flower', note: 'x' }, { op: 'lightItem', item: 'goldenCoin' },
      { op: 'gameRound', game: 'bop', outcome: 'finished', round: 'has spaces in it' }, { op: 'gameRound', game: 'bop', outcome: 'won', round: 'abcdefgh' },
      { op: 'wear', slot: 'tail', item: 'bow' }, { op: 'seasonCelebrated', season: 'christmas' }, 'plantSeed', null,
    ]) expect((await play(body)).status).toBe(400);
    expect((await call(['play'], { raw: 'x'.repeat(2048) })).status).not.toBe(200);
    expect((await call(['play'], { raw: '{"op":"waterSeed"}', headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect(await (await petPlayStoreFor(h.studio)).get(mochi.agent.id, ID.alice)).toBeNull();
  });

  it('guests play too; a stranger to a private agent gets pet_private and no record', async () => {
    const pub = await setup();
    expect((await pub.play({ op: 'roomVisited', room: 'closet' }, { as: ID.stranger })).body.play.litMine).toEqual([{ id: 'room-closet', litAt: pub.h.clock.now.getTime() }]);
    const priv = await setup({ visibility: 'private' });
    const res = await priv.play({ op: 'roomVisited', room: 'closet' }, { as: ID.stranger });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('pet_private');
    expect(await (await petPlayStoreFor(priv.h.studio)).listForUser(ID.stranger)).toEqual([]);
  });

  it('needs Telegram auth and the Studio origin, like care', async () => {
    const { call } = await setup();
    expect((await call(['play'], { body: { op: 'waterSeed' }, headers: { 'x-telegram-init-data': '' } })).status).toBe(401);
    expect((await call(['play'], { body: { op: 'waterSeed' }, headers: { origin: 'https://evil.example' } })).status).toBe(403);
  });

  it('a festival celebrates once per person per Persian year across all their agents', async () => {
    const { h, play, pip } = await setup();
    h.clock.now = new Date(Date.UTC(2026, 11, 21, 15)); // Yalda 1405 in Tehran
    const first = await play({ op: 'seasonCelebrated', season: 'yalda' });
    expect(first.body.play).toMatchObject({ season: 'yalda', seasons: { yalda: 1405 }, items: [{ id: 'pomegranateCrown' }] });
    expect((await play({ op: 'seasonCelebrated', season: 'yalda' }, { agent: pip })).body.guard).toBe('elsewhere');
    expect((await play({ op: 'seasonCelebrated', season: 'nowruz' })).body.guard).toBe('out_of_season');
  });
});

describe('play follows care wherever a person’s data goes', () => {
  it('a forget fences an old open (409) until a fresh open supplies its epoch', async () => {
    const { call, play, mine } = await setup();
    expect((await play({ op: 'roomVisited', room: 'play' })).status).toBe(200);
    const forget = await mine(['forget'], { confirm: true });
    expect(forget.status).toBe(200);
    expect(await forget.json() as MyDataForgetResponse).toMatchObject({ playErased: 1 });
    const stale = await play({ op: 'roomVisited', room: 'garden' });
    expect(stale.status).toBe(409);
    const view = await (await call()).json() as PetView;
    expect(view.play?.litMine).toEqual([]);
    expect((await play({ op: 'roomVisited', room: 'garden' }, { headers: { 'x-pet-care-epoch': view.careEpoch! } })).status).toBe(200);
  });

  it('My data exports play only when there is some, with the agent names', async () => {
    const { play, mine, mochi } = await setup();
    expect(await (await mine()).json()).not.toHaveProperty('petPlay');
    await play({ op: 'tipSeen', tip: 'T2' });
    const body = await (await mine()).json() as MyDataResponse;
    expect(body.petPlay?.map((p) => [p.agentId, p.userId])).toEqual([[mochi.agent.id, ID.alice]]);
    expect(body.agentNames[mochi.agent.id]).toBe('Mochi');
  });

  it('firing an agent clears its play', async () => {
    const { h, org, play, mochi } = await setup();
    await play({ op: 'roomVisited', room: 'play' });
    await h.studio.fire(org.admin, mochi.agent.id, { reason: '', memoryPolicy: 'archive', confirmName: 'Mochi' });
    expect(await (await petPlayStoreFor(h.studio)).listForUser(ID.alice)).toEqual([]);
  });
});
