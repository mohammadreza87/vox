import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { signInitData, type InitDataUser } from '../auth';
import { handleMyDataRequest } from '../my-data-http';
import { handlePetRequest } from '../pet-http';
import { petStoreFor } from '../pet-store';
import { StudioRateLimiter } from '../ratelimit';
import { handleManagerUpdate } from '../updates';
import type { MyDataResponse } from '../my-data-contract';
import type { AgentVisibility } from '../types';
import { agentInit } from './initdata-keys';
import { receiptIdFor } from '../../circles/codec';
import { hire, ID, makeStudio, seedOrg, type Harness } from './helpers';

const ORIGIN = 'https://vox.example';
const MANAGER = '123:synthetic-manager';
const user = (id: number): InitDataUser => ({ id, first_name: `U${id}` });

interface Call { method?: string; as?: number; init?: string; body?: unknown; raw?: string; headers?: Record<string, string>; query?: string }

async function setup(o: { visibility?: AgentVisibility; harness?: Harness } = {}) {
  const h = o.harness ?? makeStudio();
  h.studio.deps.webAppUrl = `${ORIGIN}/studio`;
  const org = await seedOrg(h);
  const mochi = await hire(h, org.alice, { name: 'Mochi' }, undefined, o.visibility ?? 'public');
  const pip = await hire(h, org.alice, { name: 'Pip' }, undefined, o.visibility ?? 'public');
  /** The My data API, VoxxBot-signed by default. */
  const mine = (path: string[] = [], c: Call = {}) => {
    const method = c.method ?? (c.body === undefined && c.raw === undefined ? 'GET' : 'POST');
    return handleMyDataRequest(h.studio, new Request(`${ORIGIN}/api/studio/my-data${path.length ? `/${path.join('/')}` : ''}${c.query ?? ''}`, {
      method, headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-telegram-init-data': c.init ?? agentInit(user(c.as ?? ID.stranger), MANAGER), ...c.headers },
      ...(c.raw !== undefined ? { body: c.raw } : c.body !== undefined ? { body: JSON.stringify(c.body) } : {}),
    }), path, MANAGER);
  };
  /** Opens (and so creates care for) an agent's pet as `as`, agent-signed. */
  const visit = (agent: typeof mochi, as: number) => handlePetRequest(h.studio, new Request(`${ORIGIN}/api/studio/pet/${agent.agent.id}`, {
    headers: { 'x-pet-tz': 'UTC', 'x-telegram-init-data': agentInit(user(as), agent.token) } }), agent.agent.id, []);
  /** A note copy in `owner`'s notes, from a group. */
  const note = async (owner: number, text: string, agentId = mochi.agent.id) => {
    const saved = await h.studio.deps.notesLedger!.save(owner, { eventId: receiptIdFor(owner), noteId: `n-${text.length}-${owner}`, text, origin: 'group',
      savedByAgentId: agentId, agentIds: [agentId], fromGroupId: 'g1', groupTitle: 'HOOR family', authorTelegramId: owner, at: h.clock.now });
    if (!saved.ok) throw new Error('note not saved');
    return saved.copyId;
  };
  return { h, org, mochi, pip, mine, visit, note };
}

describe('My data (VoxxBot-signed): export', () => {
  it('two people with data across two agents each see only their own, with the agents’ names', async () => {
    const { mochi, pip, mine, visit, note } = await setup();
    for (const as of [ID.stranger, 4242]) { await visit(mochi, as); await visit(pip, as); }
    await note(ID.stranger, 'mine: dinner on Friday');
    await note(4242, 'theirs: bring cake');
    const res = await mine();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
    const body = await res.json() as MyDataResponse;
    expect(body.petCare.map((c) => c.agentId).sort()).toEqual([mochi.agent.id, pip.agent.id].sort());
    expect(body.petCare.every((c) => c.userId === ID.stranger)).toBe(true);
    expect(body.notes!.map((n) => n.text)).toEqual(['mine: dinner on Friday']);
    expect(body.agentNames).toEqual({ [mochi.agent.id]: 'Mochi', [pip.agent.id]: 'Pip' });
    expect(JSON.stringify(body)).not.toContain('4242');
    expect(JSON.stringify(body)).not.toContain('bring cake');
  });

  it('an outsider with no member row works and is never enrolled; a pending person works too', async () => {
    const { h, mochi, mine, visit } = await setup();
    await visit(mochi, ID.stranger);
    const members = (await h.store.read()).members.length;
    expect((await mine([], { as: ID.stranger })).status).toBe(200);
    expect((await mine([], { as: ID.pending })).status).toBe(200);
    expect((await mine([], { as: 777001 })).status).toBe(200);
    expect((await h.store.read()).members.length).toBe(members);
    expect((await h.store.read()).members.some((m) => m.telegramId === ID.stranger || m.telegramId === 777001)).toBe(false);
  });

  it('includes their own agent choices and circle participation, and only theirs', async () => {
    const { h, mochi, mine } = await setup();
    h.studio.deps.circles = () => 'reply';
    for (const id of [ID.stranger, 4242]) {
      const receipt = await h.studio.presentAgentCard(mochi.agent.id, id, { copyHash: 'a'.repeat(64), locale: 'en' });
      h.clock.now = new Date(h.clock.now.getTime() + 1000);
      expect(await h.studio.recordAgentChoice(mochi.agent.id, id, receipt.id, 'joined', `cb-${id}`)).toMatchObject({ ok: true });
    }
    const chatId = -100888, ledger = h.studio.deps.circleLedger!;
    await ledger.open({ chatId, agentId: 'agent-x', openedBy: ID.alice, at: h.clock.now, card: { id: 'gcard', copyHash: 'a'.repeat(64), locale: 'en', noticeVersion: 'circle-v1' } });
    h.clock.now = new Date(h.clock.now.getTime() + 1000);
    for (const id of [ID.stranger, 4242]) {
      await ledger.index(id, chatId);
      expect(await ledger.decide(chatId, { telegramId: id, choice: 'joined', cardId: 'gcard', eventId: `cb2-${id}`, at: h.clock.now, surface: 'group_card' })).toMatchObject({ ok: true });
    }
    const body = await (await mine()).json() as MyDataResponse;
    expect(body.agentChoices).toEqual([expect.objectContaining({ agentId: mochi.agent.id, telegramId: ID.stranger, choice: 'joined' })]);
    expect(body.circles).toEqual([expect.objectContaining({ chatId, state: 'joined' })]);
    expect(JSON.stringify(body)).not.toContain('4242');
  });
});

describe('My data: forget and note erase', () => {
  it('forget erases the caller’s pet care, choices, circles and notes across every agent, and nobody else’s', async () => {
    const { h, mochi, pip, mine, visit, note } = await setup();
    for (const as of [ID.stranger, 4242]) { await visit(mochi, as); await visit(pip, as); }
    await note(ID.stranger, 'mine');
    await note(4242, 'theirs');
    expect((await mine(['forget'], { body: {} })).status).toBe(400); // an explicit confirm is required
    const res = await mine(['forget'], { body: { confirm: true } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ erased: 2, notesErased: 1 });
    const pets = await petStoreFor(h.studio);
    expect(await pets.listForUser(ID.stranger)).toEqual([]);
    expect(await pets.listForUser(4242)).toHaveLength(2);
    expect((await h.studio.notesFor(4242)).map((n) => n.text)).toEqual(['theirs']);
    expect(await (await mine()).json()).toEqual({ petCare: [], agentNames: {} });
  });

  it('erases only the caller’s own note copy; another person’s copy id does nothing', async () => {
    const { h, mine, note } = await setup();
    const own = await note(ID.stranger, 'mine');
    const theirs = await note(4242, 'theirs');
    expect(await (await mine(['notes', theirs], { method: 'DELETE' })).json()).toEqual({ erased: false });
    expect((await h.studio.notesFor(4242)).map((n) => n.text)).toEqual(['theirs']);
    expect(await (await mine(['notes', own], { method: 'DELETE' })).json()).toEqual({ erased: true });
    expect(await h.studio.notesFor(ID.stranger)).toEqual([]);
    expect((await mine(['notes', 'not a copy id'], { method: 'DELETE' })).status).toBe(404);
  });
});

describe('My data: who may call it', () => {
  it('refuses agent-signed initData, even with a valid Telegram signature, and never erases', async () => {
    const { h, mochi, mine, visit } = await setup();
    await visit(mochi, ID.stranger);
    const agentSigned = agentInit(user(ID.stranger), mochi.token);
    expect((await mine([], { init: agentSigned })).status).toBe(401);
    expect((await mine(['forget'], { init: agentSigned, body: { confirm: true } })).status).toBe(401);
    expect(await (await petStoreFor(h.studio)).listForUser(ID.stranger)).toHaveLength(1);
  });

  it('accepts a VoxxBot initData without a signature (only Vox holds that token) but refuses a forged signature', async () => {
    const { mine } = await setup();
    expect((await mine([], { init: signInitData(user(ID.stranger), MANAGER) })).status).toBe(200);
    const forged = signInitData(user(ID.stranger), MANAGER, undefined, {}, { botId: 123, privateKey: generateKeyPairSync('ed25519').privateKey });
    expect((await mine([], { init: forged })).status).toBe(401);
    expect((await mine([], { init: '' })).status).toBe(401);
    expect((await mine([], { init: 'x'.repeat(16_385) })).status).toBe(401);
  });

  it('hostile origin 403, any query string 400, a body over 4 KiB 413, unknown routes 404, rate limits 429', async () => {
    const { h, mine } = await setup();
    expect((await mine(['forget'], { body: { confirm: true }, headers: { origin: 'https://hostile.example' } })).status).toBe(403);
    expect((await mine(['forget'], { body: { confirm: true }, headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await mine([], { query: '?as=4242' })).status).toBe(400);
    expect((await mine(['forget'], { raw: JSON.stringify({ confirm: true, pad: 'x'.repeat(5000) }) })).status).toBe(413);
    expect((await mine(['forget'], { body: { confirm: true }, headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect((await mine(['export'])).status).toBe(404);
    expect((await mine([], { method: 'PUT', body: {} })).status).toBe(404);
    h.studio.deps.rateLimiter = new StudioRateLimiter({ policies: { api: { requests: 2, windowMs: 60_000 } } });
    expect((await mine()).status).toBe(200);
    expect((await mine()).status).toBe(200);
    const limited = await mine();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
  });
});

describe('My data: the VoxxBot DM entrance', () => {
  it('/start mydata answers with one EN+FA web_app button to the page, before any member is created', async () => {
    const { h } = await setup();
    const members = (await h.store.read()).members.length;
    h.manager.sendMessage.mockClear();
    await handleManagerUpdate(h.studio, { update_id: 1, message: { message_id: 1, date: 0, text: '/start mydata',
      chat: { id: 777002, type: 'private' }, from: { id: 777002, is_bot: false, first_name: 'Outsider' } } });
    expect(h.manager.sendMessage).toHaveBeenCalledTimes(1);
    const [chat, text, opts] = h.manager.sendMessage.mock.calls[0];
    expect(chat).toBe(777002);
    expect(text).toContain('Your Vox data');
    expect(text).toContain('داده‌های شما در وکس');
    expect(opts).toEqual({ keyboard: { inline_keyboard: [[{ text: 'My data · داده‌های من', web_app: { url: `${ORIGIN}/studio/my-data` } }]] } });
    expect((await h.store.read()).members.length).toBe(members);
    // a plain /start still behaves as before (adds them to the pending list)
    await handleManagerUpdate(h.studio, { update_id: 2, message: { message_id: 2, date: 0, text: '/start',
      chat: { id: 777002, type: 'private' }, from: { id: 777002, is_bot: false, first_name: 'Outsider' } } });
    expect((await h.store.read()).members.some((m) => m.telegramId === 777002 && m.role === 'pending')).toBe(true);
  });
});
