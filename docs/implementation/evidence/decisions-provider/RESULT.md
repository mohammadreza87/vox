# OpenAI Decisions: one synthetic provider smoke

19 October 2026, 18:51 UTC. Provider source at deployed revision `523e9f0`; exact file digest in [the sanitized receipt](smoke.json). Research checked the current official [guide](https://developers.openai.com/api/docs/guides/decisions) and [create reference](https://developers.openai.com/api/reference/resources/decisions/methods/create).

The installed SDK 6.9.1 public `post('/decisions')` sent one synthetic geometry question with fixed string choices to `gpt-6-luna`, with a five-second timeout and zero retries. It completed successfully. The live response shape was then replayed locally through the unchanged production `DecisionService` decoder and accepted, without another network call. No user content, memories, identities, audio or messages were used. No feature/configuration change or activation occurred. Exact HTTP status was not captured; the receipt reports SDK success rather than inventing one.

| Measurement | Observed |
| --- | --- |
| Network requests | 1 |
| Model returned | `gpt-6-luna` |
| Request duration | 1,087 ms |
| Input / output / total tokens | 134 / 0 / 134 |
| Cached / cache-write tokens | 0 / 0 |
| Production adapter deadline | 500 ms; exceeded by this sample |

This establishes credential/model access and compatibility of one documented response with the decoder. It does not prove a deployed adaptive request completed within its deadline. A single sample cannot establish p50/p95, speed improvement, routing quality, cost baseline, retention, residency, regional transfer approval or device behavior. Keep the production deadline and baseline fallback unchanged until a controlled cold/warm, EN/FA, representative-size evaluation supports a different choice.

The first harness setup attempted an unsupported package metadata export and stopped with `ERR_PACKAGE_PATH_NOT_EXPORTED` before reading credentials or making any network request. After explicit lead authorization, that local lookup was corrected; the one-request limit and no-provider-retry rule remained intact. The receipt preserves both phases.

## فارسی

یک درخواست ساختگی با گزینه‌های ثابت و مدل `gpt-6-luna` موفق شد. شکل پاسخ واقعی با بازپخش محلی در رمزگشای فعلی برنامه پذیرفته شد؛ درخواست شبکهٔ دوم انجام نشد. هیچ دادهٔ کاربر، حافظه، هویت یا صوتی ارسال و هیچ قابلیتی فعال نشد.

زمان درخواست ۱۰۸۷ میلی‌ثانیه بود و ۱۳۴ توکن ورودی و صفر توکن خروجی گزارش شد. این زمان از مهلت ۵۰۰ میلی‌ثانیه‌ای مسیر تولید بیشتر است؛ بنابراین نتیجه، اثبات سریع‌تر شدن گفتگو یا پاسخ موفق در مهلت تولید نیست. ارزیابی کیفیت، توزیع تأخیر، هزینه، نگهداری و محل پردازش داده و دستگاه واقعی همچنان باز است. خطای اولیهٔ آماده‌سازی پیش از خواندن کلید یا تماس شبکه رخ داد و در رسید حفظ شده است.
