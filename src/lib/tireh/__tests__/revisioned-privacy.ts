/**
 * A synthetic RuntimePrivacy whose state lives in a scope-aware store with an
 * in-process revision counter, so a gateway built with it takes the snapshot
 * and revision-compare path (the production Studio path) instead of the
 * per-recheck recompute.
 */
import { vi } from 'vitest';
import { PersonaGateway, type RuntimePrivacy, type RuntimePrivacyState } from '../gateway';
import { InMemoryUpdateDeduper } from '../memory/store';
import { activeReadScope } from '../privacy/read-scope';
import { InProcessRevisionSource, RevisionCounter } from '../privacy/revisions';
import { loadSnapshot } from '../privacy/snapshot';
import type { VoiceService } from '../voice';
import { makeGateway } from './fixtures';

export function revisionedPrivacy(initial: Partial<RuntimePrivacyState> = {}) {
  let state: RuntimePrivacyState = { revision: '1', memoryEnabled: true, historyEnabled: true, ...initial };
  let valid = true, failing = false;
  const counter = new RevisionCounter('synthetic-privacy');
  const owner = {};
  const readers: string[] = [];
  const load = async () => ({ value: { state, valid, failing }, probe: counter.probe('state') });
  const current = async () => {
    const scope = activeReadScope();
    return scope ? (await scope.document(owner, 'state', load)).value : (await load()).value;
  };
  const source = new InProcessRevisionSource();
  const privacy: RuntimePrivacy & { snapshot: NonNullable<RuntimePrivacy['snapshot']> } = {
    read: async (_persona: string, person: string) => {
      readers.push(person);
      const loaded = await current();
      if (loaded.failing) throw new Error('synthetic unavailable');
      return loaded.state;
    },
    validateAudience: async () => (await current()).valid,
    snapshot: (_request, evaluate) => loadSnapshot(() => current(), evaluate),
    revisions: source,
  };
  const snapshots = vi.spyOn(privacy, 'snapshot');
  const revisionReads = vi.spyOn(source, 'read');
  return {
    privacy, readers, snapshots, revisionReads,
    /** A committed privacy write: bumps the revision the turn compares. */
    change(next: Partial<RuntimePrivacyState>) { state = { ...state, ...next }; counter.bump('state'); },
    invalidateAudience() { valid = false; counter.bump('state'); },
    /** Consent reads fail from now on; audience validation still answers. */
    fail() { failing = true; counter.bump('state'); },
  };
}

/** makeGateway's stores and fakes, wired to a revisioned RuntimePrivacy. */
export function revisionedGateway(initial: Partial<RuntimePrivacyState> = {}, options: { voice?: VoiceService | null } = {}) {
  const ctx = makeGateway();
  const privacy = revisionedPrivacy(initial);
  const gateway = new PersonaGateway({
    ...ctx, voice: options.voice ?? null, deduper: new InMemoryUpdateDeduper(), botFor: () => ctx.bot as never,
    runtimePrivacy: privacy.privacy, logger: ctx.logger, now: () => new Date('2026-10-19T10:00:00Z'),
  });
  return { ...ctx, ...privacy, gateway };
}
