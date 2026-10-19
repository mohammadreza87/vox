# Local evidence-to-improvement routing workflow

This vertical slice supports minimized signed findings → typed proposal → inert routing artifact → protected deterministic Docker evaluation → signed human review → promotion **readiness** → local rollback rehearsal. It never modifies the serving configuration, repository, production memory, branches, PRs or deployment. The original `index.ts` pure promotion gate remains unchanged.

## Server integration

Import `ImprovementWorkflow` from `./workflow` and construct it with:

```ts
new ImprovementWorkflow({ root: '/private/operator-selected/improvement', trust })
```

`root` is a private durable local directory, separate from Studio state and candidate mounts. `trust` is a server-configured object `{ [keyId]: { role: 'analyst' | 'author' | 'evaluator' | 'human', publicKey: '<Ed25519 PEM>' } }`. All four roles require distinct public key material. No private key is required for listing/reports. Do not accept this configuration or filesystem paths from request input. Production enablement requires operator-provisioned independent credentials/IAM and protected ownership; the demo's fresh host-memory keys are synthetic credentials.

Read-only methods:

- `listReviewQueue(): Promise<{ findings: MinimizedFinding[]; proposals: Proposal[]; candidates: { candidate: ImprovementCandidate; proposalId: string; authorKeyId: string; evaluation?: Attestation<ProtectedEvaluation>; approval?: Attestation<HumanApproval>; eligible: boolean }[] }>`
- `report()` returns sanitized evidence level, audit head/count, candidate digests, evaluation/human decision/rollback status, and explicit `UNAVAILABLE` CI/deployment/cost/production-effect fields.
- `readiness(candidateId)` uses the existing strict gate plus signature, lineage/expiry and artifact checks. It throws for missing, withdrawn or corrupted inputs. A ready result authorizes no external action.

These methods require an authenticated authorized administrator boundary in the caller. Return only explicit projections from the API; never expose root, trust configuration, protected dataset content, private keys or filesystem errors. Missing configuration should return `unavailable`, not construct a new trust store.

Mutations are operator/worker service methods, **not** administrator web endpoints in this slice. Every method takes a caller-supplied stable operation ID, rejects changed replay and serializes cross-process writers:

- `importFinding(op, signedFinding)`: analyst signature purpose `approved_finding`. Strict finding schema permits codes/counts/hash lineage/purpose/retention only; no raw narratives, prompts or commands.
- `proposeRouting(op, proposal)`: strict code-based hypothesis/outcome, exact source and baseline artifact, fixed candidate/case budgets.
- `registerCandidate(op, signedCandidate)`: author signature purpose `candidate_artifact`, exact proposal/evidence/source/digest and one declared routing artifact path. The artifact is JSON data with two bounded routing enums; arbitrary software patches remain unsupported.
- `attachEvaluation(op, signedEvaluation)`: evaluator signature purpose `protected_evaluation`; strict minimized payload/receipt/details reject extra narratives or logs. Exact source, artifact, baseline artifact, dataset, evaluator, image and policy hashes and the frozen proposal case budget are checked; no skipped/invalid/false-success receipt can pass. A final dataset digest is consumed once for the whole registry, including failure. Additional final evaluation needs a newly reviewed corpus.
- `approve(op, signedApproval)`: human signature purpose `release_review`, bound to exact signed evaluation envelope and candidate artifact, with expiry. The demo deliberately uses synthetic human approval.
- `revokeLineage(op, signedRevocation)`: human signature purpose `revoke_lineage`; durable exclusion suppresses future exports, artifact access and readiness. Historical minimal hashes/counts remain in audit; no private text is stored here.
- `rollbackRehearsal(op, candidateId, baselineArtifact)`: verifies the frozen baseline digest and executes local candidate/baseline cancellation routing, recording outputs and the baseline artifact identity. Its receipt explicitly says `comparisonOnly: true`: it compares both configurations in process and does not activate, disable or restore a serving configuration. Deployed rollback and derived-memory repair remain unavailable.

Use `attest(keyId, privateKey, purpose, payload)` and canonical SHA-256 from `contracts.ts` in credential-isolated worker entrypoints. The web application must not manufacture human/evaluator signatures. Observer findings need explicit reviewed minimization and analyst attestation before import. Existing free text is not automatically eligible.

## Isolation and evidence

`evaluateIsolated` runs the fixed evaluator program in a locally present image pinned by `sha256:`. Docker uses no network, read-only root/mounts, UID/GID 65534, no capabilities, no-new-privileges, CPU/memory/PID/time/output limits and no repository, sockets, host keys or production credentials mounted. The candidate is parsed data; neither evidence nor model output becomes a command. The host independently signs the bounded result after checking input hashes. Candidate-authored output/logs cannot certify success. The final corpus is mounted only in the trusted evaluator container, never in an author job/review queue; diagnostics contain aggregate counts, not examples. No arbitrary untrusted author code runs in this implementation.

Docker host/daemon/image and the evaluator host process remain trusted. Containers share a kernel; this is not VM isolation or proof of production service-account separation. Local filesystem owners can rewrite files; hash chaining detects accidental/tampered individual entries, but an operator capable of rewriting the whole audit history is outside this trust boundary. Production append-only retention needs a protected external store/checkpoint. Crashed locks fail closed and need inspected operator recovery. Missing Docker/image, timeout, malformed output or tampered inputs produce no signed pass. Generic software patch execution remains future work.

The toy synthetic corpus exercises cancellation and active-turn preservation only. It establishes neither language quality, real playback cancellation, model/judge calibration, statistical improvement, Promptfoo qualification nor held-out production quality. Training and final synthetic cases are distinct collections; their tiny size and similar semantics do not establish generalization. No private data/provider calls are used.

## Run locally

```sh
VOX_IMPROVEMENT_IMAGE=sha256:<locally-present-reviewed-node-image-id> npx tsx scripts/improvement-demo.ts /tmp/new-private-rehearsal-directory
VOX_IMPROVEMENT_IMAGE=sha256:<same-id> npx vitest run --config scripts/improvement-vitest.config.ts
```

The demo refuses to overwrite an existing directory. It writes immutable audit entries/content-addressed artifacts, public verification keys and a sanitized `report.json` with source-file hashes, exact evaluator receipt, before/after failures and approval/readiness/rollback results. Private demo keys stay in host memory. Omit `VOX_IMPROVEMENT_IMAGE` to run deterministic tests with the Docker integration explicitly skipped. No image is pulled.
