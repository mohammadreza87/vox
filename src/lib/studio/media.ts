import { measureStage, unavailableUsage, captureUsage } from '../adaptive/observation/trace';
/**
 * Media providers for Studio:
 *  - OpenAI: avatar images (gpt-image) and speech-to-text (gpt-4o transcribe)
 *  - ElevenLabs: Voice Design, voice library, text-to-speech
 *
 * Plain fetch (injectable) so every call is testable offline.
 */

import type { AgentLook, PersonaSpec } from './types';
import { assertExportAuthority, type ExportAuthority, type VoiceService } from '../tireh/voice';
import type { DecisionAnswer, DecisionQuestion } from '../tireh/triage';
import { logTelegramDiagnostic } from '../tireh/telegram/diagnostics';

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
    private readonly sttModel = process.env.OPENAI_STT_MODEL ?? 'gpt-4o-mini-transcribe',
    private readonly decisionModel = process.env.OPENAI_DECISION_MODEL ?? 'gpt-6-luna'
  ) {}

  /**
   * Answers independent questions about one input with the Decisions API:
   * fast, and billed for input only. Refused or malformed answers are left out.
   */
  async decide(input: string, questions: DecisionQuestion[], timeoutMs = 10_000): Promise<Record<string, DecisionAnswer>> {
    return measureStage('decisions', async () => {
      try { return await this.decideObserved(input, questions, timeoutMs); }
      catch (error) { unavailableUsage('openai', 'gpt'); throw error; }
    }, result => Object.keys(result).length ? 'succeeded' : 'unknown');
  }
  private async decideObserved(input: string, questions: DecisionQuestion[], timeoutMs: number): Promise<Record<string, DecisionAnswer>> {
    const response = await this.fetchFn('https://api.openai.com/v1/decisions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.decisionModel, input, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await response.json().catch(() => ({}))) as { answers?: Array<Record<string, unknown>>; usage?: { input_tokens?: unknown } };
    if (!response.ok) throw new Error(`OpenAI decision failed: HTTP ${response.status}`);
    captureUsage('openai', 'gpt', () => ({ inputTokens: json.usage?.input_tokens }));
    const answers: Record<string, DecisionAnswer> = {};
    for (const a of json.answers ?? []) {
      const name = typeof a.name === 'string' ? a.name : '';
      const confidence = typeof a.confidence === 'number' ? a.confidence : 0;
      if (a.type === 'predicate' && typeof a.probability === 'number') answers[name] = { type: 'predicate', probability: a.probability };
      else if (a.type === 'choice' && typeof a.choice === 'string') answers[name] = { type: 'choice', choice: a.choice, confidence };
      else if (a.type === 'score' && typeof a.score === 'number') answers[name] = { type: 'score', score: a.score, confidence };
    }
    return answers;
  }

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
    return measureStage('stt', async () => { try { return await this.transcribeObserved(audio, mimeType, filename); }
      catch (error) { unavailableUsage('openai', 'unknown'); throw error; } });
  }
  private async transcribeObserved(audio: ArrayBuffer, mimeType: string, filename: string): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mimeType }), filename);
    form.append('model', this.sttModel);
    const response = await this.fetchFn('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    const json = (await response.json().catch(() => ({}))) as { text?: string; error?: { message?: string }; usage?: { type?: string; input_tokens?: unknown; output_tokens?: unknown } };
    if (!response.ok) throw new Error(`OpenAI transcription failed: ${json.error?.message ?? `HTTP ${response.status}`}`);
    captureUsage('openai', 'unknown', () => json.usage?.type === 'tokens' ? { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens } : {});
    return (json.text ?? '').trim();
  }
}

export interface VoicePreview { generatedVoiceId: string; audio: Buffer; mediaType: string }
export interface VerifiedVoiceLanguage { language: string; modelId: string; accent?: string; locale?: string; previewUrl?: string }
export interface LibraryVoice {
  voiceId: string; publicOwnerId: string; name: string; accent: string; gender: string; age: string; descriptive: string;
  language?: string; previewUrl?: string; category?: string; description?: string;
  verifiedLanguages?: VerifiedVoiceLanguage[]; rate?: number; freeUsersAllowed?: boolean;
}
export interface VoiceModelOption {
  id: string; name: string; languages: Array<{ code: string; name: string }>; persian: boolean;
  kind: 'quality' | 'realtime' | 'legacy';
}
export interface DefaultVoice { voiceId: string; name: string; gender?: string; accent?: string; language?: string; previewUrl?: string }
export interface VoiceOptions { models: VoiceModelOption[]; defaultVoices: DefaultVoice[]; tier: string; libraryAllowed: boolean; ttsModel: string }

export type ElevenLabsErrorCode = 'payment_required' | 'quota_exceeded' | 'permission_denied' | 'rate_limited' | 'unavailable' | 'provider_error';
const ELEVENLABS_MESSAGES: Record<ElevenLabsErrorCode, string> = {
  payment_required: 'This voice needs a paid ElevenLabs subscription. Upgrade the connected account, then try again.',
  quota_exceeded: 'The connected ElevenLabs account has used its voice credits. Add credits or wait for the next billing period.',
  permission_denied: 'The connected ElevenLabs account does not have permission for this voice request.',
  rate_limited: 'ElevenLabs is receiving too many requests. Please try again in a minute.',
  unavailable: 'ElevenLabs is temporarily unavailable. Please try again.',
  provider_error: 'ElevenLabs could not complete this voice request. Please try again.',
};

/** Only fixed public messages escape the adapter; provider bodies may contain credentials. */
export class ElevenLabsSpeechError extends Error {
  constructor(readonly status: number, readonly code: ElevenLabsErrorCode) {
    super(ELEVENLABS_MESSAGES[code]);
    this.name = 'ElevenLabsSpeechError';
  }

  /** Next instrumentation and route bundles can load separate class instances. */
  static is(error: unknown): error is ElevenLabsSpeechError {
    if (!error || typeof error !== 'object') return false;
    const value = error as { name?: unknown; status?: unknown; code?: unknown };
    return value.name === 'ElevenLabsSpeechError'
      && typeof value.status === 'number' && Number.isInteger(value.status) && value.status >= 400 && value.status <= 599
      && typeof value.code === 'string' && Object.hasOwn(ELEVENLABS_MESSAGES, value.code);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function str(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined; }
function providerError(status: number, body: unknown): ElevenLabsSpeechError {
  const json = record(body), detail = record(json.detail), error = record(json.error);
  const codes = [detail.status, detail.code, detail.type, error.status, error.code, json.status, json.code];
  const has = (...values: string[]) => codes.some((code) => typeof code === 'string' && values.includes(code));
  const code: ElevenLabsErrorCode = has('quota_exceeded', 'insufficient_credits', 'character_limit_exceeded') ? 'quota_exceeded'
    : status === 402 || has('payment_required', 'paid_plan_required', 'subscription_required', 'free_users_not_allowed') ? 'payment_required'
      : status === 429 || has('rate_limited', 'rate_limit_exceeded', 'too_many_concurrent_requests') ? 'rate_limited'
        : status === 401 || status === 403 || has('missing_permissions', 'permission_denied', 'invalid_api_key') ? 'permission_denied'
          : status >= 500 ? 'unavailable' : 'provider_error';
  return new ElevenLabsSpeechError(status, code);
}

const XI = 'https://api.elevenlabs.io/v1';

export class ElevenLabsStudio {
  readonly committedTtsExportFence = true as const;
  private optionsCache?: { expiresAt: number; value: VoiceOptions };
  private optionsRequest?: Promise<VoiceOptions>;

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly ttsModel = process.env.ELEVENLABS_TTS_MODEL ?? 'eleven_v4'
  ) {}

  private headers(json = true): Record<string, string> {
    return json ? { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' } : { 'xi-api-key': this.apiKey };
  }

  private async request(url: string, init: RequestInit, authority?: ExportAuthority): Promise<Response> {
    assertExportAuthority(authority);
    try { return await this.fetchFn(url, authority ? {...init, signal: authority.signal} : init); }
    catch { throw new ElevenLabsSpeechError(503, 'unavailable'); }
  }

  private async json<T>(response: Response): Promise<T> {
    const json: unknown = await response.json().catch(() => undefined);
    if (!response.ok) throw providerError(response.status, json);
    if (json === undefined || json === null) throw new ElevenLabsSpeechError(502, 'provider_error');
    return json as T;
  }

  /** Provider-verified choices and account access; no voice is created or added. */
  async getVoiceOptions(): Promise<VoiceOptions> {
    if (this.optionsCache && this.optionsCache.expiresAt > Date.now()) return structuredClone(this.optionsCache.value);
    if (!this.optionsRequest) {
      this.optionsRequest = this.loadVoiceOptions().then((value) => {
        this.optionsCache = { value, expiresAt: Date.now() + 60_000 };
        return value;
      }).finally(() => { this.optionsRequest = undefined; });
    }
    return structuredClone(await this.optionsRequest);
  }

  private async getJson<T>(url: string): Promise<T> {
    return this.json<T>(await this.request(url, { method: 'GET', headers: this.headers(false), signal: AbortSignal.timeout(10_000) }));
  }

  private async loadVoiceOptions(): Promise<VoiceOptions> {
    const [rawModels, subscription, defaultVoices] = await Promise.all([
      this.getJson<unknown>(`${XI}/models`),
      // An unknown subscription must never grant paid-library access.
      this.getJson<unknown>(`${XI}/user/subscription`).catch(() => undefined),
      this.listDefaultVoices(),
    ]);
    if (!Array.isArray(rawModels)) throw new ElevenLabsSpeechError(502, 'provider_error');
    const models = rawModels.flatMap((value): VoiceModelOption[] => {
      const model = record(value), id = str(model.model_id);
      if (!id || model.can_do_text_to_speech !== true) return [];
      const languages = (Array.isArray(model.languages) ? model.languages : []).flatMap((value) => {
        const language = record(value), code = str(language.language_id), name = str(language.name);
        return code && name ? [{ code, name }] : [];
      });
      const modern = /^eleven_v\d+(?:_|$)/.test(id);
      return [{ id, name: str(model.name) ?? id, languages, persian: languages.some((l) => l.code === 'fa'),
        kind: modern ? /_(turbo|conversational)$/.test(id) ? 'realtime' : 'quality' : 'legacy' }];
    });
    const tier = str(record(subscription).tier)?.trim().toLowerCase() ?? 'unknown';
    const libraryAllowed = ['starter', 'creator', 'pro', 'scale', 'business', 'enterprise', 'growing_business', 'independent_publisher'].includes(tier);
    return { models, defaultVoices, tier, libraryAllowed, ttsModel: this.ttsModel };
  }

  private async listDefaultVoices(): Promise<DefaultVoice[]> {
    const voices = new Map<string, DefaultVoice>(), seen = new Set<string>();
    let token: string | undefined;
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({ voice_type: 'default', page_size: '100' });
      if (token) params.set('next_page_token', token);
      const json = await this.getJson<Record<string, unknown>>(`https://api.elevenlabs.io/v2/voices?${params}`);
      if (!Array.isArray(json.voices)) throw new ElevenLabsSpeechError(502, 'provider_error');
      for (const value of json.voices) {
        const voice = record(value), labels = record(voice.labels), voiceId = str(voice.voice_id), name = str(voice.name);
        if (voiceId && name) voices.set(voiceId, { voiceId, name, gender: str(labels.gender), accent: str(labels.accent), language: str(labels.language), previewUrl: str(voice.preview_url) });
      }
      if (json.has_more !== true) return [...voices.values()];
      token = str(json.next_page_token);
      if (!token || seen.has(token)) throw new ElevenLabsSpeechError(502, 'provider_error');
      seen.add(token);
    }
    throw new ElevenLabsSpeechError(502, 'provider_error');
  }

  async designVoices(description: string, sampleText?: string): Promise<VoicePreview[]> {
    const body: Record<string, unknown> = { voice_description: description, model_id: 'eleven_ttv_v3' };
    if (sampleText && sampleText.length >= 100) body.text = sampleText.slice(0, 1000);
    else body.auto_generate_text = true;
    const response = await this.request(`${XI}/text-to-voice/design?output_format=mp3_44100_128`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(body),
    });
    const json = await this.json<{ previews?: Array<{ generated_voice_id: string; audio_base_64: string; media_type?: string }> }>(response);
    if (!Array.isArray(json.previews) || !json.previews.length || json.previews.some((p) => !str(p.generated_voice_id) || !str(p.audio_base_64))) throw new ElevenLabsSpeechError(502, 'provider_error');
    return json.previews.map((p) => ({ generatedVoiceId: p.generated_voice_id, audio: Buffer.from(p.audio_base_64, 'base64'), mediaType: p.media_type ?? 'audio/mpeg' }));
  }

  async saveDesignedVoice(generatedVoiceId: string, name: string, description: string): Promise<string> {
    const response = await this.request(`${XI}/text-to-voice`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ voice_name: name, voice_description: description, generated_voice_id: generatedVoiceId }),
    });
    const json = await this.json<{ voice_id?: string }>(response);
    if (!str(json.voice_id)) throw new ElevenLabsSpeechError(502, 'provider_error');
    return json.voice_id!;
  }

  async searchLibrary(filters: { gender?: string; age?: string; accent?: string; language?: string; search?: string; category?: string }): Promise<LibraryVoice[]> {
    const params = new URLSearchParams({ page_size: '12' });
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    const response = await this.request(`${XI}/shared-voices?${params}`, { headers: this.headers(false) });
    const json = await this.json<{ voices?: unknown[] }>(response);
    if (!Array.isArray(json.voices)) throw new ElevenLabsSpeechError(502, 'provider_error');
    return json.voices.flatMap((value): LibraryVoice[] => {
      const v = record(value), voiceId = str(v.voice_id), publicOwnerId = str(v.public_owner_id), name = str(v.name);
      if (!voiceId || !publicOwnerId || !name) return [];
      const verifiedLanguages = Array.isArray(v.verified_languages) ? v.verified_languages.flatMap((value): VerifiedVoiceLanguage[] => {
        const verified = record(value), language = str(verified.language), modelId = str(verified.model_id);
        return language && modelId ? [{ language, modelId, accent: str(verified.accent), locale: str(verified.locale), previewUrl: str(verified.preview_url) }] : [];
      }) : undefined;
      return [{ voiceId, publicOwnerId, name, accent: str(v.accent) ?? '', gender: str(v.gender) ?? '',
        age: str(v.age) ?? '', descriptive: str(v.descriptive) ?? '', language: str(v.language), previewUrl: str(v.preview_url),
        category: str(v.category), description: str(v.description), verifiedLanguages,
        rate: typeof v.rate === 'number' && Number.isFinite(v.rate) ? v.rate : undefined,
        freeUsersAllowed: typeof v.free_users_allowed === 'boolean' ? v.free_users_allowed : undefined }];
    });
  }

  async addLibraryVoice(publicOwnerId: string, voiceId: string, name: string): Promise<string> {
    const response = await this.request(`${XI}/voices/add/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(voiceId)}`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ new_name: name }),
    });
    const json = await this.json<{ voice_id?: string }>(response);
    if (!str(json.voice_id)) throw new ElevenLabsSpeechError(502, 'provider_error');
    return json.voice_id!;
  }

  async speak(text: string, voiceId: string, authority?: ExportAuthority): Promise<Buffer> {
    return measureStage('tts', async () => { try { return await this.speakObserved(text, voiceId, authority); }
      finally { unavailableUsage('elevenlabs', 'eleven'); } });
  }
  private async speakObserved(text: string, voiceId: string, authority?: ExportAuthority): Promise<Buffer> {
    const response = await this.request(`${XI}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { ...this.headers(), Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: text.slice(0, 2500), model_id: this.ttsModel, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    }, authority);
    if (!response.ok) throw providerError(response.status, await response.json().catch(() => undefined));
    if (!/^audio\//i.test(response.headers.get('content-type') ?? '')) throw new ElevenLabsSpeechError(502, 'provider_error');
    let audio: Buffer;
    try { audio = Buffer.from(await response.arrayBuffer()); }
    catch { throw new ElevenLabsSpeechError(503, 'unavailable'); }
    if (!audio.length) throw new ElevenLabsSpeechError(502, 'provider_error');
    return audio;
  }

  /** Speech-to-text (Scribe), so voice messages work without OpenAI. */
  async transcribe(audio: ArrayBuffer, mimeType = 'audio/ogg'): Promise<string> {
    return measureStage('stt', async () => { try { return await this.transcribeObserved(audio, mimeType); }
      finally { unavailableUsage('elevenlabs', 'scribe'); } });
  }
  private async transcribeObserved(audio: ArrayBuffer, mimeType: string): Promise<string> {
    const form = new FormData();
    form.append('model_id', process.env.ELEVENLABS_STT_MODEL ?? 'scribe_v1');
    form.append('file', new Blob([audio], { type: mimeType }), mimeType.includes('mp4') ? 'voice.m4a' : mimeType.includes('webm') ? 'voice.webm' : 'voice.ogg');
    const response = await this.request(`${XI}/speech-to-text`, { method: 'POST', headers: this.headers(false), body: form });
    const json = await this.json<{ text?: string }>(response);
    if (typeof json.text !== 'string') throw new ElevenLabsSpeechError(502, 'provider_error');
    return (json.text ?? '').trim();
  }

  // ---- Live voice (ElevenLabs Agents) ----

  private async convai<T>(path: string, init: RequestInit): Promise<T> {
    return this.json<T>(await this.request(`${XI}/convai${path}`, { ...init, headers: this.headers(init.method !== undefined && init.method !== 'GET') }));
  }

  /** Stores the key ElevenLabs sends to our custom LLM endpoint. */
  async createSecret(name: string, value: string): Promise<string> {
    const json = await this.convai<{ secret_id?: string }>('/secrets', { method: 'POST', body: JSON.stringify({ type: 'new', name, value }) });
    if (!json.secret_id) throw new ElevenLabsSpeechError(502, 'provider_error');
    return json.secret_id;
  }

  async createAgent(config: VoiceAgentConfig): Promise<string> {
    const json = await this.convai<{ agent_id?: string }>('/agents/create', { method: 'POST', body: JSON.stringify(voiceAgentBody(config)) });
    if (!json.agent_id) throw new ElevenLabsSpeechError(502, 'provider_error');
    return json.agent_id;
  }

  async updateAgent(agentId: string, config: VoiceAgentConfig): Promise<void> {
    await this.convai(`/agents/${encodeURIComponent(agentId)}`, { method: 'PATCH', body: JSON.stringify(voiceAgentBody(config)) });
  }

  /** Read-only qualification of the exact provider version used for optional
   * provisional text. No agent configuration, prompt or secret leaves here.
   * https://elevenlabs.io/docs/api-reference/agents/get */
  async partialTranscriptVersion(agentId: string, expected: { llmUrl: string; secretId: string }): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    try {
      const raw = await Promise.race([this.convai<unknown>(`/agents/${encodeURIComponent(agentId)}`, { method: 'GET', signal: controller.signal }),
        new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, 400); })]);
      const config = record(raw), conversation = record(config.conversation_config), prompt = record(record(conversation.agent).prompt);
      const llm = record(prompt.custom_llm), events = record(conversation.conversation).client_events;
      const version = str(config.version_id);
      if (config.agent_id !== agentId || !version || !/^[A-Za-z0-9_-]{1,96}$/.test(version) || prompt.llm !== 'custom-llm' ||
          llm.url !== expected.llmUrl || record(llm.api_key).secret_id !== expected.secretId || !Array.isArray(events) ||
          !['audio', 'agent_response', 'user_transcript', 'interruption', 'tentative_user_transcript'].every(event => events.includes(event))) return null;
      return version;
    } catch { return null; }
    finally { if (timer) clearTimeout(timer); }
  }

  /** A short-lived URL the browser uses to start one conversation. */
  async signedUrl(agentId: string, versionId?: string): Promise<string> {
    const version = versionId ? `&version_id=${encodeURIComponent(versionId)}` : '';
    const json = await this.convai<{ signed_url?: string }>(`/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}${version}`, {});
    if (!json.signed_url) throw new ElevenLabsSpeechError(502, 'provider_error');
    return json.signed_url;
  }
}

/**
 * ElevenLabs default voices, so agents without a designed voice can still
 * send voice messages and take calls.
 */
const DEFAULT_VOICES: Record<string, string> = {
  feminine: 'EXAVITQu4vr4xnSDxMaL', // Sarah
  masculine: 'JBFqnCBsd6RMkjVDRZzb', // George
  neutral: 'SAz9YHcvj6GT2YYXdXww', // River
};

export function defaultVoiceId(presentation?: string): string {
  return DEFAULT_VOICES[presentation ?? ''] ?? DEFAULT_VOICES.neutral;
}

export interface VoiceAgentConfig {
  name: string;
  /** Our OpenAI-compatible endpoint that answers in character */
  llmUrl: string;
  llmSecretId: string;
  maxCallSeconds: number;
}

/**
 * One ElevenLabs agent serves every Studio agent: ElevenLabs does the
 * listening, turn-taking and speaking (low-latency Flash voices), and asks our
 * endpoint what to say, so personas, memories and privacy stay ours. The voice,
 * language and greeting are chosen per call.
 */
export function voiceAgentBody(c: VoiceAgentConfig) {
  return {
    name: c.name,
    conversation_config: {
      agent: {
        first_message: '',
        language: 'en',
        prompt: {
          prompt: 'The persona and everything it knows come from the custom LLM.',
          llm: 'custom-llm',
          max_tokens: 300,
          custom_llm: { url: c.llmUrl, model_id: 'vox-persona', api_key: { secret_id: c.llmSecretId } },
        },
      },
      tts: { model_id: 'eleven_flash_v2_5' },
      conversation: { max_duration_seconds: c.maxCallSeconds },
    },
    platform_settings: {
      overrides: {
        conversation_config_override: { agent: { first_message: true, language: true }, tts: { voice_id: true } },
        custom_llm_extra_body: true,
      },
    },
  };
}

/** Voice for the persona runtime: OpenAI hears, ElevenLabs speaks. */
export class StudioVoiceService implements VoiceService {
  constructor(private readonly openai: OpenAIMedia | null, private readonly eleven: ElevenLabsStudio | null) {}

  get canSynthesize(): boolean { return !!this.eleven; }
  get committedExportFence(): true | undefined { return this.eleven?.committedTtsExportFence; }

  /** OpenAI hears when configured; ElevenLabs Scribe covers for it. */
  async transcribe(audio: ArrayBuffer, mimeType?: string): Promise<string> {
    if (!this.openai) {
      if (!this.eleven) throw new Error('Voice messages need OPENAI_API_KEY or ELEVENLABS_API_KEY');
      return this.eleven.transcribe(audio, mimeType);
    }
    try {
      return await this.openai.transcribe(audio, mimeType);
    } catch (error) {
      if (!this.eleven) throw error;
      logTelegramDiagnostic(console, 'transcription_fallback');
      return this.eleven.transcribe(audio, mimeType);
    }
  }

  async synthesize(text: string, voiceId: string, authority?: ExportAuthority) {
    if (!this.eleven) throw new Error('ELEVENLABS_API_KEY is not set');
    const audio = await this.eleven.speak(text, voiceId, authority);
    return { audio: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer, mimeType: 'audio/mpeg', filename: 'voice.mp3' };
  }
}
