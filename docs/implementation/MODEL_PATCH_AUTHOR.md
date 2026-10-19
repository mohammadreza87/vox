# Model patch author / نویسندهٔ اصلاح کد

## English

VOX-045 v2 adds a real author adapter for the existing synthetic Persian sentence-boundary defect. Input is limited to the frozen `sentence-detector.ts` module, a fixed issue description and one public reproduction. The model receives no tools, private conversations, lineage identifiers, signing keys or protected evaluator cases. This is a one-module experiment, not a production development agent.

The Responses request uses `gpt-6.1-sol`, low reasoning, strict JSON, `store:false`, no tools, 2,048 maximum output tokens, a 30-second deadline and zero retries. The [official model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol) supports this configuration; installed OpenAI SDK 6.9.1 needs no upgrade. Model metadata access and actual generation are separate evidence gates. `store:false` does not establish the account's complete retention policy.

Before dispatch, the trusted registry verifies signed finding/proposal, baseline, keys, expiry and revocation. It durably consumes one request slot per proposal, followed by a fresh authority check. Replaying a reservation, including after a crash, never grants another request. Timeouts have unknown provider completion/usage and are not retried. Minimized signed receipts retain known usage even when output is rejected; missing usage is not zero. A crash before receipt persistence leaves a consumed reservation and uncertain outcome.

The unchanged materializer permits one exact-context hunk in one file, at most 32 changed lines and 32 KiB. Candidate TypeScript runs only in the existing pinned, network-disabled Docker evaluator. Expected answers/scoring stay on the host; protected cases, thresholds and evaluation policy are unchanged. V1 deterministic artifacts remain supported. V2 binds its signed author receipt to reservation, finding, proposal, input, source, model, policy, time and patch. Evaluator receipts attest executable bytes/baseline; author provenance is checked separately. Human review binds the entire artifact and signed evaluation, so old v1 approval cannot approve v2. Readiness is advisory; future publishing needs coordinated repository/registry checks before mutation.

```sh
VOX_IMPROVEMENT_IMAGE=sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 \
  npx tsx scripts/software-model-author-demo.ts /tmp/vox-model-author-new-run \
  e1186f258d38de538c8f20537ee7579f577f1269 mock
```

The output directory must be new. `mock` makes no provider requests; its response and usage are simulated. `provider` makes one provider request, potentially billable, using an existing `OPENAI_API_KEY` environment variable. The script never loads production credentials itself. Both modes use ephemeral role keys and synthetic human review, write local evidence and never modify Git, publish or deploy. They establish neither actual human approval nor production IAM.

Historical baseline `e1186f2` deliberately reproduces the defect already fixed in PR #53. It is different from the author implementation commit. The demo fixes that immutable baseline and checks an eight-file implementation manifest before/after execution; it does not assert branch HEAD or production freshness. A pass does not measure conversation benefit, generic coding ability or safe autonomous deployment. New evidence belongs to [model-author evidence](evidence/model-author/RESULT.md); the original [v1 receipt](evidence/software-patch/RESULT.md) remains historical.

## فارسی

نسخهٔ دوم VOX-045 برای همان ایراد آزمایشی مرزبندی جملهٔ فارسی، نویسندهٔ مدل‌محور اضافه می‌کند. ورودی فقط فایل ثابت `sentence-detector.ts`، شرح مشخص ایراد و یک نمونهٔ عمومی است. مدل ابزار، گفت‌وگوی خصوصی، شناسهٔ تبار، کلید امضا یا آزمون محافظت‌شده دریافت نمی‌کند. این آزمایش به یک فایل محدود است و عامل توسعهٔ عملیاتی نیست.

درخواست Responses از `gpt-6.1-sol` با استدلال low، خروجی JSON محدود، `store:false`، بدون ابزار، سقف ۲۰۴۸ توکن خروجی، مهلت ۳۰ ثانیه و بدون تکرار خودکار استفاده می‌کند. مستندات رسمی بالا و SDK نصب‌شدهٔ 6.9.1 مبنای سازگاری هستند. دسترسی به مشخصات مدل با تولید موفق متفاوت است؛ `store:false` نیز تأیید کامل سیاست نگهداری نیست.

پیش از ارسال، میزبان امضا، مبنا، کلیدها، انقضا و لغو تبار را بررسی می‌کند، تنها سهمیهٔ درخواست پیشنهاد را پایدار مصرف کرده و اختیار را دوباره می‌سنجد. بازپخش یا بازسازی پس از خرابی، سهمیهٔ دوم ایجاد نمی‌کند. نتیجه و مصرف درخواست مهلت‌گذشته نامعلوم است و تکرار نمی‌شود. رسید حداقلی، مصرف معلوم را حتی برای خروجی ردشده حفظ می‌کند؛ مصرف نامعلوم صفر نیست. خرابی پیش از ثبت رسید، رزرو مصرف‌شده و نتیجهٔ نامعلوم باقی می‌گذارد.

محدودیت اصلاح تغییر نکرده است: یک قطعه با زمینهٔ دقیق، یک فایل، حداکثر ۳۲ خط تغییر و ۳۲ کیبی‌بایت. کد نامزد فقط در Docker ثابت با شبکهٔ بسته اجرا می‌شود؛ پاسخ‌ها و امتیازدهی در میزبان می‌مانند. موارد آزمون، آستانه‌ها و سیاست ارزیابی ثابت‌اند. نسخهٔ اول همچنان پشتیبانی می‌شود. نسخهٔ دوم رسید نویسنده را به رزرو، یافته، پیشنهاد، ورودی، منبع، مدل، سیاست، زمان و اصلاح متصل می‌کند. ارزیاب بایت‌های کد و مبنا را می‌سنجد؛ منشأ نویسنده جداگانه بررسی شده و تأیید انسانی به کل محصول و ارزیابی امضاشده متصل است. تأیید قدیمی نسخهٔ اول برای نسخهٔ دوم معتبر نیست. آمادگی مشورتی است؛ انتشار آینده به هماهنگی مخزن و رجیستری نیاز دارد.

فرمان بالا به پوشهٔ تازه نیاز دارد. حالت `mock` تماس واقعی ندارد و پاسخ و مصرف آن شبیه‌سازی‌اند. حالت `provider` یک درخواست ارائه‌دهنده با احتمال محاسبهٔ هزینه و کلید موجود در محیط می‌فرستد؛ اسکریپت اسرار عملیاتی را خودش بارگیری نمی‌کند. هر دو حالت کلید موقت و بازبینی انسانی مصنوعی دارند، فقط شواهد محلی می‌نویسند و Git، انتشار یا استقرار را تغییر نمی‌دهند. این اجرا تأیید واقعی انسان یا جداسازی IAM عملیاتی نیست.

مبنای تاریخی `e1186f2` ایراد اصلاح‌شده در PR #53 را بازتولید می‌کند و با نسخهٔ پیاده‌سازی نویسنده متفاوت است. هش هشت فایل پیاده‌سازی پیش و پس از اجرا کنترل می‌شود، اما تازه‌بودن HEAD شاخه یا محیط عملیاتی تضمین نمی‌شود. موفقیت آزمایش، بهبود گفت‌وگو، توانایی عمومی کدنویسی یا انتشار خودکار امن را اثبات نمی‌کند. شواهد جدید در پیوند بالا ثبت می‌شوند؛ رسید نسخهٔ اول تاریخی باقی می‌ماند.
