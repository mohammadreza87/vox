# Independent planning-package review

Task: **CONN-PLAN-SEC-REVIEW**. Date: 19 October 2026. Reviewer: `connections_security_qa`; author of the separate `SECURITY_AND_QA.md`, **not** author of the five package documents reviewed below. Base: `42a1a57113e655b6185ddc731b6f9617aaa4bb4e`. Evidence level: **E0, document/source review only**. No product implementation, provider account/credential access, paid calls, messages, deployment or device testing was performed.

## Scope and candidate identity

Reviewed the integrated plan, primary-source research summary, runtime-skill design, architecture and experience specification for concrete authorization/data-flow gaps, contradictory contracts and implementation sequencing. The reviewer did not edit these five documents; their authors applied the changes, then the reviewer independently reread the relevant candidate text.

| Reviewed path, relative to `docs/connections/` | SHA-256 after corrections |
|---|---|
| `PLAN.md` | `cd691e2043050bbd985b2858ad6ab92a496d141c9a0108996b78ee89c67f2d7c` |
| `RESEARCH.md` | `c19db81b0491287efc744ad34a659487c7b314f8f13c3cc8f4443476d2ac2ab2` |
| `RUNTIME_SKILLS.md` | `a38affba51cadcbe379c8ed49b73080d1f6352e38c867da2b93337af30b65bf1` |
| `ARCHITECTURE.md` | `577de19747ded7c78d854a6bdbd1b777188502662fc71e9d9a48fd0e49a9fa73` |
| `EXPERIENCE.md` | `b16ce1c76c0def77807fd0ef70a046375248f2a337215e34217fb5e068494557` |

These are identities of the reviewed saved files, not a commit or immutable release artifact. Later edits require an appropriate delta review and refreshed digests. The review does not accept backlog execution, development-skill discovery/behavior, or the reviewer's own security contract.

Final-freeze delta review: the lead changed only `PLAN.md`'s **First implementation assignment** paragraph after the initial review. Independent reread accepted the dependency-ready dispatch wording, inclusion of `CONN-028` budgets/health/kill switches in the synthetic slice, first real providers `CONN-011/012`, and independent later-provider eligibility research. This is a planning-sequence clarification, creates no external-action authority, and leaves prior findings/gates unchanged. Only the PLAN digest above was refreshed for this delta.

## Findings and independent recheck

All line references below refer to the corrected candidate unless explicitly marked original. The synthetic examples are reasoning probes against the design, not executed runtime tests.

| Finding / severity | Original problem and minimal probe | Author's remediation and independent recheck | Disposition |
|---|---|---|---|
| **SEC-REV-01 / P1** | Original `ARCHITECTURE.md:221–224` required generated-argument lineage validation without defining a trustworthy derivation rule. A model sees private mail, paraphrases its contents into a public read/search query, then claims only public source IDs. Schema validation or model-proposed provenance cannot prove the query is uninfluenced. | [`ARCHITECTURE.md:225`](../ARCHITECTURE.md#containment-before-any-model-input) assigns the restriction intersection of **all** model-visible context in server code and records the context labels before generation. Line 226 denies egress against that full label; narrower use requires an independently approved projection and fresh isolated generation with no hidden prior conversation state. It explicitly rejects source-ID/citation subsets, model non-use claims and semantic scanners as declassification authority. | **RESOLVED IN PLAN TEXT.** Runtime all-context propagation and held-out paraphrase/inference tests remain required. |
| **SEC-REV-02 / P2** | Original `EXPERIENCE.md:69–82` placed a Personal Gmail card inside a Work · HOOR Connections list, conflicting with private-space-only Gmail and concealing scope semantics. | [`EXPERIENCE.md:69`](../EXPERIENCE.md#3-navigation-and-short-flow) through 82 now shows a Work Slack account instead; the sample no longer advertises Personal account metadata in Work. Scope and owner-only list requirements remain explicit. | **RESOLVED IN PLAN TEXT.** Cross-space list/metadata denial still needs implementation tests. |
| **SEC-REV-03 / P2** | Original `EXPERIENCE.md:149,243` described selecting a current/user tab while architecture required an isolated worker with no personal desktop profile. No local attachment bridge/security contract existed. | [`EXPERIENCE.md:149`](../EXPERIENCE.md#4-service-specific-resource-vocabulary) and 243 now identify a tab inside an isolated Vox worker bound to connection/owner/space, disclose worker-session identity, and exclude attaching existing personal Chrome tabs/profiles. Copy at line 386 and acceptance `CONN-UX-11` at 453 match. This agrees with [`ARCHITECTURE.md:298`](../ARCHITECTURE.md#browser-and-ssh-workers) through 304. | **RESOLVED IN PLAN TEXT.** Browser/session isolation and real human-login handoff remain later independent gates. |
| **SEC-REV-04 / P2** | Original `ARCHITECTURE.md:125` required `argumentsRef: string` but line 148 said it was absent for nonretained operations, while orchestration used a durable queue. Missing payload could invite reconstruction or unsafe redispatch after a crash. | [`ARCHITECTURE.md:125`](../ARCHITECTURE.md#proposed-server-contracts) through 127 defines retained/ephemeral payload variants. Lines 150–152 require possession/validation of the live ephemeral payload, forbid later queued dispatch/resume/retry after loss, distinguish predispatch expiry/cancellation from possible-dispatch unknown outcome, and forbid reconstruction. Missing/deleted/revoked/revised retained payload denies dispatch. Failure obligations repeat these cases. | **RESOLVED IN PLAN TEXT.** Store/worker contracts, crash/replay tests and provider reconciliation remain unimplemented. |

No additional blocking contradiction was identified in the five reviewed documents after these corrections. This is bounded review evidence, not a completeness or security guarantee. The conservative context rule can reduce multi-connector usefulness; implementation must preserve the boundary while using reviewed projections/isolated tasks rather than weaken it to improve task success.

## Security-document peer review and amendments

`SECURITY_AND_QA.md` was authored by this reviewer and is deliberately excluded from the independent acceptance above. Its initial peer review was performed by the separate **UX designer**. That review requested clearer Telegram authentication-freshness wording and a distinction between attacker account substitution and a legitimately selected unintended OAuth account.

The author amended that document to:

- Describe server-verified Telegram identity and `auth_date` freshness; adult eligibility remains a separate gate.
- Make `CONN-QA-03` reject attack flows while allowing a valid but unintended provider account to remain pending/ungranted for fresh authenticated review or cleanup.
- Define broker-assigned all-model-visible-context restrictions in `CONN-SEC-03`, with adversarial provenance/paraphrase cases in `CONN-QA-09`.

The **root/lead reviewer, a non-author of these amendments**, independently read the revised sections and accepted them **as plan text** in the coordination response. Amendment identity: SHA-256 `159e578dc4061b772f4ad1033bf414982b6b8db1445f918d2ecaee407bd94829`. The author does not self-accept those edits. Neither peer review nor amendment review establishes runtime correctness, legal/provider clearance or full independent security certification.

## Checks and gate status

| Check / gate | Result | Evidence and limitation |
|---|---|---|
| Independent reread of four remediations | **PASS — E0** | Saved text, linked sections and candidate hashes above; no implementation behavior claimed |
| Whitespace/diff formatting | **PASS** | `git diff --check` returned exit 0 after corrections; this does not lint or semantically validate untracked Markdown |
| Source/provider factual boundaries | **PASS — bounded E0 review** | Package separates documented capability, local Gamend source and actual account/deployment acceptance; this review did not probe live targets |
| Runtime security, broker/vault/IAM separation, rules/egress enforcement | **UNAVAILABLE** | Proposed, not implemented or independently executed here |
| Real provider scopes/eligibility/account tests and revocation | **UNAVAILABLE** | Need specifically authorized test accounts, cost/recipient/data boundaries and independent execution |
| Physical iOS/Android/Telegram Desktop/browser flows and native Persian approval | **UNAVAILABLE** | Later device/copy gates; planning examples cannot satisfy them |
| Legal/provider contractual decisions, retention/transfer review | **OPEN NAMED GATES** | Privacy/operator/provider owners retain the decisions; no compliance claim |
| Development-agent skill forward-testing | **OUT OF THIS REVIEW** | A separate evaluator/assignment reports it; this record does not certify skill loading, model access or behavior |

**Disposition:** the five reviewed documents' four findings are resolved at the planning-contract level. Ready for the lead's planning-package disposition with the open gates carried into the backlog. Next owners: lead integrates exact candidate; architecture/frontend implement frozen contracts; independent security/QA later test that implementation; provider, privacy and release owners resolve their respective enablement gates.
