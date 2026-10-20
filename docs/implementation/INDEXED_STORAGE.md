# Indexed private memory: operation and evidence

This implements the local private-memory portion of VOX-013. The default remains
the original FILE adapter. `STUDIO_ADAPTIVE_FORMAT=sqlite-v1` selects an explicitly
prepared SQLite store; `file-v2` selects a current-state rollback store. Selecting
a format never migrates, repairs, initializes a missing managed target, or grants
permission. Managed formats require persistent local file topology. Firestore,
serverless and webhook/distributed configurations reject them.

## Behavior and limits

SQLite stores canonical account compatibility images, compact authority records,
memory metadata/bodies, lexical postings, provenance edges, catalog versions and
outbox state in one transaction. A private query considers at most 128 normalized
terms, selects at most 64 candidates and reads at most 128 KiB of candidate bodies.
The final reply context still allows at most 12 items and 8192 UTF-8 bytes. EN/FA
ranking and whole-statement summary coverage remain explicit; this is lexical
retrieval, not a new embedding provider or a semantic-quality claim.

Pure indexed authority checks do not materialize private canonical memory bodies.
Retained work carries a fresh store incarnation, format generation, content/rights
catalog and deadline. Corrections, grants, withdrawal and namespace changes
invalidate preceding receipts. A persisted lifecycle watermark prevents an expired
permission from becoming valid again after a clock regression/restart. Mixed
negative and positive authority snapshots preserve both denial observations and
the remaining positive deadline.

Account writes still use canonical compatibility images. Shared memories and
relationship stores remain aggregates; the complete enabled turn is not claimed
to avoid all aggregate reads. Current limits remain 300 memory rows and 700000
canonical bytes per account. Migration stops at 10000 accounts or 64 MiB of source
canonical data. These are safeguards, not production capacity or latency results.

Studio/group authority includes current membership, roles, agent access/blocks,
group audience and permission epochs. A final coherent Studio snapshot prevents
combining separately stale audience observations. Shared context still requires
the exact permitted audience. Voice or writing style never creates a verified
identity or a sharing grant.

Native packaging uses better-sqlite3 13.0.3 with Node 22.23.3. Linux x64 and Darwin
arm64 qualification are separate from the actual Vox artifact checks. Single
process ownership is required; a second writer fails closed. Filesystem snapshots,
backup restoration, multiple hosts and provider retention need their own controls.

## Explicit transition procedure

Use the exact reviewed source and canonical absolute local paths. On macOS resolve
`/tmp` or `/var` aliases first; symlink paths, including dangling links, are rejected.
Do not pass private data or secrets through command output.

1. Establish a maintenance window and stop every process that can read/write the
   old private adaptive store. Confirm actual process ownership and queues. The
   CLI's `--quiesced` flag is an assertion, not a process-stop mechanism.
2. Record the exact artifact, current format/identity, sanitized counts and source
   digest. Qualify capacity, backup/residual retention and recovery for that target.
3. Use `node --import tsx scripts/adaptive-storage.ts migrate --root <private-root>
   --quiesced` for original FILE or current FILEv2 to a new SQLite store.
4. Inspect with `node --import tsx scripts/adaptive-storage.ts inspect --root
   <private-root>`. Only a validated ready marker with the expected identity may
   be selected. Configure `STUDIO_ADAPTIVE_FORMAT=sqlite-v1` explicitly and start
   the qualified runtime. Optional capabilities remain independently off unless
   their separate policy, consent and release gates are met.
5. Verify real routes and scoped synthetic CRUD, restart behavior and current
   receipt handling. Keep source, artifact, environment and runtime results separate.

Management metadata is at `<private-root>.managed/format.json`; immutable target
stores, legacy archives and abandoned partial targets live below that management
directory. Successful migration replaces the old FILE directory with a poison
file, so an old binary cannot silently create a second writable store. Runtime
selection refuses missing targets, mismatched identities, incomplete intents,
unknown schemas and fallback to FILE.

For format rollback, stop all writers and run `rollback --root <private-root>
--quiesced` through the same CLI. It converts the **current SQLite state** to a new
FILEv2 namespace, preserving current corrections, consent/grant epochs, deletion
tombstones, replay keys and outbox. Select `STUDIO_ADAPTIVE_FORMAT=file-v2` only
with a compatible binary. Never restore the original migration archive or an old
account backup over current rights. Code-only rollback is separate and requires a
binary compatible with the currently selected format.

## Interrupted operations

Do not guess which target to serve or delete a lock to make startup pass. Keep all
writers stopped and inspect the exact phase and sanitized manifest first.

| Phase | Explicit recovery | Required evidence |
|---|---|---|
| Prepared, partial import | `abort-prepared` | Exact transition ID/source digest and unchanged current source; target is quarantined, not selected |
| Verified or poisoned | `finalize` | Exact transition ID/source digest and complete source/target equality |
| Ready, dead owner | `recover-ready` | Exact current format, incarnation and generation; validated current target |

Every recovery command needs `--root` and `--quiesced`. `finalize` and
`abort-prepared` take `--transition-id` and `--source-digest`; dead-lease recovery
additionally requires `--reclaim-dead-lease`. `recover-ready` takes `--format`,
`--incarnation`, `--generation` and `--reclaim-dead-lease`. Reclamation is allowed
only when the recorded process is demonstrably dead. PID reuse or uncertain
ownership remains unavailable for manual inspection.

Retired stores, original archives and quarantines remain named private residuals;
the tool does not silently erase them. FILEv2 removes superseded images after
durable publication, but crash orphans can remain. Unlink and SQLite secure_delete
do not prove erasure from SSD blocks, snapshots or backups. Retention/cleanup and
restore suppression must be established before a real-data migration.

## Verification boundary

Independent native transition review at `e4cc931` passed 52 protected regressions
and two additional source/target drift probes. A third probe found an old
selected-message receipt surviving migration; `db5c34e` fixed the caller namespace
binding and independent review at `f061d659` rejected every preceding message and
summary receipt through FILE → SQLite → FILEv2 → SQLite while current receipts
remained usable. Compact consumer selection passed 92 independently rerun tests.

Independent coherent authority review at `f061d659` passed 91 protected tests and
12 additional probes. Selector and mixed-expiry follow-up at `d5b9d938` passed 44
protected tests and 11 additional probes, including dangling symlink refusal,
failed-start cleanup, normal-exit lease release and actual FILEv2 composition.
These source-level results do not establish deployment, real provider quality,
production migration, latency improvements, or the final conversation integration.
The release receipt must identify that combined candidate separately.

## راهنمای فارسی

این مرحله بخش حافظهٔ خصوصی محلی را نمایه‌سازی می‌کند. قالب پیش‌فرض `file` است؛
انتخاب `sqlite-v1` یا `file-v2` فقط مخزن ازپیش‌آماده‌شده را باز می‌کند و مهاجرت،
تعمیر یا فعال‌سازی رضایت اختیاری انجام نمی‌دهد. این قالب‌ها برای اجرای پایدار محلی
با یک فرایند هستند؛ پیکربندی توزیع‌شده یا سرورلس پذیرفته نمی‌شود.

بازیابی خصوصی حداکثر ۶۴ نامزد و ۱۲۸ کیبی‌بایت متن نامزد می‌خواند؛ متن نهایی همچنان
حداکثر ۱۲ مورد و ۸۱۹۲ بایت است. بررسی خالص مجوز، بدنهٔ حافظهٔ خصوصی را بارگذاری
نمی‌کند. اصلاح، حذف، پس‌گرفتن رضایت یا تغییر نسل مخزن، رسیدهای قبلی را نامعتبر
می‌کند و عقب‌رفتن ساعت مجوز منقضی‌شده را زنده نمی‌کند. حافظهٔ مشترک و نوشتن حساب
هنوز مسیر تجمیعی دارند؛ بهبود کیفیت معنایی یا سرعت واقعی از این آزمون‌ها نتیجه
گرفته نمی‌شود. صدا یا سبک نوشتن مدرک هویت یا مجوز اشتراک نیست.

پیش از مهاجرت، همهٔ نویسنده‌ها را واقعاً متوقف و نسخه، ظرفیت، پشتیبان و نگهداری
باقیمانده‌ها را بررسی کنید. گزینهٔ `--quiesced` فقط اعلام اپراتور است. مسیر مطلق
واقعی بدهید؛ پیوند نمادین و مهاجرت نیمه‌کاره باعث توقف می‌شود. پس از مهاجرت فقط
نشانگر آماده با هویت مورد انتظار را انتخاب کنید؛ قابلیت‌های اختیاری جداگانه کنترل
می‌شوند. برای برگشت، حالت جاری SQLite را با دستور `rollback` به FILEv2 جدید تبدیل
کنید. هرگز آرشیو قدیمی را روی رضایت، اصلاح یا حذف جاری بازنویسی نکنید.

در قطع عملیات، طبق جدول بالا فقط عملیات صریح با شناسه و اثرانگشت دقیق اجرا شود.
قفل فرایند زنده یا نامعلوم حذف نمی‌شود. آرشیو و هدف نیمه‌کاره محفوظ می‌مانند و به
سیاست نگهداری نیاز دارند؛ حذف فایل تضمین پاک‌شدن از SSD یا پشتیبان نیست. آزمون‌های
مصنوعی و ساخت موفق، جای مهاجرت واقعی، تأیید حریم خصوصی، کیفیت ارائه‌دهنده و آزمایش
دستگاه را نمی‌گیرند.
