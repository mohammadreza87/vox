/**
 * Voice in/out for personas via ElevenLabs.
 *  - Speech-to-text: Scribe, accepts Telegram's OGG/Opus voice notes
 *  - Text-to-speech: MP3, which Telegram's sendVoice plays as a voice message
 */

/** Server-only authority. Never include this object in a provider payload. */
export interface ExportAuthority { authorizeNow?: () => boolean; signal?: AbortSignal }
export class ExportAuthorityError extends Error {
  constructor() { super('export_authority_changed'); this.name = 'ExportAuthorityError'; }
}
export function assertExportAuthority(authority: ExportAuthority = {}): void {
  if (authority.signal?.aborted) throw new ExportAuthorityError();
  if (authority.authorizeNow) {
    try {
      const result: unknown = authority.authorizeNow();
      if (result === true) return;
      // Reject asynchronous guards, but observe native Promise rejection so an
      // invalid adapter cannot create an unhandled rejection after this denial.
      try { Promise.prototype.then.call(result, () => undefined, () => undefined); } catch { /* Not a native Promise. */ }
    } catch { /* Fail closed. */ }
    throw new ExportAuthorityError();
  }
}

export interface VoiceService {
  /** Listening can be available even when no speech provider is configured. */
  readonly canSynthesize?: boolean;
  readonly committedExportFence?: true;
  transcribe(audio: ArrayBuffer, mimeType?: string): Promise<string>;
  synthesize(text: string, voiceId: string, authority?: ExportAuthority): Promise<{ audio: ArrayBuffer; mimeType: string; filename: string }>;
}

type FetchFn = typeof fetch;

const API = 'https://api.elevenlabs.io/v1';

export class ElevenLabsVoiceService implements VoiceService {
  readonly committedExportFence = true as const;
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly ttsModel = 'eleven_v4'
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

  async synthesize(text: string, voiceId: string, authority: ExportAuthority = {}) {
    const url = `${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
    const options: RequestInit = {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: text.slice(0, 2500),
        model_id: this.ttsModel,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    };
    assertExportAuthority(authority);
    const response = await this.fetchFn(url, {...options, signal: authority.signal});
    if (!response.ok) throw new Error(`ElevenLabs TTS failed: HTTP ${response.status}`);
    return { audio: await response.arrayBuffer(), mimeType: 'audio/mpeg', filename: 'voice.mp3' };
  }
}
