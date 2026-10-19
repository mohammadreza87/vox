/**
 * Vox Studio service — every operation the Mini App and VoxxBot perform,
 * each one checked against permissions.ts. API routes stay thin.
 */

import { randomUUID } from 'crypto';
import type { LLM } from '../tireh/llm';
import type { ChatHistoryStore, MemoryStore, ShareOfferStore, UpdateDeduper } from '../tireh/memory/store';
import { isVisibleToAudience, describeScope } from '../tireh/memory/visibility';
import { buildSystemPrompt } from '../tireh/conversation/prompt';
import { PersonaGateway } from '../tireh/gateway';
import type { TelegramBotClient, TelegramChatMemberUpdated, TelegramManagedBotUpdated, TelegramUser } from '../tireh/telegram/client';
import { decryptSecret, encryptSecret } from './crypto';
import { avatarPrompt, type ElevenLabsStudio, type LibraryVoice, type OpenAIMedia, StudioVoiceService } from './media';
import { personId, studioToOrg } from './org-bridge';
import { draftPersona, randomLook, refinePersona, suggestUsername, validatePersona } from './persona';
import {
  atLeast, canDeleteDraft, canEditPersona, canFire, canManageAccess, canSetAgentAdmin, canSpawn, canUseAgent,
  checkRoleChange, formingDay, isLocked, visibleAgents,
} from './permissions';
import type { StudioStore } from './store';
import {
  FORMING_DAYS, HUES, type Agent, type AgentLook, type Member, type MemoryPolicy, type PersonaSpec, type Role, type SpawnBrief,
} from './types';

export class StudioError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const forbidden = (msg = "You don't have permission to do that.") => new StudioError(403, msg);
const notFound = (msg = 'Not found') => new StudioError(404, msg);
const bad = (msg: string) => new StudioError(400, msg);
const ROLES: Role[] = ['superadmin', 'admin', 'member', 'pending'];
const lockedMessage = (agent: Agent) => `${agent.persona.name}'s personality is locked. To change it, fire and hire a successor.`;

export interface StudioDeps {
  store: StudioStore;
  personaLLM: LLM;
  chatLLM: LLM;
  openai: OpenAIMedia | null;
  eleven: ElevenLabsStudio | null;
  managerBot: TelegramBotClient | null;
  managerUsername: string;
  botFor(token: string): TelegramBotClient;
  secret: string;
  orgName: string;
  superadminIds: number[];
  webAppUrl?: string;
  memory: { memories: MemoryStore; offers: ShareOfferStore; history: ChatHistoryStore; deduper: UpdateDeduper };
  imageToJpeg?: (data: Buffer) => Promise<Buffer>;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  now?: () => Date;
}

export interface AgentView {
  id: string;
  status: Agent['status'];
  persona: PersonaSpec;
  look: AgentLook;
  voice?: { label: string; source: string };
  voicePreviews?: Array<{ generatedVoiceId: string; file: string }>;
  bot?: { username: string };
  hiredAt?: string;
  lockAt?: string;
  locked: boolean;
  formingDay: number | null;
  isAdmin: boolean;
  access: 'everyone' | number[];
  createdBy: number;
  creatorName?: string;
  successorOf?: string;
  firedAt?: string;
  firedReason?: string;
  canEdit: boolean;
  canFire: boolean;
  canManageAccess: boolean;
}

export class Studio {
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(readonly deps: StudioDeps) {
    this.log = deps.logger ?? console;
  }

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  // ============================================
  // MEMBERS & ROLES
  // ============================================

  /** Called for every authenticated Mini App request and every bot message. */
  async ensureMember(user: Pick<TelegramUser, 'id' | 'first_name' | 'username'> & { last_name?: string }): Promise<Member> {
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || `User ${user.id}`;
    return this.deps.store.update((s) => {
      let member = s.members.find((m) => m.telegramId === user.id);
      const bootstrap = this.deps.superadminIds.includes(user.id);
      if (!member) {
        member = { telegramId: user.id, name, username: user.username, role: bootstrap ? 'superadmin' : 'pending', joinedAt: this.now().toISOString() };
        s.members.push(member);
      } else {
        member.name = name;
        member.username = user.username;
        if (bootstrap && member.role !== 'superadmin') member.role = 'superadmin';
      }
      return { ...member };
    });
  }

  async listMembers(actor: Member) {
    if (!atLeast(actor, 'member')) throw forbidden();
    const s = await this.deps.store.read();
    const people = s.members
      .filter((m) => m.role !== 'pending' || atLeast(actor, 'admin'))
      .sort((a, b) => ['superadmin', 'admin', 'member', 'pending'].indexOf(a.role) - ['superadmin', 'admin', 'member', 'pending'].indexOf(b.role));
    const agentAdmins = s.agents.filter((a) => a.isAdmin && a.status === 'active').map((a) => this.view(a, actor, s.members));
    return { people, agentAdmins };
  }

  async setRole(actor: Member, targetId: number, role: Role) {
    if (!ROLES.includes(role)) throw bad('Unknown role');
    return this.deps.store.update((s) => {
      const target = s.members.find((m) => m.telegramId === targetId);
      if (!target) throw notFound('Person not found');
      const check = checkRoleChange(s, actor, target, role);
      if (!check.ok) throw forbidden(check.reason);
      target.role = role;
      if (role !== 'pending' && !target.approvedBy) target.approvedBy = actor.telegramId;
      s.audit.push({ at: this.now().toISOString(), actor: actor.telegramId, action: 'role.set', target: String(targetId), detail: role });
      return { ...target };
    });
  }

  // ============================================
  // AGENTS: READ
  // ============================================

  view(agent: Agent, actor: Member, members: Member[] = []): AgentView {
    const now = this.now();
    return {
      id: agent.id,
      status: agent.status,
      persona: agent.persona,
      look: agent.look,
      voice: agent.voice ? { label: agent.voice.label, source: agent.voice.source } : undefined,
      voicePreviews: agent.status === 'draft' ? agent.voicePreviews : undefined,
      bot: agent.bot ? { username: agent.bot.username } : undefined,
      hiredAt: agent.hiredAt,
      lockAt: agent.lockAt,
      locked: isLocked(agent, now),
      formingDay: formingDay(agent, now),
      isAdmin: agent.isAdmin,
      access: agent.access,
      createdBy: agent.createdBy,
      creatorName: members.find((m) => m.telegramId === agent.createdBy)?.name,
      successorOf: agent.successorOf,
      firedAt: agent.firedAt,
      firedReason: agent.firedReason,
      canEdit: canEditPersona(actor, agent, now),
      canFire: canFire(actor, agent),
      canManageAccess: canManageAccess(actor, agent),
    };
  }

  /** view() after a change: re-reads members so creatorName survives mutations. */
  private async present(agent: Agent, actor: Member): Promise<AgentView> {
    return this.view(agent, actor, (await this.deps.store.read()).members);
  }

  async listAgents(actor: Member): Promise<AgentView[]> {
    const s = await this.deps.store.read();
    return visibleAgents(s, actor)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((a) => this.view(a, actor, s.members));
  }

  async getAgent(actor: Member, id: string): Promise<AgentView> {
    const s = await this.deps.store.read();
    const agent = visibleAgents(s, actor).find((a) => a.id === id);
    if (!agent) throw notFound('Agent not found');
    return this.view(agent, actor, s.members);
  }

  private async mutateAgent<T>(actor: Member, id: string, check: (a: Agent) => boolean, fn: (a: Agent) => T, msg?: string): Promise<T> {
    return this.deps.store.update((s) => {
      const agent = s.agents.find((a) => a.id === id);
      if (!agent) throw notFound('Agent not found');
      if (!check(agent)) throw forbidden(msg);
      return fn(agent);
    });
  }

  // ============================================
  // SPAWN: DRAFT → LOOK → VOICE → PUBLISH
  // ============================================

  async draft(actor: Member, brief: SpawnBrief, successorOf?: string): Promise<{ agent: AgentView; names: string[] }> {
    if (!canSpawn(actor)) throw forbidden('Ask an admin to approve you first.');
    let predecessor: Agent | undefined;
    if (successorOf) {
      predecessor = (await this.deps.store.read()).agents.find((a) => a.id === successorOf && a.status === 'fired');
      if (!predecessor) throw notFound('Predecessor not found');
    }
    const { names, persona, look } = await draftPersona(this.deps.personaLLM, brief, this.deps.orgName);
    const agent: Agent = {
      id: `ag${randomUUID().replace(/-/g, '').slice(0, 10)}`,
      status: 'draft',
      persona,
      look,
      createdBy: actor.telegramId,
      createdAt: this.now().toISOString(),
      isAdmin: false,
      access: 'everyone',
      identityVersion: 1,
      successorOf,
    };
    await this.deps.store.update((s) => {
      s.agents.push(agent);
      s.audit.push({ at: this.now().toISOString(), actor: actor.telegramId, action: 'agent.draft', target: agent.id });
    });
    return { agent: await this.present(agent, actor), names };
  }

  async refine(actor: Member, id: string, instruction: string): Promise<AgentView> {
    if (!instruction.trim()) throw bad('Tell Claude what to change.');
    const current = await this.requireEditable(actor, id);
    const persona = await refinePersona(this.deps.personaLLM, current.persona, instruction.slice(0, 500));
    return this.savePersona(actor, id, persona);
  }

  async updatePersona(actor: Member, id: string, patch: Partial<PersonaSpec>): Promise<AgentView> {
    const current = await this.requireEditable(actor, id);
    const persona = { ...current.persona };
    for (const key of Object.keys(patch) as Array<keyof PersonaSpec>) {
      const value = patch[key];
      if (value === undefined) continue;
      if (typeof value === 'string' && value.length > 800) throw bad(`${key} is too long`);
      (persona as Record<string, unknown>)[key] = value;
    }
    if (typeof persona.name !== 'string' || !persona.name.trim()) throw bad('A name is required.');
    const checked = validatePersona(persona);
    if (!checked.ok) throw bad(`Invalid persona: ${checked.error}`);
    return this.savePersona(actor, id, checked.persona);
  }

  private async requireEditable(actor: Member, id: string): Promise<Agent> {
    const agent = (await this.deps.store.read()).agents.find((a) => a.id === id);
    if (!agent) throw notFound('Agent not found');
    this.assertEditable(actor, agent);
    return agent;
  }

  /** Locked agents get the "fire and hire" explanation; everyone else a plain 403. */
  private assertEditable(actor: Member, agent: Agent): true {
    if (isLocked(agent, this.now())) throw forbidden(lockedMessage(agent));
    if (!canEditPersona(actor, agent, this.now())) throw forbidden();
    return true;
  }

  private async savePersona(actor: Member, id: string, persona: PersonaSpec): Promise<AgentView> {
    const agent = await this.mutateAgent(actor, id, (a) => this.assertEditable(actor, a), (a) => {
      a.persona = persona;
      if (a.status === 'active') a.identityVersion += 1;
      return { ...a };
    }, 'This personality can no longer be changed.');
    if (agent.status === 'active') await this.configureBotProfile(agent).catch((e) => this.log.warn('[studio] profile sync failed', e));
    return this.present(agent, actor);
  }

  async setLook(actor: Member, id: string, patch: Partial<Pick<AgentLook, 'hue' | 'family' | 'features'>> | 'random'): Promise<AgentView> {
    const agent = await this.mutateAgent(actor, id, (a) => this.assertEditable(actor, a), (a) => {
      if (patch === 'random') {
        const next = randomLook(a.persona.presentation);
        a.look = { ...a.look, hue: next.hue, family: next.family, features: next.features };
      } else {
        if (patch.hue && !HUES.includes(patch.hue)) throw bad('Unknown colour');
        if (patch.family && !['puff', 'tower', 'drift'].includes(patch.family)) throw bad('Unknown shape');
        a.look = { ...a.look, ...patch, features: { ...a.look.features, ...(patch.features ?? {}) } };
      }
      return { ...a };
    }, 'The look can only change while the agent is forming.');
    return this.present(agent, actor);
  }

  async generateAvatars(actor: Member, id: string, count = 2): Promise<AgentView> {
    if (!this.deps.openai) throw new StudioError(503, 'Avatar generation needs OPENAI_API_KEY.');
    const agent = await this.requireEditable(actor, id);
    const n = Number.isFinite(count) ? Math.max(1, Math.min(4, Math.floor(count))) : 2;
    const files = await Promise.all(Array.from({ length: n }, async (_, i) => {
      const jpeg = await this.deps.openai!.generateAvatar(avatarPrompt(agent.persona, agent.look, i));
      return this.deps.store.saveMedia(`av-${agent.id}-${randomUUID().slice(0, 8)}.jpg`, jpeg);
    }));
    const updated = await this.mutateAgent(actor, id, (a) => canEditPersona(actor, a, this.now()), (a) => {
      a.look.avatarVariants = [...files, ...(a.look.avatarVariants ?? [])].slice(0, 12);
      if (!a.look.avatar) { a.look.avatar = files[0]; a.look.avatarSource = 'generated'; }
      return { ...a };
    });
    return this.present(updated, actor);
  }

  async chooseAvatar(actor: Member, id: string, file: string | null): Promise<AgentView> {
    const agent = await this.mutateAgent(actor, id, (a) => this.assertEditable(actor, a), (a) => {
      if (file && !(a.look.avatarVariants ?? []).includes(file)) throw bad('Unknown avatar');
      a.look.avatar = file ?? undefined;
      a.look.avatarSource = file ? (file.startsWith('up-') ? 'custom' : 'generated') : undefined;
      return { ...a };
    }, 'The avatar can only change while the agent is forming.');
    if (agent.status === 'active') await this.configureBotProfile(agent).catch((e) => this.log.warn('[studio] photo sync failed', e));
    return this.present(agent, actor);
  }

  /** Custom image upload: re-encoded to a clean 640×640 JPEG (Telegram needs JPG). */
  async uploadAvatar(actor: Member, id: string, data: Buffer, mime: string): Promise<AgentView> {
    await this.requireEditable(actor, id);
    if (data.length > 8 * 1024 * 1024) throw bad('Image is larger than 8 MB.');
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw bad('Use a JPEG, PNG or WebP image.');
    let jpeg: Buffer;
    if (this.deps.imageToJpeg) jpeg = await this.deps.imageToJpeg(data).catch(() => { throw bad("That image couldn't be read."); });
    else if (mime === 'image/jpeg') jpeg = data;
    else throw bad('Only JPEG uploads are supported on this server.');
    const file = this.deps.store.saveMedia(`up-${id}-${randomUUID().slice(0, 8)}.jpg`, jpeg);
    await this.mutateAgent(actor, id, (a) => canEditPersona(actor, a, this.now()), (a) => {
      a.look.avatarVariants = [file, ...(a.look.avatarVariants ?? [])].slice(0, 12);
    });
    return this.chooseAvatar(actor, id, file);
  }

  async designVoices(actor: Member, id: string, description?: string): Promise<AgentView> {
    if (!this.deps.eleven) throw new StudioError(503, 'Voice design needs ELEVENLABS_API_KEY.');
    const agent = await this.requireEditable(actor, id);
    if (agent.status !== 'draft') throw forbidden('The voice is chosen before publishing.');
    const brief = (description ?? agent.persona.voiceBrief).slice(0, 1000);
    const previews = await this.deps.eleven.designVoices(brief);
    const saved = previews.slice(0, 3).map((p) => ({
      generatedVoiceId: p.generatedVoiceId,
      file: this.deps.store.saveMedia(`vp-${id}-${randomUUID().slice(0, 8)}.mp3`, p.audio),
    }));
    const updated = await this.mutateAgent(actor, id, (a) => canEditPersona(actor, a, this.now()), (a) => {
      a.voicePreviews = saved;
      if (description) a.persona = { ...a.persona, voiceBrief: brief };
      return { ...a };
    });
    return this.present(updated, actor);
  }

  async chooseDesignedVoice(actor: Member, id: string, generatedVoiceId: string): Promise<AgentView> {
    if (!this.deps.eleven) throw new StudioError(503, 'Voice design needs ELEVENLABS_API_KEY.');
    const agent = await this.requireEditable(actor, id);
    if (!(agent.voicePreviews ?? []).some((p) => p.generatedVoiceId === generatedVoiceId)) throw bad('Unknown voice preview');
    const voiceId = await this.deps.eleven.saveDesignedVoice(generatedVoiceId, `${this.deps.orgName} ${agent.persona.name} ${agent.id}`, agent.persona.voiceBrief);
    const updated = await this.mutateAgent(actor, id, (a) => canEditPersona(actor, a, this.now()), (a) => {
      a.voice = { provider: 'elevenlabs', voiceId, label: `Designed voice · ${a.persona.accent || 'custom'}`, source: 'design' };
      return { ...a };
    });
    return this.present(updated, actor);
  }

  async searchVoices(actor: Member, filters: { gender?: string; age?: string; accent?: string; language?: string; search?: string }): Promise<LibraryVoice[]> {
    if (!canSpawn(actor)) throw forbidden();
    if (!this.deps.eleven) throw new StudioError(503, 'The voice library needs ELEVENLABS_API_KEY.');
    return this.deps.eleven.searchLibrary(filters);
  }

  async chooseLibraryVoice(actor: Member, id: string, v: { publicOwnerId: string; voiceId: string; name: string }): Promise<AgentView> {
    if (!this.deps.eleven) throw new StudioError(503, 'The voice library needs ELEVENLABS_API_KEY.');
    await this.requireEditable(actor, id);
    const voiceId = await this.deps.eleven.addLibraryVoice(v.publicOwnerId, v.voiceId, `${this.deps.orgName} ${v.name}`.slice(0, 60));
    const updated = await this.mutateAgent(actor, id, (a) => canEditPersona(actor, a, this.now()), (a) => {
      a.voice = { provider: 'elevenlabs', voiceId, label: `${v.name} · voice library`, source: 'library' };
      return { ...a };
    });
    return this.present(updated, actor);
  }

  async previewSpeech(actor: Member, id: string, text: string): Promise<Buffer> {
    if (!this.deps.eleven) throw new StudioError(503, 'Speech needs ELEVENLABS_API_KEY.');
    const agent = (await this.deps.store.read()).agents.find((a) => a.id === id);
    if (!agent || !agent.voice) throw notFound('No voice chosen yet');
    if (!canEditPersona(actor, agent, this.now()) && !canUseAgent(actor, agent)) throw forbidden();
    return this.deps.eleven.speak(text.slice(0, 300), agent.voice.voiceId);
  }

  /** Sandbox chat before publishing: same persona, no memory, nothing stored. */
  async testChat(actor: Member, id: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string> {
    const agent = (await this.deps.store.read()).agents.find((a) => a.id === id);
    if (!agent) throw notFound('Agent not found');
    if (!canEditPersona(actor, agent, this.now()) && !canUseAgent(actor, agent)) throw forbidden();
    const s = await this.deps.store.read();
    const org = studioToOrg({ ...s, agents: [{ ...agent, status: 'active', bot: agent.bot ?? { id: 0, username: 'sandbox' } }] }, this.deps.orgName);
    const persona = org.getPersona(agent.id)!;
    const speakerId = personId(actor.telegramId);
    const system = buildSystemPrompt({
      org, persona, chat: { kind: 'private', chatKey: 'sandbox', personId: speakerId }, speakerId, memories: [], now: this.now(),
    }) + '\n\nThis is a sandbox test before you are hired. Nothing here is remembered.';
    return this.deps.chatLLM.complete({ system, messages: messages.slice(-12).map((m) => ({ ...m, content: m.content.slice(0, 2000) })), maxTokens: 500 });
  }

  // ============================================
  // PUBLISH (Telegram managed bots)
  // ============================================

  async publish(actor: Member, id: string): Promise<{ link: string; agent: AgentView }> {
    if (!this.deps.managerUsername) throw new StudioError(503, 'VOXX_BOT_USERNAME is not configured.');
    const agent = await this.mutateAgent(actor, id, (a) => canEditPersona(actor, a, this.now()), (a) => {
      if (a.status !== 'draft' && a.status !== 'awaiting_bot') throw bad('This agent is already published.');
      a.status = 'awaiting_bot';
      a.suggestedUsername = a.suggestedUsername ?? suggestUsername(a.persona.name);
      return { ...a };
    });
    const link = `https://t.me/newbot/${this.deps.managerUsername}/${agent.suggestedUsername}`;
    return { link, agent: await this.present(agent, actor) };
  }

  /**
   * Telegram created a bot managed by VoxxBot. Match it to the creator's
   * waiting agent (by suggested username first), fetch its token, set up its
   * profile and start the forming period.
   */
  async onManagedBot(update: TelegramManagedBotUpdated): Promise<Agent | null> {
    const manager = this.deps.managerBot;
    if (!manager) return null;
    const s = await this.deps.store.read();
    const existing = s.agents.find((a) => a.bot?.id === update.bot.id);
    const waiting = s.agents
      .filter((a) => a.status === 'awaiting_bot' && a.createdBy === update.user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (existing?.status === 'fired') {
      this.log.warn(`[studio] managed bot @${update.bot.username} belongs to fired agent ${existing.id}; ignored`);
      return null;
    }
    const target = existing ?? waiting.find((a) => a.suggestedUsername?.toLowerCase() === update.bot.username?.toLowerCase()) ?? waiting[0];
    if (!target) {
      this.log.warn(`[studio] managed bot @${update.bot.username} has no waiting agent`);
      return null;
    }
    const token = await manager.getManagedBotToken(update.bot.id);
    const now = this.now();
    const agent = await this.deps.store.update((st) => {
      const a = st.agents.find((x) => x.id === target.id)!;
      a.tokenEnc = encryptSecret(token, this.deps.secret);
      a.bot = { id: update.bot.id, username: update.bot.username ?? a.suggestedUsername ?? '' };
      // A repeat update for a known bot is a token refresh, never a re-hire.
      if (!existing) {
        a.status = 'active';
        a.hiredAt = now.toISOString();
        a.lockAt = new Date(now.getTime() + FORMING_DAYS * 86_400_000).toISOString();
      }
      st.audit.push({ at: now.toISOString(), actor: update.user.id, action: existing ? 'agent.token' : 'agent.hired', target: a.id });
      return { ...a };
    });
    if (!existing && agent.successorOf) await this.inheritMemories(agent);
    await this.configureBotProfile(agent).catch((e) => this.log.warn('[studio] profile setup failed', e));
    await manager
      .sendMessage(update.user.id, existing
        ? `@${agent.bot!.username} has a new token. ${agent.persona.name} is back online.`
        : `${agent.persona.name} is alive: @${agent.bot!.username}\n\nPersonality can still change for ${FORMING_DAYS} days, then it locks for good.`)
      .catch(() => undefined);
    return agent;
  }

  botToken(agent: Agent): string | null {
    if (!agent.tokenEnc) return null;
    try {
      return decryptSecret(agent.tokenEnc, this.deps.secret);
    } catch {
      this.log.error(`[studio] cannot decrypt token for ${agent.id}`);
      return null;
    }
  }

  async configureBotProfile(agent: Agent): Promise<void> {
    const token = this.botToken(agent);
    if (!token) return;
    const bot = this.deps.botFor(token);
    const p = agent.persona;
    await bot.setMyName(p.name);
    await bot.setMyShortDescription(`${p.role} at ${this.deps.orgName}. ${p.tagline}`.trim());
    await bot.setMyDescription(`${p.name} · ${p.role}\n\n${p.tagline}\n\nTalk by text or voice. Only ${this.deps.orgName} members can chat.`);
    await bot.setMyCommands([
      { command: 'start', description: `Meet ${p.name}` },
      { command: 'memories', description: 'What I remember that you can see' },
      { command: 'forget', description: 'Delete something you told me' },
      { command: 'whoami', description: 'How I know you' },
    ]);
    const photo = agent.look.avatar ? this.deps.store.readMedia(agent.look.avatar) : null;
    if (photo) await bot.setMyProfilePhoto(photo);
  }

  // ============================================
  // ACCESS, ADMIN, FIRE & RE-HIRE
  // ============================================

  async setAccess(actor: Member, id: string, access: 'everyone' | number[]): Promise<AgentView> {
    if (access !== 'everyone' && (!Array.isArray(access) || access.some((x) => !Number.isInteger(x)))) throw bad('Invalid access list');
    const agent = await this.mutateAgent(actor, id, (a) => canManageAccess(actor, a), (a) => { a.access = access; return { ...a }; });
    return this.present(agent, actor);
  }

  async setAgentAdmin(actor: Member, id: string, isAdmin: boolean): Promise<AgentView> {
    if (!canSetAgentAdmin(actor)) throw forbidden('Only a superadmin can make an agent an admin.');
    const agent = await this.mutateAgent(actor, id, (a) => a.status === 'active', (a) => {
      a.isAdmin = isAdmin;
      return { ...a };
    }, 'Only active agents can be admins.');
    await this.deps.store.audit({ actor: actor.telegramId, action: isAdmin ? 'agent.admin.grant' : 'agent.admin.revoke', target: id });
    return this.present(agent, actor);
  }

  async deleteDraft(actor: Member, id: string): Promise<void> {
    await this.deps.store.update((s) => {
      const i = s.agents.findIndex((a) => a.id === id);
      if (i === -1) throw notFound();
      if (!canDeleteDraft(actor, s.agents[i])) throw forbidden();
      s.agents.splice(i, 1);
    });
  }

  async fire(actor: Member, id: string, input: { reason: string; memoryPolicy: MemoryPolicy; confirmName: string }): Promise<AgentView> {
    if (!['transfer', 'archive', 'delete'].includes(input.memoryPolicy)) throw bad('Choose what happens to memories.');
    const agent = await this.mutateAgent(actor, id, (a) => canFire(actor, a), (a) => {
      if (input.confirmName.trim().toLowerCase() !== a.persona.name.trim().toLowerCase()) throw bad(`Type ${a.persona.name} to confirm.`);
      a.status = 'fired';
      a.firedAt = this.now().toISOString();
      a.firedBy = actor.telegramId;
      a.firedReason = input.reason.slice(0, 300);
      a.memoryPolicy = input.memoryPolicy;
      a.isAdmin = false;
      return { ...a };
    }, 'Only admins can fire agents.');
    await this.deps.store.audit({ actor: actor.telegramId, action: 'agent.fired', target: id, detail: `${input.memoryPolicy}: ${input.reason}` });

    if (input.memoryPolicy === 'delete') {
      // listActive skips superseded memories; follow each chain so nothing survives.
      for (const m of await this.deps.memory.memories.listActive(id)) {
        let next: string | undefined = m.id;
        const seen = new Set<string>();
        while (next && !seen.has(next)) {
          seen.add(next);
          const record: Awaited<ReturnType<MemoryStore['get']>> = await this.deps.memory.memories.get(next);
          await this.deps.memory.memories.delete(next);
          next = record?.personaId === id ? record.supersedes : undefined;
        }
      }
    }
    // Leave every group and say goodbye; the bot stops being polled.
    const token = this.botToken(agent);
    if (token) {
      const bot = this.deps.botFor(token);
      const s = await this.deps.store.read();
      for (const g of s.groups.filter((g) => g.agentIds.includes(id))) await bot.leaveChat(g.chatId).catch(() => undefined);
      await bot.setMyShortDescription(`${agent.persona.name} has left ${this.deps.orgName}.`).catch(() => undefined);
    }
    await this.deps.store.update((s) => {
      for (const g of s.groups) g.agentIds = g.agentIds.filter((a) => a !== id);
    });
    return this.present(agent, actor);
  }

  /** Memories carry over to a successor when the predecessor was fired with "transfer". */
  private async inheritMemories(agent: Agent) {
    const s = await this.deps.store.read();
    const predecessor = s.agents.find((a) => a.id === agent.successorOf);
    if (!predecessor || predecessor.memoryPolicy !== 'transfer') return;
    for (const m of await this.deps.memory.memories.listActive(predecessor.id)) {
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = m;
      await this.deps.memory.memories.add({ ...rest, personaId: agent.id });
    }
  }

  // ============================================
  // GROUPS
  // ============================================

  async groupLink(actor: Member, id: string): Promise<string> {
    const s = await this.deps.store.read();
    const agent = s.agents.find((a) => a.id === id);
    if (!agent || !agent.bot || !canUseAgent(actor, agent)) throw notFound('Agent not found');
    return `https://t.me/${agent.bot.username}?startgroup=hoor`;
  }

  async listGroups(actor: Member) {
    if (!atLeast(actor, 'member')) throw forbidden();
    const s = await this.deps.store.read();
    return s.groups
      .filter((g) => g.memberIds.includes(actor.telegramId) || atLeast(actor, 'admin'))
      .map((g) => ({
        chatId: g.chatId, title: g.title, hasGuests: g.hasGuests, memberCount: g.memberIds.length,
        agents: g.agentIds.map((id) => s.agents.find((a) => a.id === id)).filter(Boolean).map((a) => ({ id: a!.id, name: a!.persona.name, look: a!.look })),
      }));
  }

  /** The agent's bot was added to or removed from a group. */
  async onBotChatMember(agent: Agent, update: TelegramChatMemberUpdated): Promise<void> {
    const chat = update.chat;
    if (chat.type !== 'group' && chat.type !== 'supergroup') return;
    const joined = ['member', 'administrator'].includes(update.new_chat_member.status);
    const s = await this.deps.store.read();
    const adder = s.members.find((m) => m.telegramId === update.from.id);
    const token = this.botToken(agent);
    const bot = token ? this.deps.botFor(token) : null;

    if (joined && (!adder || !atLeast(adder, 'member') || !canUseAgent(adder, agent))) {
      // Only HOOR members who may use the agent can bring it into a group.
      if (bot) {
        await bot.sendMessage(chat.id, `I can only join groups when a ${this.deps.orgName} member adds me.`).catch(() => undefined);
        await bot.leaveChat(chat.id).catch(() => undefined);
      }
      return;
    }
    // Unknown member count = assume guests (fail closed).
    const count = joined && bot ? await bot.getChatMemberCount(chat.id).catch(() => null) : null;
    await this.deps.store.update((st) => {
      let group = st.groups.find((g) => g.chatId === chat.id);
      if (joined) {
        if (!group) {
          group = { chatId: chat.id, title: chat.title ?? 'Group', memberIds: [], hasGuests: false, agentIds: [], addedBy: update.from.id, addedAt: this.now().toISOString() };
          st.groups.push(group);
        }
        group.title = chat.title ?? group.title;
        if (!group.agentIds.includes(agent.id)) group.agentIds.push(agent.id);
        if (!group.memberIds.includes(update.from.id)) group.memberIds.push(update.from.id);
        const botsInGroup = group.agentIds.length;
        group.hasGuests = count === null || count - botsInGroup > group.memberIds.length;
      } else if (group) {
        group.agentIds = group.agentIds.filter((a) => a !== agent.id);
      }
    });
  }

  /**
   * A HOOR member spoke in a group: remember they are part of its audience.
   * Returns false when the speaker is not an approved member.
   */
  async noteGroupSpeaker(chatId: number, telegramId: number): Promise<boolean> {
    return this.deps.store.update((s) => {
      const member = s.members.find((m) => m.telegramId === telegramId);
      const group = s.groups.find((g) => g.chatId === chatId);
      if (!group) return false;
      if (!member || member.role === 'pending') {
        // Someone outside HOOR can read this group: only its own memories are safe now.
        group.hasGuests = true;
        return false;
      }
      if (!group.memberIds.includes(telegramId)) group.memberIds.push(telegramId);
      return true;
    });
  }

  // ============================================
  // RUNTIME: GATEWAY, CALLS, MEMORIES
  // ============================================

  async gateway(): Promise<{ gateway: PersonaGateway; state: Awaited<ReturnType<StudioStore['read']>> }> {
    const state = await this.deps.store.read();
    const org = studioToOrg(state, this.deps.orgName);
    const tokens = new Map(state.agents.filter((a) => a.status === 'active').map((a) => [a.id, this.botToken(a)]));
    const gateway = new PersonaGateway({
      org,
      llm: this.deps.chatLLM,
      ...this.deps.memory,
      voice: this.deps.openai || this.deps.eleven ? new StudioVoiceService(this.deps.openai, this.deps.eleven) : null,
      botFor: (personaId) => {
        const token = tokens.get(personaId);
        if (!token) throw new Error(`No bot token for ${personaId}`);
        return this.deps.botFor(token);
      },
      logger: this.log,
      now: this.deps.now,
    });
    return { gateway, state };
  }

  /** One turn of a Mini App voice call: hear → think → speak. */
  async callTurn(actor: Member, id: string, audio: ArrayBuffer, mime: string): Promise<{ transcript: string; reply: string; audio?: string }> {
    const s = await this.deps.store.read();
    const agent = s.agents.find((a) => a.id === id);
    if (!agent || !canUseAgent(actor, agent)) throw notFound('Agent not found');
    if (!this.deps.openai) throw new StudioError(503, 'Calls need OPENAI_API_KEY for listening.');
    if (audio.byteLength > 10 * 1024 * 1024) throw bad('That recording is too long.');
    const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
    const transcript = await this.deps.openai.transcribe(audio, mime, `turn.${ext}`);
    if (!transcript) return { transcript: '', reply: '' };
    const { gateway } = await this.gateway();
    const reply = await gateway.converse(id, personId(actor.telegramId), transcript);
    let speech: string | undefined;
    if (this.deps.eleven && agent.voice) {
      speech = (await this.deps.eleven.speak(reply, agent.voice.voiceId).catch((e) => { this.log.warn('[studio] tts failed', e); return null; }))?.toString('base64');
    }
    return { transcript, reply, audio: speech };
  }

  async memoriesFor(actor: Member, id: string) {
    const s = await this.deps.store.read();
    const agent = s.agents.find((a) => a.id === id);
    if (!agent || !canUseAgent(actor, agent)) throw notFound('Agent not found');
    const org = studioToOrg(s, this.deps.orgName);
    const me = personId(actor.telegramId);
    const all = await this.deps.memory.memories.listActive(id);
    return all
      .filter((m) => isVisibleToAudience(org, m, [me]))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((m) => ({
        id: m.id, content: m.content, type: m.type, scope: m.scope.kind, scopeLabel: describeScope(org, m.scope),
        from: org.getPerson(m.source.personId)?.name ?? 'Someone', mine: m.source.personId === me,
        at: m.source.at.toISOString(), sensitivity: m.sensitivity,
      }));
  }

  async forgetMemory(actor: Member, agentId: string, memoryId: string): Promise<void> {
    const m = await this.deps.memory.memories.get(memoryId);
    if (!m || m.personaId !== agentId) throw notFound('Memory not found');
    if (m.source.personId !== personId(actor.telegramId)) throw forbidden('Only the person who said it can delete it.');
    await this.deps.memory.memories.delete(memoryId);
  }

  async auditLog(actor: Member, limit = 50) {
    if (!atLeast(actor, 'admin')) throw forbidden();
    const s = await this.deps.store.read();
    return s.audit.slice(-limit).reverse();
  }
}
