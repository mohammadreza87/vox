# Wave A on main: decisions for the product lead

For: Reza (product lead). Date: 26 Oct 2026. Branch `agent-intelligence-wave-a-main`, verified at
`8dc5b7bd3856e7cfeca7837019254446d6d75ca1` (the tree before the commit that adds this file). The branch is
`main` `7224f40` plus wave A of [the agent intelligence plan](../../AGENT_INTELLIGENCE_SOLUTION.md). It is not
pushed.

This page lists what needs your call before the branch merges to `main` and before each flag is switched on. The
engineering record, with test results and every finding, is [WAVE_A_ON_MAIN.md](WAVE_A_ON_MAIN.md). Nothing on this
page is implemented: each item is waiting for a decision.

**In short.**

- Every wave A feature is behind a server flag, and every flag defaults to off.
- With every flag unset, the branch behaves like `main`, except for the base-behaviour changes in section 1. These
  need your sign-off before the merge.
- The final verification at that commit is clean: both TypeScript checks and ESLint pass, the full suite has 8277
  passing tests and 94 failures that are all sandbox or load-timeout failures, and every flag-matrix row is at its
  recorded result or better (WAVE_A_ON_MAIN.md section 6).
- 17 decisions are open (section 2). Five of them block the merge: (a), (i), (o), (p) and (q). The others block a
  specific flag or a later wiring step.
- No critical, high or medium finding is open. The last QA round left 25 low findings: 5 are folded into decisions
  here ((f), (g), (j), (p), (q)), 3 were record corrections made with this page, and 17 are engineering follow-ups
  (WAVE_A_ON_MAIN.md open issue 14). None of the 17 changes behaviour with the flags unset.

## 1. Base-behaviour changes that need sign-off before the merge

"Base behaviour" is what the runtime does with every wave A flag unset. The rule for this branch is that it matches
`main` `7224f40` exactly. These changes break that rule. Each is either signed off or reverted before the merge.

| # | Change with every flag unset | Why it was made | Decision |
|---|---|---|---|
| B1 | `PUT /api/telegram/payments` is deleted, and `POST` needs a Firebase ID token. Seven of main's tests were removed for it. `POST` also rejects a price id that is not an own property of the Telegram price table (H3). | `PUT` was an unauthenticated writer of paid entitlements. Telegram never calls `PUT`. | (a) |
| B2 | The legacy Telegram webhook (`/api/telegram/webhook`, a different route from B1) declines pre-checkout queries that do not match the price table. It grants an entitlement only for a known price id at its exact USD amount, with tier and duration from the table. It logs fixed codes instead of update bodies. Every Bot API call has an 8 s deadline. | A forged or under-priced `successful_payment` could grant Max for 365 days. Update bodies held personal data. A hung Bot API call held the request open. | (p), new |
| B3 | The gateway's group-memory and relationship-observation gate (`NO_MEMORY`) uses the shared negation rule `negatedMemoryRequest`. It is a strict superset of main's `do not / don't` + `remember / save / store` rule. Since H4 it also matches Persian text after folding tatweel, U+0649, presentation forms and Arabic yeh/kaf. | Main's rule missed real refusals such as "I don't want you to remember this", "never save this" and the Persian forms. The change only ever withholds memory. | (i) |
| B4 | With only `VOICEPRINT_KEY` set (no flag), a voiceprint sweep runs at boot and daily. It deletes templates older than 365 days and those of people who left the org. Main wired only status and delete for that case. | It matches plan 4.3 (delete on leaving, 12 months), and it keeps a rollback of `STUDIO_VOICE_RECOGNITION` from stranding biometric templates. | (q), new |
| B5 | Erasure and retention sweeps run whatever the flags are: a deleted memory erases the supersede notices that name it; a rights erasure erases the person's notices; the `vox_audit` 12-month sweep and the decision-log 90-day sweep run at startup and daily. None of them creates a file or collection, so on a deployment that never turned a flag on they do nothing. | A flag rollback must not strand rows written while the flag was on. | Acknowledge with (f) |

Not exceptions, recorded so that nobody looks for them:

- **openai request headers.** `src/lib/tireh/flags.ts` and the hardening contract name "the openai request headers"
  as a third exception. That came from the develop-based branch (an openai 6.9.1 to 7.x upgrade). On this branch
  `package-lock.json` equals main's (openai 7.39.0), and the Decisions request options (`maxRetries: 0`, the timeout,
  the body without a salt) are the same as main's. There is no header difference. The `flags.ts` header is stale and
  will be corrected in a follow-up commit, which also moves the sha256 pins in the `llm-blocks` tests.
- **Packaging and deployment, not runtime.** `package.json` gains `"engines": { "node": "22" }` and the
  `typecheck:tests` script. `firebase.json` now references `firestore.indexes.json`, so a plain `firebase deploy` also
  deploys the indexes and asks before deleting indexes or field overrides that are not in the file. CI gains a
  `privacy-gates` job and a strict test typecheck step. These need the owner of the deploy to know, not a product
  decision.
- **Test-only changes to main's tests.** `circles-group.test.ts` ('forget me leaves no trace' checks hex-bounded ids)
  and `learning/races.test.ts` (length checked before dereferencing). Three flags-unset Studio suites
  (`production-turn`, `service`, `voice-call`) strip `trailingText` before exact comparisons, so they no longer pin that
  main never sends it (open low finding; the fix is test-only).

## 2. Decisions

Each item gives the context, the options, the recommendation (the engineering view, not a decision) and what is
blocked until it is decided. (a) to (o) were recorded before the final QA round; (p) and (q) come from it, and the
final round also added detail to (f), (g) and (j).

### Blocks the merge to main

#### (a) Legacy Telegram payments route

- **Context.** B1 above. `route.test`'s 'exposes no PUT handler' and the token cases pin it. QA F110, F164, F227, F252.
- **Options.** 1. Sign off the exception and keep it in this branch. 2. Move the payments change to its own security PR
  against `main`, with its own sign-off. 3. Restore main's `PUT` and its seven tests.
- **Recommendation.** Sign off. `PUT` was an unauthenticated entitlement writer, and Telegram never calls it.
- **Blocked until decided.** The merge to `main` (B1 is a flags-unset difference).

#### (p) Legacy Telegram webhook changes with every flag unset (new)

- **Context.** B2 above. The record's decision (a) named only `/api/telegram/payments`; the webhook changes were
  recorded only indirectly (open issue 10 and decision (c)). Main had no webhook test, so none was dropped. Five
  webhook `route.test.ts` cases and `hardening-webhook-timeout.test.ts` pin the new behaviour. QA final round
  (privacy red team and spec conformance), F221.
- **Options.** 1. Sign the webhook changes off together with (a). 2. Gate them behind `TELEGRAM_WEBHOOK_FAIL_CLOSED`, so
  flags-unset equals main again (this reopens the forged-payment path while the flag is off). 3. Split them into the
  same separate security PR as option 2 of (a).
- **Recommendation.** Option 1. The price check closes a real entitlement forgery, the content-free logging removes
  personal data from logs, and the 8 s deadline only bounds a hung call (Telegram drops a pre-checkout answer after
  10 s anyway).
- **Blocked until decided.** The merge to `main`.

#### (i) The shared memory-request negation rule with every flag unset

- **Context.** B3 above. QA F197, F235, F199.
- **Options.** 1. Acknowledge the exception, including H4's Persian normalisation. 2. Keep main's base rule in the
  gateway and use the wider rule only under `STUDIO_IMAGES`.
- **Recommendation.** Acknowledge it. It only ever withholds memory, and it fixes real Persian refusals.
- **Blocked until decided.** The merge to `main`.

#### (q) Voiceprint sweep with only `VOICEPRINT_KEY` set (new)

- **Context.** B4 above. `createStudioVoiceprints` builds the service whenever the key parses, and `runtime.ts` always
  starts the sweep. `VoiceprintService.sweep()` has no flag check. The `runtime.ts` header still says the key alone
  "keeps existing templates deletable (status/delete only)", and does not list `STUDIO_VOICE_SHADOW`. QA final round
  (spec conformance).
- **Options.** 1. Keep the sweep whatever the flag is, record it as a retention exception next to B5, and correct the
  `runtime.ts` header and the S11L spec. 2. Run the sweep only while `STUDIO_VOICE_RECOGNITION` is on (templates written
  before a rollback then stay until the flag returns).
- **Recommendation.** Option 1. It only deletes, it follows plan 4.3, and gating it would strand biometric templates
  after a rollback.
- **Blocked until decided.** The merge to `main`; the documentation fix waits on the choice.

#### (o) Commit trailer for the branch

- **Context.** Commits carry either `Co-Authored-By: Claude Fable 5.1` or `Claude Opus 5.5`. The computed workflow
  tasks ask for Fable 5.1; the session attribution rule says Opus 5.5. This final verification commit carries Opus 5.5
  (the session rule). QA F034, open issue 1.
- **Options.** 1. Fable 5.1. 2. Opus 5.5.
- **Recommendation.** Pick one for future commits before the branch is pushed. Do not rewrite merged history.
- **Blocked until decided.** Pushing the branch.

### Blocks a flag or a wiring step

#### (b) `TELEGRAM_WEBHOOK_FAIL_CLOSED` default

- **Context.** The flag stays off by default because `TELEGRAM_WEBHOOK_SECRET` is set nowhere. Until the secret is set
  and registered as the setWebhook `secret_token`, a forged `successful_payment` at the real price is accepted. QA F097,
  F164, F227, F252.
- **Options.** 1. Name an owner, roll out the secret, then set the flag in every legacy deployment. 2. Flip the default
  to on after the rollout. 3. Retire the legacy webhook (plan step 15).
- **Recommendation.** Name an owner now and roll out the secret with the flag on. Retire the legacy webhook in step 15.
- **Blocked until decided.** Authenticating the legacy webhook; (c).

#### (c) Bind Telegram invoices to a server-side intent

- **Context.** Invoices carry a client-supplied `telegramId`. A server intent with a `from.id` check would charge but
  not grant forwarded or gifted invoices. QA F164, F252.
- **Options.** 1. Add a server-side invoice intent with `from.id` binding. 2. Keep the price, amount and currency check
  once the webhook is authenticated.
- **Recommendation.** Keep the current checks until (b) lands, then add an intent binding if the legacy route is not
  retired.
- **Blocked until decided.** Nothing today; it follows (b).

#### (d) S10L persisted style profile against section 4.9 phase 0

- **Context.** The S10L library persists a per-person style profile with 30/180-day retention. Phase 0 allows only
  7-day observed facts and no persisted identity model. The library is not wired. QA F025, F165, F249.
- **Options.** 1. Amend 4.9 and the DPIA to allow a consented profile. 2. Change the store to 7-day observed facts
  before wiring. 3. Keep it unwired.
- **Recommendation.** Keep it unwired, and change it to 7-day observed facts before step 10 wiring, unless the DPIA is
  amended.
- **Blocked until decided.** Wiring step 10 (identity confidence).

#### (e) Supersede-notice copy and `newMemoryId` for an invisible replacement

- **Context.** `memoryNoticesFor` returns `newMemoryId` even when `replacementVisible` is false (main withheld it),
  which tells the reader that a replacement exists. The notice copy is unreviewed, notices name the original owner
  rather than the superseding speaker, and the Telegram `/memories` notice line waits on the copy. QA F151, F166, F231,
  F210, F063, VF-S08-low-newMemoryId.
- **Options.** 1. Withhold `newMemoryId` unless `replacementVisible` (main's behaviour). 2. Keep the opaque id. 3. Also
  store the superseding source person separately.
- **Recommendation.** Withhold `newMemoryId` unless the replacement is visible, approve the EN and FA copy, then add the
  `/memories` line.
- **Blocked until decided.** `TIREH_SHARING_V2` in production; the `/memories` notice line.

#### (f) Retention periods the plan does not fix

- **Context.** Not fixed by the plan:
  - supersede notices have no TTL;
  - `vox_audit` rows keep person ids for 12 months after a rights erasure;
  - decision-log rows pair `personaId` and an exact timestamp with `personal_life` and `confidential` probabilities;
  - **new in the final round:** `image-v1` decision-log rows (one per triaged Telegram image under
    `TIREH_DECISION_LOG`) hold `image_kind`, `image_task`, `contains_people` and `contains_sensitive_document` next to
    `personaId` and an exact gateway-clock `at`. In a 1:1 chat that timestamp lines up with the person's history rows,
    so "sent a document with sensitivity 0.92" can be linked back to the person, and the rows survive forget and
    rights erasure for 90 days;
  - S14 `vox_reply_style_eval` relies on `sweep()` (H1 adds an unwired sweep helper);
  - S10L uses 30/180 days;
  - S12 image retention.

  QA F167, F250, F198, F064, F153, and the final round's image-v1 finding.
- **Options.** 1. Set explicit periods, for example notices 90 days, decision log 90 days with `at` rounded to the
  hour, eval rows 30 days. 2. Redact person ids in `vox_audit` on erasure with a tombstone token. 3. Keep the current
  state. For image-v1 rows also: 4. drop or bucket the two probabilities.
- **Recommendation.** Notices 90 days; decision-log `at` rounded to the hour; redact `vox_audit` person ids on rights
  erasure; eval rows 30 days through the scheduled sweep at wiring. For `image-v1` rows, also bucket
  `contains_sensitive_document` and `contains_people` (for example below 0.3, 0.3 to 0.6, above 0.6).
- **Blocked until decided.** `TIREH_DECISION_LOG` and `TIREH_SHARING_V2` in production; S14 wiring.

#### (g) Sending a possibly sensitive document image to the decider before a verdict

- **Context.** S12 triage sends a stripped image of at most 512 px to Decisions to learn `contains_sensitive_document`.
  The image leaves before any verdict exists, outside ZDR until ZDR is approved. **New in the final round:** with
  `DECISIONS_SAFETY_ID_SALT` set, image triage also carries a stable salted `safety_identifier` for the sender, so
  possibly sensitive images become linkable per person at the provider before ZDR is approved. QA F105, F168, F251,
  F153, and the final round's decision-log finding.
- **Options.** 1. Accept, with ZDR approval as a precondition for `STUDIO_IMAGES` with `STUDIO_DECIDER=service`. 2. Run
  triage on the approved vision reply provider. 3. Require an explicit processor approval flag, otherwise treat triage
  as null (fail closed).
- **Recommendation.** Make ZDR approval (readiness code `zdr_unconfirmed`) a release gate for `STUDIO_IMAGES`. Until
  then run images without decider triage (fail closed). Do not send `safety_identifier` on image triage until
  `DECISIONS_ZDR_APPROVED` is attested.
- **Blocked until decided.** `STUDIO_IMAGES` in production; setting `DECISIONS_SAFETY_ID_SALT`.

#### (h) Missing `VOICEPRINT_KEY` or invalid thresholds with `STUDIO_VOICE_RECOGNITION=1`

- **Context.** Main failed startup for a missing key and for invalid `VOICE_MATCH_THRESHOLDS_JSON`. This branch treats
  the missing key as off and invalid thresholds as a warning (verification gives no opinion). The production Firestore
  refusal and the invalid-key failure are in place. KMS and key custody remain release gates. QA F158, F240,
  VF-S03-low-missing-key, F024, F068, F116.
- **Options.** 1. Restore main's fail-fast for both. 2. Keep fail-safe off, with a loud startup warning.
- **Recommendation.** Restore main's fail-fast for both when the flag is on: strictly fail closed, and an operator gets
  a signal.
- **Blocked until decided.** `STUDIO_VOICE_RECOGNITION` in production.

#### (j) Default `historyPolicy` for groups without one (re-snapshot)

- **Context.** H6 makes the admin re-snapshot honour explicit values: `since_membership` refuses,
  `all_authorized_history` allows. For groups with no value, H6 keeps today's behaviour (allowed). The S08 policy
  oracle treats an absent value as `since_membership`. **New in the final round:** the type comments on
  `StudioGroup.historyPolicy` and `Group.historyPolicy` say "Default since_membership", which describes the oracle,
  not the runtime. Separately (a code finding, not a decision), a channel can be re-snapshotted but can never be given a
  policy. QA F019, F115, and the final round's spec-conformance and code-quality findings.
- **Options.** 1. Absent means `since_membership` (oracle default): the re-snapshot is refused until an admin sets
  `all_authorized_history`. 2. Absent means `all_authorized_history` (today's re-snapshot behaviour). 3. Migrate
  existing groups to an explicit value.
- **Recommendation.** Option 1, so the runtime matches the oracle and the comments and fails closed. Admins opt in per
  group with the new setter.
- **Blocked until decided.** `TIREH_SHARING_V2` in production; correcting the type comments.

#### (k) Shared-context consent for group audiences under `TIREH_SHARING_V2`

- **Context.** Two base tests in `adaptive/__tests__/shared-memory.test.ts` fail by design under the flag, because v2
  drops every participant's `optional.personalization` requirement, for groups as well. H6 pins them to the flag unset
  and adds flag-on tests. QA F021, F073, F109.
- **Options.** 1. Decouple consent only for a single private reader; keep every-recipient consent for group context.
  2. Decouple for groups too (current v2).
- **Recommendation.** Private-reader-only decoupling. Group context keeps every recipient's consent, which never
  widens.
- **Blocked until decided.** `TIREH_SHARING_V2` in production.

#### (l) Lifetime of inherited S12 image marks

- **Context.** Each reply inherits `suppressed` and `people` from image-marked rows in its context, and inherited rows
  pass the mark on. After one image, every later assistant row in the chat stays suppressed with the people rule on,
  indefinitely. User rows are unaffected. QA F098.
- **Options.** 1. Keep the indefinite chain (fail closed). 2. Bound inheritance with a hop counter (for example
  `EXTRACTION_WINDOW / 2`). 3. Inherit only from original image rows still in the reply context.
- **Recommendation.** Hop counter. It bounds the loss of assistant-row memory and still covers transitive repetition
  within the window.
- **Blocked until decided.** Nothing is unsafe meanwhile (fail closed); memory quality under `STUDIO_IMAGES` suffers.

#### (m) Whose grant allows transfer for successor inheritance

- **Context.** The successor filter reads the plan's grant condition as the predecessor's `memoryPolicy` 'transfer'.
  Section 4.6 can also be read as requiring that every authorised person may use the successor agent. Separately,
  plan 4.6's per-record owner approval for private records is not implemented: v2 never transfers private records
  (fail closed; owner: S08 follow-up or step 7). QA F072, F118.
- **Options.** 1. Keep the `memoryPolicy` reading and document it. 2. Also require `mayUseAgent` for every authorised
  person on the successor (only narrows).
- **Recommendation.** Add the per-person `mayUseAgent` check. It only narrows what transfers.
- **Blocked until decided.** `TIREH_SHARING_V2` in production.

#### (n) Shadow voiceprint verification

- **Context.** `STUDIO_VOICE_SHADOW` uploads biometric audio to pyannoteAI and discards the result until S10 consumes
  it. It is off by default, behind its own flag, and needs `STUDIO_VOICE_RECOGNITION` (H3). QA F131.
- **Options.** 1. Keep it behind its flag for calibration. 2. Remove it until S10's IdentityService consumes the band.
- **Recommendation.** Keep it off. Remove it if S10 is not scheduled within wave B.
- **Blocked until decided.** `STUDIO_VOICE_SHADOW` in any environment.

## 3. Deployment prerequisites

Before the merge and before any flag:

- `npm ci` (the lock pins openai 7.39.0). Node 22 (`engines.node` "22"; do not widen it, firebase-tools 15.34.0
  rejects `">=22"`).
- `npx tsc --noEmit -p tsconfig.json` and `npm run typecheck:tests`, both in CI.
- Make the `privacy-gates` CI job a required status check on `main` and `develop` (repository owner,
  branch protection).
- Run `git worktree prune` outside the sandbox; delete `aiq/harden/H1` to `H9` and `aiq/harden/H8-base` once the record
  is accepted.

Per flag (all default off; read only through `tirehFlags()`):

| Flag | Needs before it is switched on |
|---|---|
| `TELEGRAM_WEBHOOK_FAIL_CLOSED=1` | `TELEGRAM_WEBHOOK_SECRET` in every legacy deployment, registered as the setWebhook `secret_token`; an owner (b) |
| `TIREH_CACHED_PROMPT=1` | Staging run with `count_tokens` per reply model |
| `TIREH_PROMPT_SYSTEM_TAIL=1` | `TIREH_CACHED_PROMPT=1`; a reply model that accepts a mid-conversation system message |
| `TIREH_AUDIT_LOG=1` | On Firestore: `firebase deploy --only firestore:indexes` (the two `vox_audit` indexes); retention (f) |
| `TIREH_SHARING_V2=1` | Deployed `tireh_supersede_notices` and `vox_audit` indexes; decisions (e), (f), (j), (k), (m) |
| `TIREH_RETRIEVAL_V2=1` | The EN/FA memory eval gates on staging data |
| `TIREH_VECTOR_RETRIEVAL=1` | Library only, no runtime effect; leave off |
| `STUDIO_DECIDER=service` | `OPENAI_API_KEY`; attestations `DECISIONS_ZDR_APPROVED=1`, `DECISIONS_EU_ENDPOINT_CONFIRMED=1`; `DECISIONS_SAFETY_ID_SALT` only after confirming `/v1/decisions` accepts `safety_identifier` |
| `TIREH_DECISION_LOG=1` | Retention (f) |
| `TRIAGE_QUESTION_SET=v2` | `STUDIO_DECIDER=service` and `TIREH_DECISION_LOG=1` (without the log, the v2 answers are discarded and only the extra questions are sent) |
| `TRIAGE_QUESTION_SET=v2-live` | The per-question calibration report (plan step 9) |
| `STUDIO_IMAGES=1` | `STUDIO_DECIDER=service`; a vision-capable reply model; `single_party_image` approvals; ZDR approval (g); (l) |
| `STUDIO_VOICE_RECOGNITION=1` | `VOICEPRINT_KEY` (dedicated 256-bit key), `VOICE_MATCH_THRESHOLDS_JSON` (no built-in thresholds), `PYANNOTE_API_KEY`; KMS envelope encryption and key custody; counsel's opinion; jurisdiction registry; (h); not with the local voice engine |
| `STUDIO_VOICE_SHADOW=1` | `STUDIO_VOICE_RECOGNITION=1`; (n) |

S10L (identity library) and S14 (reply-style bandit) have no flag and are not wired; they wait on the DPIA and on (d)
and (f).

## 4. Suggested flag rollout order

One flag at a time, staging first, then a small production cohort. Each step names what to measure before the next
one starts. The plan's own gates (section 5 of the plan) are in bold.

| Order | Flag | Measure before the next step |
|---|---|---|
| 0 | none (merge with every flag unset) | One week of the step 0 baselines on the merged build: p50/p95 per route, correction rate per 100 turns, the content-free stage timings (`STUDIO_STAGE_TIMINGS`). No change against main is expected; any change is a regression. |
| 1 | `TELEGRAM_WEBHOOK_FAIL_CLOSED=1` | Independent of the rest; do it as soon as (b) has an owner. Zero rejected genuine Telegram updates over a week (`telegram_webhook:<code>` counts), then retire or keep the route (plan step 15). |
| 2 | `TIREH_CACHED_PROMPT=1` | **`cache_read_input_tokens` at least 70% in staging**; reply quality unchanged (correction rate within noise); prompt hash churn per conversation. Then, as an A/B arm only, `TIREH_PROMPT_SYSTEM_TAIL=1` on a model that accepts it, compared on the same metrics. |
| 3 | `TIREH_AUDIT_LOG=1` | `audit_append_failed` and `audit_append_timeout` near zero; turn latency unchanged; the daily sweep runs without `sweep_failed`. |
| 4 | `TIREH_SHARING_V2=1` | The privacy gates green on every build (**differential test green on every fixture**); notice volume per person; `memoryNoticesFor` latency (up to 400 reads per request today); re-snapshot refusals; zero leakage reports. Enable soon after its decisions: the base successor copy includes private and sensitive records. |
| 5 | `TIREH_RETRIEVAL_V2=1` | **Memory eval gates: recall@8 and leakage = 0** on EN and FA; Recall@3 is 0.980 against 0.987 for v1 today; prompt memory count and turn latency. |
| 6 | `STUDIO_DECIDER=service` | Decisions p50/p95 from the deployment region (and the EU endpoint); timeout, refusal and malformed rates; triage-null rate against the default decider; **Decisions no longer on the critical path**. |
| 7 | `TIREH_DECISION_LOG=1`, then `TRIAGE_QUESTION_SET=v2` (shadow) | Log volume and sweep health; v2 refusal and malformed rates (a refusal on any shadow question also discards the v1 triage); then collect **at least 200 labelled EN and 200 labelled FA examples per question** and write the calibration report before `v2-live`. |
| 8 | `STUDIO_IMAGES=1` | Only after (g)'s ZDR gate. p95 image-turn latency on real Telegram; triage-null rate; suppressed-memory rate; sensitive-document and people rates; no image bytes or captions in any log; Persian and code-switched acknowledgements. |
| 9 | `STUDIO_VOICE_RECOGNITION=1` (enrollment), `STUDIO_VOICE_SHADOW=1` for the first month | **FAR at most 0.5% at FRR at most 5% on audio of 5 s or more, in both languages**, on consenting members; counsel's opinion before any non-shadow use. |

## 5. Open engineering items that are not decisions

The 17 open low findings are listed in WAVE_A_ON_MAIN.md section 7, open issue 14. They are test robustness (two
load-only flakes, a weakened flags-unset assertion, a test typecheck list that stopped growing), stale specs and
comments, and code-quality items under `TIREH_SHARING_V2` and S11L (re-snapshot audit rows without a chat-key hash or
a bounded writer, up to 400 reads per notices request, four sweep schedulers, a dead unbounded `list()`). None needs
your call. The five low findings that did need it are folded into (f), (g), (j), (p) and (q) above.
