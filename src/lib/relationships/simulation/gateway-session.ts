import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FileObservationStore, FileRelationshipStore, RelationshipLoop, SafeRelationshipObserver } from '..';
import { AnthropicLLM, type LLM, type LLMRequest } from '../../tireh/llm';
import { PersonaGateway } from '../../tireh/gateway';
import { parseOrgConfig } from '../../tireh/org/config';
import { OrgDirectory } from '../../tireh/org/directory';
import { createFileStores } from '../../tireh/memory/file-store';
import { ownerRevokePatch, ownerSharePatch } from '../../tireh/memory/sharing';
import type { TelegramBotClient, TelegramMessage } from '../../tireh/telegram/client';
import { OpenAIDecisions } from '../decisions';
import { StudioRelationshipAssessor } from '../../studio/relationship-assessor';
import type { RelationshipScenario, SyntheticPersona } from './scenario';

export type SessionEnv = { anthropicApiKey?: string; openaiApiKey?: string; chatModel?: string; voiceModel?: string; decision?: 'send' | 'defer' | 'close' | 'stay_quiet'; userAgentModel?: 'gpt-6.1-sol' | 'gpt-6-luna'; maxTurns?: number };
export type AudienceInput = { kind: 'private'; personId: string } | { kind: 'group'; groupId: string };
export type GatewayCommand =
  | { op: 'turn'; id?: string; personId: string; audience: AudienceInput; text: string }
  | { op: 'advance'; id?: string; at: string }
  | { op: 'reconsider'; id?: string }
  | { op: 'seed_memory'; id?: string; ownerId: string; content: string; topic: string; sensitivity?: 'normal' | 'personal' | 'confidential' }
  | { op: 'share'; id?: string; memoryId: string; ownerId: string; recipientIds: string[] }
  | { op: 'revoke'; id?: string; memoryId: string; ownerId: string }
  | { op: 'group_join' | 'group_leave'; id?: string; groupId: string; personId: string }
  | { op: 'guest_join' | 'guest_leave'; id?: string; groupId: string }
  | { op: 'state'; id?: string; personId: string; audience: AudienceInput }
  | { op: 'quit'; id?: string };

class ScriptedLLM implements LLM {
  readonly requests: LLMRequest[] = [];
  async complete(request: LLMRequest): Promise<string> {
    this.requests.push(structuredClone(request));
    if (request.system.startsWith('You extract long-term memories')) return '{"memories":[]}';
    return 'I hear you. Tell me a little more about what would feel useful right now.';
  }
}

export class FakeTelegram {
  private messageId = 10_000;
  readonly sends: Array<{ at: string; chatId: number; text: string; synthetic: true }> = [];
  now: () => Date = () => new Date();
  sendMessage = async (chatId: number, text: string): Promise<TelegramMessage> => {
    this.sends.push({ at: this.now().toISOString(), chatId, text, synthetic: true });
    return { message_id: this.messageId++, chat: { id: chatId, type: 'private' }, date: Math.floor(this.now().getTime() / 1000), text };
  };
  sendVoice = async (chatId: number): Promise<TelegramMessage> => this.sendMessage(chatId, '[synthetic voice omitted]');
  sendChatAction = async (): Promise<boolean> => true;
  answerCallbackQuery = async (): Promise<boolean> => true;
  editMessageText = async (_chatId: number, _messageId: number, text: string): Promise<unknown> => ({ text });
  downloadFile = async (): Promise<ArrayBuffer> => new ArrayBuffer(0);
}

function syntheticOrg(personas: SyntheticPersona[]): OrgDirectory {
  const people = personas.map((persona, index) => ({
    id: persona.id, name: persona.name, role: 'Synthetic user', telegramUserId: 810_000 + index,
    companyIds: [], projectIds: [],
  }));
  people.push({ id: 'guest-1', name: 'Guest One', role: 'Synthetic guest', telegramUserId: 819_999, companyIds: [], projectIds: [], guest: true } as typeof people[number]);
  const config = parseOrgConfig({
    organization: { id: 'simulation', name: 'Synthetic Vox Evaluation' }, people, relationships: [], companies: [], projects: [],
    groups: [{ id: 'book-club', name: 'Synthetic Book Club', telegramChatId: -810_001, memberIds: ['asha', 'marco'], hasGuests: false }],
    personas: [{ id: 'tireh', name: 'Tireh', role: 'AI companion', personality: 'Warm, thoughtful, and attentive', communicationStyle: 'Natural and concise; follows the person\'s lead', values: ['Respect', 'Honesty', 'Privacy'], voice: { elevenLabsVoiceId: 'synthetic-none', description: 'text only' }, ownerId: personas[0].id, telegramUsername: 'vox_tireh_bot', replyWithVoice: 'never', webSearch: false }],
  });
  return new OrgDirectory(config);
}

function keyFor(personaId: string, personId: string, audience: AudienceInput) {
  return audience.kind === 'private'
    ? { personaId, chatKey: `private-${personId}`, audience: { kind: 'private' as const, personId } }
    : { personaId, chatKey: `group-${audience.groupId}`, audience: { kind: 'group' as const, groupId: audience.groupId } };
}

export class SyntheticGatewaySession {
  readonly org: OrgDirectory;
  readonly telegram = new FakeTelegram();
  readonly llm: LLM;
  readonly stores: ReturnType<typeof createFileStores>;
  readonly relationships: RelationshipLoop;
  readonly gateway: PersonaGateway;
  private updateId = 1;
  private messageId = 1;
  private turnCount = 0;
  private readonly transcriptPath: string;
  private readonly ready: Promise<void>;

  constructor(readonly directory: string, readonly scenario: RelationshipScenario, private readonly realModel: boolean, env: SessionEnv = {}, private now: () => Date = () => new Date(), private readonly turnLimit = 20) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.transcriptPath = join(directory, 'transcript.ndjson');
    this.org = syntheticOrg(scenario.personas);
    this.llm = realModel ? new AnthropicLLM(env.anthropicApiKey!, env.chatModel || 'claude-sonnet-5-5') : new ScriptedLLM();
    this.stores = createFileStores(join(directory, 'memory-and-history.json'));
    const observer = new FileObservationStore(join(directory, 'relationship-observations.json'));
    const relationships = new FileRelationshipStore(join(directory, 'relationship-state.json'));
    this.relationships = new RelationshipLoop({
      store: relationships, mode: 'live', now: () => this.now(),
      assessor: realModel ? new StudioRelationshipAssessor(new AnthropicLLM(env.anthropicApiKey!, env.voiceModel || 'claude-haiku-5-5')) : {
        async assess({ text, now }) {
          if (/criticized the presentation/i.test(text)) return { timeZone: 'UTC', situations: [{ topic: 'boss-conflict', summary: 'The user says their boss criticized a presentation.', status: 'open' }], followUp: { topic: 'boss-conflict', purpose: 'Check in gently about the conversation.', dueAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString() } };
          if (/talked it through|fine now/i.test(text)) return { situations: [{ topic: 'boss-conflict', summary: 'The user says the conflict is resolved.', status: 'closed' }] };
          if (/interview is tomorrow/i.test(text)) return { timeZone: 'UTC', situations: [{ topic: 'interview', summary: 'The user has an interview tomorrow.', status: 'open' }], followUp: { topic: 'interview', purpose: 'Ask how the interview went.', dueAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString() } };
          if (/it went well/i.test(text)) return { situations: [{ topic: 'interview', summary: 'The user says the interview went well.', status: 'closed' }] };
          return {};
        },
      },
      decisions: realModel ? new OpenAIDecisions(env.openaiApiKey!) : { async choose() { return env.decision ?? 'stay_quiet'; } },
      observer: new SafeRelationshipObserver(observer, 'synthetic-relationship-observer-secret-0001', () => this.now()),
      policy: { allowGroupOutreach: false },
    });
    const metadata = {
      schemaVersion: 1,
      scenarioId: scenario.id,
      seed: scenario.seed,
      syntheticOnly: true,
      transport: 'FakeTelegram',
      userAgentModel: env.userAgentModel ?? 'external-agent-unreported',
      providerMode: realModel ? 'real-providers' : 'fake-providers',
      assistantModel: realModel ? env.chatModel || 'claude-sonnet-5-5' : 'scripted-fake',
      assessorModel: realModel ? env.voiceModel || 'claude-haiku-5-5' : 'scenario-fake',
      decisionModel: realModel ? 'gpt-6-luna' : 'scenario-configured',
      maxUserTurns: Math.max(1, Math.min(20, env.maxTurns ?? 20)),
      callConfig: { replyTokens: 700, proactiveTokens: 160, assessmentTimeoutMs: 12000, decisionsTimeoutMs: 6000 },
    };
    appendFileSync(join(directory, 'session.json'), JSON.stringify(metadata, null, 2), { mode: 0o600 });
    const fakeTelegram = this.telegram;
    this.telegram.now = () => this.now();
    const bot = fakeTelegram as unknown as TelegramBotClient;
    this.gateway = new PersonaGateway({
      org: this.org, llm: this.llm, memories: this.stores.memories, offers: this.stores.offers,
      history: this.stores.history, deduper: this.stores.deduper, relationships: this.relationships,
      relationshipEnabled: () => true, voice: null, botFor: () => bot, now: () => this.now(),
      logger: { info() {}, warn() {}, error() {} },
    });
    // Explicit synthetic persona preference, recorded through the production control API.
    this.ready = Promise.all(scenario.personas.map((person) => this.relationships.configure(keyFor('tireh', person.id, { kind: 'private', personId: person.id }), { timeZone: person.timeZone }))).then(() => undefined);
  }

  private async capture<T>(id: string | undefined, op: string, action: () => Promise<T>, input: unknown): Promise<{ id?: string; op: string; input: unknown; result: T; replies: string[]; relationshipState: unknown[]; observations: unknown[]; deliveryEvidence: unknown[] }> {
    const before = this.telegram.sends.length;
    const result = await action();
    const replies = this.telegram.sends.slice(before).map((send) => send.text);
    const relationshipState = await Promise.all((await this.relationships.deps.store.keysForPersona('tireh')).map((key) => this.relationships.status(key)));
    const report = {
      ...(id ? { id } : {}), op, input, result, replies, relationshipState,
      observations: await new FileObservationStore(join(this.directory, 'relationship-observations.json')).recent(20),
      deliveryEvidence: this.telegram.sends.slice(-20),
    };
    appendFileSync(this.transcriptPath, `${JSON.stringify({ at: this.now().toISOString(), command: input, output: report })}\n`, { mode: 0o600 });
    return report;
  }

  async execute(command: GatewayCommand): Promise<unknown> {
    await this.ready;
    if (command.op === 'advance') return this.capture(command.id, command.op, async () => { const date = new Date(command.at); if (!Number.isFinite(date.getTime())) throw new Error('advance.at must be ISO date'); this.now = () => date; this.telegram.now = () => this.now(); return { now: date.toISOString() }; }, command);
    if (command.op === 'turn') {
      if (++this.turnCount > this.turnLimit) throw new Error('session_turn_cap_reached');
      const speaker = this.org.getPerson(command.personId);
      const speakerTelegramId = speaker?.telegramUserId;
      if (!speaker || typeof speakerTelegramId !== 'number' || speakerTelegramId <= 0) throw new Error('unknown_synthetic_person');
      if (command.audience.kind === 'private' && command.audience.personId !== command.personId) throw new Error('private_speaker_must_own_audience');
      return this.capture(command.id, command.op, async () => {
        const chat = command.audience.kind === 'private'
          ? { id: speakerTelegramId, type: 'private' as const }
          : { id: this.org.getGroup(command.audience.groupId)?.telegramChatId ?? 0, type: 'group' as const };
        if (chat.id === 0) throw new Error('unknown_synthetic_group');
        const text = command.audience.kind === 'group' ? `@vox_tireh_bot ${command.text}` : command.text;
        const messageId = this.messageId++;
        const result = await this.gateway.handleUpdate('tireh', { update_id: this.updateId++, message: {
          message_id: messageId, from: { id: speakerTelegramId, is_bot: false, first_name: speaker.name }, chat,
          date: Math.floor(this.now().getTime() / 1000), text,
        } });
        const key = keyFor('tireh', command.personId, command.audience);
        return { gatewayResult: result, relationship: await this.relationships.status(key) };
      }, command);
    }
    if (command.op === 'seed_memory') return this.capture(command.id, command.op, async () => {
      const person = this.org.getPerson(command.ownerId);
      if (!person) throw new Error('unknown_memory_owner');
      const record = await this.stores.memories.add({
        personaId: 'tireh', content: command.content, type: 'fact', scope: { kind: 'private', personId: command.ownerId },
        authorizedPersonIds: [command.ownerId], shareVersion: 0, sensitivity: command.sensitivity ?? 'normal',
        source: { personId: command.ownerId, chatKind: 'private', at: this.now() }, aboutPersonIds: [command.ownerId], topic: command.topic, confidence: 1,
      });
      return { memoryId: record.id };
    }, command);
    if (command.op === 'share' || command.op === 'revoke') return this.capture(command.id, command.op, async () => {
      const memory = await this.stores.memories.get(command.memoryId);
      if (!memory) throw new Error('unknown_synthetic_memory');
      const patch = command.op === 'share'
        ? ownerSharePatch(this.org, memory, command.ownerId, command.recipientIds)
        : ownerRevokePatch(memory, command.ownerId);
      await this.stores.memories.update(memory.id, patch);
      await this.stores.history.clearPersona('tireh');
      await this.relationships.invalidatePersona('tireh', { sourceIds: [memory.id], reason: 'synthetic_share_scope_changed' });
      return { memoryId: memory.id, scope: patch.scope, authorizedPersonIds: patch.authorizedPersonIds };
    }, command);
    if (command.op === 'group_join' || command.op === 'group_leave') return this.capture(command.id, command.op, async () => {
      const group = this.org.getGroup(command.groupId);
      if (!group) throw new Error('unknown_synthetic_group');
      group.memberIds = command.op === 'group_join' ? [...new Set([...group.memberIds, command.personId])] : group.memberIds.filter((id) => id !== command.personId);
      return { groupId: group.id, memberIds: [...group.memberIds] };
    }, command);
    if (command.op === 'guest_join' || command.op === 'guest_leave') return this.capture(command.id, command.op, async () => {
      const group = this.org.getGroup(command.groupId);
      if (!group) throw new Error('unknown_synthetic_group');
      group.hasGuests = command.op === 'guest_join';
      if (command.op === 'guest_join' && !group.memberIds.includes('guest-1')) group.memberIds.push('guest-1');
      if (command.op === 'guest_leave') group.memberIds = group.memberIds.filter((id) => id !== 'guest-1');
      return { groupId: group.id, hasGuests: group.hasGuests, memberIds: [...group.memberIds] };
    }, command);
    if (command.op === 'reconsider') return this.capture(command.id, command.op, async () => this.relationships.drain({
      authorize: async (job) => job.key.audience.kind === 'private' && Boolean(this.org.getPerson(job.key.audience.personId)),
      loadContext: async (job) => job.key.audience.kind === 'private' ? this.gateway.proactiveContext(job.key.personaId, job.key.audience.personId, job.purpose) : '',
      compose: async (job, context) => this.llm.complete({ system: 'Write one short, warm, non-pressuring follow-up for a fictional Vox user. Use only the supplied authorized context. Never diagnose, guilt, reveal private context to a group, claim delivery, or ask permission for ordinary friendly conversation.', messages: [{ role: 'user', content: JSON.stringify({ purpose: job.purpose, context }) }], maxTokens: 160, temperature: 0.4 }),
      send: async (job, text) => {
        const chatId = job.key.audience.kind === 'private' ? this.org.getPerson(job.key.audience.personId)!.telegramUserId! : this.org.getGroup(job.key.audience.groupId)!.telegramChatId;
        return `synthetic-${(await this.telegram.sendMessage(chatId, text)).message_id}`;
      },
    }), command);
    if (command.op === 'state') return this.capture(command.id, command.op, async () => this.relationships.status(keyFor('tireh', command.personId, command.audience)), command);
    if (command.op === 'quit') return { ok: true, op: 'quit' };
    throw new Error('unsupported_simulation_command');
  }
}

