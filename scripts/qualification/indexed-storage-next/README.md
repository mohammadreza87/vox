# Indexed storage native Next packaging qualification

This isolated synthetic fixture qualifies exact better-sqlite3 13.0.3 (SQLite 3.53.4) in Next 15.5.28 standalone output on **Node 22.23.3**. React/ReactDOM are 19.2.0. The exact PostCSS 8.5.31 override matches the application's selected patched dependency; the lock pins the entire fixture graph. It imports no Vox code, environment files, credentials, provider clients or production data and enables no storage format or grants. This is not actual AdaptiveStorage, authentication, lineage, migration, deployment or performance acceptance.

## CI job contract

Root owns workflow changes. After independent source review, use a fresh Linux x64 glibc CI worker with Node **22.23.3**, from the repository root:

```sh
node scripts/qualification/indexed-storage-next/qualify.mjs build linux-amd64-node22-ci
node scripts/qualification/indexed-storage-next/qualify.mjs run linux-amd64-node22-ci 3142
```

Run the second command only after the first succeeds. The fixture owns its exact install and does not need repository node_modules. No secrets are needed; do not pass production variables. Do not restore attempt outputs from a CI cache. The generated npm cache is separate from evidence and may be cached using the exact fixture lock/target key. For diagnostics, upload `scripts/qualification/indexed-storage-next/attempts/linux-amd64-node22-ci/evidence/` even after failure. This includes logs, responses, input/build/runtime manifests and failure or success receipts, not a claim of acceptance by itself.

A repeated attempt must use a new name and retain its failed evidence. Existing attempt directories/logs are never silently overwritten. There is no automatic retry of storage requests or mutations. Build and run are separate phases so a failed audit/build never launches a server. Independent review and actual CI results must be pinned separately from the source manifest; this repository copy has not itself been executed locally.

## Preserved executable checks

- `build` verifies every source-manifest entry, copies only this fixture to an attempt, installs the exact lock with lifecycle scripts disabled, and hard-fails on any npm audit advisory. It builds a single-worker Next standalone under the JS transport boundary. Explicit `outputFileTracingRoot` is the copied app directory; parent repository lockfiles cannot expand its output root. Exact Darwin arm64 and Linux x64 native includes stay narrow. Next may automatically trace other bundled platform binaries; the full manifest covers them too.
- Required package JavaScript, package version and the target native file must exist in standalone. The native bytes must match the installed pinned package. The artifact manifest hashes **every** standalone, static and public file, including existing generated route files. Symlinks are rejected rather than followed out of the artifact.
- `run` verifies inputs/artifact, copies the whole standalone/static/public output, and compares exact files/bytes. It launches only the copied `server.js` with a minimal allowlisted environment on unused loopback port 3142 (permitted range 3140–3190). No `NODE_PATH`, repository node_modules, environment file or provider key is forwarded. Module/native resolution outside the copied runtime is denied. Only owned child processes are stopped.
- Default-off GET and POST return 503 with zero data files. Enabled uninitialized GET returns 404 and guard-denied POST returns 403, both without creating a database. The fixed synthetic POST header is a test guard, **not real user authentication**. A fixed valid POST creates one synthetic row and returns 201 with exact engine/source ID, target/Node and loaded native path.
- Seven fixed fetch/TCP/TLS/HTTP/HTTPS/external-DNS attempts must be rejected, and a public asset must match its source bytes. Install/audit require public npm registry network; the actual build/runtime have a JS transport guard. This is not an OS sandbox against malicious native code/subprocesses.
- Stop and restart the copied process, then query its actual persisted SQLite file through a readonly connection. Database bytes must equal the stopped snapshot. Before success, source/artifact/copy digests must all still match, with **zero mutable-original or added-cache allowances**. Any legitimate unexpected generated file requires a separately reviewed script revision; do not discover broad exceptions after failure.

All HTTP outcomes are appended immediately to `api-responses.jsonl`. Bounded readiness polling tolerates connection refusal while the owned server starts, not unexpected HTTP errors. `success.json` records the actual target, Node, build ID, source-manifest hash, full artifact-manifest hash, copied-runtime snapshot and synthetic database digest. No Linux result is inferred from a Darwin run or the presence of an ELF file.

## Source provenance and retained failures

The repository copy derives from the approved external V3 fixture, manifest SHA256 `a69ca9bd4a834f3a4a840f6c838efef4effbab1e7a0db1311d3c3d7e823fb122`. That fixture passed a copied standalone restart/no-write/network/full-artifact run on Darwin arm64 Node 22.23.3, build ID `U8rd7qVsCxsgUtYKFd9le`; success receipt SHA256 `ff5873d18623554d57fc4a85bbb874cc114fadcb9cf9056728d3fdde59e6c62a`. The repository copy normalizes package/manifest names and requires that exact Node patch; all route, transport, copying, runtime and artifact assertions remain the passed V3 criteria. Its own Linux CI execution is pending.

Outside-repository records remain at `/tmp/vox-sqlite-qualification-20261020`: packaging-v1 stopped on the omitted PostCSS override audit; packaging-v2 compiled but failed the nested parent tracing-root layout; packaging-v3 fixed the explicit root and passed Darwin. Pinned Linux Docker attempts linux-target-v1/v2 both stopped before npm installation at `fs.cpSync` EACCES on Docker Desktop's synthetic bind mount, including UID 0. Those failures were retained without further privilege expansion. They do not prove adapter incompatibility, and emulated local execution cannot substitute for this actual Linux x64 CI gate. No failed evidence, installed dependencies or build outputs belong in Git.

Full Vox standalone native tracing and provider/authority integration remain separate acceptance gates. A successful synthetic build does not authorize real-data migration or format activation.
