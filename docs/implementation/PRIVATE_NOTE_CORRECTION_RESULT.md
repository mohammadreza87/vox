# Private saved note correction — VOX-056 / VOX-013

Base: `943e4e6f5b20eaf6386c5d8d8ca7fd4f07185989`. Local implementation and focused qualification complete; independent review pending. No provider requests, real data, build, deployment, or external configuration changes.

## English

Privacy keeps its existing explicit Create form. Ordinary private notes and accepted **user-reviewed, unverified claims** gain Edit → Review correction → Save correction / Cancel. Review shows exact before/after text and the current Work or Personal destination. Origin caveats remain visible after editing. Derived summaries are excluded. Failed or stale saves ask for refresh; the client never retries a mutation or claims that cancellation undoes a committed save.

Authenticated same-origin `PUT /api/studio/adaptive/memories/:id?locale=en|fa` accepts only `{space,text,expectedRevision,eventId}`. CAS uses the selected note revision. The same row retains account/person/container scope, space, origin, creation timestamp, expiry, and existing agent grants; only text, row revision, revocation epoch, and update time change. No consent is created or revived, no source text history is retained, and correction never extends retention or reclassifies a claim.

Current confirmed identity, core capability policy, own edit authorization, current Studio membership and exact authority revision are checked. Supported FILE storage rechecks Studio first, then fresh canonical deadlines after temporary-file fsync immediately before rename. A final synchronous Studio/canonical projection fence suppresses stale HTTP output. Independent stores do not offer a single atomic cross-store transaction; a change after the final checked boundary is outside that guarantee. Unsupported storage exposes editing unavailable while ordinary Create/Delete remain.

Within the correction transaction, every derived descendant with an invalid source revision loses its text and receives an incremented deletion tombstone plus an existing `memory_deleted` outbox entry before commit. Existing relationship invalidation also reacts to source correction. Old summary receipts cannot recreate those rows. Accepted claim replay requires the original row revision and exact accepted text, so changing a claim and later restoring its old text cannot make an old acceptance appear successful. Matching correction event replay returns current state after later correction/deletion; it never reapplies historical content. Conflicting reuse of an event ID is rejected.

Rollback requires no data stripping or new document schema version: the memory schema is unchanged, `event.kind` was already a bounded string, and descendants use an existing outbox enum. A pinned exact baseline repository fixture qualifies the resulting corrected rows, events, epochs and tombstones without relying on Git history in CI. Never restore an old account backup over current rights or corrections. Schema compatibility alone does not qualify application rollback. The rollback artifact must retain the strengthened accepted-claim revision/exact-text guard. Alternatively, disable both claim preview and acceptance, stop their producers, and drain every outstanding receipt for its maximum 120-second lifetime before permitting older acceptance code. Keep those routes unavailable during the drain and verify the condition; acknowledging weaker replay protection is not an override.

UI clears draft/review and aborts its owned Save on scope, binding, language, row revision, capability, expiry, or unmount. An abort-ignoring late response cannot replace a newer snapshot. Final server checks remain authoritative even when browser time differs.

## فارسی

فرم فعلی ساخت یادداشت خصوصی حفظ شده است. برای یادداشت‌های عادی و **ادعاهای بررسی‌شدهٔ کاربر که مستقلاً تأیید نشده‌اند**، مسیر ویرایش ← بررسی اصلاح ← ذخیرهٔ اصلاح یا انصراف افزوده می‌شود. متن دقیق پیش و پس از اصلاح و فضای کاری یا شخصی نمایش داده می‌شود. برچسب منشأ ادعا پس از ویرایش باقی می‌ماند؛ خلاصه‌های مشتق‌شده فعلاً قابل ویرایش نیستند. خطا یا تداخل نیازمند تازه‌سازی است؛ ذخیره خودکار تکرار نمی‌شود و انصراف، تضمین بازگرداندن تغییری که قبلاً ثبت شده نیست.

اصلاح، همان ردیف را با کنترل نسخه تغییر می‌دهد. مالک، شخص، ظرف خصوصی، فضا، منشأ، زمان ایجاد، مهلت حذف و دسترسی عامل‌ها حفظ می‌شوند. فقط متن، نسخه، دورهٔ ابطال و زمان به‌روزرسانی تغییر می‌کنند. رضایت تازه‌ای ساخته یا احیا نمی‌شود؛ تاریخچهٔ متن قبلی ذخیره نمی‌شود و مهلت نگهداری تمدید نمی‌گردد.

هویت تأییدشده، سیاست قابلیت اصلی، مجوز ویرایش و عضویت فعلی بررسی می‌شوند. در ذخیره‌سازی FILE، پس از نوشتن فایل موقت و درست پیش از ثبت نهایی، عضویت و سپس زمان و مجوزهای فعلی دوباره بررسی می‌شوند؛ پاسخ نیز بررسی نهایی دارد. این دو مخزن، تراکنش اتمی مشترک ندارند. در مخزن پشتیبانی‌نشده، ویرایش در دسترس نیست ولی ساخت و حذف معمول حفظ می‌شوند.

همهٔ خلاصه‌های وابسته به نسخهٔ قبلی در همان تراکنش، بدون متن و با نشان حذف و رویداد پاک‌سازی ثبت می‌شوند. رسید قدیمی خلاصه یا پذیرش ادعا نمی‌تواند متن قبلی را برگرداند یا یادداشت حذف‌شده را احیا کند. تکرار شناسهٔ همان اصلاح فقط وضعیت فعلی را برمی‌گرداند؛ استفادهٔ متناقض از شناسه رد می‌شود. بازگشت نسخهٔ برنامه نیازمند حذف داده نیست و نباید با بازیابی نسخهٔ پشتیبان قدیمی، حقوق یا اصلاحات جدید را از بین برد. سازگاری ساختار داده به‌تنهایی کافی نیست: نسخهٔ بازگشت باید محافظ تطبیق نسخه و متن دقیق ادعای پذیرفته‌شده را حفظ کند. راه جایگزین، غیرفعال‌کردن پیش‌نمایش و پذیرش ادعا، توقف تولید رسید و انتظار تا پایان حداکثر عمر ۱۲۰ثانیه‌ای همهٔ رسیدهای جاری است؛ این مسیرها در تمام زمان انتظار بسته می‌مانند و پایان آن باید بررسی شود. پذیرفتن صرفِ محدودیت، مجوز استفاده از محافظ ضعیف‌تر نیست.

پیش‌نویس و بررسی با تغییر فضا، هویت، زبان، نسخه، انقضا یا خروج پاک می‌شوند. درخواست لغو می‌شود و پاسخ دیرهنگام نمی‌تواند وضعیت تازه را جایگزین کند. آزمون‌های محلی و بررسی نوع و قواعد کد موفق بوده‌اند؛ بررسی مستقل، ساخت و استقرار هنوز تأیید نشده‌اند.

## Qualification

- PASS: 168 tests / 14 files, `vitest --maxWorkers=2`: correction service/HTTP/compatibility, message-memory, reviewed-memory/provenance, persistence service/HTTP/storage, relationship service, lifecycle, editor unit/integration, and Privacy tests.
- PASS: 17 correction service tests rerun after strengthening the preservation test with a real existing nonempty agent grant.
- PASS: `npx tsc --noEmit --incremental false`, scoped ESLint with zero warnings/errors, and `git diff --check`.
- Connected EN/FA tests use the actual typed client, signed Telegram request, authenticated HTTP handler, and isolated FILE storage. The unrelated unavailable voice panel is isolated; only the external draft providers in existing claim/summary suites are synthetic. No live-provider, compiled-browser or deployed-runtime claim.
- Exact baseline repository fixture SHA256: `27376116c41abdceaf7f2d07deaa3e54d4ce7e957f5242c0ce370e62a34905dc`, independently compared locally to `943e4e6:src/lib/adaptive/persistence/repository.ts`. Test execution needs no Git object/history or network.
- `PUT` is exported by the existing authenticated adaptive catch-all route; the new correction endpoint is dispatched inside its handler. No public route/auth bypass is introduced.
- Independent review, full composed CI/build, and compiled browser/runtime qualification remain pending.
