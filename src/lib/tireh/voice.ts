/**
 * Voice in/out for personas via ElevenLabs.
 *  - Speech-to-text: Scribe, accepts Telegram's OGG/Opus voice notes
 *  - Text-to-speech: MP3, which Telegram's sendVoice plays as a voice message
 */

export interface VoiceService {
  transcribe(audio: ArrayBuffer, mimeType?: string): Promise<string>;
  synthesize(text: string, voiceId: string): Promise<{ audio: ArrayBuffer; mimeType: string; filename: string }>;
}

type FetchFn = typeof fetch;

const API = 'https://api.elevenlabs.io/v1';

export class ElevenLabsVoiceService implements VoiceService {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly ttsModel = 'eleven_multilingual_v2'
  ) {}

  async transcribe(audio: ArrayBuffer, mimeType = 'audio/ogg'): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mimeType }), 'voice.ogg');
    form.append('model_id', 'scribe_v1');
    const response = await this.fetchFn(`${API}/speech-to-text`, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey },
      body: form,
    });
    if (!response.ok) throw new Error(`ElevenLabs STT failed: HTTP ${response.status}`);
    const json = (await response.json()) as { text?: string };
    return (json.text ?? '').trim();
  }

  async synthesize(text: string, voiceId: string) {
    const response = await this.fetchFn(`${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: text.slice(0, 2500),
        model_id: this.ttsModel,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!response.ok) throw new Error(`ElevenLabs TTS failed: HTTP ${response.status}`);
    return { audio: await response.arrayBuffer(), mimeType: 'audio/mpeg', filename: 'voice.mp3' };
  }
}
