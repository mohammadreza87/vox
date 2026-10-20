import { act, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type AgentView, type VoiceOptions } from '../../_lib/client';
import { SpawnScreen } from './Spawn';
import { AgentScreen } from './Agent';

const state = vi.hoisted(() => ({
  catalog: vi.fn(), route: vi.fn(),
  draft: vi.fn(),
  agent: vi.fn(),
  updatePersona: vi.fn(),
  syncProfile: vi.fn(),
  voiceOptions: vi.fn(), chooseDefaultVoice: vi.fn(), searchVoices: vi.fn(), speak: vi.fn(),
  nav: {
    me: { org: 'Fixture team', member: { telegramId: 7777001, role: 'member' }, features: { avatars: false, voices: false, calls: false } },
    back: vi.fn(), reset: vi.fn(), push: vi.fn(), toast: vi.fn(), refreshMe: vi.fn(),
    // No sheet is opened here: Back is never guarded.
    guardBack: () => () => {}, consumeBack: () => false,
  },
}));

vi.mock('../../_lib/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, catalog: state.catalog, route: state.route, draft: state.draft, agent: state.agent, updatePersona: state.updatePersona, syncProfile: state.syncProfile,
    voiceOptions: state.voiceOptions, chooseDefaultVoice: state.chooseDefaultVoice, searchVoices: state.searchVoices, speak: state.speak } };
});

vi.mock('../StudioApp', () => ({
  useNav: () => state.nav,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'Unexpected operation error',
  LoadingFill: () => null,
}));

// These regressions exercise API failures, retry state and polling, not animation timing.
vi.mock('framer-motion', async () => {
  const { createElement } = await import('react');
  const MOTION_PROPS = ['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layoutId', 'layout', 'variants',
    'drag', 'dragConstraints', 'dragElastic', 'onDragEnd'];
  const cache = new Map<string, (props: { children?: ReactNode; [key: string]: unknown }) => ReactNode>();
  const element = (tag: string) => {
    if (!cache.has(tag)) cache.set(tag, function MotionElement({ children, ...props }) {
      return createElement(tag, Object.fromEntries(Object.entries(props).filter(([key]) => !MOTION_PROPS.includes(key))), children);
    });
    return cache.get(tag)!;
  };
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    motion: new Proxy({}, { get: (_target, tag: string) => element(tag) }),
    useReducedMotion: () => false,
  };
});

function agent(overrides: Partial<AgentView> = {}): AgentView {
  return {
    id: 'fixture-agent', status: 'draft',
    persona: {
      name: 'Nova', role: 'Designer', tagline: 'Finds the fun', backstory: 'A helpful teammate.',
      personality: 'Curious', communicationStyle: 'Clear', values: ['Craft'], expertise: ['Design'],
      wontDo: 'Legal advice', languages: ['English'], culture: '', presentation: 'neutral',
      age: '30s', accent: '', voiceBrief: 'A clear voice.', avatarHint: '',
    },
    look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } },
    locked: false, formingDay: null, isAdmin: false, visibility: 'private', access: [],
    createdBy: 7777001, canEdit: true, canFire: false, canManageAccess: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); state.nav.me.features.voices = false;
  // An empty library (content is still being written): the Brief degrades to plain free text.
  state.catalog.mockResolvedValue({ version: 'empty', packs: [], roles: [], skills: [] });
  state.route.mockResolvedValue({ skillIds: [], confidence: 0, alternatives: [], source: 'local' });
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('Spawn failure recovery', () => {
  it('keeps a failed draft error inline (no extra toast) with the visitor’s brief still available', async () => {
    const message = 'Vox Studio returned an unexpected page. Close and reopen the Mini App, then try again.';
    state.draft.mockRejectedValue(new ApiError(200, message));
    render(<SpawnScreen />);
    fireEvent.change(screen.getByRole('textbox', { name: /describe who you need/i }), { target: { value: 'An analytical teammate' } });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });
    expect(state.nav.toast).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('textbox', { name: /describe who you need/i })).toHaveValue('An analytical teammate');
    expect(screen.getByRole('button', { name: /draft with claude/i })).toBeEnabled();
  });

  it.each([
    ['an expired session', new ApiError(401, 'Open Vox Studio from Telegram.')],
    ['a network failure', new TypeError('Failed to fetch')],
  ])('shows %s during Telegram confirmation and still completes after polling recovers', async (_label, error) => {
    const waiting = agent({ status: 'awaiting_bot' });
    const active = agent({ status: 'active', bot: { username: 'fixture_nova_bot' }, profileSync: { status: 'synced', failed: [] } });
    state.agent.mockResolvedValueOnce({ agent: waiting }).mockRejectedValueOnce(error).mockResolvedValueOnce({ agent: active });
    await act(async () => { render(<SpawnScreen draftId={waiting.id} />); });
    expect(screen.getByText('Waiting for Telegram…')).toBeVisible();

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.queryByText('Waiting for Telegram…')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(error.message);
    expect(screen.getByRole('button', { name: /open telegram again/i })).toBeEnabled();

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nova is hired' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Message' })).toBeEnabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(state.agent).toHaveBeenCalledTimes(3);
  });

  it('moves from the actual Brief button to the editable Persona step after a successful draft', async () => {
    state.draft.mockResolvedValue({ agent: agent(), names: ['Nova', 'Alt'] });
    render(<SpawnScreen />);
    fireEvent.change(screen.getByRole('textbox', { name: /describe who you need/i }), { target: { value: 'A curious designer' } });
    // Languages, culture, accent, presentation and temperament live behind one Fine-tune row.
    expect(screen.queryByRole('button', { name: 'Persian' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /fine-tune/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Persian' }));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draft with claude/i })); });

    expect(state.draft).toHaveBeenCalledWith(expect.objectContaining({ description: 'A curious designer', languages: ['Persian'] }), undefined);
    expect(screen.queryByRole('button', { name: /draft with claude/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nova' })).toBeVisible();
    expect(screen.getByRole('button', { name: /use nova · pick a look/i })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

  async function openVoiceStep(languages = ['Persian', 'English']) {
    const current = agent();
    current.persona.languages = languages;
    current.persona.presentation = 'feminine';
    current.voice = { label: 'Melania · voice library', source: 'library' };
    state.nav.me.features.voices = true;
    state.agent.mockResolvedValue({ agent: current });
    state.voiceOptions.mockResolvedValue(options);
    await act(async () => { render(<SpawnScreen draftId={current.id} />); });
    fireEvent.click(screen.getByRole('button', { name: /use .* pick a look/i }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })); });
    return current;
  }

  it('shows usable built-ins, Persian-capable models, and the plan restriction without changing the selected voice', async () => {
    await openVoiceStep();
    expect(screen.getByRole('button', { name: 'Built-in voices' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Use Sarah' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Use George' })).toBeEnabled();
    expect(screen.getByText('Melania · voice library')).toBeVisible();
    expect(screen.getByText(/free plan.*library voices need a paid plan/i)).toBeVisible();
    expect(screen.getByText('Voice messages: Eleven v4 · Persian supported')).toBeVisible();
    fireEvent.click(screen.getByText('Available speech models'));
    expect(screen.getByText(/Eleven v4 Turbo · Real-time · Persian supported/)).toBeVisible();
    expect(state.chooseDefaultVoice).not.toHaveBeenCalled();
  });

  it.each([
    ['English', 'en'], ['en', 'en'], ['Persian', 'fa'], ['Farsi', 'fa'], ['fa', 'fa'], ['Vietnamese', 'vi'], ['vi', 'vi'],
  ])('starts with the first persona language %s instead of preferring another language', async (language, code) => {
    state.searchVoices.mockResolvedValue({ voices: [] });
    await openVoiceStep([language, 'Persian', 'English']);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Voice library' })); });
    expect(screen.getByRole('combobox', { name: 'Voice language' })).toHaveValue(code);
    expect(state.searchVoices).toHaveBeenCalledWith(expect.objectContaining({ language: code }));
  });

  it('offers English, Persian and Vietnamese shortcuts with male and any-gender library filters', async () => {
    state.searchVoices.mockResolvedValue({ voices: [] });
    await openVoiceStep(['English', 'Persian']);
    expect(screen.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Persian', exact: true })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Vietnamese', exact: true })).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Voice library' })); });
    fireEvent.change(screen.getByRole('combobox', { name: 'Gender' }), { target: { value: 'male' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Vietnamese', exact: true })); });
    expect(state.searchVoices).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'vi', gender: 'male' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Gender' }), { target: { value: '' } });
    expect(screen.getByRole('option', { name: 'Any gender' })).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'English', exact: true })); });
    expect(state.searchVoices).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'en', gender: '' }));
    expect(screen.getByText('Melania · voice library')).toBeVisible();
    expect(state.chooseDefaultVoice).not.toHaveBeenCalled();
  });

  it.each([
    ['English', "Hi, I'm Nova."], ['Persian', 'سلام، من Nova هستم.'], ['Vietnamese', 'Xin chào, tôi là Nova. Rất vui được trò chuyện với bạn.'],
  ])('uses the selected %s language for a requested sample', async (language, expected) => {
    const current = await openVoiceStep(['English']);
    state.speak.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: language, exact: true }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hear a sample' })); });
    expect(state.speak).toHaveBeenCalledWith(current.id, expect.stringContaining(expected));
  });

  it('starts library searches in Persian and labels native candidates while disabling paid selection', async () => {
    state.searchVoices.mockResolvedValue({ voices: [{ voiceId: 'fixture-fa', publicOwnerId: 'fixture-owner', name: 'Native Farsi',
      language: 'fa', category: 'professional', gender: 'female', age: 'young', accent: 'standard', descriptive: 'warm', rate: 1 }] });
    await openVoiceStep();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Voice library' })); });
    expect(screen.getByRole('combobox', { name: 'Voice language' })).toHaveValue('fa');
    expect(state.searchVoices).toHaveBeenCalledWith(expect.objectContaining({ language: 'fa', gender: 'female' }));
    expect(state.searchVoices.mock.calls[0][0]).not.toHaveProperty('category');
    expect(screen.getByText('Native language: Persian (فارسی)')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Use Native Farsi' })).toBeDisabled();
  });

  it('includes generated Persian voices without calling them native recordings', async () => {
    state.searchVoices.mockResolvedValue({ voices: [{ voiceId: 'fixture-generated', publicOwnerId: 'fixture-owner', name: 'Generated Farsi',
      language: 'fa', category: 'generated', gender: 'female', age: 'young', accent: 'tehrani', descriptive: 'warm' }] });
    await openVoiceStep();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Voice library' })); });
    expect(screen.getByText('Generated Farsi')).toBeVisible();
    expect(screen.getByText('Language: Persian (فارسی)')).toBeVisible();
    expect(screen.getByText(/female · young · tehrani · warm · Generated voice/)).toBeVisible();
    expect(screen.queryByText('Native language: Persian (فارسی)')).not.toBeInTheDocument();
  });

  it('waits for a confirmed built-in selection and samples it in Persian', async () => {
    const current = await openVoiceStep();
    let finish!: (value: { agent: AgentView }) => void;
    state.chooseDefaultVoice.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use Sarah' })); });
    expect(state.chooseDefaultVoice).toHaveBeenCalledWith(current.id, 'fixture-sarah');
    expect(screen.getByText('Melania · voice library')).toBeVisible();
    expect(screen.queryByText('Sarah · built-in')).not.toBeInTheDocument();
    await act(async () => { finish({ agent: { ...current, voice: { label: 'Sarah · built-in', source: 'default' } } }); });
    expect(screen.getByText('Sarah · built-in')).toBeVisible();
    state.speak.mockResolvedValue(undefined);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hear a sample' })); });
    expect(state.speak).toHaveBeenCalledWith(current.id, expect.stringContaining('سلام'));
  });

  it('keeps catalogue failures visible and lets the visitor retry without generating audio', async () => {
    // Set the rejection after openVoiceStep installs its default mock.
    const current = agent();
    state.nav.me.features.voices = true;
    state.agent.mockResolvedValue({ agent: current });
    state.voiceOptions.mockRejectedValueOnce(new Error('ElevenLabs is temporarily unavailable.')).mockResolvedValueOnce(options);
    await act(async () => { render(<SpawnScreen draftId={current.id} />); });
    fireEvent.click(screen.getByRole('button', { name: /use .* pick a look/i }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Can’t load voice options');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry voice options' })); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use Sarah' })).toBeEnabled();
    expect(state.speak).not.toHaveBeenCalled();
  });
});

describe('Persona edits before advancing', () => {
  it.each([
    ['Name', 'Nova', 'Neda', 'name'],
    ['Personality', 'Curious', 'Warm and curious', 'personality'],
  ])('saves an edited %s and waits for confirmation before Next', async (label, original, value, field) => {
    const current = agent();
    state.agent.mockResolvedValue({ agent: current });
    let finish!: (value: { agent: AgentView }) => void;
    state.updatePersona.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await act(async () => { render(<SpawnScreen draftId={current.id} />); });
    fireEvent.click(screen.getByRole('button', { name: `${label}${original} Edit` }));
    fireEvent.change(screen.getByDisplayValue(original), { target: { value } });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save & next' })); });

    expect(state.updatePersona).toHaveBeenCalledExactlyOnceWith(current.id, { [field]: value });
    expect(screen.getByDisplayValue(value)).toBeVisible();
    expect(screen.queryByRole('heading', { name: /shape .* cloud/i })).not.toBeInTheDocument();
    const saved = agent({ persona: { ...current.persona, [field]: value } });
    await act(async () => { finish({ agent: saved }); });
    expect(screen.getByRole('heading', { name: `Shape ${saved.persona.name}’s cloud` })).toBeVisible();
  });

  it('preserves an invalid edit and its error, then advances after a successful retry', async () => {
    const current = agent();
    const saved = agent({ persona: { ...current.persona, name: 'Neda' } });
    state.agent.mockResolvedValue({ agent: current });
    state.updatePersona.mockRejectedValueOnce(new ApiError(400, 'Name must be 40 characters or fewer.')).mockResolvedValueOnce({ agent: saved });
    await act(async () => { render(<SpawnScreen draftId={current.id} />); });
    fireEvent.click(screen.getByRole('button', { name: 'NameNova Edit' }));
    fireEvent.change(screen.getByDisplayValue('Nova'), { target: { value: 'N'.repeat(41) } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save & next' })); });

    expect(screen.getByRole('alert')).toHaveTextContent('Name must be 40 characters or fewer.');
    expect(screen.getByDisplayValue('N'.repeat(41))).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save & next' })).toBeEnabled();
    fireEvent.change(screen.getByDisplayValue('N'.repeat(41)), { target: { value: 'Neda' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save & next' })); });
    expect(screen.getByRole('heading', { name: 'Shape Neda’s cloud' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not advance or submit a blank edited name', async () => {
    const current = agent();
    state.agent.mockResolvedValue({ agent: current });
    await act(async () => { render(<SpawnScreen draftId={current.id} />); });
    fireEvent.click(screen.getByRole('button', { name: 'NameNova Edit' }));
    const input = screen.getByDisplayValue('Nova');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save & next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save & next' }));
    expect(state.updatePersona).not.toHaveBeenCalled();
    expect(input).toHaveValue('   ');
  });
});

describe('Telegram profile completion', () => {
  it.each([undefined, { status: 'pending' as const, failed: [] }])('keeps checking an active bot with profile state %j until it is synced', async profileSync => {
    const waiting = agent({ status: 'awaiting_bot' });
    const active = agent({ status: 'active', bot: { username: 'fixture_nova_bot' }, profileSync,
      look: { ...waiting.look, avatar: 'fixture-avatar.jpg' } });
    const ready = { ...active, profileSync: { status: 'synced' as const, failed: [] } };
    state.agent.mockResolvedValueOnce({ agent: waiting }).mockResolvedValueOnce({ agent: active }).mockResolvedValueOnce({ agent: ready });
    await act(async () => { render(<SpawnScreen draftId={waiting.id} />); });
    expect(screen.getByText(/the name is filled in where supported/i)).toHaveTextContent('Vox then applies the chosen name and photo');

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByRole('status')).toHaveTextContent('Finishing Telegram profile…');
    expect(screen.queryByRole('heading', { name: 'Nova is hired' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Message' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByRole('heading', { name: 'Nova is hired' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Nova' })).toHaveAttribute('src', expect.stringContaining('fixture-avatar.jpg'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(state.agent).toHaveBeenCalledTimes(3);
  });

  it('shows profile failures without blocking the bot and keeps failed retries available', async () => {
    const waiting = agent({ status: 'awaiting_bot' });
    const failed = agent({ status: 'active', bot: { username: 'fixture_nova_bot' }, profileSync: { status: 'error', failed: ['photo'] } });
    const ready = { ...failed, profileSync: { status: 'synced' as const, failed: [] } };
    state.agent.mockResolvedValueOnce({ agent: waiting }).mockResolvedValue({ agent: failed });
    state.syncProfile.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ agent: ready, failed: [] });
    await act(async () => { render(<SpawnScreen draftId={waiting.id} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByRole('alert')).toHaveTextContent('Bot created. Telegram profile still needs photo.');
    expect(screen.getByRole('button', { name: 'Message' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry Telegram profile' })); });
    expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('Failed to fetch'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Retry Telegram profile' })).toBeEnabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry Telegram profile' })); });
    expect(state.syncProfile).toHaveBeenCalledWith(failed.id);
    expect(screen.getByRole('heading', { name: 'Nova is hired' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the failure but no repair control to a viewer without edit or management access', async () => {
    const waiting = agent({ status: 'awaiting_bot' });
    const failed = agent({ status: 'active', canEdit: false, canManageAccess: false, profileSync: { status: 'error', failed: ['name'] } });
    state.agent.mockResolvedValueOnce({ agent: waiting }).mockResolvedValue({ agent: failed });
    await act(async () => { render(<SpawnScreen draftId={waiting.id} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByRole('alert')).toHaveTextContent('Telegram profile still needs name.');
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
    expect(screen.getByRole('alert')).toHaveTextContent('Telegram profile still needs photo.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry Telegram profile' })); });
    expect(screen.getByRole('alert')).toBeVisible();
    expect(state.nav.toast).not.toHaveBeenCalled();
    await act(async () => { finish({ agent: ready, failed: [] }); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry Telegram profile' })).not.toBeInTheDocument();
    expect(state.nav.toast).toHaveBeenCalledWith('Telegram profile updated');
  });

  it('clears an older agent’s pending profile after background repair without repeating polling requests', async () => {
    const pending = agent({ status: 'active', profileSync: { status: 'pending', failed: [] } });
    const ready = { ...pending, profileSync: { status: 'synced' as const, failed: [] } };
    let finish!: (value: { agent: AgentView }) => void;
    state.agent.mockResolvedValueOnce({ agent: pending }).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await act(async () => { render(<AgentScreen id={pending.id} />); });
    expect(screen.getByRole('status')).toHaveTextContent('Finishing Telegram profile…');
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(state.agent).toHaveBeenCalledTimes(2);
    await act(async () => { finish({ agent: ready }); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(state.agent).toHaveBeenCalledTimes(2);
    expect(state.nav.toast).not.toHaveBeenCalled();
  });
});
