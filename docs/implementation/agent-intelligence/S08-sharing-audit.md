# S08: Sharing policy completion, content-free audit log and visibility/adaptive differential test

Step 8 of `docs/AGENT_INTELLIGENCE_SOLUTION.md` (sections 3.4, 3.5, 4.6 and the Step 8 row of section 5).
Base commit: `6d00b8066e5d8e8d444bb47d978aa571e20929df`.

## Goal

Close the five sharing gaps of section 4.6 behind two server flags that default off:

- group memory goes dark when membership grows: a group `historyPolicy` field plus an explicit, previewed and audited admin re-snapshot for one named member;
- successors inherit everything: a successor filter that carries source-event tombstones;
- recipients silently lose a corrected share: content-free supersede notices;
- shared context needs every participant's `optional.personalization`: membership plus a read grant is enough;
- no audit trail: a content-free, append-only `vox_audit` log.

Plus a `PolicySnapshotBuilder` with a differential oracle against adaptive `authorizeAccess`, and the 14-invariant suite.

## Flags

| Env | Effect when set |
|---|---|
| `TIREH_SHARING_V2=1` (`tirehFlags().sharingV2`) | successor filter and tombstone carry in `Studio.inheritMemories`; supersede notices (recorded by `auditMemoryStore`, exposed by `Studio.memoryNoticesFor` and the `notices` key of `GET agents/:id/memories`); the shared readContext consent decoupling; `Studio.resnapshotGroupMemory` and `POST groups/:chatId/resnapshot` |
| `TIREH_AUDIT_LOG=1` (`tirehFlags().auditLog`) | content-free `vox_audit` rows from the decorators and the re-snapshot action |

- `runtime.ts` installs the decorators and stores only when a flag is set at startup; the decorators re-check both flags on every call.
- With both unset: no auditing Proxy, no `historyPolicy` key from org-bridge, both group routes are the base 404, `GET memories` is `{memories}`, `inheritMemories` runs the base loop and the shared predicate is the base predicate. What remains with both unset (fixer r2 on main, `53b9361`): an erasure-only notice handle, a delete-only notice-erasing Proxy (`noticeErasingMemoryStore`, installed only when notices are stored or the check fails) and the daily `vox_audit` retention sweep. No audit or notice file or collection is created.
- `src/lib/tireh/flags.ts` is the shared contract file (sha256 `6b8edcd4bf18ca2f4d7a160f0a83077e823d6f491834abf54268a31433566630`, the hash this step was built against).
  - Note: `flags.ts` changed after the steps merged, on `agent-intelligence-wave-a-main`: `voiceShadow` (`97bf549`), `webhookFailClosed` (`ebc18d9`), then `voiceShadow` composed with `voiceRecognition` and the header corrected (H3, `e94ca83`). Current sha256 `7adeaa35129d3ac610ef67940eff790b49417206ee4ccff3f7b88cc5db806740`, pinned in `llm-blocks.test.ts` and `llm-blocks.main-lineage.test.ts`. S08's two fields are unchanged.
- Recommendation: enable `TIREH_SHARING_V2` promptly after merge; the base successor copy includes private and sensitive records.

## Files

- `src/lib/tireh/types.ts`: `Group.historyPolicy?` (one line).
- `src/lib/studio/types.ts`: `StudioGroup.historyPolicy?` after `audienceEpoch`. No UI; the admin setter route came with the integration hardening (below).
- `src/lib/studio/org-bridge.ts`: conditional spread of `historyPolicy` (known values only), so boundary keys and history stamps are unchanged when unset.
- `src/lib/tireh/memory/sharing.ts`: `SUCCESSOR_SCOPES`, `isSuccessorTransferable`, `successorCopy`, `resnapshotPatch`, `supersedeNoticeRecipients`, `TombstoneCarrier` (structural, matches S06's optional store methods).
- `src/lib/tireh/audit/store.ts`: types, `newAuditRowSchema` (strict; id regex without whitespace; `chatKeyHash` 32 hex; bounded `policyKey`), `normalizeAuditRow`, `memoryPolicyKey`, `chatKeyHash`, `AUDIT_RETENTION_DAYS`, `auditCutoff`, `InMemoryAuditStore`, `createFileAuditStore` (JSONL, 0o600, invalid lines skipped).
- `src/lib/tireh/audit/firestore.ts`: `FirestoreAuditStore` (`vox_audit`, `create()`, list by personaId + `at` desc, batched sweep) and `FirestoreSupersededNoticeStore` (`tireh_supersede_notices`, one doc per recipient; since fixer r1 `listFor` is two equality filters ordered by `at` desc and bounded, on a composite index). See the integration section for the current query shapes.
- `src/lib/tireh/audit/notices.ts`: notice types, in-memory and file stores (JSON array, 0o600, cap 5000; `listFor` at most 200).
- `src/lib/tireh/audit/memory-decorator.ts`: `auditMemoryStore` / `auditShareOfferStore` Proxies (intercept `add`, `addIfEpoch`, `update`, `updateIfShareVersion`, `delete`; `create`, `setStatus`).
- `src/lib/tireh/audit/index.ts`: re-exports.
- `src/lib/tireh/policy/snapshot.ts`: `buildPolicyMapping`, `adaptiveAllowsAudience`.
- `src/lib/adaptive/shared/service.ts`: the two `personalized` lines call `contextPersonalized(people)`; flag off is the base predicate verbatim.
- `src/lib/studio/service.ts`: StudioDeps `audit?`, `memoryNotices?`; `inheritMemories` body; `resnapshotGroupMemory` and `memoryNoticesFor` after `listGroups()`.
- `src/lib/studio/http.ts`: the resnapshot route and the `notices` key.
- `src/lib/studio/runtime.ts`: one block after `studio.deps.shared = ...`.

## Tests

- `src/lib/tireh/__tests__/audit-store.test.ts`
- `src/lib/tireh/__tests__/audit-decorator.test.ts`
- `src/lib/tireh/__tests__/policy-differential.test.ts`
- `src/lib/tireh/__tests__/invariants.test.ts` (exactly 14 `it` blocks, `(1)` to `(14)`)
- `src/lib/studio/__tests__/sharing-v2.test.ts`

## Deviations and notes

- Differential oracle: one documented divergence, `S08-DIFF-1`. A duplicated owner id (`[reza, reza]`) on a personal/confidential private record is denied by `visibility.ts` (raw length must be 1) and allowed by adaptive after the required audience de-duplication. Production audiences come from `audienceOf()`, which de-duplicates.
- `POST groups/:chatId/resnapshot` rejects a non-numeric `telegramId` (string ids give 400) and an extra path segment; the contract used `Number(b.telegramId)`.
- org-bridge maps only the two known `historyPolicy` values.
- The decorator rethrows store errors unchanged after writing a `denied`/`failed` row for `updateIfShareVersion`, `update` and `delete` as well as for `add`.
- Fixer r2 on main: `isSuccessorTransferable(memory, now)` also refuses records S06 marked `invalidatedAt` and records whose `expiresAt` has passed (sections 4.3 and 4.6). A failed tombstone carry or copy never fails the successor hire: it writes a content-free `memory.inherit` admin audit row (`skipped: tombstones unsupported`, `skipped: tombstone carry failed`, `copied N, skipped M`), as main's lineage did.
- Fixer r2 on main: erasure and retention hold whatever the flags are now. `wireSharingAudit` (runtime.ts) keeps an erasure-only notice handle for rights erasure, installs a delete-only `noticeErasingMemoryStore` when notices are stored, and runs `startAuditRetentionSweep` with both flags off. Neither creates the audit file, the notice file or a Firestore collection.
- CI (section 5 row 8): the `privacy-gates` job in `.github/workflows/ci.yml` runs three steps; build waits on it. Flags unset (32 files): `src/lib/tireh/__tests__/` `invariants`, `policy-differential`, every `redteam*`, `visibility`, `memory-privacy`, `history-privacy`, `memory-requests`, both `negative-identity*`, `audience-boundary`, `indexed-boundary`, `memory-replacement`, `combined-runtime`, the `cached-prompt-suite-{audience-boundary,indexed-boundary,memory-privacy,memory-replacement,combined-runtime,visibility}` wrappers and `memory-eval/`; `src/lib/studio/__tests__/` both `sharing-v2*`, `boundary-revisions`, `visibility` and `qa-code-quality-r2-successor`. Under `TIREH_RETRIEVAL_V2=1`: `negative-identity*`, `memory-privacy`, `visibility` and `memory-eval/`. Under `TIREH_SHARING_V2=1 TIREH_AUDIT_LOG=1`: `invariants`, `policy-differential`, the `redteam-wave-a*` suites and `sharing-v2`. Cases of the 4.6 gate that live in other suites (successor, voice replay, shared phone) still run only in the general `test` job. Deviation until the owner acts: making it a required (protected) check is a branch-protection setting, not something the repository can do.
- TODOs left in code: Telegram `/memories` notice (gateway.ts is not S08's), store-level `chatKeyHash`, the reserved kinds `retrieval`, `prompt_memory`, `consent_change`, `identity_change`, per-record owner approval for private successor records. (The Step 7 forget-cascade closure in delete rows is done: see below.)

## Integration onto main (2026-10-25/26)

The branch `agent-intelligence-wave-a-main` merged this step as `8d327ed` and then hardened it in QA fixer rounds 1-3
and the hardening clusters H1 (audit) and H6 (sharing). This section describes the merged code; where it differs from the
sections above, it wins.

- **Notice stores.** `listFor(personaId, recipientPersonId, since?)` is two equality filters plus an optional `at >=`
  range, ordered by `at` desc and capped at `MAX_NOTICE_LIST` (200), on the composite index `tireh_supersede_notices`
  (`personaId` ASC, `recipientPersonId` ASC, `at` DESC). New erasure methods on every store: `deleteByMemoryIds(ids)`
  (every notice naming one of the memories, old or new) and `deleteForPerson(personId)` (every notice naming the person
  as owner or recipient), plus `hasAny()`. `Studio.memoryNoticesFor` filters every listed notice by visibility before
  capping the output at 50, and reads each notice's old and replacement records concurrently, ten notices at a time (H6).
  `newMemoryId` is still returned when the replacement is not visible (product decision (e)).
- **`wireSharingAudit()` (runtime.ts).** With a flag set it installs the auditing Proxies, wrapped as
  `withAuditRetention(store, { onError })`. Whatever the flags are it keeps an erasure-only notice handle
  (`Studio.forgetMemoryNotices` falls back to it; the rights-intake erasure in `rights-http.ts` calls
  `eraseMemoryNotices`), installs the delete-only `noticeErasingMemoryStore` when notices are stored or the check fails,
  and runs `startAuditRetentionSweep` now and then daily (unref'd). With the flags on it now also runs the startup sweep,
  so `TIREH_SHARING_V2` alone, which appends nothing, still ages `vox_audit` rows out after 12 months (H1). This is the
  **rollback sweep**: rows and notices written while a flag was on are still erased and aged out after the flag is unset.
  Neither the handle nor the sweep creates a file or collection.
- **Deletes.** `MemoryStore.delete` resolves to the ids it removed; a `delete` audit row lists every removed id of the
  forget closure, split into rows of `MAX_AUDIT_IDS` (200); a failed delete keeps the requested id (H1). Notice erasure
  follows the same closure.
- **Audit list query.** `FirestoreAuditStore.list` runs every filter in the query before the limit:
  `personaId ==`, optional `memoryIds array-contains`, optional `at >=`, then `orderBy('at', 'desc').limit(n)`, so it
  returns what the in-memory and file stores return. New composite index `vox_audit` (`personaId` ASC, `memoryIds`
  CONTAINS, `at` DESC) beside the original (`personaId` ASC, `at` DESC) (H1).
- **Signal codes.** Audit and notice writes are best effort, raced against `AUDIT_WRITE_TIMEOUT_MS` (2 s), and never
  change the memory result. A failure logs one fixed line: `[vox] audit_append_failed`, `audit_append_timeout`,
  `notice_record_failed` or `notice_erasure_failed`. A rejected retention sweep reports `sweep_failed` through
  `onError`, which the runtime logs as `[vox] audit sweep_failed`. No row field, id or content is logged (H1).
- **`historyPolicy`.** Effect: `resnapshotGroupMemory` reads the group's value. `since_membership` refuses with 409 and
  a content-free Studio audit row (`memory.resnapshot`, detail `<telegramId>:refused`) before any memory read or write
  and with no `vox_audit` row; `all_authorized_history` applies as before; an absent value keeps today's behaviour
  (applies) until product decision (j), although the policy oracle reads it as `since_membership`. Setter:
  `Studio.setGroupHistoryPolicy(actor, chatId, policy)`, admin only (403), the two known values only (400), unknown
  group or channel 404, audited as `group.history_policy`. Route: `POST groups/:chatId/history-policy { policy }`.
  Both routes are the base 404 unless `TIREH_SHARING_V2` is on (H6).
- **Preview shape.** `POST groups/:chatId/resnapshot` without `apply` returns `{ count, applied: false }`; with
  `detail: true` it also returns `byAgent` (per-agent counts) and `memoryIds` (ids only, never content). Detail is
  opt-in because existing suites pin the plain shape. The 200-id `vox_audit` batching on apply is unchanged (H6).
- **Successors** (fixer r2): `isSuccessorTransferable(memory, now)` refuses invalidated and expired records, and a
  failed tombstone carry or copy writes a `memory.inherit` admin row instead of failing the hire (see Deviations).
- **Other-persona guard** in `policy/snapshot.ts` restored by fixer r1 (`2b66ced`), with a policy-differential case.

Out of scope, with reasons:

- **The Telegram `/memories` notice line (F247).** Notices reach the Mini App only (`notices` in `GET memories`). The
  Telegram line waits on product decision (e): the EN/FA notice copy is unreviewed, notices name the original owner,
  and whether `newMemoryId` is withheld for an invisible replacement is undecided. The gateway's `/memories` region is
  not S08's file.
- **The reserved audit kinds (F247).** `retrieval` / `prompt_memory` would need the ids selected inside `composeReply`
  (S03 and Step 1 regions of the gateway); `consent_change` belongs to the adaptive consent path, a Step 1 persistence
  seam this work must not modify; `identity_change` waits on S10 wiring. The kinds stay in the schema, unwritten, so
  section 4.6's "every memory that entered a prompt ... consent change and identity-level change" is a known
  acceptance gap (open issue 6 of `WAVE_A_ON_MAIN.md`).

## Risks

- Firestore `vox_audit` list needs its composite indexes (personaId ASC, at DESC; and personaId ASC, memoryIds CONTAINS, at DESC for a memory filter). Both are in `firestore.indexes.json`, which `firebase.json` now references; deploy them before `TIREH_AUDIT_LOG` runs on Firestore.
- With `TIREH_SHARING_V2=1`, base tests that pin the old behaviour would fail by design. They are pinned to the flag unset instead: `src/lib/studio/__tests__/service.test.ts` "a successor inherits memories at hire time ..." (`05a4520`) and the two base consent cases of `src/lib/adaptive/__tests__/shared-memory.test.ts` (H6, `677f15d`), with the flag-on arm in `hardening-shared-memory-v2.test.ts`.
- Tombstone carry depends on S06's optional store methods; on this branch alone the real stores lack them, so flag-on inheritance copies nothing (fail closed). Re-run the inheritance tests against the real stores after S06 merges.
- A re-snapshot apply bumps `safetyRevision` for that persona, so in-flight turns fail `unchanged()` once (fail closed).
- Notices tell recipients that and when the owner corrected a shared fact; content-free, but the product copy should be reviewed.
