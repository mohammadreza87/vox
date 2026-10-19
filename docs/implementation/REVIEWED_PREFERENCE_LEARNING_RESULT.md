# Reviewed preference learning (VOX-027)

Scope: `codex/vox-reviewed-preference-learning`, based on `796073f07c60d93ee52eaa5344628478ec7ada4f`. Separate from the current release. No provider/account configuration, real conversations, push or deployment changed.

## Behavior and authority

Experience offers a separate, versioned EN/FA learning presentation and deliberate opt-in, off by default. Canonical `optional.personalization`, a current confirmed account, exact agent/Work-Personal grant and approved capability remain mandatory. Analytics permission is never read to authorize learning. Intents bind the person, interactive confirmation, canonical permission epoch/revision, agent grant and committed Studio authority; at most24h and no longer than any applicable deadline. Ordinary explicit preferences work independently when learning is unavailable.

Only successful authenticated final current text or the final tap-to-talk transcript can enqueue learning. Images, history, analytics and tentative/live speech never supply evidence. Missing legacy final correlation skips learning. The current message is sent only to the configured OpenAI Decisions transport, with no retry; this slice claims no live model accuracy or provider retention qualification. Vox stores no raw learning text/audio. Durable evidence is a keyed, domain-separated opaque source identity, never an unkeyed digest of the message.

Candidates contain one permitted enum (reply length/language/format), a coded uncertain reason and at most16 opaque evidence IDs. They remain review-only, expire within24h and the current authority deadlines, and cannot establish identity, consent or access. Use atomically consumes the source and calls the ordinary explicit CAS writer, producing the same genuine absence/reset-preserving ten-minute Undo. Dismiss, reset, explicit save, Undo and intent replacement suppress registered sources. A pending reset→Undo cannot recreate a suggestion. Explicit choices/resets prevent proposing that key; current instructions retain precedence in the existing resolver.

Preparation and final learning share the same real logical turn's cumulative max2 Decisions reservations. Turning preparation off/on retains its turn and budget. The final server HMAC seal is one-shot: duplicate or changed-content final IDs cannot gain another learning attempt or interfere with the authorized core reply. Tap-to-talk uses its existing server turn ID, without requiring analytics correlation.

The process owner admits at most16 jobs overall and one per account/space, exact agent bound inside, with a500ms total cancellation deadline and no durable retries. Enqueue adds no awaited provider/write work to reply delivery. Normal HTTP completion preserves its job; a true request abort, surface departure, scope/authority change or shutdown aborts it and releases its owned text reference. Underlying abort-ignoring promises stay tracked until settlement and occupy capacity; bounded close reports remaining work rather than claiming settlement. JavaScript strings/third-party copies are not claimed to be securely erased.

Actual configured SDK fetch runs a request-local synchronous committed-authority fence after SDK preparation, immediately before transport. Candidate rename and final public projection use current validated Studio state, then fresh canonical state/time. FILE write guards run after temporary-file fsync and immediately before synchronous rename. Unsupported backend/unguarded transport stays unavailable. This supports the existing single-process file topology; it is not a distributed transaction or a guarantee against arbitrary external processes changing separate files between reads.

Studio member/agent `learningAuthorityRevision` is server-owned, safe monotonic and incremented in the same transaction as role/access/visibility/block/unblock/fire changes. Legacy absence means0; malformed/overflow fails closed. Its fingerprint is stored with presentations/intents/candidates. Restoring old access cannot revive them. Provider/view/write suppression starts at committed authority change; stale records are removed on the next canonical read or lifecycle maintenance, retaining source tombstones. No synchronous cross-account physical purge is claimed.

## Qualification

Author qualification: **422 tests passed across30 files**, TypeScript passed, scoped ESLint had no errors (one existing ConversationPanel cleanup-ref warning), and `git diff --check` passed. The unchanged39-file baseline is commit `65ceb075aa92c9c61917ee6264e7da569a172f15`. Its independent review found a same-scope replacement-load mutation lock issue: a parent revision or expiry refresh could enable controls while an old command token still blocked clicks. Follow-up `154e762` aborts/releases that old token before the replacement load; late old completion/finally cannot release a newer command. Both deterministic revision/expiry regressions and the connected EN/FA journeys pass (**15 tests/3files**), with TypeScript, focused lint and diff checks passing. Independent acceptance remains pending for the follow-up manifest. Tests include real file storage, signed synthetic HTTP, EN/FA connected React→typed client→real handlers→file→synthetic external provider→Use→ordinary Undo; API responses are not mocked in these journeys. Actual installed OpenAI SDK async-preparation tests prove zero configured fetch after revocation/abort/deadline and independent concurrent request contexts. Task cap/shutdown, shared budgets, final clock/fsync fences, revocation/restore ABA, lifecycle/export and exact historical rollback are covered. No compiled browser/server, production provider, device, paid call, CI or deployment proof is claimed here.

## Retention, rights and rollback

Lifecycle read/maintenance/export removes expired or invalid intent/candidates; selected-space export contains permitted enum/coded evidence metadata. Suppression and final-source tombstones expire after24h, never restore a permission, and retain no text. Historical whole-store restores remain an external operation gate.

Before downgrading to `796073f`, stop producers and all request workers, then inspect a scoped dry run:

```sh
node --import tsx src/lib/adaptive/personalization/learning/rollback.ts --directory /absolute/private/adaptive-directory --account-id telegram-account:123
```

Apply requires the same explicit scope plus `--apply --producers-stopped --expected-content-sha256 <dry-run digest>`. Locked account CAS rejects drift. It removes only optional `experience.preferenceLearning` and finalFingerprint/learningEvidenceId/learningReservation per-turn additions. It preserves attempt counts, cancellation/supersession tombstones, current explicit choices/Undo, canonical rights and deletion records. Exact historical strict Experience schema rejects the armed document and accepts the cleaned document. Its four-source import graph is pinned with SHA-256 provenance in `learning/compatibility/base796073f`; each fixture was byte-verified once against local796073f. Tests load those fixtures directly and need no Git history, network or deep CI checkout. Disabled view/cancel adds no optional learning or seal keys and needs no cleanup. Preserve Studio monotonic authority revisions; old Studio readers tolerate these fields. Strip learning before an old server can make changes without incrementing those revisions; re-upgrade always requires fresh intent. This tool has not been run against production data.

## فارسی

یادگیری ترجیح، انتخاب جداگانه و نسخه‌دار و پیش‌فرض خاموش است. اجازهٔ فعلی شخصی‌سازی، تأیید حساب و مجوز همین عامل در فضای کاری یا شخصی لازم می‌ماند؛ رضایت آمار استفاده مجوز یادگیری نیست. فقط پیام نهایی فعلی یا متن نهایی گفتار دکمه‌ای، پس از پاسخ موفق، برای پیشنهاد طول، زبان یا قالب پاسخ به OpenAI فرستاده می‌شود. تاریخچه، تصویر و گفتار ناتمام منبع یادگیری نیستند. وکس متن یا صدای خام را برای این یادگیری ذخیره نمی‌کند. کیفیت مدل یا نگهداری داده نزد ارائه‌دهنده با آزمون مصنوعی اثبات نشده است.

۴۲۲ آزمون در ۳۰ فایل و بررسی TypeScript موفق شدند؛ بررسی مستقل نسخهٔ منجمد هنوز لازم است.

پیشنهاد تا بررسی و انتخاب «استفاده» اعمال نمی‌شود و حداکثر۲۴ساعت و تا پایان مجوز یا تأیید حساب معتبر است. استفاده، ذخیرهٔ صریح با تطبیق نسخه و واگرد واقعی می‌سازد. کنارگذاشتن، بازنشانی و تغییر صریح، شواهد قدیمی را سرکوب می‌کنند؛ واگرد رضایت، مجوز یا پیشنهاد قبلی را زنده نمی‌کند. آماده‌سازی و یادگیری روی همان نوبت واقعی در مجموع حداکثر دو فراخوانی دارند. کارهای پس‌زمینه محدود، دارای مالک و قابل لغو هستند و منتظر ماندن برای مدل را به مسیر پاسخ اضافه نمی‌کنند.

بازگرداندن دسترسی یا رفع مسدودی، پیشنهاد و انتخاب یادگیری قدیمی را معتبر نمی‌کند؛ شمارهٔ یکنواخت اختیار در همان ثبت استودیو تغییر می‌کند. سرکوب از ثبت تغییر آغاز می‌شود و پاک‌سازی فیزیکی رکورد در خواندن بعدی یا نگهداری دوره‌ای انجام می‌شود. آزمون متصل فارسی و انگلیسی از مسیرهای واقعی HTTP و فایل، با ارائه‌دهندهٔ خارجی مصنوعی استفاده می‌کند. مرورگر کامپایل‌شده، دستگاه و انتشار تولیدی آزمایش نشده‌اند. ابزار بازگشت فقط فرادادهٔ تازهٔ یادگیری را با توقف تولیدکننده و تطبیق نسخه حذف می‌کند؛ انتخاب، واگرد و مجوز فعلی را نگه می‌دارد. اجرای تولیدی آن در این مرحله انجام نشده است.

اصلاح پس از بررسی مستقل: اگر نسخهٔ والد یا پایان مهلت، خواندن تازه‌ای در همان فضا آغاز کند، فرمان قبلی لغو و قفل آن آزاد می‌شود. پاسخ دیررس قبلی نمی‌تواند فرمان جدید را آزاد کند یا وضعیت را عوض کند. هر دو بازتولید و مسیر متصل فارسی و انگلیسی در ۱۵ آزمون از ۳ فایل موفق شدند؛ پذیرش مستقل اصلاح هنوز لازم است.

آزمون بازگشت از چهار فایل منبع تاریخی با هش ثبت‌شده استفاده می‌کند که یک‌بار با نسخهٔ دقیق مبنا تطبیق داده شدند؛ اجرای آزمون به تاریخچهٔ Git، شبکه یا دریافت عمیق در CI وابسته نیست.
