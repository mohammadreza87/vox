# Private-note erasure / حذف یادداشت خصوصی

RF2 is a bounded implementation for VOX-014 and VOX-056. Independent source and compiled-app acceptance are pending. This document does not enable a production policy or report a deployed deletion.

## What the requester can do

In Privacy, a signed-in requester with an open erasure request can select one eligible, readable manual private note in the current Work or Personal space. A fresh server plan precedes explicit confirmation. The operation removes the selected note's current content and the bounded, canonical notes that depend on it through source references. It does not directly select extracted, reviewed or shared notes, switch accounts, or combine spaces.

The interface clears the private preview and plan when dispatching, changing context or unmounting. A lost response stays unconfirmed; manual refresh reads the current request status without retrying deletion. Status can be recovered after a fresh page load without saving a plan, command ID or private preview in the browser.

Current technical effect and receipt recording are separate. A confirmed removal can have a pending receipt; a historical receipt cannot prove the current effect. Missing or changed proof yields **unknown**, without implying that content returned or that deletion never happened.

The residual disclosure remains visible: shared, provider and backup copies are unverified. Other private data, relationship/learning copies, physical storage remnants and wider request fulfillment are outside the implemented proof. This action does not close the broader erasure request.

## Storage and authority

- Explicit reviewed policy version 3 and rights ledger version 4 are prerequisites. Missing policy or an unsupported ledger leaves the action unavailable. GET and POST do not silently convert storage.
- The selected account and space, request revision, source revision, policy, notice and execution window bind the plan. Current authority is checked again at the canonical commit boundary.
- The canonical mutation uses a dedicated existing-account transaction. It does not invoke broad expiry, relationship or learning cleanup. Selected active notes become tombstones; unrelated data, grants and consent remain unchanged.
- A metadata-only witness binds every member of the original bounded dependency closure. Fresh proof checks the exact command event, every witnessed tombstone/revision/source-reference commitment and any newly active dependent content. Missing or inconsistent evidence is unknown.
- Rights intent, canonical effect and acknowledgement use separate stores. They are not one atomic transaction. Reconciliation records an existing proved effect; it never executes a missing deletion.
- The qualified boundary is one supported persistent process with synchronous committed reads. Unsupported or busy authority fails closed; this is not a claim of distributed or OS-enforced isolation.
- Joint RF1/RF2 capacity checks reserve future completion fields within the existing 65,536-byte ledger limit. There are at most 32 RF2 operations. Retained operations prevent request purge; automatic metadata retirement is not implemented. Capacity can therefore become unavailable.

The conversion helper is an explicit, reviewed, quiesced preparation step; no production conversion command or retention durations are supplied here. Policy approval, finite retention/retirement design and operational qualification remain separate work.

## Acceptance still required

Independent checks must cover exact account/space boundaries, bounded dependency removal and unrelated-data preservation, authority changes during staging, intent/effect/receipt failures, replay and expired commands, witness drift after restart, joint capacity and unchanged RF1 behavior. Compiled synthetic EN/FA journeys must cover keyboard access, narrow RTL layouts, lost responses, fresh-page status and account/space changes. Local mocks do not establish physical-device, provider, production IAM, legal or backup-erasure behavior.

## فارسی

RF2 بخش محدودی از VOX-014 و VOX-056 است. پذیرش مستقل منبع و مسیر برنامهٔ کامپایل‌شده هنوز انجام نشده است. این سند سیاست تولید را فعال نمی‌کند و گزارش حذف مستقرشده نیست.

کاربر واردشده با درخواست حذفِ باز می‌تواند در بخش حریم خصوصی یک یادداشت خصوصیِ دستی و قابل‌خواندن را از فضای فعلی کاری یا شخصی انتخاب کند. سرور برنامهٔ تازه‌ای تهیه می‌کند و اجرا به تأیید صریح نیاز دارد. محتوای جاری همان یادداشت و یادداشت‌های اصلی وابسته به آن از طریق ارجاع منبع حذف می‌شود؛ انتخاب مستقیم یادداشت استخراج‌شده، بازبینی‌شده یا مشترک، تغییر حساب و ترکیب فضاها مجاز نیست.

پیش‌نمایش خصوصی و برنامه هنگام ارسال، تغییر زمینه یا خروج از بخش پاک می‌شوند. پاسخ ازدست‌رفته به معنی موفقیت نیست؛ تازه‌سازی دستی فقط وضعیت فعلی را می‌خواند و حذف را تکرار نمی‌کند. پس از باز کردن دوبارهٔ صفحه نیز وضعیت بدون نگهداری برنامه، شناسهٔ فرمان یا پیش‌نمایش خصوصی در مرورگر بازیابی می‌شود.

اثر فنی فعلی و ثبت رسید جدا هستند. ممکن است حذف تأیید شود ولی ثبت رسید هنوز در انتظار باشد. رسید تاریخی به‌تنهایی اثر فعلی را ثابت نمی‌کند. اگر مدرک از بین برود یا تغییر کند، وضعیت «نامعلوم» است؛ این وضعیت به معنی بازگشت محتوا یا اجرا نشدن حذف در گذشته نیست.

هشدار باقی‌مانده همیشه دیده می‌شود: حذف نسخه‌های مشترک، ارائه‌دهندگان و پشتیبان‌ها تأیید نشده است. سایر داده‌های خصوصی، نسخه‌های ارتباطات یا یادگیری، بقایای فیزیکی ذخیره‌سازی و تکمیل درخواست گسترده‌تر در این اثبات پوشش داده نمی‌شوند. این اقدام درخواست گسترده‌تر حذف را نمی‌بندد.

سیاست بازبینی‌شدهٔ نسخهٔ ۳ و دفتر درخواست‌های نسخهٔ ۴ لازم هستند؛ نبود سیاست یا نسخهٔ پشتیبانی‌نشده، اقدام را غیرفعال نگه می‌دارد. خواندن یا ارسال درخواست، تبدیل خودکار انجام نمی‌دهد. برنامه به حساب، فضا، نسخهٔ درخواست و یادداشت، سیاست، متن اطلاع‌رسانی و مهلت اجرا وابسته است؛ مجوز فعلی درست پیش از ثبت تغییر اصلی دوباره بررسی می‌شود.

تغییر اصلی از تراکنش اختصاصی حساب موجود استفاده می‌کند و پاک‌سازی گستردهٔ انقضا، ارتباطات یا یادگیری را اجرا نمی‌کند. داده‌های نامرتبط، مجوزها و رضایت بدون تغییر می‌مانند. شاهدی فقط شامل فراداده، تمام اعضای مجموعهٔ وابستهٔ اولیه را ثبت می‌کند. اثبات تازه به رویداد دقیق فرمان، نشان حذف و نسخه و تعهد ارجاع منبعِ هر عضو و نبود محتوای وابستهٔ فعالِ تازه نیاز دارد؛ کمبود یا ناسازگاری مدرک، وضعیت نامعلوم می‌دهد.

ثبت قصد، اثر اصلی و رسید در مخازن جدا انجام می‌شوند و یک تراکنش اتمی مشترک نیستند. تطبیق نتیجه فقط اثر موجودِ اثبات‌شده را ثبت می‌کند و حذف انجام‌نشده را اجرا نمی‌کند. مرز پشتیبانی‌شده، یک فرایند پایدار با خواندن همگام وضعیت ثبت‌شده است؛ وضعیت مشغول یا پشتیبانی‌نشده اجازهٔ اجرا نمی‌دهد. این مرز، جداسازی توزیع‌شده یا سیستم‌عاملی را اثبات نمی‌کند.

کنترل مشترک ظرفیت RF1/RF2، فضای تکمیل عملیات را در سقف قبلی ۶۵۵۳۶ بایت محفوظ می‌دارد. حداکثر ۳۲ عملیات RF2 مجاز است. عملیات نگهداری‌شده مانع حذف پروندهٔ درخواست می‌شوند؛ بازنشستگی خودکار فراداده پیاده‌سازی نشده و ظرفیت می‌تواند پر شود. تبدیل صریح به بازبینی و توقف نویسنده‌ها نیاز دارد؛ این سند فرمان تبدیل تولید یا مدت نگهداری تعیین نمی‌کند.

پذیرش مستقل باید مرز حساب و فضا، حذف وابستگی محدود و حفظ دادهٔ نامرتبط، تغییر مجوز هنگام آماده‌سازی، شکست بین مراحل، تکرار و انقضای فرمان، تغییر شاهد پس از راه‌اندازی مجدد، ظرفیت مشترک و حفظ رفتار RF1 را بررسی کند. مسیر ساختگی برنامهٔ کامپایل‌شده در EN/FA باید صفحه‌کلید، RTL باریک، پاسخ ازدست‌رفته، ورود دوباره و تغییر حساب یا فضا را پوشش دهد. آزمون محلی، رفتار دستگاه واقعی، ارائه‌دهنده، IAM تولید، صلاحیت حقوقی یا حذف پشتیبان را اثبات نمی‌کند.
