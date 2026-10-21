import { act, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type AgentView, type VoiceOptions } from '../../_lib/client';
import { ConfirmProvider, UiLocaleProvider } from '../ui';
import { expectNoRawControls, expectOneVolt } from '../ui.testing';
import { SpawnScreen } from './Spawn';
import { AgentScreen } from './Agent';

const state = vi.hoisted(() => ({
  catalog: vi.fn(), route: vi.fn(), successorTemplate: vi.fn(),
  draft: vi.fn(),
  agent: vi.fn(),
  groups: vi.fn(),
  deleteDraft: vi.fn(),
  updatePersona: vi.fn(),
  refine: vi.fn(),
  syncProfile: vi.fn(),
  publish: vi.fn(),
  test: vi.fn(),
  voiceOptions: vi.fn(), chooseDefaultVoice: vi.fn(), searchVoices: vi.fn(), speak: vi.fn(), designVoices: vi.fn(),
  nav: {
    locale: 'en' as 'en' | 'fa',
    me: { org: 'Fixture team', member: { telegramId: 7777001, role: 'member' }, features: { avatars: false, voices: false, calls: false } },
    back: vi.fn(), reset: vi.fn(), push: vi.fn(), toast: vi.fn(), snack: vi.fn(), refreshMe: vi.fn(),
    cache: new Map<string, AgentView>(), dir: 'ltr', tier: 'full',
    // No sheet is opened here: Back is never guarded (Creation.test.tsx covers the guards).
    guardBack: () => () => {}, consumeBack: () => false,
  },
}));

vi.mock('../../_lib/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, catalog: state.catalog, route: state.route, successorTemplate: state.successorTemplate, draft: state.draft, agent: state.agent, groups: state.groups, deleteDraft: state.deleteDraft,
    updatePersona: state.updatePersona, refine: state.refine, syncProfile: state.syncProfile, publish: state.publish, test: state.test,
    voiceOptions: state.voiceOptions, chooseDefaultVoice: state.chooseDefaultVoice, searchVoices: state.searchVoices, speak: state.speak,
    designVoices: state.designVoices } };
});

// Steps swap under AnimatePresence mode="wait", which waits for frames the fake timers never run:
// render presence synchronously and keep framer's real hooks (useReducedMotion, motion values).
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  const { createElement } = await import('react');
  const framerOnly = new Set(['initial', 'animate', 'exit', 'transition', 'variants', 'whileTap', 'whileHover', 'layout', 'layoutId', 'layoutScroll', 'custom']);
  const made = new Map<string, unknown>();
  const motion = new Proxy({}, {
    get: (_, tag: string) => {
      if (!made.has(tag)) {
        made.set(tag, function MotionElement({ children, style, ...props }: { children?: ReactNode; style?: Record<string, unknown>; [key: string]: unknown }) {
          const plain = style && Object.fromEntries(Object.entries(style).filter(([, v]) => typeof v !== 'object'));
          return createElement(tag, { ...Object.fromEntries(Object.entries(props).filter(([k]) => !framerOnly.has(k))), style: plain }, children);
        });
      }
      return made.get(tag);
    },
  });
  return { ...actual, AnimatePresence: ({ children }: { children?: ReactNode }) => children, motion };
});
// The character renderer is another stream's work; these tests are about layout and behaviour.
vi.mock('../Cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../Cloud')>();
  const Face = ({ label }: { label?: string }) => <span role="img" aria-label={label} />;
  return { ...actual, Cloud: Face, AgentFace: Face };
});
// The Look step is D's customizer; here it only has to hand control back.
vi.mock('./spawn/LookStep', () => ({
  LookStep: ({ agent, onNext }: { agent: AgentView; onNext: () => void }) => (
    <><h1>{`${agent.persona.name}’s look`}</h1><div className="vx-dock"><button type="button" className="vx-btn vx-btn-primary" onClick={onNext}>Next</button></div></>
  ),
}));

vi.mock('../StudioApp', () => ({
  useNav: () => state.nav,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'Unexpected operation error',
  LoadingFill: () => null,
}));

function agent(overrides: Partial<AgentView> = {}): AgentView {
  return {
    id: 'fixture-agent', status: 'draft', stage: 4,
    persona: {
      name: 'Nova', role: 'Designer', tagline: 'Finds the fun', backstory: 'A helpful teammate.',
      personality: 'Curious', communicationStyle: 'Clear', values: ['Craft'], expertise: ['Design'],
      wontDo: 'Legal advice', languages: ['English'], culture: '', presentation: 'neutral',
      age: '30s', accent: '', voiceBrief: 'A clear voice with a calm, even pace.', avatarHint: '',
    },
    look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } },
    locked: false, formingDay: null, isAdmin: false, visibility: 'private', access: [],
    createdBy: 7777001, canEdit: true, canEditLook: true, canFire: false, canManageAccess: true,
    ...overrides,
  } as AgentView;
}

/** One library role, for the tests that need the catalog (routing itself lives in spawn/Creation.test.tsx). */
const LIBRARY = {
  version: 'fixture',
  packs: [{ id: 'mobile', space: 'work', title: 'Mobile company', tagline: 'Ship and grow games.', roles: ['mobile.ua-manager'] }],
  roles: [{ id: 'mobile.ua-manager', pack: 'mobile', space: 'work', title: 'UA Manager', summary: 'Buys installs that pay back.', mission: 'Mission.',
    skills: ['growth.paid-ua'], optionalSkills: [], starters: ['Which geo should we test next?'], hue: 'lagoon',
    traits: { warmDirect: 50, playfulSerious: 50, conciseExpansive: 50 } }],
  skills: [{ id: 'growth.paid-ua', title: 'Paid UA', summary: 'Paid UA, done well.' }],
};

const step = (n: number, of = 5) => screen.getByRole('img', { name: `Step ${n} of ${of}` });
const brief = () => screen.getByRole('textbox', { name: /describe who you need/i });

beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  state.nav.me.features.voices = false; state.nav.cache.clear(); state.nav.locale = 'en'; state.nav.dir = 'ltr';
  state.groups.mockResolvedValue({ groups: [] });
  // An empty role library: the Brief degrades to plain free text (routing and roles live in spawn/Creation.test.tsx).
  state.catalog.mockResolvedValue({ version: 'empty', packs: [], roles: [], skills: [] });
  state.route.mockResolvedValue({ skillIds: [], confidence: 0, alternatives: [], source: 'local' });
  try { window.localStorage.clear(); } catch { /* storage-less run */ }
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('Spawn order and navigation (D15)', () => {
  it('runs Brief → Draft → Voice → Look → Hire with centred dots, ✕ first and a back chevron after', async () => {
    const current = agent();
    state.agent.mockResolvedValue({ agent: current });
    await act(async () => { render(<SpawnScreen draftId={current.id} />); });
    expect(step(2)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(document.querySelector('.vx-topbar-title .vx-steps')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Use Nova · choose a voice' }));
    expect(screen.getByRole('heading', { name: 'Nova’s voice' })).toBeVisible();
    expect(step(3)).toBeInTheDocument();
    // Board spawn-2/3: a bare chevron, no visible "Back"
    expect(screen.getByRole('button', { name: 'Back' })).toHaveClass('icon');
    expect(screen.getByRole('button', { name: 'Back' })).toHaveTextContent('');

    fireEvent.click(screen.getByRole('button', { name: 'Next · look' }));
    expect(screen.getByRole('heading', { name: 'Nova’s look' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Hire Nova' })).toBeVisible();
    expect(step(5)).toBeInTheDocument();
    expectOneVolt(document.body);

    // A summary row jumps back to its step
    fireEvent.click(screen.getByRole('button', { name: /^Voice/ }));
    expect(screen.getByRole('heading', { name: 'Nova’s voice' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('article', { name: 'Nova’s persona' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(state.nav.back).toHaveBeenCalledTimes(1);
  });

  it('refines a live agent as Draft → Look and returns to the profile when done', async () => {
    const live = agent({ status: 'active', bot: { username: 'nova_bot' }, profileSync: { status: 'synced', failed: [] } });
    state.agent.mockResolvedValue({ agent: live });
    await act(async () => { render(<SpawnScreen draftId={live.id} />); });
    expect(step(1, 2)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next · look' }));
    expect(screen.getByRole('heading', { name: 'Nova’s look' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(state.nav.back).toHaveBeenCalledTimes(1);
  });

  it('asks before closing a brief with something in it', async () => {
    await act(async () => { render(<ConfirmProvider><SpawnScreen /></ConfirmProvider>); });
    expect(screen.getByRole('heading', { name: 'Who do you need?' })).toBeVisible();
    fireEvent.change(brief(), { target: { value: 'A careful analyst' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close' })); });
    const sheet = within(screen.getByRole('dialog', { name: 'Discard this brief?' }));
    await act(async () => { fireEvent.click(sheet.getByRole('button', { name: 'Keep' })); });
    expect(state.nav.back).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close' })); });
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard this brief?' })).getByRole('button', { name: 'Discard' })); });
    expect(state.nav.back).toHaveBeenCalledTimes(1);
  });

  it('deletes a draft that lands after its brief was discarded mid-draft', async () => {
    let land!: (r: { agent: AgentView; names: string[] }) => void;
    state.draft.mockReturnValue(new Promise((resolve) => { land = resolve; }));
    state.deleteDraft.mockResolvedValue({ ok: true });
    await act(async () => { render(<ConfirmProvider><SpawnScreen /></ConfirmProvider>); });
    fireEvent.change(brief(), { target: { value: 'A careful analyst' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close' })); });
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard this brief?' })).getByRole('button', { name: 'Discard' })); });
    expect(state.nav.back).toHaveBeenCalledTimes(1);

    await act(async () => { land({ agent: agent(), names: ['Nova'] }); });
    expect(state.deleteDraft).toHaveBeenCalledWith('fixture-agent');
    expect(state.nav.cache.has('fixture-agent')).toBe(false);
  });

  it('once the draft has landed, Close keeps it as a draft: no brief to discard, no Back into an empty Brief', async () => {
    state.draft.mockResolvedValue({ agent: agent(), names: ['Nova'] });
    await act(async () => { render(<ConfirmProvider><SpawnScreen /></ConfirmProvider>); });
    fireEvent.change(brief(), { target: { value: 'A careful analyst' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });

    // During the poof the Brief is still up, but what was written is now a saved draft
    expect(step(1)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close' })); });
    expect(screen.queryByRole('dialog', { name: 'Discard this brief?' })).not.toBeInTheDocument();
    expect(state.nav.back).toHaveBeenCalledTimes(1);

    // On Draft the lead is ✕ too: it leaves (the draft waits on Home) instead of redrafting from an empty Brief
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(step(2)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(state.nav.back).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('heading', { name: 'Who do you need?' })).not.toBeInTheDocument();
    expect(state.draft).toHaveBeenCalledTimes(1);
    expect(state.deleteDraft).not.toHaveBeenCalled();
    expect(state.nav.cache.get('fixture-agent')?.persona.name).toBe('Nova');
  });

  it('closes an untouched brief at once; its one volt CTA is Surprise me until something is typed', async () => {
    const { container } = render(<SpawnScreen />);
    expectOneVolt(container);
    expectNoRawControls(container);
    expect(screen.getByRole('button', { name: 'Surprise me' })).toHaveClass('vx-btn-primary');
    fireEvent.change(brief(), { target: { value: 'A careful analyst' } });
    expect(screen.queryByRole('button', { name: 'Surprise me' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Draft with Claude' })).toHaveClass('vx-btn-primary');
    expectOneVolt(container);
    fireEvent.change(brief(), { target: { value: '' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close' })); });
    expect(state.nav.back).toHaveBeenCalledTimes(1);
  });
});

describe('Spawn failure recovery', () => {
  it('keeps a failed draft error inline with the visitor’s brief, without a second toast', async () => {
    const message = 'Vox Studio returned an unexpected page. Close and reopen the Mini App, then try again.';
    state.draft.mockRejectedValue(new ApiError(200, message));
    render(<SpawnScreen />);
    fireEvent.change(brief(), { target: { value: 'An analytical teammate' } });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    // One alert: the Brief's inline error (with Retry), not the wizard banner as well
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('alert')).toHaveTextContent('Your brief is safe.');
    expect(state.nav.toast).not.toHaveBeenCalled();
    expect(brief()).toHaveValue('An analytical teammate');
    expect(screen.getByRole('button', { name: /draft with claude/i })).toBeEnabled();
  });

  it.each([
    ['an expired session', new ApiError(401, 'Open Vox Studio from Telegram.')],
    ['a network failure', new TypeError('Failed to fetch')],
  ])('shows %s during Telegram confirmation and still completes after polling recovers', async (_label, error) => {
    const waiting = agent({ status: 'awaiting_bot' });
    const active = agent({ status: 'active', stage: 1, bot: { username: 'fixture_nova_bot' }, profileSync: { status: 'synced', failed: [] } });
    state.agent.mockResolvedValueOnce({ agent: waiting }).mockRejectedValueOnce(error).mockResolvedValueOnce({ agent: active });
    await act(async () => { render(<SpawnScreen draftId={waiting.id} />); });
    expect(screen.getByText('Waiting for Telegram…')).toBeVisible();

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.queryByText('Waiting for Telegram…')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(error.message);
    expect(screen.getByRole('button', { name: /open telegram again/i })).toBeEnabled();

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nova is hired' })).toBeVisible();
    expect(screen.getByText(/starts as a newborn and grows over 7 days/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Message' })).toBeEnabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(state.agent).toHaveBeenCalledTimes(3);
  });

  it('moves from the actual Brief button to the editable Draft step after a successful draft', async () => {
    state.draft.mockResolvedValue({ agent: agent(), names: ['Nova', 'Alt'] });
    render(<SpawnScreen />);
    fireEvent.change(brief(), { target: { value: 'A curious designer' } });
    // Languages, background, accent, presentation and temperament live behind one Fine-tune row.
    expect(screen.queryByRole('button', { name: 'Persian' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /fine-tune/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Persian' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Age' }), { target: { value: '30s' } });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });

    expect(state.draft).toHaveBeenCalledWith(expect.objectContaining({ description: 'A curious designer', languages: ['Persian'], age: '30s' }), undefined);
    expect(screen.queryByRole('button', { name: /draft with claude/i })).not.toBeInTheDocument();
    // the forming creature stays up and poofs into the drafted look before Draft opens
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByRole('img', { name: 'Your new agent' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Nova' })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2200); });
    expect(screen.getByRole('heading', { name: 'Nova' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Use Nova · choose a voice' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(state.nav.cache.get('fixture-agent')?.persona.name).toBe('Nova');
  });

  it('speaks Persian on a Persian session and still sends English chip values to Claude', async () => {
    state.nav.locale = 'fa'; state.nav.dir = 'rtl';
    state.draft.mockResolvedValue({ agent: agent(), names: ['Nova', 'Alt'] });
    render(<UiLocaleProvider value="fa"><SpawnScreen /></UiLocaleProvider>);
    expect(screen.getByRole('heading', { name: 'به چه کسی نیاز دارید؟' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'غافلگیرم کن' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /تنظیم جزئیات/ }));
    expect(screen.getByRole('slider', { name: 'گرم تا رک' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Who do you need|Languages|Fine-tune|Surprise me|Draft with Claude|Persian/);
    fireEvent.change(screen.getByRole('textbox', { name: 'توصیف همکاری که لازم دارید' }), { target: { value: 'A curious designer' } });
    fireEvent.click(screen.getByRole('button', { name: 'فارسی' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'پیش‌نویس با Claude' })); });
    expect(state.draft).toHaveBeenCalledWith(expect.objectContaining({ languages: ['Persian'] }), undefined);
    expect(screen.getByText('Claude در حال تصور اوست…')).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(screen.getByRole('article', { name: 'شخصیت Nova' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'تأیید Nova · انتخاب صدا' })).toBeEnabled();
    expect(screen.getByText('روی هر بخش بزنید تا خودتان ویرایشش کنید')).toBeVisible();
  });

  it('names a carried library role while drafting a successor', async () => {
    state.catalog.mockResolvedValue(LIBRARY);
    state.successorTemplate.mockResolvedValue({ name: 'Aria', roleId: 'mobile.ua-manager', skillIds: ['growth.paid-ua'] });
    state.draft.mockReturnValue(new Promise(() => {}));
    await act(async () => { render(<SpawnScreen successorOf="pred-1" />); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft the successor/i })); });
    expect(state.draft).toHaveBeenCalledWith(expect.objectContaining({ roleId: 'mobile.ua-manager', routing: { source: 'successor' } }), 'pred-1');
    expect(screen.getByText('Imagining your UA Manager…')).toBeVisible();
  });

  it('Surprise me drafts with an empty brief', async () => {
    state.draft.mockResolvedValue({ agent: agent(), names: [] });
    render(<SpawnScreen />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Surprise me' })); });
    // Nothing was typed or tuned: no description, no traits (untouched sliders would bias every draft)
    expect(state.draft).toHaveBeenCalledWith({}, undefined);
  });
});

describe('Draft: name chips, doc card, composer', () => {
  async function openDraft(current = agent()) {
    state.agent.mockResolvedValue({ agent: current });
    await act(async () => { render(<SpawnScreen draftId={current.id} />); });
    return current;
  }

  it('reads as one doc card with a warn overline for Won’t do, the composer above the one volt CTA', async () => {
    await openDraft();
    const doc = screen.getByRole('article', { name: 'Nova’s persona' });
    expect(doc).toHaveClass('vx-doc');
    expect(within(doc).getByText('Won’t do')).toHaveClass('vx-over', 'warn');
    expect(screen.getByText('Tap any section to edit it yourself')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Ask Claude to change' }).closest('.vx-dock')).not.toBeNull();
    expectOneVolt(document.body);
    expectNoRawControls(document.body);
  });

  it('offers Claude’s names first as Unbounded chips', async () => {
    const drafted = agent();
    state.draft.mockResolvedValue({ agent: drafted, names: ['Nova', 'Alt'] });
    state.updatePersona.mockResolvedValue({ agent: agent({ persona: { ...drafted.persona, name: 'Alt' } }) });
    render(<SpawnScreen />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Surprise me' })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    const names = within(screen.getByRole('group', { name: 'Claude suggests · pick a name' }));
    expect(names.getByRole('button', { name: 'Nova' })).toHaveAttribute('aria-pressed', 'true');
    expect(names.getByRole('button', { name: 'Alt' })).toHaveClass('vx-chip-name');
    await act(async () => { fireEvent.click(names.getByRole('button', { name: 'Alt' })); });
    expect(state.updatePersona).toHaveBeenCalledWith(drafted.id, { name: 'Alt' });
    expect(screen.getByRole('button', { name: 'Use Alt · choose a voice' })).toBeVisible();
  });

  it.each([
    ['Edit name', 'Nova', 'Neda', 'name'],
    ['Personality', 'Curious', 'Warm and curious', 'personality'],
  ])('saves an edited section (%s) and waits for confirmation before Next', async (button, original, value, field) => {
    const current = await openDraft();
    let finish!: (value: { agent: AgentView }) => void;
    state.updatePersona.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: button === 'Edit name' ? button : new RegExp(`^${button}`) }));
    fireEvent.change(screen.getByDisplayValue(original), { target: { value } });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save & next' })); });

    expect(state.updatePersona).toHaveBeenCalledExactlyOnceWith(current.id, { [field]: value });
    expect(screen.getByDisplayValue(value)).toBeVisible();
    expect(screen.queryByRole('heading', { name: /’s voice/ })).not.toBeInTheDocument();
    const saved = agent({ persona: { ...current.persona, [field]: value } });
    await act(async () => { finish({ agent: saved }); });
    expect(screen.getByRole('heading', { name: `${saved.persona.name}’s voice` })).toBeVisible();
  });

  it('edits values one per line and cancels with Escape', async () => {
    const current = await openDraft();
    state.updatePersona.mockResolvedValue({ agent: agent({ persona: { ...current.persona, values: ['Craft', 'Taste'] } }) });
    fireEvent.click(screen.getByRole('button', { name: /^Won’t do/ }));
    fireEvent.keyDown(screen.getByDisplayValue('Legal advice'), { key: 'Escape' });
    expect(screen.queryByDisplayValue('Legal advice')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Values/ }));
    fireEvent.change(screen.getByDisplayValue('Craft'), { target: { value: 'Craft\n Taste \n' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(state.updatePersona).toHaveBeenCalledWith(current.id, { values: ['Craft', 'Taste'] });
    expect(screen.getByText('Craft · Taste')).toBeVisible();
  });

  it('preserves an invalid edit and its error, then advances after a successful retry', async () => {
    const current = await openDraft();
    const saved = agent({ persona: { ...current.persona, name: 'Neda' } });
    state.updatePersona.mockRejectedValueOnce(new ApiError(400, 'Name must be 40 characters or fewer.')).mockResolvedValueOnce({ agent: saved });
    fireEvent.click(screen.getByRole('button', { name: 'Edit name' }));
    fireEvent.change(screen.getByDisplayValue('Nova'), { target: { value: 'N'.repeat(41) } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save & next' })); });

    expect(screen.getByRole('alert')).toHaveTextContent('Name must be 40 characters or fewer.');
    expect(screen.getByDisplayValue('N'.repeat(41))).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save & next' })).toBeEnabled();
    fireEvent.change(screen.getByDisplayValue('N'.repeat(41)), { target: { value: 'Neda' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save & next' })); });
    expect(screen.getByRole('heading', { name: 'Neda’s voice' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not advance or submit a blank edited name', async () => {
    await openDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Edit name' }));
    const input = screen.getByDisplayValue('Nova');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save & next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save & next' }));
    expect(state.updatePersona).not.toHaveBeenCalled();
    expect(input).toHaveValue('   ');
  });

  it('refines through the composer, sweeps the changed line and undoes it in one patch', async () => {
    const current = await openDraft();
    const refined = agent({ persona: { ...current.persona, personality: 'Playful in brainstorms, serious about numbers.' } });
    state.refine.mockResolvedValue({ agent: refined });
    state.updatePersona.mockResolvedValue({ agent: current });
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask Claude to change' }), { target: { value: 'More playful' } });
    await act(async () => { fireEvent.submit(screen.getByRole('textbox', { name: 'Ask Claude to change' }).closest('form')!); });

    expect(state.refine).toHaveBeenCalledWith(current.id, 'More playful');
    expect(screen.getByText('Playful in brainstorms, serious about numbers.')).toHaveClass('vx-changed');
    expect(screen.getByText(/Claude updated 1 line/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Ask Claude to change' })).toHaveValue('');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })); });
    expect(state.updatePersona).toHaveBeenCalledWith(current.id, { personality: 'Curious' });
    expect(screen.getByText('Curious')).not.toHaveClass('vx-changed');
  });

  it('shows the library role and its skills on the doc card, and Say hi opens with the role’s starters', async () => {
    state.catalog.mockResolvedValue(LIBRARY);
    await openDraft(agent({ persona: { ...agent().persona, role: 'UA Manager', roleId: 'mobile.ua-manager', skillIds: ['growth.paid-ua'] } }));
    const doc = within(screen.getByRole('article', { name: 'Nova’s persona' }));
    expect(doc.getByText(/· Mobile company/)).toBeVisible();
    expect(doc.getByRole('button', { name: 'Paid UA' })).toHaveAttribute('aria-pressed', 'true');
    expect(doc.queryByText('Expertise')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try a chat' }));
    const sheet = within(screen.getByRole('dialog', { name: 'Say hi to Nova' }));
    expect(sheet.getByRole('button', { name: 'Which geo should we test next?' })).toBeVisible();
    expect(sheet.queryByRole('button', { name: 'Introduce yourself' })).not.toBeInTheDocument();
  });

  it('shows opinions, signature moves and pet peeves when the draft has them, and edits them one per line', async () => {
    const current = await openDraft(agent({ persona: { ...agent().persona, opinions: ['Ship small', 'Measure twice'], petPeeves: [] } }));
    expect(screen.getByRole('button', { name: /^Opinions/ })).toHaveTextContent('Ship small · Measure twice');
    expect(screen.queryByRole('button', { name: /^Pet peeves/ })).not.toBeInTheDocument();
    state.updatePersona.mockResolvedValue({ agent: current });
    fireEvent.click(screen.getByRole('button', { name: /^Opinions/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /^Opinions/ }), { target: { value: 'Ship small\n\nCut scope first\n' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(state.updatePersona).toHaveBeenCalledWith(current.id, { opinions: ['Ship small', 'Cut scope first'] });
  });

  it('opens Say hi from the draft; a failed send keeps its text with Retry', async () => {
    const current = await openDraft();
    state.test.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ reply: 'Hi! I’m Nova.' });
    fireEvent.click(screen.getByRole('button', { name: 'Try a chat' }));
    const sheet = within(screen.getByRole('dialog', { name: 'Say hi to Nova' }));
    await act(async () => { fireEvent.click(sheet.getByRole('button', { name: 'Introduce yourself' })); });
    expect(state.test).toHaveBeenCalledWith(current.id, [{ role: 'user', content: 'Introduce yourself' }]);
    expect(sheet.getByText('Introduce yourself')).toHaveClass('vx-bubble', 'me', 'failed');
    await act(async () => { fireEvent.click(sheet.getByRole('button', { name: /Retry/ })); });
    expect(sheet.getByText('Hi! I’m Nova.')).toHaveClass('vx-bubble', 'agent');
    expect(sheet.queryByText(/Not sent/)).not.toBeInTheDocument();
  });
});

describe('Voice choices and language support', () => {
  const options: VoiceOptions = {
    models: [
      { id: 'eleven_v4', name: 'Eleven v4', languages: [{ code: 'en', name: 'English' }, { code: 'fa', name: 'Persian' }, { code: 'vi', name: 'Vietnamese' }], persian: true, kind: 'quality' },
      { id: 'eleven_v4_turbo', name: 'Eleven v4 Turbo', languages: [{ code: 'fa', name: 'Persian' }], persian: true, kind: 'realtime' },
    ],
    defaultVoices: [{ voiceId: 'fixture-sarah', name: 'Sarah', gender: 'female', language: 'en' }, { voiceId: 'fixture-george', name: 'George', gender: 'male', language: 'en' }],
    tier: 'free', libraryAllowed: false, ttsModel: 'eleven_v4',
  };

  async function openVoiceStep(languages = ['Persian', 'English'], extra: Partial<AgentView> = {}) {
    const current = agent(extra);
    current.persona.languages = languages;
    current.persona.presentation = 'feminine';
    if (!('voice' in extra)) current.voice = { label: 'Melania · voice library', source: 'library' };
    state.nav.me.features.voices = true;
    state.agent.mockResolvedValue({ agent: current });
    state.voiceOptions.mockResolvedValue(options);
    await act(async () => { render(<SpawnScreen draftId={current.id} />); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use Nova · choose a voice' })); });
    return current;
  }
  const library = async () => { await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Library' })); }); };

  it('shows built-ins under a segmented control; model and plan details sit behind ⓘ', async () => {
    await openVoiceStep();
    expect(screen.getByRole('tablist', { name: 'Voice source' })).toHaveClass('vx-seg');
    expect(screen.getByRole('tab', { name: 'Built-in' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Choose Sarah' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Choose George' })).toBeEnabled();
    // No "Current voice" card over the tabs (UI §4.4): the selection shows in the list, the sample sits with the language
    expect(screen.queryByText('Melania · voice library')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hear a sample in Persian' })).toHaveClass('vx-chip');
    expect(screen.queryByText(/free plan/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voice details' }));
    const details = within(screen.getByRole('dialog', { name: 'Voice details' }));
    expect(details.getByText('Voice messages use Eleven v4')).toBeVisible();
    expect(details.getByText('Real-time · Persian supported')).toBeVisible();
    expect(details.getByText(/free plan.*library voices need a paid plan/i)).toBeVisible();
    expect(state.chooseDefaultVoice).not.toHaveBeenCalled();
  });

  it('marks the chosen voice by the id the server reports, not by its label', async () => {
    await openVoiceStep(undefined, { voice: { label: 'Renamed in a later release', source: 'default', choiceId: 'fixture-george' } });
    expect(screen.getByRole('button', { name: 'Choose George' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Choose Sarah' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps one volt on the voice step: choosing is a Choose pill, the dock is the only primary', async () => {
    await openVoiceStep();
    expectOneVolt(document.body);
    expectNoRawControls(document.body);
    expect(screen.getByRole('button', { name: 'Choose Sarah' })).not.toHaveClass('vx-btn-primary');
    expect(screen.getByRole('button', { name: 'Use this voice' })).toHaveClass('vx-btn-primary');
  });

  it.each([
    ['English', 'en', 'English'], ['en', 'en', 'English'], ['Persian', 'fa', 'Persian'], ['Farsi', 'fa', 'Persian'], ['fa', 'fa', 'Persian'],
    ['Vietnamese', 'vi', 'Vietnamese'], ['vi', 'vi', 'Vietnamese'],
  ])('starts with the first persona language %s instead of preferring another language', async (language, code, label) => {
    state.searchVoices.mockResolvedValue({ voices: [] });
    await openVoiceStep([language, 'Persian', 'English']);
    await library();
    expect(screen.getByRole('button', { name: /^Voice language/ })).toHaveTextContent(label);
    expect(state.searchVoices).toHaveBeenCalledWith(expect.objectContaining({ language: code }));
  });

  it('offers English, Persian and Vietnamese shortcuts with gender chips that search at once', async () => {
    state.searchVoices.mockResolvedValue({ voices: [] });
    await openVoiceStep(['English', 'Persian']);
    const shortcuts = within(screen.getByRole('group', { name: 'Language shortcuts' }));
    expect(shortcuts.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    expect(shortcuts.getByRole('button', { name: 'Persian' })).toBeVisible();
    expect(shortcuts.getByRole('button', { name: 'Vietnamese' })).toBeVisible();
    await library();
    const gender = within(screen.getByRole('group', { name: 'Gender' }));
    expect(gender.getByRole('button', { name: 'Female' })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { fireEvent.click(gender.getByRole('button', { name: 'Male' })); });
    expect(state.searchVoices).toHaveBeenLastCalledWith(expect.objectContaining({ gender: 'male' }));
    await act(async () => { fireEvent.click(shortcuts.getByRole('button', { name: 'Vietnamese' })); });
    expect(state.searchVoices).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'vi', gender: 'male' }));
    await act(async () => { fireEvent.click(gender.getByRole('button', { name: 'Male' })); });
    expect(state.searchVoices).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'vi', gender: '' }));
    expect(state.chooseDefaultVoice).not.toHaveBeenCalled();
  });

  it('picks any library language from a searchable picker', async () => {
    state.searchVoices.mockResolvedValue({ voices: [] });
    await openVoiceStep(['English']);
    await library();
    fireEvent.click(screen.getByRole('button', { name: /^Voice language/ }));
    const picker = within(screen.getByRole('dialog', { name: 'Voice language' }));
    fireEvent.change(picker.getByRole('searchbox'), { target: { value: 'pers' } });
    await act(async () => { fireEvent.click(picker.getByRole('radio', { name: 'Persian (فارسی)' })); });
    expect(state.searchVoices).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'fa' }));
  });

  it.each([
    ['English', "Hi, I'm Nova."], ['Persian', 'سلام، من Nova هستم.'], ['Vietnamese', 'Xin chào, tôi là Nova. Rất vui được trò chuyện với bạn.'],
  ])('uses the selected %s language for a requested sample', async (language, expected) => {
    const current = await openVoiceStep(['English']);
    state.speak.mockResolvedValue(undefined);
    fireEvent.click(within(screen.getByRole('group', { name: 'Language shortcuts' })).getByRole('button', { name: language }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Hear a sample/ })); });
    expect(state.speak).toHaveBeenCalledWith(current.id, expect.stringContaining(expected));
  });

  it('starts library searches in Persian and labels native candidates while disabling paid selection', async () => {
    state.searchVoices.mockResolvedValue({ voices: [{ voiceId: 'fixture-fa', publicOwnerId: 'fixture-owner', name: 'Native Farsi',
      language: 'fa', category: 'professional', gender: 'female', age: 'young', accent: 'standard', descriptive: 'warm', rate: 1 }] });
    await openVoiceStep();
    await library();
    expect(state.searchVoices).toHaveBeenCalledWith(expect.objectContaining({ language: 'fa', gender: 'female' }));
    expect(state.searchVoices.mock.calls[0][0]).not.toHaveProperty('category');
    expect(screen.getByText('Native language: Persian (فارسی)')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choose Native Farsi' })).toBeDisabled();
    expect(screen.getByText(/can’t be chosen on this workspace’s plan/)).toBeVisible();
  });

  it('narrows the library by accent on the next search and shows each voice’s own description', async () => {
    state.searchVoices.mockResolvedValue({ voices: [{ voiceId: 'fixture-uk', publicOwnerId: 'fixture-owner', name: 'Clara',
      language: 'en', category: 'professional', gender: 'female', accent: 'british', description: 'Warm audiobook narrator.' }] });
    await openVoiceStep(['English']);
    await library();
    expect(screen.getByText('Warm audiobook narrator.')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Accent' }), { target: { value: 'british' } });
    await act(async () => { fireEvent.keyDown(screen.getByRole('textbox', { name: 'Accent' }), { key: 'Enter' }); });
    expect(state.searchVoices).toHaveBeenLastCalledWith(expect.objectContaining({ accent: 'british', language: 'en', gender: 'female' }));
  });

  it('includes generated Persian voices without calling them native recordings', async () => {
    state.searchVoices.mockResolvedValue({ voices: [{ voiceId: 'fixture-generated', publicOwnerId: 'fixture-owner', name: 'Generated Farsi',
      language: 'fa', category: 'generated', gender: 'female', age: 'young', accent: 'tehrani', descriptive: 'warm' }] });
    await openVoiceStep();
    await library();
    expect(screen.getByText('Generated Farsi')).toBeVisible();
    expect(screen.getByText('Language: Persian (فارسی)')).toBeVisible();
    expect(screen.getByText(/female · young · tehrani · warm · Generated voice/)).toBeVisible();
    expect(screen.queryByText('Native language: Persian (فارسی)')).not.toBeInTheDocument();
  });

  it('waits for a confirmed built-in selection and samples it in Persian', async () => {
    const current = await openVoiceStep();
    let finish!: (value: { agent: AgentView }) => void;
    state.chooseDefaultVoice.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choose Sarah' })); });
    expect(state.chooseDefaultVoice).toHaveBeenCalledWith(current.id, 'fixture-sarah');
    expect(screen.getByRole('button', { name: 'Choose Sarah' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Choose George' })).toBeDisabled();
    await act(async () => { finish({ agent: { ...current, voice: { label: 'Sarah · built-in', source: 'default' } } }); });
    expect(screen.getByRole('button', { name: 'Choose Sarah' })).toHaveTextContent('Chosen');
    expect(screen.getByRole('button', { name: 'Choose Sarah' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Choose Sarah' }).closest('.vx-option')).toHaveClass('selected');
    expect(screen.getByRole('button', { name: 'Choose George' })).toHaveTextContent('Choose');
    state.speak.mockResolvedValue(undefined);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Hear a sample/ })); });
    expect(state.speak).toHaveBeenCalledWith(current.id, expect.stringContaining('سلام'));
  });

  it('designs three takes from the editable brief, then offers Design 3 more', async () => {
    const current = await openVoiceStep(['English'], { voice: undefined });
    expect(screen.getByRole('button', { name: 'Skip · text only' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe the voice' }), { target: { value: 'Warm alto, calm pace, light Persian accent' } });
    state.designVoices.mockResolvedValue({ agent: { ...current, voicePreviews: [
      { generatedVoiceId: 'g1', file: 'a.mp3' }, { generatedVoiceId: 'g2', file: 'b.mp3' }, { generatedVoiceId: 'g3', file: 'c.mp3' },
    ] } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Design 3 voices' })); });
    expect(state.designVoices).toHaveBeenCalledWith(current.id, 'Warm alto, calm pace, light Persian accent');
    expect(screen.getByRole('button', { name: 'Choose take C' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Design 3 more' })).toHaveClass('vx-btn-ghost');
    expectOneVolt(document.body);
  });

  it('keeps catalogue failures visible and lets the visitor retry without generating audio', async () => {
    // Set the rejection after openVoiceStep installs its default mock.
    const current = agent();
    state.nav.me.features.voices = true;
    state.agent.mockResolvedValue({ agent: current });
    state.voiceOptions.mockRejectedValueOnce(new Error('ElevenLabs is temporarily unavailable.')).mockResolvedValueOnce(options);
    await act(async () => { render(<SpawnScreen draftId={current.id} />); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use Nova · choose a voice' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Can’t load voice options');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry voice options' })); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose Sarah' })).toBeEnabled();
    expect(state.speak).not.toHaveBeenCalled();
  });
});

describe('Discarding a draft', () => {
  it('asks in a confirm sheet, not window.confirm, and keeps the draft on Keep', async () => {
    const current = agent({ status: 'draft' });
    state.agent.mockResolvedValue({ agent: current });
    state.deleteDraft.mockResolvedValue({ ok: true });
    const native = vi.spyOn(window, 'confirm');
    await act(async () => { render(<ConfirmProvider><SpawnScreen draftId={current.id} /></ConfirmProvider>); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Discard draft' })); });
    const sheet = within(screen.getByRole('dialog', { name: `Discard ${current.persona.name}?` }));
    await act(async () => { fireEvent.click(sheet.getByRole('button', { name: 'Keep' })); });
    expect(state.deleteDraft).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Discard draft' })); });
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: `Discard ${current.persona.name}?` })).getByRole('button', { name: 'Discard draft' })); });
    expect(state.deleteDraft).toHaveBeenCalledWith(current.id);
    expect(state.nav.reset).toHaveBeenCalledWith({ name: 'home' });
    expect(native).not.toHaveBeenCalled();
  });
});

describe('Hire', () => {
  it('publishes, opens Telegram and keeps the link for Open Telegram again', async () => {
    const current = agent();
    const waiting = agent({ status: 'awaiting_bot' });
    state.agent.mockResolvedValueOnce({ agent: current }).mockResolvedValue({ agent: waiting });
    state.publish.mockResolvedValue({ link: 'https://t.me/newbot/fixture', agent: waiting });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await act(async () => { render(<SpawnScreen draftId={current.id} />); });
    fireEvent.click(screen.getByRole('button', { name: 'Use Nova · choose a voice' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next · look' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('How it looks in Telegram')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Nova in Telegram' })).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hire Nova' })); });
    expect(open).toHaveBeenCalledWith('https://t.me/newbot/fixture', '_blank', 'noopener');
    expect(screen.getByRole('heading', { name: 'Confirm in Telegram' })).toBeVisible();
    expect(window.localStorage.getItem(`vx:hire-link:${current.id}`)).toBe('https://t.me/newbot/fixture');
    fireEvent.click(screen.getByRole('button', { name: /open telegram again/i }));
    expect(open).toHaveBeenCalledTimes(2);
    expect(state.publish).toHaveBeenCalledTimes(1);
  });
});

describe('Telegram profile completion', () => {
  it.each([undefined, { status: 'pending' as const, failed: [] }])('keeps checking an active bot with profile state %j until it is synced', async profileSync => {
    const waiting = agent({ status: 'awaiting_bot' });
    const active = agent({ status: 'active', stage: 1, bot: { username: 'fixture_nova_bot' }, profileSync,
      look: { ...waiting.look, avatar: 'fixture-avatar.jpg' } });
    const ready = { ...active, profileSync: { status: 'synced' as const, failed: [] } };
    state.agent.mockResolvedValueOnce({ agent: waiting }).mockResolvedValueOnce({ agent: active }).mockResolvedValueOnce({ agent: ready });
    await act(async () => { render(<SpawnScreen draftId={waiting.id} />); });
    expect(screen.getByText(/the name is filled in where supported/i)).toHaveTextContent('Vox then applies the chosen name and photo');

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('Updating Telegram…')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Nova is hired' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Message' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByRole('heading', { name: 'Nova is hired' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Nova in Telegram' })).toHaveAttribute('src', expect.stringContaining('fixture-avatar.jpg'));
    expect(screen.queryByText('Updating Telegram…')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(state.agent).toHaveBeenCalledTimes(3);
  });

  it('shows profile failures without blocking the bot and keeps failed retries available', async () => {
    const waiting = agent({ status: 'awaiting_bot' });
    const failed = agent({ status: 'active', stage: 1, bot: { username: 'fixture_nova_bot' }, profileSync: { status: 'error', failed: ['photo'] } });
    const ready = { ...failed, profileSync: { status: 'synced' as const, failed: [] } };
    state.agent.mockResolvedValueOnce({ agent: waiting }).mockResolvedValue({ agent: failed });
    state.syncProfile.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ agent: ready, failed: [] });
    await act(async () => { render(<SpawnScreen draftId={waiting.id} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('Couldn’t update the photo')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Message' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry Telegram profile' })); });
    expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('Failed to fetch'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Retry Telegram profile' })).toBeEnabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry Telegram profile' })); });
    expect(state.syncProfile).toHaveBeenCalledWith(failed.id);
    expect(screen.getByRole('heading', { name: 'Nova is hired' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(state.nav.cache.get(failed.id)).toBeDefined();
    expect(state.nav.reset).toHaveBeenCalledWith({ name: 'home' }, { name: 'agent', id: failed.id });
  });

  it('shows the failure but no repair control to a viewer without edit or management access', async () => {
    const waiting = agent({ status: 'awaiting_bot' });
    const failed = agent({ status: 'active', stage: 1, canEdit: false, canManageAccess: false, profileSync: { status: 'error', failed: ['name'] } });
    state.agent.mockResolvedValueOnce({ agent: waiting }).mockResolvedValue({ agent: failed });
    await act(async () => { render(<SpawnScreen draftId={waiting.id} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('Telegram profile still updating')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry Telegram profile' })).not.toBeInTheDocument();
    expect(state.syncProfile).not.toHaveBeenCalled();
  });

  it('offers repair on an older agent page and only removes the warning after confirmed sync', async () => {
    const failed = agent({ status: 'active', bot: { username: 'fixture_nova_bot' }, profileSync: { status: 'error', failed: ['photo'] } });
    const ready = { ...failed, profileSync: { status: 'synced' as const, failed: [] } };
    state.agent.mockResolvedValue({ agent: failed });
    let finish!: (value: { agent: AgentView; failed: string[] }) => void;
    state.syncProfile.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await act(async () => { render(<AgentScreen id={failed.id} />); });
    // The status row's copy belongs to ProfileSyncStatus (its own tests); here: the screen's repair round trip.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry Telegram profile' })); });
    expect(state.syncProfile).toHaveBeenCalledWith(failed.id);
    expect(state.nav.toast).not.toHaveBeenCalled();
    await act(async () => { finish({ agent: ready, failed: [] }); });
    expect(screen.queryByRole('button', { name: 'Retry Telegram profile' })).not.toBeInTheDocument();
    expect(state.nav.toast).toHaveBeenCalledWith('Telegram profile updated');
  });

  it('clears an older agent’s pending profile after background repair without repeating polling requests', async () => {
    const pending = agent({ status: 'active', profileSync: { status: 'pending', failed: [] } });
    const ready = { ...pending, profileSync: { status: 'synced' as const, failed: [] } };
    let finish!: (value: { agent: AgentView }) => void;
    state.agent.mockResolvedValueOnce({ agent: pending }).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await act(async () => { render(<AgentScreen id={pending.id} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(state.agent).toHaveBeenCalledTimes(2);
    await act(async () => { finish({ agent: ready }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(state.agent).toHaveBeenCalledTimes(2);
    expect(state.nav.toast).not.toHaveBeenCalled();
  });
});
