import type { McpNeed, ProviderNeed, ProviderSetupState } from '@/lib/connections/application';
import type { HistoryRow } from '@/lib/studio/history';
import { formatNumber, type Locale } from './i18n';

/**
 * Copy for Settings v2 Part 2: the Connectors & plugins page, the manager's Connectors people use and Change
 * history pages. `en` defines the shape; Persian uses Persian digits. Words for each missing piece name what
 * is missing without naming a secret, a config path or an account.
 */
const fa = (v: number) => formatNumber(v, 'fa');

const en = {
  title: 'Connectors & plugins',
  connected: 'Connected',
  add: 'Add',
  plugins: 'Plugins (MCP servers)',
  readOnly: 'Read only · asks before each use',
  mcpSub: 'Your own server · asks before each use',
  onFor: (hours: number) => `On · ${hours}h`,
  ended: 'Access ended',
  noAccessYet: 'No access yet',
  allow: 'Allow access',
  renew: 'Renew',
  ask: (name: string) => `Ask ${name}`,
  details: 'Details',
  connect: 'Connect',
  waiting: 'Waiting for sign-in',
  finish: 'Finish',
  voxSets: 'Vox sets this up',
  personalOnly: 'Personal space only',
  how: { sign_in: 'Sign in with your own account', vox_adds: 'Vox adds it for your account', runner: 'Runs on a Vox worker' } as Record<ProviderSetupState['how'], string>,
  needs: {
    connections_off: 'Connections are switched off by Vox.',
    service_off: 'The Vox connection service isn’t running.',
    not_set_up_for_you: 'Vox hasn’t set this up for your account and this agent yet.',
    personal_only: 'Available in your Personal space only.',
    answers_off: 'Answers from connected apps are waiting for AI processing approval.',
    vox_enrolls: 'A Vox admin connects this for your account. It can’t be connected from here yet.',
    mcp_off: 'Custom MCP servers are turned off by Vox.',
    main_app_off: 'This Vox server can’t add MCP servers from the app yet.',
  } as Record<ProviderNeed | McpNeed, string>,
  askVox: 'Ask a Vox admin to set it up.',
  emptyConnected: (name: string) => `No apps connected to ${name} yet.`,
  emptyPlugins: 'No MCP servers yet.',
  addMcp: 'Add MCP server',
  mcpUrl: 'Server URL',
  mcpName: 'Name',
  mcpHint: (name: string) => `A public HTTPS server that supports MCP sign-in. You review its tools before ${name} can use them.`,
  continue: 'Continue',
  reviewServer: 'Review this server',
  reviewServerNote: 'Tool descriptions come from the server itself. Every call needs your exact review.',
  acceptServer: (name: string) => `Connect this server to ${name}. I choose tool access next.`,
  connectServer: 'Connect reviewed server',
  checkSignIn: 'Check sign-in',
  cancel: 'Cancel',
  mcpError: {
    mcp_url_unsupported: 'Use a public HTTPS MCP URL without a query or fragment.',
    mcp_setup_unavailable: 'Custom MCP servers aren’t available right now.',
    mcp_token_verification_unsupported: 'This server uses tokens Vox can’t verify yet. It needs signed access tokens for this exact server.',
    mcp_client_registration_unsupported: 'This server’s sign-in method isn’t supported yet.',
    mcp_review_unavailable: 'Finish sign-in in the browser, then check again.',
    connection_exists: 'This server is already connected to this agent.',
    agent_unavailable: 'This agent isn’t available for your account.',
    agent_connection_mismatch: 'This agent isn’t available for your account.',
    connection_authority_transport_unavailable: 'Vox couldn’t confirm this just now. Try again in a moment.',
    profile_confirmation_required: 'Confirm your profile in You before connecting a server.',
  } as Record<string, string>,
  foot: (name: string) => `${name} asks you before every action in a connected app. Access ends on its own after the time you pick.`,
  where: (name: string) => `Ask ${name} with a connected app here; answers stay here in Vox. Its Telegram chat, ordinary replies and calls don’t use connected apps.`,
  renewFailed: (app: string) => `${app}: the old access ended, but the new access wasn’t saved.`,
  renewRetry: 'Try again',
  /* manager pages */
  usageTitle: 'Connectors people use',
  people: (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`,
  usageNone: (name: string) => `No app is connected to ${name} by enough people to show yet.`,
  usageChosen: (name: string) => `Counts show only when ${name} is open to your whole company or to everyone. While you choose who may use it, a count could point to one of them.`,
  usageFoot: 'Counts only, not including you. An app shows once at least 3 people use it, so no one can be singled out. Each person’s accounts and data stay private to them.',
  usageUnavailable: 'Counts aren’t available right now.',
  usageRow: (label: string, people: number) => `${label} · ${people}`,
  customMcp: 'Custom MCP servers',
  historyTitle: 'Change history',
  historyEmpty: 'No changes recorded yet.',
  historyFoot: 'Who changed what, by role. Very old changes may not be listed.',
  /** Who, as a label that starts a line (Change history: `<who> · <when>`). */
  actor: { you: 'You', creator: 'Its creator', admin: 'An admin', member: 'A member', agent: 'The agent', vox: 'Vox' } as Record<HistoryRow['actor'], string>,
  action: (row: HistoryRow): string => {
    const d = row.detail;
    switch (row.action) {
      case 'draft': return 'Created as a draft';
      case 'hired': return 'Started working';
      case 'token': return 'Telegram bot changed';
      case 'skills': return d ? `Skills changed (${d})` : 'Skills changed';
      case 'voice': return 'Voice changed';
      case 'live-web': return d === 'off' ? 'Live web turned off' : 'Live web turned on';
      case 'main-mini-app': return d === 'off' ? 'Main Mini App turned off' : 'Main Mini App turned on';
      case 'group-behavior': return 'Group behaviour changed';
      case 'visibility': return d === 'public' ? 'Who can find it → Public' : d === 'private' ? 'Who can find it → Private' : d === 'org' ? 'Who can find it → Team' : 'Who can find it changed';
      case 'access': return d === 'everyone' ? 'Who can talk → Everyone' : d?.startsWith('people:') ? `Who can talk → ${d.slice(7)} ${d === 'people:1' ? 'person' : 'people'}` : 'Who can talk changed';
      case 'unblock': return 'Someone was unblocked';
      case 'admin-grant': return 'Made an admin agent';
      case 'admin-revoke': return 'Admin role removed';
      case 'fired': return 'Retired';
      case 'memory-inherit': return 'Memories carried over';
      case 'channel-post': return d === 'silent' ? 'Posted to a channel quietly' : 'Posted to a channel';
    }
  },
  openConnectors: 'Connectors',
};

export type ConnectorsCopy = typeof en;

export const connectorsCopy: Record<Locale, ConnectorsCopy> = {
  en,
  fa: {
    title: 'اتصال‌ها و افزونه‌ها',
    connected: 'متصل',
    add: 'افزودن',
    plugins: 'افزونه‌ها (سرورهای MCP)',
    readOnly: 'فقط خواندن · پیش از هر استفاده می‌پرسد',
    mcpSub: 'سرور خودتان · پیش از هر استفاده می‌پرسد',
    onFor: (hours) => `روشن · ${fa(hours)} ساعت`,
    ended: 'دسترسی تمام شد',
    noAccessYet: 'هنوز دسترسی ندارد',
    allow: 'اجازهٔ دسترسی',
    renew: 'تمدید',
    ask: (name) => `پرسیدن از ${name}`,
    details: 'جزئیات',
    connect: 'اتصال',
    waiting: 'در انتظار ورود',
    finish: 'تکمیل',
    voxSets: 'وکس راه‌اندازی می‌کند',
    personalOnly: 'فقط فضای شخصی',
    how: { sign_in: 'ورود با حساب خودتان', vox_adds: 'وکس آن را برای حساب شما اضافه می‌کند', runner: 'روی کارگزار وکس اجرا می‌شود' },
    needs: {
      connections_off: 'اتصال‌ها را وکس خاموش کرده است.',
      service_off: 'سرویس اتصال وکس در حال اجرا نیست.',
      not_set_up_for_you: 'وکس هنوز این را برای حساب شما و این عامل راه‌اندازی نکرده است.',
      personal_only: 'فقط در فضای شخصی شما در دسترس است.',
      answers_off: 'پاسخ‌ها از برنامه‌های متصل منتظر تأیید پردازش هوش مصنوعی هستند.',
      vox_enrolls: 'یک مدیر وکس این را برای حساب شما وصل می‌کند. هنوز نمی‌شود از این‌جا وصلش کرد.',
      mcp_off: 'سرورهای MCP سفارشی را وکس خاموش کرده است.',
      main_app_off: 'این سرور وکس هنوز نمی‌تواند از داخل برنامه سرور MCP اضافه کند.',
    },
    askVox: 'از یک مدیر وکس بخواهید آن را راه‌اندازی کند.',
    emptyConnected: (name) => `هنوز برنامه‌ای به ${name} وصل نشده است.`,
    emptyPlugins: 'هنوز سرور MCP ندارید.',
    addMcp: 'افزودن سرور MCP',
    mcpUrl: 'نشانی سرور',
    mcpName: 'نام',
    mcpHint: (name) => `یک سرور HTTPS عمومی که ورود MCP را پشتیبانی کند. پیش از آنکه ${name} از آن استفاده کند، ابزارهایش را بررسی می‌کنید.`,
    continue: 'ادامه',
    reviewServer: 'بررسی این سرور',
    reviewServerNote: 'توضیح ابزارها را خود سرور می‌دهد. هر فراخوانی به بررسی دقیق شما نیاز دارد.',
    acceptServer: (name) => `این سرور را به ${name} وصل کن. دسترسی ابزارها را بعداً انتخاب می‌کنم.`,
    connectServer: 'اتصال سرور بررسی‌شده',
    checkSignIn: 'بررسی ورود',
    cancel: 'لغو',
    mcpError: {
      mcp_url_unsupported: 'از نشانی HTTPS عمومی MCP بدون پرس‌وجو یا بخش # استفاده کنید.',
      mcp_setup_unavailable: 'سرورهای MCP سفارشی اکنون در دسترس نیستند.',
      mcp_token_verification_unsupported: 'این سرور از توکن‌هایی استفاده می‌کند که وکس هنوز نمی‌تواند تأیید کند. به توکن دسترسی امضاشده برای همین سرور نیاز دارد.',
      mcp_client_registration_unsupported: 'روش ورود این سرور هنوز پشتیبانی نمی‌شود.',
      mcp_review_unavailable: 'ورود را در مرورگر تمام کنید، سپس دوباره بررسی کنید.',
      connection_exists: 'این سرور از قبل به این عامل وصل است.',
      agent_unavailable: 'این عامل برای حساب شما در دسترس نیست.',
      agent_connection_mismatch: 'این عامل برای حساب شما در دسترس نیست.',
      connection_authority_transport_unavailable: 'وکس الان نتوانست این را تأیید کند. چند لحظهٔ دیگر دوباره امتحان کنید.',
      profile_confirmation_required: 'پیش از اتصال سرور، نمایهٔ خود را در بخش «شما» تأیید کنید.',
    },
    foot: (name) => `${name} پیش از هر کاری در برنامه‌های متصل از شما می‌پرسد. دسترسی پس از زمانی که انتخاب می‌کنید خودبه‌خود تمام می‌شود.`,
    where: (name) => `از ${name} با یک برنامهٔ متصل همین‌جا بپرسید؛ پاسخ‌ها همین‌جا در Vox می‌مانند. گفتگوی تلگرامش، پاسخ‌های معمولی و تماس‌هایش از برنامه‌های متصل استفاده نمی‌کنند.`,
    renewFailed: (app) => `${app}: دسترسی قبلی تمام شد، اما دسترسی تازه ذخیره نشد.`,
    renewRetry: 'تلاش دوباره',
    usageTitle: 'اتصال‌هایی که افراد به کار می‌برند',
    people: (n) => `${fa(n)} نفر`,
    usageNone: (name) => `هنوز هیچ برنامه‌ای را به اندازهٔ کافی نفر به ${name} وصل نکرده‌اند که نمایش داده شود.`,
    usageChosen: (name) => `شمارش فقط وقتی نشان داده می‌شود که ${name} برای همهٔ شرکت یا برای همه باز باشد. تا وقتی خودتان انتخاب می‌کنید چه کسانی از آن استفاده کنند، یک شمارش ممکن است به یکی از آن‌ها اشاره کند.`,
    usageFoot: 'فقط شمارش، بدون احتساب شما. هر برنامه وقتی نشان داده می‌شود که دست‌کم ۳ نفر از آن استفاده کنند تا هیچ‌کس شناسایی نشود. حساب‌ها و داده‌های هر فرد برای خودش خصوصی می‌ماند.',
    usageUnavailable: 'شمارش اکنون در دسترس نیست.',
    usageRow: (label, people) => `${label} · ${fa(people)}`,
    customMcp: 'سرورهای MCP سفارشی',
    historyTitle: 'تاریخچهٔ تغییرات',
    historyEmpty: 'هنوز تغییری ثبت نشده است.',
    historyFoot: 'چه کسی چه چیزی را تغییر داد، بر اساس نقش. تغییرات خیلی قدیمی ممکن است فهرست نشوند.',
    actor: { you: 'شما', creator: 'سازنده‌اش', admin: 'یک مدیر', member: 'یک عضو', agent: 'خود عامل', vox: 'وکس' },
    action: (row) => {
      const d = row.detail;
      switch (row.action) {
        case 'draft': return 'به‌صورت پیش‌نویس ساخته شد';
        case 'hired': return 'کارش را شروع کرد';
        case 'token': return 'ربات تلگرام تغییر کرد';
        case 'skills': return d ? `مهارت‌ها تغییر کرد (${fa(Number(d))})` : 'مهارت‌ها تغییر کرد';
        case 'voice': return 'صدا تغییر کرد';
        case 'live-web': return d === 'off' ? 'وب زنده خاموش شد' : 'وب زنده روشن شد';
        case 'main-mini-app': return d === 'off' ? 'مینی‌اپ اصلی خاموش شد' : 'مینی‌اپ اصلی روشن شد';
        case 'group-behavior': return 'رفتار در گروه تغییر کرد';
        case 'visibility': return d === 'public' ? 'چه کسی پیدایش می‌کند ← عمومی' : d === 'private' ? 'چه کسی پیدایش می‌کند ← خصوصی' : d === 'org' ? 'چه کسی پیدایش می‌کند ← تیم' : 'چه کسی پیدایش می‌کند تغییر کرد';
        case 'access': return d === 'everyone' ? 'چه کسی می‌تواند صحبت کند ← همه' : d?.startsWith('people:') ? `چه کسی می‌تواند صحبت کند ← ${fa(Number(d.slice(7)))} نفر` : 'چه کسی می‌تواند صحبت کند تغییر کرد';
        case 'unblock': return 'مسدودیت یک نفر برداشته شد';
        case 'admin-grant': return 'عامل مدیر شد';
        case 'admin-revoke': return 'نقش مدیر برداشته شد';
        case 'fired': return 'بازنشسته شد';
        case 'memory-inherit': return 'حافظه‌ها منتقل شد';
        case 'channel-post': return d === 'silent' ? 'بی‌صدا در کانال منتشر شد' : 'در کانال منتشر شد';
      }
    },
    openConnectors: 'اتصال‌ها',
  },
};
