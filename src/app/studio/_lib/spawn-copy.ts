import { formatNumber, type Locale } from './i18n';

/**
 * Copy for the Spawn wizard (boards spawn-1…3, hire) and its Say-hi sheet. `en` defines the shape.
 * Brief chips and voice filters send English values to the server; only their labels translate here.
 */
const n = (v: number) => formatNumber(v, 'fa');
const s = (v: number) => (v === 1 ? '' : 's');

export type SpawnPresentation = 'feminine' | 'masculine' | 'neutral';
export type PersonaSection = 'role' | 'tagline' | 'backstory' | 'personality' | 'communicationStyle' | 'values' | 'wontDo';

const en = {
  // wizard
  discardBriefTitle: 'Discard this brief?', discard: 'Discard', discardBriefBody: 'What you wrote here won’t be kept.',
  discardDraft: 'Discard draft', discardTitle: (name: string) => `Discard ${name}?`,
  discardBody: (name: string) => `${name}’s persona, look and voice are deleted. This can’t be undone.`,
  slow: 'Taking longer than usual · almost there',
  // brief
  brief: {
    successorTitle: 'Who takes over?', title: 'Who do you need?',
    successorSub: 'Claude drafts someone new. The retired agent’s memories stay with the team.', sub: 'Everything is optional. Claude fills the gaps.',
    role: 'The role, in your words', rolePlaceholder: 'A calm product lead who asks sharp questions and remembers every decision',
    presentsAs: 'Presents as', presentations: { feminine: 'Feminine', masculine: 'Masculine', neutral: 'Neutral' } as Record<SpawnPresentation, string>,
    age: 'Age', ages: { '20s': '20s', '30s': '30s', '40s': '40s', '50s+': '50s+' } as Record<string, string>,
    culture: 'Nationality & culture', culturePlaceholder: 'Iranian, studied in Berlin',
    languages: 'Languages', languageNames: {} as Record<string, string>,
    domain: 'Domain', domains: {} as Record<string, string>,
    accent: 'Accent', accentHint: 'ElevenLabs designs a voice to match; real accents work best.', accentPlaceholder: 'Soft Tehrani English',
    personality: 'Personality', warm: 'Warm', direct: 'Direct', playful: 'Playful', serious: 'Serious', concise: 'Concise', expansive: 'Expansive',
    range: (left: string, right: string) => `${left} to ${right}`,
    surprise: 'Surprise me', draft: 'Draft with Claude',
  },
  // drafting
  drafting: {
    labels: ['Reading your brief…', 'Finding a name…', 'Writing a backstory…', 'Choosing values…', 'Imagining how they look…'],
    newAgent: 'Your new agent', drafting: 'Drafting', title: 'Claude is imagining them…',
    body: 'Name, backstory, values, languages and a cloud of their own. Detailed profiles may take a little longer.',
    ready: 'Draft ready', stop: 'Stop',
  },
  // persona
  persona: {
    sections: {
      role: 'Role', tagline: 'In one line', backstory: 'Backstory', personality: 'Personality',
      communicationStyle: 'How they talk', values: 'Values', wontDo: 'Won’t do',
    } as Record<PersonaSection, string>,
    saveNext: 'Save & next', nextLook: 'Next · look', useName: (name: string) => `Use ${name} · choose a voice`,
    suggests: 'Claude suggests · pick a name', persona: (name: string) => `${name}’s persona`,
    name: 'Name', editName: 'Edit name',
    updated: (count: number) => `Claude updated ${count} line${s(count)}`, undo: 'Undo',
    tapToEdit: 'Tap any section to edit it yourself', readOnly: (name: string) => `${name} is read-only for you`,
    tryChat: 'Try a chat', askPlaceholder: (name: string) => `Ask Claude: make ${name} more playful…`,
    askLabel: 'Ask Claude to change', sendToClaude: 'Send to Claude',
    onePerLine: ' · one per line', cancel: 'Cancel', save: 'Save',
  },
  // voice
  voice: {
    title: (name: string) => `${name}’s voice`,
    off: (name: string) => `Voices aren’t switched on for this workspace yet. ${name} will reply in text; you can still talk in Telegram.`,
    nextLook: 'Next · look', same: (org: string) => `Same voice for everyone in ${org}. Fixed once hired.`,
    details: 'Voice details', shortcuts: 'Language shortcuts',
    languages: { en: 'English', fa: 'Persian', vi: 'Vietnamese' } as Record<string, string>,
    languageNames: { en: 'English', fa: 'Persian (فارسی)', vi: 'Vietnamese (Tiếng Việt)' } as Record<string, string>,
    hearSample: (language: string) => `Hear a sample in ${language}`, sample: 'Sample',
    source: 'Voice source', builtIn: 'Built-in', design: 'Design', library: 'Library',
    retryOptions: 'Retry voice options', optionsError: (reason: string) => `Can’t load voice options: ${reason}`,
    builtInVoices: 'Built-in voices', loadingVoices: 'Loading voices', noBuiltIn: 'No built-in voices are available right now.',
    everyLanguage: 'Speaks every supported language',
    play: (name: string) => `Play ${name}`, choose: (name: string) => `Choose ${name}`,
    designVoice: 'Design a voice', briefOver: 'Voice brief from Claude · editable', describe: 'Describe the voice', briefPlaceholder: 'Accent, age, pace, warmth',
    designing: ['Reading the voice brief…', 'Designing three takes…', 'Rendering previews…', 'Almost there…'],
    designThree: 'Design 3 voices', designMore: 'Design 3 more',
    take: (letter: string) => `Take ${letter}`, playTake: (letter: string) => `Play take ${letter}`, chooseTake: (letter: string) => `Choose take ${letter}`,
    voiceLibrary: 'Voice library', gender: 'Gender', genders: { female: 'Female', male: 'Male', neutral: 'Neutral' } as Record<string, string>,
    voiceLanguage: 'Voice language', anyLanguage: 'Any language',
    searchPlaceholder: 'calm, narrator, Persian accent…', searchVoices: 'Search voices', search: 'Search',
    libraryPlan: 'Library voices can’t be chosen on this workspace’s plan yet. Listen freely; built-in and designed voices work.', why: 'Why?',
    searching: 'Searching voices', noMatch: 'No voices match. Loosen a filter.',
    generated: 'Generated voice', nativeLanguage: 'Native language: ', language: 'Language: ', costs: (rate: number) => `Costs ${rate}× per message`,
    use: 'Use this voice', skip: 'Skip · text only',
    usesModel: (model: string) => `Voice messages use ${model}`, speechModels: 'Speech models',
    realtime: 'Real-time', quality: 'Quality', earlier: 'Earlier model', supported: (language: string) => `${language} supported`, inUse: 'In use',
    speaks: (model: string, language: string) => `${model} speaks ${language}. One voice can speak every supported language; accent and pronunciation vary.`,
    freePlan: 'This workspace uses ElevenLabs’ free plan. Library voices need a paid plan for API use; built-in voices work, and a library voice already chosen stays.',
    unchecked: 'The ElevenLabs subscription couldn’t be checked, so library voices can’t be chosen until it can.',
  },
  // look
  look: {
    look: (name: string) => `${name}’s look`, character: 'Character', photo: 'Photo',
    shape: (name: string) => `Shape ${name}’s character`, done: 'Done', next: (name: string) => `Next · hire ${name}`,
  },
  // hire
  hire: {
    confirm: 'Confirm in Telegram', hire: (name: string) => `Hire ${name}`,
    awaiting: (name: string) => `Telegram opened a “Create bot” screen. The name is filled in where supported; if it’s blank, enter ${name}. Confirm the username and tap Create. Vox then applies the chosen name and photo — this page updates when they’re ready.`,
    body: (name: string, org: string) => `${name} becomes a real Telegram bot. It starts private (you, people you pick, and admins); you can open it to ${org} or make it public later.`,
    statusError: (reason: string) => `Can’t check the bot’s status: ${reason}`,
    waiting: ['Waiting for Telegram…', 'Tap Create in Telegram, then come back'],
    hiring: 'What you’re hiring', lookPhoto: 'Look & photo', portrait: 'Portrait', character: 'Character',
    voice: 'Voice', textOnly: 'Text only', locks: 'Personality locks', locksValue: '7 days after hire',
    preview: 'How it looks in Telegram', botSub: 'bot · username is picked in Telegram',
    tryChat: 'Try a chat first', openAgain: 'Open Telegram again',
    hired: (name: string) => `${name} is hired`, created: (name: string) => `${name}’s bot is created`,
    newborn: (name: string) => `${name} starts as a newborn and grows over 7 days. `,
    live: (username: string) => `Live as @${username}. For the next 7 days the personality can still be tuned; after that it’s locked for good.`,
    profile: 'Telegram profile', bot: 'Telegram bot', message: 'Message', open: 'Open',
  },
  // say hi
  sayHi: {
    title: (name: string) => `Say hi to ${name}`, placeholder: (name: string) => `Message ${name}`, message: 'Message', send: 'Send',
    sandbox: 'Sandbox: nothing here becomes a memory.', chatWith: (name: string) => `Chat with ${name}`,
    starters: ['Introduce yourself', 'What would you never do?', 'How do you handle disagreement?'],
    notSent: 'Not sent · Retry', typing: (name: string) => `${name} is typing`,
  },
};

export type SpawnCopy = typeof en;

export const spawnCopy: Record<Locale, SpawnCopy> = {
  en,
  fa: {
    discardBriefTitle: 'این شرح کنار گذاشته شود؟', discard: 'کنار گذاشتن', discardBriefBody: 'آنچه اینجا نوشتید نگه داشته نمی‌شود.',
    discardDraft: 'حذف پیش‌نویس', discardTitle: (name) => `${name} حذف شود؟`,
    discardBody: (name) => `شخصیت، ظاهر و صدای ${name} حذف می‌شود. این کار برگشت‌پذیر نیست.`,
    slow: 'کمی بیشتر از معمول طول می‌کشد · تقریباً تمام است',
    brief: {
      successorTitle: 'چه کسی جایگزین می‌شود؟', title: 'به چه کسی نیاز دارید؟',
      successorSub: 'Claude کسی تازه را پیش‌نویس می‌کند. حافظه‌های عامل بازنشسته نزد تیم می‌ماند.', sub: 'همه‌چیز اختیاری است. Claude جاهای خالی را پر می‌کند.',
      role: 'نقش، به زبان خودتان', rolePlaceholder: 'یک مدیر محصول آرام که پرسش‌های دقیق می‌پرسد و هر تصمیمی را به خاطر می‌سپارد',
      presentsAs: 'جنسیت ظاهری', presentations: { feminine: 'زنانه', masculine: 'مردانه', neutral: 'خنثی' },
      age: 'سن', ages: { '20s': 'دههٔ ۲۰', '30s': 'دههٔ ۳۰', '40s': 'دههٔ ۴۰', '50s+': '۵۰ به بالا' },
      culture: 'ملیت و فرهنگ', culturePlaceholder: 'ایرانی، درس‌خوانده در برلین',
      languages: 'زبان‌ها',
      languageNames: {
        English: 'انگلیسی', Persian: 'فارسی', Vietnamese: 'ویتنامی', Arabic: 'عربی', Turkish: 'ترکی', French: 'فرانسوی', German: 'آلمانی', Spanish: 'اسپانیایی',
      },
      domain: 'حوزه',
      domains: {
        Product: 'محصول', Engineering: 'مهندسی', Design: 'طراحی', Marketing: 'بازاریابی', Sales: 'فروش',
        Finance: 'مالی', People: 'منابع انسانی', Research: 'پژوهش', Legal: 'حقوقی', Support: 'پشتیبانی',
      },
      accent: 'لهجه', accentHint: 'ElevenLabs صدایی متناسب طراحی می‌کند؛ لهجه‌های واقعی بهترین نتیجه را می‌دهند.', accentPlaceholder: 'انگلیسی با لهجهٔ نرم تهرانی',
      personality: 'شخصیت', warm: 'گرم', direct: 'رک', playful: 'شوخ', serious: 'جدی', concise: 'موجز', expansive: 'مفصل',
      range: (left, right) => `${left} تا ${right}`,
      surprise: 'غافلگیرم کن', draft: 'پیش‌نویس با Claude',
    },
    drafting: {
      labels: ['خواندن شرح شما…', 'یافتن یک نام…', 'نوشتن پیشینه…', 'انتخاب ارزش‌ها…', 'تصور ظاهرش…'],
      newAgent: 'عامل تازهٔ شما', drafting: 'در حال پیش‌نویس', title: 'Claude در حال تصور اوست…',
      body: 'نام، پیشینه، ارزش‌ها، زبان‌ها و ابری از آنِ خودش. نمایه‌های مفصل ممکن است کمی بیشتر طول بکشند.',
      ready: 'پیش‌نویس آماده است', stop: 'توقف',
    },
    persona: {
      sections: {
        role: 'نقش', tagline: 'در یک جمله', backstory: 'پیشینه', personality: 'شخصیت',
        communicationStyle: 'شیوهٔ حرف زدن', values: 'ارزش‌ها', wontDo: 'کارهایی که نمی‌کند',
      },
      saveNext: 'ذخیره و بعدی', nextLook: 'بعدی · ظاهر', useName: (name) => `تأیید ${name} · انتخاب صدا`,
      suggests: 'پیشنهاد Claude · یک نام انتخاب کنید', persona: (name) => `شخصیت ${name}`,
      name: 'نام', editName: 'ویرایش نام',
      updated: (count) => `Claude ${n(count)} خط را به‌روز کرد`, undo: 'بازگردانی',
      tapToEdit: 'روی هر بخش بزنید تا خودتان ویرایشش کنید', readOnly: (name) => `${name} برای شما فقط‌خواندنی است`,
      tryChat: 'یک گفتگو امتحان کنید', askPlaceholder: (name) => `از Claude بخواهید: ${name} را شوخ‌تر کن…`,
      askLabel: 'درخواست تغییر از Claude', sendToClaude: 'ارسال به Claude',
      onePerLine: ' · هر مورد در یک خط', cancel: 'انصراف', save: 'ذخیره',
    },
    voice: {
      title: (name) => `صدای ${name}`,
      off: (name) => `صداها هنوز برای این فضای کاری روشن نشده‌اند. ${name} با متن پاسخ می‌دهد؛ همچنان می‌توانید در تلگرام صحبت کنید.`,
      nextLook: 'بعدی · ظاهر', same: (org) => `صدای یکسان برای همهٔ اعضای ${org}. پس از استخدام ثابت می‌شود.`,
      details: 'جزئیات صدا', shortcuts: 'میان‌برهای زبان',
      languages: { en: 'انگلیسی', fa: 'فارسی', vi: 'ویتنامی' },
      languageNames: { en: 'انگلیسی', fa: 'فارسی', vi: 'ویتنامی (Tiếng Việt)' },
      hearSample: (language) => `شنیدن نمونه به ${language}`, sample: 'نمونه',
      source: 'منبع صدا', builtIn: 'آماده', design: 'طراحی', library: 'کتابخانه',
      retryOptions: 'تلاش دوباره برای گزینه‌های صدا', optionsError: (reason) => `گزینه‌های صدا بارگذاری نشد: ${reason}`,
      builtInVoices: 'صداهای آماده', loadingVoices: 'در حال بارگذاری صداها', noBuiltIn: 'اکنون صدای آماده‌ای در دسترس نیست.',
      everyLanguage: 'به همهٔ زبان‌های پشتیبانی‌شده صحبت می‌کند',
      play: (name) => `پخش ${name}`, choose: (name) => `انتخاب ${name}`,
      designVoice: 'طراحی صدا', briefOver: 'شرح صدا از Claude · قابل ویرایش', describe: 'صدا را توصیف کنید', briefPlaceholder: 'لهجه، سن، سرعت، گرمی',
      designing: ['خواندن شرح صدا…', 'طراحی سه نسخه…', 'ساخت پیش‌نمایش‌ها…', 'تقریباً تمام است…'],
      designThree: 'طراحی ۳ صدا', designMore: '۳ صدای دیگر',
      take: (letter) => `نسخهٔ ${letter}`, playTake: (letter) => `پخش نسخهٔ ${letter}`, chooseTake: (letter) => `انتخاب نسخهٔ ${letter}`,
      voiceLibrary: 'کتابخانهٔ صدا', gender: 'جنسیت', genders: { female: 'زن', male: 'مرد', neutral: 'خنثی' },
      voiceLanguage: 'زبان صدا', anyLanguage: 'هر زبانی',
      searchPlaceholder: 'آرام، راوی، لهجهٔ فارسی…', searchVoices: 'جستجوی صداها', search: 'جستجو',
      libraryPlan: 'در طرح فعلی این فضای کاری هنوز نمی‌توان صدای کتابخانه را انتخاب کرد. آزادانه گوش دهید؛ صداهای آماده و طراحی‌شده کار می‌کنند.', why: 'چرا؟',
      searching: 'در حال جستجوی صداها', noMatch: 'صدایی پیدا نشد. یکی از فیلترها را بردارید.',
      generated: 'صدای ساخته‌شده', nativeLanguage: 'زبان مادری: ', language: 'زبان: ', costs: (rate) => `هزینه: ${n(rate)}× برای هر پیام`,
      use: 'استفاده از این صدا', skip: 'رد شدن · فقط متن',
      usesModel: (model) => `پیام‌های صوتی از ${model} استفاده می‌کنند`, speechModels: 'مدل‌های گفتار',
      realtime: 'هم‌زمان', quality: 'کیفیت بالا', earlier: 'مدل قدیمی‌تر', supported: (language) => `پشتیبانی از ${language}`, inUse: 'در حال استفاده',
      speaks: (model, language) => `${model} به ${language} صحبت می‌کند. یک صدا می‌تواند به همهٔ زبان‌های پشتیبانی‌شده صحبت کند؛ لهجه و تلفظ متفاوت است.`,
      freePlan: 'این فضای کاری از طرح رایگان ElevenLabs استفاده می‌کند. صداهای کتابخانه برای استفاده از API طرح پولی لازم دارند؛ صداهای آماده کار می‌کنند و صدای کتابخانه‌ای که قبلاً انتخاب شده می‌ماند.',
      unchecked: 'اشتراک ElevenLabs بررسی نشد؛ تا وقتی بررسی نشود، صداهای کتابخانه قابل انتخاب نیستند.',
    },
    look: {
      look: (name) => `ظاهر ${name}`, character: 'کاراکتر', photo: 'عکس',
      shape: (name) => `کاراکتر ${name} را شکل دهید`, done: 'تمام', next: (name) => `بعدی · استخدام ${name}`,
    },
    hire: {
      confirm: 'تأیید در تلگرام', hire: (name) => `استخدام ${name}`,
      awaiting: (name) => `تلگرام صفحهٔ «ساخت ربات» را باز کرد. نام هر جا ممکن باشد از پیش پر شده است؛ اگر خالی است، ${name} را وارد کنید. نام کاربری را تأیید کنید و Create را بزنید. سپس وکس نام و عکس انتخاب‌شده را اعمال می‌کند — این صفحه وقتی آماده شوند به‌روز می‌شود.`,
      body: (name, org) => `${name} یک ربات واقعی تلگرام می‌شود. ابتدا خصوصی است (شما، افرادی که انتخاب می‌کنید و مدیران)؛ بعداً می‌توانید آن را برای ${org} باز یا عمومی کنید.`,
      statusError: (reason) => `وضعیت ربات بررسی نشد: ${reason}`,
      waiting: ['در انتظار تلگرام…', 'در تلگرام Create را بزنید و برگردید'],
      hiring: 'آنچه استخدام می‌کنید', lookPhoto: 'ظاهر و عکس', portrait: 'پرتره', character: 'کاراکتر',
      voice: 'صدا', textOnly: 'فقط متن', locks: 'قفل شدن شخصیت', locksValue: '۷ روز پس از استخدام',
      preview: 'نمای آن در تلگرام', botSub: 'ربات · نام کاربری در تلگرام انتخاب می‌شود',
      tryChat: 'اول یک گفتگو امتحان کنید', openAgain: 'باز کردن دوبارهٔ تلگرام',
      hired: (name) => `${name} استخدام شد`, created: (name) => `ربات ${name} ساخته شد`,
      newborn: (name) => `${name} نوزاد شروع می‌کند و در ۷ روز رشد می‌کند. `,
      live: (username) => `با نام ‎@${username} فعال است. تا ۷ روز آینده هنوز می‌توان شخصیت را تنظیم کرد؛ پس از آن برای همیشه قفل می‌شود.`,
      profile: 'نمایهٔ تلگرام', bot: 'ربات تلگرام', message: 'پیام', open: 'باز کردن',
    },
    sayHi: {
      title: (name) => `به ${name} سلام کنید`, placeholder: (name) => `پیام به ${name}`, message: 'پیام', send: 'ارسال',
      sandbox: 'محیط آزمایشی: هیچ‌چیز اینجا به حافظه تبدیل نمی‌شود.', chatWith: (name) => `گفتگو با ${name}`,
      starters: ['خودت را معرفی کن', 'چه کاری را هرگز انجام نمی‌دهی؟', 'با اختلاف نظر چطور کنار می‌آیی؟'],
      notSent: 'ارسال نشد · تلاش دوباره', typing: (name) => `${name} در حال نوشتن است`,
    },
  },
};

/** A chip's label in the reader's language; unknown values show as written. */
export const labelOf = (labels: Record<string, string>, value: string) => labels[value] ?? value;
