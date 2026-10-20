/**
 * Opt-in latency harness for the turn privacy boundary on the file (Mac) profile.
 *
 *   VOX_TURN_BENCH=1 VOX_TURN_BENCH_OUT=/path/result.json npx vitest run src/lib/studio/__tests__/turn-latency.bench.test.ts
 *
 * Content-free: it records only stage durations and call counts. The model is
 * a local stub with zero (text) or fixed (live) latency, so every number is
 * Vox-side work. It uses only APIs that exist before and after the
 * boundary-once change, so the same file measures both trees.
 */
import { mkdtempSync, writeFileSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { PersonaGateway } from '../../tireh/gateway';
import { createFileStores } from '../../tireh/memory/file-store';
import { privateText } from '../../tireh/__tests__/fixtures';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { SharedMemoryRepository } from '../../adaptive/shared/repository';
import { SharedMemoryService } from '../../adaptive/shared/service';
import { preferenceFixture } from '../../adaptive/personalization/__tests__/fixtures';
import { canUseAgent } from '../permissions';
import { groupId } from '../org-bridge';
import { callToken, handleVoiceLlm, voiceLlmKey } from '../voice-call';
import { hire, ID, makeStudio, SECRET, seedOrg } from './helpers';

const WARMUP = 3;
const RUNS = Number(process.env.VOX_TURN_BENCH_RUNS ?? 15);
const LIVE_DELTAS = 12;
const LIVE_DELTA_MS = 25;

type Sample = Record<string, number>;
const now = () => performance.now();

/** Outermost-call timers on the gateway's private boundary methods (present in both trees). */
function instrument() {
  const proto = PersonaGateway.prototype as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const counters = { boundaryCalls: 0, boundaryMs: 0, recheckCalls: 0, recheckMs: 0, privacyMs: 0, firstBoundaryMs: -1 };
  let depth = 0;
  const wrap = (name: 'boundary' | 'unchanged') => {
    const original = proto[name];
    proto[name] = async function (this: unknown, ...args: unknown[]) {
      const started = now(); depth++;
      try { return await original.apply(this, args); }
      finally {
        depth--; const spent = now() - started;
        if (name === 'boundary') {
          counters.boundaryCalls++; counters.boundaryMs += spent;
          if (counters.firstBoundaryMs < 0) counters.firstBoundaryMs = spent;
        } else { counters.recheckCalls++; counters.recheckMs += spent; }
        if (depth === 0) counters.privacyMs += spent;
      }
    };
    return () => { proto[name] = original; };
  };
  const restore = [wrap('boundary'), wrap('unchanged')];
  return {
    reset() { Object.assign(counters, { boundaryCalls: 0, boundaryMs: 0, recheckCalls: 0, recheckMs: 0, privacyMs: 0, firstBoundaryMs: -1 }); },
    read(): Sample { return { ...counters }; },
    restore() { for (const undo of restore) undo(); },
  };
}

async function fileProfile() {
  const h = makeStudio();
  const users = await seedOrg(h);
  const { agent } = await hire(h, users.alice);
  // File (Mac) profile: memory.json, file adaptive and shared storage, file Studio state.
  h.studio.deps.memory = createFileStores(join(h.dir, 'memory.json')) as unknown as typeof h.studio.deps.memory;
  const f = await preferenceFixture({ file: true, telegramId: ID.alice, agentId: agent.id });
  await f.grant(); await f.agent();
  await f.save({ key: 'response_length', value: 'brief' });
  for (let i = 0; i < 3; i++) {
    const state = await f.adaptive.read(ID.alice, 'work');
    await f.adaptive.createMemory(ID.alice, { space: 'work', text: `Synthetic saved note ${i}`, eventId: randomUUID(), expectedRevision: state.revision });
  }
  h.studio.deps.adaptive = f.adaptive;
  h.studio.deps.experience = f.experience;
  const store = h.store;
  h.studio.deps.shared = new SharedMemoryService(new SharedMemoryRepository(new FileAdaptiveStorage(mkdtempSync(join(tmpdir(), 'vox-bench-shared-')))), f.adaptive, {
    member: async telegramId => {
      const state = await store.read();
      const member = state.members.find(m => m.telegramId === telegramId);
      return { active: !!member && member.role !== 'pending', agentIds: member ? state.agents.filter(a => a.status === 'active' && canUseAgent(member, a)).map(a => a.id) : [] };
    },
    agent: async id => ({ active: (await store.read()).agents.some(a => a.id === id && a.status === 'active') }),
    group: async id => {
      const state = await store.read();
      const group = state.groups.find(g => groupId(g.chatId) === id);
      if (!group) return null;
      const memberTelegramIds = [...group.memberIds].sort((a, b) => a - b);
      return { memberTelegramIds, hasGuests: group.hasGuests, revision: createHash('sha256').update(JSON.stringify([id, memberTelegramIds])).digest('hex') };
    },
  });
  return { h, f, agent };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.floor((sorted.length - 1) / 2)] * 10) / 10 : 0;
}
function summarize(samples: Sample[]): Record<string, number> {
  return Object.fromEntries(Object.keys(samples[0] ?? {}).map(key => [key, median(samples.map(sample => sample[key]))]));
}

describe.runIf(process.env.VOX_TURN_BENCH === '1')('turn latency on the file profile (content-free)', () => {
  it('measures a private text turn and a live-call turn', async () => {
    const timers = instrument();
    try {
      const { h, agent } = await fileProfile();
      let providerAt = 0;
      const complete = h.chatLLM.complete.bind(h.chatLLM);
      h.chatLLM.complete = async request => { providerAt = now(); return complete(request); };
      h.studio.deps.fastLLM = {
        complete: async () => 'unused',
        stream: async function* (request) {
          if (request.authorize && !await request.authorize()) throw new Error('not authorized');
          providerAt = now();
          for (let i = 0; i < LIVE_DELTAS; i++) {
            await new Promise(resolve => setTimeout(resolve, LIVE_DELTA_MS));
            yield i === LIVE_DELTAS - 1 ? 'done.' : `part${i} `;
          }
        },
      };

      const text: Sample[] = [];
      for (let run = 0; run < WARMUP + RUNS; run++) {
        timers.reset(); providerAt = 0;
        const started = now();
        const { gateway } = await h.studio.gateway();
        const result = await gateway.handleUpdate(agent.id, privateText(ID.alice, `Synthetic request ${run}`));
        const total = now() - started;
        expect(result).toBe('replied');
        if (run >= WARMUP) text.push({ ...timers.read(), preProviderMs: providerAt - started, totalMs: total });
      }

      const live: Sample[] = [];
      for (let run = 0; run < WARMUP + RUNS; run++) {
        timers.reset(); providerAt = 0;
        const started = now();
        const response = await handleVoiceLlm(h.studio, new Request('https://vox.example/api/studio/voice-llm/v1/chat/completions', {
          method: 'POST', headers: { authorization: `Bearer ${voiceLlmKey(SECRET)}`, 'content-type': 'application/json' },
          body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: `Synthetic live request ${run}` }],
            elevenlabs_extra_body: { call: callToken(SECRET, agent.id, ID.alice, new Date()) } }),
        }));
        const headersMs = now() - started;
        expect(response.status).toBe(200);
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let firstContentMs = -1, raw = '';
        for (let next = await reader.read(); !next.done; next = await reader.read()) {
          raw += decoder.decode(next.value, { stream: true });
          if (firstContentMs < 0 && raw.includes('"content"')) firstContentMs = now() - started;
        }
        const total = now() - started;
        expect(raw).toContain('done.');
        if (run >= WARMUP) live.push({ ...timers.read(), headersMs, preProviderMs: providerAt - started, firstContentMs, totalMs: total });
      }

      const result = { profile: 'file', runs: RUNS, liveDeltas: LIVE_DELTAS, liveDeltaMs: LIVE_DELTA_MS,
        privateText: summarize(text), liveCall: summarize(live) };
      if (process.env.VOX_TURN_BENCH_OUT) writeFileSync(process.env.VOX_TURN_BENCH_OUT, JSON.stringify(result, null, 2));
      console.info(JSON.stringify(result, null, 2));
    } finally { timers.restore(); }
  }, 300_000);
});
