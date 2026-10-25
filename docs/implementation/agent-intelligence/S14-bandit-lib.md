# S14: Reply-style procedural memory library (not wired)

Thompson-sampling bandit, composite reward, file and Firestore stores.

- Base commit: `6d00b8066e5d8e8d444bb47d978aa571e20929df`.
- Plan: `docs/AGENT_INTELLIGENCE_SOLUTION.md` section 2.6 (Personalisation), section 4.10 and the Step 14 row of section 5. The gate for wiring is that the DPIA covers behavioural adaptation.
- Merge order: S14 goes first. It touches only new files plus one appended README section.

## Goal

Add a pure, unwired library at `src/lib/adaptive/personalization/procedural.ts`: a Beta-Bernoulli Thompson-sampling bandit over low-risk reply-style arms, keyed by (personId, personaId, space, route).

- Precedence is explicitRequestThisTurn > explicitStoredPreference > sampledArm > personaDefault. Stored preferences follow `resolvePreferences` semantics: only a resolved source of `'explicit'` pins a dimension.
- The reward is composite. A bare reply, or a non-corrective follow-up with no strong signal, never changes a posterior.
- Pseudo-counts decay toward the Beta(1,1) prior with a 90-day half-life.
- Reset and consent withdrawal delete the stored rows.
- Each sampled choice writes a content-free offline-evaluation row `{context, armChosen, propensity, unchosenArms, reward}`.
- There are in-memory, file and Firestore stores (`vox_reply_style` for posteriors, `vox_reply_style_eval` for evaluation rows).
- Every read, sample or learn path passes the `optional.personalization` gate, which the caller supplies through an `authorize` callback.

Nothing is wired: `gateway.ts`, `runtime.ts`, `studio/service.ts`, `prompt.ts` and `personalization/index.ts` are untouched. There is no flag, and production behaviour is byte-identical to the base.

## Files

| Path | Change |
|---|---|
| `src/lib/adaptive/personalization/procedural.ts` | new: types, constants, strict zod row and signal schemas, the `ReplyStyleStore` interface, pure helpers and `ReplyStyleBandit` |
| `src/lib/adaptive/personalization/procedural-store.ts` | new: `InMemoryReplyStyleStore`, `FileReplyStyleStore`, `FirestoreReplyStyleStore` |
| `src/lib/adaptive/personalization/procedural.test.ts` | new vitest suite |
| `src/lib/adaptive/decisions/README.md` | append one final section only |

### procedural.ts

Imports: `z` from `zod`; `createHash` and `randomUUID` from `node:crypto`; `import type { ResolvedPreference } from './index'`. No store implementation, gateway, studio, firebase or LLM import, no I/O except through the injected store, no logging.

**Arms** (canonical orders):

- `DIMENSION_ORDER = ['length','register','structure','closingQuestion','modality','language']`.
- `ARMS`: length `brief|balanced|detailed`; register `formal|informal`; structure `plain|steps`; closingQuestion `no|yes`; modality `text|voice-default`; language `fa|en|mixed`.
- `DEFAULT_DIMENSIONS = ['length','register','structure','closingQuestion']`, the 4 lowest-risk dimensions. modality and language are opt-in through `options.dimensions`.
- The constructor validates `options.dimensions`: 4 to 6 distinct members of `DIMENSION_ORDER`, otherwise `RangeError('reply_style_dimensions')`.
- `DEFAULT_REPLY_STYLE = {length:'balanced', register:'informal', structure:'plain', closingQuestion:'no', modality:'text', language:'auto'}`. `'auto'` (mirror the user) is a valid style value but never an arm.

**Precedence** (pure `resolveReplyStyle`): for every dimension, the first available of explicitThisTurn (`explicit_turn`), stored (`explicit_stored`), sampled (`sampled`), personaDefault (`persona_default`), `DEFAULT_REPLY_STYLE` (`persona_default`).

- `styleFromPreferences(resolved)` uses only entries with `source === 'explicit'`: response_length → length; formatting plain → structure `plain`, structured → `steps`; language en → `en`, fa → `fa`, auto → nothing. `hypothesis`, `reset` and `default` never pin; after a reset the bandit may sample again.
- `explicitRequestFromTurn(style?, format?)`, with plain string unions (no S09 import): brief → `{length:'brief'}`; detailed → `{length:'detailed'}`; step_by_step → `{structure:'steps'}`; listening → `{length:'brief', closingQuestion:'no'}`; format voice → modality `voice-default`; format text → modality `text`; unspecified or undefined → `{}`.
- A pinned dimension (explicit_turn or explicit_stored) is never sampled, never logged as an arm choice and never updated by a reward.

**The gate**

- `choose()` samples only when `chatKind === 'private'`, `guestAudience === false` and `await deps.authorize(scope) === true` (a throw counts as false). The group and guest checks run before authorize, so authorize is not called for them.
- When the gate fails: no store read, no sampling, no evaluation row, and stored preferences are ignored (fail closed). Only explicitThisTurn and the persona default apply.
- `settle()` re-runs authorize on the exposure's scope before any posterior write. If it fails: no posterior change, and the evaluation row is marked settled with reward null and rewardKinds `[]`.
- `reset()` and `withdraw()` are never gated: deletion is always allowed.
- `posteriors()` is the "Why this?" view. It is not gated by consent; the caller must pass an authenticated scope.

**Sampling**

- `sampleBeta(alpha, beta, rng)` uses Marsaglia–Tsang gamma variates with Box–Muller normals from the injected rng; shapes below 1 use the `u^(1/a)` boost.
- For each enabled, non-pinned dimension in `DIMENSION_ORDER`: one draw per arm in `ARMS` order, argmax chosen (ties to the first arm); then `propensitySamples` (default 256) further rounds count wins per arm; `propensity[dim] = (wins[chosen] + 1) / (propensitySamples + K)`.
- `jointPropensity` is the product over sampled dimensions. `seededRng(seed)` is mulberry32; the default rng is `Math.random`.

**Reward** (pure `computeReward(signals, exposureAt)`)

- Signals are validated with the strict `rewardSignalSchema` (no text field). Invalid entries are dropped.
- follow_up counts only when `0 ≤ at − exposureAt ≤ FOLLOW_UP_WINDOW_MS` (10 min); every other kind only within `SETTLE_WINDOW_MS` (24 h).
- Negatives: reaction `negative`, `explicit_correction`, or follow_up with `corrective: true`. Any negative → reward 0 (negative beats positive).
- Strong positives, deduplicated by kind: reaction positive 1, explicit_thanks 1, share_offer_accepted 1, voice_reciprocated 0.5.
- Strong sum 0 → reward null, reason `reply_only` when a non-corrective follow_up or a reply was present, `no_signal` otherwise.
- Otherwise reward = `min(1, strong + (non-corrective follow_up ? 0.25 : 0))`.
- `reply` signals are accepted and always ignored: reply-rate alone never updates.
- Update per sampled dimension: decay first, then `alpha += reward`, `beta += 1 − reward`.

**Follow-up classification** (pure `classifyFollowUp(text)`): NFKC, Arabic ي→ی and ك→ک, trim; corrective wins over thanks; the text is never returned, stored or logged. Patterns `EN_CORRECTION`, `FA_CORRECTION`, `EN_THANKS`, `FA_THANKS` as in the module. The caller turns `corrective` into `{kind:'follow_up', corrective:true}` and `thanks` into `{kind:'explicit_thanks'}` plus `{kind:'follow_up', corrective:false}`.

**Decay**: `decayBeta(p, elapsedMs, halfLifeMs = HALF_LIFE_MS)` returns `{alpha: 1 + (alpha − 1)·f, beta: 1 + (beta − 1)·f}` with `f = 0.5^(max(0, elapsed)/halfLife)`. It is applied to every arm of a row at read time (choose, posteriors) and before each update in settle, using `row.updatedAt`; settle writes `updatedAt = now`.

**Keys**: `subjectKey(personId)` = sha256(`'vox_reply_style:' + personId`) hex, first 32 characters; a raw personId is never stored. `posteriorId(scope, dim)` = sha256(`JSON.stringify(['v1', subject, personaId, space, route, dim])`) hex, first 40 characters. Evaluation row ids come from `deps.newId` (default `randomUUID`).

**Schemas**: all zod `.strict()`. personaId matches `/^[A-Za-z0-9_:-]{1,128}$/`; arms are validated against `ARMS[dim]`; numbers finite; alpha and beta in [1, 1e6]; `unchosenArms[dim]` equals `ARMS[dim]` minus `armChosen[dim]` in ARMS order. Rows are parsed on every store write and read; an invalid row is skipped on read and throws on write.

**Bandit methods**

- `choose` never throws. On a store read error it returns the gate-failed result. When at least one dimension is sampled it awaits `store.recordExposure(row)` before returning; if that fails it returns the non-sampled result (explicit, stored, persona) without an exposureId.
- `settle` is idempotent through `store.transact`. Outcomes: `unknown_exposure`, `already_settled`, `expired` (now > at + 24 h; marked settled with reward null), `not_allowed`, `no_update` (reward null), `updated`. Pinned dimensions are never touched.
- `reset({personId, personaId, space})` deletes posteriors and evaluation rows for that subject, persona and space across all routes.
- `withdraw({personId, space?})` deletes them for that subject across all personas, in that space or both.
- `sweep(now)` deletes evaluation rows with `expiresAt ≤ now` (`expiresAt = at + EVAL_RETENTION_MS`, 90 days) and posterior rows idle longer than `POSTERIOR_IDLE_DELETE_MS` (365 days).

### procedural-store.ts

Imports `import type { Firestore } from 'firebase-admin/firestore'`, node fs and path, and the schemas, types and constants from `./procedural`. No tireh, studio or persistence import.

1. `InMemoryReplyStyleStore`: maps of posterior and evaluation rows; `transact` serialised through a promise queue with structuredClone in and out; writes validated before commit; a throw from fn commits nothing.
2. `FileReplyStyleStore(path)`: one JSON file `{version:1, posteriors, evals}`; parent directory 0o700, file 0o600; every operation takes a `${path}.lock` mkdir lock (500 × 10 ms, then `Error('reply_style_lock_busy')`), reloads, applies, writes `${path}.tmp`, fsyncs and renames. A bad version or envelope throws `Error('invalid_reply_style_store')`. At most `MAX_FILE_EVAL_ROWS = 20_000` evaluation rows: the oldest settled rows are dropped first, then the oldest unsettled. Single-host only.
3. `FirestoreReplyStyleStore(db, collections = {posteriors:'vox_reply_style', evals:'vox_reply_style_eval'})`: document ids are the row ids, numbers stored as plain numbers. `transact` uses `db.runTransaction`, reading every requested ref before any `tx.set`. `deleteSubject` and `sweep` use equality or one range filter, delete in `.limit(400)` pages with `db.batch().delete().commit()` until a page is empty, are idempotent on retry and return counts. No `firestore.indexes.json` edit (S06 owns it).

### decisions/README.md

Append `## Reply-style procedural memory (not wired)`, one paragraph: the bandit and its key, precedence, private non-guest sampling after the authorize callback, composite reward never reply-rate alone, 90-day half-life, reset and withdrawal deletion, content-free evaluation rows with 90-day retention in `vox_reply_style` / `vox_reply_style_eval`, not constructed by the Studio runtime or gateway, enabling gated by the DPIA (section 4.10, Step 14) and by confirming that `message_reaction` updates reach persona bots in private chats.

## Interfaces

```ts
export const DIMENSION_ORDER = ['length', 'register', 'structure', 'closingQuestion', 'modality', 'language'] as const;
export type StyleDimension = typeof DIMENSION_ORDER[number];
export type ArmOf<D extends StyleDimension> = typeof ARMS[D][number];
export interface ReplyStyle { length; register; structure; closingQuestion; modality; language: 'auto' | ArmOf<'language'> }
export type StyleSource = 'explicit_turn' | 'explicit_stored' | 'sampled' | 'persona_default';
export type ReplyRoute = 'quick' | 'thoughtful' | 'web' | 'untriaged';
export type StyleSpace = 'work' | 'personal';
export const HALF_LIFE_MS = 90 * 86_400_000; FOLLOW_UP_WINDOW_MS = 10 * 60_000; SETTLE_WINDOW_MS = 24 * 3_600_000;
export const EVAL_RETENTION_MS = 90 * 86_400_000; POSTERIOR_IDLE_DELETE_MS = 365 * 86_400_000;
export const DEFAULT_PROPENSITY_SAMPLES = 256; POLICY_VERSION = 'ts-beta-v1';
export const REWARD_WEIGHTS = { reaction: 1, explicit_thanks: 1, share_offer_accepted: 1, voice_reciprocated: 0.5, follow_up: 0.25 };
export interface ReplyStyleScope { personId; personaId; space: StyleSpace; route: ReplyRoute }
export type RewardSignal = reaction | follow_up | explicit_thanks | explicit_correction | share_offer_accepted | voice_reciprocated | reply;
export interface RewardResult { reward: number | null; kinds: RewardKind[]; reason: 'negative' | 'positive' | 'reply_only' | 'no_signal' }
export interface PosteriorRow { schemaVersion: 1; id; subject; personaId; space; route; dimension; arms: Record<string, BetaParams>; updatedAt }
export interface ReplyStyleEvalRow { schemaVersion: 1; id; policyVersion; context: { subject; personaId; space; route; chatKind: 'private'; pinned };
  armChosen; propensity; jointPropensity; unchosenArms; reward: number | null; rewardKinds; at; expiresAt; settledAt? }
export interface ReplyStyleStore { readPosteriors; recordExposure; transact; listEval; deleteSubject; sweep }
export class ReplyStyleBandit { choose; settle; posteriors; reset; withdraw; sweep }
export function resolveReplyStyle, styleFromPreferences, explicitRequestFromTurn, classifyFollowUp, computeReward,
  decayBeta, sampleBeta, seededRng, subjectKey, posteriorId;
// procedural-store.ts
export const MAX_FILE_EVAL_ROWS = 20_000;
export class InMemoryReplyStyleStore; export class FileReplyStyleStore; export class FirestoreReplyStyleStore;
```

The module source is authoritative for exact signatures.

## Flags

None. The shared contract says S14 is not wired and has no flag, so `src/lib/tireh/flags.ts` is not created. Gating is in the API surface: the bandit samples, reads posteriors and learns only when the injected `authorize(scope)` resolves true, the chat is private and `guestAudience` is false. Nothing constructs `ReplyStyleBandit`, so production behaviour is byte-identical to the base.

## Tests (`procedural.test.ts`)

- Precedence: explicit this turn beats stored, which beats sampled, which beats the persona default; pinned dimensions are absent from armChosen, propensity and unchosenArms and appear in `context.pinned`.
- Stored preferences pin only through the real `resolvePreferences` explicit semantics.
- `explicitRequestFromTurn` mapping table.
- Withdrawal and reset delete posteriors and evaluation rows with exact counts; a later settle returns `unknown_exposure` and writes nothing (memory, file, firestore).
- Reply-rate alone never changes a posterior, including a 200-case property loop.
- Composite reward cases, windows, strict schema, dedup; only sampled dimensions update.
- Settle idempotence (sequential and `Promise.all`), expiry and `not_allowed`.
- Decay: 90-day half-life exact numbers, in settle and in `posteriors()`.
- Propensity and offline-evaluation logging; propensities sum to 1; skewed posterior > 0.95.
- Content-free rows: canary text and raw personId never appear in any store; `evalRowSchema` rejects a `text` key.
- Deterministic sampling with `seededRng`; sampler mean sanity.
- Gate cases with a spy store.
- Dimensions option validation.
- `classifyFollowUp` EN/FA table.
- Store contract over memory, file and firestore, including file mode, reload, the eval-row cap and Firestore paging over more than 400 rows.

## Acceptance

- Only the four paths above (plus this spec) differ from the base; no import of the new modules outside them.
- Lib-scoped strict typecheck exits 0; the focused suite passes without network, 127.0.0.1 or a `/tmp` literal.
- `npx vitest run src/lib/tireh src/lib/adaptive/decisions` passes as at the base; the full suite adds no new failing files beyond the sandbox baseline.
- eslint is clean on the new files.
- Every row passes its strict schema and holds no free text, message content, raw personId or model output.

## Out of scope

Any wiring (runtime, gateway, prompt, StudioDeps/GatewayDeps); ingesting Telegram `message_reaction`, share-offer and voice reciprocity events; a "Why this?" or Reset UI or HTTP route; hooking `withdraw()` into the adaptive consent-withdrawal path (Step 1 owns persistence and shared/service.ts); any change to personalization/index.ts, explicit.ts or learning/**; flags.ts; Step 1 territory; firestore.indexes.json, TTL policies, firebase.json, package files; S09's TriageV2 import; joint-arm bandits and an offline IPS/DR evaluator; Privacy.tsx.

## Risks

- Follow-ups only add +0.25 alongside a strong positive; alone they yield reward null. This resolves the tension between "non-corrective follow-up" as a reward component and "reply-rate alone never updates".
- The bandit is factored per dimension and shares one composite reward, so it ignores interactions and credits every sampled dimension equally.
- Propensities are Monte-Carlo Laplace estimates, not exact Thompson probabilities; the sample count and `policyVersion` are logged.
- The hashed subject is pseudonymous, not anonymous; rows are behavioural personal data. Hence deletion on reset and withdrawal, 90-day eval retention and the DPIA gate.
- Firestore `deleteSubject` and `sweep` are paged, not atomic across pages; they are idempotent and must be retried by future wiring.
- `classifyFollowUp` is heuristic ("no problem" counts as corrective); calibrate on S09 labelled examples before wiring.
- Reaction delivery to persona bots in private chats is unconfirmed; learning may be slow without it.
- Language and modality arms are disabled by default.
- The file store is single-host and rewrites the whole file per operation.
