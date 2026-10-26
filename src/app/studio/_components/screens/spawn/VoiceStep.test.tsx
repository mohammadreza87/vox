import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../../_lib/client';
import { VoiceStep } from './VoiceStep';

const state = vi.hoisted(() => ({ voiceOptions: vi.fn(), chooseDefaultVoice: vi.fn(), designVoices: vi.fn(), nav: null as unknown as Record<string, unknown> }));

vi.mock('../../../_lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../_lib/client')>();
  return { ...actual, api: { ...actual.api, voiceOptions: state.voiceOptions, chooseDefaultVoice: state.chooseDefaultVoice, designVoices: state.designVoices } };
});
vi.mock('../../StudioApp', () => ({ useNav: () => state.nav, errorMessage: (e: unknown) => (e instanceof Error ? e.message : 'error') }));

function agent(o: Partial<AgentView> = {}): AgentView {
  return {
    id: 'nova', status: 'draft',
    persona: { name: 'Nova', role: 'Designer', tagline: '', backstory: '', personality: '', communicationStyle: '', values: [], expertise: [], wontDo: '',
      languages: ['English'], culture: '', presentation: 'neutral', age: '30s', accent: '', voiceBrief: 'A clear, warm voice for a designer, calm and kind', avatarHint: '' },
    look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } },
    locked: false, formingDay: null, isAdmin: false, visibility: 'private', access: [], createdBy: 300, creatorName: 'Alice Example',
    canEdit: true, canFire: false, canManageAccess: true, canShapeIdentity: true,
    ...o,
  };
}
function nav(settingsV2?: boolean) {
  state.nav = {
    locale: 'en', dir: 'ltr', tier: 'full', snack: vi.fn(), toast: vi.fn(), back: vi.fn(), push: vi.fn(),
    me: { org: 'HOOR', member: { telegramId: 200, role: 'admin' }, features: { voices: true, ...(settingsV2 === undefined ? {} : { settingsV2 }) } },
  };
}
async function open(view: AgentView) {
  const run = vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn());
  await act(async () => { render(<VoiceStep agent={view} busy={null} run={run as never} onUpdate={vi.fn()} onNext={vi.fn()} />); });
  return run;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.voiceOptions.mockResolvedValue({ models: [], tier: 'creator', libraryAllowed: true, ttsModel: 'm',
    defaultVoices: [{ voiceId: 'warm', name: 'Warm', previewUrl: '' }, { voiceId: 'bright', name: 'Bright', previewUrl: '' }] });
});
afterEach(cleanup);

describe('spawn VoiceStep under the creator-only voice rule', () => {
  it('an editor who is not the creator sees the voices read-only and is told who chooses', async () => {
    nav();
    const run = await open(agent({ canShapeIdentity: false }));
    expect(screen.getByText('Only Alice can choose Nova’s voice.')).toBeInTheDocument();
    for (const name of ['Choose Warm', 'Choose Bright']) expect(await screen.findByRole('button', { name })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Choose Bright' }));
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
    expect(screen.getByRole('button', { name: /Design 3 voices/i })).toBeDisabled();
  });

  it('the creator chooses as before', async () => {
    nav();
    state.chooseDefaultVoice.mockResolvedValue({ agent: agent({ voice: { label: 'Bright · built-in', source: 'default', choiceId: 'bright' } }) });
    await open(agent());
    expect(screen.queryByText(/can choose Nova’s voice/)).toBeNull();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Choose Bright' })); });
    expect(state.chooseDefaultVoice).toHaveBeenCalledWith('nova', 'bright');
  });

  it('the hint matches the forming rule with Settings v2, and stays as before with the flag off', async () => {
    nav(true);
    await open(agent());
    expect(screen.getByText(/You can change it for 7 days after hiring, then it stays\./)).toBeInTheDocument();
    cleanup();
    for (const flag of [false, undefined]) {
      nav(flag);
      await open(agent());
      expect(screen.getByText('Same voice for everyone in HOOR. Fixed once hired.')).toBeInTheDocument();
      cleanup();
    }
  });
});
