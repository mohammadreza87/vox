/**
 * Translator API Module
 * Handles translation and translator TTS
 */

import { api } from '../client';
import { TranslateResponse, TranslatorTTSResponse } from '../types';

// ============================================
// TRANSLATION
// ============================================

/**
 * Translate text between languages
 */
export async function translate(
  text: string,
  sourceLanguage: string,
  targetLanguage: string
): Promise<{ translatedText: string; detectedLanguage?: string }> {
  return api.post<TranslateResponse>('/api/translator/translate', {
    text,
    sourceLanguage,
    targetLanguage,
  });
}

/**
 * Detect language of text
 */
export async function detectLanguage(text: string): Promise<string> {
  const response = await api.post<{ language: string }>('/api/translator/detect', {
    text,
  });
  return response.language;
}

// ============================================
// TRANSLATOR TTS
// ============================================

/**
 * Text to speech with translator voice
 */
export async function translatorTTS(
  text: string,
  language: string,
  voiceId?: string
): Promise<string> {
  const response = await api.post<TranslatorTTSResponse>('/api/translator/tts', {
    text,
    language,
    voiceId,
  });
  return response.audioUrl;
}

// ============================================
// TRANSLATOR HISTORY
// ============================================

interface TranslatorMessage {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  speaker: 'me' | 'other';
  timestamp: string;
}

interface TranslatorHistoryResponse {
  messages: TranslatorMessage[];
}

/**
 * Get translator conversation history
 */
export async function getTranslatorHistory(limit = 100): Promise<TranslatorMessage[]> {
  const response = await api.get<TranslatorHistoryResponse>(
    `/api/translator/history?limit=${limit}`
  );
  return response.messages;
}

/**
 * Save translator message
 */
export async function saveTranslatorMessage(
  message: Omit<TranslatorMessage, 'id'>
): Promise<TranslatorMessage> {
  return api.post<TranslatorMessage>('/api/translator/history', message);
}

/**
 * Clear translator history
 */
export async function clearTranslatorHistory(): Promise<void> {
  await api.delete('/api/translator/history');
}
