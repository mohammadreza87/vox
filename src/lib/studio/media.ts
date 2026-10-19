/**
 * Media providers for Studio:
 *  - OpenAI: avatar images (gpt-image) and speech-to-text (gpt-4o transcribe)
 *  - ElevenLabs: Voice Design, voice library, text-to-speech
 *
 * Plain fetch (injectable) so every call is testable offline.
 */

import type { AgentLook, PersonaSpec } from './types';
import type { VoiceService } from '../tireh/voice';

type FetchFn = typeof fetch;

const PALETTE: Record<string, [string, string, string, string]> = {
  apricot: ['Apricot', '#FFB38A', '#FFD9C2', '#E5835A'],
  rose: ['Rosé', '#FF9DB5', '#FFD1DD', '#E06A8A'],
  butter: ['Butter', '#FFE07A', '#FFF1BF', '#E0B23E'],
  matcha: ['Matcha', '#A8E07A', '#D7F5BF', '#6FB247'],
  lagoon: ['Lagoon', '#6FE0D0', '#BFF5EE', '#34AFA0'],
  sky: ['Sky', '#8CC8FF', '#CFE6FF', '#5294DC'],
  lilac: ['Lilac', '#C3A6FF', '#E6DBFF', '#8D6BDB'],
  ash: ['Ash', '#B9BEC8', '#E3E6EB', '#868C99'],
};

const SHAPES: Record<string, string> = {
  puff: 'Puff: wide, low, round soft lobes',
  tower: 'Tower: taller cumulus, flatter base, broad shoulders',
  drift: 'Drift: asymmetric lens-shaped',
};

const FACE: Record<string, string> = {
  feminine: 'soft cheek blush and two tiny lash ticks',
  masculine: 'short soft brow strokes',
  neutral: 'small cheek dots',
};

export function avatarPrompt(persona: PersonaSpec, look: AgentLook, variant = 0): string {
  const [colorName, base, light, shadow] = PALETTE[look.hue] ?? PALETTE.lilac;
  const expressions = ['gentle closed-mouth smile', 'curious, eyes slightly wide', 'happy, small open smile', 'calm and attentive'];
  return `A single cute minimal character: a soft cumulus cloud creature, ${SHAPES[look.family]} silhouette. Body colour ${colorName} ${base}, lit softly from the upper left so it lightens to ${light} and shades to ${shadow} at the lower right. Face: two glossy vertical oval eyes in near-black #1A1C22 with one small white highlight each, a small curved mouth, ${FACE[persona.presentation] ?? FACE.neutral}. Expression: ${expressions[variant % expressions.length]}. One small accessory hinting at their work as ${persona.role}: ${persona.avatarHint || 'none'}, simple and respectful, not a costume. Smooth matte vinyl-toy finish, subtle rim glow, centred, square, plain flat background #0E1013, generous padding.
Avoid: text, letters, logos, watermarks, emoji style, robots, circuits, gradient backgrounds, sparkles, realistic human features, noses, teeth, limbs, hands, gendered clothing stereotypes, religious or national symbols, caricature, multiple characters, busy backgrounds, photorealism, harsh outlines.`;
}

export class OpenAIMedia {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly imageModel = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1',
    private readonly sttModel = process.env.OPENAI_STT_MODEL ?? 'gpt-4o-mini-transcribe'
  ) {}

  /** Returns a JPEG (Telegram profile photos must be JPG). */
  async generateAvatar(prompt: string): Promise<Buffer> {
    const response = await this.fetchFn('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.imageModel, prompt, size: '1024x1024', n: 1, output_format: 'jpeg', quality: 'medium' }),
    });
    const json = (await response.json().catch(() => ({}))) as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
    const b64 = json.data?.[0]?.b64_json;
    if (!response.ok || !b64) throw new Error(`OpenAI image generation failed: ${json.error?.message ?? `HTTP ${response.status}`}`);
    return Buffer.from(b64, 'base64');
  }

  async transcribe(audio: ArrayBuffer, mimeType = 'audio/ogg', filename = 'voice.ogg'): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mimeType }), filename);
    form.append('model', this.sttModel);
    const response = await this.fetchFn('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    const json = (await response.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
    if (!response.ok) throw new Error(`OpenAI transcription failed: ${json.error?.message ?? `HTTP ${response.status}`}`);
    return (json.text ?? '').trim();
  }
}

export interface VoicePreview { generatedVoiceId: string; audio: Buffer; mediaType: string }
export interface LibraryVoice { voiceId: string; publicOwnerId: string; name: string; accent: string; gender: string; age: string; descriptive: string; language?: string; previewUrl?: string }

const XI = 'https://api.elevenlabs.io/v1';

export class ElevenLabsStudio {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly ttsModel = process.env.ELEVENLABS_TTS_MODEL ?? 'eleven_multilingual_v2'
  ) {}

  private headers(json = true): Record<string, string> {
    return json ? { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' } : { 'xi-api-key': this.apiKey };
  }

  async designVoices(description: string, sampleText?: string): Promise<VoicePreview[]> {
    const body: Record<string, unknown> = { voice_description: description, model_id: 'eleven_multilingual_ttv_v2' };
    if (sampleText && sampleText.length >= 100) body.text = sampleText.slice(0, 1000);
    else body.auto_generate_text = true;
    const response = await this.fetchFn(`${XI}/text-to-voice/design?output_format=mp3_44100_128`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as { previews?: Array<{ generated_voice_id: string; audio_base_64: string; media_type?: string }> };
    if (!response.ok || !json.previews) throw new Error(`ElevenLabs voice design failed: HTTP ${response.status}`);
    return json.previews.map((p) => ({ generatedVoiceId: p.generated_voice_id, audio: Buffer.from(p.audio_base_64, 'base64'), mediaType: p.media_type ?? 'audio/mpeg' }));
  }

  async saveDesignedVoice(generatedVoiceId: string, name: string, description: string): Promise<string> {
    const response = await this.fetchFn(`${XI}/text-to-voice`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ voice_name: name, voice_description: description, generated_voice_id: generatedVoiceId }),
    });
    const json = (await response.json().catch(() => ({}))) as { voice_id?: string };
    if (!response.ok || !json.voice_id) throw new Error(`ElevenLabs create voice failed: HTTP ${response.status}`);
    return json.voice_id;
  }

  async searchLibrary(filters: { gender?: string; age?: string; accent?: string; language?: string; search?: string }): Promise<LibraryVoice[]> {
    const params = new URLSearchParams({ page_size: '12' });
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    const response = await this.fetchFn(`${XI}/shared-voices?${params}`, { headers: this.headers(false) });
    const json = (await response.json().catch(() => ({}))) as { voices?: Array<Record<string, string>> };
    if (!response.ok) throw new Error(`ElevenLabs library search failed: HTTP ${response.status}`);
    return (json.voices ?? []).map((v) => ({
      voiceId: v.voice_id, publicOwnerId: v.public_owner_id, name: v.name, accent: v.accent, gender: v.gender,
      age: v.age, descriptive: v.descriptive, language: v.language, previewUrl: v.preview_url,
    }));
  }

  async addLibraryVoice(publicOwnerId: string, voiceId: string, name: string): Promise<string> {
    const response = await this.fetchFn(`${XI}/voices/add/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(voiceId)}`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ new_name: name }),
    });
    const json = (await response.json().catch(() => ({}))) as { voice_id?: string };
    if (!response.ok || !json.voice_id) throw new Error(`ElevenLabs add voice failed: HTTP ${response.status}`);
    return json.voice_id;
  }

  async speak(text: string, voiceId: string): Promise<Buffer> {
    const response = await this.fetchFn(`${XI}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { ...this.headers(), Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: text.slice(0, 2500), model_id: this.ttsModel, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    });
    if (!response.ok) throw new Error(`ElevenLabs TTS failed: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
}

/** Voice for the persona runtime: OpenAI hears, ElevenLabs speaks. */
export class StudioVoiceService implements VoiceService {
  constructor(private readonly openai: OpenAIMedia | null, private readonly eleven: ElevenLabsStudio | null) {}

  async transcribe(audio: ArrayBuffer, mimeType?: string): Promise<string> {
    if (!this.openai) throw new Error('OPENAI_API_KEY is not set');
    return this.openai.transcribe(audio, mimeType);
  }

  async synthesize(text: string, voiceId: string) {
    if (!this.eleven) throw new Error('ELEVENLABS_API_KEY is not set');
    const audio = await this.eleven.speak(text, voiceId);
    return { audio: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer, mimeType: 'audio/mpeg', filename: 'voice.mp3' };
  }
}
