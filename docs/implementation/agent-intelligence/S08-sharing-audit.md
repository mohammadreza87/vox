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
- With both unset: no Proxy, no `historyPolicy` key from org-bridge, the route is the base 404, `GET memories` is `{memories}`, `inheritMemories` runs the base loop, the shared predicate is the base predicate, and no audit or notice file or collection is created.
- `src/lib/tireh/flags.ts` is the shared contract file (sha256 `6b8edcd4bf18ca2f4d7a160f0a83077e823d6f491834abf54268a31433566630`).
- Recommendation: enable `TIREH_SHARING_V2` promptly after merge; the base successor copy includes private and sensitive records.

## Files

- `src/lib/tireh/types.ts`: `Group.historyPolicy?` (one line).
- `src/lib/studio/types.ts`: `StudioGroup.historyPolicy?` after `audienceEpoch`. No setter route or UI.
- `src/lib/studio/org-bridge.ts`: conditional spread of `historyPolicy` (known values only), so boundary keys and history stamps are unchanged when unset.
- `src/lib/tireh/memory/sharing.ts`: `SUCCESSOR_SCOPES`, `isSuccessorTransferable`, `successorCopy`, `resnapshotPatch`, `supersedeNoticeRecipients`, `TombstoneCarrier` (structural, matches S06's optional store methods).
- `src/lib/tireh/audit/store.ts`: types, `newAuditRowSchema` (strict; id regex without whitespace; `chatKeyHash` 32 hex; bounded `policyKey`), `normalizeAuditRow`, `memoryPolicyKey`, `chatKeyHash`, `AUDIT_RETENTION_DAYS`, `auditCutoff`, `InMemoryAuditStore`, `createFileAuditStore` (JSONL, 0o600, invalid lines skipped).
- `src/lib/tireh/audit/firestore.ts`: `FirestoreAuditStore` (`vox_audit`, `create()`, list by personaId + `at` desc, batched sweep) and `FirestoreSupersededNoticeStore` (`tireh_supersede_notices`, one doc per recipient, two equality filters).
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
- TODOs left in code: Telegram `/memories` notice (gateway.ts is not S08's), store-level `chatKeyHash`, the reserved kinds `retrieval`, `prompt_memory`, `consent_change`, `identity_change`, per-record owner approval for private successor records, the Step 7 forget-cascade closure in delete rows, the audit sweep scheduler.

## Risks

- Firestore `vox_audit` list needs the composite index (personaId ASC, at DESC); S06 owns `firestore.indexes.json`, so the integrator adds it after both merge.
- With `TIREH_SHARING_V2=1`, base tests that pin the old behaviour fail by design and are not edited: `src/lib/studio/__tests__/service.test.ts` "a successor inherits memories at hire time ..." and `src/lib/adaptive/__tests__/shared-memory.test.ts` "requires independent personalization ...".
- Tombstone carry depends on S06's optional store methods; on this branch alone the real stores lack them, so flag-on inheritance copies nothing (fail closed). Re-run the inheritance tests against the real stores after S06 merges.
- A re-snapshot apply bumps `safetyRevision` for that persona, so in-flight turns fail `unchanged()` once (fail closed).
- Notices tell recipients that and when the owner corrected a shared fact; content-free, but the product copy should be reviewed.
