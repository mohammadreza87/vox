# Adaptive foundation contract v1

19 October 2026. Candidate engineering contract for VOX-006 and foundational portions of VOX-009/010/011, based on `ebb75a67c79bf317d1dec40381b216c75bb90ffa`. Source: [`src/lib/adaptive`](../../src/lib/adaptive/index.ts). This is local, pure TypeScript: no database, migration, provider, network, biometric matching, endpoint or runtime collection is enabled by this module. Legal review and launch approval remain separate gates. Synthetic test approvals do not constitute counsel approval.

## Public API and authoritative inputs

| API | Result and responsibility |
|---|---|
| `ADAPTIVE_SCHEMA_VERSION`, `OPERATIONS`, `PURPOSES`, `CAPABILITIES` | Version 1 contract and closed operation/purpose/capability vocabularies |
| `resolveVerifiedPerson(identity, account, binding, now)` | Selected verified person ID, or `undefined`; does not perform authentication or proof verification |
| `authorizeAccess(request, snapshot, now)` | `{allowed:false, reason}` or `{allowed:true, personId, stamp}`; evaluates exact source metadata before content loading |
| `isAuthorizationCurrent(stamp, request, snapshot, now)` | Full authorization evaluation plus request/version/expiry comparison against a fresh authoritative snapshot |
| `transitionConsent(current, command)` | Revision-checked next permission and immutable event proposal; no side effect or committed-state claim |
| `evaluateCapability(request, approvals, now)` | Deterministic adult/registry/kill-switch eligibility; does not grant consent, memory rights, microphone permission or provider eligibility |

All timestamps are integer UTC epoch milliseconds. Expiry is exclusive: an object expires when `now >= expiresAt`. Record revisions start at 1; epochs start at 0 and never decrease. IDs are opaque strings, scoped by exact tenant and space. Work and Personal remain different spaces even when people, agents or container names coincide. Records have `schemaVersion`, `id`, `revision`, `createdAt` and `updatedAt`. Unknown contract versions, nonfinite/negative clocks, future record updates and invalid revisions deny access.

The module accepts typed, normalized, server-owned metadata. It is not an HTTP decoder; validate incoming unknown JSON at the boundary, reject malformed shapes, and treat any policy/store failure as denial. Client-supplied permission records, verified-person IDs, age declarations copied without the approved server flow, jurisdiction keys, or model-generated metadata are never authoritative. Persisted records must use revision preconditions. Reading an old snapshot and passing it to this module cannot establish that it is current.

## Identity, scope and independent rights

`Account.ownerPersonId` is an administrative fact. `IdentityContext.authenticatedAccountId` comes from server authentication. `selectedPerson` references an exact current `PersonAccountBinding` revision, whose account/person IDs, verified state, approved confirmation method, verification time and expiry must match. The authoritative `PolicySnapshot.people` must include an `active` `Person` for the actor and every output recipient; optional processing also requires active source subjects. Missing, duplicate, `suspended` or `deleted` people deny even if their account bindings and memberships remain active. There is no implicit fallback from account ownership to a person. Selecting a different person on a shared account requires a binding produced by that person's authenticated confirmation flow. The module cannot implement that proof ceremony. `resolveVerifiedPerson` validates only the account/binding selection; `authorizeAccess` also enforces current person records.

`account_confirmation` may verify only `Account.ownerPersonId`; a binding to any other person must use `authenticated_person_confirmation`. Neither method is inferred from a client-provided identity claim: the server must verify the corresponding proof before creating the binding. `IdentityHint` carries speaker labels, voice matches and model suggestions. It is deliberately excluded from authorization inputs. A hint cannot create a binding, establish adulthood, select the subject of durable memory or grant access. Agent ownership and Studio administrator status confer no implicit memory rights in this contract.

Every request names exact tenant, space, container and source IDs. The snapshot includes:

- `Space`: Work/Personal, administrative owner account, active/suspended status and policy epoch.
- `Container`: private verified-person owner, group ID, or exact recipient IDs; active/deleted status; policy epoch; pinned parent `spacePolicyEpoch`; explicit history policy.
- `Membership`: exact tenant/space/container/person; group ID when applicable; active/revoked state, joined time, expiry and matching container policy epoch.
- `Grant`: person or agent principal; exact tenant/space/container; independent operations; exact purpose/version; active/revoked state, expiry and matching container policy epoch.
- `ResourceDescriptor`: metadata for one source or approved projection; subject person IDs, container scope, revision, retention expiry, deletion status and revocation epoch. This metadata is stored independently of protected text.
- `ConsentPermission`: person, tenant, space, exact purpose/version, policy version, permission state, revision, epoch and effective/expiry times.

Container membership is the scoped membership boundary for v1; an organization role or space invitation is insufficient. Private containers permit only their verified-person owner; exact-recipient containers permit only listed people; group containers require matching group membership. All require current membership plus applicable grants. Duplicate current memberships or consent states for a subject/purpose deny access rather than choosing the most permissive row. Duplicate IDs within a record collection deny access. The store must return only the authoritative current version, not a mixture of historical states.

`read`, `contribute`, `edit`, `reshare`, `manage` and `delete` remain separate grants. A person grant and, when an agent is involved, that agent's grant must both permit the exact operation and purpose. No wildcard group-to-project/space expansion exists. Multiple independent current grants may permit an operation; revoking all applicable grants or advancing the container epoch removes that permission.

The audience must be a nonempty, deduplicated, known set. Unknown/guest recipients have no implicit access. Every involved person must satisfy the container audience and current membership. Reading or resharing requires read grants for every output recipient and the acting agent. Other mutation checks authorize only the named operation; they do not authorize returning source text. Perform a separate `read` authorization before any content is loaded/rendered. A `manage` grant does not itself validate a proposed grant change, a new recipient or destination projection; dedicated mutation handlers must validate the target and sharing authority transactionally.

For `since_membership`, source creation must be at or after each involved person's current join time. `all_authorized_history` permits earlier history only while current audience, memberships and grants pass. Changing a group's membership must advance membership revision and preserve/recompute join time; leaving and rejoining must not silently recover earlier history. Never use a derived summary's newer creation time to conceal older source lineage: all source descriptors must be authorized too.

## Consent and revocation

Only unexpired, current-version `granted` optional permission is effective. The actor and every protected source subject require their own permission for the requested optional purpose and space. A general analytics opt-in cannot authorize auto-memory, personalization, human quality review or biometrics. `optional.marketing` and `model_training` always deny in v1. Core conversation, security/reliability and exact requested memory do not borrow optional opt-in; their approved lawful basis, requested scope and release gates remain the caller's responsibility.

Permission transitions:

```text
not_asked -> presented -> granted | declined | suspended
granted -> withdrawn | expired | reconsent_required | suspended
declined | withdrawn | expired | suspended -> presented only with deliberateReopen
reconsent_required -> presented (new required disclosure; optional processing remains off)
```

Grant requires separate affirmative consent evidence: notice/version, rendered-copy hash, EN/FA locale, valid presentation time and future expiry. A notice acknowledgement has a different type and cannot grant permission. `ConsentCommand.actor.verifiedPersonId` is a trusted, already-verified identity and must match the subject; account ownership cannot stand in for it. Server handlers must independently enforce who can issue suspension, expiry, reconsent and deliberate-reopen actions, validate the presented notice against the approved purpose/copy/config, and confirm evidence through the actual UI flow. Resuming a suspension additionally requires server resolution of its cause; a user's toggle alone cannot clear a security, legal or risk suspension. This pure module cannot prove that resolution. Re-presenting a required disclosure never auto-grants optional permission: `presented` remains off until a fresh affirmative grant. These proposal functions do not prove that the user saw or signed a disclosure. Biometric executed releases and their restricted evidence remain a separate implementation.

Every accepted transition advances both revision and epoch. Withdrawal makes permission ineffective immediately; deletion/purge jobs remain a separate coordinator. `expectedRevision` rejects reordered/stale writes. The most recent exact duplicate event returns the existing proposal without another event; changed reuse of that ID conflicts. A real ledger must enforce durable global uniqueness for all historical event IDs and atomically write event, permission and invalidation/outbox with a compare-and-swap revision. The pure function alone cannot prevent racing commits or perform durable historical deduplication. Do not acknowledge withdrawal until disablement and invalidation are durably recorded.

Prepared context uses an `AuthorizationStamp` that binds the full request (including account/person selection, agent, purpose, operation and audience), policy version, record revisions, revocation/consent epochs, and earliest applicable expiry. It is neither a signed token nor a substitute for authorization. Re-run `isAuthorizationCurrent` against fresh server state immediately before provider use, content output or commitment; any denial, changed request, revision/epoch mismatch or expiry invalidates queued/cached work. A regrant cannot make an earlier prepared result current. V1 conservatively stamps all supplied records, so unrelated changes can discard work too.

Changing identity, grant, membership, audience, source metadata, retention or consent must increase the owning revision. Space-wide policy changes advance the space epoch and require explicit container refresh; container-wide changes advance its epoch and require explicit membership/grant refresh. Deleted source metadata/tombstones must remain authoritative for retries and restores. This module has no tombstone store, retention sweep, transactional outbox, cancellation transport or deletion worker; the integrating service must provide them. A full re-evaluation is not a lock: eliminate the check/use race for durable writes with transaction preconditions, and define short-lived dispatch/provider reservations plus cancellation/invalidation for external side effects.

## Capability eligibility

`evaluateCapability` checks an enabled server flag, the exact person's current adult-entry state, and every explicitly applicable jurisdiction key. It accepts only `adult_confirmed` via explicit declaration or an approved verification method. Unknown, underage, suspended, expired, mismatched or voice-derived age proof denies. Credible underage/accidental-participant signals must update the authoritative state, stop optional capture and invoke incident/deletion handling in the integrating service.

Registry rows use `blocked | review_pending | approved`, exact capability/configuration version, effective date, review expiry, owner, approval reference and revision. Missing, duplicate/conflicting, future, expired, blocked or pending rows deny. There is no EU/EEA/US blanket inheritance; the server's approved legal resolution flow must supply all applicable participant/country/state keys. The module does not infer location from IP, resolve applicable law or verify counsel signatures. No real registry entries are supplied. A positive capability result must still intersect current consent, access, source lineage, participant/session processing permission, OS permission, provider configuration and feature-specific legal/release gates. Multi-party capture needs every current participant's processing grant and a pause on new/unknown participants; it is not implemented by a single-person eligibility call.

## Threat boundaries and integration

| Path / actor | Required boundary |
|---|---|
| Retrieval, history, directories, graph edges, summaries, tool results | Authorized metadata shortlist before fetching text; apply the same check to every source, not just the final container |
| Extraction and writes | Treat model output as candidates; exact subject/container/purpose; current consent and write operation; transactional revisions and source lineage |
| Cache/prediction/queued work | Request-bound stamp, current re-evaluation, expiry, tombstones and cancellation; no durable private payload in retries for temporary/nonretained sessions |
| Human evaluation, dataset export and prompt optimization | Separate explicit purpose, authorized evidence projection and subject/audience approval; private content never becomes a broadly shared fixture/prompt by inheritance |
| Notifications and ordinary conversational output | Current per-recipient read check at delivery; generic external notification payload and authenticated inbox recheck; separate category/channel/cap/budget rules |
| Authenticated request service | Identity/account verification plus exact-scoped read/write repository credentials; Admin SDK access does not bypass application policy |
| Observer / analyst | Read-only approved minimized projection credentials; no access to general private source content |
| Consent/deletion worker | Narrow ledger/invalidation/tombstone permissions; no conversation generation, broad export or release credentials |
| Optimizer / developer | Synthetic or approved evidence in sandbox; no production data, evaluator fixtures, scoring policy, deployment secrets or promotion authority |
| Independent evaluator / release owner | Separate protected evaluation artifacts and human-authorized promotion; candidate-author role cannot confer release authority |

Service credentials, storage/IAM rules and process isolation are required implementation work; TypeScript interfaces and development-agent instructions do not enforce those boundaries.

Illustrative server flow (repository operations are placeholders, not an exported implementation):

```ts
import { authorizeAccess, isAuthorizationCurrent } from '@/lib/adaptive';

// Authenticate and validate JSON before constructing request. Load the current
// verified-person binding and exact source metadata from the authoritative store.
const snapshot = await repository.readPolicySnapshot(request);
const decision = authorizeAccess(request, snapshot, clock.now());
if (!decision.allowed) return denied();

// Text enters only the approved agent/provider context. The approved provider,
// capability, participant/session and legal gates also run before any processing.
const source = await repository.readExactSource(snapshot.resource.id);
const current = await repository.readPolicySnapshot(request);
if (!isAuthorizationCurrent(decision.stamp, request, current, clock.now())) {
  discard(source);
  return denied();
}
// Recheck source revision/lineage and acquire the integrating service's required
// transaction/reservation. No await between a check and use provides atomicity.
await approvedProcessingBoundary(request, source, decision.stamp);
```

The text read must use the metadata revision or immutable source key; authorize again for every additional source/projection. Never log source content or denial input. Denial reason codes are diagnostic metadata, not a safe public resource-existence API. A policy allow is not provider, capture, enrollment, external-send or deployment authorization. There is no automatic migration or legacy identity/consent backfill; ambiguous records remain unavailable until explicitly resolved. Removing this unused local module has no persistence rollback implication. Once integrated, disabling a capability must also stop workers/providers and preserve deletion/revocation records.

## Local verification boundary

The synthetic Vitest suite covers shared-account identity, hints, scope separation, exact recipients, guests, group/history policy, independent operations, agent/purpose intersection, subject consent, expiry, malformed versions, revocation/regrant stamps, consent replay and capability registry failure states. Actual commands/results are reported in the author handoff and must be independently re-run against the candidate. Unit tests do not establish database concurrency, deployed policy coverage, browser consent capture, provider retention, biometric accuracy, legal approval or production/device behavior. Full backlog tasks remain subject to those additional deliverables and independent acceptance.
