/**
 * Voice Service Interface
 * Defines business logic operations for voice/TTS functionality
 */

export interface TTSRequest {
  text: string;
  voiceId: string;
  modelId?: string;
}

export interface TTSResponse {
  audioUrl: string;
  audioBlob?: Blob;
}

export interface CloneVoiceRequest {
  audioBlob: Blob;
  name: string;
  description?: string;
}

export interface CloneVoiceResponse {
  voiceId: string;
  name: string;
}

export interface TranslateRequest {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  voiceId?: string;
}

export interface TranslateResponse {
  translatedText: string;
  audioUrl?: string;
}

export interface IVoiceService {
  /**
   * Convert text to speech
   */
  textToSpeech(request: TTSRequest): Promise<TTSResponse>;

  /**
   * Stream text to speech (for real-time audio)
   */
  streamTextToSpeech(
    request: TTSRequest,
    onChunk: (audioChunk: ArrayBuffer) => void
  ): Promise<void>;

  /**
   * Clone a voice from audio sample
   */
  cloneVoice(request: CloneVoiceRequest): Promise<CloneVoiceResponse>;

  /**
   * Delete a cloned voice
   */
  deleteClonedVoice(voiceId: string): Promise<void>;

  /**
   * Get available voices
   */
  getAvailableVoices(): Promise<Array<{ id: string; name: string; category: string }>>;

  /**
   * Translate text with optional TTS
   */
  translate(request: TranslateRequest): Promise<TranslateResponse>;
}
