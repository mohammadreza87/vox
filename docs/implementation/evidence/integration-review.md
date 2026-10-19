# Independent composed integration review

Reviewer: `release_preflight`, applying `vox-release-engineer`. Date: 19 October
2026, Europe/Tallinn. This review is independent of the integration authors.
Production source was read-only; reviewer-owned additions are this report and
`src/lib/tireh/__tests__/integration-independent.test.ts`.

## Candidate and disposition

**No unresolved blocker found in the bounded source/local scope reviewed.** The
intended release target is the existing Mac Studio file-storage/polling profile,
with adaptive capabilities and relationship outreach unavailable. This is not a
deployed-path acceptance or a claim that optional adaptive features are qualified
for activation.

Candidate HEAD was `f93c45f219652e9becaf0c4bff17d0a35f8d9e11`, with the adaptive
merge and integration edits in the working tree. The review run began at
`2026-10-19T18:26:51.560565Z` (21:26 local). Its 487-file source fingerprint was
`61ee406078e0fcc0c0dd74686f58be30be8b952f1d5401c9a55070a921accf24`, identical
immediately before and after execution. The fingerprint uses the sorted union of
`src/**/*.ts`, `src/**/*.tsx`, `src/**/*.css`, `package*.json`, `tsconfig*.json` and
`vitest.config.*`, hashing each repository-relative UTF-8 path, NUL, raw bytes,
NUL. Documentation and generated build files are excluded. Subsequent source
edits require relevant revalidation and a new final release identity.

## Finding and correction

The integration initially retained the legacy `forgetOwnedContext` receipt,
claiming all memory and future conversation context had been cleared, while
adaptive Private and Shared notes remained untouched. The reviewer reported this
source defect; the Tireh integration owner corrected the receipt before the first
independent execution. It now explicitly limits the completed operation to earlier
conversation history and automatically captured memories, states that saved notes
remain, and directs the person to Privacy / Shared Memories deletion controls.

The independent regression verifies both honest guidance and that the synthetic
permitted adaptive note survives. No cross-store deletion implementation or
deletion guarantee was invented. A historical failing execution is not claimed.

## Reviewed behavior and checks

- Studio constructs adaptive privacy authority in the actual runtime and leaves
  the legacy relationship loop unavailable. Gateway relationship grounding,
  observation and proactive context are denied when adaptive privacy is present.
- Personal realtime-session creation falls back to scoped tap-to-talk. Streaming
  prompt construction excludes prior unstamped voice-platform turns and the Work
  directory; only the current utterance and authorized context are supplied.
- Streaming rechecks source/policy and audience authority before emitting each
  chunk. Independent synthetic source-revocation and audience-revocation cases
  suppress subsequent chunks and leave no retained legacy history.
- The reviewed group transport refreshes the Telegram roster before final sends,
  then rechecks the captured adaptive boundary, history epoch and live group
  permissions. Private loaders are excluded from group context. Source deletion,
  grant changes and audience epochs invalidate stale work in the selected suites.
- File-store wrappers use one process-independent lock per operation; their
  prototype-level helpers avoid reacquiring that lock during epoch writes or
  history invalidation. Selected restart, concurrent-write, stale-write and
  physical-erasure regressions passed without a nested-lock timeout.
- Legacy sharing writes are denied by the server when adaptive authority exists;
  the client receives the corresponding feature flag. Existing legacy note
  inspection/deletion remains a distinct management path.

Independent command:

```sh
npx vitest run src/lib/tireh/__tests__/integration-independent.test.ts src/lib/tireh/__tests__/history-privacy.test.ts src/lib/tireh/__tests__/file-store.test.ts src/lib/adaptive/__tests__/delivery-security.test.ts src/lib/studio/__tests__/adaptive-integration.test.ts
```

Result: **50 tests / 5 files passed, exit 0**, 5.27 seconds. This includes four new
reviewer-owned cases. `git diff --check` also passed at review time. All identities,
notes, providers, Telegram responses and stores used by these tests were synthetic.
No credentials, paid inference, external messages or live private data were used.

## Limits and release handoff

Already emitted stream chunks or externally delivered Telegram audio cannot be
recalled. A fresh check followed by a transport call is not an atomic distributed
reservation. Provider-side cancellation/deletion, Telegram membership completeness
under real concurrent changes, Firestore/IAM, backup restoration/tombstone replay,
production load and physical-device playback remain separate qualifications.

The root release owner owns final composed tests/build, merge identity, backup,
Mac deployment and exact live revision/endpoint verification. This report does
not establish those outcomes. Optional Decisions, automatic learning, biometric
recognition, external notifications and autonomous improvement remain unavailable
under the default-disabled configuration; their activation gates are outside this
bounded integration review.
