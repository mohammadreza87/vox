# Reviewed synthetic learning cases — release evidence

PR [#80](https://github.com/mohammadreza87/vox/pull/80) merged into `develop` and deployed on 20 October 2026. Installed revision `a49f734e16e0a5b3430c1e1c088dab33feda5d53`; tree `2e04aa9ff528031ced199bc1c097887c0ac104b7`; build `qBMW4EQJf-saXHqxeh7jJ`, built at 10:10:24.209 UTC. The merged tree exactly matches final reviewed head `c841c6f`. That head changes documentation only after independently accepted code `e05e460`.

The synthetic-only offline workflow binds reviewed findings, closed recipes, evaluator lineage and frozen corpora to current authority. Withdrawal, expiry and failed durable clock/capacity checks prevent use or promotion. An explicit v2 migration preserves old history; release admission rejects incompatible histories. This deployment does not activate the workflow, migrate production data, export real conversations or automatically promote changes.

Independent acceptance passed 41 external workflow/integration/capacity/Docker checks and 45 external release-scanner checks. The actual released v1 reader accepted original data and then refused the actual migrated v2 bytes. An actual isolated Docker run accepted the good synthetic routing artifact and rejected the planted bad artifact. The composed improvement suite passed 185 tests with four existing skips. These evidence layers overlap and are not a unique-scenario total.

Final CI [221](https://github.com/mohammadreza87/vox/actions/runs/39404490364) passed 3,945 tests with 13 existing skips, 36 additional release/configuration/provenance checks, lint/type checking, build and 41 browser journeys. Indexed qualification 34 and preview 145 passed. The existing continue-on-error dependency audit reported 14 findings (8 moderate, 6 high); the successful job status does not mean the audit was clean. Dependencies are unchanged.

Original failure evidence remains preserved: independent QA found an aggregate audit-capacity defect, repaired and requalified before merge. The first concurrent local run had 13 failures across eight unchanged files; all 98 tests in those files passed with one worker and unchanged criteria. Final CI passed the complete suite.

Installation made a stopped-process backup at `backups/2026-10-20T10-11-16-250Z` under the Vox Studio production directory. At **10:11:51.630 UTC**, all 40 local/public route checks passed with the installed revision. Unauthenticated operations endpoints denied access. All five current bots passed read-only webhook ownership checks. One LaunchAgent runtime wrapper and one listener owned the service.

Production environment SHA256 stayed `ee370a968a1a99f7d93ea1a1dbe31bf6a80958bd1d5d567624db2c4e50af638d`. Legacy FILE storage remains active with no managed adaptive directory. Optional Decisions expansion, scoped relationships, group observation, maintenance, reminder delivery and experiments remain off. Legacy reply triage remains effectively configured. Improvement trust/history, guest and rights policies/keys remain absent; Connections availability is unchanged.

Provider preflight checked credential/model availability only; no generation or user message occurred. Authenticated journeys were exercised in isolated compiled CI fixtures, not through a real production account. This release proves neither physical-device delivery nor production IAM, legal eligibility, provider/backup deletion, representative quality gains or full parent-roadmap completion.

Durable local evidence directory: `/Users/reza/.codex/visualizations/2026/10/20/vox-learning-cases/`. Files: `final-candidate.json`, `independent-qa/REPORT.md`, `independent-qa/evidence-manifest.json`, `ci-final-results.json`, three final CI logs, `merged-build.log`, `merged-build-manifest.json`, `install.log`, `immediate-preinstall-live.json` and `postinstall-live.json`. `release-evidence-hashes.json` binds these records.

## فارسی

PR #80 در ۲۰ اکتبر ۲۰۲۶ با نسخهٔ `a49f734` در `develop` ادغام و مستقر شد. این تغییر، نمونه‌های مصنوعیِ بازبینی‌شده را به یافتهٔ اصلی، دادهٔ ارزیابی و مجوز فعلی متصل می‌کند. لغو مجوز، انقضا یا ناتوانی در ثبت ایمن ساعت و ظرفیت، استفاده یا ارتقا را متوقف می‌کند. این استقرار، قابلیت اختیاری را فعال نمی‌کند، دادهٔ تولید را مهاجرت نمی‌دهد و گفت‌وگوی واقعی را به مجموعهٔ بهبود صادر نمی‌کند.

۴۱ بررسی مستقل گردش کار و Docker و ۴۵ بررسی سازگاری انتشار موفق بود. CI نهایی ۳۹۴۵ آزمون با ۱۳ مورد کنارگذاشته‌شده، ۳۶ بررسی انتشار و ۴۱ مسیر مرورگر را گذراند. ممیزی وابستگی‌ها همچنان ۱۴ یافتهٔ قبلی شامل ۸ مورد متوسط و ۶ مورد بالا گزارش کرد؛ موفقیت کلی CI به‌معنای پاک بودن ممیزی نیست. اشکال ظرفیت قبل از ادغام اصلاح و دوباره بررسی شد؛ شواهد شکست اولیه حفظ شده‌اند.

در ساعت ۱۰:۱۱:۵۱٫۶۳۰ UTC هر ۴۰ بررسی مسیر محلی/عمومی و بررسی مالکیت هر پنج ربات موفق بود. فایل تنظیمات، قالب ذخیره‌سازی و پرچم‌ها تغییر نکردند. آزمون حساب واقعی تولید، دستگاه، حذف نزد ارائه‌دهنده یا نسخهٔ پشتیبان، تأیید حقوقی و بهبود کیفیت نمایندهٔ کاربران همچنان از این نتایج قابل استنباط نیستند. اجرای بخش‌های بعدی نقشهٔ راه ادامه دارد.

Release report SHA256: `51b5e9b6f8b4f79e9fb3846432d4891fa4bec0efa95e5ff99d0fc094ca4ba55a`.
