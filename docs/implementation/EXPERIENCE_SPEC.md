# Vox Studio experience contract — first delivery stage

Design version: `experience.v1-draft`, 19 October 2026. Tasks: **VOX-003, VOX-004; design-only VOX-005**. Author role: `vox_ux_designer`. Source baseline: `ebb75a67c79bf317d1dec40381b216c75bb90ffa`, with the supplied uncommitted implementation planning package. Owned artifact: this file only.

**Disposition: ready for product/privacy review, not approved for collection or release.** This is an implementable design specification derived from source and synthetic scenarios. No usability participants, browser sessions, legal approvals, provider calls, implementation completion or deployed behavior are claimed. The six walkthroughs below are deterministic review scripts with expected outcomes, not reports that the application passed them. EN/FA copy needs native-language and privacy review before publication. Existing plan dependencies and launch gates remain authoritative.

Inputs: [plan](PLAN.md), [backlog](BACKLOG.json), [privacy and consent](PRIVACY_AND_CONSENT.md), [team](TEAM.md), [memory strategy](../AGENT_MEMORY_STRATEGY.md). This specification translates those requirements; it does not settle lawful basis, registered entity, provider eligibility, retention periods or biometric release terms.

Traceability: sections 2–4 implement the design intent of REQ-01/02/03/08/09/20 and PRIV-001/002/004/007/010–017/022/024/026–028/032–037; section 6 covers REQ-10/11 and PRIV-029–031; section 7 covers REQ-12/13 and PRIV-005/017–025. These are design mappings, not evidence that runtime requirements pass.

## 1. First frontend slice and source map

**Recommended first frontend slice:** one persistent context strip, one first-use screen, and one **Privacy and memory** screen reached from the existing account sheet. Implement EN/FA, off/loading/unavailable states and read-only server facts first. Add functional purpose switches only with VOX-011 authoritative receipts and verified-person scope; add memory mutations only with authorization/deletion handlers. A fixture/demo can illustrate states when clearly labelled; it must never make a real grant, verification or deletion claim. This slice is a proposal for VOX-012, not completion of it.

| Actual source seam | Observed baseline | Required handoff |
|---|---|---|
| `src/app/studio/page.tsx` → `_components/StudioApp.tsx` | `/studio` renders `StudioApp`; an in-memory `Route` union manages home/groups/org/agent/spawn/call/memories/fire. No privacy/inbox/onboarding screen. | First-use is a boot stage before optional collection, not a new repeated modal. Propose `Route {name:'privacy'; section?:…}` and later `{name:'inbox'}` in this same stack; these are proposed internal routes, not existing URLs. Keep the three current bottom tabs. |
| `StudioApp.Nav`, `_lib/client.ts` `Me` | `Me` contains Telegram member, org, bot and avatar/voice/call flags. No verified person, spaces, consent, audience or policy snapshot. | Add server-derived context/policy snapshot via the architecture contract. Do not derive verified person or Personal availability from a Telegram display name, role or browser setting. |
| `screens/Home.tsx` account button and `Sheet`; `UserInfo.tsx` | Role pill opens account details; `UserInfo` can read unverified Telegram `initDataUnsafe` for display. | Add person, account, space, Privacy and memory, Inbox entries. Keep account details labelled as account details. Server-verified context is a distinct row. UserInfo must not become a person-verification factor. |
| `screens/Agent.tsx` Chat/Call/Group/Memories actions and visibility sheet | Chat opens the agent's Telegram bot; visibility selects who can converse. | Add context summary above actions. Conversation access is separate from memory access. Telegram Chat must use the same server purpose/audience gates; Studio disclosure alone cannot establish another channel's first-use decision. |
| `screens/Memories.tsx`, `_lib/client.ts` `MemoryItem` | All/Private/Shared filters; content/scope/source/date; `mine` controls deletion. Empty copy says memories form automatically; confirmation says “forget … for good.” | Replace automatic-memory assumption and absolute deletion promise. Add readable recipients, agent grants, evidence/status, permitted capabilities, lifecycle/receipt references. Use inline card details and a single review sheet for save/share. `mine` is not the new capability policy. |
| `screens/Groups.tsx`, `GroupItem` | Group count, guests flag, agent links; no complete participant roster or history authority. | Expand a group card to show authorized audience/history detail. Count/`hasGuests=false` alone cannot mean a verified audience. No sharing when authoritative membership/history snapshot is missing. |
| `screens/Call.tsx`, `api.callTurn`, `service.ts` `callTurn` | Tap requests microphone then sends recorded turn to STT/conversation/TTS. No text composer, recognition enrollment, jurisdiction or person gate here. | Before capture, render reviewed audio notice and server eligibility. **Use text** must lead to a working, gated text path; add that path or qualified Telegram alternative before calling it equivalent. Recognition is a separate, disabled capability until qualified. |
| `service.ts` `memoriesFor` / `forgetMemory`; `src/lib/studio/types.ts` | Account-based person mapping; memory view is a projection; forgetting deletes the memory row. No purge receipt. | Do not display global withdrawal, derivative purge, provider deletion or backup completion based on these existing responses. Required contracts come from VOX-009/010/011/014/056. |
| `_components/ui.tsx` `Sheet`, `TopBar`, `Empty`; `studio.css` | Shared bottom sheet/dialog and dark visual tokens; Sheet has no focus trapping/restoration or Escape handling. Many left/right styles and English strings. | Reuse visual language; add accessible dialog behavior, logical layout properties, localization and adequate target sizes. Do not assume `aria-modal` alone makes Sheet accessible. |

All paths above are relative to repository root. New component names below describe responsibilities, not delivered files. Work remains useful without optional purposes. Marketing has **no control, prompt, enrollment endpoint or delivery path** in this initial design.

## 2. Shared context and navigation

Keep a compact context strip visible above screen content on home, groups, agent, memories, privacy, inbox and call. It wraps to two rows on small screens; it never truncates person, space or audience behind an icon. On deep screens retain the existing TopBar/back behavior. Do not insert a confirmation into ordinary navigation.

```text
Vox Studio                                    [Account]
[Work · HOOR ▾]  [Person: Sara · verified ▾]
Audience: Only you                  [Privacy and memory]
-------------------------------------------------------
Current screen
[Agents]                 [Groups]                 [Org]
```

The strip has three independent values: **space**, **verified person**, and **current output audience**. Memory destination appears at every save/share decision; it is not the same as current output audience. The owner role remains account/workspace administration, never “can see all private memory.” In account details show this sentence: “Workspace administration does not grant access to other people's private memories.” / «مدیریت فضای کاری به معنای دسترسی به حافظه‌های خصوصی دیگران نیست.»

| Context state / trigger | Visible behavior and recovery |
|---|---|
| Context loading | “Checking your context…”; no cached private content underneath; optional collection, memory writes and restricted replies wait. Core public/current-turn text can continue only if the core server policy permits it. |
| Work space selected | `Work · {name}`; list only spaces the server authorizes. Personal is a separate space even if recipients happen to match. No automatic cross-space search/export. |
| Person verified | `Person: {name} · verified`; expose verification expiry/details without secrets. A Telegram account badge alone does not produce this state. |
| Shared account / person unknown / verification expired | `Person not verified`; no private-memory cards, hints, preferences or saved transcript from a previous person. **Verify person** and policy-permitted text/current-session route remain available. Do not display a guessed person's name. |
| Space switch | Select the space in the existing account/context sheet. Cancel current restricted generation/capture, clear private caches/UI/captions and switch only after server acknowledgment. Return to home in the destination with its own settings, agent availability and verified context. No extra “Are you sure?” dialog. Keep an unsent draft scoped to its original space; never auto-submit/move it. |
| Switch fails / offline | Remain in old authoritative space; display “Couldn't switch. You are still in {space}.” Stop affected optional/restricted work until context freshness is restored. Retry is explicit. |
| Audience known | “Only you” or full named roster with group name. A compact “{n} people” may open details, but the action preview must list all names. |
| Audience unknown / changed | “Audience not confirmed”; stop restricted output, clear unsent buffers and ask for a confirmed private channel or current-session text mode. Joining members do not gain earlier history. No promise to detect physical bystanders. |
| Leaving/logging out | End device leases and clear private rendered state. Reopening requires server context; do not restore private history from a local route stack. |

**Authenticated person switch:** Account → Switch person opens a panel in that same sheet. Show only safe, server-authorized selection options, or a generic **Verify another person** action; never expose an identity directory to an unverified user. Choosing a name requests approved authentication and does not complete the switch. While verifying, the old person's content is concealed. Success binds the new person/space/session on the server and resets navigation; cancellation returns to a safe, unverified state with **Verify person**. Failure says “We couldn't verify this person. No profile was switched.” Voice resemblance and “yes, that's me” are insufficient. Keep the authentication method as a VOX-009 security contract; do not invent a password, email or biometric factor.

## 3. VOX-003 — First use and privacy center

### First use: one screen, optional purposes off

After account/core eligibility is resolved and before sending content, show language selection, the UX-01 disclosure, a data-details link and the proportionate adult entry action on one scrollable screen. The first-use notice must also exist at the first Telegram interaction for users who never open Studio. Disclosure is informational; adult declaration is a distinct record; neither is optional consent. No full birth date by default.

```text
[English | فارسی]
Vox is an AI assistant
{UX-01 disclosure}
History for this conversation: {verified history summary}
[How your data is used]
Optional memory, personalization and usage analytics: Off
[I'm 18 or older — Continue]       [I'm under 18]
[Optional choices]  → Privacy and memory, all off
```

Use UX-01 EN/FA verbatim from the privacy draft, with the approved notice version. **Continue** must not grant any optional purpose. Optional choices is a peer text link, never the only refusal route. If selected, it opens the privacy screen with the first-use context and a persistent Continue action; returning without a grant leaves everything off. Under-18 action stops entry/capture and offers the approved incidental-data/request route; do not store free-form age evidence. A pending policy/unknown jurisdiction blocks the affected feature with its reason, never resolves to permission. Unknown essential core notice/provider/retention facts block core activation pending the privacy owner; do not interpolate `undefined`, template braces or a draft retention estimate into public copy.

Returning users see no repeat optional prompt after refusal. Show a new just-in-time choice only when they deliberately open settings/request that feature or a material policy change requires it. Changing EN↔FA preserves unsubmitted choices; the receipt records the exact rendered locale/version/hash, not a blended notice. A missing translation disables the affected grant while core use follows its independently approved notice.

Optional choices may be inspected before the adult entry action, but no optional grant/capture is enabled until adult and applicable identity/jurisdiction eligibility is authoritatively resolved. On a shared device, sensitive grants, enrollment, exports and private settings require the approved fresh person authentication. A person can still stop local optional capture immediately while authentication or withdrawal synchronization is pending.

### Privacy and memory: one screen, progressive detail

Account/context strip → **Privacy and memory** → sections. Do not add another bottom tab. The title always includes active person and space. Separate **Conversation history**, **Memory and preferences**, **Optional uses**, **Notifications**, **Voice**, **Your requests**. Expand a row in place for detail; use a review sheet only for a real scope/content grant or irreversible deletion.

```text
< Back       Privacy and memory
Sara · Work · HOOR                     [Change context]
Conversation history       {actual retention} [Manage]
Automatic memory                           [Off]
Personalization                            [Off]
Usage analytics                            [Off]
Requested reminders             [Manage reminders]
Proactive suggestions                      [Off]
Voice recognition           [Unavailable / Off / On]
[Review preferences] [Saved memories]
[Your data requests] [How your data is used]
```

For each purpose show its current server state, scope/person/space, allowed agents/devices/channels where relevant, last change, saved data summary, purpose notice version, processors/retention details link, receipt/status link and an equally accessible one-step **Turn off**. Turning on expands its complete just-in-time terms and comparable **Turn on** / **Keep off** buttons. This prevents a bare switch from silently granting an unseen purpose; off remains one step. A collapsed row must expose its current state to assistive technology.

| Purpose/control | Default and exact interaction |
|---|---|
| `optional.auto_memory` | Off. Use UX-05; named person/space/agents. Grant permits eligible automatic extraction only in that scope. Explicit saving remains a separate narrow request while this is off. |
| `optional.personalization` | Off. Use UX-04; named person/space. Turning off stops future inference/use; show a separate **Delete earlier inferred preferences** action. Never silently erase explicit preferences or chat history. |
| `optional.product_analytics` | Off. Use UX-03 and verified recipient. It enables no transcript, human review, training, memory, voice or notification purpose. |
| `optional.reminder_delivery` | Off until a deliberate reminder/channel selection. Manage requests separately from proactive suggestions; see section 6. |
| `optional.proactive_suggestions` | Off. Use UX-11 with explicit channel, cap and quiet hours before enabling. It does not enable automatic memory or analytics. |
| `optional.content_quality_review` | Off; no account-wide “review my chats” switch. A deliberately selected issue/case uses UX-14, exact data selection, named reviewers/end date and final review. No donation without all required subject/audience authority. |
| `optional.biometric_recognition` | Off/unavailable. No sample or comparison until reviewed feature gate and separate release are satisfied; see section 7. |
| History | A separate server-supported retention/temporary control, not an optional-analytics switch. Show the approved numeric period or meaningful criterion; draft 30 days is not a shipped promise. **Delete conversation history** is separate from deleting durable memory. |
| Marketing / shared model training | No initial enrollment UI. Training and marketing remain disabled. Do not render the future UX-12 copy. Any published claim about providers needs contractual/configuration evidence. |

**Temporary conversation:** offer it only when the server can enforce its complete retention policy, including queue/retry/dead-letter/log/speculative copies. Before activation show EN: “Temporary conversation: new turns are not saved as chat history or durable memory. Earlier saved history is unchanged. Processing buffers and provider retention: {verified_summary}.” FA: «گفتگوی موقت: نوبت‌های جدید در سابقهٔ گفتگو یا حافظهٔ پایدار ذخیره نمی‌شوند. سابقهٔ ذخیره‌شدهٔ قبلی تغییری نمی‌کند. بافرهای پردازش و نگهداری نزد ارائه‌دهندگان: {verified_summary_fa}.» This is not a universal zero-retention claim. Activation waits for the authoritative mode receipt; failure leaves the prior mode clearly labelled and does not send the next turn under an assumed temporary policy. Exiting affects future turns only and never silently persists temporary turns. Show the current mode beside the composer/call controls; unknown policy disables submission until clarified.

### Purpose and deletion states

Client states map to server-owned permission/deletion state separately; browser storage cannot be the authority. A successful switch is never inferred from HTTP request initiation. Pending/failure messages persist in the screen rather than relying on the existing 3.2-second toast.

| State | Control, copy and allowed behavior |
|---|---|
| Not asked / declined | Off. **Turn on** requires deliberate expansion/review. No repeated solicitation. Refusal keeps core use available. |
| Presented / saving grant | Off until durable granted receipt. Spinner labelled “Saving choice…”; prevent duplicate submit, keep Cancel for unsubmitted choice. Capture does not start. |
| Granted | On only after current-version, unexpired server receipt. Show scope/time and **Turn off**. |
| Expired / reconsent required / suspended | “Off · review needed” / “Unavailable”; no use, no prechecked regrant. Explain the specific safe reason and show review when permitted. Do not call suspension the person's withdrawal. |
| Off requested / server pending | Stop this device's new optional work immediately. “Stopped on this device. Account change waiting to sync.” Retry with same operation reference; no “off everywhere.” |
| Withdrawal acknowledged | “Off. Future use for this purpose has stopped.” Show authoritative receipt. Existing saved data and purge status remain separate. No automatic fallback basis to keep doing the refused activity. |
| Deletion review | Show selected categories/scope and consequences. **Request deletion** / **Keep data**. Do not preselect unrelated history/preferences. No typed-name challenge for ordinary memory deletion. |
| Deletion requested, no suppression receipt | “Deletion requested. Waiting for confirmation that use is blocked.” Keep status visible; do not claim blocked or complete. |
| Suppressed / queued / purging | “Blocked from use. Deletion in progress.” Only after server confirms suppression, including applicable derivatives. Show per-system status. |
| Online purge completed | “Deleted from active systems. Remaining copies: {verified provider/backup status}.” No “all copies deleted.” |
| Provider pending / backup expiry pending | Show actual system/date or “Date not confirmed” with trackable request. Do not fabricate a countdown. Copy uses UX-15 and the verified contact. |
| Partial failure | “Blocked from use. Some deletion steps need attention.” Identify safe system categories, last attempt, support/request link; retry is idempotent. No green completion banner. |
| Completed with retained exception | Show completed acknowledgments and separately justified restricted evidence/expiry. Do not imply that consent evidence/security holds are usable for the withdrawn feature. |
| API/connection failure | Keep last confirmed status visibly dated; mark it stale. Pending off stays locally suppressed. Load/retry errors do not reset a toggle to On. |

**Correction/reset/rights:** Your requests offers access/export, correction, deletion, restriction, objection and applicable portability/withdrawal, in EN/FA. Show requester verification, request reference, scope, received time, server-supplied deadline, progress, any lawful extension/reason and completion receipt; never invent a deadline. Exports omit other people's private data and use authorized expiring retrieval. Provide a no-account guest entry from the notice and first-interaction text, with proportionate non-biometric verification and safe tracking. Until VOX-056 handlers/contact are real, label the request route unavailable with its actual support alternative; never display a successful export/request merely because a client form submitted.

## 4. VOX-004 — Memory destinations and sharing

### Save and share: one review surface

Agent → Memories preserves the existing list/filter layout; replace filters with **All / Only me / Shared** with localized accessible labels. Scope alone never authorizes a returned item: server filtering/capabilities are required. The empty state is “No saved memories here. You can ask Vox to save a detail. Automatic memory is {state}.” / «اینجا حافظهٔ ذخیره‌شده‌ای نیست. می‌توانید از Vox بخواهید جزئیاتی را ذخیره کند. حافظهٔ خودکار {state_fa} است.» No suggestion that simply talking grants automatic memory.

An explicit “remember this” creates a **proposal**, not a completed save. A card's **Share** opens the same review surface. Default is Only me in the active space, with the current agent named; no silent wider agent grant. Sensitive/third-party facts stop at the approved authority/sensitivity gate before any content is placed in a preview available to another person.

```text
Save memory / Share memory                         [Close]
Exact sentence: [Vox launch is Friday.                ]
Space: Work · HOOR
Destination: (•) Only me  ( ) This group  ( ) Selected people
People: Sara, Ali, Reza              [Edit selection]
Agents that may use it: Aria         [Edit if permitted]
Use: future conversation answers · Until: {approved term}
Earlier chat history: Not shared
New group members: No earlier memories automatically
{cross-space warning or source projection explanation}
[Save this memory / Share this sentence]   [Don't save / Cancel]
```

All review content including recipients, agent names and history consequence stays visible before the one final action. Selection changes recompute the preview in this same surface, not another confirmation modal. Large recipient lists are scrollable fully named lists with disambiguating safe labels; counts/avatars cannot replace them. The full list must be available before submit. Show the author among recipients when included; do not implicitly add an organization. Exact text is independently editable to make a minimal projection (for example, “Sara is unavailable Friday” without the private reason). Never show restricted parent text/source labels to recipients.

| Destination | Membership and history contract |
|---|---|
| Only me | Current verified person in active space; named allowed agents/purposes. No other person gains access from owning the agent/workspace. |
| This group | Choose one group in the active space and fetch full authorized roster/membership version. Default: **new members do not receive earlier memories**. Show exact current recipients and history policy per grant. A group invitation itself never shares prior private conversation. |
| Selected people | Choose exact named people permitted by the active-space directory; fixed set, independent of Telegram chat membership. A later group join does not add a recipient. Adding/removing anyone is a new grant/revoke review. Fixed-set recipient choice is the initial simple path; do not infer a dynamic “everyone in Work” rule. |
| Cross-space transfer | Explicitly select the destination and review a separately approved revocable projection, recipients, agents, expiry and source lineage. Show **From Work · HOOR → Personal**. Default remains current space. No full-chat copy or independent export unless explicitly requested/reviewed as such. Missing export/share authority blocks submit. |
| Group earlier-history expansion | If authorized capability exists, a deliberate **Share selected earlier memories** action selects exact records and shows the new named audience and consequences. There is no blanket “include all history” default. Continuing-group future-member access requires its own explicit, versioned grant; initial fixed-roster behavior does not implement it. |

**Recheck before commit and delivery:** Preview carries source/content version, context/person/space, recipient and membership version, agents/purpose, expiry and policy version. If any changes, keep the draft but disable submit and update/announce the preview. A changed roster requires a fresh deliberate final action. Unknown membership, pending person verification, unauthorized source, stale snapshot or offline submission means no share. Do not queue an offline share for later automatic delivery. Denied recipients are not listed from an unauthorized directory. Show “Audience changed. Review the updated recipients before sharing.”

### Card details, correction, revoke and forget

Each memory card shows exact content, active space, destination, readable human audience, usable-by agents/purposes, source attribution/allowed source link, last update, expiry and **Explicit / Suggested / Confirmed / Disputed / Superseded** as applicable. Do not expose inaccessible source facts in “Why this?” or a notification. Suggested items say “This may be wrong”; repeated reports do not become confirmed truth.

| Action/state | Result and recovery |
|---|---|
| Loading / empty / error | Skeleton has accessible loading status. Empty offers explicit save and settings. Error remains on Memories with inline Retry rather than navigating away; never mislabel failed fetch as no memories. |
| Why this? | Expand the safe source/reason and scope in the card. For an inference show permitted non-sensitive evidence, date and expiry, not an LLM confidence score as proof. |
| Correct | Inline edit → **Save correction** / **Cancel**. Only permitted editor capabilities appear. Commit supersedes relevant content, suppresses stale derivatives and announces authoritative success. Materially changed shared content requires reviewed projection/grant before reuse. Failed correction preserves draft, shows retry, leaves last authoritative version labelled. |
| Stop sharing | One deliberate action stops future access after acknowledgment; pending request locally suppresses use and shows sync pending. Report remaining already delivered/copy limitations. Restoring sharing requires a fresh exact-content/audience preview; no automatic undo of a revoke. |
| Forget | One review sheet names this record, linked derived data and eligible source-history choice separately. Submit enters the deletion states in section 3. The existing `DELETE memories` response is insufficient to claim complete purge. The record can leave the active list after suppression while its status remains in Your requests. |
| Unsupported capability | Do not render an enabled button that only changes browser state. Provide “Not available yet” with reason in a design/demo; production visibility follows release capability decisions. Lack of edit rights offers the approved correction/request route without leaking the author. |
| Undo | Unsaved edits cancel freely. For a committed preference change, Undo submits a new version restoring the preceding permitted preference; errors show that it was not restored. Deletion has no restoration promise after submission. An expired snackbar must not be the sole way to correct a change. |

### Personalization: simple precedence, visible explanation

In Privacy → Review preferences, split each item by **You chose** or **Suggested by Vox**, with value, space/agents, reason, last change and expiry. Current explicit request wins over explicit saved preference, which wins over an allowed unconfirmed hypothesis; no inferred preference crosses spaces or expands permissions. A request “be brief in this answer” applies now without enabling future learning or creating durable memory.

A suggestion uses UX-13 as an inline card with **Use shorter replies** / **Keep current style**, **Why this?**, **Dismiss**, and settings link. Explicit acceptance saves only the reviewed preference in the shown scope; it is not automatic-memory or personalization opt-in. If a hypothesis can affect behavior under an existing grant, display a persistent “Using a suggested preference” chip with **Why this? / Change / Reset**, never silently turn a hypothesis into a confirmed trait. A sensitive/prohibited inference never reaches this UI. Reset separately selects **Inferred preferences** versus **Explicit preferences**, previews scope and uses the same receipt/purge model. Turning learning off is separate and stays available without deleting.

## 5. Shared EN/FA interaction copy and accessibility

Use privacy document UX-01 through UX-11 and UX-13 through UX-15 as the long-copy authority. The table adds short labels/recovery copy; both languages must map to identical stable message keys and placeholder sets. Placeholders resolve to verified facts and localized plural/date/retention text. These are draft translations, not publication approval.

| Key / intent | English | فارسی |
|---|---|---|
| `space.work` / `space.personal` | Work · {name} / Personal | کاری · {name} / شخصی |
| `person.verified` | Person: {name} · verified | شخص: {name} · تأییدشده |
| `person.unknown` / action | Person not verified / Verify person | شخص تأیید نشده / تأیید هویت شخص |
| `person.switch` / failure | Switch person / We couldn't verify this person. No profile was switched. | تغییر شخص / نتوانستیم هویت این شخص را تأیید کنیم. نمایه‌ای تغییر نکرد. |
| `context.loading` | Checking your context… | در حال بررسی زمینهٔ شما… |
| `space.failed` | Couldn't switch. You are still in {space}. | تغییر فضا انجام نشد. هنوز در {space} هستید. |
| `audience.only` / `audience.unknown` | Audience: Only you / Audience not confirmed | مخاطب: فقط شما / مخاطبان تأیید نشده‌اند |
| `privacy.title` | Privacy and memory | حریم خصوصی و حافظه |
| `first.adult` / `first.underage` | I'm 18 or older — Continue / I'm under 18 | ۱۸ سال یا بیشتر دارم — ادامه / زیر ۱۸ سال دارم |
| `first.options` / `notice.details` | Optional choices / How your data is used | انتخاب‌های اختیاری / داده‌های شما چگونه استفاده می‌شوند |
| `purpose.auto` / `purpose.adapt` / `purpose.analytics` | Automatic memory / Personalization / Usage analytics | حافظهٔ خودکار / شخصی‌سازی / تحلیل استفاده |
| `purpose.off` / `purpose.on` / `purpose.keepOff` | Turn off / Turn on / Keep off | خاموش کردن / فعال کردن / خاموش بماند |
| `choice.saving` / `choice.failed` | Saving choice… / Couldn't save your choice. This option remains off. | در حال ذخیرهٔ انتخاب… / انتخاب شما ذخیره نشد. این گزینه خاموش می‌ماند. |
| `withdraw.pending` | Stopped on this device. Account change waiting to sync. | در این دستگاه متوقف شد. تغییر حساب در انتظار همگام‌سازی است. |
| `withdraw.done` | Off. Future use for this purpose has stopped. | خاموش است. استفادهٔ بعدی برای این هدف متوقف شده است. |
| `memory.only` / `memory.group` / `memory.people` | Only me / This group / Selected people | فقط من / این گروه / افراد انتخاب‌شده |
| `memory.agents` / `memory.history` | Agents that may use it / Earlier chat history: Not shared | عامل‌هایی که اجازهٔ استفاده دارند / سابقهٔ قبلی گفتگو: به اشتراک گذاشته نمی‌شود |
| `memory.newMembers` | New members do not receive earlier memories automatically. | اعضای جدید به‌طور خودکار به حافظه‌های قبلی دسترسی پیدا نمی‌کنند. |
| `share.changed` | Audience changed. Review the updated recipients before sharing. | مخاطبان تغییر کردند. پیش از اشتراک‌گذاری، دریافت‌کنندگان جدید را بررسی کنید. |
| `memory.actions` | Correct / Share / Stop sharing / Forget | اصلاح / اشتراک‌گذاری / توقف اشتراک‌گذاری / فراموش کردن |
| `memory.save` / `memory.noSave` | Save this memory / Don't save | ذخیرهٔ این حافظه / ذخیره نشود |
| `memory.shareExact` | Share this sentence | اشتراک‌گذاری همین جمله |
| `memory.loadingError` | Couldn't load memories. Try again. | حافظه‌ها بارگیری نشدند. دوباره تلاش کنید. |
| `preference.explicit` / `preference.suggested` | You chose / Suggested by Vox · may be wrong | انتخاب شما / پیشنهاد Vox · ممکن است اشتباه باشد |
| `preference.actions` | Why this? / Change / Reset / Undo | چرا این پیشنهاد؟ / تغییر / بازنشانی / واگردانی |
| `deletion.requested` | Deletion requested. Waiting for confirmation that use is blocked. | درخواست حذف ثبت شد. در انتظار تأیید مسدود شدن استفاده هستیم. |
| `deletion.purging` | Blocked from use. Deletion in progress. | استفاده مسدود است. حذف در حال انجام است. |
| `deletion.partial` | Blocked from use. Some deletion steps need attention. | استفاده مسدود است. برخی مراحل حذف نیاز به پیگیری دارند. |
| `deletion.onlineDone` | Deleted from active systems. Remaining copies: {status}. | از سامانه‌های فعال حذف شد. وضعیت نسخه‌های باقی‌مانده: {status}. |
| `deletion.unknownDate` / `deletion.progress` | Date not confirmed / View deletion progress | تاریخ تأیید نشده / دیدن روند حذف |
| `rights.title` / `rights.request` | Your data requests / Request deletion | درخواست‌های دادهٔ شما / درخواست حذف |
| `notification.inbox` / `notification.generic` | Inbox / You have an update in Vox. Open Vox to view it. | صندوق ورودی / یک به‌روزرسانی در Vox دارید. برای دیدن آن Vox را باز کنید. |
| `notification.reminders` / `notification.suggestions` | Requested reminders / Proactive suggestions | یادآوری‌های درخواستی / پیشنهادهای پیش‌دستانه |
| `notification.quiet` / `notification.cap` | Quiet hours / Maximum suggestions per day | ساعات سکوت / بیشترین تعداد پیشنهاد در روز |
| `notification.actions` | Snooze / Cancel reminder / Dismiss / Report unwanted | تعویق / لغو یادآوری / رد کردن / گزارش پیام ناخواسته |
| `notification.permissionDenied` | Notifications are blocked for this channel. Use Inbox or choose another available channel. | اعلان‌ها در این کانال مسدود هستند. از صندوق ورودی استفاده کنید یا کانال در دسترس دیگری را انتخاب کنید. |
| `notification.noAccess` | This update is no longer available. | این به‌روزرسانی دیگر در دسترس نیست. |
| `voice.unavailable` / `voice.manual` | Voice recognition is unavailable. Use person selection. / Use person selection | شناسایی صدا در دسترس نیست. از انتخاب دستی شخص استفاده کنید. / انتخاب دستی شخص |
| `voice.cancelCapture` / `voice.failure` | Cancel recording / Couldn't finish enrollment. Use person selection or try again when available. | لغو ضبط / ثبت الگوی صدا کامل نشد. از انتخاب دستی شخص استفاده کنید یا وقتی این قابلیت در دسترس بود دوباره تلاش کنید. |
| `audio.paused` | Audio processing is paused while a new participant reviews the session. | پردازش صدا تا بررسی شرایط جلسه توسط شرکت‌کنندهٔ جدید متوقف است. |
| `common.retry` / `common.cancel` / `common.close` | Try again / Cancel / Close | تلاش دوباره / لغو / بستن |

Accessibility applies to every preceding and following flow:

- Set `lang` and `dir` on the Studio root. FA uses RTL logical layout, start/end padding/alignment and a mirrored navigation arrow; do not reverse numeric IDs, URLs, timezones, mixed-language names or editable memory content. Use isolated `bdi`/`dir=auto` for names/text and LTR isolates for identifiers. Visual reading order matches DOM/focus order. Verify a font with Persian glyph coverage; current Latin/Cyrillic assets do not demonstrate it.
- Minimum 44×44 CSS-pixel interactive targets; existing 32-pixel chips and 36-pixel trash control need larger hit areas. Wrap long FA labels, safe-area footers and audience lists at 320 CSS pixels and 200% text zoom; no clipped primary/decline action or horizontal page scrolling. Recipient and grant terms must not ellipsize.
- Each screen has an h1 and main landmark. Navigation moves focus to the h1; back restores initiating control. Visible focus, contrast at WCAG AA, non-color status text and reduced-motion behavior need actual review; this document claims no audit pass. Pause animated cloud/skeleton effects for reduced motion.
- Use labelled native controls; switches expose name, checked state, scope, description and error via accessible relationships. Read-only unavailable rows expose the reason, rather than an unexplained disabled switch. Keyboard Enter/Space activates buttons, checkboxes and switches; native/select/radio behavior remains conventional. Filters use `aria-pressed`; do not fake tabs without their keyboard model.
- A review Sheet needs accessible name, initial focus on its heading, focus containment, inert background, Escape/Close and return focus. Drag/scrim never substitutes for a Close button. Back/Escape cancels an unsubmitted grant, never commits it. A submitted irreversible operation continues with its status visible after closing; no false cancellation.
- Loading has `aria-busy` and concise polite status. Server-confirmed completion/change is announced once. Action failures use inline alert/error summary with focus when necessary; do not repeatedly announce the whole live transcript. Keep recovery/Undo controls in the page, not exclusively in a transient toast. Capture state is textual and screen-reader accessible, not only a waveform, color or haptic.
- English and Persian run the same state machine, capabilities and refusal effort. **Turn on** and **Keep off** have comparable target size, contrast and placement, side by side when space permits and consecutive full-width buttons otherwise. No hidden decline in a settings submenu, prechecked consent or timer-based acceptance.

## 6. VOX-005 design only — Reminders, suggestions and inbox

Entry points: Agent/context strip → Inbox; Privacy → Notifications; an explicit reminder request creates a review card in the current task. No unsolicited permission pop-up on first launch. Inbox is a proposed internal route, not a third-party content-bearing message. Required security/service notices are a distinct category with their factual basis explained; they carry no promotions.

**Requested reminder flow:** review user-supplied task (only within an authenticated private surface), person/space, intended recipient, local date/time **and timezone**, expiry, one selected qualified channel, generic external preview and quiet-hour/delivery behavior → **Create reminder / Cancel** (UX-10). Delivery to another person requires authority, that recipient's permitted destination and its own preview/grants; no silent “remind everyone.” Channel choice grants only that request/category. If OS permission is needed, request it only after channel selection. Denial leaves Inbox as an explicit alternative; do not repeatedly prompt. Initial channels are the authenticated inbox and explicitly opted-in existing Telegram DM; browser push is a separately qualified follow-up, and email/SMS are outside this release. No preselected alternate channel after failure.

**Proactive flow:** Privacy → Proactive suggestions → UX-11 showing source scope, channel, frequency cap and quiet hours/timezone → **Allow suggestions / Keep them off**. Follow the canonical [architecture defaults](ARCHITECTURE.md): at most **2 suggestions per rolling 24 hours per verified person across spaces**, with a visible user-adjustable cap, and editable **21:00–08:00** quiet hours in the explicitly selected IANA timezone. These are initial product defaults, not measured suitability. Unknown timezone keeps suggestions in the inbox without external delivery. Do not use this cap for requested reminders. Before grant, show the exact chosen values. A reminder falling in quiet hours must preview its actual policy, for example “Deliver at 08:00 if still relevant”; an exact-time exception requires an explicit per-reminder choice and supported policy. Never silently override quiet hours. Missed/expired reminders are not delivered late without freshness checks.

| Notification state/action | UI expectation |
|---|---|
| Empty / loading / fetch error | “No updates”; accessible loading; inline Retry respectively. Failed fetch is not an empty inbox. |
| Scheduled / queued | Show task only after current authorization, intended recipient, channel, due/timezone and status. **Snooze** chooses a new explicit time; **Cancel** cancels through server receipt. |
| Quiet / capped | Display deferred/suppressed reason and next permitted time if known. No private reason in transport receipts. |
| Provider accepted / delivered / opened / acted | Separate status values only if real evidence exists. Provider accepted never means read/heard. Unknown delivery stays unknown. |
| Permission denied / channel unavailable | Retain request as unscheduled or failed with explicit recovery; offer qualified alternatives. No silent channel fallback or automatic re-enrollment. |
| Why this? / dismiss / report | Show authorized reason/source, then dismiss without deleting source memory. Report unwanted offers **Stop suggestions** (one-step off), preference reset and safe request receipt. |
| Revoke/delete while queued | Cancel affected candidates before transport; already sent generic notifications cannot be recalled. Deep link authenticates and rechecks recipient/source/epoch, returning generic unavailable if revoked; never briefly render the old detail. |
| Shared device / locked screen | All external titles/body are the generic `notification.generic` (no person, space, agent, task, group name, thumbnail or private URL). Opaque reference only. Even a selected recipient cannot opt into content-bearing external previews in this release. |

## 7. VOX-005 design only — Audio and optional voice recognition

Agent Call is ordinary requested audio processing, not voiceprint enrollment. Preserve a clear **Use text** alternative. The audio notice uses UX-02 with actual providers/locations/retention and core eligibility before OS microphone permission. Do not label ordinary audio “not stored” from local recorder cleanup alone. No group audio until all participants' approved session gate can be enforced, including guests and new arrivals (UX-09); otherwise text remains the available route.

Voice section defaults to **Off** or **Unavailable**. Do not show a tempting enabled enrollment action where legal/provider/device gates are pending. A safe explanation and person selection link suffice. Licensing a synthetic TTS voice in Spawn is separate from recognizing the speaker; recognition never authorizes cloning.

| Enrollment step/state | Interaction and gate |
|---|---|
| Eligibility | Verified adult person, scope/device, current jurisdiction approval and provider architecture. Unknown, conflicting, expired policy or unsupported device → unavailable; no sample capture/comparison. Do not infer age/location from voice. |
| Reviewed disclosure | UX-07 shows purpose, exact recipients/devices/agents, sample and template storage/processing locations and deletion/inactivity terms; no unresolved variables. Separate unchecked explicit statement and approved signed-release execution if required. **Enroll my voice / Use person selection** have equal accessibility. |
| Consent commit | Permission/release durably stored before sample capture; pending/offline/error stays off. OS mic permission is independent and follows intent. |
| Bounded recording | Named verified person/scope, visible recording timer and **Cancel recording**. No past calls, third-party uploads, automatic continuous sample or mixed-speaker enrollment. Only approved bounded capture policy applies; no invented sample-length requirement. |
| Processing / cancellation / mixed/failed sample | Clearly labelled progress. Cancel stops local capture and sends suppression/deletion request; sample purge remains pending until acknowledged. Failure never saves a usable template; show retry only when eligible and person selection always. |
| Ready / test | Show device/scope and **Test recognition / Turn off**. User-initiated test can say matched/unknown within permitted scope; unknown never discloses candidate names. Matching is a speaker-label aid, not private-data authentication. No numeric score presented as identity proof. |
| Shared account or replay/spoof/unknown speaker | Generic **Verify person**; no guessed name or memory preview. Keep Work/Personal unchanged. Reverify approved factor and appropriate private output channel. |
| Turn off | One-step stop → authoritative withdrawal and template/enrollment purge workflow; UX-08 pending/acknowledged variants reflect actual state. History and durable memories are separate. Device logout clears/revokes according to the approved device contract. |
| New participant / speakerphone / unknown audience | Pause affected capture and restricted output, cancel unsent buffers, rebuild under current permissions. Text/no-private-memory alternative remains possible where policy permits. Do not promise complete physical-bystander detection. |

No enrollment usability or recognition accuracy claim exists in this design. VOX-002/038/039/040/041/042 and qualified privacy/provider/device review must resolve the release conditions.

## 8. Six deterministic synthetic walkthroughs

Run these first as spec walkthroughs, then as automated/emulated journeys against an exact implemented candidate. Use only synthetic fixtures: persons `p-sara`, `p-ali`, `p-reza`, newcomer `p-nima`; accounts `acct-sara`, `acct-shared`; spaces `work-hoor`, `personal-sara`; agent `aria`; group `vox-project`. All timestamps, receipts and provider/system states are fixture facts, not real grants. Repeat each in EN and FA; use keyboard and a screen-reader review for the indicated checkpoints. Contract acceptance belongs to independent QA/privacy, not the UX author.

| Script | Fixed setup and actions | Expected visible and policy outcome |
|---|---|---|
| SYN-01 · decline all optional use | Fresh adult Sara, authorized core policy/notice fixture, all purposes NOT_ASKED. Choose FA, open first-use, read detail, declare adult/Continue; submit an ordinary text request. Open privacy, then switch EN. Repeat with failed optional grant receipt. | Core text available without optional grant; no analytics SDK/event export, extraction, personalization, notifications or biometric processing. All switches Off in both languages, adult record distinct from consent. Failed grant stays Off, inline retry. First-use h1/focus and equal refusal controls reachable; no repeated solicitation on reopen. |
| SYN-02 · exact set and stale group | Sara verified in Work; private source `m1` “Launch is Friday.” Group version g1 Sara/Ali/Reza. Share m1 to Selected people Sara+Ali, agent Aria; inspect complete preview and submit. Separately prepare group share at g1, inject g2 with Nima before submit. | Selected set remains Sara+Ali independent of group change; Reza/Nima get no m1. Group submit rejects stale version, announces audience changed, displays new roster and no automatic history grant; no content delivered before renewed action. Cancel saves no share. Repeat unknown membership → submit disabled. No directory leak through error. |
| SYN-03 · shared account and space | acct-shared has no current verified person; a stale Sara memory/caption exists in client fixture. Open memories, claim “I am Reza,” attempt switch without approved verification, cancel, then complete legitimate verification as Sara and select Personal. Inject space-switch failure once. | Unknown state conceals stale content and gives no guessed-name hint or private retrieval. Claim/voice does not verify. Success scopes Sara to authorized space; no Work private text/history/preferences move to Personal. Failure leaves old authoritative space labelled and restricted work stopped. Back/focus never exposes the old person's page. |
| SYN-04 · explicit preference over hypothesis | Sara in Work has allowed personalization, suggested “long replies,” explicit preference “brief replies.” Request detailed answer for this turn; inspect Why this, correct explicit preference, inject one save failure, retry; turn learning off; separately reset inferred preferences. | Current request wins for this turn; explicit saved preference otherwise wins over hypothesis. Safe evidence/scope shown. Failed correction preserves editable draft and old authoritative version; receipt updates version. Off stops inference/use without deleting history. Reset has its own selected categories/status. Undo is a fresh version, not a rollback of consent or deletion. |
| SYN-05 · withdrawal and deletion truth | Automatic memory granted; derivative and queued notification tied to m1. Go offline, turn off; reconnect, receive authoritative withdrawal. Request deletion, then fixture steps suppression → online purge → provider pending → PARTIAL_FAILURE → backup expiry pending → completed with minimal restricted consent evidence. | Offline copy says this device stopped/pending sync, never global completion. After receipt, dependent jobs/delivery denied. Selected history remains separate. Every purge state/exception rendered accurately; no “for good/all copies” before acknowledgments. Retry keeps same request; no content restored from backup. Final evidence retention is explained and cannot drive the feature. |
| SYN-06 · reminder, generic preview and voice refusal | All optional purposes Off; request one reminder at 09:00 Europe/Tallinn with approved channel fixture. Deny OS permission, select Inbox explicitly; proactive stays Off. Open suggestion terms without grant, return; then revoke source before queued delivery. Voice eligibility fixture blocked; later eligible mock fixture with release denial/cancelled recording. | No OS prompt before channel intent. Generic transport text contains no task/name/space. No marketing/proactive enrollment or silent channel fallback. Deep link after revoke displays unavailable without detail. Blocked voice does no comparison/capture; denial preserves equivalent text/person selection; cancellation records pending sample deletion rather than fake completion. Capture/permission/receipt focus and RTL remain usable. |

Each implementation run records candidate/diff identity, fixture/policy version, locale/viewport, exact command/script, observed outcome and pass/fail/unavailable per assertion. Screenshots alone cannot prove a server gate, purge, provider delivery or biometric denial. A synthetic design walkthrough does not replace research with consenting real participants; VOX-003 verification remains open until the lead accepts the intended synthetic review and applicable later evaluation.

## 9. Acceptance and review handoff

| Task | Design acceptance criteria covered here | Next owner / evidence still required |
|---|---|---|
| VOX-003 | One first-use disclosure, optional off/equal refusal, bilingual keyboard/SR states, privacy purpose scopes/receipts, history separation, truthful withdrawal/purge/rights recovery. | Product/privacy review of this exact draft; native-language review; VOX-011/012/014/056 implementation and independent synthetic/browser acceptance. No legal or user-study signoff claimed. |
| VOX-004 | Work/Personal/person/audience visible, verified switch, private/group/fixed set and exact sentence preview, history/member-change policy, explicit vs inferred preference/correction/reset/Undo, guest/unknown context. | Architect final context/capability/snapshot contracts and deterministic enforcement; privacy review of authority; frontend implementation, then QA unauthorized-fact pairs and changed-audience races. |
| VOX-005 | Reminder/proactive/category separation, channel/OS intent, generic payload/inbox, quiet/cap/snooze/why/cancel states; biometric gated enrollment/test/refusal/deletion and manual alternative. | Design-only dependency on VOX-002 provider/jurisdiction/legal facts; privacy/voice review; future VOX-032/035 and VOX-038–042 implementation/qualification. Marketing remains disabled. |

**Specific contract decisions for the lead/architect:** a server-verifiable person-switch factor and safe shared-account discovery; context snapshot fields/expiry; per-record capability and fixed-roster group history representation; source/projection correction authority; atomic receipt plus cross-device invalidation semantics; category-specific retention/backup/provider status; guest rights verification/support contact; reminder quiet-hour policy and product approval of the proposed cap. Until these resolve, UI uses truthful pending/unavailable states rather than choosing permission on its own.

**Checks performed for this artifact:** read-only inspection of the mapped Studio components/client/types/auth/service and supplied requirements; six synthetic scripts specified, not executed as application journeys. No runtime file, backlog or other document is owned by this design task. CI, browser/accessibility audit, provider, physical-device, legal approval and deployment evidence: **UNAVAILABLE** at this design stage.
