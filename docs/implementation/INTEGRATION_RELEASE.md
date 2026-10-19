# Adaptive develop integration

This release combines the adaptive foundation (`dd1b317`), the Mac Studio voice/profile/group release (`7b1e09b`), and the relationship foundation and role-pilot infrastructure (`2af7e8f`). `develop` was created from `main` (`68a1cd3`); the integration is reviewed as one candidate before deployment. Existing branch test reports remain historical evidence, not qualification of the combined source.

## Runtime behavior

- The deployment target is the existing Mac Studio file-store/polling service at `https://vox.joyixir.com/studio`. A merge into `develop` does not trigger the separate `main` Firebase production workflow or transfer Telegram webhook ownership.
- Adaptive Work/Personal, exact-recipient sharing and experience controls are included. Optional collection and inference still require reviewed capability configuration and each applicable user choice. No legal approval records are manufactured by this release.
- Legacy unscoped conversation history and automatic extraction are not silently imported into the new consent model. Existing records remain available for inspection/deletion; their bytes are preserved. Core replies still operate with optional processing declined.
- The relationship implementation is included, but its live/shadow loop is disabled in the composed adaptive runtime, including if a loop is injected. It must acquire space/binding-aware keys, current consent and a separate external-message authorization contract before activation. An adaptive proactive-inbox choice does not authorize unsolicited Telegram sends.
- Old memory sharing writes are unavailable when adaptive services are present. New sharing uses the explicit audience preview and scoped Shared Memories controls. Existing source deletion and access narrowing remain possible.
- Personal calls use scoped tap-to-talk. Work realtime calls use the adaptive boundary before provider access and before each emitted text chunk. Unstamped provider history is not imported as durable conversation history. Completed adaptive calls do not automatically extract legacy memories.
- Group membership checks, epoch invalidation, captured recipient lists, voice delivery format/fallback and profile synchronization remain part of the combined regression suite. Unknown group readership suppresses disclosure.

## Verification and promotion

The release owner records the exact candidate commit, full regression result, production build ID, browser fixture boundaries, remote CI checks and deployed local/public revision separately. The production installer requires a clean committed source and matching build provenance, stops the service for a private data backup, and restores the previous release if readiness fails. See [production operations](../PRODUCTION.md).

Combined local verification on 2026-10-19: 1,757 Vitest tests passed across 119 files; nine Firestore-emulator cases in two files were skipped because this run had no emulator. TypeScript passed. Repository lint passed with 182 warnings and zero errors. All 33 deployment/configuration script tests passed. Production dependency audit reported eight moderate findings and zero high/critical findings; the known inherited warnings are not described as a clean audit. The [independent review](evidence/integration-review.md) passed 50 selected cases, including four newly authored boundary regressions. Later deployment receipts identify the final artifact and remote checks.

The adaptive browser journey runs with its dedicated production server before the standard browser suite in CI; its outputs now go to ignored `test-results`, preserving historical screenshots. The legacy relationship browser fixture explicitly advertises its legacy sharing capability; this fixture does not imply the production capability is active. CI's summary waits for browser tests.

Remaining activation gates include complete Joyixir legal/contact details and approved notices, provider processing/retention qualification, real recipient/device tests, biometric consent and enrollment controls, background retention/backup reconciliation, and independent service isolation for automated improvements. Neither voice nor communication style authenticates a person or unlocks someone else's memories.

## ادامهٔ انتشار به فارسی

این نسخه تغییرات حافظهٔ تطبیقی را با امکانات فعلی صدا، گروه و پروفایل ترکیب می‌کند. مقصد انتشار همان سرویس Mac Studio است و مالکیت دریافت پیام‌های تلگرام تغییر نمی‌کند. قابلیت‌های اختیاری بدون تنظیمات تأییدشده و انتخاب کاربر فعال نمی‌شوند. حافظهٔ قدیمی خودکار وارد ساختار جدید نمی‌شود و داده‌های قبلی برای مشاهده و حذف حفظ می‌شوند.

حلقهٔ ارتباط پیش‌دستانه در نسخهٔ ترکیبی غیرفعال می‌ماند تا مجوز ارسال بیرونی، فضای کاری/شخصی و هویت تأییدشده یکپارچه شوند. تماس شخصی از مسیر گفت‌وگوی نوبتی استفاده می‌کند. اشتراک‌گذاری جدید فقط با نمایش مخاطبان دقیق انجام می‌شود. نتایج آزمون محلی، CI، شناسهٔ ساخت و نسخهٔ واقعی مستقر جداگانه ثبت می‌شوند؛ تأیید حقوقی و آزمون دستگاه واقعی همچنان مستقل هستند.
