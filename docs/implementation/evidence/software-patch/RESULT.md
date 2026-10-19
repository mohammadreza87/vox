# VOX-045 local software patch qualification

Baseline: `e1186f258d38de538c8f20537ee7579f577f1269`. Candidate implementation is the exact file set in [source.sha256](source.sha256), initially uncommitted on that base. The independent demonstration's [report](report.json) additionally binds six workflow implementation files and its loader/runtime. The target fix matches the receipt's `resultSourceDigest` exactly.

The real `SentenceDetector` previously delayed questions ending in Persian `؟` until flush. A deterministic synthetic author generated a one-line change to recognize that boundary. The host materialized it without executing it, then the pinned Docker runner executed both versions. A different agent independently reviewed the workflow and reran the demonstration. The parent applied the resulting reviewed patch to the actual repository module.

| Check | Result | Boundary |
|---|---|---|
| Protected module corpus | 12 cases; baseline 4 failures, candidate 0 | Synthetic input; expected outputs and scoring outside container |
| Independent materializer and registry tests | 45 passed | Strict source binding, review, replay, revocation, expiry and concurrent changes |
| Independent real Docker adversarial suite | 7 passed | Fake logs, crashes, timeout, minimal mounts, readonly filesystem and absent external route |
| Named container cleanup after timeout suite | No `vox-software-*` containers remained | Local Docker host at test completion |
| App module regression | Before: 3 failures / 2 passes; after: 5 passes | Persian chunking plus English, reset and flush controls |
| TypeScript and scoped ESLint | Passed | Local source checks |
| Whole application suite | 2,056 passed; 13 skipped | Two-worker local run with unchanged test time limits |
| CI / deployed artifact | Pending | Recorded separately after completion |

The first unrestricted-concurrency application run hit two existing storage simulation timeouts (2,054 passed, 13 skipped). The rerun used `--maxWorkers=2` with the same timeout thresholds and passed. Afterward the Git reader test was made independent of checkout history using a temporary bare repository; its 22-test suite passed separately. No product code changed after the full passing run.

The demonstration refused readiness before a signed review, then accepted its **synthetic** human-review envelope. [Public keys](public-trust.json), [review packet](review-packet.json) and [candidate patch](candidate.patch) contain no private signing keys. No user conversation store, message transport, production configuration, remote PR or Git write is accessed by the demonstration.

Reproduce from the repository root with an existing pinned image and a new output directory:

```sh
VOX_IMPROVEMENT_IMAGE=sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 \
  npx tsx scripts/software-improvement-demo.ts /tmp/vox-software-rehearsal-new \
  e1186f258d38de538c8f20537ee7579f577f1269

VOX_SOFTWARE_DOCKER_TEST=1 npx vitest run \
  --config scripts/improvement-vitest.config.ts \
  src/lib/adaptive/improvement/software-sandbox.test.ts
```

No image download occurs. The old baseline object must exist locally; normal unit tests use a frozen fixture and do not require Git history. Failed or incomplete execution produces a failed-readiness report and a nonzero CLI exit; it cannot issue a synthetic approval. A source change during the demo invalidates its evidence.

The evaluator fingerprint includes runtime function source and is loader/build dependent; evaluator and registry must use matching protected code. The full file manifest also binds transitive schemas and materialization code. Local packet readiness is advisory: a future publisher must coordinate current Git state and registry state, recheck the exact base and honor fresh review/revocation. There is no mutating publication consumer here. Host/Docker trust, synthetic role keys, finite examples and deterministic authorship remain explicit limitations; production IAM, protected worker deployment, model-generated patches and measured user benefit remain unavailable.

## فارسی

این آزمایش روی نسخهٔ پایهٔ ثبت‌شده و فایل‌های دارای هش اجرا شده است. نسخهٔ اولیه در چهار مورد از دوازده ورودی مصنوعی شکست خورد؛ پچ پیشنهادی همهٔ دوازده مورد را گذراند. بازبینی مستقل، ۴۵ آزمون قرارداد و رجیستری و ۷ آزمون واقعی Docker را تأیید کرد. آزمون‌های خود ماژول پیش از اصلاح سه شکست داشتند و پس از اصلاح هر پنج مورد موفق شدند.

تأییدکنندهٔ این نمایش مصنوعی است؛ کلید خصوصی در شواهد ذخیره نشده است. امتیازدهی و پاسخ‌های مورد انتظار بیرون از کانتینر قرار دارند. این نتیجه کیفیت مکالمه، منفعت کاربران، دسترسی مستقل سرویس‌های عملیاتی یا انتشار خودکار را ثابت نمی‌کند. آماده‌بودن بسته محلی و وابسته به نسخهٔ دقیق است؛ مسیر انتشار آینده باید نسخهٔ Git، وضعیت رجیستری و لغوهای جدید را دوباره هماهنگ و بررسی کند. وضعیت CI و استقرار به‌صورت جداگانه ثبت می‌شود.
