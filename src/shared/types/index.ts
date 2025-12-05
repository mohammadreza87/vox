// Core types for Vox

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: Date;
}

export interface Contact {
  id: string;
  userId: string;
  name: string;
  purpose: string;
  personality: string;
  systemPrompt: string;
  voiceId: string;
  voiceName: string;
  avatarUrl: string;
  avatarEmoji: string;
  isPreMade: boolean;
  category: ContactCategory;
  lastChatAt: Date | null;
  createdAt: Date;
}

export type ContactCategory =
  | 'career'
  | 'education'
  | 'wellness'
  | 'productivity'
  | 'creative'
  | 'custom';

export type AIProvider = 'gemini' | 'claude' | 'openai' | 'deepseek';

export interface AIModelConfig {
  provider: AIProvider;
  model: string;
  name: string;
  description: string;
}

export const AI_MODELS: AIModelConfig[] = [
  // DeepSeek Models (Free tier default)
  { provider: 'deepseek', model: 'deepseek-chat', name: 'DeepSeek Chat', description: 'Open-source power' },
  { provider: 'deepseek', model: 'deepseek-reasoner', name: 'DeepSeek Reasoner', description: 'Deep reasoning (Max)' },
  // OpenAI Models (Pro tier default)
  { provider: 'openai', model: 'gpt-4o', name: 'GPT-4o', description: 'Most capable' },
  { provider: 'openai', model: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and affordable' },
  // Gemini Models
  { provider: 'gemini', model: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Fast and efficient' },
  { provider: 'gemini', model: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Advanced reasoning' },
  // Claude Models
  { provider: 'claude', model: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Balanced performance' },
  { provider: 'claude', model: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fast responses' },
];

export interface Message {
  id: string;
  contactId: string;
  role: 'user' | 'assistant';
  content: string;
  audioUrl: string | null;
  createdAt: Date;
}

export interface ChatSession {
  contactId: string;
  messages: Message[];
  isLoading: boolean;
  isRecording: boolean;
  isSpeaking: boolean;
}

export interface Chat {
  id: string;
  contactId: string;
  contactName: string;
  contactEmoji: string;
  contactImage?: string; // Custom avatar image URL
  contactPurpose: string;
  lastMessage: string;
  lastMessageAt: Date;
  messages: Message[];
}

export interface VoiceOption {
  id: string;
  name: string;
  previewUrl: string;
  category: 'male' | 'female' | 'neutral';
  accent: string;
  description: string;
}

export interface ClonedVoice {
  id: string;
  voiceId: string; // ElevenLabs voice ID
  name: string;
  createdAt: string;
}

// Pre-made contacts configuration
export interface PreMadeContactConfig {
  id: string;
  name: string;
  purpose: string;
  personality: string;
  systemPrompt: string;
  voiceId: string;
  voiceName: string;
  avatarEmoji: string;
  avatarImage?: string; // Optional custom avatar image URL
  category: ContactCategory;
  gradient: string;
  // AI Model configuration
  aiProvider?: AIProvider;
  aiModel?: string;
  // Custom contact fields
  isPreMade?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface GenerateResponseInput {
  contactId: string;
  message: string;
  conversationHistory: Message[];
}

export interface GenerateResponseOutput {
  content: string;
  audioUrl: string;
}

export interface TextToSpeechInput {
  text: string;
  voiceId: string;
}

export interface TextToSpeechOutput {
  audioUrl: string;
  duration: number;
}
