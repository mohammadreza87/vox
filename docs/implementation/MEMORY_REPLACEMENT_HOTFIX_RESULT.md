# Atomic memory correction hotfix

Base: `92f7bd6`, branch `codex/vox-live-access`. This is local source and synthetic evidence; no provider calls, deployment or live-data repair occurred.

A correction previously inserted its new active row, awaited current access, and separately retired its predecessor. Revocation or a failed second write could leave both rows active. A regression reproduced this exact path before the fix.

`MemoryStore.add` and `addIfEpoch` now interpret `supersedes` as one atomic correction. They validate a still-active predecessor in the same persona and with the same source owner, check revision/epoch and source tombstones, insert the replacement, retire the predecessor, invalidate its old share version, and advance the safety revision once. In-memory mutation has no awaited boundary; file stores use their existing reload/lock/atomic-save operation; Firestore performs all reads before a single transaction's writes. A rejected correction inserts nothing. The gateway uses that commit directly and updates its own revision snapshot, without a second predecessor write or deletion-based rollback. Its current-access checks still suppress later offers and work.

Evidence: the exact revoke-after-insert regression initially produced both active rows. The focused final selection passed **156 tests across 6 files**, including 10 correction regressions and the existing gateway, Studio service and live-authority paths. Tests cover revocation after commit, invalidation immediately before commit, competing corrections, stale guards, deleted/foreign predecessors, epoch-guarded corrections, old share offers, file restart visibility and conservative deletion of the supersession chain. Full `npx tsc --noEmit --pretty false`, scoped ESLint and `git diff --check` passed. Independent acceptance of the patch belongs to the lead/reviewer.

Existing stored partial corrections are not automatically rewritten. Firestore evidence uses the transactional synthetic adapter, not a live emulator or production database. This change preserves the existing source-lineage deletion behavior; deleting the new row as rollback would also delete its predecessor and is deliberately avoided.

## خلاصهٔ فارسی

پیش از اصلاح، ثبت حافظهٔ جایگزین و کنارگذاشتن نسخهٔ قبلی دو عملیات جدا بود؛ لغو دسترسی میان آن‌ها می‌توانست هر دو نسخه را فعال نگه دارد. اکنون ثبت جایگزین، غیرفعال‌کردن نسخهٔ قبلی، تغییر نسخهٔ اشتراک و افزایش بازبینی ایمنی در یک عملیات اتمی انجام می‌شود. نسخهٔ قبلی باید همچنان فعال و متعلق به همان عامل و صاحب منبع باشد؛ بازبینی منقضی، منبع حذف‌شده یا مالک متفاوت هیچ رکورد تازه‌ای ثبت نمی‌کند. بررسی دسترسی جاری همچنان کار بعدی و پیام اشتراک را متوقف می‌کند.

مجموعهٔ مرتبط ۱۵۶ آزمایش در شش فایل را گذراند؛ بررسی نوع، بررسی سبک کد و بررسی فاصله‌های تغییر نیز موفق بود. پذیرش مستقل اصلاح با بازبین است. این شواهد مربوط به منبع و آزمایش مصنوعی است؛ درخواست واقعی ارائه‌دهنده، انتشار یا اصلاح دادهٔ زنده انجام نشده است. رکوردهای ناقص قدیمی خودکار تغییر نمی‌کنند. حذف رکورد تازه برای بازگردانی استفاده نمی‌شود، چون قاعدهٔ حذف زنجیره می‌تواند نسخهٔ قبلی را نیز پاک کند.

Independent lead review passed **97 tests across five files**, full TypeScript and diff checks on the frozen patch. This includes the actual revoke-after-commit path, adapter transaction behavior, history privacy and live authority. The author suite passed 156 tests across six files. CI and deployment remain separate gates.

بازبینی مستقل راهبر نیز ۹۷ آزمایش در پنج فایل و بررسی TypeScript را گذراند؛ نتیجهٔ CI و انتشار جداگانه ثبت می‌شود.
