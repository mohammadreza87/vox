import { IndexedStorageError } from '../persistence/indexed/contracts';
import { AdaptiveError, type AdaptiveService } from '../persistence/service';
import { accountIdFor, type AdaptiveDocument, type SpaceKind } from '../persistence/repository';
import { productPauseCommandSchema, productPauseSpaceSchema, type ProductPauseCommandResult, type ProductPauseStatus } from './contracts';
import { applyProductPauseCommand, productPauseUseState, ProductPauseConflict } from './state';

/** Account identity comes exclusively from the authenticated server caller. No
 * client owner/person/clock input is accepted. Receipts are management data only. */
export class ProductPauseService {
  constructor(private readonly adaptive: AdaptiveService) {}
  private prepared(d: AdaptiveDocument): boolean {
    return this.adaptive.repository.storage.canonicalSchemaVersion === 2 && d.schemaVersion === 2;
  }
  private status(d: AdaptiveDocument, space: SpaceKind, now: number): ProductPauseStatus {
    const available = this.prepared(d), state = productPauseUseState(d, space);
    return { version: 1, accountId: d.accountId, space, available, ...(available ? state : { productPaused: null, useEpoch: null, reason: 'store_not_prepared' }),
      ...(available ? { commandSeq: d.productPause!.scopes[space === 'work' ? 0 : 1].commandSeq, ...(d.productPause!.scopes[space === 'work' ? 0 : 1].latest ? { latest: d.productPause!.scopes[space === 'work' ? 0 : 1].latest } : {}) } : {}),
      canPause: available, canResume: available && this.adaptive.isCoreAllowed(d, now) };
  }
  read(telegramId: number, space: SpaceKind): Promise<ProductPauseStatus> {
    productPauseSpaceSchema.parse(space);
    const result = this.adaptive.readCommittedAuthorityForEffect(telegramId, undefined, (d, now) => {
      const status = this.status(d, space, now);
      return { value: status, ...(status.canResume ? { deadline: Math.min(d.binding!.expiresAt, this.adaptive.capabilityStatus(d, 'core_text', now).validUntil ?? Number.MAX_SAFE_INTEGER) } : { denied: true }) };
    });
    if (result.status === 'missing' && this.adaptive.repository.storage.canonicalSchemaVersion === 2) return Promise.resolve({ version: 1, accountId: accountIdFor(telegramId), space, available: true, productPaused: false, useEpoch: 0, commandSeq: 0, canPause: true, canResume: false });
    return Promise.resolve(result.status === 'ready' ? result.value : { version: 1, accountId: accountIdFor(telegramId), space, available: false, productPaused: null, useEpoch: null, reason: result.status, canPause: false, canResume: false });
  }
  async command(telegramId: number, raw: unknown, beforeCommit?: () => void): Promise<ProductPauseCommandResult> {
    const input = productPauseCommandSchema.parse(raw);
    let draft: AdaptiveDocument | undefined, changed = false;
    const authorize = (d: AdaptiveDocument, now: number): void => {
      if (!this.prepared(d)) throw new AdaptiveError(409, 'product_pause_unavailable');
      if (input.action === 'resume' && !this.adaptive.isCoreAllowed(d, now)) throw new AdaptiveError(403, 'profile_confirmation_required');
    };
    try {
      const result = await this.adaptive.productPauseTransaction(telegramId, (d, now) => {
        draft = d; authorize(d, now);
        const transition = applyProductPauseCommand(d.productPause!, d.accountId, input, now);
        if (!transition.replayed) {
          if (d.revision === Number.MAX_SAFE_INTEGER) throw new AdaptiveError(409, 'revision_exhausted');
          d.productPause = transition.pause; d.revision++; d.updatedAt = now;
          changed = transition.receipt.result === 'changed';
          if (changed) {
            // Bounded transient cancellation only removes rows, so a full content
            // envelope cannot prevent establishing the reserved protective stop.
            // Saved directives, undo, primary relationship sources and reminders remain.
            const learning = d.experience.preferenceLearning;
            if (learning) {
              learning.presentations = learning.presentations.filter(r => r.space !== input.space);
              learning.intents = learning.intents.filter(r => r.space !== input.space);
              learning.candidates = learning.candidates.filter(r => r.space !== input.space);
              if (!learning.presentations.length && !learning.intents.length && !learning.candidates.length && !learning.suppressions.length) delete d.experience.preferenceLearning;
            }
            d.experience.predictionTurns = d.experience.predictionTurns.filter(r => r.space !== input.space);
          }
        }
        return { status: this.status(d, input.space, now), receipt: transition.receipt, replayed: transition.replayed };
      }, () => { if (!draft) throw new AdaptiveError(503, 'product_pause_unavailable');
        authorize(draft, this.adaptive.sampleServiceClock()); beforeCommit?.(); });
      if (changed) this.adaptive.notifyProductPauseCommitted(telegramId);
      try { return { ...result, status: await this.read(telegramId, input.space) }; }
      catch (error) { throw new IndexedStorageError(error instanceof IndexedStorageError ? error.reason : 'denied', true); }
    } catch (error) {
      if (changed) this.adaptive.notifyProductPauseCommitted(telegramId);
      if (error instanceof ProductPauseConflict) throw new AdaptiveError(409, error.code);
      throw error;
    }
  }
}
