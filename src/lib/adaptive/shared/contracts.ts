/** Browser-safe explicit shared memory contracts. No implicit account/administrator access. */
export type SharedSpace = 'work' | 'personal';
export interface SharedRecipient { telegramId: number; personId: string }
export interface SharedPreviewInput { space: SharedSpace; kind: 'selected' | 'group'; recipientTelegramIds: number[]; groupId?: string }
export interface SharedPreview { previewToken: string; expiresAt: number; recipients: SharedRecipient[]; authorityRevision: string }
export interface SharedMutation { space: SharedSpace; eventId: string; expectedRevision: number }
export interface SharedCreateInput extends SharedMutation { previewToken: string; agentIds: string[]; text: string }
export interface SharedMemoryInput extends SharedMutation { text: string }
export interface SharedParticipantInput extends SharedMutation { revoked: true }
export interface SharedAgentInput extends SharedMutation { allowed: boolean }
export interface SharedMemoryView { id: string; revision: number; text: string; authorPersonId: string; createdAt: number; expiresAt: number }
export interface SharedContainerView {
  id: string; space: SharedSpace; kind: 'selected' | 'group'; groupId?: string; revision: number;
  ownerPersonId: string; recipients: (SharedRecipient & { active: boolean })[];
  agents: { agentId: string; allowed: boolean; revision: number }[];
  status: 'active' | 'audience_changed'; memories: SharedMemoryView[];
}
export interface SharedSnapshot { revision: number; space: SharedSpace; containers: SharedContainerView[] }
export interface SharedContext { revision: string; memories: { id: string; text: string; containerId: string }[] }
export interface SharedContextAudience { audienceTelegramIds: number[]; groupId?: string }
