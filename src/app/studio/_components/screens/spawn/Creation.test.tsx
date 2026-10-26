import { act, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView, CatalogView, RouteSuggestion } from '../../../_lib/client';
import { SpawnScreen } from '../Spawn';

const state = vi.hoisted(() => {
  // StudioApp's back-guard contract: the newest guard takes Back; unregistering removes exactly that guard.
  const guards: Array<() => void> = [];
  return {
    catalog: vi.fn(), route: vi.fn(), draft: vi.fn(), agent: vi.fn(), successorTemplate: vi.fn(), updatePersona: vi.fn(), refine: vi.fn(),
    guards,
    nav: {
      locale: 'en' as 'en' | 'fa', dir: 'ltr', tier: 'full', cache: new Map<string, AgentView>(), snack: vi.fn(),
      me: { org: 'Fixture team', member: { telegramId: 7777001, role: 'member' },
        features: { avatars: false, voices: false, calls: false, skillRouting: 'decisions' as 'decisions' | 'local' | undefined } },
      back: vi.fn(), reset: vi.fn(), push: vi.fn(), toast: vi.fn(), refreshMe: vi.fn(),
      guardBack: (onBack: () => void) => {
        const guard = () => onBack();
        guards.push(guard);
        return () => { const i = guards.indexOf(guard); if (i >= 0) guards.splice(i, 1); };
      },
      consumeBack: () => {
        const guard = guards[guards.length - 1];
        guard?.();
        return !!guard;
      },
    },
  };
});

vi.mock('../../../_lib/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../_lib/client')>();
  return { ...actual, api: { ...actual.api, catalog: state.catalog, route: state.route, draft: state.draft, agent: state.agent,
    successorTemplate: state.successorTemplate, updatePersona: state.updatePersona, refine: state.refine } };
});

vi.mock('../../StudioApp', () => ({
  useNav: () => state.nav,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'Unexpected operation error',
  LoadingFill: () => null,
}));

// Render presence synchronously, but keep framer's real hooks and motion values (the character rig uses them).
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  const { createElement } = await import('react');
  const MOTION_PROPS = ['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layoutId', 'layout', 'layoutScroll', 'variants', 'custom',
    'drag', 'dragConstraints', 'dragElastic', 'onDragEnd'];
  const cache = new Map<string, (props: { children?: ReactNode; style?: Record<string, unknown>; [key: string]: unknown }) => ReactNode>();
  const element = (tag: string) => {
    if (!cache.has(tag)) cache.set(tag, function MotionElement({ children, style, ...props }) {
      const plain = style && Object.fromEntries(Object.entries(style).filter(([, v]) => typeof v !== 'object'));
      return createElement(tag, { ...Object.fromEntries(Object.entries(props).filter(([key]) => !MOTION_PROPS.includes(key))), style: plain }, children);
    });
    return cache.get(tag)!;
  };
  return {
    ...actual,
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    motion: new Proxy({}, { get: (_target, tag: string) => element(tag) }),
    useReducedMotion: () => false,
  };
});
// The character renderer is covered by its own tests; here it only has to be present.
vi.mock('../../Cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../Cloud')>();
  const Face = ({ label }: { label?: string }) => <span role="img" aria-label={label} />;
  return { ...actual, Cloud: Face, AgentFace: Face };
});

const skill = (id: string, title: string) => ({ id, title, summary: `${title}, done well.` });
const traits = { warmDirect: 50, playfulSerious: 50, conciseExpansive: 50 };
const role = (id: string, pack: 'mobile' | 'lifestyle', title: string, skills: string[], optionalSkills: string[] = [], hue: 'lagoon' | 'matcha' = 'lagoon') => ({
  id, pack, space: pack === 'lifestyle' ? 'personal' as const : 'work' as const, title, summary: `${title} summary.`, mission: 'Mission.',
  skills, optionalSkills, starters: [`Ask the ${title} something`], hue, traits,
});

const CATALOG: CatalogView = {
  version: 'fixture',
  packs: [
    { id: 'mobile', space: 'work', title: 'Mobile company', tagline: 'Ship and grow games.', roles: ['mobile.ua-manager', 'mobile.live-ops'] },
    { id: 'lifestyle', space: 'personal', title: 'Lifestyle', tagline: 'Your life, looked after.', roles: ['lifestyle.running-coach', 'lifestyle.tutor'] },
  ],
  roles: [
    role('mobile.ua-manager', 'mobile', 'UA Manager', ['growth.paid-ua', 'growth.creative-testing', 'growth.roas'], ['growth.geo-launch']),
    role('mobile.live-ops', 'mobile', 'Live Ops Lead', ['growth.creative-testing', 'growth.roas', 'growth.geo-launch']),
    role('lifestyle.running-coach', 'lifestyle', 'Running Coach', ['life.training-plan', 'life.habit-checkin'], [], 'matcha'),
    role('lifestyle.tutor', 'lifestyle', 'Tutor', ['life.habit-checkin'], [], 'matcha'),
  ],
  skills: [
    skill('growth.paid-ua', 'Paid UA'), skill('growth.creative-testing', 'Creative testing'), skill('growth.roas', 'ROAS modelling'),
    skill('growth.geo-launch', 'Geo launch plans'), skill('life.training-plan', 'Training plans'), skill('life.habit-checkin', 'Habit check-ins'),
  ],
};

const NONE: RouteSuggestion = { skillIds: [], confidence: 0.1, alternatives: [], source: 'local' };
const UA_MATCH: RouteSuggestion = {
  roleId: 'mobile.ua-manager', pack: 'mobile', space: 'work', skillIds: ['growth.paid-ua', 'growth.creative-testing', 'growth.roas'],
  confidence: 0.86, alternatives: ['mobile.live-ops'], source: 'local',
};
const ROLE_QUESTION: RouteSuggestion = {
  skillIds: [], confidence: 0.5, alternatives: ['lifestyle.running-coach', 'mobile.live-ops'], source: 'local',
  clarify: { question: 'Which is closer?', options: [{ value: 'lifestyle.running-coach', label: 'Running Coach' }, { value: 'mobile.live-ops', label: 'Live Ops Lead' }] },
};

function agent(overrides: Partial<AgentView> = {}, persona: Partial<AgentView['persona']> = {}): AgentView {
  return {
    id: 'fixture-agent', status: 'draft',
    persona: {
      name: 'Nova', role: 'UA Manager', tagline: 'Buys installs that pay back', backstory: 'A helpful teammate.',
      personality: 'Curious', communicationStyle: 'Clear', values: ['Craft'], expertise: ['Paid acquisition'],
      wontDo: 'Legal advice', languages: ['English'], culture: '', presentation: 'neutral',
      age: '30s', accent: '', voiceBrief: 'A clear voice.', avatarHint: '', ...persona,
    },
    look: { hue: 'lagoon', family: 'drift', features: { cheeks: true, lashes: false, brows: true } },
    locked: false, formingDay: null, isAdmin: false, visibility: 'private', access: [],
    createdBy: 7777001, canEdit: true, canFire: false, canManageAccess: true,
    ...overrides,
  };
}

const composer = () => screen.getByRole('textbox', { name: /describe who you need/i });
const type = (text: string) => fireEvent.change(composer(), { target: { value: text } });
const pause = () => act(async () => { await vi.advanceTimersByTimeAsync(700); });
const lastBrief = () => state.draft.mock.calls.at(-1)?.[0];

async function open(props: { successorOf?: string; draftId?: string } = {}) {
  await act(async () => { render(<SpawnScreen {...props} />); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  state.guards.length = 0;
  state.nav.me.features.skillRouting = 'decisions';
  state.catalog.mockResolvedValue(CATALOG);
  state.route.mockResolvedValue(NONE);
  state.draft.mockResolvedValue({ agent: agent(), names: ['Nova'] });
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('Brief routing', () => {
  it('routes on a pause (local only), applies a confident match, and lets the creator remove it with Undo', async () => {
    state.route.mockResolvedValue(UA_MATCH);
    await open();
    type('someone to run UA for our puzzle game launch in Turkey');
    expect(state.route).not.toHaveBeenCalled();
    await pause();

    expect(state.route).toHaveBeenCalledTimes(1);
    expect(state.route).toHaveBeenCalledWith(expect.objectContaining({ text: 'someone to run UA for our puzzle game launch in Turkey', final: false }), expect.anything());
    const card = screen.getByRole('region', { name: 'UA Manager' });
    expect(within(card).getByText('Suggested role · Mobile company')).toBeVisible();
    const chips = within(card).getByRole('group', { name: 'Skills' });
    expect(within(chips).getByRole('button', { name: 'Paid UA' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Suggested role: UA Manager, Mobile company');

    fireEvent.click(within(card).getByRole('button', { name: 'Keep it custom' }));
    expect(screen.queryByRole('region', { name: 'UA Manager' })).not.toBeInTheDocument();
    expect(screen.getByText(/keeping it custom/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('region', { name: 'UA Manager' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(state.nav.toast).not.toHaveBeenCalled();
  });

  it('never re-suggests a dismissed role: it goes into exclude on later routes', async () => {
    state.route.mockResolvedValue(UA_MATCH);
    await open();
    type('someone to run UA for our launch');
    await pause();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it custom' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(screen.getByText('Custom agent')).toBeVisible();

    type('someone to run UA for our launch in Turkey');
    await pause();
    expect(state.route).toHaveBeenLastCalledWith(expect.objectContaining({ final: false, exclude: ['mobile.ua-manager'] }), expect.anything());
    expect(screen.queryByRole('region', { name: 'UA Manager' })).not.toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    expect(lastBrief()).not.toHaveProperty('roleId');
  });

  it('asks exactly one question after Draft on an ambiguous brief, and the answer drafts with the picked role', async () => {
    state.route.mockResolvedValue(ROLE_QUESTION);
    await open();
    type('a coach who keeps me honest about deadlines');
    await pause();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    expect(state.route).toHaveBeenLastCalledWith(expect.objectContaining({ final: true }), expect.anything());
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);
    expect(state.draft).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /running coach/i })); });
    expect(state.draft).toHaveBeenCalledTimes(1);
    expect(state.draft).toHaveBeenCalledWith(expect.objectContaining({
      description: 'a coach who keeps me honest about deadlines', roleId: 'lifestyle.running-coach',
      skillIds: ['life.training-plan', 'life.habit-checkin'], routing: { source: 'picked' }, domain: 'Personal',
    }), undefined);
  });

  it('skipping the question drafts as written, and it is never asked again', async () => {
    state.route.mockResolvedValue(ROLE_QUESTION);
    state.draft.mockRejectedValueOnce(new Error('Claude is busy.'));
    await open();
    type('a coach who keeps me honest about deadlines');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /skip — draft as written/i })); });
    expect(lastBrief()).toEqual(expect.objectContaining({ description: 'a coach who keeps me honest about deadlines' }));
    expect(lastBrief()).not.toHaveProperty('roleId');
    expect(screen.getByRole('alert')).toHaveTextContent('Claude is busy. Your brief is safe.');
    expect(composer()).toHaveValue('a coach who keeps me honest about deadlines');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(state.draft).toHaveBeenCalledTimes(2);
    expect(state.route.mock.calls.filter(([body]) => body.final)).toHaveLength(1);
  });

  it('re-routes a non-role answer once and applies the result when it is confident enough', async () => {
    const packQuestion: RouteSuggestion = { ...ROLE_QUESTION, clarify: { question: 'For work or your personal life?',
      options: [{ value: 'work', label: 'Work' }, { value: 'personal', label: 'Personal life' }] } };
    state.route.mockImplementation(async (body: { answer?: string }) => body.answer === 'personal'
      ? { roleId: 'lifestyle.running-coach', skillIds: ['life.training-plan'], confidence: 0.6, alternatives: [], source: 'decisions' }
      : packQuestion);
    await open();
    type('a coach who keeps me honest');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Personal life' })); });
    expect(state.route).toHaveBeenLastCalledWith(expect.objectContaining({ final: true, answer: 'personal' }), expect.anything());
    expect(lastBrief()).toEqual(expect.objectContaining({ roleId: 'lifestyle.running-coach', skillIds: ['life.training-plan'], routing: { source: 'decisions', confidence: 0.6 } }));
  });
});

describe('Brief role library and Fine-tune', () => {
  it('applies a role picked from the library and sends roleId, the skills left on, and routing.source "picked"', async () => {
    await open();
    expect(screen.getByRole('button', { name: /surprise me/i })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    const sheet = screen.getByRole('dialog', { name: 'Roles' });
    fireEvent.click(within(sheet).getByRole('button', { name: /^UA Manager/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const card = screen.getByRole('region', { name: 'UA Manager' });
    expect(within(card).getByText('Starting from · Mobile company')).toBeVisible();
    fireEvent.click(within(card).getByRole('button', { name: 'ROAS modelling' }));
    expect(within(card).getByRole('button', { name: 'ROAS modelling' })).toHaveAttribute('aria-pressed', 'false');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    expect(state.route).not.toHaveBeenCalled();
    expect(state.draft).toHaveBeenCalledWith(expect.objectContaining({
      roleId: 'mobile.ua-manager', skillIds: ['growth.paid-ua', 'growth.creative-testing'], routing: { source: 'picked' }, domain: 'Product',
    }), undefined);
  });

  it('caps skills at 8: the sheet disables more additions and says why', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `growth.s${i + 1}`);
    state.catalog.mockResolvedValue({
      ...CATALOG,
      roles: [role('mobile.ua-manager', 'mobile', 'UA Manager', ids.slice(0, 6), ids.slice(6))],
      skills: ids.map((id, i) => skill(id, `Skill ${i + 1}`)),
      packs: [CATALOG.packs[0]],
    });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Roles' })).getByRole('button', { name: /^UA Manager/ }));
    fireEvent.click(screen.getByRole('button', { name: /add skills \(\+ 4 more\)/i }));

    const sheet = screen.getByRole('dialog', { name: 'Skills' });
    fireEvent.click(within(sheet).getByRole('button', { name: /^Skill 7/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: /^Skill 8/ }));
    expect(within(sheet).getByRole('button', { name: /^Skill 9/ })).toBeDisabled();
    expect(within(sheet).getByRole('button', { name: /^Skill 10/ })).toBeDisabled();
    expect(within(sheet).getByText('Up to 8 skills. Turn one off first.')).toBeVisible();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    expect(lastBrief().skillIds).toEqual(ids.slice(0, 8));
  });

  it('sends traits only for the sliders the creator moved', async () => {
    await open();
    type('A calm product lead');
    fireEvent.click(screen.getByRole('button', { name: /fine-tune/i }));
    fireEvent.change(screen.getByRole('slider', { name: 'Warm to Direct' }), { target: { value: '70' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    expect(lastBrief().traits).toEqual({ warmDirect: 70 });
  });

  it('sends no traits at all when no slider was touched', async () => {
    await open();
    type('A calm product lead');
    fireEvent.click(screen.getByRole('button', { name: /fine-tune/i }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    expect(lastBrief()).not.toHaveProperty('traits');
  });

  it('pre-marks Persian from a Persian brief until the creator changes it', async () => {
    await open();
    type('مربی دویدنی که نگذارد از برنامه عقب بمانم');
    expect(screen.getByRole('button', { name: /fine-tune/i })).toHaveTextContent('Persian');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    expect(lastBrief().languages).toEqual(['Persian']);
  });

  it('degrades to plain free text when the library is empty', async () => {
    state.catalog.mockResolvedValue({ version: 'empty', packs: [], roles: [], skills: [] });
    await open();
    expect(screen.queryByText(/or start from a role/i)).not.toBeInTheDocument();
    type('A calm product lead who remembers every decision');
    await pause();
    expect(state.route).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /browse roles/i })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    expect(state.draft).toHaveBeenCalledWith(expect.objectContaining({ description: 'A calm product lead who remembers every decision' }), undefined);
    expect(lastBrief()).not.toHaveProperty('roleId');
  });
});

describe('Successor', () => {
  it('pre-applies the predecessor’s role and skills for a non-admin from the successor template, and drafts with routing.source "successor"', async () => {
    expect(state.nav.me.member.role).toBe('member');
    // Fired agents are admin-only through api.agent; the narrow template is what any member gets.
    state.agent.mockRejectedValue(new Error('Agent not found'));
    state.successorTemplate.mockResolvedValue({ name: 'Aria', roleId: 'mobile.ua-manager', skillIds: ['growth.paid-ua', 'growth.geo-launch'] });
    await open({ successorOf: 'pred-1' });

    expect(state.successorTemplate).toHaveBeenCalledWith('pred-1');
    expect(state.agent).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Who comes after Aria?' })).toBeVisible();
    const card = screen.getByRole('region', { name: 'UA Manager' });
    expect(within(card).getByText('Same role as Aria')).toBeVisible();
    expect(within(card).getByRole('button', { name: 'Geo launch plans' })).toHaveAttribute('aria-pressed', 'true');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft the successor/i })); });
    expect(state.draft).toHaveBeenCalledWith(expect.objectContaining({
      roleId: 'mobile.ua-manager', skillIds: ['growth.paid-ua', 'growth.geo-launch'], routing: { source: 'successor' },
    }), 'pred-1');
  });

  it('keeps it custom under "Who comes after" when the predecessor had no library role, and still drafts as its successor', async () => {
    state.successorTemplate.mockResolvedValue({ name: 'Aria' });
    await open({ successorOf: 'pred-1' });
    expect(screen.getByRole('heading', { name: 'Who comes after Aria?' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'UA Manager' })).not.toBeInTheDocument();
    expect(screen.getByText('Custom agent')).toBeVisible();
    type('Someone calmer');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft the successor/i })); });
    expect(lastBrief()).not.toHaveProperty('roleId');
    expect(state.draft).toHaveBeenCalledWith(expect.objectContaining({ description: 'Someone calmer' }), 'pred-1');
  });

  it('drafts a plain successor when the template is refused', async () => {
    state.successorTemplate.mockRejectedValue(new Error('Predecessor not found'));
    await open({ successorOf: 'gone-1' });
    expect(screen.getByRole('button', { name: /draft the successor/i })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(state.nav.toast).not.toHaveBeenCalled();
  });
});

describe('Back while a sheet is open', () => {
  // The wizard's lead is ✕ ("Close") wherever Back leaves it: the Brief, and Draft when reopening a draft.
  const topBack = (name: 'Close' | 'Back') => screen.getByRole('button', { name, exact: true });

  it('Telegram Back closes the role sheet and keeps the brief; with no sheet open, Back leaves', async () => {
    await open();
    type('A calm product lead who remembers every decision');
    fireEvent.click(screen.getByRole('button', { name: 'Browse roles' }));
    expect(screen.getByRole('dialog', { name: 'Roles' })).toBeVisible();
    expect(state.guards).toHaveLength(1);

    // What StudioApp does with Telegram's BackButton: the newest guard takes the press.
    act(() => { expect(state.nav.consumeBack()).toBe(true); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(composer()).toHaveValue('A calm product lead who remembers every decision');
    expect(state.guards).toHaveLength(0);
    expect(state.nav.back).not.toHaveBeenCalled();
    expect(state.nav.consumeBack()).toBe(false);
  });

  it('the top bar Back closes an open sheet first, then leaves on the next press', async () => {
    await open();
    type('A calm product lead');
    fireEvent.click(screen.getByRole('button', { name: 'Browse roles' }));
    fireEvent.click(topBack('Close'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(composer()).toHaveValue('A calm product lead');
    expect(state.nav.back).not.toHaveBeenCalled();

    // The brief has text, so leaving asks first (outside a ConfirmProvider the native dialog stands in).
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => { fireEvent.click(topBack('Close')); });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(state.nav.back).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it('closes the Persona step’s skills sheet without leaving the step', async () => {
    state.agent.mockResolvedValue({ agent: agent({}, { roleId: 'mobile.ua-manager', skillIds: ['growth.paid-ua'] }) });
    await open({ draftId: 'fixture-agent' });
    fireEvent.click(screen.getByRole('button', { name: /add skills/i }));
    expect(screen.getByRole('dialog', { name: 'Skills' })).toBeVisible();
    fireEvent.click(topBack('Close'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /use nova · choose a voice/i })).toBeVisible();
    expect(state.nav.back).not.toHaveBeenCalled();
    expect(state.guards).toHaveLength(0);
  });

  it('unregisters the guard when the screen unmounts with a sheet open', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(screen.getByRole('dialog', { name: 'Roles' })).toBeVisible();
    expect(state.guards).toHaveLength(1);
    cleanup();
    expect(state.guards).toHaveLength(0);
  });
});

describe('Persona step', () => {
  it('toggles a skill and saves the skills left on with updatePersona', async () => {
    const current = agent({}, { roleId: 'mobile.ua-manager', skillIds: ['growth.paid-ua', 'growth.creative-testing', 'growth.roas'] });
    state.agent.mockResolvedValue({ agent: current });
    state.updatePersona.mockImplementation(async (_id: string, patch: { skillIds: string[] }) => ({ agent: { ...current, persona: { ...current.persona, ...patch } } }));
    await open({ draftId: current.id });

    expect(screen.getByText(/· Mobile company/)).toBeVisible();
    expect(screen.queryByText('Expertise')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Creative testing' }));
    expect(screen.getByRole('button', { name: 'Creative testing' })).toHaveAttribute('aria-pressed', 'false');
    expect(state.updatePersona).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(state.updatePersona).toHaveBeenCalledExactlyOnceWith(current.id, { skillIds: ['growth.paid-ua', 'growth.roas'] });
    expect(screen.getByRole('button', { name: 'Creative testing' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /use nova · choose a voice/i })).toBeEnabled();
    expect(state.nav.toast).not.toHaveBeenCalled();
  });

  it('an editor who is not the creator (an admin on a member\'s draft) sees the skills read-only, with no Add', async () => {
    const current = agent({ canShapeIdentity: false }, { roleId: 'mobile.ua-manager', skillIds: ['growth.paid-ua', 'growth.roas'] });
    state.agent.mockResolvedValue({ agent: current });
    await open({ draftId: current.id });
    for (const name of ['Paid UA', 'ROAS modelling']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Add skills/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Paid UA' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(state.updatePersona).not.toHaveBeenCalled();
  });

  it('hides "How they talk" until the draft has voice examples, then shows them as an exchange', async () => {
    state.agent.mockResolvedValue({ agent: agent() });
    await open({ draftId: 'fixture-agent' });
    expect(screen.queryByText('How they talk')).not.toBeInTheDocument();
    expect(screen.getByText('Speaking style')).toBeVisible();
    expect(screen.getByText('Expertise')).toBeVisible();
    cleanup();

    state.agent.mockResolvedValue({ agent: agent({}, { voiceExamples: [{ user: 'What CPI should we aim for?', reply: 'Under $0.50 on Android is realistic.' }] }) });
    await open({ draftId: 'fixture-agent' });
    const talk = screen.getByRole('region', { name: 'How they talk' });
    expect(within(talk).getByText('What CPI should we aim for?')).toBeVisible();
    expect(within(talk).getByText('Under $0.50 on Android is realistic.')).toBeVisible();
  });
});

const LOCAL_NONE: RouteSuggestion = { skillIds: [], confidence: 0.1, alternatives: [], source: 'local' };
/** Final (Decisions) routes hang until released; typing routes answer at once. */
function holdFinalRoute() {
  const held: { resolve?: (s: RouteSuggestion) => void; signal?: AbortSignal } = {};
  state.route.mockImplementation((body: { final?: boolean }, signal: AbortSignal) => body.final
    ? new Promise((resolve) => { held.resolve = resolve; held.signal = signal; })
    : Promise.resolve(LOCAL_NONE));
  return held;
}

describe('Brief races and modes', () => {
  it('asks a one-option "did you mean" and Skip remains the other answer', async () => {
    state.route.mockResolvedValue({ skillIds: [], confidence: 0.567, alternatives: ['lifestyle.running-coach'], source: 'local',
      clarify: { question: 'Which is closer?', options: [{ value: 'lifestyle.running-coach', label: 'Running Coach' }] } });
    await open();
    type('help me run a little further');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /skip — draft as written/i })).toBeEnabled();
    expect(state.draft).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /running coach/i })); });
    expect(lastBrief()).toEqual(expect.objectContaining({ roleId: 'lifestyle.running-coach', routing: { source: 'picked' } }));
  });

  it('leaving mid-Draft aborts the route and never creates a draft', async () => {
    const held = holdFinalRoute();
    await open();
    type('help me cook healthy meals');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    expect(held.signal?.aborted).toBe(false);
    cleanup();
    expect(held.signal?.aborted).toBe(true);
    await act(async () => { held.resolve?.(LOCAL_NONE); await vi.advanceTimersByTimeAsync(10); });
    expect(state.draft).not.toHaveBeenCalled();
  });

  it('freezes the brief while Draft resolves, so what is drafted is what was shown', async () => {
    const held = holdFinalRoute();
    await open();
    type('help me cook healthy meals');
    fireEvent.click(screen.getByRole('button', { name: /fine-tune/i }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    expect(composer()).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Persian' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /draft with claude/i })).toBeDisabled();
    await act(async () => { held.resolve?.(LOCAL_NONE); await vi.advanceTimersByTimeAsync(10); });
    expect(lastBrief().description).toBe('help me cook healthy meals');
  });

  it('a pending typing route never fires over the Decisions route on Draft', async () => {
    const held = holdFinalRoute();
    await open();
    type('help me cook healthy meals');
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(state.route.mock.calls.map(([body]) => body.final)).toEqual([true]);
    await act(async () => { held.resolve?.(LOCAL_NONE); await vi.advanceTimersByTimeAsync(10); });
    expect(state.draft).toHaveBeenCalledTimes(1);
  });

  it('without Decisions on the server, Draft makes no final route: it uses (or makes) one local route', async () => {
    state.nav.me.features.skillRouting = 'local';
    state.route.mockResolvedValue(ROLE_QUESTION);
    await open();
    type('a coach who keeps me honest about deadlines');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    expect(state.route.mock.calls.map(([body]) => body.final)).toEqual([false]);
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);
  });

  it('drafts at once when a match is already showing (no extra route)', async () => {
    state.route.mockResolvedValue(UA_MATCH);
    await open();
    type('someone to run UA for our launch');
    await pause();
    expect(state.route).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    expect(state.route).toHaveBeenCalledTimes(1);
    expect(lastBrief()).toEqual(expect.objectContaining({ roleId: 'mobile.ua-manager', routing: { source: 'local', confidence: 0.86 } }));
  });

  it('clearing the brief drops a routed role and brings back the pack row and Surprise me', async () => {
    state.route.mockResolvedValue(UA_MATCH);
    await open();
    type('someone to run UA for our launch');
    await pause();
    expect(screen.getByRole('region', { name: 'UA Manager' })).toBeVisible();
    type('');
    await pause();
    expect(screen.queryByRole('region', { name: 'UA Manager' })).not.toBeInTheDocument();
    expect(screen.getByText(/or start from a role/i)).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /surprise me/i })); });
    expect(lastBrief()).not.toHaveProperty('roleId');
  });

  it('clearing the brief keeps a role the creator picked', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Roles' })).getByRole('button', { name: /^UA Manager/ }));
    type('for our launch');
    type('');
    expect(screen.getByRole('region', { name: 'UA Manager' })).toBeVisible();
  });
});

describe('Persona skills saving', () => {
  const current = agent({}, { roleId: 'mobile.ua-manager', skillIds: ['growth.paid-ua', 'growth.creative-testing', 'growth.roas'] });
  const withSkills = (skillIds: string[]) => ({ agent: { ...current, persona: { ...current.persona, skillIds } } });

  it('a double tap on Next while skills save advances exactly one step', async () => {
    state.agent.mockResolvedValue({ agent: current });
    let finish!: (v: { agent: AgentView }) => void;
    state.updatePersona.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await open({ draftId: current.id });
    fireEvent.click(screen.getByRole('button', { name: 'Creative testing' }));
    const cta = screen.getByRole('button', { name: /use nova · choose a voice/i });
    await act(async () => { fireEvent.click(cta); });
    expect(cta).toBeDisabled();
    expect(cta).toHaveAttribute('aria-busy', 'true');
    await act(async () => { fireEvent.click(cta); });
    await act(async () => { finish(withSkills(['growth.paid-ua', 'growth.roas'])); await vi.advanceTimersByTimeAsync(10); });
    expect(state.updatePersona).toHaveBeenCalledTimes(1);
    // Draft → Voice → Look → Hire: the next step is the voice.
    expect(screen.getByRole('heading', { name: 'Nova’s voice' })).toBeVisible();
  });

  it('keeps one skill PATCH in flight, sends the newest selection next, and rolls back to the server copy on failure', async () => {
    state.agent.mockResolvedValue({ agent: current });
    const finishers: Array<(v: unknown) => void> = [];
    const failers: Array<(e: unknown) => void> = [];
    state.updatePersona.mockImplementation(() => new Promise((resolve, reject) => { finishers.push(resolve); failers.push(reject); }));
    await open({ draftId: current.id });

    fireEvent.click(screen.getByRole('button', { name: 'Creative testing' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(state.updatePersona).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'ROAS modelling' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    fireEvent.click(screen.getByRole('button', { name: 'Paid UA' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(state.updatePersona).toHaveBeenCalledTimes(1);

    await act(async () => { finishers[0](withSkills(['growth.paid-ua', 'growth.roas'])); await vi.advanceTimersByTimeAsync(10); });
    expect(state.updatePersona).toHaveBeenCalledTimes(2);
    expect(state.updatePersona).toHaveBeenLastCalledWith(current.id, { skillIds: [] });

    await act(async () => { failers[1](new Error('Could not save skills.')); await vi.advanceTimersByTimeAsync(10); });
    expect(state.nav.toast).toHaveBeenCalledWith('Could not save skills.', 'error');
    expect(screen.getByRole('button', { name: 'Paid UA' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'ROAS modelling' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Creative testing' })).not.toBeInTheDocument();
  });

  it('keeps Expertise when the library failed to load, and retries the library when back online', async () => {
    state.catalog.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(CATALOG);
    state.agent.mockResolvedValue({ agent: current });
    await open({ draftId: current.id });
    expect(screen.getByText('Expertise')).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Skills' })).not.toBeInTheDocument();
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(state.catalog).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('group', { name: 'Skills' })).toBeVisible();
    expect(screen.queryByText('Expertise')).not.toBeInTheDocument();
  });
});
