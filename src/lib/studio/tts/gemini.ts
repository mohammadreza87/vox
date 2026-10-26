/**
 * Gemini text-to-speech behind the SpeechSynthesizer seam (design PET_CARE_GAME_DESIGN_2026_10_26 §8A.3), selected by
 * STUDIO_TTS_PROVIDER=gemini. Plain fetch (injectable), no SDK.
 *
 * Request shape, as Google's speech-generation page documents it (fetched 26 October 2026): a unary POST to the
 * Interactions API (`/v1beta/interactions`) with the model, one `user_input` text item, `response_format: audio` and
 * `generation_config.speech_config: [{ voice }]`. Gemini 3.8 TTS speaks the `text` field verbatim, so the
 * natural-language style note is NOT prepended to the text (it would be read aloud); the page puts it in a
 * `speech_metadata` annotation on the text item (`style`), and that is where it goes.
 *
 * Output: the page says unary calls return 24 kHz mono 16-bit PCM in a RIFF/WAV container; a headerless PCM payload
 * (`audio/l16`, the streaming default) is wrapped in a WAV header here, so callers always get `audio/wav`.
 *
 * Errors carry only fixed codes (the same set as ElevenLabsSpeechError): provider bodies may echo credentials or the
 * text. Text and audio are never logged. The export fence (`authorizeNow`) is checked before the text leaves and again
 * before the audio is released, as ElevenLabs does, so this adapter may speak replies built from indexed context.
 */

import { assertExportAuthority } from '../../tireh/voice';
import { SpeechUnavailableError, type SpeechOptions, type SpeechResult, type SpeechSynthesizer } from './types';

type FetchFn = typeof fetch;

export const GEMINI_TTS_DEFAULT_MODEL = 'gemini-3.8-flash-tts';
/**
 * Default prebuilt voice when the agent has none of its own (STUDIO_GEMINI_TTS_VOICE overrides). "Achird" is listed
 * as "Friendly": warm without the high energy of Puck/Fenrir, which suits a small character that talks to colleagues.
 * A bake-off candidate, not a verdict.
 */
export const GEMINI_TTS_DEFAULT_VOICE = 'Achird';
/** The prebuilt voices on Google's speech-generation page (26 October 2026). */
export const GEMINI_PREBUILT_VOICES: readonly string[] = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus',
  'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar',
  'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
];
export const GEMINI_TTS_DEADLINE_MS = 10_000;
/** The same cut ElevenLabs makes (media.ts speak); sentence pieces are far shorter. */
const MAX_TEXT_CHARS = 2500;
const MAX_STYLE_CHARS = 400;
const API = 'https://generativelanguage.googleapis.com/v1beta/interactions';

export const PCM_SAMPLE_RATE = 24_000;
export const PCM_CHANNELS = 1;
export const PCM_BITS = 16;

export type GeminiSpeechErrorCode = 'payment_required' | 'quota_exceeded' | 'permission_denied' | 'rate_limited' | 'unavailable' | 'provider_error';
const MESSAGES: Record<GeminiSpeechErrorCode, string> = {
  payment_required: 'Gemini speech needs billing enabled on the connected Google project.',
  quota_exceeded: 'The connected Google project has used its Gemini speech quota.',
  permission_denied: 'The connected Google API key does not have permission for Gemini speech.',
  rate_limited: 'Gemini speech is receiving too many requests. Please try again in a minute.',
  unavailable: 'Gemini speech is temporarily unavailable. Please try again.',
  provider_error: 'Gemini could not complete this speech request. Please try again.',
};

/** Only fixed public messages escape the adapter. Branded by name, like ElevenLabsSpeechError (separate bundles). */
export class GeminiSpeechError extends Error {
  constructor(readonly status: number, readonly code: GeminiSpeechErrorCode) {
    super(MESSAGES[code]);
    this.name = 'GeminiSpeechError';
  }
  static is(error: unknown): error is GeminiSpeechError {
    if (!error || typeof error !== 'object') return false;
    const v = error as { name?: unknown; status?: unknown; code?: unknown };
    return v.name === 'GeminiSpeechError' && typeof v.status === 'number' && typeof v.code === 'string' && Object.hasOwn(MESSAGES, v.code);
  }
}

const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** Google's error envelope `{ error: { code, status, message } }` to a fixed code; the message is never read. */
export function geminiError(status: number, body: unknown): GeminiSpeechError {
  const e = record(record(body).error);
  const s = typeof e.status === 'string' ? e.status : '';
  const code: GeminiSpeechErrorCode = s === 'RESOURCE_EXHAUSTED' || status === 429 ? 'rate_limited'
    : status === 402 || s === 'FAILED_PRECONDITION' ? 'payment_required'
      : status === 401 || status === 403 || s === 'PERMISSION_DENIED' || s === 'UNAUTHENTICATED' ? 'permission_denied'
        : status >= 500 || s === 'UNAVAILABLE' || s === 'DEADLINE_EXCEEDED' ? 'unavailable' : 'provider_error';
  return new GeminiSpeechError(status >= 400 && status <= 599 ? status : 502, code);
}

/** A canonical 44-byte RIFF/WAVE header for 16-bit PCM, followed by the samples. */
export function pcmToWav(pcm: Buffer, sampleRate = PCM_SAMPLE_RATE, channels = PCM_CHANNELS, bits = PCM_BITS): Buffer {
  const blockAlign = channels * bits / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const isWav = (b: Buffer) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE';

/**
 * The base64 audio in a response: the Interactions shape (`steps[].content[]` with `type: audio`, the last one wins,
 * as the docs' jq filter does) or, defensively, the generateContent shape (`candidates[].content.parts[].inlineData`).
 */
export function audioOf(body: unknown): { data: string; mimeType?: string } | null {
  const found: { data: string; mimeType?: string }[] = [];
  const steps = record(body).steps;
  for (const step of Array.isArray(steps) ? steps : []) {
    const s = record(step);
    if (s.type !== undefined && s.type !== 'model_output') continue;
    for (const item of Array.isArray(s.content) ? s.content : []) {
      const c = record(item);
      if (c.type === 'audio' && typeof c.data === 'string') found.push({ data: c.data, ...(typeof c.mime_type === 'string' ? { mimeType: c.mime_type } : typeof c.mimeType === 'string' ? { mimeType: c.mimeType } : {}) });
    }
  }
  const candidates = record(body).candidates;
  for (const cand of Array.isArray(candidates) ? candidates : []) {
    const parts = record(record(cand).content).parts;
    for (const part of Array.isArray(parts) ? parts : []) {
      const inline = record(record(part).inlineData ?? record(part).inline_data);
      if (typeof inline.data === 'string') found.push({ data: inline.data, ...(typeof inline.mimeType === 'string' ? { mimeType: inline.mimeType } : {}) });
    }
  }
  return found.length ? found[found.length - 1] : null;
}

/** `audio/L16;rate=…` (or a WAV) names its sample rate; everything else is the documented 24 kHz. */
const rateOf = (mimeType?: string) => {
  const m = mimeType?.match(/rate=(\d{4,6})/i);
  return m ? Number(m[1]) : PCM_SAMPLE_RATE;
};

export interface GeminiSpeechConfig {
  apiKey: string;
  model?: string;
  /** used when the caller passes no voice name (or one the docs do not list) */
  defaultVoice?: string;
  deadlineMs?: number;
  fetchFn?: FetchFn;
}

export class GeminiSpeechSynthesizer implements SpeechSynthesizer {
  readonly provider = 'gemini' as const;
  readonly canSynthesize = true;
  readonly committedTtsExportFence = true as const;
  readonly model: string;
  readonly defaultVoice: string;
  private readonly deadlineMs: number;
  private readonly fetchFn: FetchFn;

  constructor(private readonly config: GeminiSpeechConfig) {
    this.model = config.model?.trim() || GEMINI_TTS_DEFAULT_MODEL;
    this.defaultVoice = voiceName(config.defaultVoice) ?? GEMINI_TTS_DEFAULT_VOICE;
    this.deadlineMs = config.deadlineMs ?? GEMINI_TTS_DEADLINE_MS;
    this.fetchFn = config.fetchFn ?? fetch;
  }

  /** The request body for one utterance (exported shape for tests; never logged). */
  body(text: string, voice: string, style?: string): Record<string, unknown> {
    const note = style?.replace(/\s+/g, ' ').trim().slice(0, MAX_STYLE_CHARS);
    return {
      model: this.model,
      input: [{ type: 'user_input', content: [{ type: 'text', text: text.slice(0, MAX_TEXT_CHARS),
        ...(note ? { annotations: [{ type: 'speech_metadata', style: note }] } : {}) }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: voiceName(voice) ?? this.defaultVoice }] },
    };
  }

  /** `voice` is a Gemini prebuilt voice name (Agent.voice.gemini.voiceName); empty means the default voice. */
  async speak(text: string, voice: string, opts: SpeechOptions = {}): Promise<SpeechResult> {
    const authority = { ...(opts.authorizeNow ? { authorizeNow: opts.authorizeNow } : {}), ...(opts.signal ? { signal: opts.signal } : {}) };
    assertExportAuthority(authority);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.deadlineMs);
    const onAbort = () => controller.abort();
    if (opts.signal?.aborted) controller.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      let response: Response;
      try {
        response = await this.fetchFn(API, {
          method: 'POST',
          headers: { 'x-goog-api-key': this.config.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(this.body(text, voice, opts.style)),
          signal: controller.signal,
        });
      } catch { throw new GeminiSpeechError(timedOut ? 504 : 503, 'unavailable'); }
      let json: unknown;
      try { json = await response.json(); } catch {
        throw timedOut || controller.signal.aborted ? new GeminiSpeechError(timedOut ? 504 : 503, 'unavailable') : new GeminiSpeechError(502, 'provider_error');
      }
      if (!response.ok) throw geminiError(response.status, json);
      const found = audioOf(json);
      if (!found) throw new GeminiSpeechError(502, 'provider_error');
      const bytes = Buffer.from(found.data, 'base64');
      if (!bytes.length) throw new GeminiSpeechError(502, 'provider_error');
      const audio = isWav(bytes) ? bytes : pcmToWav(bytes.length % 2 ? bytes.subarray(0, bytes.length - 1) : bytes, rateOf(found.mimeType));
      assertExportAuthority(authority);
      return { audio, mimeType: 'audio/wav' };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }
}

/** A listed prebuilt voice name (case-insensitive), in its documented spelling, or null. */
export function voiceName(name: string | undefined): string | null {
  const n = name?.trim().toLowerCase();
  return n ? GEMINI_PREBUILT_VOICES.find((v) => v.toLowerCase() === n) ?? null : null;
}

/** Gemini selected without a key: honest about it, never able to speak (the pet answers in text). */
export const GEMINI_TTS_NO_KEY = 'Gemini speech (STUDIO_TTS_PROVIDER=gemini) needs GEMINI_API_KEY (or GOOGLE_API_KEY). Pet voice replies stay text.';
export class UnconfiguredGeminiSynthesizer implements SpeechSynthesizer {
  readonly provider = 'gemini' as const;
  readonly canSynthesize = false;
  async speak(): Promise<SpeechResult> { throw new SpeechUnavailableError(GEMINI_TTS_NO_KEY); }
}

/** The Gemini synthesizer from the environment: GEMINI_API_KEY (fallback GOOGLE_API_KEY), model and default voice. */
export function geminiFromEnv(env: NodeJS.ProcessEnv = process.env, fetchFn?: FetchFn): SpeechSynthesizer {
  const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
  if (!apiKey) return new UnconfiguredGeminiSynthesizer();
  return new GeminiSpeechSynthesizer({ apiKey, model: env.STUDIO_GEMINI_TTS_MODEL, defaultVoice: env.STUDIO_GEMINI_TTS_VOICE, ...(fetchFn ? { fetchFn } : {}) });
}
