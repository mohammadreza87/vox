import { afterEach, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { learningFixture } from './fixtures';
import { ID } from '../../../studio/__tests__/helpers';
import { signInitData } from '../../../studio/auth';
import { handleExperienceRequest } from '../../runtime/http';
import { handleConversationRequest } from '../../../studio/conversation';
import { handleStudioRequest } from '../../../studio/http';
const TOKEN = '123:synthetic-manager';
const fixtures: Awaited<ReturnType<typeof learningFixture>>[] = [];
async function setup() { const x = await learningFixture(); fixtures.push(x); return x; }
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await Promise.all(fixtures.splice(0).map(x => x.close())); });
function request(path: string, method = 'GET', value?: unknown, extras: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request(`https://vox.example/api/studio/${path}`, { method, signal, headers: {
    'content-type': 'application/json', origin: 'https://vox.example', 'x-telegram-init-data': signInitData({ id: ID.alice, first_name: 'Synthetic' }, TOKEN), ...extras,
  }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
it('uses authenticated same-origin APIs for opt-in and review, strips internal receipts and preserves real Undo', async () => {
  const x = await setup(), path = `experience/preference-learning?space=work&agentId=${x.agent.id}`;
  const handle = (req: Request, parts = ['preference-learning']) => handleExperienceRequest(x.h.studio, x.experience, req, parts, TOKEN);
  expect((await handle(request(path, 'GET', undefined, { 'x-telegram-init-data': '' }))).status).toBe(401);
  expect((await handle(request('experience/preference-learning', 'PUT', {}, { origin: 'https://hostile.example' }))).status).toBe(403);
  await x.f.grant(); await x.f.agent();
  const initial = await (await handle(request(path))).json(); expect(initial).not.toHaveProperty('receipt'); expect(initial.enabled).toBe(false);
  const shownResponse = await handle(request('experience/preference-learning/present', 'POST', { ...x.scope, expectedRevision: initial.revision, eventId: randomUUID(), locale: 'fa' }), ['preference-learning', 'present']);
  expect(shownResponse.status).toBe(200); const shown = await shownResponse.json();
  const enabled = await handle(request('experience/preference-learning', 'PUT', { ...x.scope, expectedRevision: shown.revision, eventId: randomUUID(), enabled: true, version: shown.version, receipt: shown.presentation.receipt }));
  expect(enabled.status).toBe(200); expect((await enabled.json()).enabled).toBe(true);
  x.enqueue(); await x.learning.tasks.settle(); const view = await (await handle(request(path))).json();
  expect(JSON.stringify(view)).not.toMatch(/evidenceIds|bindingId|personId|permissionRevision|learningReservation|finalFingerprint/);
  const used = await handle(request('experience/preference-learning/review', 'POST', { ...x.scope, expectedRevision: view.revision, eventId: randomUUID(), action: 'use', candidateId: view.candidates[0].id }), ['preference-learning', 'review']);
  expect(used.status).toBe(200); expect((await x.f.state()).entries[0].undo?.restore).toBeNull();
});
it('successful final HTTP response does not wait for or abort the tracked learning job; true disconnect does', async () => {
  const x = await setup(); await x.enable(); const original = x.provider.evaluate.getMockImplementation()!;
  let release!: () => void, signal!: AbortSignal;
  x.provider.evaluate.mockImplementationOnce(async (...args) => { signal = args[1]; await new Promise<void>(r => { release = r; }); return original(...args); });
  const controller = new AbortController();
  const response = await handleConversationRequest(x.h.studio, request('conversation', 'POST', { ...x.scope, text: 'Please keep future replies brief.', turn: x.turn() }, {}, controller.signal), TOKEN);
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ reply: 'Sure.' });
  await vi.waitFor(() => expect(release).toBeTypeOf('function')); expect(signal.aborted).toBe(false); release(); await x.learning.tasks.settle();
  expect((await x.view()).candidates).toHaveLength(1);
  await x.learning.review(ID.alice, { ...await x.command(), action: 'dismiss', candidateId: (await x.view()).candidates[0].id });
  x.provider.evaluate.mockImplementationOnce(async (...args) => { signal = args[1]; await new Promise<void>(r => { release = r; }); return original(...args); });
  release = undefined!;
  const second = await handleConversationRequest(x.h.studio, request('conversation', 'POST', { ...x.scope, text: 'Please use brief replies next time.', turn: x.turn() }, {}, controller.signal), TOKEN);
  expect(second.status).toBe(200); await vi.waitFor(() => expect(release).toBeTypeOf('function')); controller.abort(); expect(signal.aborted).toBe(true);
  release(); await x.learning.tasks.settle(); expect((await x.view()).candidates).toEqual([]);
});
it('legacy text and denied personal requests do not invent a learning turn or call Decisions', async () => {
  const x = await setup(); await x.enable();
  expect((await handleConversationRequest(x.h.studio, request('conversation', 'POST', { ...x.scope, text: 'Please be brief.' }), TOKEN)).status).toBe(200);
  expect((await handleConversationRequest(x.h.studio, request('conversation', 'POST', { ...x.scope, space: 'personal', text: 'Please be brief.', turn: x.turn() }), TOKEN)).status).toBe(403);
  await x.learning.tasks.settle(); expect(x.provider.evaluate).not.toHaveBeenCalled();
});
it('final tap-to-talk uses the actual server turn ID and never microphone audio as classifier evidence', async () => {
  const x = await setup(); await x.enable(); vi.stubGlobal('Blob', NodeBlob);
  const form = '--synthetic-boundary\r\nContent-Disposition: form-data; name="space"\r\n\r\nwork\r\n--synthetic-boundary\r\nContent-Disposition: form-data; name="audio"; filename="synthetic.webm"\r\nContent-Type: audio/webm\r\n\r\nsynthetic-audio\r\n--synthetic-boundary--\r\n';
  const req = new Request(`https://vox.example/api/studio/agents/${x.agent.id}/call`, { method: 'POST', body: form,
    headers: { 'content-type': 'multipart/form-data; boundary=synthetic-boundary', origin: 'https://vox.example', 'x-telegram-init-data': signInitData({ id: ID.alice, first_name: 'Synthetic' }, TOKEN) } });
  x.h.openai.transcribe.mockResolvedValue('Please keep future replies brief.');
  const enqueue = vi.spyOn(x.learning, 'enqueue');
  const response = await handleStudioRequest(x.h.studio, req, ['agents', x.agent.id, 'call'], { botToken: TOKEN });
  expect(response.status).toBe(200); await response.json(); expect(enqueue).toHaveBeenCalledOnce();
  const turnId = enqueue.mock.calls[0][0].turn.turnId; expect(turnId).toBeTypeOf('string');
  await x.learning.tasks.settle(); expect(x.provider.evaluate).toHaveBeenCalledOnce();
  expect(x.provider.evaluate.mock.calls[0][0].input).toBe('Please keep future replies brief.');
  const row = await x.f.adaptive.withAccountDocument(ID.alice, d => d.experience.predictionTurns.find(t => t.turnId === turnId));
  expect(row?.evaluations).toBe(1); expect((await x.view()).candidates).toHaveLength(1);
});
