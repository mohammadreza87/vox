/** QA-owned ARC1 canonical invariants and exact prior-runtime oracle.
 * All identities, content, keys and stores are synthetic. No effect dispatch. */
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import * as crypto from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModuleKind, transpileModule } from 'typescript';
import * as zod from 'zod';
import * as archives from '../telegram-archive-state';
import * as rightsContracts from '../rights-use-holds/contracts';
import * as rightsState from '../rights-use-holds/state';
import * as pauseContracts from '../product-pause/contracts';
import * as pauseState from '../product-pause/state';
import * as readScope from '../../tireh/privacy/read-scope';
import * as storageModule from '../persistence/storage';
import * as runtime from '../runtime/contracts';
import * as relationships from '../relationships/contracts';
import * as observation from '../observation/contracts';
import { AdaptiveRepository, accountIdFor, containerIdFor, type AdaptiveDocument } from '../persistence/repository';
import { FileAdaptiveStorage } from '../persistence/storage';
import { prepareAssistantText, type DeliveryState } from '../../tireh/delivery/assistant-text-protocol';
import * as deliveryProtocol from '../../tireh/delivery/assistant-text-protocol';
import { assistantCapacityProjection, assistantControlReservedFutureBytes, assistantFutureStateBytes, assertAssistantDeliveryTransition,
  emptyAssistantDeliveryControl, exportAssistantDeliveryControl, invalidateAssistantDeliveryScope,
  invalidateAssistantDeliverySource, parseAssistantDeliveryControl, pruneAssistantDeliveryControl,
  ASSISTANT_CONTROL_IDLE_MS, ASSISTANT_CONTROL_RESERVED_BYTES, ASSISTANT_CONTROL_STATE_BYTES,
  ASSISTANT_CONTROL_TTL_MS, AssistantControlError, type AssistantDeliveryControl } from '../assistant-delivery-control';
import { stripTelegramArchiveForRollback } from '../telegram-archive-rollback';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const OWNER = 70300, ACCOUNT = accountIdFor(OWNER), KEY = new Uint8Array(32).fill(173);
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
async function canonical() {
  const directory = mkdtempSync(join(tmpdir(), 'vox-arc1-core-qa-')); dirs.push(directory);
  const storage = new FileAdaptiveStorage(directory), repository = new AdaptiveRepository(storage);
  await repository.transaction(ACCOUNT, NOW, () => undefined);
  const loaded = repository.readCommittedForEffect(ACCOUNT, NOW);
  if (loaded.status !== 'ready' || !loaded.document) throw Error('QA canonical account unavailable');
  return { directory, storage, repository, document: loaded.document,
    path: join(directory, `${createHash('sha256').update(ACCOUNT).digest('hex')}.json`) };
}
function state(d: AdaptiveDocument, messageId = 1, space: 'work' | 'personal' = 'work', now = NOW): DeliveryState {
  return prepareAssistantText({ scope: { accountId: ACCOUNT, personId: d.personId, agentId: `qa-${space}`, space,
    containerId: containerIdFor(ACCOUNT, space), kind: 'private' }, binding: { botId: space === 'work' ? 7001 : 7002,
    destinationChatId: OWNER, endpointBindingId: 'qa-endpoint', credentialBindingId: 'qa-credential', bindingRevision: 'qa-binding-v1' },
    source: { messageId, updateId: messageId, revision: 0, occurredAt: now - 1000, acceptedAt: now },
    authority: { authorityRevision: 'qa-authority', grantRevision: 'qa-grant', sourceFenceRevision: 'qa-fence',
      sourceFenceSequence: 0, historyEpoch: 0, deletionEpoch: 0, expiresAt: now + 60000 },
    generationId: '33333333-3333-4333-8333-333333333333', attemptId: '44444444-4444-4444-8444-444444444444',
    generatedText: 'QA_TRANSIENT_GENERATED', decoratedText: 'QA_TRANSIENT_SUBMITTED', keyId: 'qa-key', evidenceKey: KEY,
    now, expiresAt: now + 60000 }).initialState;
}
function controlled(d: AdaptiveDocument, count = 1): AdaptiveDocument {
  const result = copy(d), c = emptyAssistantDeliveryControl(NOW - 2000); c.observedAt = NOW;
  for (let i = 0; i < count; i++) {
    const s = state(d, i + 1); c.effects.push({ state: s, retainUntil: NOW + ASSISTANT_CONTROL_TTL_MS });
  }
  if (count) c.streams.push({ botId: 7001, destinationChatId: OWNER, agentId: 'qa-work', space: 'work',
    containerId: containerIdFor(ACCOUNT, 'work'), messageFloor: 0, highMessageId: count, lastAcceptedAt: NOW });
  result.assistantDeliveryControl = c; return result;
}
function changed(before: AdaptiveDocument, mutate: (c: AssistantDeliveryControl) => void) {
  const after = copy(before); after.revision++; after.assistantDeliveryControl!.revision++; mutate(after.assistantDeliveryControl!); return after;
}

// Unmodified actual base803 repository bytes, including its strict canonical
// schema and reader methods; dependencies are explicitly projected below.
const PREVIOUS_REPOSITORY_SHA = 'fbd83c3b1c454a2549d2a571b1bf6cd5a05ecf7ffe6ecc7d46b7c04d37b48101';
function previousRepository(): typeof AdaptiveRepository {
  const bytes = readFileSync('scripts/fixtures/assistant-delivery-control-prior-reader/repository.ts.fixture');
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(PREVIOUS_REPOSITORY_SHA);
  const modules: Record<string, unknown> = { crypto, zod, '../telegram-archive-state': archives,
    '../rights-use-holds/contracts': rightsContracts, '../rights-use-holds/state': rightsState,
    '../product-pause/contracts': pauseContracts, '../product-pause/state': pauseState,
    '../../tireh/privacy/read-scope': readScope, './storage': storageModule,
    '../runtime/contracts': runtime, '../relationships/contracts': relationships, '../observation/contracts': observation };
  const exports: Record<string, unknown> = {};
  const js = transpileModule(bytes.toString('utf8'), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  new Function('require', 'exports', js)((id: string) => { if (!(id in modules)) throw Error(`Unexpected frozen import ${id}`); return modules[id]; }, exports);
  return exports.AdaptiveRepository as typeof AdaptiveRepository;
}

describe('ARC1 independent canonical, retention and exact prior reader boundaries', () => {
  it('actual frozen baseline803 runtime reads the original FILE account and rejects the new field without rewriting it', async () => {
    const f = await canonical(), OldRepository = previousRepository(), old = new OldRepository(f.storage);
    expect(old.readCommittedForEffect(ACCOUNT, NOW).status).toBe('ready');
    const doc = controlled(f.document, 0); mkdirSync(f.directory, { recursive: true });
    writeFileSync(join(f.directory, 'assistant-delivery-control-v1.json'), '{"version":1,"kind":"assistant-delivery-control"}\n', { mode: 0o600 });
    writeFileSync(f.path, JSON.stringify(doc), { mode: 0o600 }); const before = readFileSync(f.path);
    expect(() => old.readCommittedForEffect(ACCOUNT, NOW)).toThrow(); expect(readFileSync(f.path)).toEqual(before);
  });

  it('admits exact metadata only and rejects unknown fields, nonfinite counters, bad scopes and trailing newlines', async () => {
    const { document } = await canonical(), doc = controlled(document), c = doc.assistantDeliveryControl!;
    expect(parseAssistantDeliveryControl(c, ACCOUNT, document.personId, NOW)).toEqual(c);
    const bad: AssistantDeliveryControl[] = [];
    const alter = (fn: (draft: AssistantDeliveryControl) => void) => { const next = copy(c); fn(next); bad.push(next); };
    alter(n => { (n as unknown as Record<string, unknown>).payload = 'QA_PRIVATE_TEXT'; });
    alter(n => { n.effects = []; n.streams[0].agentId += '\n'; }); alter(n => { n.streams[0].containerId += '\n'; });
    alter(n => { n.sourceFenceSequence = -0; }); alter(n => { n.historyEpoch = Number.MAX_SAFE_INTEGER + 1; });
    alter(n => { n.noReplayBefore = NOW + 1; }); alter(n => { n.streams[0].destinationChatId++; });
    alter(n => { n.streams.push(copy(n.streams[0])); }); alter(n => { n.effects.push(copy(n.effects[0])); });
    alter(n => { n.effects[0].retainUntil++; }); alter(n => { n.effects[0].state.source.revision = 1; });
    alter(n => { n.effects[0].state.scope.personId = 'another-person'; });
    for (const value of bad) expect(() => parseAssistantDeliveryControl(value, ACCOUNT, document.personId, NOW)).toThrow();
    expect(JSON.stringify(c)).not.toContain('QA_TRANSIENT_GENERATED'); expect(JSON.stringify(c)).not.toContain('QA_TRANSIENT_SUBMITTED');
  });

  it('TTL boundary fences expired high IDs before removing them and invalidates a surviving delayed lower claim', async () => {
    const { document } = await canonical(), doc = controlled(document), c = doc.assistantDeliveryControl!;
    c.effects = [{ state: state(document, 50), retainUntil: NOW + ASSISTANT_CONTROL_TTL_MS },
      { state: state(document, 10, 'work', NOW + 1000), retainUntil: NOW + 1000 + ASSISTANT_CONTROL_TTL_MS }];
    c.streams[0].highMessageId = 50; c.streams[0].lastAcceptedAt = NOW + 1000; c.observedAt = NOW + 1000;
    const before = copy(doc); expect(pruneAssistantDeliveryControl(doc, NOW + ASSISTANT_CONTROL_TTL_MS - 1)).toBe(false);
    expect(doc).toEqual(before); expect(pruneAssistantDeliveryControl(doc, NOW + ASSISTANT_CONTROL_TTL_MS)).toBe(true);
    expect(c.effects).toHaveLength(1); expect(c.effects[0].state.source.messageId).toBe(10); expect(c.effects[0].state.contentEligible).toBe(false);
    expect(c.streams[0].messageFloor).toBe(50); expect(c.sourceFenceSequence).toBeGreaterThan(before.assistantDeliveryControl!.sourceFenceSequence);
    expect(parseAssistantDeliveryControl(c, ACCOUNT, document.personId, NOW + ASSISTANT_CONTROL_TTL_MS)).toEqual(c);
  });

  it('unknown-stream edit creates an account-wide floor without allocating a stream or archive', async () => {
    const { document } = await canonical(), doc = controlled(document), c = doc.assistantDeliveryControl!;
    invalidateAssistantDeliverySource(doc, NOW + 1000, 7999, OWNER, 300);
    expect(doc.telegramArchives).toBeUndefined(); expect(c.streams).toHaveLength(1); expect(c.noReplayBefore).toBe(NOW + 1000);
    expect(c.effects[0].state.contentEligible).toBe(false); expect(c.effects[0].state.phase).toBe('cancelled');
    const seq = c.sourceFenceSequence; invalidateAssistantDeliverySource(doc, NOW + 1000, 7001, OWNER, 1);
    const snapshot = copy(c); invalidateAssistantDeliverySource(doc, NOW + 1000, 7001, OWNER, 1);
    expect(c).toEqual(snapshot); expect(c.sourceFenceSequence).toBeGreaterThanOrEqual(seq); expect(c.streams[0].messageFloor).toBe(1);
  });

  it('scope erasure drops HMAC/receipt details and preserves irreversible stream floors and account epochs', async () => {
    const { document } = await canonical(), doc = controlled(document), before = copy(doc.assistantDeliveryControl!);
    expect(invalidateAssistantDeliveryScope(doc, NOW, 'work', 'qa-work', true)).toBe(true);
    const c = doc.assistantDeliveryControl!; expect(c.effects).toEqual([]); expect(c.streams[0].messageFloor).toBe(1);
    expect(c.historyEpoch).toBeGreaterThan(before.historyEpoch); expect(c.deletionEpoch).toBeGreaterThan(before.deletionEpoch);
    expect(c.sourceFenceSequence).toBeGreaterThan(before.sourceFenceSequence); expect(JSON.stringify(c)).not.toContain(before.effects[0].state.evidence.bodyHmac);
  });

  it('90-day idle retirement advances the trusted account barrier and keeps controls after all identifying streams expire', async () => {
    const { document } = await canonical(), doc = controlled(document), now = NOW + ASSISTANT_CONTROL_IDLE_MS;
    expect(pruneAssistantDeliveryControl(doc, now)).toBe(true); const c = doc.assistantDeliveryControl!;
    expect(c.effects).toEqual([]); expect(c.streams).toEqual([]); expect(c.noReplayBefore).toBe(now);
    expect(c.version).toBe(1); expect(c.policyVersion).toBe('arc1-control-7d-v1');
  });

  it('canonical transition refuses silent control deletion, rollback, route movement, identity replacement and invented sent truth', async () => {
    const { document } = await canonical(), before = controlled(document);
    const absent = copy(before); delete absent.assistantDeliveryControl; expect(() => assertAssistantDeliveryTransition(before, absent)).toThrow();
    for (const mutate of [
      (c: AssistantDeliveryControl) => { c.noReplayBefore--; },
      (c: AssistantDeliveryControl) => { c.streams[0].messageFloor = -1; },
      (c: AssistantDeliveryControl) => { c.streams[0].agentId = 'another-agent'; },
      (c: AssistantDeliveryControl) => { c.effects[0].state.attemptId = '55555555-5555-4555-8555-555555555555'; },
      (c: AssistantDeliveryControl) => { const s = c.effects[0].state; s.revision++; s.phase = 'sent'; s.outcome = { reason: 'provider_accepted', observedAt: NOW,
        receipt: { messageId: 9898, botId: 7001, destinationChatId: OWNER, providerDateSeconds: NOW / 1000, textEvidence: 'matches-submitted' } }; },
    ]) expect(() => assertAssistantDeliveryTransition(before, changed(before, mutate))).toThrow();
  });

  it('transition guard no-ops only without ARC presence and explicitly refuses real controls replaced by non-account images', async () => {
    const generic = { v: 1, drafts: [] };
    for (const before of [undefined, null, generic, false, [], 'synthetic-generic-json']) {
      for (const after of [undefined, null, generic, false, 0, [], 'synthetic-generic-json']) {
        expect(() => assertAssistantDeliveryTransition(before as unknown as AdaptiveDocument, after as unknown as AdaptiveDocument)).not.toThrow();
      }
    }
    const { document } = await canonical(), controlledAccount = controlled(document);
    for (const after of [null, undefined, false, 0, '', [], generic]) {
      expect(() => assertAssistantDeliveryTransition(controlledAccount, after as unknown as AdaptiveDocument)).toThrow(AssistantControlError);
    }
    for (const corrupt of [undefined, null, false, 0, '', [], {}]) {
      const broken = { ...document, assistantDeliveryControl: corrupt } as unknown as AdaptiveDocument;
      expect(() => assertAssistantDeliveryTransition(broken, generic as unknown as AdaptiveDocument)).toThrow(AssistantControlError);
    }
  });

  it('worst-future state and exact aggregate reservation include receipt/invalidation/counter growth', async () => {
    const { document } = await canonical(), doc = controlled(document, 32), c = doc.assistantDeliveryControl!;
    for (const row of c.effects) {
      const maximum = Number.MAX_SAFE_INTEGER;
      const independentlySizedTerminal = { ...row.state, revision: maximum, lastTransitionAt: maximum,
        phase: 'sent', contentEligible: false, invalidatedAtFenceSequence: maximum,
        outcome: { reason: 'provider_accepted', observedAt: maximum, receipt: { messageId: maximum, botId: maximum,
          destinationChatId: maximum, providerDateSeconds: Math.floor(maximum / 1000), textEvidence: 'matches-submitted' } } };
      expect(assistantFutureStateBytes(row.state)).toBe(size(independentlySizedTerminal));
      expect(assistantFutureStateBytes(row.state)).toBeGreaterThan(size(row.state));
      expect(assistantFutureStateBytes(row.state)).toBeLessThanOrEqual(ASSISTANT_CONTROL_STATE_BYTES);
    }
    const projected = assistantCapacityProjection(doc), { assistantDeliveryControl: omitted, ...rest } = projected;
    expect(typeof omitted).toBe('string'); expect(projected.revision).toBe(Number.MAX_SAFE_INTEGER); expect(projected.updatedAt).toBe(Number.MAX_SAFE_INTEGER);
    expect(size(projected) - size(rest)).toBe(ASSISTANT_CONTROL_RESERVED_BYTES - 1);
    expect(size({ assistantDeliveryControl: omitted })).toBe(ASSISTANT_CONTROL_RESERVED_BYTES);
    expect(parseAssistantDeliveryControl(c, ACCOUNT, document.personId, NOW).effects).toHaveLength(32);
    const over = copy(c); const extra = copy(c.effects[0]); extra.state.source.messageId = 999;
    over.effects.push(extra); expect(() => parseAssistantDeliveryControl(over, ACCOUNT, document.personId, NOW)).toThrow();
  });

  it('selected-space export returns detached metadata and labels shared account barriers without leaking another space', async () => {
    const { document } = await canonical(), doc = controlled(document), c = doc.assistantDeliveryControl!, personal = state(document, 3, 'personal');
    c.streams.push({ botId: 7002, destinationChatId: OWNER, agentId: 'qa-personal', space: 'personal', containerId: containerIdFor(ACCOUNT, 'personal'), messageFloor: 0, highMessageId: 3, lastAcceptedAt: NOW });
    c.effects.push({ state: personal, retainUntil: NOW + ASSISTANT_CONTROL_TTL_MS });
    const exported = exportAssistantDeliveryControl(doc, 'work')!;
    expect(exported.barriers).toBe('account-wide'); expect(exported.streams.every(s => s.space === 'work')).toBe(true);
    expect(exported.effects.every(r => r.state.scope.space === 'work')).toBe(true); expect(JSON.stringify(exported)).not.toContain('qa-personal');
    exported.streams[0].messageFloor = 999; expect(c.streams[0].messageFloor).toBe(0);
  });

  it('archive rollback preserves ARC1 controls and never strips their safety proof as collateral', async () => {
    const { document } = await canonical(), doc = controlled(document), before = copy(doc);
    const result = stripTelegramArchiveForRollback({ ...doc, telegramArchives: [] }, ACCOUNT);
    expect(result.document.assistantDeliveryControl).toEqual(before.assistantDeliveryControl); expect(doc).toEqual(before);
  });
});


/** Frozen installed c42 schema, including its actual v1 control parser. */
function installedC42Repository() {
  const directory='scripts/fixtures/assistant-text-integration-prior-reader/';
  const load=(name:string,sha:string,modules:Record<string,unknown>)=>{
    const bytes=readFileSync(directory+name);expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha);
    const exports:Record<string,unknown>={};
    const js=transpileModule(bytes.toString('utf8'),{compilerOptions:{module:ModuleKind.CommonJS}}).outputText;
    new Function('require','exports',js)((id:string)=>{if(!(id in modules))throw Error(`Unexpected frozen c42 import ${id}`);return modules[id];},exports);
    return exports;
  };
  const oldControl=load('assistant-delivery-control.ts.fixture','0fc3ef4f331d3d3a28057968d1c93e9f61036f7850915c00bc4d418e78ebc503',{
    crypto,zod,'../tireh/delivery/assistant-text-protocol':deliveryProtocol});
  return load('repository.ts.fixture','a696a167d2528c88fff33d6bc782a09c99d4b094f2d9e04a13a4a850e9b07eb6',{
    crypto,zod,'../assistant-delivery-control':oldControl,'../telegram-archive-state':archives,
    '../rights-use-holds/contracts':rightsContracts,'../rights-use-holds/state':rightsState,
    '../product-pause/contracts':pauseContracts,'../product-pause/state':pauseState,
    '../../tireh/privacy/read-scope':readScope,'./storage':storageModule,
    '../runtime/contracts':runtime,'../relationships/contracts':relationships,'../observation/contracts':observation,
  }) as unknown as {validateAdaptiveDocument:typeof import('../persistence/repository').validateAdaptiveDocument};
}

describe('ATI1 protected installed c42 schema refusal',()=>{
  it('actual frozen c42 accepts original v1 but refuses strict v2 without rewriting any source bytes',async()=>{
    const f=await canonical(),old=installedC42Repository(),original=controlled(f.document,0);
    expect(old.validateAdaptiveDocument(original,ACCOUNT,NOW).assistantDeliveryControl?.version).toBe(1);
    const v2={...original,assistantDeliveryControl:{...original.assistantDeliveryControl,version:2,policyVersion:'arc2-control-7d-v1',enrollments:[]}};
    const before=JSON.stringify(v2);expect(()=>old.validateAdaptiveDocument(v2,ACCOUNT,NOW)).toThrow();expect(JSON.stringify(v2)).toBe(before);
  });
});


describe('ATI1 protected unchanged capacity reservation',()=>{
  it('complete future32effect/fourstream/fourenrollment witness remains below the existing160KiB reservation',()=>{
    const v1=assistantControlReservedFutureBytes(1),v2=assistantControlReservedFutureBytes(2);
    expect(v2).toBeGreaterThan(v1);expect(v1).toBeGreaterThanOrEqual(32*4096);expect(v2).toBeLessThanOrEqual(163840);
    expect(ASSISTANT_CONTROL_RESERVED_BYTES).toBe(163840);expect(ASSISTANT_CONTROL_STATE_BYTES).toBe(4096);expect(ASSISTANT_CONTROL_TTL_MS).toBe(7*86400000);
  });
});
