import { LivePredictionConsumer, type PredictionTransport } from './client';

export type VoicePartialCapability =
  | { available: false; reason: 'client_event_configuration_unverified' | 'decisions_disabled' }
  | { available: true; configurationVersion: string };

/** Read only these two fields from the SDK's otherwise untrusted debug event.
 * Never log, persist or forward the raw event or any audio/agent response. */
export function tentativeTranscript(value: unknown): { eventId: number; text: string } | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if (event.type !== 'tentative_user_transcript' || !event.tentative_user_transcription_event ||
      typeof event.tentative_user_transcription_event !== 'object') return null;
  const data = event.tentative_user_transcription_event as Record<string, unknown>;
  if (typeof data.event_id !== 'number' || !Number.isSafeInteger(data.event_id) || data.event_id < 0 ||
      typeof data.user_transcript !== 'string' || data.user_transcript.length > 4096) return null;
  return { eventId: data.event_id, text: data.user_transcript.trim() };
}

/** An optional, ephemeral consumer for the installed ElevenLabs 0.12 SDK.
 * Results only prewarm authorized retrieval; nothing here selects identity,
 * speaks, executes tools, or promotes a prediction into the final user turn. */
export class VoicePartialConsumer {
  private readonly prediction: LivePredictionConsumer;
  private optedIn = false;
  private listening = true;
  private disposed = false;
  private activeId: number | undefined;
  private sealedThrough = -1;
  private text = '';
  private readonly qualified: boolean;
  constructor(options: PredictionTransport & {
    agentId: string; space: 'work' | 'personal'; sessionId: string;
    capability?: VoicePartialCapability; debounceMs?: number;
  }) {
    this.options = options;
    this.qualified = options.capability?.available === true && /^[A-Za-z0-9_-]{1,96}$/.test(options.capability.configurationVersion);
    this.prediction = new LivePredictionConsumer({ ...options, debounceMs: options.debounceMs ?? 250 });
  }
  private readonly options: PredictionTransport & {
    agentId: string; space: 'work' | 'personal'; sessionId: string; capability?: VoicePartialCapability;
  };
  setOptIn(value: boolean): void { this.cancel(); this.optedIn = value && this.qualified && !this.disposed; }
  setListening(value: boolean): void { if (!value) this.cancel(); this.listening = value; }
  onDebug(value: unknown): void {
    if (!this.optedIn || !this.listening || this.disposed) return;
    const partial = tentativeTranscript(value);
    if (!partial) {
      if (value && typeof value === 'object' && (value as Record<string, unknown>).type === 'tentative_user_transcript') this.cancel();
      return;
    }
    if (partial.eventId <= this.sealedThrough || this.activeId !== undefined && partial.eventId < this.activeId) return;
    if (this.activeId === undefined) {
      this.activeId = partial.eventId;
      this.prediction.startTurn({ agentId: this.options.agentId, space: this.options.space, sessionId: this.options.sessionId,
        turnId: `partial-${crypto.randomUUID()}`, contextKey: `voice-${this.options.capability?.available ? this.options.capability.configurationVersion : 'disabled'}` });
    }
    // Provider event IDs may advance for revisions of one spoken turn. Keep
    // the same local epoch/budget until a final/boundary, never reset per event.
    this.activeId = partial.eventId;
    if (partial.text === this.text) return;
    this.text = partial.text;
    this.prediction.update({ text: partial.text, stable: true });
  }
  /** The installed SDK drops final event_id. Seal the entire current epoch. */
  cancel(): void {
    if (this.activeId !== undefined) this.sealedThrough = Math.max(this.sealedThrough, this.activeId);
    this.activeId = undefined; this.text = ''; this.prediction.cancel();
  }
  finishTurn(): void { this.cancel(); this.listening = false; }
  dispose(): void { this.cancel(); this.optedIn = false; this.disposed = true; }
}
