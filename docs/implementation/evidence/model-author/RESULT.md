# VOX-045 model author evidence / شواهد نویسندهٔ مدل‌محور

Implementation base: `17498e464bc5a8370d24b0c71b5af0dea255a2e2`, with the exact reviewed dirty source identified by [source.sha256](source.sha256) and [independent manifest](independent-source-manifest.json). The eight-file run manifests bind actual executed source, including uncommitted files. The defective module baseline is separately fixed to `e1186f258d38de538c8f20537ee7579f577f1269`. All fixtures are synthetic/public repository source.

| Gate | Observed result |
| --- | --- |
| Independent author/materializer/registry tests | 81 passed: author 21, materializer 22, registry 38 |
| Additional independent probes | Exact outbound projection and canary exclusion; consumed reservation survives restart/replay; revoked lineage, tampered receipts, v1 approval reused for v2 and changed whole artifact rejected |
| Mock full workflow | 12 protected cases, baseline 4 failures, candidate 0; readiness denied before synthetic human review, allowed afterward |
| Independent mock Docker rerun | Fresh corpus, 12 cases, baseline 4, candidate 0; evaluator unchanged |
| Actual model access | Fixed model metadata available; read-only request, zero generation requests |
| Actual model generation | Exactly one `gpt-6.1-sol` Responses request; 9,524 ms; 1,868 input + 231 output = 2,099 tokens; valid five-line hunk |
| Original provider-mode Docker stage | **INCOMPLETE**, zero assessed failures, readiness denied, no human approval |
| Independent saved-provider-patch evaluation | Same captured artifact, fresh corpus, 12 cases, baseline 4 failures, candidate 0; 1,688 ms |
| Types / scoped lint | Passed |
| CI / deployment | Pending separate release evidence; no activation or deployment by this workflow |

The root test launcher omitted `HOME`. The evaluator explicitly falls back to `/tmp` when HOME is missing; on this Mac that selects Docker's default context and unavailable `/var/run/docker.sock`. Independent read-only diagnosis found normal HOME selects `desktop-linux` and the pinned image is available. Docker with HOME merely omitted still works on this machine; the explicit evaluator fallback explains the failure. No source/evaluator/threshold was changed to obtain a pass, and no provider request was repeated.

The original [provider report](provider/report.json), signatures and registry remained byte-identical and **incomplete/not ready**. [Independent QA](provider-independent-qa.json) verified those signatures, provenance, exact artifact digest and current implementation hashes before evaluating the captured patch once with normal host configuration. The independent pass is a separate result; it does not retroactively approve the failed run. The successful [mock run](mock/report.json) is not actual provider evidence.

The generated patch differs in context width from the deterministic v1 patch but produces the identical reviewed module bytes, SHA256 `1ffdaa03c7ddc39e07019403c141d396b50fb2de7a35e83da6ec987cefa054b9`. The candidate was not executed by the author or imported on the host. Expected answers, evaluator and signing keys were absent from the provider payload and candidate container. Public verification keys are included; private keys were ephemeral and not persisted.

The implementation is accepted for this bounded author/component slice. Real-provider end-to-end readiness remains incomplete for the original run. Actual billing, complete account retention, production IAM, generic issue-to-code ability, automatic PR publication, measured conversation benefit and autonomous deployment are unqualified. Current app source already contains the punctuation fix from PR #53; the historical rehearsal does not patch it again.

## فارسی

مبنای پیاده‌سازی `17498e4` همراه با تغییرات ثبت‌نشدهٔ دقیق در فایل هش و مانیفست مستقل بالا مشخص شده است. مبنای ماژول معیوب جداگانه `e1186f2` است. داده‌ها فقط مصنوعی و کد عمومی مخزن هستند.

۸۱ آزمون مستقل گذشت: ۲۱ آزمون نویسنده، ۲۲ آزمون اعمال اصلاح و ۳۸ آزمون رجیستری. بررسی اضافی، حداقل‌بودن ورودی، عدم افشای نشانگر خصوصی، عدم تکرار درخواست پس از بازسازی، لغو تبار، دستکاری رسید و عدم استفادهٔ مجدد از تأیید نسخهٔ اول را پوشش داد. اجرای کامل mock و اجرای مستقل Docker هرکدام ۱۲ مورد داشتند: ۴ شکست مبنا و صفر شکست نامزد. آمادگی پیش از بازبینی انسانی مصنوعی رد و پس از آن پذیرفته شد.

فقط یک درخواست واقعی `gpt-6.1-sol` انجام شد: ۹۵۲۴ میلی‌ثانیه، ۱۸۶۸ توکن ورودی و ۲۳۱ خروجی، مجموع ۲۰۹۹. مدل اصلاح معتبر پنج‌خطی تولید کرد. مرحلهٔ Docker همان اجرای واقعی **ناقص** ماند، آمادگی رد شد و هیچ تأیید انسانی ثبت نشد؛ صفر شکست گزارش‌شده در آن مرحله به معنی موفقیت نیست.

علت در راه‌انداز آزمون بود: HOME حذف شده بود و fallback ارزیاب به `/tmp`، Docker را به context پیش‌فرض بدون سوکت فعال هدایت کرد. بررسی مستقل نشان داد HOME عادی context صحیح را انتخاب می‌کند. خود Docker با HOME صرفاً حذف‌شده همچنان کار می‌کرد؛ fallback صریح علت بود. هیچ کد، آستانه یا معیار ارزیابی تغییر نکرد و درخواست هزینه‌دار تکرار نشد.

ارزیابی مستقل، امضاها، منشأ، هش محصول و منابع را بررسی کرد و همان اصلاح ذخیره‌شده را یک بار با مجموعهٔ تازه اجرا کرد: ۱۲ مورد، ۴ شکست مبنا و صفر شکست نامزد در ۱۶۸۸ میلی‌ثانیه. شواهد و رجیستری اصلی بدون تغییر و **ناقص/آماده‌نبودن** باقی ماندند. این موفقیت جداگانه، اجرای قبلی را تأیید نمی‌کند. بایت‌های حاصل دقیقاً با اصلاح PR #53 برابرند و دوباره روی مخزن اعمال نشده‌اند.

این پیاده‌سازی برای بخش محدود نویسنده پذیرفته شده است. اجرای کامل واقعی اولیه همچنان ناقص است. صورتحساب واقعی، سیاست کامل نگهداری، IAM عملیاتی، کدنویسی عمومی، انتشار خودکار PR، بهبود واقعی گفت‌وگو و استقرار خودکار تأیید نشده‌اند. CI و استقرار باید جداگانه ثبت شوند. کلیدهای خصوصی فقط در حافظه بودند؛ فقط کلیدهای عمومی تأیید در شواهد آمده‌اند.

## Post-review output-directory boundary / مرز پوشهٔ خروجی پس از بازبینی

PR #57 review identified that a requested evidence directory could be inside the checkout or Git metadata. The revised launcher resolves the actual worktree, Git directory, shared Git directory and existing output parent before atomically creating a new external directory. Seven scoped temporary-repository tests cover linked worktrees, separate Git directories, symlinked parents, existing paths and safe sibling paths. Types and scoped lint pass. Parent-directory ownership remains a trusted-host assumption.

The separate [post-review mock report](post-review-mock/report.json), [manifest](post-review-mock/manifest.json) and [nine-file source hashes](post-review-source.sha256) record the changed launcher/helper. This run used the original defective `e1186f2` baseline, one simulated transport call and actual pinned Docker: 12 protected cases, baseline 4 failures, candidate 0. Readiness was denied before synthetic human review and allowed afterward. No provider request was made. Earlier eight-file hashes, provider receipts and failed original provider run remain unchanged historical evidence; this mock pass does not change their status.

در بازبینی PR #57 مشخص شد پوشهٔ شواهد می‌توانست داخل درخت کاری یا فرادادهٔ Git ساخته شود. راه‌انداز اصلاح‌شده مسیر واقعی درخت کاری، پوشهٔ Git، پوشهٔ مشترک Git و والد موجود خروجی را بررسی کرده، سپس پوشهٔ تازهٔ خارجی را به‌صورت اتمی می‌سازد. هفت آزمون محدود با مخزن موقت، درخت کاری پیوندشده، پوشهٔ Git جدا، والد نمادین، مسیر موجود و پوشهٔ هم‌سطح مجاز را پوشش دادند. بررسی نوع و lint محدود موفق بودند. مالکیت والد همچنان فرض میزبان مورد اعتماد است.

گزارش mock و هش نه فایل در پیوندهای بالا شواهد جداگانهٔ پس از بازبینی‌اند: مبنای معیوب اصلی `e1186f2`، یک فراخوانی شبیه‌سازی‌شده و Docker واقعی ثابت؛ ۱۲ مورد، ۴ شکست مبنا و صفر شکست نامزد. آمادگی پیش از بازبینی انسانی مصنوعی رد و پس از آن پذیرفته شد. هیچ درخواست ارائه‌دهنده انجام نشد. هش‌های تاریخی هشت‌فایلی، رسیدهای ارائه‌دهنده و اجرای واقعی ناقص قبلی تغییر نکرده‌اند و این موفقیت mock وضعیت آن‌ها را عوض نمی‌کند.
