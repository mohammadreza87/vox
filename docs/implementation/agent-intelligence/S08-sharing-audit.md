# S08: Sharing policy completion, content-free audit log and visibility/adaptive differential test

Step 8 of `docs/AGENT_INTELLIGENCE_SOLUTION.md` (sections 3.4, 3.5, 4.6 and the Step 8 row of section 5).
Base commit: `6d00b8066e5d8e8d444bb47d978aa571e20929df`.

## Goal

Finish the sharing rules in section 4.6 behind two server flags that default off:

- a group `historyPolicy` with an explicit, previewed and audited admin re-snapshot for one named member;
- a successor-inheritance filter that carries source-event tombstones;
- content-free "updated" notices to recipients when a shared record is superseded;
- reading shared context with membership plus a read grant instead of every participant's `optional.personalization`;
- a content-free, append-only `vox_audit` log written through a `MemoryStore` decorator;
- a `PolicySnapshotBuilder` with a differential test against adaptive `authorizeAccess`;
- the 14-invariant suite.

With `TIREH_SHARING_V2` and `TIREH_AUDIT_LOG` unset, every request, response, stored record and log line is byte-identical to the base.

## Flags

| Env | Effect when set |
|---|---|
| `TIREH_SHARING_V2=1` (`tirehFlags().sharingV2`) | successor-inheritance filter and tombstone carry in `Studio.inheritMemories`; supersede notices (recorded by `auditMemoryStore` when a notices store is passed), the `notices` key on `GET agents/:id/memories` and `Studio.memoryNoticesFor`; the readContext personalization decoupling in `SharedMemoryService`; `POST groups/:chatId/resnapshot` and `Studio.resnapshotGroupMemory` |
| `TIREH_AUDIT_LOG=1` (`tirehFlags().auditLog`) | content-free `vox_audit` rows from the decorators and the re-snapshot action |

- `runtime.ts` installs the decorators and stores only when at least one flag is set at startup; the decorators re-check both flags on every call. With both unset, `studio.deps.memory` is the same object as at the base.
- `src/lib/tireh/flags.ts` is the shared contract file, byte-identical (sha256 `6b8edcd4bf18ca2f4d7a160f0a83077e823d6f491834abf54268a31433566630`). No other env var is read.

## Files

### `src/lib/tireh/types.ts` (Group only)
`historyPolicy?: 'since_membership' | 'all_authorized_history'` after `agentIds`. Default since_membership; only an explicit, audited admin re-snapshot widens.

### `src/lib/studio/types.ts`
`StudioGroup.historyPolicy?` after `agentIds`. Never widens a record by itself.

### `src/lib/studio/org-bridge.ts`
Whitelisted conditional spread as the last property of the groups mapping, so a group without the field has no key at all.

### `src/lib/tireh/memory/sharing.ts` (new pure helpers; existing functions unchanged)
- `INHERITABLE_SCOPE_KINDS = ['group','people','project']`
- `isInheritable(m)`: sensitivity normal, scope kind in the list, not superseded.
- `successorCopy(m, successorId)`: a `NewMemory` without id/createdAt/updatedAt/supersedes/supersededBy, `personaId = successorId`; keeps scope, `authorizedPersonIds`, `shareVersion` and source (incl. eventIds).
- `TombstoneCarrier`: structural optional `tombstonesOf` / `addTombstones` (identical to the S06 optional MemoryStore methods).
- `resnapshotPatch(m, groupId, personId)`: null unless normal, `scope.kind==='group'`, matching groupId, not superseded, `authorizedPersonIds` defined (legacy rows never widen), person not already authorized; else `{ authorizedPersonIds: sorted unique [...ids, personId], shareVersion: +1 }`.
- `supersedeNoticeRecipients(predecessor)`: [] unless normal and people/project scope; else sorted unique (`authorizedPersonIds ?? (people ? personIds : [])`) minus `source.personId`.

### `src/lib/tireh/audit/store.ts` (new)
`AuditKind`, `AuditOutcome`, `AuditRow`, `NewAuditRow`, `AuditStore`, `InMemoryAuditStore`, `createFileAuditStore`, `FirestoreAuditStore` (collection `vox_audit`), `chatKeyHash` (sha256 hex, first 32), `auditRowSchema` (strict zod), `normalizeAuditRow` (sort, dedupe, cap 200), `AUDIT_RETENTION_DAYS = 365`, `auditRetentionCutoff`, `sourceChatKey`.

- ids `/^[A-Za-z0-9._:@-]{1,200}$/`, `chatKeyHash` `/^[0-9a-f]{32}$/`, `policyKey` `/^[a-z0-9._:-]{1,120}$/`; `.strict()` rejects content, topic or text.
- File store: append-only JSONL (mode 0o600, serialized appends); `sweep` is the only rewrite (tmp + rename) for 12-month retention.
- Firestore store: `create()` with undefined fields dropped; list by personaId, optional memoryIds array-contains, optional at >=, orderBy at desc, limit; sweep in batches of 400. Composite indexes are documented for the integrator.
- `retrieval`, `prompt_memory`, `consent_change` and `identity_change` are reserved kinds (TODO worker / Step 1 / consent ledger).

### `src/lib/tireh/audit/notices.ts` (new)
`SupersededNotice`, `SupersededNoticeStore`, in-memory, file (JSON array, 0o600, tmp + rename) and Firestore (`tireh_supersede_notices`) stores. Content-free: ids, person ids and a time only. `listFor` returns notices whose recipients include the person, at >= since, newest first, limit 50.

### `src/lib/tireh/audit/memory-decorator.ts` (new)
- `auditMemoryStore(inner, audit, notices?)`: a Proxy intercepting `add`, `update`, `updateIfShareVersion`, `delete`; every other property via `Reflect.get(target, prop, target)` with functions bound to target (keeps #private fields, file-store wrappers and S06 optional methods).
- With both flags off every wrapped method is a pure pass-through (no extra inner calls).
- Row classification: add → write/supersede; updateIfShareVersion with `scope` in patch → share_approve or revoke (denied when the version is stale); patches without scope (re-snapshot) are not audited here; update → supersede / share_approve / revoke / write; delete → delete with no actor; a thrown add → denied (StaleMemoryWriteError) or failed, original error rethrown.
- Under sharingV2 with a notices store, a supersede of a people/project record records a notice for recipients minus the owner.
- Every audit append is awaited and errors are swallowed.
- `auditShareOfferStore(inner, audit)`: create → share_offer applied; setStatus declined → share_offer denied; approved → no row.

### `src/lib/tireh/audit/index.ts` (new)
Re-exports.

### `src/lib/tireh/policy/snapshot.ts` (new)
`PolicyMappingInput`, `PolicyMapping`, `buildPolicyMapping`, `adaptiveAllowsAudience`, `TIREH_POLICY_VERSION = 'tireh-visibility-v1'`. Must not import `canPersonSee`, `isVisibleToAudience`, `isMemoryAllowedInChat` or `snapshotScopeAudience`; scope membership is derived independently from the org config. Synthetic identity binding, single Work space, `core.conversation` without consents, agent grant from personaId.

### `src/lib/adaptive/shared/service.ts`
Only the two `const personalized = ...` lines become `this.personalized(people)`; the flag-off branch is the base expression. Under sharingV2 only the product pause (`storedPersonalizationAllowed !== false`) applies; membership, per-container person and agent grants, binding expiry, group hasGuests and roster digests and retention are unchanged.

### `src/lib/studio/service.ts`
- Imports and two `StudioDeps` fields (`audit?`, `memoryNotices?`) after `shared?`.
- `inheritMemories`: base loop when the flag is off; with the flag, fail closed unless the store has `tombstonesOf`/`addTombstones`, carry tombstones first, copy only `isInheritable` records with `successorCopy`, and write a counts-only `memory.inherit` StudioState.audit entry. Private records: TODO per-record owner approval path.
- New `resnapshotGroupMemory(actor, chatId, telegramId, apply)` (admin+, preview or apply, `updateIfShareVersion` with no guard, StudioState.audit `memory.resnapshot`, `vox_audit` `resnapshot` rows) and `memoryNoticesFor(actor, agentId)` after `listGroups()`.

### `src/lib/studio/http.ts`
`POST groups/:chatId/resnapshot` (sharingV2 only; otherwise the base 404) and the `notices` key on `GET agents/:id/memories` under sharingV2.

### `src/lib/studio/runtime.ts`
One block after `studio.deps.shared = ...` installing the audit store, notice store and decorators when either flag is set.

## Tests

- `src/lib/tireh/__tests__/invariants.test.ts`: the 14 invariants of section 4.6 / the memory review.
- `src/lib/tireh/__tests__/policy-differential.test.ts`: `isVisibleToAudience` vs `adaptiveAllowsAudience` on the fixture corpus and generated audiences, with an explicit `KNOWN_DIVERGENCES` allowlist (each entry must match and actually diverge) and `MODELING_NOTES`; Studio-mapped historyPolicy cases.
- `src/lib/tireh/__tests__/audit-store.test.ts`: in-memory, file and fake-Firestore audit and notice stores.
- `src/lib/tireh/__tests__/audit-decorator.test.ts`: pass-through with flags off, forwarding, classification, best effort, content-free canary, notices.
- `src/lib/studio/__tests__/sharing-v2.test.ts`: org-bridge, HTTP flag off/on, inheritMemories off/on, re-snapshot audit row, group events never widen, SharedMemoryService.readContext decoupling and kept fences.

## Acceptance

- `flags.ts` sha256 matches the contract; lib-scoped tsc exits 0; eslint clean on changed files.
- No new failing vitest files compared with the base baseline (sandbox EPERM files named separately).
- With every flag unset: `GET agents/:id/memories` returns exactly `{memories}`; the resnapshot route returns the base 404; inheritMemories copies as at the base; readContext unchanged; runtime creates no `vox-audit.jsonl` or `supersede-notices.json`; `studio.deps.memory` is the original object; `studioToOrgConfig` group output deep-strict-equal to the base.
- `TIREH_SHARING_V2=1 TIREH_AUDIT_LOG=1` over the invariants, differential and `src/lib/studio`: green except the base test that pins the old behaviour, `fire and successor > a successor inherits memories at hire time when the predecessor was fired with transfer` (expected flag-on failure, not edited).
- Differential test green with every allowlist entry justified and matching.
- No audit row, notice, StudioState.audit entry or log line contains memory content, topic or message text (canary tests).
- Diff touches only the files listed here.

## Out of scope

Step 1 (loadTurnSnapshot, RevisionVector, boundary/unchanged, adaptiveContext*, liveTurn rechecks, persistence seams); any gateway.ts edit (Telegram `/memories` notice line is a TODO); retrieval/prompt_memory/consent_change/identity_change rows (reserved); a sweep scheduler; a historyPolicy setter route or UI; the owner approval flow for private inheritance; identity-level gating for group policy changes (S10L); firestore.indexes.json and firebase.json (S06); store implementations of tombstonesOf/addTombstones (S06); subject rights and the forget cascade; auditing adaptive shared-container mutations; the Privacy.tsx TS17008 base breakage.

## Risks (summary)

- With `TIREH_SHARING_V2=1`, two base tests fail by design and must not be edited: `service.test.ts` "a successor inherits memories at hire time ..." (asserts a private record is inherited) and `adaptive/__tests__/shared-memory.test.ts` "requires independent personalization and explicit per-container agent grants".
- The base inheritance copies `supersedes`, private and sensitive records; the flag-on path fixes this. Enable `TIREH_SHARING_V2` promptly after merge.
- Tombstone carry depends on S06's optional store methods; on this branch alone flag-on inheritance copies nothing (fail closed).
- Firestore composite indexes required for `vox_audit` (personaId + at desc; personaId + memoryIds array-contains + at desc) and `tireh_supersede_notices` (personaId + recipientPersonIds array-contains).
- Delete rows carry no actor; an admin may re-snapshot for themselves (audited, no four-eyes rule yet).
- readContext decoupling widens prompt use of explicitly shared notes for recipients without `optional.personalization`; confirm the DPIA delta.
