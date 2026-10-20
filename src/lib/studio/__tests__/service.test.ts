import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MemoryRecord, MemoryScope } from '../../tireh/types';
import { groupText } from '../../tireh/__tests__/fixtures';
import { decryptSecret } from '../crypto';
import { defaultVoiceId } from '../media';
import { groupId, personId } from '../org-bridge';
import { StudioError } from '../service';
import { draftJson, fakeMember, hire, ID, makeStudio, personaSpec, SECRET, seedOrg, T0, type Harness } from './helpers';

type Org = Awaited<ReturnType<typeof seedOrg>>;

const DAY = 86_400_000;

async function expectStudioError(p: Promise<unknown>, status: number, message?: string | RegExp) {
  const error = await p.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(StudioError);
  expect((error as StudioError).status).toBe(status);
  if (message) expect((error as StudioError).message).toMatch(message);
}

function mem(agentId: string, partial: Partial<MemoryRecord> & { content: string; scope: MemoryScope }): Omit<MemoryRecord, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    personaId: agentId,
    type: 'fact',
    sensitivity: 'normal',
    source: { personId: personId(ID.alice), chatKind: 'private', at: T0 },
    aboutPersonIds: [],
    confidence: 0.9,
    ...partial,
  };
}

let h: Harness;
let org: Org;

beforeEach(async () => {
  h = makeStudio();
  org = await seedOrg(h);
});

// ============================================================================
describe('members and roles', () => {
  it('bootstraps founding owners from superadminIds; everyone else starts pending', async () => {
    expect(org.superadmin.role).toBe('owner');
    const newcomer = await h.studio.ensureMember({ id: 4242, first_name: 'New', last_name: 'Person', username: 'np' });
    expect(newcomer).toMatchObject({ role: 'pending', name: 'New Person', username: 'np' });
  });

  it('keeps a bootstrap id owner even if their stored role was changed', async () => {
    await h.store.update((s) => { s.members.find((m) => m.telegramId === ID.superadmin)!.role = 'member'; });
    expect((await h.studio.ensureMember({ id: ID.superadmin, first_name: 'Reza' })).role).toBe('owner');
  });

  it('admins approve pending people and record who approved them', async () => {
    const approved = await h.studio.setRole(org.admin, ID.pending, 'member');
    expect(approved).toMatchObject({ role: 'member', approvedBy: ID.admin });
    const audit = await h.studio.auditLog(org.admin);
    expect(audit[0]).toMatchObject({ action: 'role.set', actor: ID.admin, target: String(ID.pending), detail: 'member' });
  });

  it('admins cannot grant admin; superadmins can', async () => {
    await expectStudioError(h.studio.setRole(org.admin, ID.alice, 'admin'), 403, /superadmin/);
    expect((await h.studio.setRole(org.superadmin, ID.alice, 'admin')).role).toBe('admin');
  });

  it('members cannot change roles; nobody changes their own', async () => {
    await expectStudioError(h.studio.setRole(org.alice, ID.pending, 'member'), 403);
    await expectStudioError(h.studio.setRole(org.superadmin, ID.superadmin, 'admin'), 403, /own role/);
  });

  it('owners make owners, superadmins and admins; superadmins never touch owners', async () => {
    expect((await h.studio.setRole(org.superadmin, ID.admin, 'superadmin')).role).toBe('superadmin');
    const superadmin = await h.studio.ensureMember({ id: ID.admin, first_name: 'Parastoo' });
    expect((await h.studio.setRole(superadmin, ID.alice, 'superadmin')).role).toBe('superadmin');
    expect((await h.studio.setRole(superadmin, ID.alice, 'admin')).role).toBe('admin');
    await expectStudioError(h.studio.setRole(superadmin, ID.bob, 'owner'), 403, /Only an owner/);
    await expectStudioError(h.studio.setRole(superadmin, ID.superadmin, 'admin'), 403, /Only an owner/);
    expect((await h.studio.setRole(org.superadmin, ID.bob, 'owner')).role).toBe('owner');
    const bob = await h.studio.ensureMember({ id: ID.bob, first_name: 'Bob' });
    expect((await h.studio.setRole(bob, ID.admin, 'member')).role).toBe('member');
  });

  it('never removes the last owner or the last superadmin-level person', async () => {
    // A forged actor that claims owner still cannot remove the only owner.
    await expectStudioError(h.studio.setRole(fakeMember(1, 'owner'), ID.superadmin, 'superadmin'), 403, /at least one owner/);
    await expectStudioError(h.studio.setRole(fakeMember(1, 'owner'), ID.superadmin, 'member'), 403, /at least one owner/);
    // With a second owner, the first can step down to superadmin.
    await h.studio.setRole(org.superadmin, ID.admin, 'owner');
    expect((await h.studio.setRole(fakeMember(1, 'owner'), ID.superadmin, 'superadmin')).role).toBe('superadmin');
  });

  it('rejects unknown roles and unknown people', async () => {
    await expectStudioError(h.studio.setRole(org.superadmin, ID.alice, 'god' as never), 400, /Unknown role/);
    await expectStudioError(h.studio.setRole(org.superadmin, ID.alice, undefined as never), 400);
    await expectStudioError(h.studio.setRole(org.superadmin, 31337, 'member'), 404);
    expect((await h.store.read()).members.find((m) => m.telegramId === ID.alice)?.role).toBe('member');
  });

  it('members do not see pending people; admins do; pending people see nothing', async () => {
    const forMember = await h.studio.listMembers(org.alice);
    expect(forMember.people.some((m) => m.role === 'pending')).toBe(false);
    const forAdmin = await h.studio.listMembers(org.admin);
    expect(forAdmin.people.map((m) => m.role)).toEqual(['owner', 'admin', 'member', 'member', 'pending']);
    await expectStudioError(h.studio.listMembers(org.pending), 403);
  });

  it('audit log is admin-only', async () => {
    await expectStudioError(h.studio.auditLog(org.alice), 403);
  });
});

// ============================================================================
describe('spawn: draft, refine, look, avatars, voice, sandbox, publish', () => {
  it('pending people cannot spawn', async () => {
    await expectStudioError(h.studio.draft(org.pending, {}), 403);
    expect(h.personaLLM.requests).toHaveLength(0);
  });

  it('drafts a persona and look with Claude', async () => {
    h.personaLLM.push(draftJson({ name: 'Leyla' }));
    const { agent, names } = await h.studio.draft(org.alice, { role: 'Producer' });
    expect(names).toEqual(['Leyla', 'Alt', 'Other']);
    expect(agent).toMatchObject({ status: 'draft', createdBy: ID.alice, isAdmin: false, visibility: 'private', access: [], locked: false, formingDay: null, canEdit: true });
    expect(agent.look.hue).toBe('sky');
    expect((await h.store.read()).audit.at(-1)?.action).toBe('agent.draft');
  });

  it('falls back to randomLook when Claude gives no look', async () => {
    h.personaLLM.push(draftJson({}, undefined));
    const { agent } = await h.studio.draft(org.alice, {});
    expect(agent.look.family).toMatch(/puff|tower|drift/);
  });

  it('a successor draft must name a fired predecessor', async () => {
    const { agent } = await hire(h, org.alice);
    await expectStudioError(h.studio.draft(org.alice, {}, agent.id), 404);
    await expectStudioError(h.studio.draft(org.alice, {}, 'nope'), 404);
  });

  it('refines with Claude; empty instructions and non-creators are refused', async () => {
    h.personaLLM.push(draftJson());
    const { agent } = await h.studio.draft(org.alice, {});
    await expectStudioError(h.studio.refine(org.alice, agent.id, '   '), 400);
    await expectStudioError(h.studio.refine(org.bob, agent.id, 'more fun'), 403);
    h.personaLLM.push(JSON.stringify(personaSpec({ personality: 'Playful' })));
    const refined = await h.studio.refine(org.alice, agent.id, 'more fun');
    expect(refined.persona.personality).toBe('Playful');
    expect(refined.persona.name).toBe('Nova');
  });

  it('updates persona fields by hand with validation', async () => {
    h.personaLLM.push(draftJson());
    const { agent } = await h.studio.draft(org.alice, {});
    const updated = await h.studio.updatePersona(org.alice, agent.id, { tagline: 'New tagline', values: ['Care'] });
    expect(updated.persona).toMatchObject({ tagline: 'New tagline', values: ['Care'], name: 'Nova' });
    await expectStudioError(h.studio.updatePersona(org.alice, agent.id, { name: '  ' }), 400, /name/);
    await expectStudioError(h.studio.updatePersona(org.alice, agent.id, { backstory: 'x'.repeat(801) }), 400);
    await expectStudioError(h.studio.updatePersona(org.alice, agent.id, { values: 'Care' as never }), 400, /values/);
    await expectStudioError(h.studio.updatePersona(org.alice, agent.id, { name: 42 as never }), 400);
    await expectStudioError(h.studio.updatePersona(org.alice, agent.id, { isAdmin: true } as never), 400);
    expect((await h.studio.getAgent(org.alice, agent.id)).persona.tagline).toBe('New tagline');
  });

  it('changes the look by patch or at random, validating hue and family', async () => {
    h.personaLLM.push(draftJson());
    const { agent } = await h.studio.draft(org.alice, {});
    const patched = await h.studio.setLook(org.alice, agent.id, { hue: 'rose', features: { cheeks: false, lashes: true, brows: false } });
    expect(patched.look).toMatchObject({ hue: 'rose', family: 'drift', features: { cheeks: false, lashes: true, brows: false } });
    await expectStudioError(h.studio.setLook(org.alice, agent.id, { hue: 'neon' as never }), 400, /colour/);
    await expectStudioError(h.studio.setLook(org.alice, agent.id, { family: 'blob' as never }), 400, /shape/);
    await expectStudioError(h.studio.setLook(org.bob, agent.id, 'random'), 403);
    const random = await h.studio.setLook(org.alice, agent.id, 'random');
    expect(random.look.hue).toMatch(/apricot|rose|butter|matcha|lagoon|sky|lilac|ash/);
  });

  it('generates avatar variants with OpenAI, picks the first, and lets the creator choose', async () => {
    h.personaLLM.push(draftJson());
    const { agent } = await h.studio.draft(org.alice, {});
    const withAvatars = await h.studio.generateAvatars(org.alice, agent.id, 3);
    expect(h.openai.generateAvatar).toHaveBeenCalledTimes(3);
    const prompts = h.openai.generateAvatar.mock.calls.map((c) => c[0]);
    expect(new Set(prompts).size).toBe(3);
    const variants = withAvatars.look.avatarVariants!;
    expect(variants).toHaveLength(3);
    expect(withAvatars.look.avatar).toBe(variants[0]);
    expect(withAvatars.look.avatarSource).toBe('generated');
    for (const f of variants) expect(existsSync(join(h.store.mediaDir, f))).toBe(true);

    const chosen = await h.studio.chooseAvatar(org.alice, agent.id, variants[2]);
    expect(chosen.look.avatar).toBe(variants[2]);
    await expectStudioError(h.studio.chooseAvatar(org.alice, agent.id, 'av-other.jpg'), 400, /Unknown avatar/);
    const cleared = await h.studio.chooseAvatar(org.alice, agent.id, null);
    expect(cleared.look.avatar).toBeUndefined();
  });

  it('clamps the avatar count to 1..4 and treats a non-number as the default 2', async () => {
    h.personaLLM.push(draftJson());
    const { agent } = await h.studio.draft(org.alice, {});
    await h.studio.generateAvatars(org.alice, agent.id, 99);
    expect(h.openai.generateAvatar).toHaveBeenCalledTimes(4);
    h.openai.generateAvatar.mockClear();
    const v = await h.studio.generateAvatars(org.alice, agent.id, Number('abc'));
    expect(h.openai.generateAvatar).toHaveBeenCalledTimes(2);
    expect(v.look.avatarVariants).toHaveLength(6);
  });

  it('avatar generation needs an OpenAI key (503)', async () => {
    const bare = makeStudio({ openai: false });
    const o = await seedOrg(bare);
    bare.personaLLM.push(draftJson());
    const { agent } = await bare.studio.draft(o.alice, {});
    await expectStudioError(bare.studio.generateAvatars(o.alice, agent.id), 503, /OPENAI_API_KEY/);
  });

  it('re-encodes custom uploads to JPEG via imageToJpeg and selects them', async () => {
    h.personaLLM.push(draftJson());
    const { agent } = await h.studio.draft(org.alice, {});
    const view = await h.studio.uploadAvatar(org.alice, agent.id, Buffer.from('PNGDATA'), 'image/png');
    expect(h.imageToJpeg).toHaveBeenCalledWith(Buffer.from('PNGDATA'));
    expect(view.look.avatar).toMatch(/^up-.+\.jpg$/);
    expect(view.look.avatarSource).toBe('custom');
    expect(readFileSync(join(h.store.mediaDir, view.look.avatar!)).toString()).toBe('JPEG:PNGDATA');
  });

  it('refuses bad uploads', async () => {
    h.personaLLM.push(draftJson());
    const { agent } = await h.studio.draft(org.alice, {});
    await expectStudioError(h.studio.uploadAvatar(org.alice, agent.id, Buffer.from('x'), 'image/gif'), 400, /JPEG, PNG or WebP/);
    await expectStudioError(h.studio.uploadAvatar(org.alice, agent.id, Buffer.alloc(8 * 1024 * 1024 + 1), 'image/png'), 400, /8 MB/);
    h.imageToJpeg.mockRejectedValueOnce(new Error('corrupt'));
    await expectStudioError(h.studio.uploadAvatar(org.alice, agent.id, Buffer.from('x'), 'image/png'), 400, /couldn't be read/);
    await expectStudioError(h.studio.uploadAvatar(org.bob, agent.id, Buffer.from('x'), 'image/png'), 403);
  });

  it('designs voices (max 3 previews saved as media) and chooses one', async () => {
    h.personaLLM.push(draftJson());
    const { agent } = await h.studio.draft(org.alice, {});
    const designed = await h.studio.designVoices(org.alice, agent.id, 'Calm alto, 30s');
    expect(h.eleven.designVoices).toHaveBeenCalledWith('Calm alto, 30s');
    expect(designed.voicePreviews).toHaveLength(3);
    for (const p of designed.voicePreviews!) expect(existsSync(join(h.store.mediaDir, p.file))).toBe(true);
    expect(designed.persona.voiceBrief).toBe('Calm alto, 30s');

    await expectStudioError(h.studio.chooseDesignedVoice(org.alice, agent.id, 'gen-4'), 400, /Unknown voice preview/);
    const chosen = await h.studio.chooseDesignedVoice(org.alice, agent.id, 'gen-2');
    expect(h.eleven.saveDesignedVoice).toHaveBeenCalledWith('gen-2', `HOOR Nova ${agent.id}`, 'Calm alto, 30s');
    expect(chosen.voice).toEqual({ label: 'Designed voice · Tehrani', source: 'design' });
    // The internal voice id never leaks into the view.
    expect(JSON.stringify(chosen)).not.toContain('voice-designed');
  });

  it('chooses a library voice instead', async () => {
    h.personaLLM.push(draftJson());
    const { agent } = await h.studio.draft(org.alice, {});
    const chosen = await h.studio.chooseLibraryVoice(org.alice, agent.id, { publicOwnerId: 'o1', voiceId: 'v1', name: 'Sam' });
    expect(h.eleven.addLibraryVoice).toHaveBeenCalledWith('o1', 'v1', 'HOOR Sam');
    expect(chosen.voice).toEqual({ label: 'Sam · voice library', source: 'library' });
    expect((await h.store.read()).agents[0].voice?.voiceId).toBe('voice-library');
  });

  it('voice design is only for drafts and needs an ElevenLabs key', async () => {
    const { agent } = await hire(h, org.alice);
    await expectStudioError(h.studio.designVoices(org.alice, agent.id), 403, /before publishing/);
    const bare = makeStudio({ eleven: false });
    const o = await seedOrg(bare);
    bare.personaLLM.push(draftJson());
    const d = await bare.studio.draft(o.alice, {});
    await expectStudioError(bare.studio.designVoices(o.alice, d.agent.id), 503);
    await expectStudioError(bare.studio.searchVoices(o.alice, {}), 503);
  });

  it('previews speech only once a voice exists', async () => {
    h.personaLLM.push(draftJson());
    const { agent } = await h.studio.draft(org.alice, {});
    await expectStudioError(h.studio.previewSpeech(org.alice, agent.id, 'hi'), 404);
    await h.studio.chooseLibraryVoice(org.alice, agent.id, { publicOwnerId: 'o', voiceId: 'v', name: 'Sam' });
    expect((await h.studio.previewSpeech(org.alice, agent.id, 'hi')).toString()).toBe('spoken-mp3');
    expect(h.eleven.speak).toHaveBeenCalledWith('hi', 'voice-library');
    await expectStudioError(h.studio.previewSpeech(org.bob, agent.id, 'hi'), 403);
  });

  it('sandbox chat uses the persona but stores no memory or history', async () => {
    h.personaLLM.push(draftJson());
    const { agent } = await h.studio.draft(org.alice, {});
    h.chatLLM.nextReply = 'Hi Alice!';
    const reply = await h.studio.testChat(org.alice, agent.id, [{ role: 'user', content: 'Hi Nova' }]);
    expect(reply).toBe('Hi Alice!');
    expect(h.chatLLM.lastPrompt).toContain('You are Nova');
    expect(h.chatLLM.lastPrompt).toContain('sandbox test');
    expect(h.chatLLM.extractionCalls).toBe(0);
    expect(h.memory.memories.records.size).toBe(0);
    expect(h.memory.history.chats.size).toBe(0);
    await expectStudioError(h.studio.testChat(org.bob, agent.id, []), 403);
  });

  it('publishes: awaiting_bot and a managed-bot link with a _bot username', async () => {
    h.personaLLM.push(draftJson({ name: 'Leyla' }));
    const { agent } = await h.studio.draft(org.alice, {});
    await expectStudioError(h.studio.publish(org.bob, agent.id), 403);
    const { link, agent: published } = await h.studio.publish(org.alice, agent.id);
    expect(link).toBe('https://t.me/newbot/VoxxBot/hoor_leyla_bot?name=Leyla');
    expect(new URL(link).pathname).toMatch(/_bot$/);
    expect(published.status).toBe('awaiting_bot');
    // Re-opening the link is fine while waiting; the username is stable.
    expect((await h.studio.publish(org.alice, agent.id)).link).toBe(link);
  });

  it('prefills Telegram with a display name containing spaces, Unicode and query characters', async () => {
    const name = 'لیلا & Co';
    h.personaLLM.push(draftJson({ name }));
    const { agent } = await h.studio.draft(org.alice, {});
    const { link } = await h.studio.publish(org.alice, agent.id);
    const target = new URL(link);
    expect(target.origin).toBe('https://t.me');
    expect(target.pathname).toMatch(/^\/newbot\/VoxxBot\/.+_bot$/);
    expect(target.searchParams.get('name')).toBe(name);
    expect([...target.searchParams.keys()]).toEqual(['name']);
  });

  it('publish needs the manager bot username (503) and refuses already-active agents', async () => {
    const bare = makeStudio({ managerUsername: '' });
    const o = await seedOrg(bare);
    bare.personaLLM.push(draftJson());
    const d = await bare.studio.draft(o.alice, {});
    await expectStudioError(bare.studio.publish(o.alice, d.agent.id), 503);
    const { agent } = await hire(h, org.alice);
    await expectStudioError(h.studio.publish(org.alice, agent.id), 400, /already published/);
  });

  it('drafts can be deleted by their creator, not by other members', async () => {
    h.personaLLM.push(draftJson());
    const { agent } = await h.studio.draft(org.alice, {});
    await expectStudioError(h.studio.deleteDraft(org.bob, agent.id), 403);
    await h.studio.deleteDraft(org.alice, agent.id);
    expect((await h.store.read()).agents).toHaveLength(0);
    await expectStudioError(h.studio.deleteDraft(org.alice, agent.id), 404);
  });
});

// ============================================================================
describe('managed bot → hire', () => {
  it('activates the creator\'s waiting agent, encrypts the token and starts a 7-day forming period', async () => {
    const { agent, botId, token } = await hire(h, org.alice);
    expect(h.manager.getManagedBotToken).toHaveBeenCalledWith(botId);
    expect(agent.status).toBe('active');
    expect(agent.hiredAt).toBe(T0.toISOString());
    expect(new Date(agent.lockAt!).getTime() - new Date(agent.hiredAt!).getTime()).toBe(7 * DAY);
    expect(agent.bot).toEqual({ id: botId, username: 'hoor_nova_bot' });
    expect(decryptSecret(agent.tokenEnc!, SECRET)).toBe(token);

    const raw = readFileSync(join(h.dir, 'studio.json'), 'utf8');
    expect(raw).not.toContain(token);
    expect(raw).toContain(agent.tokenEnc!);
    expect((await h.store.read()).audit.at(-1)).toMatchObject({ action: 'agent.hired', actor: ID.alice, target: agent.id });
  });

  it('configures the bot profile and DMs the creator', async () => {
    const { bot } = await hire(h, org.alice, { name: 'Leyla', role: 'Producer', tagline: 'Ships on time' });
    const b = bot();
    expect(b.setMyName).toHaveBeenCalledWith('Leyla');
    expect(b.setMyShortDescription).toHaveBeenCalledWith('Producer at HOOR. Ships on time');
    expect(b.setMyDescription.mock.calls[0][0]).toContain('Leyla works with a few people at HOOR.');
    expect(b.setMyCommands.mock.calls[0][0].map((c: { command: string }) => c.command)).toEqual(['start', 'memories', 'forget', 'whoami']);
    // No custom avatar: the cloud character is rendered as the photo.
    const photo = String(b.setMyProfilePhoto.mock.calls[0][0]);
    expect(photo.startsWith('JPEG:<svg')).toBe(true);
    expect(h.manager.sendMessage).toHaveBeenCalledWith(ID.alice, expect.stringContaining('Leyla is alive: @hoor_leyla_bot'));
  });

  it('sets the profile photo when an avatar exists', async () => {
    h.personaLLM.push(draftJson());
    const { agent } = await h.studio.draft(org.alice, {});
    const withAvatar = await h.studio.generateAvatars(org.alice, agent.id, 1);
    await h.studio.publish(org.alice, agent.id);
    await h.studio.onManagedBot({ user: { id: ID.alice, is_bot: false, first_name: 'A' }, bot: { id: 1, is_bot: true, first_name: 'N', username: 'hoor_nova_bot' } });
    const photo = h.bots.get('token-1')!.setMyProfilePhoto.mock.calls[0][0] as unknown as Buffer;
    expect(photo.equals(readFileSync(join(h.store.mediaDir, withAvatar.look.avatar!)))).toBe(true);
  });

  it('one refused profile step never skips the others, and the creator can re-sync', async () => {
    const { agent, bot } = await hire(h, org.alice, { name: 'Leyla' });
    bot().setMyName.mockRejectedValueOnce(new Error('Too Many Requests: retry after 30'));
    const first = await h.studio.syncProfile(org.alice, agent.id);
    expect(first.failed).toEqual(['name']);
    expect(bot().setMyProfilePhoto).toHaveBeenCalledTimes(2);
    expect(bot().setMyDescription).toHaveBeenCalledTimes(2);
    expect(h.logger.warn).toHaveBeenCalledWith({ type: 'telegram_ingress', stage: 'profile_name', reason: 'operation_failed', outcome: 'continue' });

    const second = await h.studio.syncProfile(org.alice, agent.id);
    expect(second.failed).toEqual([]);
    expect(bot().setMyName).toHaveBeenLastCalledWith('Leyla');
    await expect(h.studio.syncProfile(org.bob, agent.id)).rejects.toThrow();
  });

  it('matches by suggested username first, else the creator\'s latest waiting agent', async () => {
    h.personaLLM.push(draftJson({ name: 'First' }));
    const first = (await h.studio.draft(org.alice, {})).agent;
    h.clock.now = new Date(T0.getTime() + 1000);
    h.personaLLM.push(draftJson({ name: 'Second' }));
    const second = (await h.studio.draft(org.alice, {})).agent;
    await h.studio.publish(org.alice, first.id);
    await h.studio.publish(org.alice, second.id);

    const byName = await h.studio.onManagedBot({ user: { id: ID.alice, is_bot: false, first_name: 'A' }, bot: { id: 11, is_bot: true, first_name: 'F', username: 'HOOR_First_Bot' } });
    expect(byName?.id).toBe(first.id);

    h.personaLLM.push(draftJson({ name: 'Third' }));
    h.clock.now = new Date(T0.getTime() + 2000);
    const third = (await h.studio.draft(org.alice, {})).agent;
    await h.studio.publish(org.alice, third.id);
    const fallback = await h.studio.onManagedBot({ user: { id: ID.alice, is_bot: false, first_name: 'A' }, bot: { id: 12, is_bot: true, first_name: 'X', username: 'renamed_by_user_bot' } });
    expect(fallback?.id).toBe(third.id);
  });

  it('ignores bots from someone with no waiting agent (never steals another creator\'s agent)', async () => {
    h.personaLLM.push(draftJson());
    const { agent } = await h.studio.draft(org.alice, {});
    await h.studio.publish(org.alice, agent.id);
    const result = await h.studio.onManagedBot({ user: { id: ID.bob, is_bot: false, first_name: 'B' }, bot: { id: 99, is_bot: true, first_name: 'N', username: 'hoor_nova_bot' } });
    expect(result).toBeNull();
    expect(h.manager.getManagedBotToken).not.toHaveBeenCalled();
    expect((await h.store.read()).agents[0].status).toBe('awaiting_bot');
  });

  it('a repeat update for the same bot is a token refresh, not a re-hire', async () => {
    const { agent, botId } = await hire(h, org.alice);
    h.advanceDays(10);
    h.manager.getManagedBotToken.mockResolvedValueOnce('fresh-token');
    const again = await h.studio.onManagedBot({ user: { id: ID.alice, is_bot: false, first_name: 'A' }, bot: { id: botId, is_bot: true, first_name: 'N', username: 'hoor_nova_bot' } });
    expect(again?.hiredAt).toBe(agent.hiredAt);
    expect(again?.lockAt).toBe(agent.lockAt);
    expect(decryptSecret(again!.tokenEnc!, SECRET)).toBe('fresh-token');
    expect((await h.store.read()).audit.at(-1)?.action).toBe('agent.token');
    expect(h.manager.sendMessage).toHaveBeenLastCalledWith(ID.alice, expect.stringContaining('has a new token'));
  });

  it('a managed-bot update never brings a fired agent back', async () => {
    const { agent, botId } = await hire(h, org.alice);
    await h.studio.fire(org.admin, agent.id, { reason: 'r', memoryPolicy: 'archive', confirmName: 'Nova' });
    const result = await h.studio.onManagedBot({ user: { id: ID.alice, is_bot: false, first_name: 'A' }, bot: { id: botId, is_bot: true, first_name: 'N', username: 'hoor_nova_bot' } });
    expect(result).toBeNull();
    expect((await h.store.read()).agents[0].status).toBe('fired');
  });

  it('does nothing without a manager bot', async () => {
    const bare = makeStudio({ manager: false });
    expect(await bare.studio.onManagedBot({ user: { id: 1, is_bot: false, first_name: 'x' }, bot: { id: 2, is_bot: true, first_name: 'y' } })).toBeNull();
  });

  it('survives a failing profile setup (still hired)', async () => {
    h.personaLLM.push(draftJson());
    const { agent } = await h.studio.draft(org.alice, {});
    await h.studio.publish(org.alice, agent.id);
    h.botFor.mockImplementationOnce(() => { throw new Error('telegram down'); });
    const hired = await h.studio.onManagedBot({ user: { id: ID.alice, is_bot: false, first_name: 'A' }, bot: { id: 5, is_bot: true, first_name: 'N', username: 'hoor_nova_bot' } });
    expect(hired?.status).toBe('active');
    expect(h.logger.warn).toHaveBeenCalled();
  });
});

// ============================================================================
describe('forming period and personality lock', () => {
  it('creator edits while forming: identityVersion increments and the bot profile syncs', async () => {
    const { agent, bot } = await hire(h, org.alice);
    h.advanceDays(3);
    const view = await h.studio.updatePersona(org.alice, agent.id, { name: 'Nova Prime' });
    expect(view.formingDay).toBe(4);
    expect(view.locked).toBe(false);
    expect((await h.store.read()).agents[0].identityVersion).toBe(2);
    expect(bot().setMyName).toHaveBeenLastCalledWith('Nova Prime');
  });

  it('drafts do not bump identityVersion', async () => {
    h.personaLLM.push(draftJson());
    const { agent } = await h.studio.draft(org.alice, {});
    await h.studio.updatePersona(org.alice, agent.id, { tagline: 'x' });
    expect((await h.store.read()).agents[0].identityVersion).toBe(1);
  });

  it('admins may edit any forming agent; other members may not', async () => {
    const { agent } = await hire(h, org.alice);
    await expectStudioError(h.studio.updatePersona(org.bob, agent.id, { tagline: 'x' }), 403);
    expect((await h.studio.updatePersona(org.admin, agent.id, { tagline: 'by admin' })).persona.tagline).toBe('by admin');
  });

  it('after 7 days every persona/look/avatar edit is refused with "fire and hire a successor"', async () => {
    const { agent } = await hire(h, org.alice);
    await h.studio.generateAvatars(org.alice, agent.id, 1);
    const variant = (await h.store.read()).agents[0].look.avatarVariants![0];
    h.advanceDays(7);
    const view = await h.studio.getAgent(org.alice, agent.id);
    expect(view).toMatchObject({ locked: true, formingDay: null, canEdit: false });

    const locked = /locked\. To change it, fire and hire a successor/;
    for (const actor of [org.alice, org.admin, org.superadmin]) {
      await expectStudioError(h.studio.updatePersona(actor, agent.id, { tagline: 'x' }), 403, locked);
      await expectStudioError(h.studio.refine(actor, agent.id, 'nicer'), 403, locked);
      await expectStudioError(h.studio.setLook(actor, agent.id, { hue: 'rose' }), 403, locked);
      await expectStudioError(h.studio.setLook(actor, agent.id, 'random'), 403, locked);
      await expectStudioError(h.studio.chooseAvatar(actor, agent.id, variant), 403, locked);
      await expectStudioError(h.studio.generateAvatars(actor, agent.id), 403, locked);
      await expectStudioError(h.studio.uploadAvatar(actor, agent.id, Buffer.from('x'), 'image/png'), 403, locked);
      await expectStudioError(h.studio.chooseLibraryVoice(actor, agent.id, { publicOwnerId: 'o', voiceId: 'v', name: 'n' }), 403, locked);
    }
    expect(h.personaLLM.requests).toHaveLength(1); // only the original draft
    expect((await h.store.read()).agents[0].identityVersion).toBe(1);
  });
});

// ============================================================================
describe('access and agent admins', () => {
  it('only superadmins make an active agent admin', async () => {
    const { agent } = await hire(h, org.alice);
    await expectStudioError(h.studio.setAgentAdmin(org.admin, agent.id, true), 403, /superadmin/);
    expect((await h.studio.setAgentAdmin(org.superadmin, agent.id, true)).isAdmin).toBe(true);
    expect((await h.studio.listMembers(org.alice)).agentAdmins.map((a) => a.id)).toEqual([agent.id]);
    h.personaLLM.push(draftJson());
    const d = await h.studio.draft(org.alice, {});
    await expectStudioError(h.studio.setAgentAdmin(org.superadmin, d.agent.id, true), 403, /active/);
  });

  it('new agents are private: creator, allow-list and admins only', async () => {
    const { agent } = await hire(h, org.alice, {}, undefined, 'private');
    expect(agent.visibility).toBe('private');
    await expectStudioError(h.studio.getAgent(org.bob, agent.id), 404);
    await expectStudioError(h.studio.groupLink(org.bob, agent.id), 404);
    expect((await h.studio.getAgent(org.admin, agent.id)).id).toBe(agent.id);
    expect(await h.studio.groupLink(org.alice, agent.id)).toBe('https://t.me/hoor_nova_bot?startgroup=hoor');
    // The creator adds Bob to the allow-list.
    await expectStudioError(h.studio.setAccess(org.bob, agent.id, [ID.bob]), 403);
    await expectStudioError(h.studio.setAccess(org.alice, agent.id, ['x'] as never), 400);
    await h.studio.setAccess(org.alice, agent.id, [ID.bob]);
    expect((await h.studio.getAgent(org.bob, agent.id)).id).toBe(agent.id);
  });

  it('the creator or an admin opens an agent to the org or the public', async () => {
    const { agent } = await hire(h, org.alice, {}, undefined, 'private');
    await expectStudioError(h.studio.setVisibility(org.bob, agent.id, 'org'), 403);
    await expectStudioError(h.studio.setVisibility(org.alice, agent.id, 'everyone' as never), 400);
    expect((await h.studio.setVisibility(org.alice, agent.id, 'org')).visibility).toBe('org');
    expect((await h.studio.getAgent(org.bob, agent.id)).visibility).toBe('org');
    expect((await h.studio.setVisibility(org.admin, agent.id, 'public')).visibility).toBe('public');
    expect((await h.store.read()).audit.filter((e) => e.action === 'agent.visibility').map((e) => e.detail)).toEqual(['org', 'public']);
  });

  it('older agents without a visibility keep their access meaning', async () => {
    const { agent } = await hire(h, org.alice);
    await h.store.update((s) => { const a = s.agents.find((x) => x.id === agent.id)!; delete a.visibility; a.access = 'everyone'; });
    expect((await h.studio.getAgent(org.bob, agent.id)).visibility).toBe('org');
    await h.store.update((s) => { s.agents.find((x) => x.id === agent.id)!.access = [ID.alice]; });
    await expectStudioError(h.studio.getAgent(org.bob, agent.id), 404);
  });
});

// ============================================================================
describe('fire and successor', () => {
  async function groupWith(agentId: string, chatId = -100123) {
    await h.store.update((s) => {
      s.groups.push({ chatId, title: 'Team', memberIds: [ID.alice], hasGuests: false, agentIds: [agentId], addedAt: T0.toISOString() });
    });
  }

  it('only admins fire, after typing the agent\'s name (case-insensitive) and choosing a memory policy', async () => {
    const { agent } = await hire(h, org.alice);
    await expectStudioError(h.studio.fire(org.alice, agent.id, { reason: '', memoryPolicy: 'archive', confirmName: 'Nova' }), 403);
    await expectStudioError(h.studio.fire(org.admin, agent.id, { reason: '', memoryPolicy: 'archive', confirmName: 'Nov' }), 400, /Type Nova/);
    await expectStudioError(h.studio.fire(org.admin, agent.id, { reason: '', memoryPolicy: 'shred' as never, confirmName: 'Nova' }), 400);
    expect((await h.store.read()).agents[0].status).toBe('active');
    const fired = await h.studio.fire(org.admin, agent.id, { reason: 'Wrong fit', memoryPolicy: 'archive', confirmName: '  nOvA ' });
    expect(fired).toMatchObject({ status: 'fired', firedReason: 'Wrong fit', isAdmin: false });
    await expectStudioError(h.studio.fire(org.admin, agent.id, { reason: '', memoryPolicy: 'archive', confirmName: 'Nova' }), 403);
  });

  it('fired agents leave their groups, are hidden from members and visible to admins', async () => {
    const { agent, bot } = await hire(h, org.alice);
    await groupWith(agent.id);
    await h.studio.fire(org.admin, agent.id, { reason: 'r', memoryPolicy: 'archive', confirmName: 'Nova' });
    expect(bot().leaveChat).toHaveBeenCalledWith(-100123);
    expect(bot().setMyShortDescription).toHaveBeenLastCalledWith('Nova has left HOOR.');
    expect((await h.store.read()).groups[0].agentIds).toEqual([]);
    expect(await h.studio.listAgents(org.alice)).toEqual([]);
    expect((await h.studio.listAgents(org.admin)).map((a) => a.status)).toEqual(['fired']);
    await expectStudioError(h.studio.memoriesFor(org.alice, agent.id), 404);
    expect((await h.store.read()).audit.at(-1)).toMatchObject({ action: 'agent.fired', detail: 'archive: r' });
  });

  it('memoryPolicy delete removes every memory, including superseded ones; other agents keep theirs', async () => {
    const { agent } = await hire(h, org.alice);
    const old = await h.memory.memories.add(mem(agent.id, { content: 'old', scope: { kind: 'org' } }));
    const current = await h.memory.memories.add(mem(agent.id, { content: 'new', scope: { kind: 'org' }, supersedes: old.id }));
    await h.memory.memories.update(old.id, { supersededBy: current.id });
    const other = await h.memory.memories.add(mem('someone-else', { content: 'keep', scope: { kind: 'org' } }));
    await h.studio.fire(org.admin, agent.id, { reason: '', memoryPolicy: 'delete', confirmName: 'Nova' });
    expect([...h.memory.memories.records.keys()]).toEqual([other.id]);
  });

  it('memoryPolicy archive keeps memories', async () => {
    const { agent } = await hire(h, org.alice);
    await h.memory.memories.add(mem(agent.id, { content: 'kept', scope: { kind: 'org' } }));
    await h.studio.fire(org.admin, agent.id, { reason: '', memoryPolicy: 'archive', confirmName: 'Nova' });
    expect(await h.memory.memories.listActive(agent.id)).toHaveLength(1);
  });

  it('a successor inherits memories at hire time when the predecessor was fired with transfer', async () => {
    const { agent: old } = await hire(h, org.alice);
    await h.memory.memories.add(mem(old.id, { content: 'Alice prefers mornings', scope: { kind: 'private', personId: personId(ID.alice) } }));
    await h.studio.fire(org.admin, old.id, { reason: 'reset', memoryPolicy: 'transfer', confirmName: 'Nova' });

    h.personaLLM.push(draftJson({ name: 'Nova Two' }));
    const { agent: draft } = await h.studio.draft(org.alice, {}, old.id);
    expect(draft.successorOf).toBe(old.id);
    expect(await h.memory.memories.listActive(draft.id)).toHaveLength(0); // not before hire

    await h.studio.publish(org.alice, draft.id);
    await h.studio.onManagedBot({ user: { id: ID.alice, is_bot: false, first_name: 'A' }, bot: { id: 777, is_bot: true, first_name: 'N', username: 'hoor_novatwo_bot' } });
    const inherited = await h.memory.memories.listActive(draft.id);
    expect(inherited.map((m) => m.content)).toEqual(['Alice prefers mornings']);
    expect(inherited[0].scope).toEqual({ kind: 'private', personId: personId(ID.alice) });
    expect(await h.memory.memories.listActive(old.id)).toHaveLength(1);
    // A token refresh does not copy them twice.
    await h.studio.onManagedBot({ user: { id: ID.alice, is_bot: false, first_name: 'A' }, bot: { id: 777, is_bot: true, first_name: 'N', username: 'hoor_novatwo_bot' } });
    expect(await h.memory.memories.listActive(draft.id)).toHaveLength(1);
  });

  it('no inheritance when the predecessor was archived', async () => {
    const { agent: old } = await hire(h, org.alice);
    await h.memory.memories.add(mem(old.id, { content: 'x', scope: { kind: 'org' } }));
    await h.studio.fire(org.admin, old.id, { reason: '', memoryPolicy: 'archive', confirmName: 'Nova' });
    const { agent: next } = await hire(h, org.alice, { name: 'Next' }, old.id);
    expect(await h.memory.memories.listActive(next.id)).toHaveLength(0);
  });
});

// ============================================================================
describe('groups', () => {
  const chat = { id: -100555, type: 'supergroup' as const, title: 'Game Team' };
  const join = (fromId: number, status = 'member') => ({
    chat, from: { id: fromId, is_bot: false, first_name: 'x' }, date: 0,
    old_chat_member: { status: 'left', user: { id: 1, is_bot: true, first_name: 'b' } },
    new_chat_member: { status, user: { id: 1, is_bot: true, first_name: 'b' } },
  });

  it('registers a group when an approved member adds the agent', async () => {
    const { agent: a, bot } = await hire(h, org.alice);
    bot().getChatMemberCount.mockResolvedValueOnce(2); // Alice + the bot
    await h.studio.onBotChatMember(a, join(ID.alice));
    const [g] = (await h.store.read()).groups;
    expect(g).toMatchObject({ chatId: chat.id, title: 'Game Team', memberIds: [ID.alice], agentIds: [a.id], hasGuests: false, addedBy: ID.alice });
    expect(bot().leaveChat).not.toHaveBeenCalled();
  });

  it('flags guests when Telegram counts more people than known members + agent bots', async () => {
    const { agent: a, bot } = await hire(h, org.alice);
    bot().getChatMemberCount.mockResolvedValueOnce(3);
    await h.studio.onBotChatMember(a, join(ID.alice));
    expect((await h.store.read()).groups[0].hasGuests).toBe(true);
  });

  it('assumes guests when the member count cannot be read (fail closed)', async () => {
    const { agent: a, bot } = await hire(h, org.alice);
    bot().getChatMemberCount.mockRejectedValueOnce(new Error('timeout'));
    await h.studio.onBotChatMember(a, join(ID.alice));
    expect((await h.store.read()).groups[0].hasGuests).toBe(true);
  });

  it('leaves when added by a stranger, a pending person, or a member who may not use the agent', async () => {
    const { agent: a, bot } = await hire(h, org.alice);
    await h.studio.onBotChatMember(a, join(ID.stranger));
    await h.studio.onBotChatMember(a, join(ID.pending, 'administrator'));
    await h.studio.setVisibility(org.alice, a.id, 'private');
    const restricted = (await h.store.read()).agents[0];
    await h.studio.onBotChatMember(restricted, join(ID.bob));
    expect(bot().leaveChat).toHaveBeenCalledTimes(3);
    expect(bot().sendMessage).toHaveBeenCalledWith(chat.id, expect.stringContaining('can add me to groups'));
    expect((await h.store.read()).groups).toEqual([]);
  });

  it('removes the agent from the group when the bot is removed; ignores private chats', async () => {
    const { agent: a } = await hire(h, org.alice);
    await h.studio.onBotChatMember(a, join(ID.alice));
    await h.studio.onBotChatMember(a, { ...join(ID.alice, 'kicked') });
    expect((await h.store.read()).groups[0].agentIds).toEqual([]);
    await h.studio.onBotChatMember(a, { ...join(ID.alice), chat: { id: 5, type: 'private' } });
    expect((await h.store.read()).groups).toHaveLength(1);
  });

  it('noteGroupSpeaker adds approved members, and marks guests when an outsider speaks', async () => {
    const { agent: a, bot } = await hire(h, org.alice);
    bot().getChatMemberCount.mockResolvedValueOnce(3);
    await h.studio.onBotChatMember(a, join(ID.alice));
    const user = (id: number, first_name = 'X') => ({ id, first_name });
    expect(await h.studio.noteGroupSpeaker(chat.id, user(ID.bob))).toBe(true);
    expect(await h.studio.noteGroupSpeaker(chat.id, user(ID.bob))).toBe(false); // nothing new
    expect((await h.store.read()).groups[0].memberIds).toEqual([ID.alice, ID.bob]);
    await h.store.update((s) => { s.groups[0].hasGuests = false; });
    // Outsiders join the group's audience as guests.
    expect(await h.studio.noteGroupSpeaker(chat.id, { id: ID.stranger, first_name: 'Sam', last_name: 'Lee', username: 'sam' })).toBe(true);
    const s = await h.store.read();
    expect(s.groups[0]).toMatchObject({ hasGuests: true, memberIds: [ID.alice, ID.bob, ID.stranger] });
    expect(s.guests).toEqual([{ telegramId: ID.stranger, name: 'Sam Lee', username: 'sam', firstSeen: T0.toISOString() }]);
    expect(await h.studio.noteGroupSpeaker(-1, user(ID.alice))).toBe(false);
  });

  it('members list only their groups; admins list all', async () => {
    const { agent: a } = await hire(h, org.alice);
    await h.studio.onBotChatMember(a, join(ID.alice));
    expect((await h.studio.listGroups(org.alice)).map((g) => g.title)).toEqual(['Game Team']);
    expect(await h.studio.listGroups(org.bob)).toEqual([]);
    const [g] = await h.studio.listGroups(org.admin);
    expect(g.agents.map((x) => x.name)).toEqual(['Nova']);
  });

  it('in a group with unknown readers only the current exchange reaches the model', async () => {
    const { agent: a, bot, botId } = await hire(h, org.alice);
    await h.store.update((s) => {
      s.groups.push({ chatId: chat.id, title: 'Game Team', memberIds: [ID.alice, ID.bob], hasGuests: true, agentIds: [a.id], addedAt: T0.toISOString() });
    });
    await h.memory.memories.add(mem(a.id, { content: 'GROUPFACT launch is Friday', scope: { kind: 'group', groupId: groupId(chat.id) }, authorizedPersonIds: [personId(ID.alice), personId(ID.bob)] }));
    await h.memory.memories.add(mem(a.id, { content: 'ORGFACT revenue numbers', scope: { kind: 'org' }, authorizedPersonIds: [personId(ID.alice), personId(ID.bob)] }));

    const { gateway } = await h.studio.gateway();
    expect(await gateway.handleUpdate(a.id, groupText(chat.id, ID.bob, 'Nova, what do we know?'))).toBe('replied');
    expect(h.chatLLM.lastPrompt).not.toContain('GROUPFACT');
    expect(h.chatLLM.replyRequests.at(-1)?.messages).toEqual([{ role: 'user', content: 'Bob: Nova, what do we know?' }]);
    expect(h.chatLLM.lastPrompt).not.toContain('ORGFACT');

    const roster = [ID.alice, ID.bob, botId];
    bot().getChatMemberCount.mockResolvedValue(roster.length);
    Object.assign(bot(), { getChatMember: vi.fn(async (chatId: number, id: number) => {
      expect(chatId).toBe(chat.id);
      expect(roster).toContain(id);
      return { status: roster.includes(id) ? 'member' : 'left', user: { id, is_bot: id === botId, first_name: 'Synthetic reader' } };
    }) });
    await h.store.update((s) => { s.groups[0].hasGuests = false; });
    const fresh = await h.studio.gateway();
    expect(await fresh.gateway.handleUpdate(a.id, groupText(chat.id, ID.bob, 'Nova, and now?'))).toBe('replied');
    expect(h.chatLLM.lastPrompt).toContain('GROUPFACT');
    expect(h.chatLLM.lastPrompt).not.toContain('ORGFACT');
  });
});

// ============================================================================
describe('calls', () => {
  it('transcribes, replies through the gateway (memory formed) and speaks with the agent\'s voice', async () => {
    h.personaLLM.push(draftJson());
    const { agent: d } = await h.studio.draft(org.alice, {});
    await h.studio.chooseLibraryVoice(org.alice, d.id, { publicOwnerId: 'o', voiceId: 'v', name: 'Sam' });
    await h.studio.publish(org.alice, d.id);
    await h.studio.onManagedBot({ user: { id: ID.alice, is_bot: false, first_name: 'A' }, bot: { id: 31, is_bot: true, first_name: 'N', username: 'hoor_nova_bot' } });

    h.openai.transcribe.mockResolvedValueOnce('I prefer short standups');
    h.chatLLM.nextReply = 'Noted, short standups.';
    h.chatLLM.nextExtraction = { memories: [{ content: 'Alice prefers short standups', type: 'preference', kind: 'work' }] };
    const result = await h.studio.callTurn(org.alice, d.id, new ArrayBuffer(16), 'audio/mp4');
    expect(h.openai.transcribe).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'audio/mp4', 'turn.m4a');
    expect(result.transcript).toBe('I prefer short standups');
    expect(result.reply).toBe('Noted, short standups.');
    expect(Buffer.from(result.audio!, 'base64').toString()).toBe('spoken-mp3');
    expect(h.eleven.speak).toHaveBeenCalledWith('Noted, short standups.', 'voice-library');
    const memories = await h.memory.memories.listActive(d.id);
    expect(memories.map((m) => m.content)).toEqual(['Alice prefers short standups']);
    expect(memories[0].scope).toEqual({ kind: 'private', personId: personId(ID.alice) });
  });

  it('an agent without a designed voice speaks with a default one; empty transcript means no reply', async () => {
    const { agent } = await hire(h, org.alice);
    const r = await h.studio.callTurn(org.bob, agent.id, new ArrayBuffer(4), 'audio/webm');
    expect(r.audio).toBe(Buffer.from('spoken-mp3').toString('base64'));
    expect(h.eleven.speak).toHaveBeenLastCalledWith('Sure.', defaultVoiceId(agent.persona.presentation));
    expect(r.reply).toBe('Sure.');
    h.openai.transcribe.mockResolvedValueOnce('');
    expect(await h.studio.callTurn(org.bob, agent.id, new ArrayBuffer(4), 'audio/webm')).toEqual({ transcript: '', reply: '' });
  });

  it('refuses callers who cannot use the agent, oversize audio, and no speech-to-text provider', async () => {
    const { agent } = await hire(h, org.alice);
    await expectStudioError(h.studio.callTurn(org.pending, agent.id, new ArrayBuffer(4), 'audio/webm'), 404);
    await expectStudioError(h.studio.callTurn(org.bob, agent.id, new ArrayBuffer(10 * 1024 * 1024 + 1), 'audio/webm'), 400);
    const elevenOnly = makeStudio({ openai: false });
    const e = await seedOrg(elevenOnly);
    const withScribe = await hire(elevenOnly, e.alice);
    expect((await elevenOnly.studio.callTurn(e.alice, withScribe.agent.id, new ArrayBuffer(4), 'audio/webm')).transcript).toBe('heard by scribe');
    const bare = makeStudio({ openai: false, eleven: false });
    const o = await seedOrg(bare);
    const hired = await hire(bare, o.alice);
    await expectStudioError(bare.studio.callTurn(o.alice, hired.agent.id, new ArrayBuffer(4), 'audio/webm'), 503);
  });
});

// ============================================================================
describe('memories API', () => {
  async function setup() {
    const { agent } = await hire(h, org.alice);
    const alicePrivate = await h.memory.memories.add(mem(agent.id, { content: 'alice secret', scope: { kind: 'private', personId: personId(ID.alice) } }));
    const shared = await h.memory.memories.add(mem(agent.id, { content: 'org fact', scope: { kind: 'org' }, authorizedPersonIds: [personId(ID.alice), personId(ID.bob)] }));
    const bobs = await h.memory.memories.add(mem(agent.id, {
      content: 'bob said', scope: { kind: 'org' }, authorizedPersonIds: [personId(ID.alice), personId(ID.bob)], source: { personId: personId(ID.bob), chatKind: 'private', at: T0 },
    }));
    return { agent, alicePrivate, shared, bobs };
  }

  it('lists only memories visible to the requester', async () => {
    const { agent } = await setup();
    const forBob = await h.studio.memoriesFor(org.bob, agent.id);
    expect(forBob.map((m) => m.content).sort()).toEqual(['bob said', 'org fact']);
    expect(forBob.find((m) => m.content === 'bob said')).toMatchObject({ mine: true, from: 'Bob', scopeLabel: 'HOOR' });
    const forAlice = await h.studio.memoriesFor(org.alice, agent.id);
    expect(forAlice.map((m) => m.content).sort()).toEqual(['alice secret', 'bob said', 'org fact']);
    await expectStudioError(h.studio.memoriesFor(org.pending, agent.id), 404);
  });

  it('only the source person deletes a memory', async () => {
    const { agent, shared, bobs } = await setup();
    await expectStudioError(h.studio.forgetMemory(org.bob, agent.id, shared.id), 403, /Only the person who said it/);
    await expectStudioError(h.studio.forgetMemory(org.admin, agent.id, shared.id), 403);
    await expectStudioError(h.studio.forgetMemory(org.bob, 'other-agent', bobs.id), 404);
    await expectStudioError(h.studio.forgetMemory(org.bob, agent.id, 'missing'), 404);
    await h.studio.forgetMemory(org.bob, agent.id, bobs.id);
    expect(await h.memory.memories.get(bobs.id)).toBeNull();
    expect(await h.memory.memories.get(shared.id)).not.toBeNull();
  });
});

describe('selected memory sharing', () => {
  it('source owner chooses exact recipients and may revoke the grant and retained derived history', async () => {
    const { agent } = await hire(h, org.alice);
    const record = await h.memory.memories.add(mem(agent.id, { content: 'EXPLICIT_RECIPIENT_CANARY', scope: { kind: 'private', personId: personId(ID.alice) } }));
    await expectStudioError(h.studio.shareMemory(org.bob, agent.id, record.id, [ID.admin]), 403);
    await h.studio.shareMemory(org.alice, agent.id, record.id, [ID.bob]);
    expect((await h.studio.memoriesFor(org.bob, agent.id)).map((m) => m.content)).toContain('EXPLICIT_RECIPIENT_CANARY');
    expect((await h.studio.memoriesFor(org.admin, agent.id)).map((m) => m.content)).not.toContain('EXPLICIT_RECIPIENT_CANARY');
    await h.memory.history.append(agent.id, `private-${personId(ID.bob)}`, { role: 'assistant', text: 'EXPLICIT_RECIPIENT_CANARY', at: T0 });
    await expectStudioError(h.studio.revokeMemory(org.bob, agent.id, record.id), 403);
    await h.studio.revokeMemory(org.alice, agent.id, record.id);
    expect((await h.studio.memoriesFor(org.bob, agent.id)).map((m) => m.content)).not.toContain('EXPLICIT_RECIPIENT_CANARY');
    expect((await h.studio.memoriesFor(org.alice, agent.id)).map((m) => m.content)).toContain('EXPLICIT_RECIPIENT_CANARY');
    expect(await h.memory.history.recent(agent.id, `private-${personId(ID.bob)}`, 10)).toEqual([]);
    expect((await h.memory.memories.get(record.id))?.shareVersion).toBe(2);
  });

  it('legacy shared rows remain unavailable until the source owner explicitly grants access', async () => {
    const { agent } = await hire(h, org.alice);
    const legacy = await h.memory.memories.add(mem(agent.id, { content: 'LEGACY_CANARY', scope: { kind: 'org' } }));
    expect((await h.studio.memoriesFor(org.alice, agent.id)).find((m) => m.id === legacy.id)).toMatchObject({ content: 'LEGACY_CANARY', scopeLabel: 'Sharing needs review' });
    expect((await h.studio.memoriesFor(org.bob, agent.id)).map((m) => m.content)).not.toContain('LEGACY_CANARY');
    await h.studio.shareMemory(org.alice, agent.id, legacy.id, [ID.bob]);
    expect((await h.studio.memoriesFor(org.bob, agent.id)).map((m) => m.content)).toContain('LEGACY_CANARY');
  });

  it('refuses recipients who are pending, outside the team or cannot use the agent, before reading the memory', async () => {
    const { agent } = await hire(h, org.alice, {}, undefined, 'private');
    const record = await h.memory.memories.add(mem(agent.id, { content: 'RECIPIENT_RULE_CANARY', scope: { kind: 'private', personId: personId(ID.alice) } }));
    const get = vi.spyOn(h.memory.memories, 'get');
    for (const recipients of [[ID.pending], [ID.stranger], [ID.bob], [], [ID.alice, Number.NaN]]) {
      await expectStudioError(h.studio.shareMemory(org.alice, agent.id, record.id, recipients), 400, /Choose people who can use this agent/);
    }
    expect(get).not.toHaveBeenCalled();
    get.mockRestore();
    await h.studio.setAccess(org.alice, agent.id, [ID.bob]);
    await h.studio.shareMemory(org.alice, agent.id, record.id, [ID.bob]);
    expect((await h.memory.memories.get(record.id))?.authorizedPersonIds).toEqual([personId(ID.alice), personId(ID.bob)].sort());
  });

  it('refuses broad sharing of personal and confidential memories', async () => {
    const { agent } = await hire(h, org.alice);
    for (const sensitivity of ['personal', 'confidential'] as const) {
      const record = await h.memory.memories.add(mem(agent.id, { content: 'sensitive', sensitivity, scope: { kind: 'private', personId: personId(ID.alice) } }));
      await expectStudioError(h.studio.shareMemory(org.alice, agent.id, record.id, [ID.bob]), 400);
      expect((await h.studio.memoriesFor(org.bob, agent.id)).map((m) => m.id)).not.toContain(record.id);
    }
  });
});
