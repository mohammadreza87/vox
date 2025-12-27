import { describe, it, expect } from 'vitest';
import {
  chatRequestSchema,
  ttsRequestSchema,
  translateRequestSchema,
  createChatRequestSchema,
  customContactSchema,
} from './schemas';

describe('chatRequestSchema', () => {
  it('validates a valid request', () => {
    const result = chatRequestSchema.safeParse({
      message: 'Hello, how are you?',
      contactId: 'alice-interview-coach',
      conversationHistory: [],
    });
    expect(result.success).toBe(true);
  });

  it('validates with optional fields', () => {
    const result = chatRequestSchema.safeParse({
      message: 'Tell me about React',
      contactId: 'marcus-startup-mentor',
      systemPrompt: 'You are a helpful mentor',
      conversationHistory: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ],
      aiProvider: 'gemini',
      aiModel: 'gemini-2.0-flash',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty message', () => {
    const result = chatRequestSchema.safeParse({
      message: '',
      contactId: 'test',
      conversationHistory: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('empty');
    }
  });

  it('rejects message over limit', () => {
    const result = chatRequestSchema.safeParse({
      message: 'a'.repeat(10001),
      contactId: 'test',
      conversationHistory: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('10,000');
    }
  });

  it('rejects invalid AI provider', () => {
    const result = chatRequestSchema.safeParse({
      message: 'Hello',
      contactId: 'test',
      conversationHistory: [],
      aiProvider: 'invalid-provider',
    });
    expect(result.success).toBe(false);
  });

  it('rejects conversation history over limit', () => {
    const history = Array.from({ length: 101 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }));
    const result = chatRequestSchema.safeParse({
      message: 'Hello',
      contactId: 'test',
      conversationHistory: history,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('100');
    }
  });
});

describe('ttsRequestSchema', () => {
  it('validates valid request', () => {
    const result = ttsRequestSchema.safeParse({
      text: 'Hello, world!',
    });
    expect(result.success).toBe(true);
  });

  it('validates with voiceId', () => {
    const result = ttsRequestSchema.safeParse({
      text: 'Hello, world!',
      voiceId: 'EXAVITQu4vr4xnSDxMaL',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty text', () => {
    const result = ttsRequestSchema.safeParse({
      text: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects text over limit', () => {
    const result = ttsRequestSchema.safeParse({
      text: 'a'.repeat(5001),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('5,000');
    }
  });
});

describe('translateRequestSchema', () => {
  it('validates valid request', () => {
    const result = translateRequestSchema.safeParse({
      text: 'Hello, how are you?',
      targetLanguage: 'Spanish',
      voiceId: 'abc123',
    });
    expect(result.success).toBe(true);
  });

  it('validates with source language', () => {
    const result = translateRequestSchema.safeParse({
      text: 'Hello',
      sourceLanguage: 'English',
      targetLanguage: 'French',
      voiceId: 'xyz789',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing target language', () => {
    const result = translateRequestSchema.safeParse({
      text: 'Hello',
      voiceId: 'abc123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing voice ID', () => {
    const result = translateRequestSchema.safeParse({
      text: 'Hello',
      targetLanguage: 'Spanish',
    });
    expect(result.success).toBe(false);
  });
});

describe('createChatRequestSchema', () => {
  it('validates valid request', () => {
    const result = createChatRequestSchema.safeParse({
      contactId: 'custom-contact-1',
      contactName: 'My Custom Bot',
    });
    expect(result.success).toBe(true);
  });

  it('validates with all optional fields', () => {
    const result = createChatRequestSchema.safeParse({
      contactId: 'custom-contact-1',
      contactName: 'My Custom Bot',
      contactEmoji: '🤖',
      contactImage: 'https://example.com/avatar.png',
      contactPurpose: 'A helpful assistant',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid image URL', () => {
    const result = createChatRequestSchema.safeParse({
      contactId: 'custom-contact-1',
      contactName: 'My Custom Bot',
      contactImage: 'not-a-valid-url',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('URL');
    }
  });
});

describe('customContactSchema', () => {
  it('validates valid custom contact', () => {
    const result = customContactSchema.safeParse({
      name: 'My Assistant',
      purpose: 'Help with coding',
      voiceId: 'voice-123',
    });
    expect(result.success).toBe(true);
  });

  it('validates with all fields', () => {
    const result = customContactSchema.safeParse({
      name: 'Code Buddy',
      purpose: 'Help with programming tasks',
      personality: 'Friendly and helpful',
      systemPrompt: 'You are a coding assistant...',
      voiceId: 'voice-abc',
      voiceName: 'Sam',
      avatarEmoji: '👨‍💻',
      avatarImage: 'https://example.com/avatar.png',
      category: 'productivity',
      gradient: 'from-blue-500 to-purple-500',
      aiProvider: 'gemini',
      aiModel: 'gemini-2.0-flash',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = customContactSchema.safeParse({
      name: 'My Assistant',
      // missing purpose and voiceId
    });
    expect(result.success).toBe(false);
  });

  it('rejects name over limit', () => {
    const result = customContactSchema.safeParse({
      name: 'a'.repeat(101),
      purpose: 'Test',
      voiceId: 'voice-123',
    });
    expect(result.success).toBe(false);
  });
});
