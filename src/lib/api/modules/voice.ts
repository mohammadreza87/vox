/**
 * Voice API Module
 * Handles TTS, voice cloning, and AI chat generation
 */

import { auth } from '@/lib/firebase';
import { api } from '../client';
import {
  TextToSpeechRequest,
  TextToSpeechResponse,
  CloneVoiceResponse,
  VoiceListResponse,
  GenerateRequest,
  GenerateResponse,
} from '../types';

// ============================================
// TEXT TO SPEECH
// ============================================

/**
 * Convert text to speech
 */
export async function textToSpeech(text: string, voiceId: string): Promise<string> {
  const response = await api.post<TextToSpeechResponse>('/api/tts', {
    text,
    voiceId,
  });
  return response.audioUrl;
}

/**
 * Stream text to speech (returns audio blob)
 */
export async function streamTTS(text: string, voiceId: string): Promise<Blob> {
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch('/api/tts/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ text, voiceId }),
  });

  if (!response.ok) {
    throw new Error('TTS streaming failed');
  }

  return response.blob();
}

// ============================================
// VOICE CLONING
// ============================================

/**
 * Clone a voice from audio file
 */
export async function cloneVoice(name: string, audioFile: File): Promise<CloneVoiceResponse> {
  const formData = new FormData();
  formData.append('name', name);
  formData.append('audio', audioFile);

  return api.upload<CloneVoiceResponse>('/api/voice/clone', formData);
}

/**
 * Get list of cloned voices
 */
export async function getClonedVoices(): Promise<VoiceListResponse> {
  return api.get<VoiceListResponse>('/api/voice/list');
}

/**
 * Delete a cloned voice
 */
export async function deleteClonedVoice(voiceId: string): Promise<void> {
  await api.delete(`/api/voice/${voiceId}`);
}

// ============================================
// AI CHAT GENERATION
// ============================================

/**
 * Generate AI response for a contact
 */
export async function generateResponse(
  contactId: string,
  message: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<GenerateResponse> {
  return api.post<GenerateResponse>('/api/generate', {
    contactId,
    message,
    conversationHistory,
  });
}

/**
 * Stream AI response (Server-Sent Events)
 */
export function streamResponse(
  contactId: string,
  message: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  onChunk: (chunk: string) => void,
  onComplete: (fullResponse: string) => void,
  onError: (error: Error) => void
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/generate/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          contactId,
          message,
          conversationHistory,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('Stream request failed');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        fullResponse += chunk;
        onChunk(chunk);
      }

      onComplete(fullResponse);
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        onError(error);
      }
    }
  })();

  // Return cancel function
  return () => controller.abort();
}
