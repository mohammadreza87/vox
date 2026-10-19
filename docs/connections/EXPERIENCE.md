# Connections in Vox Studio — experience and design handoff

Task: **CONN-PLAN-UX**. Design version: `connections.experience.v1-draft`, 19 October 2026. Baseline: `42a1a57113e655b6185ddc731b6f9617aaa4bb4e`. Author: Vox UX designer, GPT-6.1 Sol / high. Owned path: this document only.

**Planning and research only.** This document proposes behavior; it does not establish implemented Connections, provider eligibility, usable accounts, OAuth approval, live data access, deployment, or device acceptance. All named people, files, accounts, environments and tasks below are synthetic examples. Native Persian review, privacy/security approval, provider qualification and the device matrix remain release gates. No product implementation, credentials, live product mutations, messages or screenshots were used for this handoff.

Inputs: [team conventions](../implementation/TEAM.md), [existing experience specification](../implementation/EXPERIENCE_SPEC.md), [privacy and consent](../implementation/PRIVACY_AND_CONSENT.md), [memory strategy](../AGENT_MEMORY_STRATEGY.md), and the source files linked below. Product rules here extend the existing separation of Work/Personal, audience, purpose and agent permission; they do not replace those contracts. In particular, connecting a provider does not turn on automatic memory, personalization, optional product analytics, notifications, training or content review.

## 1. Fit the actual Studio

Current source takes precedence over earlier descriptive snapshots. The existing experience specification describes an older three-tab shell; this baseline has **four tabs: Agents, Groups, Org, Privacy**. Keep them. Connections is a focused management destination reached from the account sheet and an agent; adding a fifth bottom tab would crowd the phone navigation and detach access from the agent/task.

| Source at baseline | Observed behavior | Proposed Connections seam |
|---|---|---|
| [`StudioApp.tsx`](../../src/app/studio/_components/StudioApp.tsx) | In-memory `Route` stack, four bottom tabs, Telegram native BackButton follows stack; no Connections route | Add internal `connections`, `connection`, `connection-setup`, `connection-review` responsibilities to this stack. These names are proposals, not existing public URLs. Keep Back semantics and restore the entry screen. |
| [`Home.tsx`](../../src/app/studio/_components/screens/Home.tsx) | Cloud identity, Your agents, role/account pill, account `Sheet` containing `UserInfo` | Add a full-width **Connections** row below account details. Its hit area is at least 44 px; the existing 28 px role pill needs a larger hit area for this path. |
| [`Agent.tsx`](../../src/app/studio/_components/screens/Agent.tsx) | Agent face/name/role; Chat, Call, Group, Memories actions; management/visibility sheets, live-web control | Keep these four actions. Add a `vx-group` row **Connections · 2 ready** beneath the action row, followed by a readable scope summary. Entry preselects that agent visibly; it does not preauthorize it. Agent visibility and conversation access remain separate from connection access. |
| [`Privacy.tsx`](../../src/app/studio/_components/screens/Privacy.tsx), [`adaptive-copy.ts`](../../src/app/studio/_lib/adaptive-copy.ts) | Work/Personal buttons, language selector, purpose choices and agent memory grants in EN/FA | Add a **Connected accounts** link to the same Connections destination with that space. Keep optional memory controls here; link from connection memory details rather than duplicating switches. Current screen-local locale state is not an app-wide localization system. |
| [`SharedMemories.tsx`](../../src/app/studio/_components/screens/SharedMemories.tsx) | Exact-recipient preview and separate allowed-agent selection | Reuse the understandable exact-recipient pattern. Do not treat its current API as an external-source sharing grant. Resource ACL, source ownership and provider terms are additional gates. |
| [`Org.tsx`](../../src/app/studio/_components/screens/Org.tsx) | People and administrative roles | A workspace policy entry may manage permitted providers and organization-owned service connections. It must not list personal account identity, private resource names, personal tasks or content. Owner does not mean access to all accounts. |
| [`ui.tsx`](../../src/app/studio/_components/ui.tsx) | `TopBar`, `Sheet`, `Empty`, `Steps`, `Spinner`, `Icon` | Reuse visual primitives. `Sheet` currently lacks focus containment, Escape and focus restoration; repair these before a permission/action review uses it. Long setup/review uses a full screen, not nested sheets. |
| [`client.ts`](../../src/app/studio/_lib/client.ts) | `openTelegram`, Telegram `openLink` bridge type, signed init-data API header; `Me` has org/member/features | Extend with server-derived connection/grant snapshots. `initDataUnsafe`, role, local storage and display names cannot establish identity, provider-account ownership or permission. |
| [`studio.css`](../../src/app/studio/studio.css), [`layout.tsx`](../../src/app/studio/layout.tsx) | Soft Weather dark system; fixed viewport, safe-area padding, 52 px pill buttons, 44 px icon buttons, 56 px grouped rows | Reuse colors, typography, cards and spacing. Qualify scroll, keyboard, focus, reduced motion and RTL before release; existing CSS is not proof those flows pass. |

Visual vocabulary: `--ground #0E1013`; surfaces `--s1 #16191E`, `--s2 #1E2228`, `--s3 #282D35`; text `#F2F1EC` and secondary `#A9ADB5`; primary `--volt #D6FF5C`; informational `--ice #8FB8FF`; success `#5BE49B`, warning `#FFC24B`, danger `#FF6B5E`. Use `vx-card` 24 px corners for a connection summary, `vx-group` 16 px corners for related permission rows, `vx-banner` for persistent notices, and existing primary/secondary/danger buttons. A primary button advances or commits the single visible decision. A provider mark is a small identifier beside a text name; no large new dashboard graphics, performance charts, sidebar or card maze. Agent identity stays the existing cloud face.

Show status in words plus an icon, never color alone. Volt means the primary action; success color does not mean a resource is authorized for every audience. `--text-3` and faint borders need contrast measurement on their actual backgrounds before they carry required information. Do not introduce new visual tokens without documenting why existing ones fail.

## 2. Five decisions, kept separate

The primary language is **account, resources, agent, allowed actions, reply audience**. Transport/server/tool names belong in **Technical details**, never the first-run labels. “MCP,” bearer token, OAuth scope string and tool identifier are not primary UX vocabulary.

| Decision | Readable value | Boundary |
|---|---|---|
| Provider account | `Notion · Sara · Design workspace` | External identity. Connecting verifies the provider handoff; it grants no agent access by itself. Several accounts with the same provider remain distinguishable. |
| Connection | `Design workspace · Ready to configure` | Scoped credential, validated endpoint and health. A green connection means a recent connection check, not a successful task or data freshness guarantee. |
| Grant | `Marcus · Work · HOOR · Read 2 selected pages` | Specific agent identity, space/container, resource/tool/action set, exact audience, expiry and current permission revision. A successor/clone gets no automatic grant. |
| Allowed actions | `Read selected pages; prepare drafts here` | Provider authorization may be broader than Vox's restriction. Explain both. A displayed restriction is usable only when server enforcement is qualified. |
| Reply audience | `Only you` or exact named people and verified group policy | Every output recipient needs source-compatible permission. Agent assignment does not make the source public, share an account or authorize every person who can chat with that agent. |

Default setup is **one selected agent, minimum read capability, explicit resources, Only you, active space**. No all-agents/all-workspaces switch. Starting at an agent page prefills its identity; starting from account Connections requires choosing one. Optional **Add another agent** expands a separate grant review for that agent. A connection can be left **Connected · No agent access** without granting anything; offer **Finish setup** later, never silently choose an agent.

Space and audience are persistent text at the top of Connections and at every grant/action/memory decision. Use `Work · HOOR` and `Personal · Sara`; “Personal” must have an owner. Current source uses authenticated account-profile confirmation and explicitly says shared-account person switching is unavailable. Do not promise a shipped verified-person switch. For shared-device ambiguity require the separately approved fresh authentication flow; hide sensitive details until it succeeds. Voice resemblance and an agent's guess cannot approve a grant.

Account ownership is not content ownership. A work account may contain confidential HR/customer material; a personal mailbox may contain other people's sensitive data. The connector can expose only provider-authorized resources, and Vox must separately authorize their purpose and output audience. When a provider cannot substantiate other recipients' access, keep the result private; wider sharing requires a separately authorized, exact-content projection or export. A workspace owner may disable a service or remove an organization-owned connection without receiving its private content.

## 3. Navigation and short flow

```text
Agents → Marcus → Connections
                       │
Account sheet → Connections [Work · HOOR ▾] [Only you]
                       │
          [Connected accounts] [Add connection]
                       │
          Choose service → Continue in browser
                       │
       Provider sign-in/consent → Return to Vox Studio
                       │
       Choose resources + agent + actions + audience
                       │
                 Review → Allow access
```

Normal new-account path has a service picker, a provider handoff, and one configuration/review screen. Resource lists expand in place; review is an on-page summary with **Edit** anchors, not a second wizard repeating every choice. `Steps` may label **Account → Access**; the provider screen is not a pretend Vox step that Vox controls. Reuse a qualified existing connection without repeating provider sign-in. Existing unexpired grants need no new prompt for the same authorized read/draft task.

The Connections list uses vertical grouped rows, scoped to active space. Filters are **All / Needs attention**, with **My accounts / Workspace accounts** when policy permits. Personal accounts are shown only to their owner. No global search across another person's connections. A service catalogue may show availability and approved setup method but not another user's account. **Unavailable** is distinct from **Not connected**. Never show **Connect** if provider approval or safe setup is absent; explain the named blocker in detail and offer **View requirements**.

```text
< Back                         Connections       [English ▾]
Work · HOOR                    Reply audience: Only you

[Add connection]

Notion · Design workspace                         Ready
Marcus · Read 2 pages · Only you                         >

GitHub · sara-example                 Connected · No agent access
[Finish setup] [Manage account]

Slack · HOOR-projects                   Reconnect needed
Access paused · Only you                    [Reconnect]

[How access works]
Existing bottom tabs appear only on root screens, as today.
```

Rows show provider, safe account/workspace discriminator, active grants, scope and state. Full email, host/project/resource names appear only after authorization and can wrap; never put them in an external notification, URL title or generic support report. Empty state is one sentence and **Add connection**. No empty charts or invented statistics.

### Connect and return

1. User selects service. Show the expected provider and organization/domain, active space, and **Continue in browser**. Passwords, account recovery codes, session cookies and SSH private keys must never be requested in chat or a Mini App message. Provider authentication belongs on the provider's genuine page. Private-host configuration must go through the separately reviewed setup method; a generic URL box must not imply arbitrary endpoints are trusted.
2. A deliberate button opens the system/default browser with the approved server authorization transaction. The app displays a persistent waiting state with **Cancel setup**. [Telegram documents an external-browser `openLink` triggered by user interaction](https://core.telegram.org/bots/webapps); actual iOS/Android/Desktop behavior and browser settings require native qualification. Do not claim a particular Telegram version guarantees the intended browser isolation. RFC 8252 provides the external-user-agent security rationale for native applications; Vox's browser-hosted Mini App architecture must apply the appropriate server flow rather than claim it is a public native client. [OAuth for native apps](https://www.rfc-editor.org/rfc/rfc8252).
3. Provider callback completes on a trusted HTTPS Vox page. Only the server exchanges the code and validates the transaction. A safe completion page says **Account connected. Return to Vox Studio to choose access.** The return control contains an opaque short-lived reference, not a token, credential, resource title or grant. Reopening requires current Telegram authentication and server binding to the original actor/space/transaction. A forwarded return link must expose no identity or completion details to another account.
4. Returning to Telegram or reopening Studio loads authoritative status. Do not trust a browser query like `success=true`. Show **Checking connection…** until the check completes; provider success alone does not mean an agent is assigned. If app handoff fails, offer a generic **Return to Telegram** link and instructions to reopen Studio; preserve the pending server transaction. No paste-back authorization code or credential workaround.
5. If browser selected the wrong account/workspace, show that account clearly and **Use another account** before access is committed. Cancel discards unsubmitted selections and requests cleanup of any new unused credential. If revocation cleanup is pending, say so; never claim all provider access disappeared because the sheet closed. Existing accounts/grants remain unchanged by cancelling a separate new setup attempt.

Expired, denied, browser-closed and network-failed transactions each have a stable recoverable page. No countdown that auto-grants access. **Start again** starts a new transaction only after old status is known/cancelled. Back returns to the connection list with safe status, not an embedded provider login. Device/session change requires a new verified flow; do not transfer a Personal connection into Work to make a return link work.

### Access configuration and review

```text
< Back                  Allow Marcus to use Notion
Work · HOOR             Account: Sara · Design workspace

Resources                       [Choose pages]
  [✓] Lesson outline
  [✓] Practice exercises
  New child pages: Excluded

Agent                           Marcus [Change]
Allowed actions
  [✓] Read selected pages
  [ ] Create or update pages       Requires action review
Reply audience                  Only you [Change]
Remember from this connection    Off [Memory details]
Access ends                     {approved expiry} [Change]

Review
Marcus may read these 2 pages in Work · HOOR and answer only you.
This does not let other agents use your account.
[Provider permissions and restrictions ▾]
[Allow access]                                [Cancel]
```

Provider-permission detail is collapsed but the safe mismatch sentence is always visible when provider authorization is broader than Vox's resource restriction. Example: **Google grants access to your mailbox. Vox will restrict this grant to the selected label.** Use this only if the backend enforces that restriction before retrieval/content reaches a model; otherwise disable that choice and explain that narrower access is not available. No misleading “Google can only see this label” claim. Enumerate actual provider permissions and effective Vox restrictions with last checked time in details.

Resource picker: search only within the user's authorized provider account. Use checkbox rows with type, safe resource name, parent/project/workspace and current selection. No content preview until an eligible user deliberately requests it. A select-all control applies only to the explicit listed set; label whether descendants are included. New children/resources are excluded by default. Unknown/moved/inaccessible resources remain unavailable, never matched by a reused name. Pagination does not select hidden items. Preserve choices after a recoverable error; cancel removes unsubmitted choices. Counts are counts of selected resources, not evidence of complete provider discovery.

Actions use task language with capability detail. A service may offer **Read**, **Prepare a draft**, **Create or change**, **Send or publish**, and **Administrative changes**, only where supported and qualified. These are not interchangeable. A local Vox draft is distinct from creating a provider draft. Writes start off; sensitive/admin capabilities require a separately approved release and explicit review. No arbitrary shell/HTTP/tool editor in normal setup.

Change audience opens exact named recipients and group policy, not “share with workspace.” Show full recipients before commit; a count can summarize only after a readable roster is available. New group members gain no earlier source access. If audience cannot be verified, disable wider audience with recovery to private conversation. A private source title must not appear to unauthorized recipients even in the explanation for denial. A work/person/agent/resource/action/audience expansion creates a new review. A scope reduction takes effect immediately after authoritative acknowledgment and invalidates affected work; it does not need a second defensive confirmation.

## 4. Service-specific resource vocabulary

These are desired UX seams, not promises that the providers implement identical selectors or support every action. The provider capability register and security review decide which controls may be enabled. A generic protocol connection is never presented as blanket access to everything its endpoint exposes.

| Service | Selection shown to the user | Safe starting task / boundary detail |
|---|---|---|
| Notion | Workspace → explicitly shared/selected pages or databases, descendant rule | Read lesson pages for Marcus. A new page or inherited child does not silently enter the grant. Show source citation and last fetched time. |
| Slack | Workspace → selected channels and supported history range | Summarize a specified project channel. Private channels/DMs require separate authority and may be unavailable; no all-DM import. Joining a channel is an external action. Bot membership alone does not establish all Vox reply recipients' rights. |
| GitHub | Account/organization → installation → selected repositories; issue/PR/code capabilities separately | Read code/issues and prepare a patch locally. Opening a PR, comments, branch push, merge and deployment each have distinct effects and review. |
| Forgejo | Approved instance origin → account → selected owner/repositories | Match GitHub task vocabulary where behavior matches. Display instance hostname so similarly named repositories on different hosts cannot be confused. No unchecked URL or token in conversation. |
| Hetzner | Organization/project → named environment/resources → supported cloud actions | Read project health/inventory first. Provisioning, power, firewall, volume and deletion operations show cost/downtime/data consequences. Never infer server SSH rights from cloud-project access. |
| Servers | Approved host inventory → environment → reviewed diagnostic operation set | Show exact host/environment and **Read approved diagnostics**. Command execution is privileged even when labelled diagnostic; no free-text unrestricted shell, sudo, secret files or private keys in the primary UX. |
| Gmail | Account → actual provider permissions → enforceable task/resource restriction | Personal message search/draft for a named task. Label/thread restrictions are Vox restrictions unless the provider actually enforces them; do not invent OAuth per-label rights. Sending, forwarding, deleting and changing labels are distinct actions. |
| Google Workspace | Account/organization → product (Drive, Docs, Sheets, Calendar, etc.) → selected resource and action | One Google sign-in does not approve every product. Drive reading is separate from editing a Sheet, inviting to Calendar or administering a domain. Domain-wide delegation/admin grant is a separately gated path, not a default checkbox. |
| Figma | Account/team/project → selected file(s) and supported operation | Read a selected design to explain it. Exporting, commenting or modifying a file gets the relevant review; private comment authors and unrelated files stay out of result context. |
| Chrome / browser | Explicit tab selection **inside an isolated Vox worker/session**; connection/owner/space, origin allowlist, capture kind and task/session limit | **Use this worker tab for this task**, with visible worker-session identity, capture indicator and **Stop**. No attachment to an existing personal Chrome tab/profile, history, cookies or passwords; opening a site does not grant other worker tabs or background screen observation. Recheck navigation/origin and account/session before capture. Attaching a user's existing personal browser is a future, separately designed local bridge; it is not part of this plan. |
| Analytics | Provider/workspace → project/property → approved metrics/dimensions/date bounds | Read aggregates with source/date/timezone/cohort/platform/build and freshness. Querying user-level rows, exports or identifiers requires a separate approved capability; no employee productivity score. |
| Gamend | Tenant → project/game → reporting environment → metrics/cohort/date filters | Analyst reads approved reporting aggregates. Show tenant, game, build/platform/timezone, source and as-of time; unavailable dimensions are **Unavailable**, never zero. Ingest/operations/admin endpoints are not implied by reporting access. |

## 5. Acting without repeated permission prompts

The grant permits a capability; an action review authorizes a concrete effect. They must not collapse into one **Allow everything** dialog. For a current unexpired grant, authorized scoped reads, bounded retrieval, same-audience synthesis and drafts kept inside Vox proceed without repeat sign-in or permission nags. The task header quietly shows **Using Notion · 2 pages · Only you** with **Stop** and a source/detail link. Opening details does not stop work. A declined connection stays declined until the user deliberately returns to setup or asks for a capability that needs it.

Use one review for a coherent bounded workflow when its full effects are known. Show named steps, targets, exact publish/send text or diff, audience, environment, expected cost ceiling, expiry and rollback limits. Approval is for that reviewed plan/version and quantity, never a provider-wide standing exception. Separate ongoing/scheduled workflows require their own bounded authorization and management contract. An inserted step, recipient, host, changed content, larger cost, broader resource set or expired permission requires a fresh review. Source instructions, prompts in documents and tool output can never waive this gate.

```text
< Back                        Review action
Engineer · Work · HOOR         Forgejo · code.example.invalid
Create draft PR in learning/demo, target branch develop
3 changed files                                  [View diff]
Title: Improve lesson validation
Description: {exact text}
Visible to: {verified repository audience}
No deployment in this plan
[Create draft PR]                              [Cancel]
```

Review always shows **actor/agent → account → environment/resource → effect → external recipients → recoverability**. Primary label names the action: **Send email**, **Create draft PR**, **Restart server**. Never **Yes** or **Continue** for an effect. Meaningful effects include sending/forwarding messages, provider drafts if they persist externally, posting comments, edits, permission changes, moving/deleting data, merges/deployments, changing infrastructure and paid provisioning. Destructive, privileged or cost-bearing categories stay unavailable until their separate policies qualify them. Voice requests can prepare a review but cannot bypass the authenticated review gate.

Approval pauses at a durable boundary; changing tabs/back/closing the sheet does not approve. Show **Waiting for your review** with **Review / Cancel task**. After approval, stale content/resource revision or audience/permission changes cancel that approval and request a refreshed preview. A preflight denial returns the safe reason and options to edit/cancel. No automatic downgrade to a broader credential or different account.

Execution result distinguishes **Not started**, **Running**, **Completed**, **Partly completed**, **Failed before change**, **Outcome not confirmed**, **Cancelled before change**, and **Cancellation requested**. Cancellation cannot promise to undo an already accepted provider operation. Unknown send/payment/provision outcomes offer **Check status**, not a blind **Try again**. Multi-step reports list which steps completed and what remains, with safe provider references visible only to authorized users. **Undo** appears only for a verified compensating operation, with its own effect review when meaningful; do not invent undo for a delivered email or deleted volume.

## 6. Managing access, memory and lifecycle

Connection detail uses the same grouped rows: **Account**, **Connection status**, **Agents and access**, **Recent activity**, **Source-derived memories**, **Provider permissions**, **Reconnect**, **Disconnect**. Long technical/security detail is progressive. Recent activity records safe action/outcome/time/reference and active space, not source bodies, query text, private filenames or credentials. Workspace administrators receive only their approved organization-owned administrative projection. No personal inbox or private browsing activity in Org.

| User action/state | Required behavior and honest outcome |
|---|---|
| Reconnect | Show existing provider identity/endpoint and paused grants. Reauthenticate the same account; same-account narrower permissions preserve only the still-valid intersection after policy recheck. Different account, broader scope or changed organization requires explicit new review and must not inherit grants silently. Reconnect does not turn on memory. |
| Remove one agent's access | One-step **Remove access**; stop that grant's new work and invalidate its pending jobs/derived context on server acknowledgment. Other independently authorized grants remain visible and intact. Display pending sync separately if acknowledgment fails. |
| Pause connection | Immediately stop initiating work from this device; request server suspension of all affected grants and show pending until acknowledged. Do not show global **Paused** from a local switch alone. Resume requires current authority; the connection never auto-resumes on browser refresh. |
| Disconnect | Single review states number of affected grants/tasks and provider-revocation behavior, plus separate source-derived-memory deletion choice. Disconnect disables Vox use first; provider revocation and purge may finish later. Account credential state, grants and saved derivatives are separate status rows. |
| Delete source-derived data | Review lists eligible derived memories, retrieval caches, summaries and pending tasks in the chosen space. No automatic deletion of the original Notion page/email/repository. **Delete source at provider** is a separate meaningful external action, if supported and authorized. History follows its independently stated retention/deletion policy. |
| Source removed, ACL lost, moved outside selection, changed membership or expired grant | Block affected retrieval/use immediately upon authoritative invalidation; cancel pending output and source-derived reminders. Show generic unavailable source to unauthorized viewers. A model cannot answer from a cached summary after losing the source. |
| Source corrected | Mark prior memory outdated and suppress stale derivatives; refresh only within original authority. Materially changed shared text needs a new exact-content sharing review. Display last verified source time, not just memory creation time. |
| Agent retired or successor created | Remove retired agent's future access; a successor starts without grants and needs its own assignment. Past authorized activity is not relabelled as the successor's work. |
| Account disconnect/deletion requested while provider unreachable | Vox suppression status, provider revocation pending, online purge and backup expiry each retain independent truth. A status page remains accessible using a safe request reference. Do not promise deletion everywhere. |

Source-derived memory is off by default. Reading a page for a task is not “teaching the model” or changing shared model weights. **Teach Marcus** means making selected source material available for eligible retrieval, with citations and current authority. Use **Reference material** for this mode. **Remember a note** opens the existing explicit memory pattern with exact text, destination, recipients and allowed agent(s); automatic extraction remains separately off unless its own purpose grant is approved.

```text
Source-derived memories
Reference material: 2 selected Notion pages · Available while authorized
Saved notes: None
[Review memory settings]

If a saved note is authorized:
"Start lessons with a short worked example."
Work · HOOR · Only Sara · Marcus
From: Lesson outline · verified {time}           [Source details]
[Correct] [Remove access] [Request deletion]
```

Detail may show source title only to authorized readers. Shared projections must not expose a restricted parent title, URL, reason or author. A saved note inherits source restrictions unless a separately authorized projection/export defines a different lawful scope. Permission removal suppresses dependent use; purge reports **Waiting for suppression confirmation / Blocked from use / Deletion in progress / Provider deletion pending / Backup expiry pending / Partly failed / Complete for the named systems**. Do not offer durable memory from a source until lineage, invalidation, history treatment and deletion contracts are qualified.

## 7. Loading, failure and recovery contract

All errors persist beside the affected control or status section, with a safe operation reference where available. The existing 3.2-second toast is supplemental; it cannot carry a permission/revocation/deletion outcome. Raw HTTP bodies, source snippets, access tokens and private host details never enter a generic toast or report.

| State/trigger | Visible behavior, recovery and preservation |
|---|---|
| First load | Heading/context skeleton and **Loading your connections…**; `aria-busy`; do not flash cached private rows from the prior space/account. |
| Empty | **No connections in this space. Add an account, then choose which agent may use it.** One Add action. |
| Connection list/resource load fails | Keep safe entered draft choices; show **Could not load…** and **Try again**. A previously known snapshot is labelled stale and cannot approve a grant/action. |
| Connecting/browser waiting | Named provider, space and **Waiting for sign-in…**; Cancel remains available. No auto-retry sign-in popup. |
| User/provider denies/cancels | **Setup cancelled. No agent access was added.** If credential cleanup is pending, add its status separately. Preserve no unused secret in the browser. |
| Timeout/expired transaction | **This sign-in attempt expired. Start again to connect.** Do not drop the user into another account's completed screen or claim failure if server completion is merely unknown. |
| Unverified return/session expired | Conceal identity and resource names; **Open Vox Studio and sign in to continue.** Reauthentication precedes retrieval; a return reference grants nothing. |
| Wrong account/space | Show authorized account identity and **Use another account**; if the active space changed, suspend return and require explicit restoration/new setup. Never auto-move a connection. |
| Provider unavailable/rate limited | **Service temporarily unavailable** / **Limit reached. Try after {time}.** Only use a verified retry time. Keep drafts and grant state; do not flood prompts or silently switch accounts. |
| Missing capability/admin approval | Explain capability-specific requirement with **View requirements** or **Ask your workspace administrator** as text guidance; do not send a message automatically. Core chat remains usable. |
| Grant save fails/unknown | **Access was not confirmed. Refresh status before trying again.** No agent use until a durable current grant is returned. Retry uses the same safe operation identity. |
| Audience/source/grant changes mid-task | Stop affected output, clear unsent buffers; **Access changed. Review the current scope to continue.** Already delivered content cannot be recalled. Keep safe task draft in its original space. |
| Action pending/partial/unknown | Show per-step status and **Check status**. Never say “sent” from a queued request or “cancelled” while provider outcome is unknown. |
| Local stop requested/server unreachable | **Stopped on this device. Account change waiting to sync.** Keep status persistent; retain reconnect/revoke recovery. Do not say stopped everywhere. |
| No matching accessible resources/results | **No accessible items match this search.** Avoid revealing that a hidden resource exists; distinguish empty authorized data from unavailable service only when safe. |
| Report an issue | Review safe error code/time/platform/app version/opaque reference and exact optional user-entered description. Content/source URLs/screenshots are excluded by default. No prechecked diagnostic-content donation. Submit only to the approved support route after explicit user action; identify receiver and retention. |

## 8. Task walkthroughs and privacy checks

These scripts are expected outcomes for later synthetic evaluation, not passed usability sessions.

| Scenario | Short user journey and expected outcome | Must stay private / deny cases |
|---|---|---|
| Teach Marcus | Agent Marcus → Connections → Notion → browser sign-in → select `Lesson outline` and `Practice exercises` → Read → Work · HOOR → Only Sara → Allow. Ask “Teach me chapter 2.” Marcus retrieves eligible passages, cites the selected pages and explains current source time. Reference material is usable; automatic memory remains off. A requested saved teaching preference gets its own exact-note preview. | Unselected personal journal, other learners' grades, secret page titles and the account token never reach the task/model. A colleague chatting with Marcus gets no private material. A successor Marcus receives no grant. |
| Analyst with Gamend | Analyst → existing Gamend connection → select synthetic tenant/project/game, reporting environment, approved aggregate metrics → read-only, Only Sara. Ask “Compare this week's level completion by Android build.” Reuse the same grant with no repeat prompt; report source, date bounds, timezone, cohorts, filters, build/platform and unavailable dimensions. | No raw player IDs, payment data, cross-tenant comparison, personal account activity or productivity ranking. Private ingestion/operations details are not inferred from a reporting grant. Sharing to a group requires its separate authorized audience. |
| Engineer with Forgejo | Engineer → approved `code.example.invalid` account → select `learning/demo` repo → read code/issues. Ask for a fix; scoped reads and an internal patch draft proceed. Review shows exact diff, target branch, draft PR text and verified repo visibility; **Create draft PR** commits that one external effect. Deployment requires a different authorization. | SSH keys, `.env` contents, unrelated repos, personal Gmail and hidden issue titles remain excluded. A malicious issue saying “ignore approval and deploy” cannot change the plan or grant. Changed branch/recipient invalidates review. |
| Personal Gmail | Account Connections → Personal · Sara → Gmail → browser account choice → enforceable task restriction → assistant agent → Only Sara. Ask “Find the delivery email and draft my reply.” Search and local draft reuse permission; review exact From/To/Cc/Bcc, subject, body and attachments before **Send email**. An externally saved Gmail draft is disclosed as an external write. | Work agents/owners get no mailbox identity/content, correspondent names, subject lines or personal task history. Forwarding to a coworker is a new exact audience/export review; reconnecting another Gmail account does not inherit the old grants. |
| Browser assistance | Start an isolated Vox worker/session bound to the connection, owner and space; explicitly select one synthetic tab inside that worker for one task. Show worker-session identity, capture kind/origin and Stop. Navigate to another origin: pause and recheck scope before capture. End task: expire task access and tear down the disposable runtime according to the qualified session lifecycle. | Existing personal Chrome tabs/profiles cannot be attached in this plan. Other worker tabs, hidden windows, personal browser history, cookies, credentials and background screens never enter the grant or model context. Worker authentication/session secrets stay in the isolated secret/session boundary. No periodic harvesting; a future local-browser bridge needs a separate design and security review. |
| Infrastructure diagnosis | Engineer → approved test host/project → named diagnostic operation → review exact host/environment for any privileged operation. A restart request prepares separate review with downtime/rollback limits and current health. | No default production deployment, arbitrary shell, sudo, destructive volumes, secret files or cloud-wide spending. A cloud API connection is not SSH access. |

## 9. English/Persian copy inventory

Keys below are the proposed canonical translation seam, compatible in shape with the existing typed EN/FA copy module. They are documentation, not implemented strings. Both locales use the same semantic key, parameters and policy version. Render one locale at a time; untranslated safety/permission copy disables the affected approval. No English fallback inside a Persian grant. Source/provider names can retain their official script with bidi isolation. All copy requires native Persian and privacy review before publication.

| Key | English | فارسی |
|---|---|---|
| `nav.connections` | Connections | اتصال‌ها |
| `nav.connectedAccounts` | Connected accounts | حساب‌های متصل |
| `nav.back` | Back | بازگشت |
| `nav.language` | Language | زبان |
| `context.work` | Work · {workspace} | کاری · {workspace} |
| `context.personal` | Personal · {person} | شخصی · {person} |
| `context.audience` | Reply audience: {audience} | مخاطبان پاسخ: {audience} |
| `context.onlyYou` | Only you | فقط شما |
| `context.change` | Change | تغییر |
| `context.unknown` | Audience not confirmed | مخاطبان تأیید نشده‌اند |
| `list.add` | Add connection | افزودن اتصال |
| `list.all` | All | همه |
| `list.attention` | Needs attention | نیازمند رسیدگی |
| `list.mine` | My accounts | حساب‌های من |
| `list.workspace` | Workspace accounts | حساب‌های فضای کاری |
| `list.emptyTitle` | No connections in this space | در این فضا اتصالی وجود ندارد |
| `list.emptyBody` | Add an account, then choose which agent may use it. | حسابی اضافه کنید، سپس عامل مجاز برای استفاده از آن را انتخاب کنید. |
| `list.loading` | Loading your connections… | در حال دریافت اتصال‌های شما… |
| `list.loadFailed` | Your connections could not be loaded. | اتصال‌های شما دریافت نشد. |
| `list.how` | How access works | دسترسی چگونه کار می‌کند |
| `status.ready` | Ready | آماده |
| `status.unassigned` | Connected · No agent access | متصل · بدون دسترسی عامل |
| `status.finish` | Finish setup | تکمیل راه‌اندازی |
| `status.manage` | Manage account | مدیریت حساب |
| `status.reconnect` | Reconnect needed | نیازمند اتصال دوباره |
| `status.paused` | Access paused | دسترسی متوقف شده است |
| `status.unavailable` | Unavailable | در دسترس نیست |
| `status.stale` | Status needs refreshing | وضعیت باید تازه‌سازی شود |
| `setup.service` | Choose a service | انتخاب سرویس |
| `setup.browser` | Continue in browser | ادامه در مرورگر |
| `setup.handoff` | Sign in to {provider} in your browser. Return here to choose resources and agent access. | در مرورگر وارد {provider} شوید. سپس برای انتخاب منابع و دسترسی عامل به اینجا برگردید. |
| `setup.noSecrets` | Enter passwords only on the provider's sign-in page. Never send them to Vox. | گذرواژه را فقط در صفحهٔ ورود ارائه‌دهنده وارد کنید. هرگز آن را برای وکس نفرستید. |
| `setup.waiting` | Waiting for sign-in… | در انتظار ورود… |
| `setup.cancel` | Cancel setup | انصراف از راه‌اندازی |
| `setup.checking` | Checking connection… | در حال بررسی اتصال… |
| `setup.return` | Return to Vox Studio | بازگشت به وکس استودیو |
| `setup.returnBody` | Account connected. Return to Vox Studio to choose access. | حساب متصل شد. برای انتخاب دسترسی به وکس استودیو برگردید. |
| `setup.openTelegram` | Return to Telegram | بازگشت به تلگرام |
| `setup.manualReturn` | If Vox Studio does not open, return to Telegram and reopen it. | اگر وکس استودیو باز نشد، به تلگرام برگردید و دوباره آن را باز کنید. |
| `setup.authNeeded` | Open Vox Studio and sign in to continue. | برای ادامه، وکس استودیو را باز کنید و وارد شوید. |
| `setup.otherAccount` | Use another account | استفاده از حساب دیگر |
| `setup.cancelled` | Setup cancelled. No agent access was added. | راه‌اندازی لغو شد. دسترسی تازه‌ای برای عامل اضافه نشد. |
| `setup.expired` | This sign-in attempt expired. Start again to connect. | مهلت این تلاش برای ورود تمام شد. برای اتصال دوباره شروع کنید. |
| `setup.again` | Start again | شروع دوباره |
| `setup.cleanupPending` | Cleanup of unused provider access is still pending. | پاک‌سازی دسترسی استفاده‌نشده نزد ارائه‌دهنده هنوز در انتظار انجام است. |
| `grant.title` | Allow {agent} to use {provider} | اجازهٔ استفاده از {provider} به {agent} |
| `grant.account` | Account | حساب |
| `grant.resources` | Resources | منابع |
| `grant.chooseResources` | Choose resources | انتخاب منابع |
| `grant.search` | Search accessible resources | جستجو در منابع قابل دسترسی |
| `grant.noResults` | No accessible items match this search. | مورد قابل دسترسی مطابق این جستجو پیدا نشد. |
| `grant.children` | New child resources: Excluded | منابع زیرمجموعهٔ جدید: خارج از دسترسی |
| `grant.agent` | Agent | عامل |
| `grant.addAgent` | Add another agent | افزودن عامل دیگر |
| `grant.actions` | Allowed actions | کارهای مجاز |
| `grant.read` | Read selected resources | خواندن منابع منتخب |
| `grant.localDraft` | Prepare drafts here | آماده‌کردن پیش‌نویس در وکس |
| `grant.change` | Create or change | ایجاد یا ویرایش |
| `grant.publish` | Send or publish | ارسال یا انتشار |
| `grant.admin` | Administrative changes | تغییرات مدیریتی |
| `grant.reviewRequired` | Requires action review | نیازمند بازبینی کار |
| `grant.audience` | Reply audience | مخاطبان پاسخ |
| `grant.exactPeople` | Exact recipients | گیرندگان دقیق |
| `grant.ends` | Access ends | پایان دسترسی |
| `grant.remember` | Remember from this connection | ذخیره در حافظه از این اتصال |
| `grant.off` | Off | خاموش |
| `grant.review` | Review access | بررسی دسترسی |
| `grant.allow` | Allow access | اجازهٔ دسترسی |
| `grant.edit` | Edit | ویرایش |
| `grant.summary` | {agent} may read {resources} in {space} and answer only {recipients}. | {agent} می‌تواند {resources} را در {space} بخواند و فقط به {recipients} پاسخ دهد. |
| `grant.notOtherAgents` | This does not let other agents use your account. | این اجازه، استفاده از حساب شما را برای عامل‌های دیگر مجاز نمی‌کند. |
| `grant.providerDetails` | Provider permissions and restrictions | مجوزهای ارائه‌دهنده و محدودیت‌ها |
| `grant.broadMailbox` | Google grants access to your mailbox. Vox will restrict this grant to {selection}. | گوگل دسترسی به صندوق ایمیل شما می‌دهد. وکس این مجوز را به {selection} محدود می‌کند. |
| `grant.narrowUnavailable` | This service cannot safely enforce the selected restriction yet. | این سرویس هنوز نمی‌تواند محدودیت انتخابی را به‌طور امن اعمال کند. |
| `grant.ownerBoundary` | Workspace administration does not grant access to other people's private accounts or memories. | مدیریت فضای کاری به معنای دسترسی به حساب‌ها یا حافظه‌های خصوصی دیگران نیست. |
| `grant.futureMembers` | New members do not automatically gain access to earlier material. | اعضای جدید به مطالب قبلی به‌صورت خودکار دسترسی نمی‌گیرند. |
| `grant.savePending` | Saving access… | در حال ذخیرهٔ دسترسی… |
| `grant.saved` | Access saved for {agent}. | دسترسی برای {agent} ذخیره شد. |
| `grant.notConfirmed` | Access was not confirmed. Refresh status before trying again. | دسترسی تأیید نشد. پیش از تلاش دوباره، وضعیت را تازه‌سازی کنید. |
| `task.using` | Using {provider} · {scope} · {audience} | در حال استفاده از {provider} · {scope} · {audience} |
| `task.stop` | Stop | توقف |
| `task.waiting` | Waiting for your review | در انتظار بازبینی شما |
| `task.review` | Review action | بازبینی کار |
| `task.cancel` | Cancel task | لغو کار |
| `task.changed` | Access changed. Review the current scope to continue. | دسترسی تغییر کرده است. برای ادامه، محدودهٔ فعلی را بررسی کنید. |
| `action.diff` | View diff | دیدن تغییرات |
| `action.visibleTo` | Visible to: {recipients} | قابل مشاهده برای: {recipients} |
| `action.sendEmail` | Send email | ارسال ایمیل |
| `action.createPr` | Create draft PR | ایجاد درخواست ادغام پیش‌نویس |
| `action.restart` | Restart server | راه‌اندازی دوبارهٔ سرور |
| `action.notStarted` | Not started | شروع نشده |
| `action.running` | Running | در حال انجام |
| `action.done` | Completed | انجام شد |
| `action.partial` | Partly completed | بخشی انجام شد |
| `action.failedBefore` | Failed before any change | پیش از هر تغییری ناموفق بود |
| `action.unknown` | Outcome not confirmed | نتیجه تأیید نشده است |
| `action.check` | Check status | بررسی وضعیت |
| `action.cancelledBefore` | Cancelled before any change | پیش از هر تغییری لغو شد |
| `action.cancelPending` | Cancellation requested. A change may already have started. | درخواست لغو ثبت شد. ممکن است تغییر از قبل شروع شده باشد. |
| `action.undo` | Review undo | بررسی بازگردانی |
| `manage.agents` | Agents and access | عامل‌ها و دسترسی |
| `manage.activity` | Recent activity | فعالیت‌های اخیر |
| `manage.remove` | Remove access | حذف دسترسی |
| `manage.removed` | {agent}'s access was removed. | دسترسی {agent} حذف شد. |
| `manage.pause` | Pause access | توقف دسترسی |
| `manage.resume` | Resume access | ازسرگیری دسترسی |
| `manage.reconnect` | Reconnect | اتصال دوباره |
| `manage.disconnect` | Disconnect account | قطع اتصال حساب |
| `manage.disconnectTitle` | Disconnect {account}? | اتصال {account} قطع شود؟ |
| `manage.disconnectBody` | This stops Vox use through {grants} and cancels eligible pending work. Provider revocation and saved-data deletion have separate status. | این کار استفادهٔ وکس از طریق {grants} را متوقف و کارهای در انتظار مشمول آن را لغو می‌کند. لغو مجوز نزد ارائه‌دهنده و حذف داده‌های ذخیره‌شده وضعیت جداگانه دارند. |
| `manage.deviceStopped` | Stopped on this device. Account change waiting to sync. | در این دستگاه متوقف شد. تغییر حساب در انتظار همگام‌سازی است. |
| `manage.revocationPending` | Vox access is blocked. Provider revocation is pending. | دسترسی وکس مسدود است. لغو مجوز نزد ارائه‌دهنده در انتظار انجام است. |
| `memory.title` | Source-derived memories | حافظه‌های برگرفته از منابع |
| `memory.reference` | Reference material | منابع مرجع |
| `memory.referenceBody` | Available while the source and grant remain authorized. | تا زمانی که منبع و مجوز دسترسی معتبر باشند، قابل استفاده است. |
| `memory.settings` | Review memory settings | بررسی تنظیمات حافظه |
| `memory.savedNotes` | Saved notes | یادداشت‌های ذخیره‌شده |
| `memory.none` | None | هیچ‌کدام |
| `memory.source` | Source details | جزئیات منبع |
| `memory.verified` | Source last checked: {time} | آخرین بررسی منبع: {time} |
| `memory.outdated` | Source changed. Earlier details are unavailable until reviewed. | منبع تغییر کرده است. جزئیات قبلی تا زمان بررسی در دسترس نیستند. |
| `memory.correct` | Correct | اصلاح |
| `memory.delete` | Request deletion | درخواست حذف |
| `memory.deleteTitle` | Delete saved data from this connection? | داده‌های ذخیره‌شده از این اتصال حذف شوند؟ |
| `memory.deleteBody` | Review the listed memories and copies. This does not delete the original items at {provider}. Conversation history has separate controls. | حافظه‌ها و نسخه‌های فهرست‌شده را بررسی کنید. این کار موارد اصلی را در {provider} حذف نمی‌کند. سابقهٔ گفتگو کنترل‌های جداگانه دارد. |
| `memory.keep` | Keep saved data | نگه‌داشتن داده‌های ذخیره‌شده |
| `delete.waiting` | Waiting for confirmation that use is blocked | در انتظار تأیید مسدودشدن استفاده |
| `delete.blocked` | Blocked from use | استفاده مسدود شده است |
| `delete.progress` | Deletion in progress | حذف در حال انجام است |
| `delete.provider` | Provider deletion pending | حذف نزد ارائه‌دهنده در انتظار انجام است |
| `delete.backup` | Backup expiry pending | انقضای نسخه‌های پشتیبان در انتظار است |
| `delete.partial` | Deletion partly failed. View status. | بخشی از حذف ناموفق بود. وضعیت را ببینید. |
| `delete.namedComplete` | Deletion completed for the listed systems. | حذف در سامانه‌های فهرست‌شده کامل شد. |
| `delete.delivered` | Already delivered messages and external copies cannot be recalled. | پیام‌های تحویل‌شده و نسخه‌های خارجی را نمی‌توان بازپس گرفت. |
| `browser.useTab` | Use this worker tab for this task | استفاده از این زبانهٔ محیط مجزای وکس برای همین کار |
| `browser.session` | Isolated Vox session: {session} | نشست مجزای وکس: {session} |
| `browser.boundary` | Choose a tab inside this isolated Vox session. Your personal browser is not connected. | زبانه‌ای را در همین نشست مجزای وکس انتخاب کنید. مرورگر شخصی شما متصل نیست. |
| `browser.capturing` | Using {origin} in {session} for this task | در حال استفاده از {origin} در {session} برای همین کار |
| `browser.changed` | The page changed. Review access before continuing. | صفحه تغییر کرده است. پیش از ادامه، دسترسی را بررسی کنید. |
| `error.retry` | Try again | تلاش دوباره |
| `error.refresh` | Refresh status | تازه‌سازی وضعیت |
| `error.service` | Service temporarily unavailable | سرویس موقتاً در دسترس نیست |
| `error.rate` | Limit reached. Try after {time}. | به محدودیت رسیده‌اید. پس از {time} دوباره تلاش کنید. |
| `error.requirements` | View requirements | دیدن الزامات |
| `error.approval` | Your workspace administrator must approve this capability. | مدیر فضای کاری باید این قابلیت را تأیید کند. |
| `error.report` | Report an issue | گزارش مشکل |
| `error.reportBody` | Review the error code, time, platform and reference before sending. Private content and source addresses are excluded. | پیش از ارسال، کد خطا، زمان، پلتفرم و شناسهٔ پیگیری را بررسی کنید. محتوای خصوصی و نشانی منابع ارسال نمی‌شوند. |
| `error.reportSend` | Send report to {receiver} | ارسال گزارش به {receiver} |
| `error.reference` | Reference: {reference} | شناسهٔ پیگیری: {reference} |
| `common.cancel` | Cancel | انصراف |
| `common.close` | Close | بستن |
| `common.details` | Details | جزئیات |
| `common.unavailable` | Unavailable | در دسترس نیست |

Dynamic content rules: `{resources}`, `{grants}`, `{scope}` and `{recipients}` are already localized, server-authorized readable lists, never untrusted HTML or a provider's free-form error. Show complete recipients in review; overflow can expand but cannot hide the decision. Use locale-aware plural/list/date formatting and an explicit timezone for deadlines, expiry and analytics; do not concatenate English plural suffixes. The API's authoritative dates/limits supply values; absent values show **Unavailable**, never guessed dates or literal braces. IDs/hostnames/email addresses are isolated as LTR text, independently of the surrounding locale. Account labels can be user-edited presentation only; stable identities remain server-bound.

## 10. Accessibility, RTL and native-device acceptance

Target **WCAG 2.2 AA** and the stricter product requirement of 44 px minimum interactive hit areas for Connections, using the existing 52 px primary buttons. WCAG 2.5.8 sets a 24 px AA minimum with exceptions; 44 px here is a product choice, not a misstatement of that rule. [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Check text contrast (4.5:1 ordinary text, 3:1 qualifying large text), meaningful non-text contrast, visible focus, accessible names and status announcements on actual token pairings.

| Area | Implementable requirement / expected proof |
|---|---|
| Modal sheets | Heading-linked dialog name, inert background, initial focus on heading/least destructive control as appropriate, Tab/Shift+Tab contained, Escape/visible Close cancel, focus restored to invoking control. Drag-to-dismiss cannot be the only exit and never commits a choice. Existing `Sheet` requires extension. [WAI dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). |
| Full-screen setup | Real headings/landmarks, predictable focus on navigation, labelled inputs/fieldset legends, retained selections on recoverable errors. Native Telegram Back, visible Back and Escape rules agree. No duplicate approval by pressing Enter while provider status refreshes. |
| Feedback | `aria-busy` for the affected section; `role=status` for progress/success; one polite announcement per meaningful state; `role=alert` for a blocking error. Spinner/icon is decorative when accompanying text. No repeated polling announcements or disappearing outcome-only toast. |
| Resource controls | Native checkboxes, mixed state for a selected subtree if applicable, accessible parent context and selection count; buttons expanded/collapsed state. Search results updates announce count without stealing focus. Virtualization must preserve keyboard and screen-reader reading order. |
| Review | Complete account/agent/resources/audience/action accessible in the reading order before the commit button. Do not put the material restriction in a tooltip. Display diff/text alternative for graphical change previews. Disabled actions have a nearby reason and reachable remedy. |
| Small viewport / zoom | One column at 320 CSS px; no horizontal page scroll; 200% text and 400% browser zoom/reflow where applicable. Long email/host/file names wrap safely. Bottom safe area, tabbar, dock and software keyboard never hide a focused control or the review effect. Use scroll padding and adaptive dock placement. [W3C focus visibility guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html). |
| Reduced motion | Respect `prefers-reduced-motion` for route/sheet/Spinner motion as well as existing cloud/shimmer animation. Do not depend on haptics, animation or color to communicate approval or revocation. |
| FA / bidirectional content | Set `lang=fa` and `dir=rtl` on the full Connections flow, not just paragraphs. Use CSS logical margins/padding/insets; mirror back/forward arrows, row chevrons and step direction, not logos/checkmarks. Preserve logical DOM/focus order. Use `<bdi>`/explicit LTR islands for host/email/IDs and `dir=auto` for user text; do not manually reverse strings. [W3C direction guidance](https://www.w3.org/International/questions/qa-html-dir). |
| Persian typography | Qualify actual bundled font glyphs, shaping, punctuation, numerals, line heights and mixed-script rendering on target devices. The existing Onest/Unbounded system does not prove Persian coverage. Native reviewer checks idiom, permissions meaning, “draft”/“grant” terminology and line wrapping with screen-reader pronunciation. |
| Repeated entry | Preserve safe selected values across same-process review/back/provider return; do not require retyping account/resource names or copying codes. Security reauthentication and expired/invalid choices are explained exceptions. Never preserve sensitive prior-person content for convenience. [W3C redundant-entry guidance](https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html). |

### Required release evidence matrix

All cells are **UNAVAILABLE** in this design task. Record exact app/build, Telegram version, OS/browser, locale, device, test fixture and candidate revision when executed. Browser emulation or a synthetic local mock may verify layout/state semantics; it cannot satisfy native OAuth handoff, physical keyboard/safe-area behavior, assistive technology or provider-grant proof.

| Target | Required EN and FA/RTL run | Native release gate / evidence owner |
|---|---|---|
| Telegram iOS on a physical iPhone, compact and current supported sizes | Connect in default browser → provider cancel/success → return/reopen; app killed mid-flow; wrong account; 200% text/Dynamic Type as supported; keyboard covers input; safe areas; VoiceOver; Back and revoke | QA with privacy-approved synthetic accounts; actual external-browser isolation and secure bound return must pass. Native Persian reviewer signs copy/layout separately. |
| Telegram Android on a physical phone, compact and current supported sizes | Same; system Back vs Mini App Back; browser choice/default and denied link opening; process recreation; TalkBack/font scaling; low connectivity and pending revoke | QA; qualify external browser behavior and one-time return on supported versions rather than assume bridge method name proves it. Native Persian review required. |
| Telegram Desktop on macOS | External default browser handoff/return; keyboard-only Tab/Shift+Tab/Escape; VoiceOver; window resizing; duplicate tabs/returns; browser account mismatch | QA; no secrets in URL/history/notification title and no duplicate grant/action on repeated callback. |
| Telegram Desktop on Windows / supported Linux desktop | Handoff/return and reopen fallback; keyboard focus; representative screen reader; narrow window; default browser association missing | QA; supported platform inventory must be explicit. Unsupported combinations receive safe fallback/unavailable, not an unverified success claim. |
| Supported standalone Studio web browsers | Read-only fixture navigation; focus traps/restoration; screen reader; 320 px, zoom/reflow, contrast, reduced motion, RTL mixed names | Frontend + independent QA. Direct web entry without the required authenticated context reveals no private connection details. |
| Telegram group entry and multi-person output | Unknown/guest/new member; private versus shared grant; switch audience during generation; previously allowed member removed | Privacy/security + QA; source titles/content do not reach unauthorized humans/models; group invitation is not historical-source authority. |
| Reconnect/revoke/delete across two devices | Stop in one device while second is active; provider offline; callback replay; queued action; purge partial failure/backup pending | Backend/security + QA; capture timestamped invalidation and authoritative states. UI alone cannot satisfy this gate. |

Acceptance IDs for implementation backlog:

| ID | Deterministic acceptance criterion |
|---|---|
| `CONN-UX-01` | Existing four tabs remain; account and agent entry land in the same space-aware Connections destination; Back restores the origin. |
| `CONN-UX-02` | New successful provider sign-in shows **Connected · No agent access** until a separate current grant is committed; no selected agent is silently approved. |
| `CONN-UX-03` | Review exposes exact account/space/resources/agent/actions/audience/expiry, provider-versus-Vox restriction mismatch, and independent memory state in both languages. |
| `CONN-UX-04` | Same-grant reads/local drafts produce no repeated permission prompt; changed account/resource/audience/action or expired grant cannot reuse approval. |
| `CONN-UX-05` | Meaningful external effect has version-bound exact preview and action-named commit; unknown/partial/cancel outcomes cannot show unqualified success or a blind retry. |
| `CONN-UX-06` | Switching Work/Personal or user context conceals old private data, cancels stale results and cannot move grants/drafts automatically. Work lists, search, badges and reconnect prompts expose no Personal account metadata, including to that account's owner while in Work. Owner/admin view has no other person's personal account/activity/content. |
| `CONN-UX-07` | Reconnect same-account restriction intersection, wrong-account rejection, one-agent revoke, disconnect, pending provider revoke and independent deletion states are distinguishable and persistent. |
| `CONN-UX-08` | Source loss/correction revokes or marks derivatives before use; ordinary task retrieval does not enable durable memory/training; private parent titles are not revealed through shared projections. |
| `CONN-UX-09` | Keyboard/AT, 44 px hit areas, reflow/zoom, error persistence, focus visibility, reduced motion, EN/FA parity and RTL mixed text pass on the declared supported surfaces. |
| `CONN-UX-10` | Physical iOS/Android Telegram OAuth return, cancellation, browser isolation, replay, app restart and session/account mismatch pass the native matrix before release. Native Persian sign-off is recorded; screenshots alone cannot waive it. |
| `CONN-UX-11` | Service selectors describe actual qualified capability/resource limits; no checkbox promises per-label OAuth, personal-browser attachment/profile access or unrestricted server diagnostics. Browser selection shows the isolated Vox worker/session identity and permits only a tab inside that owner/space-bound worker; attempts to attach an existing personal tab are unavailable. Unavailable capabilities are honestly disabled. |
| `CONN-UX-12` | Generic reports/notifications/administrative metrics exclude private content, source names/URLs and credentials; optional report content has an explicit preview and separate approved destination. |

## 11. Handoff and limits

Disposition: **ready for coordinated product, architecture and privacy review; no implementation acceptance claimed**. Source inspection at the stated baseline established current screens/tokens/localization and exposed existing dialog/localization seams; it did not test live provider permissions or runtime enforcement. Research consulted official W3C, Telegram and RFC sources linked beside their associated decisions. No external provider calls, paid actions, messages, product mutations or native tests were performed.

Next owners: architecture/security approve the exact grant, provider-rights/audience evaluation, server transaction/return, action-plan and lifecycle contracts before frontend controls can make promises. Product confirms supported providers/actions and rollout; native Persian reviewer approves copy; frontend implements the accepted version; independent QA executes synthetic and native acceptance. Exact retention periods, grant expiry defaults, safe propagation SLAs, organization service-account authority, support route/retention and available provider restrictions must come from those approved contracts. Unknown values stay unavailable and block their affected capability; this design does not choose an authority on another person's behalf.
