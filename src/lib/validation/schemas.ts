import { z } from 'zod';

// ============================================
// Chat API Schemas
// ============================================

export const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(10000, 'Message content too long (max 10,000 characters)'),
});

export const chatRequestSchema = z.object({
  message: z
    .string()
    .min(1, 'Message cannot be empty')
    .max(10000, 'Message too long (max 10,000 characters)'),
  contactId: z.string().min(1, 'Contact ID is required'),
  systemPrompt: z.string().max(5000, 'System prompt too long (max 5,000 characters)').optional(),
  conversationHistory: z
    .array(messageSchema)
    .max(100, 'Conversation history too long (max 100 messages)')
    .default([]),
  aiProvider: z.enum(['deepseek', 'gemini', 'claude', 'openai']).optional(),
  aiModel: z.string().max(100).optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

// ============================================
// TTS API Schemas
// ============================================

export const ttsRequestSchema = z.object({
  text: z
    .string()
    .min(1, 'Text cannot be empty')
    .max(5000, 'Text too long for TTS (max 5,000 characters)'),
  voiceId: z.string().min(1).max(100).optional(),
});

export type TTSRequest = z.infer<typeof ttsRequestSchema>;

// ============================================
// Translate API Schemas
// ============================================

export const translateRequestSchema = z.object({
  text: z
    .string()
    .min(1, 'Text cannot be empty')
    .max(5000, 'Text too long (max 5,000 characters)'),
  sourceLanguage: z.string().max(50).optional(),
  targetLanguage: z.string().min(1, 'Target language is required').max(50),
  voiceId: z.string().max(100).optional(), // Optional - uses default if not provided
});

export type TranslateRequest = z.infer<typeof translateRequestSchema>;

// ============================================
// Chat V2 API Schemas
// ============================================

export const createChatRequestSchema = z.object({
  contactId: z.string().min(1, 'Contact ID is required'),
  contactName: z.string().min(1, 'Contact name is required').max(100),
  contactEmoji: z.string().max(10).optional(),
  contactImage: z.string().url('Invalid image URL').optional(),
  contactPurpose: z.string().max(500).optional(),
});

export type CreateChatRequest = z.infer<typeof createChatRequestSchema>;

export const createMessageRequestSchema = z.object({
  role: z.enum(['user', 'assistant'], { message: 'Role must be "user" or "assistant"' }),
  content: z
    .string()
    .min(1, 'Content cannot be empty')
    .max(10000, 'Content too long (max 10,000 characters)'),
  audioUrl: z.string().optional(),
});

export type CreateMessageRequest = z.infer<typeof createMessageRequestSchema>;

export const updateChatRequestSchema = z.object({
  contactName: z.string().min(1).max(100).optional(),
  contactEmoji: z.string().max(10).optional(),
  contactImage: z.string().url('Invalid image URL').optional(),
  contactPurpose: z.string().max(500).optional(),
});

export type UpdateChatRequest = z.infer<typeof updateChatRequestSchema>;

// ============================================
// Custom Contact Schemas
// ============================================

export const customContactSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  purpose: z.string().min(1, 'Purpose is required').max(500),
  personality: z.string().max(2000, 'Personality too long (max 2,000 characters)').optional(),
  systemPrompt: z.string().max(5000, 'System prompt too long (max 5,000 characters)').optional(),
  voiceId: z.string().min(1, 'Voice ID is required').max(100),
  voiceName: z.string().max(100).optional(),
  avatarEmoji: z.string().max(10).optional(),
  avatarImage: z.string().url('Invalid image URL').optional(),
  category: z.string().max(50).optional(),
  gradient: z.string().max(200).optional(),
  aiProvider: z.enum(['deepseek', 'gemini', 'claude', 'openai']).optional(),
  aiModel: z.string().max(100).optional(),
});

export type CustomContactInput = z.infer<typeof customContactSchema>;

// ============================================
// Clone Voice API Schemas
// ============================================

export const cloneVoiceRequestSchema = z.object({
  name: z.string().min(1, 'Voice name is required').max(100),
  // Note: audioFile is handled separately as FormData
});

export type CloneVoiceRequest = z.infer<typeof cloneVoiceRequestSchema>;

// ============================================
// Stripe API Schemas
// ============================================

export const createCheckoutRequestSchema = z.object({
  priceId: z.string().min(1, 'Price ID is required'),
});

export type CreateCheckoutRequest = z.infer<typeof createCheckoutRequestSchema>;

// ============================================
// Translator Messages Schemas
// ============================================

export const translatorMessageSchema = z.object({
  sourceText: z.string().min(1).max(5000),
  translatedText: z.string().min(1).max(5000),
  sourceLanguage: z.string().min(1).max(50),
  targetLanguage: z.string().min(1).max(50),
  speaker: z.enum(['user', 'ai']),
  audioUrl: z.string().optional(),
});

export type TranslatorMessageInput = z.infer<typeof translatorMessageSchema>;

// ============================================
// Query Parameter Schemas
// ============================================

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

export const syncQuerySchema = z.object({
  since: z.coerce.number().int().min(0).optional(),
});

export type SyncQueryParams = z.infer<typeof syncQuerySchema>;

// ============================================
// Sync Request Schemas
// ============================================

export const syncMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(10000),
  audioUrl: z.string().url().nullable().optional(),
  createdAt: z.string().min(1),
});

export const syncChatSchema = z.object({
  id: z.string().min(1),
  contactId: z.string().min(1),
  contactName: z.string().min(1).max(100),
  contactEmoji: z.string().max(10).optional(),
  contactImage: z.string().url().optional(),
  contactPurpose: z.string().max(500).optional(),
  lastMessage: z.string().max(1000).optional(),
  lastMessageAt: z.string().min(1).optional(),
  messages: z.array(syncMessageSchema).max(500).default([]),
  isDeleted: z.boolean().optional(),
});

export const syncRequestSchema = z.object({
  lastSyncAt: z.string().datetime().optional(),
  localChats: z.array(syncChatSchema).max(100).optional(),
});

export type SyncRequest = z.infer<typeof syncRequestSchema>;
