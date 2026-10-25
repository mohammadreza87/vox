/**
 * Self-echo guard (S11L). ElevenLabs clones fool speaker-verification models
 * (docs/AGENT_INTELLIGENCE_SOLUTION.md section 2.4) and Vox generates
 * ElevenLabs persona voices itself, so audio that matches any persona voice
 * is rejected. Echo templates come from fixed phrases spoken by each persona
 * voice; they are cached in memory only, keyed by voice and model version.
 * Neither the synthetic audio nor the templates are persisted. Fail closed:
 * until every current voice is cached, templates() returns null.
 */
import type { VoiceprintProvider } from './provider';

/** Fixed constant text (one EN and one FA sentence, each about 6 to 8 s of speech). Never user content. */
export const SELF_ECHO_PHRASES: readonly string[] = [
  'This short sample is read by one of our own assistant voices, so that our recordings are never mistaken for a person on the team.',
  'این نمونهٔ کوتاه را یکی از صداهای دستیار خودمان می‌خواند تا ضبط‌های ما هرگز با صدای یکی از اعضای تیم اشتباه گرفته نشود.',
];

export interface SelfEchoSource {
  /** null = not ready (fail closed) */
  templates(signal: AbortSignal): Promise<readonly { id: string; template: Uint8Array }[] | null>;
  warm(signal?: AbortSignal): Promise<void>;
}

export class PersonaVoiceEchoSource implements SelfEchoSource {
  private readonly cache = new Map<string, readonly Uint8Array[]>();
  private flight?: Promise<void>;
  private readonly phrases: readonly string[];

  constructor(private readonly o: {
    voiceIds: () => Promise<readonly string[]>;
    synthesize: (text: string, voiceId: string) => Promise<Uint8Array>;
    provider: VoiceprintProvider;
    phrases?: readonly string[];
  }) {
    this.phrases = o.phrases ?? SELF_ECHO_PHRASES;
  }

  private key(voiceId: string): string { return `${voiceId}|${this.o.provider.modelVersion}`; }

  async templates(signal: AbortSignal): Promise<readonly { id: string; template: Uint8Array }[] | null> {
    if (signal.aborted) return null;
    let voiceIds: readonly string[];
    try { voiceIds = [...new Set(await this.o.voiceIds())]; } catch { return null; }
    if (!voiceIds.length) return [];
    const cached = voiceIds.map(v => this.cache.get(this.key(v)));
    if (cached.some(c => !c)) {
      void this.warm().catch(() => undefined);
      return null;
    }
    // Copies: callers may zero-fill what they receive.
    return cached.flatMap(list => list!).map((template, n) => ({ id: `echo-${n}`, template: new Uint8Array(template) }));
  }

  /** Single-flight; per-voice errors are swallowed and that voice stays uncached. */
  warm(signal?: AbortSignal): Promise<void> {
    this.flight ??= this.fill(signal).finally(() => { this.flight = undefined; });
    return this.flight;
  }

  private async fill(signal?: AbortSignal): Promise<void> {
    let voiceIds: readonly string[];
    try { voiceIds = [...new Set(await this.o.voiceIds())]; } catch { return; }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      for (const voiceId of voiceIds) {
        if (signal?.aborted) return;
        const key = this.key(voiceId);
        if (this.cache.has(key)) continue;
        try {
          const templates: Uint8Array[] = [];
          for (const phrase of this.phrases) {
            const audio = await this.o.synthesize(phrase, voiceId);
            try { templates.push(await this.o.provider.voiceprint(audio, 'audio/mpeg', controller.signal)); } finally { audio.fill(0); }
          }
          if (templates.length) this.cache.set(key, templates);
        } catch { /* stays uncached: templates() keeps failing closed */ }
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
