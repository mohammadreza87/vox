# Explicit personalization controls

Release integration follow-up: a stalled Work save could leave newly loaded Personal controls appearing enabled while ignoring clicks. `e77f1b7` ties the command lock to its request generation. Loading or changing scope releases the obsolete lock; a late old completion cannot unlock or update a newer command. The regression reproduced the failure before the fix. The combined follow-up suite passed 144 tests across five files, plus TypeScript and focused lint; compiled validation remains separate.

اصلاح اتصال انتشار: ذخیرهٔ معلق در فضای کاری می‌توانست کنترل‌های فضای شخصی را ظاهراً فعال نگه دارد، اما کلیک را نادیده بگیرد. در نسخهٔ `e77f1b7`، قفل فرمان به نسل همان درخواست تعلق دارد؛ تغییر یا تازه‌سازی دامنه قفل قدیمی را آزاد می‌کند و پاسخ دیرهنگام نمی‌تواند فرمان جدید را آزاد یا نمای آن را تغییر دهد. آزمون ابتدا خطا را بازتولید کرد. مجموعهٔ ترکیبی ۱۴۴ آزمون در پنج فایل، TypeScript و بررسی متمرکز کد را گذراند؛ تأیید مرورگر کامپایل‌شده جدا ثبت می‌شود.

Candidate: `codex/vox-personalization-controls`, based on `50706f367ff88ef7e00ae00d904e8ddf1ab3a8ba`. This bounded slice is separate from PR55. No provider configuration, consent purpose, inference producer, deployment or live user data changed. Independent review and qualification against the lead's later integrated runtime are pending.

## Behavior

Studio Experience now offers reply length, language and formatting choices for the selected agent and Work/Personal space. The existing pure resolver receives only canonical explicit records in this slice. Runtime context exports active explicit choices only when current personalization permission, release policy, account confirmation and the exact agent/space grant permit it. Current user instructions retain priority. Reset uses the existing default style without storing a default as a new explicit choice.

The authenticated detailed view supplies coded explanations for an explicit choice, explicit reset, absence/default, personalization off/expired, unavailable capability and missing agent grant. Saving an explicit directive remains possible while personalization is off; the UI distinguishes a saved choice from an applied choice. No analytics consent is requested or reused to produce a preference.

Undo is one step per preference key, for at most ten minutes and no longer than the originating account confirmation. Server storage retains only the previous explicit enum row or its true absence, exact scope, originating binding ID, deadline and the digest of the resulting row. The client submits a change ID, event ID and current aggregate revision; it cannot supply restoration content. A same-key change replaces the previous undo. CAS rejects stale writers; repeated matching commands are idempotent and conflicting event reuse rejects. Restoring a prior row gives it a fresh revision. Restoring absence removes the row. A previous reset stays a reset. Undo never creates another undo, restores permission/grants, imports an account export or revives deleted memory. Clearing, replacing or expiring confirmation invalidates outstanding tokens; same-person reconfirmation does not revive them.

The final detailed projection uses validated committed canonical and Studio file snapshots synchronously after all awaited content loading. A busy canonical writer, wrong partition, malformed authority, changed binding/permission or Studio block prevents the view. This closes the tested same-process await races in the supported file topology; it is not a distributed transaction or protection against arbitrary separate-process writes between two file reads. Unsupported synchronous projection returns `503 preference_projection_unavailable`. EN/FA UI then preserves the existing ordinary save/reset controls through the existing authenticated snapshot endpoint and clearly marks detailed explanations and undo unavailable. It fabricates neither a detailed reason nor an undo token. Existing runtime preference application keeps its existing authorization boundary.

Expired prior-choice payloads are suppressed immediately by deadline checks and removed on Experience reads or lifecycle maintenance/export. Account export includes current, unexpired undo history for its selected space. Physical purge from historical backups is outside this slice.

## Evidence

Author qualification: **124 tests passed across 14 files**. The selected run includes resolver, controls, HTTP, rollback, existing Experience service/HTTP, lifecycle, conversation/voice boundaries, typed client and Studio UI. Two connected EN/FA journeys use the actual client, signed synthetic Telegram authentication, actual HTTP handler and real file storage. Two more use unsupported synchronous storage to prove ordinary controls remain usable. Only the transport to the in-process handler is substituted; API responses are not mocked in these journeys. The separate conversation test verifies the actual provider handoff gains/loses the explicit preference across undo, without exporting undo metadata.

Covered failures include same-key concurrent file writers, concurrent duplicate undo, conflicting event reuse, stale/superseded tokens, exact agent/space separation, canonical withdrawal during loading, Studio blocking, identity clearing/expiry/reconfirmation, stale-tab post-expiry HTTP attempts, writer lock, forged canonical partition and malformed Studio authority. Separate final-boundary tests advance the clock through binding, permission, approval and undo expiry during synchronous reads, including a reason change while no agent grant exists. UI tests cover EN/FA, RTL, scope changes with equal revisions, late responses, unmount, loading/error refresh and server-confirmed completion. A deterministic regression covers a parent revision catching up while the next command is pending: only scope/confirmation changes or unmount invalidate that command; a matching revision refresh cannot leave controls stuck busy.

```sh
npx vitest run src/lib/adaptive/personalization src/lib/adaptive/runtime/experience-service.test.ts src/lib/adaptive/runtime/experience-http.test.ts src/lib/adaptive/lifecycle src/lib/studio/__tests__/conversation.test.ts src/lib/studio/__tests__/voice-call.test.ts src/app/studio/_components/PreferencePanel.test.tsx src/app/studio/_components/PreferencePanel.integration.test.tsx src/app/studio/_components/screens/Experience.test.tsx src/app/studio/_lib/client.test.ts --maxWorkers=4 --reporter=dot
npx tsc --noEmit --pretty false
```

Scoped ESLint and `git diff --check` also passed. No production build, browser/device session, CI, merge or deployment is claimed. The connected journeys use React/jsdom with in-process HTTP, not a compiled browser/server.

## Compatibility and rollback

The new `experience.preferenceUndo` field is optional; reads of an old account do not allocate it. An explicit preference operation can add it, so the older strict Experience schema cannot read that account until it is removed. `src/lib/adaptive/personalization/rollback.ts` provides a pure projection plus a runnable file-store helper:

```sh
npx tsx src/lib/adaptive/personalization/rollback.ts --directory /ABSOLUTE/ISOLATED/ACCOUNT-STORE --account-id telegram-account:123
# After stopping all writers/producers and preserving protected evidence:
npx tsx src/lib/adaptive/personalization/rollback.ts --directory /ABSOLUTE/ISOLATED/ACCOUNT-STORE --account-id telegram-account:123 --apply --producers-stopped --expected-content-sha256 DIGEST_FROM_DRY_RUN
```

Dry run writes nothing and prints only a digest/change indicator. An isolated synthetic CLI dry run and apply also passed, preserving every other field. Apply verifies the selected account and content digest under its storage lock and removes only undo metadata. It preserves current choices, settings, permissions, grants, deletion records and all unrelated metadata. Tests check equality of every preserved field and parsing under the prior Experience schema. Other storage backends must apply the pure projection through their own stopped-writer transaction/CAS. This does not authorize a production migration or restore an old backup.

## خلاصهٔ فارسی

در بخش تجربه، اندازه، زبان و قالب پاسخ برای همان عامل و فضای کاری یا شخصی قابل ذخیره و بازنشانی است. دلیل استفاده یا عدم استفاده از انتخاب ذخیره‌شده نمایش داده می‌شود. ذخیرهٔ انتخاب صریح با اجازهٔ استفاده از آن جداست؛ خاموش‌بودن شخصی‌سازی مانع استفادهٔ زمان اجرا می‌شود. این مرحله هیچ تولیدکنندهٔ استنباط، هدف رضایت جدید یا استفادهٔ تازه از رضایت تحلیل رفتار اضافه نمی‌کند.

واگرد، فقط آخرین تغییر همان ترجیح را تا ده دقیقه و حداکثر تا پایان تأیید حساب برمی‌گرداند. نبود انتخاب قبلی با بازنشانی قبلی متفاوت می‌ماند. تغییر جدید، پایان مهلت، پاک‌شدن یا تعویض تأیید حساب، واگرد قدیمی را نامعتبر می‌کند؛ تأیید دوبارهٔ همان فرد آن را زنده نمی‌کند. درخواست تکراری همان رویداد دوباره اجرا نمی‌شود و بازاستفادهٔ متناقض رد می‌شود. واگرد هیچ رضایت، مجوز عامل، حافظهٔ حذف‌شده یا نسخهٔ قدیمی حساب را بازنمی‌گرداند.

در ذخیره‌سازی فایل پشتیبانی‌شده، بررسی نهایی وضعیت ثبت‌شدهٔ هر دو منبع هم‌زمان با تصویرسازی پاسخ و بدون انتظار ناهمگام انجام می‌شود؛ این تضمین تراکنش توزیع‌شده نیست. اگر این بررسی پشتیبانی نشود، ذخیره و بازنشانی معمولی همچنان ممکن است، اما دلیل دقیق و واگرد به‌روشنی در دسترس نیستند. سابقهٔ کوتاه واگرد هنگام خواندن یا نگهداری دوره‌ای پاک می‌شود؛ حذف نسخه‌های پشتیبان تاریخی در این مرحله پوشش داده نشده است.

۱۲۴ آزمون در ۱۴ فایل موفق شد؛ مسیرهای متصل فارسی و انگلیسی از کارخواه واقعی، احراز هویت مصنوعی امضاشده و مسیر HTTP واقعی استفاده کردند و در حالت پشتیبانی‌شده، ذخیره‌سازی فایل واقعی داشتند. ساخت تولیدی، مرورگر کامپایل‌شده، دستگاه واقعی و انتشار انجام نشده است. بررسی مستقل و آزمایش نسخهٔ ترکیبی بعدی هنوز لازم است. ابزار بازگشت فقط فرادادهٔ واگرد را با قفل و تطبیق نسخه پاک می‌کند و داده و مجوز فعلی را نگه می‌دارد؛ اجرای آن روی دادهٔ تولیدی مجاز نشده است.
