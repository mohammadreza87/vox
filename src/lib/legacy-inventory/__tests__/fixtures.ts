import { LIMITS, type AdapterV1, type ManifestV1 } from '../contracts';

export const AT = '2026-10-20T00:00:00.000Z';
export const CANARY = 'PRIVATE_SYNTHETIC_شخصی_LIP1_DO_NOT_EMIT';
export const memoryFixture = (id = 'm1') => ({ id, personaId: 'agent-a', content: CANARY, type: 'fact', scope: { kind: 'private', personId: 'claimed-a' }, sensitivity: 'personal', source: { personId: 'claimed-b', chatKind: 'private', at: AT }, aboutPersonIds: ['subject-c'], confidence: 1, createdAt: AT, updatedAt: AT });
export const tirehMessage = () => ({ role: 'user', text: CANARY, at: AT });
export const appMessage = (id = 'message-a') => ({ id, contactId: 'contact-a', role: 'user', content: CANARY, audioUrl: `https://invalid.example/${CANARY}`, createdAt: AT });
export const factFixture = (key = 'same-fact') => ({ key, value: CANARY, source: 'chat', confidence: 0.9, extractedAt: AT });
export const studioFixture = () => ({
  members: [{ telegramId: 10, name: CANARY, role: 'owner', joinedAt: AT }],
  guests: [{ telegramId: 11, name: CANARY, firstSeen: AT }],
  agents: [{ id: 'studio-agent', status: 'active', persona: { name: CANARY, role: CANARY, personality: CANARY }, look: { hue: 'sky', family: 'puff', features: { cheeks: true, lashes: false, brows: false } }, createdBy: 10, createdAt: AT, isAdmin: true, access: 'everyone', visibility: 'public', identityVersion: 123, tokenEnc: CANARY, groupBehavior: { participation: 'active', remember: true } }],
  groups: [{ chatId: 12, title: CANARY, memberIds: [10], hasGuests: true, agentIds: ['studio-agent'], addedAt: AT, audienceEpoch: 2 }],
  audit: [{ at: AT, actor: 10, action: CANARY, detail: CANARY }],
  voiceAgent: { id: CANARY, llmUrl: `https://invalid.example/${CANARY}`, secretId: CANARY, version: 1 },
});
export const orgFixture = () => ({
  organization: { id: 'org-a', name: 'Personal Work' },
  people: [{ id: 'claimed-a', name: CANARY, role: 'owner', companyIds: ['company-a'], projectIds: ['project-a'] }],
  relationships: [{ a: 'claimed-a', b: 'claimed-b', label: CANARY }],
  companies: [{ id: 'company-a', name: CANARY }],
  projects: [{ id: 'project-a', name: CANARY, companyId: 'company-a', memberIds: ['claimed-a'] }],
  groups: [{ id: 'group-a', name: CANARY, telegramChatId: 12, memberIds: ['claimed-a'], hasGuests: true }],
  personas: [{ id: 'agent-a', name: CANARY, role: CANARY, personality: CANARY, communicationStyle: CANARY, values: [], voice: { elevenLabsVoiceId: CANARY, description: CANARY }, ownerId: 'claimed-a', identityVersion: 1, replyWithVoice: 'always', groupRemember: true }],
});
export interface FixtureSource { adapter: AdapterV1; payloads: unknown[] }
export function encodeFixtures(sources: FixtureSource[]) {
  const bytes = Buffer.from(sources.flatMap((s, source) => s.payloads.map((payload, unit) => JSON.stringify({ schema: 'vox.legacy-fixture-unit/1', source, unit, payload }) + '\n')).join(''));
  const manifest: ManifestV1 = { schema: 'vox.legacy-inventory-input/1', mode: 'synthetic-dry-run', policy: 'LIP1-deny-all-use', sources: sources.map((s, source) => ({ source, adapter: s.adapter, expectedUnits: s.payloads.length })), expectedTransportBytes: bytes.length };
  return { bytes, manifest };
}
export async function* chunks(bytes: Uint8Array, size = LIMITS.chunkBytes) { for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size); }
export function corpus(): FixtureSource[] {
  return [
    { adapter: 'tireh-file-state/1', payloads: [{ memories: [memoryFixture(), { ...memoryFixture(), content: 'different authored bytes' }], offers: [{ id: 'offer-a', personaId: 'agent-a', memoryId: 'm1', ownerPersonId: 'claimed-a', proposedScope: { kind: 'org' }, status: 'approved', createdAt: AT }], chats: { 'opaque-chat-key': [tirehMessage(), { ...tirehMessage(), role: 'assistant', privacy: { policyKey: CANARY, memoryRevision: 1, sourceEventIds: [CANARY], memoryIds: ['m1'] } }] }, revisions: { 'agent-a': 3 }, tombstones: { 'agent-a': [CANARY] }, epochs: { 'agent-a': 2 } }] },
    { adapter: 'tireh-document/1', payloads: [{ collection: 'tireh_memories', id: 'm1', data: memoryFixture() }] },
    { adapter: 'tireh-org-config/1', payloads: [orgFixture()] },
    { adapter: 'app-contact-memory/1', payloads: [{ userId: 'account-a', contactId: 'contact-a', data: { userId: 'account-a', contactId: 'contact-a', facts: [factFixture(), factFixture()], sessions: [{ id: 'session-a', date: AT, type: 'call', summary: CANARY, keyTopics: [CANARY], userMood: CANARY }], lastInteraction: { date: AT, type: 'chat', lastTopic: CANARY } } }] },
    { adapter: 'app-user/1', payloads: [{ userId: 'account-a', data: { email: CANARY, settings: { notifications: true } } }] },
    { adapter: 'app-chat/1', payloads: [{ chatId: 'chat-a', data: { userId: 'account-a', contactId: 'contact-a', lastMessage: CANARY }, messages: [{ id: 'msg-a', data: appMessage('msg-a') }, { id: 'msg-b', data: appMessage('msg-b') }] }] },
    { adapter: 'app-local-chats/1', payloads: [[{ id: 'local-chat-a', contactId: 'contact-a', contactName: CANARY, contactPurpose: 'Work Personal', lastMessage: CANARY, messages: [appMessage()] }]] },
    { adapter: 'studio-state/1', payloads: [studioFixture()] },
  ];
}
