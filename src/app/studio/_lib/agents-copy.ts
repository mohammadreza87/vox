import type { GroupBehavior, Role } from './client';
import { formatNumber, type Locale } from './i18n';

/**
 * Copy for the agent screens (board agents-home, groups, org, agent-profile, add-to-groups, fire).
 * One table per screen family, `en` defines the shape; Persian uses Persian digits. Values sent to the
 * server (fire reasons) stay English keys: only their labels translate.
 */
const n = (v: number) => formatNumber(v, 'fa');
const s = (v: number) => (v === 1 ? '' : 's');

export type HomeFilter = 'All' | 'Mine' | 'Forming' | 'Drafts' | 'Retired';

const homeEn = {
  over: (org: string, agents: number, forming: number) => `${org} · ${agents} agent${s(agents)}${forming ? ` · ${forming} forming` : ''}`,
  title: 'Your agents',
  closeSearch: 'Close search', searchAgents: 'Search agents', you: 'You', openProfile: 'Open your profile', searchPlaceholder: 'Name or role',
  filterLabel: 'Filter agents',
  filters: { All: 'All', Mine: 'Mine', Forming: 'Forming', Drafts: 'Drafts', Retired: 'Retired' } as Record<HomeFilter, string>,
  loadError: 'Can’t load your agents', loading: 'Loading agents',
  noMatch: (q: string) => `No agent matches “${q}”`, noMatchBody: 'Try a name or a role.',
  emptyTitle: 'No agents yet', emptyBody: 'Spawn your first colleague. Claude drafts the persona, you shape it.',
  nothingIn: (filter: string) => `Nothing in ${filter}`,
  spawn: 'Spawn', admin: 'Admin',
  cardLabel: (name: string, role: string) => `${name}, ${role}`,
  grew: (name: string) => `${name} grew`,
  retired: 'Retired', draft: 'Draft', waitingTelegram: 'Waiting for Telegram', locked: 'LOCKED',
  forming: (day: number) => `Forming · day ${day}/7`,
  quickActions: 'Quick actions', quickActionsFor: (name: string) => `${name} quick actions`,
  call: (name: string) => `Call ${name}`, chatTelegram: 'Chat in Telegram', addToGroups: 'Add to groups',
  copied: 'Copied', copy: (bot: string) => `Copy @${bot}`,
};

export const homeCopy: Record<Locale, typeof homeEn> = {
  en: homeEn,
  fa: {
    over: (org, agents, forming) => `${org} · ${n(agents)} عامل${forming ? ` · ${n(forming)} در حال شکل‌گیری` : ''}`,
    title: 'عامل‌های شما',
    closeSearch: 'بستن جستجو', searchAgents: 'جستجوی عامل‌ها', you: 'شما', openProfile: 'باز کردن نمایهٔ شما', searchPlaceholder: 'نام یا نقش',
    filterLabel: 'فیلتر عامل‌ها',
    filters: { All: 'همه', Mine: 'مال من', Forming: 'در حال شکل‌گیری', Drafts: 'پیش‌نویس‌ها', Retired: 'بازنشسته‌ها' },
    loadError: 'عامل‌های شما بارگذاری نشد', loading: 'در حال بارگذاری عامل‌ها',
    noMatch: (q) => `هیچ عاملی با «${q}» پیدا نشد`, noMatchBody: 'نام یا نقش دیگری را امتحان کنید.',
    emptyTitle: 'هنوز عاملی ندارید', emptyBody: 'نخستین همکارتان را بسازید. Claude شخصیت را پیش‌نویس می‌کند و شما آن را شکل می‌دهید.',
    nothingIn: (filter) => `در «${filter}» چیزی نیست`,
    spawn: 'ساختن', admin: 'مدیر',
    cardLabel: (name, role) => `${name}، ${role}`,
    grew: (name) => `${name} رشد کرد`,
    retired: 'بازنشسته', draft: 'پیش‌نویس', waitingTelegram: 'در انتظار تلگرام', locked: 'قفل',
    forming: (day) => `در حال شکل‌گیری · روز ${n(day)} از ۷`,
    quickActions: 'کارهای سریع', quickActionsFor: (name) => `کارهای سریع ${name}`,
    call: (name) => `تماس با ${name}`, chatTelegram: 'گفتگو در تلگرام', addToGroups: 'افزودن به گروه‌ها',
    copied: 'کپی شد', copy: (bot) => `کپی ‎@${bot}`,
  },
};

const groupsEn = {
  over: (count: number) => (count ? `Telegram · ${count} group${s(count)}` : 'Telegram'),
  title: 'Groups', group: 'Group',
  loadError: 'Can’t load your groups', loading: 'Loading groups',
  emptyTitle: 'No groups yet', emptyBody: 'Open an agent and tap Groups to add them to a Telegram chat.',
  foot: 'Add an agent from its page (Groups). In a group, agents only use memories made in that group.',
  sub: (members: number, agents: number, guests: boolean) => `${members} member${s(members)} · ${agents} agent${s(agents)}${guests ? ' · guests' : ''}`,
  agentsHere: 'Agents here', noAgentsHere: 'No agents here yet. Open an agent and tap Groups to add one.',
  guests: (org: string) => `People outside ${org} are here, so agents only use what was said in this group and keep everything else private.`,
};

export const groupsCopy: Record<Locale, typeof groupsEn> = {
  en: groupsEn,
  fa: {
    over: (count) => (count ? `تلگرام · ${n(count)} گروه` : 'تلگرام'),
    title: 'گروه‌ها', group: 'گروه',
    loadError: 'گروه‌های شما بارگذاری نشد', loading: 'در حال بارگذاری گروه‌ها',
    emptyTitle: 'هنوز گروهی ندارید', emptyBody: 'یک عامل را باز کنید و «گروه‌ها» را بزنید تا به یک گفتگوی تلگرام اضافه شود.',
    foot: 'عامل را از صفحهٔ خودش (گروه‌ها) اضافه کنید. در هر گروه، عامل‌ها فقط از حافظه‌های همان گروه استفاده می‌کنند.',
    sub: (members, agents, guests) => `${n(members)} عضو · ${n(agents)} عامل${guests ? ' · مهمان' : ''}`,
    agentsHere: 'عامل‌های این گروه', noAgentsHere: 'هنوز عاملی اینجا نیست. یک عامل را باز کنید و «گروه‌ها» را بزنید.',
    guests: (org) => `افرادی بیرون از ${org} در این گروه هستند؛ پس عامل‌ها فقط از گفته‌های همین گروه استفاده می‌کنند و بقیه را خصوصی نگه می‌دارند.`,
  },
};

const orgEn = {
  title: 'Org',
  roles: { owner: 'Owner', superadmin: 'Superadmin', admin: 'Admin', member: 'Member', pending: 'Waiting' } as Record<Role, string>,
  sections: { pending: 'Waiting for approval', owner: 'Owners', superadmin: 'Superadmins', admin: 'Admins', member: 'Members' } as Record<Role, string>,
  count: (title: string, count: number) => `${title} · ${count}`,
  removeTitle: (name: string) => `Remove ${name}’s access?`, removeAccess: 'Remove access',
  removeBody: (name: string, org: string) => `${name} can no longer talk to ${org}’s agents. You can approve them again later.`,
  rights: {
    owner: 'You can make owners, superadmins and admins — humans or agents.',
    superadmin: 'You can approve people and grant admin rights — to humans or agents.',
    admin: 'You can approve new people. Superadmins grant admin rights.',
    member: 'Everyone here can talk to every shared agent.',
  },
  loadError: 'Can’t load people', loading: 'Loading people', you: ' · you',
  approve: 'Approve', approveName: (name: string) => `Approve ${name}`, changeRoleOf: (name: string) => `Change ${name}'s role`,
  agentAdmins: 'Agent admins', noAgentAdmin: 'No agent is an admin yet.',
  noAgentAdminHow: ' Open an agent → ··· → Make admin. Agent admins can propose new agents.',
  aiAdmin: 'AI admin', changeRole: 'Change role',
  currently: (role: string) => `Currently ${role.toLowerCase()}`, make: (role: string) => `Make ${role.toLowerCase()}`,
};

export const orgCopy: Record<Locale, typeof orgEn> = {
  en: orgEn,
  fa: {
    title: 'سازمان',
    roles: { owner: 'مالک', superadmin: 'مدیر ارشد', admin: 'مدیر', member: 'عضو', pending: 'در انتظار' },
    sections: { pending: 'در انتظار تأیید', owner: 'مالکان', superadmin: 'مدیران ارشد', admin: 'مدیران', member: 'اعضا' },
    count: (title, count) => `${title} · ${n(count)}`,
    removeTitle: (name) => `دسترسی ${name} برداشته شود؟`, removeAccess: 'برداشتن دسترسی',
    removeBody: (name, org) => `${name} دیگر نمی‌تواند با عامل‌های ${org} صحبت کند. بعداً می‌توانید دوباره تأییدش کنید.`,
    rights: {
      owner: 'می‌توانید مالک، مدیر ارشد و مدیر تعیین کنید؛ چه انسان، چه عامل.',
      superadmin: 'می‌توانید افراد را تأیید کنید و به انسان‌ها یا عامل‌ها حق مدیریت بدهید.',
      admin: 'می‌توانید افراد تازه را تأیید کنید. حق مدیریت را مدیران ارشد می‌دهند.',
      member: 'همه در اینجا می‌توانند با هر عامل مشترک صحبت کنند.',
    },
    loadError: 'فهرست افراد بارگذاری نشد', loading: 'در حال بارگذاری افراد', you: ' · شما',
    approve: 'تأیید', approveName: (name) => `تأیید ${name}`, changeRoleOf: (name) => `تغییر نقش ${name}`,
    agentAdmins: 'عامل‌های مدیر', noAgentAdmin: 'هنوز هیچ عاملی مدیر نیست.',
    noAgentAdminHow: ' یک عامل را باز کنید ← ··· ← «مدیر کردن». عامل‌های مدیر می‌توانند عامل تازه پیشنهاد دهند.',
    aiAdmin: 'مدیر هوشمند', changeRole: 'تغییر نقش',
    currently: (role) => `نقش فعلی: ${role}`, make: (role) => `تعیین به‌عنوان ${role}`,
  },
};

const addGroupsEn = {
  title: 'Add to groups', sub: 'Groups you’re in · Telegram asks you to confirm',
  loading: 'Loading groups', loadError: 'Can’t load your groups', groups: 'Groups',
  notReadyTitle: (name: string) => `${name} isn’t in Telegram yet`,
  notReadyBody: (name: string) => `Hire ${name} first; then you can add them to groups.`,
  guestSub: (members: number, org: string) => `${members} members · guests outside ${org}`,
  waiting: 'Waiting for Telegram…', another: 'Another group…', choose: 'Choose a group in Telegram', opensPicker: 'Opens Telegram’s group picker',
  /** Around the bold group title */
  guestsBefore: 'In ', guestsAfter: (org: string, name: string) => ` there are people outside ${org}. ${name} will only use what was said in that group, never anyone’s private memories.`,
  notAdded: 'Not added yet. Telegram needs you to pick the group and confirm.',
  dockNote: 'Telegram asks you to confirm each group once.',
  done: (count: number) => `Done · added to ${count} group${s(count)}`,
  added: 'Added', inTelegram: 'In Telegram…', add: 'Add', addTo: (name: string, title: string) => `Add ${name} to ${title}`,
};

export const addGroupsCopy: Record<Locale, typeof addGroupsEn> = {
  en: addGroupsEn,
  fa: {
    title: 'افزودن به گروه‌ها', sub: 'گروه‌هایی که در آن‌ها هستید · تلگرام از شما تأیید می‌خواهد',
    loading: 'در حال بارگذاری گروه‌ها', loadError: 'گروه‌های شما بارگذاری نشد', groups: 'گروه‌ها',
    notReadyTitle: (name) => `${name} هنوز در تلگرام نیست`,
    notReadyBody: (name) => `اول ${name} را استخدام کنید؛ بعد می‌توانید به گروه‌ها اضافه‌اش کنید.`,
    guestSub: (members, org) => `${n(members)} عضو · مهمانانی بیرون از ${org}`,
    waiting: 'در انتظار تلگرام…', another: 'گروهی دیگر…', choose: 'انتخاب گروه در تلگرام', opensPicker: 'انتخابگر گروه تلگرام را باز می‌کند',
    guestsBefore: 'در ', guestsAfter: (org, name) => ` افرادی بیرون از ${org} هستند. ${name} فقط از گفته‌های همان گروه استفاده می‌کند، نه از حافظه‌های خصوصی کسی.`,
    notAdded: 'هنوز اضافه نشد. تلگرام لازم دارد گروه را انتخاب و تأیید کنید.',
    dockNote: 'تلگرام برای هر گروه یک بار تأیید می‌خواهد.',
    done: (count) => `تمام · به ${n(count)} گروه اضافه شد`,
    added: 'اضافه شد', inTelegram: 'در تلگرام…', add: 'افزودن', addTo: (name, title) => `افزودن ${name} به ${title}`,
  },
};

/** Circles S5: Add to channel (next to Add to group) and Agent > Channels, post-only. */
const channelsEn = {
  section: 'In these channels', title: 'Channels', sub: 'Post-only · nothing is read from the channel',
  addChannel: 'Add to a channel…', addChannelSub: 'Telegram asks you to pick a channel and allow posting',
  post: 'Post to channels', count: (c: number) => `${c} channel${s(c)}`,
  loading: 'Loading channels', loadError: 'Can’t load channels',
  none: (name: string) => `${name} isn’t in a channel yet.`,
  notPublic: (name: string) => `${name} posts to channels only while public.`,
  comments: { none: 'No comments group', added: 'Also in the comments group', unknown: 'Comments group: unknown', offer: 'Has a comments group' },
  needsRights: (name: string) => `Can’t post yet: in the channel’s admin settings, turn on Post messages for ${name}`,
  full: (name: string, max: number) => `${name} is in ${max} channels, the most it can post to. Remove it from one to add another.`,
  addComments: (name: string) => `Add ${name} to the comments group too`, addCommentsSub: 'Opens Telegram’s group picker; choose the channel’s comments group',
  brief: 'What should the post say?', briefHint: 'A brief or the exact text. Only this and the agent’s character are used: no memories, no notes.',
  write: 'Write post', writing: 'Writing…', preview: 'Preview', to: 'Post to', edit: 'Edit', done: 'Done editing',
  notify: 'Notify subscribers', notifySub: 'Off sends silently', postNow: 'Post', posting: 'Posting…', cancel: 'Cancel',
  posted: (title: string) => `Posted to ${title}`, meetNote: (name: string) => `Every post carries a “Meet ${name} 🐾” button to ${name}’s chat.`,
};

export const channelsCopy: Record<Locale, typeof channelsEn> = {
  en: channelsEn,
  fa: {
    section: 'در این کانال‌ها', title: 'کانال‌ها', sub: 'فقط ارسال · چیزی از کانال خوانده نمی‌شود',
    addChannel: 'افزودن به کانال…', addChannelSub: 'تلگرام از شما می‌خواهد کانالی انتخاب کنید و اجازه ارسال بدهید',
    post: 'ارسال به کانال‌ها', count: (c) => `${n(c)} کانال`,
    loading: 'در حال بارگذاری کانال‌ها', loadError: 'کانال‌ها بارگذاری نشد',
    none: (name) => `${name} هنوز در هیچ کانالی نیست.`,
    notPublic: (name) => `${name} فقط وقتی عمومی است در کانال‌ها پست می‌گذارد.`,
    comments: { none: 'بدون گروه نظرات', added: 'در گروه نظرات هم هست', unknown: 'گروه نظرات: نامعلوم', offer: 'گروه نظرات دارد' },
    needsRights: (name) => `هنوز نمی‌تواند پست بگذارد: در تنظیمات مدیران کانال، «ارسال پست» را برای ${name} روشن کنید`,
    full: (name, max) => `${name} در ${n(max)} کانال است، بیشترین تعدادی که می‌تواند در آن پست بگذارد. برای افزودن کانال دیگر، آن را از یکی بردارید.`,
    addComments: (name) => `${name} را به گروه نظرات هم اضافه کنید`, addCommentsSub: 'انتخابگر گروه تلگرام را باز می‌کند؛ گروه نظرات کانال را انتخاب کنید',
    brief: 'پست چه بگوید؟', briefHint: 'یک توضیح کوتاه یا متن دقیق. فقط همین و شخصیت عامل به کار می‌رود: نه حافظه، نه یادداشت.',
    write: 'نوشتن پست', writing: 'در حال نوشتن…', preview: 'پیش‌نمایش', to: 'ارسال به', edit: 'ویرایش', done: 'پایان ویرایش',
    notify: 'اعلان برای مشترکان', notifySub: 'خاموش یعنی ارسال بی‌صدا', postNow: 'ارسال', posting: 'در حال ارسال…', cancel: 'لغو',
    posted: (title) => `در ${title} ارسال شد`, meetNote: (name) => `هر پست دکمه «آشنایی با ${name} 🐾» را دارد که به گفتگو با ${name} می‌رود.`,
  },
};

type Participation = GroupBehavior['participation'];

const agentEn = {
  backTo: { home: 'Agents', groups: 'Groups', org: 'Org' } as Partial<Record<string, string>>,
  loading: 'Loading agent', manage: 'Manage',
  timeLeft: { moments: 'moments', days: (d: number, h: number) => `${d}d ${h}h`, hours: (h: number, m: number) => `${h}h ${m}m` },
  nowAdmin: (name: string) => `${name} is now an admin`, noLongerAdmin: (name: string) => `${name} is no longer an admin`,
  publicTitle: (name: string) => `Make ${name} public?`, makePublic: 'Make public',
  publicBody: (name: string, org: string) => `Anyone on Telegram can message ${name}. ${org}’s internal memories stay private.`,
  refused: (steps: string) => `Telegram refused: ${steps}. Try again in a minute.`, profileUpdated: 'Telegram profile updated',
  actions: { chat: 'Chat', call: 'Call', groups: 'Groups', memories: 'Memories' },
  retry: 'Retry', couldntRefresh: (name: string) => `Couldn’t refresh ${name}.`,
  formingDay: (day: number) => `Forming · day ${day} of 7`,
  /** Around the bold time left */
  editableBefore: 'Personality editable for ', editableAfter: '', refine: 'Refine',
  lockedForGood: (name: string) => `${name}’s personality is locked for good. `,
  lockedWayOut: (name: string) => `To change who ${name} is, an admin fires them and hires a successor.`,
  retired: (date: string) => `Retired ${date}.`, dateLocale: undefined as string | undefined,
  whoIs: (name: string) => `Who ${name} is`, playVoice: (name: string) => `Play ${name}’s voice`, pauseVoice: (name: string) => `Pause ${name}’s voice`,
  textOnly: 'Text only', moreAbout: (name: string) => `More about ${name}`,
  backstory: 'Backstory', howTheyTalk: 'How they talk', values: 'Values', expertise: 'Expertise', wontDo: 'Won’t do',
  inGroups: (count: number) => `In ${count} group${s(count)}`, hiredBy: (name: string) => `Hired by ${name}`,
  groupReplies: (label: string) => `Group replies · ${label}`, groupMemoryOff: 'Group memory off',
  callName: (name: string) => `Call ${name}`, hireSuccessor: 'Hire a successor',
  // hero
  poke: (name: string) => `Poke ${name}`, editLook: (name: string) => `Edit ${name}’s look`, adminAgent: 'Admin agent',
  grew: (name: string, stage: number) => `${name} grew · stage ${stage} of 4`,
  lockedLook: 'Personality is locked. Photo and look can still change.',
  // manage
  participation: {
    mentions: { label: 'Mentions only', description: 'Replies to mentions and direct replies.' },
    balanced: { label: 'Balanced', description: 'Joins when a useful contribution is clear.' },
    active: { label: 'Active', description: 'Joins relevant conversations more often.' },
  } as Record<Participation, { label: string; description: string }>,
  updating: 'Updating…', needsRetry: 'Needs a retry',
  manageName: (name: string) => `Manage ${name}`, whoCanTalk: (name: string) => `Who can talk to ${name}`,
  liveWeb: 'Live web search', liveWebSub: 'News, prices, weather and other live facts, with sources',
  mainMiniApp: 'Pet opens in groups', mainMiniAppSub: (link: string) => `Turn on after you set this bot’s Main Mini App in BotFather to its pet link: ${link}`,
  groupBehaviour: 'Group behaviour', noMemory: ' · no memory',
  lookPhoto: 'Look & Telegram photo', updateTelegram: 'Update Telegram name & photo', connections: 'Connections & my access',
  removeAdmin: 'Remove admin rights', makeAdmin: 'Make admin', superadmin: 'Superadmin',
  fireRehire: 'Fire & re-hire', fire: (name: string) => `Fire ${name}`,
  // group behaviour
  joinsGroups: (name: string) => `How ${name} joins group chats`, groupRepliesLabel: 'Group replies',
  modesFoot: 'All modes can follow messages Telegram delivers. These options change when replies are sent.',
  remember: 'Remember useful group facts',
  rememberSub: 'Useful group facts stay in that group. Private chats are not shared. Turning this off leaves recent context and existing memories in place.',
  privacyBefore: 'To follow ordinary group messages, disable Group Privacy in', privacyAfter: 'and remove/re-add the bot, or make it a group admin.',
  // visibility
  visibilityFoot: (name: string, org: string) => `Groups you add ${name} to are always open to everyone in them. People outside ${org} never see internal memories.`,
  peopleWho: (name: string) => `People who can talk to ${name}`, loadingPeople: 'Loading people', creator: 'Creator', admin: 'Admin',
  blockedBy: (name: string, count: number) => `Blocked by ${name} · ${count}`, telegramId: (id: number) => `Telegram ID ${id}`, unblock: 'Unblock',
  visibility: {
    private: { title: () => 'Private', body: (name: string) => `Only you, the people you pick, and admins can message ${name}.` },
    org: { title: (org: string) => `Everyone in ${org}`, body: (name: string, org: string) => `Any approved ${org} member can message ${name}.` },
    public: {
      title: () => 'Public',
      body: (name: string, org: string, openness?: number) => `Anyone on Telegram can message ${name}. ${name} decides in character how to treat strangers${openness !== undefined ? ` (openness ${openness}/100)` : ''}, and never shares ${org}'s internal memories.`,
    },
  },
  privateCount: (people: number) => `Private · ${people} people`,
  // look sheet
  look: (name: string) => `${name}’s look`, done: 'Done', character: 'Character', telegramPhoto: 'Telegram photo',
};

export type AgentCopy = typeof agentEn;

export const agentCopy: Record<Locale, AgentCopy> = {
  en: agentEn,
  fa: {
    backTo: { home: 'عامل‌ها', groups: 'گروه‌ها', org: 'سازمان' },
    loading: 'در حال بارگذاری عامل', manage: 'مدیریت',
    timeLeft: { moments: 'چند لحظه', days: (d, h) => `${n(d)} روز و ${n(h)} ساعت`, hours: (h, m) => `${n(h)} ساعت و ${n(m)} دقیقه` },
    nowAdmin: (name) => `${name} اکنون مدیر است`, noLongerAdmin: (name) => `${name} دیگر مدیر نیست`,
    publicTitle: (name) => `${name} عمومی شود؟`, makePublic: 'عمومی کردن',
    publicBody: (name, org) => `هر کسی در تلگرام می‌تواند به ${name} پیام دهد. حافظه‌های داخلی ${org} خصوصی می‌مانند.`,
    refused: (steps) => `تلگرام نپذیرفت: ${steps}. یک دقیقهٔ دیگر دوباره تلاش کنید.`, profileUpdated: 'نمایهٔ تلگرام به‌روز شد',
    actions: { chat: 'گفتگو', call: 'تماس', groups: 'گروه‌ها', memories: 'حافظه‌ها' },
    retry: 'تلاش دوباره', couldntRefresh: (name) => `${name} تازه‌سازی نشد.`,
    formingDay: (day) => `در حال شکل‌گیری · روز ${n(day)} از ۷`,
    editableBefore: 'شخصیت تا ', editableAfter: ' دیگر قابل ویرایش است', refine: 'اصلاح',
    lockedForGood: (name) => `شخصیت ${name} برای همیشه قفل شده است. `,
    lockedWayOut: (name) => `برای تغییر ${name}، یک مدیر او را اخراج می‌کند و جانشینی استخدام می‌کند.`,
    retired: (date) => `بازنشسته از ${date}.`, dateLocale: 'fa-IR',
    whoIs: (name) => `${name} کیست`, playVoice: (name) => `پخش صدای ${name}`, pauseVoice: (name) => `توقف صدای ${name}`,
    textOnly: 'فقط متن', moreAbout: (name) => `بیشتر دربارهٔ ${name}`,
    backstory: 'پیشینه', howTheyTalk: 'شیوهٔ حرف زدن', values: 'ارزش‌ها', expertise: 'تخصص', wontDo: 'کارهایی که نمی‌کند',
    inGroups: (count) => `در ${n(count)} گروه`, hiredBy: (name) => `استخدام‌شده توسط ${name}`,
    groupReplies: (label) => `پاسخ در گروه · ${label}`, groupMemoryOff: 'حافظهٔ گروه خاموش',
    callName: (name) => `تماس با ${name}`, hireSuccessor: 'استخدام جانشین',
    poke: (name) => `تلنگر به ${name}`, editLook: (name) => `ویرایش ظاهر ${name}`, adminAgent: 'عامل مدیر',
    grew: (name, stage) => `${name} رشد کرد · مرحلهٔ ${n(stage)} از ۴`,
    lockedLook: 'شخصیت قفل است. عکس و ظاهر هنوز قابل تغییرند.',
    participation: {
      mentions: { label: 'فقط با اشاره', description: 'به اشاره‌ها و پاسخ‌های مستقیم جواب می‌دهد.' },
      balanced: { label: 'متعادل', description: 'وقتی حرف مفیدی برای گفتن دارد وارد گفتگو می‌شود.' },
      active: { label: 'فعال', description: 'بیشتر در گفتگوهای مرتبط شرکت می‌کند.' },
    },
    updating: 'در حال به‌روزرسانی…', needsRetry: 'نیاز به تلاش دوباره',
    manageName: (name) => `مدیریت ${name}`, whoCanTalk: (name) => `چه کسانی با ${name} صحبت کنند`,
    liveWeb: 'جستجوی زندهٔ وب', liveWebSub: 'اخبار، قیمت‌ها، آب‌وهوا و دیگر واقعیت‌های لحظه‌ای، همراه با منبع',
    mainMiniApp: 'پت در گروه‌ها باز می‌شود', mainMiniAppSub: (link) => `وقتی Main Mini App این ربات را در BotFather روی پیوند پتش گذاشتید روشن کنید: ${link}`,
    groupBehaviour: 'رفتار در گروه', noMemory: ' · بدون حافظه',
    lookPhoto: 'ظاهر و عکس تلگرام', updateTelegram: 'به‌روزرسانی نام و عکس تلگرام', connections: 'اتصال‌ها و دسترسی من',
    removeAdmin: 'برداشتن حق مدیریت', makeAdmin: 'مدیر کردن', superadmin: 'مدیر ارشد',
    fireRehire: 'اخراج و استخدام دوباره', fire: (name) => `اخراج ${name}`,
    joinsGroups: (name) => `${name} چگونه در گفتگوهای گروهی شرکت می‌کند`, groupRepliesLabel: 'پاسخ در گروه',
    modesFoot: 'همهٔ حالت‌ها پیام‌هایی را که تلگرام می‌رساند دنبال می‌کنند. این گزینه‌ها فقط زمان پاسخ دادن را تغییر می‌دهند.',
    remember: 'به خاطر سپردن نکته‌های مفید گروه',
    rememberSub: 'نکته‌های مفید گروه در همان گروه می‌مانند. گفتگوهای خصوصی به اشتراک گذاشته نمی‌شوند. خاموش کردن این گزینه، زمینهٔ اخیر و حافظه‌های موجود را دست‌نخورده می‌گذارد.',
    privacyBefore: 'برای دنبال کردن پیام‌های عادی گروه، Group Privacy را در', privacyAfter: 'خاموش کنید و ربات را حذف و دوباره اضافه کنید، یا آن را مدیر گروه کنید.',
    visibilityFoot: (name, org) => `گروه‌هایی که ${name} را به آن‌ها اضافه می‌کنید همیشه برای همهٔ اعضایشان باز است. افراد بیرون از ${org} هرگز حافظه‌های داخلی را نمی‌بینند.`,
    peopleWho: (name) => `افرادی که می‌توانند با ${name} صحبت کنند`, loadingPeople: 'در حال بارگذاری افراد', creator: 'سازنده', admin: 'مدیر',
    blockedBy: (name, count) => `مسدودشده توسط ${name} · ${n(count)}`, telegramId: (id) => `شناسهٔ تلگرام ${id}`, unblock: 'رفع مسدودی',
    visibility: {
      private: { title: () => 'خصوصی', body: (name) => `فقط شما، افرادی که انتخاب می‌کنید و مدیران می‌توانند به ${name} پیام دهند.` },
      org: { title: (org) => `همهٔ اعضای ${org}`, body: (name, org) => `هر عضو تأییدشدهٔ ${org} می‌تواند به ${name} پیام دهد.` },
      public: {
        title: () => 'عمومی',
        body: (name, org, openness) => `هر کسی در تلگرام می‌تواند به ${name} پیام دهد. ${name} مطابق شخصیتش تصمیم می‌گیرد با غریبه‌ها چگونه رفتار کند${openness !== undefined ? ` (گشودگی ${n(openness)} از ۱۰۰)` : ''} و هرگز حافظه‌های داخلی ${org} را به اشتراک نمی‌گذارد.`,
      },
    },
    privateCount: (people) => `خصوصی · ${n(people)} نفر`,
    look: (name) => `ظاهر ${name}`, done: 'تمام', character: 'کاراکتر', telegramPhoto: 'عکس تلگرام',
  },
};

/** Fire reasons: the English key is what the server stores; each locale only labels it. */
export const FIRE_REASONS = ['Wrong personality', 'Role changed', 'Not needed anymore', 'Start fresh'] as const;
export type FirePolicy = 'transfer' | 'archive' | 'delete';

const fireEn = {
  reasons: Object.fromEntries(FIRE_REASONS.map((r) => [r, r])) as Record<(typeof FIRE_REASONS)[number], string>,
  policies: {
    transfer: { title: 'Pass memories on', body: 'A successor you hire next inherits what they know.' },
    archive: { title: 'Archive', body: 'Kept, but no agent uses them.' },
    delete: { title: 'Delete forever', body: 'Every memory is erased. This can’t be undone.' },
  } as Record<FirePolicy, { title: string; body: string }>,
  goodbye: (name: string) => `Goodbye, ${name}`,
  left: (name: string) => `${name} has left every group and stopped answering.`,
  after: { transfer: 'Their memories wait for a successor.', archive: 'Their memories are archived.', delete: 'Their memories are gone.' } as Record<FirePolicy, string>,
  hireSuccessor: 'Hire a successor', backToAgents: 'Back to agents',
  title: (name: string) => `Fire ${name}`, question: (name: string) => `Fire ${name}?`,
  permanent: 'A personality is permanent once formed. To change who they are, retire them and hire a new spawn.',
  why: 'Why', memories: 'Their memories', typeName: (name: string) => `Type “${name}” to confirm`,
  firing: 'Firing…', hold: (name: string) => `Hold to fire ${name}`,
};

export const fireCopy: Record<Locale, typeof fireEn> = {
  en: fireEn,
  fa: {
    reasons: { 'Wrong personality': 'شخصیت نادرست', 'Role changed': 'نقش تغییر کرد', 'Not needed anymore': 'دیگر لازم نیست', 'Start fresh': 'شروعی تازه' },
    policies: {
      transfer: { title: 'سپردن حافظه‌ها', body: 'جانشینی که بعداً استخدام می‌کنید دانسته‌هایش را به ارث می‌برد.' },
      archive: { title: 'بایگانی', body: 'نگه داشته می‌شوند، اما هیچ عاملی از آن‌ها استفاده نمی‌کند.' },
      delete: { title: 'حذف برای همیشه', body: 'همهٔ حافظه‌ها پاک می‌شوند. این کار برگشت‌پذیر نیست.' },
    },
    goodbye: (name) => `خداحافظ، ${name}`,
    left: (name) => `${name} همهٔ گروه‌ها را ترک کرد و دیگر پاسخ نمی‌دهد.`,
    after: { transfer: 'حافظه‌هایش منتظر یک جانشین می‌مانند.', archive: 'حافظه‌هایش بایگانی شد.', delete: 'حافظه‌هایش پاک شد.' },
    hireSuccessor: 'استخدام جانشین', backToAgents: 'بازگشت به عامل‌ها',
    title: (name) => `اخراج ${name}`, question: (name) => `${name} اخراج شود؟`,
    permanent: 'شخصیت پس از شکل‌گیری دائمی است. برای تغییر آن، این عامل را بازنشسته کنید و عامل تازه‌ای استخدام کنید.',
    why: 'چرا', memories: 'حافظه‌هایش', typeName: (name) => `برای تأیید، «${name}» را بنویسید`,
    firing: 'در حال اخراج…', hold: (name) => `برای اخراج ${name} نگه دارید`,
  },
};

/** A stored fire reason in the reader's language; a reason typed elsewhere shows as written. */
export const fireReasonLabel = (reason: string, locale: Locale) =>
  (fireCopy[locale].reasons as Record<string, string>)[reason] ?? reason;
