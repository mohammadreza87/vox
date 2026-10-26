# AM-RELEASE-01 release packet

25 October 2026. Release owner: Sol 6.1 release role. Source base `7224f40d69cf816a49139a30092cbf92551d2a8e`; final candidate, merged commit and installation are **PENDING**. This packet prepares a default-disabled code deployment. It does not approve capture activation or establish completion of the memory master specification.

## Release scope and gates

The bounded implementation supports eligible received private owner-DM text on canonical FILE/polling, explicit `/archive` setup, a 32-event recent context index and finite archive recovery. New capture remains unavailable while `STUDIO_TELEGRAM_ARCHIVE` is absent or `0`. Preserve the existing production adaptive policy, Decisions, maintenance, reminder delivery, credentials and state.

The lead owns commit/push/PR/main merge. Installation waits for the exact merged candidate, independent final acceptance and passing required gates. Read [independent acceptance](AGENT_MEMORY_ACCEPTANCE.md), [production program](AGENT_MEMORY_PRODUCTION_PROGRAM.md), [T1 contract](TELEGRAM_STORAGE_DECISION_T1.md) and [production operations](../PRODUCTION.md) together. Provider qualification, approved retention and the live kill/recovery drill remain activation gates even when code deployment passes.

## Refreshed installed baseline

Read-only observation at `2026-10-25T16:57:12Z`:

| Field | Observed value |
| --- | --- |
| Public target | `https://vox.joyixir.com/studio` |
| Revision | `73710865e91935eb812d0d83962726fbe586d79b` |
| Source tree | `224fc4d44fe1b0e4bb17641798a0cab9a9946920` |
| Build ID | `VJbEY600P6sikDqXzB_hR` |
| Installed directory | `/Users/reza/Library/Application Support/Vox Studio/releases/2026-10-25T09-29-32-972Z-73710865e919` |
| Local/public health | PASS: healthy, matching revision, polling, bots enabled |
| Public Studio | HTTP 200 |
| Production configuration | Mode 0600; SHA256 `665ca6b9a1ad8bab53abe911afa48e45f694e61c20229d6962ff448d4144913a` |
| Archive flag | Absent; no archive/canary/synthetic environment keys |
| Existing features | Adaptive policy present; Decisions, maintenance and reminder delivery `1`; adaptive format absent/default FILE; Circles absent |
| Concurrent operation | No operation lock observed; recheck immediately before installation |

No private account documents, conversations or bot destinations were read. No explicitly designated synthetic archive destination was established by configuration metadata; an owner's ordinary DM must not be inferred to be a synthetic fixture. No provider messages were sent. Existing policy contents and secret values are excluded from this packet.

## Exact promotion procedure

1. Freeze independent acceptance against the exact source digest/commit. Require hosted lint/types, tests, build, browser journeys and indexed-storage qualification for the candidate; record audit findings separately. Firebase Deploy remains intentionally skipped for the Mac target. Do not change `STUDIO_PRODUCTION_TARGET`.
2. Use the clean merged source and pinned Node runtime. Run `npm ci` and `npm run studio:build`; record `.next/studio-release.json`, matching standalone BUILD_ID, lockfile hash and artifact digest. The build rejects a dirty or changing source tree.
3. Re-read current release directory/revision/build, production configuration digest and `STUDIO_TELEGRAM_ARCHIVE`. Hold for any drift requiring reconciliation; do not overwrite configuration. Confirm the exact-candidate manifest admits current storage/control schemas and archive rollback state.
4. Run the guarded installer from that clean merged checkout. The following is the recorded baseline only; refresh the arguments if production changes:

   ```sh
   node scripts/studio-production.mjs install \
     --expect-current '/Users/reza/Library/Application Support/Vox Studio/releases/2026-10-25T09-29-32-972Z-73710865e919' \
     --expect-revision 73710865e91935eb812d0d83962726fbe586d79b \
     --expect-build VJbEY600P6sikDqXzB_hR
   ```

5. The installer acquires the operation lock, checks expected baseline and artifact provenance, verifies current compatibility and provider credentials without content generation, stops the service, takes a private state/config backup, switches the release and checks exact local health. Failed startup restores compatible prior code. Stop on a failed preflight; preserve the exact sanitized error instead of silently retrying or changing credentials.
6. Verify installed manifest/build and local/public revision, polling and bots; `/studio` HTTP 200; unauthenticated `/api/studio/me` HTTP 401; excluded legacy routes HTTP 404. Confirm configuration digest unchanged and archive still absent/`0`. These non-send checks establish installation and public admission only. Authenticated memory/provider/device flows remain separately qualified.

## Rollback and data implications

Re-read the newly installed baseline and use all three expected-current/revision/build guards with `rollback`. Preserve latest authority, revocation, correction and deletion state; never restore an old backup wholesale. Code rollback does not undo user data. If an archive-enabled pilot has written state, use the reviewed `scripts/telegram-archive-rollback.ts` dry-run/apply procedure against the explicitly scoped account with producers stopped and expected content digest; retain the suppression/control semantics required by the previous release. A compatible default-disabled code install requires no archive-state migration. The installer compatibility check remains authoritative; do not bypass it.

## Provider activation qualification path

Before any activation, designate the exact synthetic adult owner, existing agent/bot and private DM, Work scope, fixture policy/expiry and authorized sends. Use an isolated qualified FILE/polling environment or an explicitly scoped canary; do not register a competing webhook/poller or reuse private conversation text. The archive flag is server-wide, so enabling it requires checking every previously configured archive row rather than assuming the selected canary is the only possible capture destination.

Freeze approved retention/expiry, backlog limits and provider-copy deletion wording. Verify current profile, history/automatic-memory/personalization receipts, agent grants, exact bot identity and owner-DM destination. Through the actual Telegram transport, qualify `/archive enable`, eight unique synthetic received text events, bundle/manifest upload and downloaded hash verification, pending versus verified status, restart and `/archive recover`, current authority before reconstruction, corrections/forget, duplicate/edited input and unknown upload outcomes. Do not manufacture real incoming Telegram messages through a bot API send or call a local fixture a user/device journey.

Run a scoped kill/recovery drill: disabling capture prevents new archive work while supported core replies and correction/forget remain usable; pending or restored artifacts cannot regain current authority after revocation. Verify actual flag propagation, FILE restart/process failure behavior and residual Telegram copies separately. Record exact release/build, transport receipts, sanitized hashes, destination authority, expiry, failures/unknowns and EN/FA review. Physical Telegram/device receipt and provider-model quality/latency/cost remain separate evidence. Resume capture only after independent acceptance and named activation decision.

## Release record

| Gate | Status |
| --- | --- |
| Exact final independent local acceptance | PENDING; QA owns final report |
| Required final local/hosted CI gates | PENDING; runner/lead own evidence |
| PR and merged revision | PENDING; lead owns GitHub actions |
| Guarded installation and public verification | NOT RUN; waits for dispatch |
| Actual Telegram archive transport | UNAVAILABLE; destination/send authorization and provider run required |
| Retention/kill/recovery activation qualification | UNAVAILABLE |
| Archive activation | HELD; keep flag absent/0 |

Next owner: lead/QA freeze and accept the default-disabled candidate; release role installs only the dispatched merged revision after passing gates. Provider qualification is the next explicit activation task.
