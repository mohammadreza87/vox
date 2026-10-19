import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rm } from 'fs/promises';
import { spawnSync } from 'child_process';
import { startBots } from '../bots';
import { handleStudioRequest } from '../http';
import { signInitData } from '../auth';
import { StudioVoiceService } from '../media';
import { callToken, handleVoiceLlm, voiceLlmKey } from '../voice-call';
import { AnthropicLLM } from '../../tireh/llm';
import { fakeVoice, makeGateway, privateText, TG } from '../../tireh/__tests__/fixtures';
import { ID, makeStudio, SECRET, seedOrg } from './helpers';

const sdk = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: sdk.create }; } }));
const SECRET_CANARY = 'INDEPENDENT_DIAGNOSTIC_FAKE_TOKEN_021';
const TEXT_CANARY = 'INDEPENDENT_DIAGNOSTIC_PRIVATE_TRANSCRIPT_021';
const directories: string[] = [];
const stops: (() => void)[] = [];
beforeEach(() => { sdk.create.mockReset(); });
afterEach(async () => {
  stops.splice(0).forEach(stop => stop());
  vi.useRealTimers(); vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
function canaryError() {
  return Object.assign(new Error(`${SECRET_CANARY} ${TEXT_CANARY}`, { cause: { token: SECRET_CANARY } }),
    { code: 'independent_private_secret', providerBody: TEXT_CANARY });
}
function hostileError() {
  const accessed = vi.fn(() => { throw canaryError(); });
  const error = new Error('synthetic hostile error');
  for (const key of ['message', 'stack', 'name', 'cause', 'code', 'status', 'toJSON']) {
    Object.defineProperty(error, key, { configurable: true, get: accessed });
  }
  return { error, accessed };
}
function assertEvents(calls: unknown[][], expected: { stage: string; reason: string; outcome: string }[]) {
  expect(calls).toEqual(expected.map(event => [{ type: 'telegram_ingress', ...event }]));
  for (const args of calls) {
    expect(args).toHaveLength(1);
    expect(Object.keys(args[0] as object).sort()).toEqual(['outcome', 'reason', 'stage', 'type']);
    expect(JSON.stringify(args)).not.toContain(SECRET_CANARY);
    expect(JSON.stringify(args)).not.toContain(TEXT_CANARY);
  }
}
async function studio() {
  const h = makeStudio(); directories.push(h.dir); await seedOrg(h); return h;
}
function liveRequest(stream = true) {
  return new Request('https://synthetic.invalid/api/studio/voice-llm', { method: 'POST',
    headers: { authorization: `Bearer ${voiceLlmKey(SECRET)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ stream, messages: [{ role: 'user', content: TEXT_CANARY }],
      elevenlabs_extra_body: { call: callToken(SECRET, 'PRIVATE_AGENT_IDENTIFIER_021', ID.alice, new Date()) } }),
  });
}

describe('independent diagnostic invocation security', () => {

  it('serializes the fixed catalog through the actual production Pino configuration', () => {
    // A fresh local process avoids replacing the application logger with a spy.
    // Compile only these saved TS modules in memory; no providers or dotenv load.
    const script = `
      const fs = require('fs'), path = require('path'), ts = require('typescript'), Module = require('module');
      function saved(relative) {
        const filename = path.resolve(relative), loaded = new Module(filename, module);
        loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
        const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
          module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true
        } }).outputText;
        loaded._compile(source, filename); return loaded.exports;
      }
      const { logger } = saved('src/lib/logger/index.ts');
      const { logTelegramDiagnostic } = saved('src/lib/tireh/telegram/diagnostics.ts');
      logTelegramDiagnostic(logger, 'poll_failed');
    `;
    const run = spawnSync(process.execPath, ['-e', script], { cwd: process.cwd(), encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'warn' }, timeout: 10_000 });
    expect(run.status).toBe(0); expect(run.stderr).toBe('');
    const lines = run.stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ level: 'warn', time: expect.any(String), pid: expect.any(Number), host: expect.any(String),
      env: 'production', service: 'vox', type: 'telegram_ingress', stage: 'poll', reason: 'operation_failed', outcome: 'retry_scheduled' });
    expect(lines[0]).not.toHaveProperty('err'); expect(lines[0]).not.toHaveProperty('msg');
    expect(lines[0]).not.toHaveProperty('details');
  });

  it('does not inspect hostile poll exceptions, preserves the 3s retry and stops further retries', async () => {
    const h = await studio(); const hostile = hostileError(); vi.useFakeTimers();
    h.manager.getUpdates.mockRejectedValueOnce(hostile.error);
    stops.push(startBots(h.studio).stop);
    await vi.advanceTimersByTimeAsync(0);
    expect(hostile.accessed).not.toHaveBeenCalled();
    assertEvents(h.logger.warn.mock.calls, [{ stage: 'poll', reason: 'operation_failed', outcome: 'retry_scheduled' }]);
    await vi.advanceTimersByTimeAsync(2999);
    expect(h.manager.getUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.manager.getUpdates).toHaveBeenCalledTimes(2);
    stops[0](); await vi.advanceTimersByTimeAsync(9000);
    expect(h.manager.getUpdates).toHaveBeenCalledTimes(2);
  });

  it('does not inspect failed manager-update exceptions and continues the actual batch', async () => {
    const h = await studio(); const hostile = hostileError(); vi.useFakeTimers();
    const message = { message_id: 1, from: { id: ID.alice, is_bot: false, first_name: TEXT_CANARY },
      chat: { id: ID.alice, type: 'private' as const }, date: 0, text: TEXT_CANARY };
    h.manager.getUpdates.mockResolvedValueOnce([{ update_id: 888001, message }, { update_id: 888002, message }]);
    h.manager.sendMessage.mockRejectedValueOnce(hostile.error);
    stops.push(startBots(h.studio).stop); await vi.advanceTimersByTimeAsync(0);
    expect(hostile.accessed).not.toHaveBeenCalled();
    expect(h.manager.sendMessage).toHaveBeenCalledTimes(2);
    expect(h.manager.getUpdates).toHaveBeenLastCalledWith(888003, 25, ['message', 'managed_bot']);
    assertEvents(h.logger.error.mock.calls, [{ stage: 'update', reason: 'operation_failed', outcome: 'continue_polling' }]);
  });

  it.each(['unknown_code', 'throwing_code', 'throwing_proxy'] as const)('keeps %s synthesis failures out of logs and sends fallback text once', async kind => {
    const voice = fakeVoice(); const h = makeGateway({ voice });
    const readContent = vi.fn(() => { throw canaryError(); });
    const error = Object.defineProperties({}, { message: { get: readContent }, stack: { get: readContent }, cause: { get: readContent },
      code: kind === 'throwing_code' ? { get: () => { throw canaryError(); } } : { value: 'independent_private_secret' } });
    voice.synthesize.mockRejectedValueOnce(kind === 'throwing_proxy' ? new Proxy(error, { has: () => { throw canaryError(); } }) : error);
    const update = privateText(TG.reza, `Please send a voice message. ${TEXT_CANARY}`);
    expect(await h.gateway.handleUpdate('aria', update)).toBe('replied');
    expect(await h.gateway.handleUpdate('aria', update)).toBe('duplicate');
    expect(h.bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.bot.sendVoice).not.toHaveBeenCalled();
    expect(readContent).not.toHaveBeenCalled();
    assertEvents(h.logger.error.mock.calls, [{ stage: 'voice_delivery', reason: 'delivery_failed', outcome: 'text_fallback' }]);
  });

  it.each(['canary', 'hostile'] as const)('keeps %s STT adapter errors out of logs while using the configured fallback', async kind => {
    const h = await studio(); const hostile = hostileError();
    h.openai.transcribe.mockRejectedValueOnce(kind === 'canary' ? canaryError() : hostile.error);
    h.eleven.transcribe.mockResolvedValueOnce('Recovered synthetic transcript');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const audio = new ArrayBuffer(8);
    expect(await new StudioVoiceService(h.openai, h.eleven).transcribe(audio, 'audio/ogg')).toBe('Recovered synthetic transcript');
    expect(h.eleven.transcribe).toHaveBeenCalledWith(audio, 'audio/ogg');
    expect(hostile.accessed).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const event = warn.mock.calls[0][0] as Record<string, string>;
    expect(event.type).toBe('telegram_ingress');
    expect(event.reason).toBe('primary_provider_failed');
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET_CANARY);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TEXT_CANARY);
  });

  it('keeps a real SDK web-search fallback content-free and remembers the unavailable tool', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    sdk.create.mockRejectedValueOnce(Object.assign(new Error(`web_search ${SECRET_CANARY} ${TEXT_CANARY}`), { status: 400 }))
      .mockResolvedValue({ content: [{ type: 'text', text: 'Synthetic fallback reply' }] });
    const llm = new AnthropicLLM(SECRET_CANARY, 'PRIVATE_MODEL_IDENTIFIER_021');
    const request = { system: TEXT_CANARY, messages: [{ role: 'user' as const, content: TEXT_CANARY }], maxSearches: 1 };
    expect(await llm.completeWithWeb(request)).toEqual({ text: 'Synthetic fallback reply', sources: [] });
    await llm.completeWithWeb(request);
    expect(sdk.create).toHaveBeenCalledTimes(3);
    expect(sdk.create.mock.calls[2][0]).not.toHaveProperty('tools');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(warn.mock.calls[0][0]).toMatchObject({ type: 'telegram_ingress', reason: 'tool_unavailable' });
    for (const canary of [SECRET_CANARY, TEXT_CANARY, 'PRIVATE_MODEL_IDENTIFIER_021']) expect(JSON.stringify(warn.mock.calls)).not.toContain(canary);
  });

  it.each(['status', 'message'] as const)('preserves the original SDK error when its %s accessor throws', async field => {
    const error = Object.assign(canaryError(), { status: 400 });
    Object.defineProperty(error, field, { get: () => { throw new Error('SECONDARY_GETTER_ERROR'); } });
    sdk.create.mockRejectedValueOnce(error);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(new AnthropicLLM(SECRET_CANARY, 'synthetic-model').completeWithWeb({ system: TEXT_CANARY,
      messages: [{ role: 'user', content: TEXT_CANARY }], maxSearches: 1 })).rejects.toBe(error);
    expect(warn).not.toHaveBeenCalled(); expect(sdk.create).toHaveBeenCalledTimes(1);
  });

  it('keeps initial live-turn exceptions out of logs and preserves the 503 response', async () => {
    const h = await studio(); const hostile = hostileError();
    vi.spyOn(h.studio, 'liveTurn').mockRejectedValueOnce(hostile.error);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await handleVoiceLlm(h.studio, liveRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { message: 'The agent is unavailable.' } });
    expect(hostile.accessed).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(warn.mock.calls[0][0]).toMatchObject({ type: 'telegram_ingress', reason: 'operation_failed', outcome: 'http_503' });
  });

  it('keeps a midstream live-turn exception private and finishes the existing SSE fallback', async () => {
    const h = await studio(); const hostile = hostileError();
    vi.spyOn(h.studio, 'liveTurn').mockResolvedValueOnce((async function* () { yield 'Synthetic partial reply'; throw hostile.error; })());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await handleVoiceLlm(h.studio, liveRequest());
    expect(response.status).toBe(200);
    const output = await response.text();
    expect(output).toContain('Synthetic partial reply'); expect(output).toContain('lost my train of thought');
    expect(output).toContain('data: [DONE]');
    expect(hostile.accessed).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(warn.mock.calls[0][0]).toMatchObject({ type: 'telegram_ingress', reason: 'operation_failed' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TEXT_CANARY);
  });


  it.each(['canary', 'hostile'] as const)('keeps %s Mini App request failures content-free without escaping the HTTP boundary', async kind => {
    const h = await studio(); const hostile = hostileError();
    vi.spyOn(h.studio, 'listAgents').mockRejectedValueOnce(kind === 'canary' ? canaryError() : hostile.error);
    const token = '12345:synthetic-diagnostic-auth';
    const request = new Request('https://synthetic.invalid/api/studio/agents', { headers: {
      'x-telegram-init-data': signInitData({ id: ID.alice, first_name: TEXT_CANARY }, token),
    } });
    const response = await handleStudioRequest(h.studio, request, ['agents'], { botToken: token, devUser: null });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Something went wrong. Try again.' });
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    const args = h.logger.error.mock.calls[0];
    expect(args).toHaveLength(1);
    expect(args[0]).toMatchObject({ type: 'telegram_ingress', reason: 'operation_failed' });
    expect(JSON.stringify(args)).not.toContain(SECRET_CANARY);
    expect(JSON.stringify(args)).not.toContain(TEXT_CANARY);
  });

  it('preserves the live iterator cancellation hook without emitting a failure', async () => {
    const h = await studio();
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    const next = vi.fn().mockResolvedValueOnce({ done: false, value: 'Synthetic start' }).mockImplementation(() => new Promise(() => undefined));
    vi.spyOn(h.studio, 'liveTurn').mockResolvedValueOnce({ [Symbol.asyncIterator]: () => ({ next, return: returned }) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await handleVoiceLlm(h.studio, liveRequest());
    const reader = response.body!.getReader(); await reader.read(); await reader.cancel();
    expect(returned).toHaveBeenCalledTimes(1); expect(warn).not.toHaveBeenCalled();
  });
});
