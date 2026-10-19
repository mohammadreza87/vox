import type { PredictInput, PredictionCancelInput, PredictionReply, PredictionValidateInput } from '../runtime/contracts';
export interface PredictionScope { space: 'work' | 'personal'; agentId: string; sessionId: string; turnId: string; contextKey: string }
export interface PredictionTransport {
  send(input: PredictInput, signal: AbortSignal): Promise<PredictionReply>;
  invalidate(input: PredictionCancelInput): Promise<unknown>;
  validate(input: PredictionValidateInput, signal: AbortSignal): Promise<{ valid: boolean }>;
}
export interface PredictionConsumerOptions extends PredictionTransport {
  onPrepared?: (result: PredictionReply | null) => void;
  debounceMs?: number;
  now?: () => number;
}
/** Partial text/image producer for a single active surface. No audio or identity
 * inference; no writes, tool execution or speaking hooks. contextKey correlates
 * UI audience/source changes; it never establishes server authority. */
export class LivePredictionConsumer {
  private scope?: PredictionScope;
  private revision = 0;
  private calls = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private active?: AbortController;
  private exported?: PredictionCancelInput;
  private prepared: PredictionReply | null = null;
  private readonly now: () => number;
  constructor(private readonly options: PredictionConsumerOptions) { this.now = options.now ?? Date.now; }
  startTurn(scope: PredictionScope): void { this.cancel(); this.scope = { ...scope }; this.revision = 0; this.calls = 0; }
  /** Call for every correction/source change. Only stable clauses are exported. */
  update(value: { text: string; image?: PredictInput['image']; stable: boolean; question?: PredictInput['question'] }): void {
    if (!this.scope) return;
    const old = this.exported; this.exported = undefined;
    this.stop(); this.revision++;
    if (old) void this.options.invalidate(old).catch(() => {});
    if (!value.stable || !value.text.trim() || this.calls >= 2) return;
    const input: PredictInput = { ...this.scope, revision: this.revision, text: value.text, image: value.image,
      question: value.question ?? (value.image ? 'image_route' : 'intent_route') };
    this.timer = setTimeout(() => { this.timer = undefined; void this.prepare(input); }, Math.max(0, this.options.debounceMs ?? 180));
  }
  private stop(): void {
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    this.active?.abort(); this.active = undefined;
    this.prepared = null; this.options.onPrepared?.(null);
  }
  cancel(): void {
    const scope = this.exported; this.exported = undefined;
    this.stop(); this.scope = undefined; this.revision++;
    if (scope) void this.options.invalidate(scope).catch(() => {});
  }
  /** Stop speculative export without inventing another logical turn/budget. */
  suspend(): void {
    const exported = this.exported; this.exported = undefined;
    this.stop(); this.revision++;
    if (exported) void this.options.invalidate(exported).catch(() => {});
  }
  snapshotTurn(): { sessionId: string; turnId: string; revision: number; contextKey: string } | undefined {
    if (!this.scope) return undefined;
    return { sessionId: this.scope.sessionId, turnId: this.scope.turnId, revision: this.revision, contextKey: this.scope.contextKey };
  }
  private matches(input: Pick<PredictInput, keyof PredictionScope | 'revision'>): boolean {
    return !!this.scope && input.revision === this.revision && Object.entries(this.scope).every(([key, value]) => input[key as keyof PredictionScope] === value);
  }
  private async prepare(input: PredictInput): Promise<void> {
    if (!this.matches(input) || this.calls >= 2) return;
    this.calls++; this.exported = { ...this.scope!, revision: input.revision }; const controller = new AbortController(); this.active = controller;
    try {
      const result = await this.options.send(input, controller.signal);
      if (controller.signal.aborted || !this.matches(input) || result.status !== 'answered' || !result.policyReceipt ||
          result.sessionId !== input.sessionId || result.turnId !== input.turnId || result.revision !== input.revision || result.contextKey !== input.contextKey ||
          result.questionVersion !== 'vox-semantic-v1' || !result.expiresAt || result.expiresAt <= this.now()) return;
      this.prepared = result; this.options.onPrepared?.(result);
    } catch { /* Baseline continues without a prediction. */ }
    finally { if (this.active === controller) this.active = undefined; }
  }
  /** Asynchronous final server check before consuming a prepared hint. Returns
   * null for revoked/expired/stale work. Actual retrieval must reauthorize sources. */
  async takePrepared(): Promise<PredictionReply | null> {
    const result = this.prepared, scope = this.scope && { ...this.scope, revision: this.revision };
    if (!result || !scope || !result.policyReceipt || !result.expiresAt || result.expiresAt <= this.now()) { this.prepared = null; return null; }
    const controller = new AbortController(); this.active?.abort(); this.active = controller;
    try {
      const response = await this.options.validate({ ...scope, policyReceipt: result.policyReceipt }, controller.signal);
      if (!response.valid || controller.signal.aborted || !this.matches(scope) || this.prepared !== result || result.expiresAt <= this.now()) return null;
      this.prepared = null; return result;
    } catch { return null; }
    finally {
      if (this.active === controller) this.active = undefined;
      if (this.prepared === result) { this.prepared = null; this.options.onPrepared?.(null); }
    }
  }
}
/** Uses the existing signed Telegram session. No provider key enters the browser. */
export function predictionHttpTransport(initData: () => string, fetcher: typeof fetch = fetch): PredictionTransport {
  const post = async (path: string, body: unknown, signal?: AbortSignal) => {
    const response = await fetcher(`/api/studio/experience/${path}`, { method: 'POST', credentials: 'same-origin', signal,
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData() }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('prediction_unavailable');
    return response.json();
  };
  return { send: (input, signal) => post('predict', input, signal), invalidate: input => post('prediction-cancel', input),
    validate: (input, signal) => post('prediction-validate', input, signal) };
}
