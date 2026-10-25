# Wave A integration (agent intelligence, 22 Oct 2026)

Branch `agent-intelligence-wave-a`, built in the worktree `$TMPDIR/vox-wave-a`. It is not pushed.

## Integration base

`9144c2eb3ee107cef89d0b4819ac3aae0412ed47` is the local branch `step1-into-develop`, now also on origin. It contains:

- `origin/develop` at `39ef433`;
- Step 1, merged as PR #104: the narrowed gateway, `boundary()` once per turn with a scalar `unchanged()`, and the `readCommittedForEffect` turn-snapshot loader.

Every step branch was cut from `6d00b8066e5d8e8d444bb47d978aa571e20929df`. The integration base contains all of that commit.

Nothing in this integration changes Step 1's code:

- `gateway.boundary()`, `gateway.unchanged()` and the liveTurn recheck loop;
- `Studio.adaptiveContext` and `loadTurnSnapshot`;
- the adaptive persistence seams.

## Merged step branches

The branches were merged with `git merge --no-ff`, in the architect's order.

| Order | Step | Branch | Branch tip | Merge commit | Conflicts |
|---|---|---|---|---|---|
| 1 | S14 reply-style bandit library | `aiq/bandit-lib` | `57e2d6c` | `7127eba` | none |
| 2 | S10L identity library | `aiq/identity-lib` | `b34b7c0` | `b278780` | none |
| 3 | S15 vendor hygiene (openai 7.34.0) | `aiq/vendor-hygiene-r2` | `25b3a82` | `b36da3a` | none |
| 4 | S09 pre-pass v2 and decision log | `aiq/prepass-v2-r2` | `917b330` | `6cbe4bc` | none |
| 5 | S06 memory record v2 and retrieval | `aiq/memory-v2-retrieval-2` | `1bef816` | `0ba3de6` | `memory/file-store.ts`, `memory/firestore-store.ts` |
| 6 | S08 sharing v2 and audit | `aiq/sharing-audit-r2` | `0926957` | `bedca98` | none |
| 7 | S11L voiceprint library | `aiq/voice-lib-r2` | `ca7c27c` | `17ddf29` | none |
| 8 | S03 cache-stable prompt | `aiq/prompt-caching-r2` | `ce37a8b` | `aeeab39` | none |
| 9 | S12 image ingestion | `aiq/image-ingestion` | `2bdb95f` | `1a3437c` | none |

### Conflict resolutions

Both S06 conflicts were resolved by keeping both sides.

- **`file-store.ts`:** the lock wrapper now lists both sets of methods:
  - mutations: `addTombstones` (from S06);
  - reads: `revisionProbe` (from Step 1) and `tombstonesOf` (from S06).
- **`firestore-store.ts`:** both imports are kept: the `RevisionProbe` type from Step 1 and `stripEmbeddingUnlessNormal` from S06.
- **Tombstones and revisions:** `addTombstones` does not bump the memory revision, so Step 1's revision probes are unaffected.

### Integration commits after the merges

- **`9235a6d` S09 handoff test:** the test pinned the provider timeout at 500 ms before S15 landed. S15's provider now uses `options.timeoutMs`, capped at 5000, and falls back to 500 when the option is absent. The test now checks both cases. With flags unset, `DecisionService` still passes 500.
- **`9235a6d` invariant (12):** this test assumed that `InMemoryMemoryStore` has no tombstone methods. After S06 it does. The test now checks that the real store carries tombstones the same way the contract subclass does. A store without the optional methods must still inherit nothing (fail closed).
- **`ca4035b` sharing-v2 suite:** the same S06 interaction applies in `src/lib/studio/__tests__/sharing-v2.test.ts`. I added a case for the real store and kept the fail-closed case.
- **`a40e8f8` images-gateway and revision-compare tests:** both suites now read the text the model sees, which is the system text plus `trailingText` and `systemTail`. Before this, they failed under `TIREH_CACHED_PROMPT=1`. revision-compare is Step 1's suite. These edits change nothing when the flag is unset.
- **`d3dac45` Firestore index:** adds the `vox_audit` composite index (`personaId` ASC, `at` DESC) to `firestore.indexes.json`, as S08 asked. `firebase.json` is unchanged, so deploying the index is still a manual step.
- **`56a4e98` image decider type:** S12 now uses S09's `DeciderPart` instead of its local copy of the same type.

### Install

After S15 merged, I replaced the `node_modules` symlink with a real `npm ci --cache "$TMPDIR/npm-cache"`. The registry was reachable, and openai 7.34.0 is installed. In the main checkout, `node_modules` still has 6.9.1. Run `npm ci` there after this branch lands.

## Shared files

The sha256 of each shared file matches the contract:

- `src/lib/tireh/flags.ts`: `6b8edcd4…6630`
- `src/lib/tireh/llm-content.ts`: `4c83fe24…e663`
- `src/lib/tireh/identity/voice-band.ts`: `b8d0a41d…21bd`

## Flags

Every flag defaults to off. With all of them unset, the runtime behaves as the integration base does, with two exceptions:

- The openai 7.x SDK's `X-Stainless-*` headers on Decisions requests; see S15.
- **Legacy Telegram payments (fixer commit `169d16d`, an explicit exception kept on QA round 2's recommendation, pending product sign-off):** `PUT /api/telegram/payments` is deleted, because it wrote an active subscription from an unauthenticated, caller-supplied `successful_payment` and approved every `pre_checkout_query`. `POST /api/telegram/payments` now needs a Firebase ID token and takes the invoice `userId` from the token. Telegram delivers payment updates by POST to `/api/telegram/webhook`, which is unchanged. The fail-closed webhook verifier from the same commit is not part of the exception: it is behind `TELEGRAM_WEBHOOK_FAIL_CLOSED` (below), so with flags unset a deployment without `TELEGRAM_WEBHOOK_SECRET` still receives payment updates as before. Seven tests were removed with the PUT handler and the body-only `userId` contract: `returns 400 when userId is missing` (the user now comes from the ID token; replaced by the four ID-token tests), and the six PUT tests `accepts pre-checkout query`, `updates user subscription on successful payment`, `sets correct tier for max plan`, `sends confirmation message to user`, `returns success for empty webhook` and `returns 500 on processing error` (replaced by a test that no PUT handler is exported).

| Env | Step | Default | Effect when set |
|---|---|---|---|
| `TIREH_CACHED_PROMPT=1` | S03 | off | System blocks A/B/C plus a per-turn block in the newest user turn |
| `TIREH_PROMPT_SYSTEM_TAIL=1` | S03 | off | Sends the per-turn block as a trailing system tail; needs `TIREH_CACHED_PROMPT` |
| `TIREH_RETRIEVAL_V2=1` | S06 | off | Persian-aware fused ranking; default limit 8 |
| `TIREH_VECTOR_RETRIEVAL=1` | S06 | off | `findNearest` candidates; needs `TIREH_RETRIEVAL_V2` and Firestore; not wired yet |
| `TIREH_SHARING_V2=1` | S08 | off | Successor filter, supersede notices, readContext consent decoupling, group re-snapshot |
| `TIREH_AUDIT_LOG=1` | S08 | off | Content-free `vox_audit` rows |
| `STUDIO_DECIDER=service` | S09 | `default` | Triage through `DecisionService` (`ServiceDecider`) |
| `TRIAGE_QUESTION_SET=v2\|v2-live` | S09 | `v1` | v2 shadow questions; `v2-live` also adjusts `readTriage` |
| `TIREH_DECISION_LOG=1` | S09 | off | Content-free decision log rows, kept 90 days |
| `STUDIO_IMAGES=1` | S12 | off | Telegram photo and image-document ingestion, private chats only |
| `STUDIO_VOICE_RECOGNITION=1` | S11L | off | Voiceprints; also needs `VOICEPRINT_KEY`, approval and consent |
| `STUDIO_VOICE_SHADOW=1` | S11L (fixer) | off | Shadow verification of 1:1 voice notes, off the reply path; needs `STUDIO_VOICE_RECOGNITION` |
| `TELEGRAM_WEBHOOK_FAIL_CLOSED=1` | fixer (legacy) | off | `/api/telegram/webhook` rejects every request when `TELEGRAM_WEBHOOK_SECRET` is unset; turn on only after the secret rollout (open issue 8) |

S10L and S14 are libraries that are not wired in and have no flag.

## Results (in `$TMPDIR/vox-wave-a`, real node_modules)

- **Lib-scoped tsc** (contract tsconfig, including `EnrollScreen.tsx`): exit 0.
- **`npx tsc --noEmit -p tsconfig.json`:** exit 0 with no errors. develop has fixed the `Privacy.tsx(111,6)` TS17008 error from the 6d00b80 baseline.
- **ESLint** on every `.ts`, `.tsx` and `.mjs` file changed since `9144c2e` (140 files): exit 0.
- **Full `npx vitest run`, flags unset:**
  - 12 failed files, 53 failed tests, 5852 passed, 14 skipped, 11 unhandled errors.
  - All of the failures are sandbox or baseline failures (listed below), except `message-memory.test.ts`. That suite failed once under full-suite load and passed 38/38 in three runs on its own; it passed in the first full run too.
  - The 11 unhandled errors are listen EPERM in the connections broker tests.

### Flag matrix

| Command | Result |
|---|---|
| `TIREH_CACHED_PROMPT=1 npx vitest run src/lib/tireh` | 10 failed / 1290 passed: exactly the 10 failures S03 expected (below) |
| `TIREH_RETRIEVAL_V2=1 npx vitest run memory-privacy, visibility, memory-eval` | 41/41 passed |
| `TIREH_SHARING_V2=1 TIREH_AUDIT_LOG=1 npx vitest run invariants, policy-differential, src/lib/studio` | 12 failed / 1213 passed: 1 failure by design (below), the other 11 sandbox or baseline |
| `STUDIO_DECIDER=service TRIAGE_QUESTION_SET=v2 TIREH_DECISION_LOG=1 npx vitest run src/lib/tireh src/lib/adaptive/decisions` | 1404/1404 passed |
| `STUDIO_IMAGES=1 npx vitest run src/lib/tireh` | 1300/1300 passed |
| `STUDIO_VOICE_RECOGNITION=1 npx vitest run src/lib/studio/__tests__/voiceprint*` | 90/90 passed |
| Informational: every flag on, `src/lib/tireh` | 13 failed: S03's 10, plus 3 golden snapshots that S03 pinned for "every flag unset" (they cannot hold while other flags are set in the environment) |

#### Expected failures with `TIREH_CACHED_PROMPT=1`

These existing suites assume a string `system` or an unshifted saved-context message. Each one has a passing port in `cached-prompt-ports.test.ts`.

- `diagnostics`: 1
- `gateway`: 5
- `history-privacy`: 3
- `voice-delivery`: 1

#### By design with `TIREH_SHARING_V2=1`

`src/lib/studio/__tests__/service.test.ts` "a successor inherits memories at hire time when the predecessor was fired with transfer". This test pins the base behaviour, in which a successor copies private records.

### Sandbox-only failures (flags unset)

These match the documented 6d00b80 baseline.

- **mkdtemp /tmp EPERM:** `studio/guest-rights-http`, `adaptive/guest-rights/guest-rights`, `adaptive/rights-intake/storage`.
- **listen 127.0.0.1 EPERM:** `connections/__tests__/integration-broker`, `foundation-broker`, `foundation-broker-error-http`, `adaptive/runtime/reminders/reminders`.
- **tsx child IPC:** `adaptive/personalization/learning/rollback`.
- **Timeouts or loopback (baseline):** `adaptive/lifecycle/longterm-simulation`, `adaptive/observation/service`, `studio/__tests__/prepared-conversation-qualification`.
- **Load flake:** `adaptive/message-memory/message-memory`, which passes alone.

## Open issues

1. **Commit trailer:** the computed task asked for `Co-Authored-By: Claude Fable 5.1`, but this session's attribution rule says `Claude Opus 5.5`. My integration commits use Opus 5.5. The step branches mix both (for example, S09 has 10 commits with Fable and 16 with Opus).
2. **S03:** I did not measure cache hit rates, and I did not check that each reply model accepts a mid-conversation system message. Both need staging. Studio suites under `TIREH_CACHED_PROMPT=1` are not ported: several Studio tests read `request.system` as a string.
3. **S06:**
   - Retrieval v2 with RRF K=60 compresses lexical strength: recall@3 is 0.980 against 0.987 for v1. We need a held-out set of real EN/FA conversations.
   - Embeddings, query embedding, `vectorCandidates` and retrieval counters are not wired yet.
   - A missing vector index makes retrieval silently return no candidates.
   - The base bug in `FirestoreMemoryStore.updateIfShareVersion` (it turns Timestamps into maps) is still there.
4. **S08:**
   - Enable `TIREH_SHARING_V2` soon: the base successor copy includes private and sensitive records.
   - The Telegram `/memories` notice line and the reserved audit kinds are still TODO.
   - The supersede-notice copy needs product review.
5. **S09:**
   - `DecisionService` checks `error.name === 'APIConnectionTimeoutError'`, but the SDK leaves `name` as `'Error'`, so provider timeouts are logged as `provider_error`. It should use `instanceof`.
   - Do not run `src/lib/studio` under `TRIAGE_QUESTION_SET=v2`: its triage tests pin the v1 list.
   - Measure refusal and malformed-answer rates before combining `STUDIO_DECIDER=service` with v2.
6. **S12:**
   - The default decider has no `decideParts`, so with only `STUDIO_IMAGES=1` set, image triage is null. Full routing needs `STUDIO_DECIDER=service`.
   - `image-v1` decision-log rows are not written.
   - Verify progressive JPEGs with a real Telegram photo.
   - Download, triage and the acknowledgement now run after the turn boundary's audience check (QA round 3), but a paused memory or history setting still lets an image be triaged and answered. Revisit this against Step 1's `loadTurnSnapshot`.
   - Measure p95 latency.
   - An `extract_text` reply can put document text into the person's own private history. The privacy owner should review this.
7. **S11L:**
   - The pyannoteAI adapter has not been tested against a live account.
   - KMS envelope encryption and key custody are release gates. The runtime does not refuse to start on Firestore with the flag on; consider restoring the earlier guard.
   - Shadow verification no longer delays a reply: it runs fire-and-forget with a 3 s abort signal, and only with `STUDIO_VOICE_SHADOW=1`, so `STUDIO_VOICE_RECOGNITION=1` alone uploads no voice-note audio for verification. S10 will need to await the result, so measure that latency first.
   - `setVoiceIdentityInvalidator` is a single slot.
   - The EnrollScreen FA strings need native-language review.
8. **S15:**
   - `PUT /api/telegram/payments` is deleted and `POST` needs a Firebase ID token (fixer commit `169d16d`; see the Flags exception). Still open: `TELEGRAM_WEBHOOK_SECRET` is set nowhere in the repo (no apphosting or env example), so the legacy webhook is unverified until it is set in every legacy deployment, registered as the setWebhook `secret_token`, and `TELEGRAM_WEBHOOK_FAIL_CLOSED=1` is turned on. Owner for that rollout: not yet named; Reza to assign. QA round 3 asked for fail-closed in production by default; that changes flag-unset behaviour (deployments without the secret would stop taking payments), so it is left to that decision. The webhook now checks `priceId`, amount and currency against the shared price table on both `pre_checkout_query` and `successful_payment`, takes tier and duration from the table, and logs only fixed codes, so a forged update can no longer buy `max_annual` for 1 XTR. A forged update at the real price is still accepted while the secret is unset. Binding the payer's `from.id` to a server-side invoice intent is not done: the invoice `telegramId` is client-supplied, and a forwarded invoice would then be charged but not granted (product decision).
   - openai 7.x needs Node 22 or later. Confirm that the Firebase/App Hosting runtime uses Node 22.
   - The main checkout needs `npm ci`.
9. **S10L and S14:** not wired in, and they wait on the DPIA. S10L's calibration uses synthetic data only.
10. **Firestore indexes:** deploy `firestore.indexes.json` (the `tireh_memories` vector index and the `vox_audit` composite index) by hand. `firebase.json` does not reference the file.
11. **Housekeeping:** `git worktree prune` cannot delete the stale `.git/worktrees` entries inside the sandbox (EPERM). Run it outside the sandbox.
