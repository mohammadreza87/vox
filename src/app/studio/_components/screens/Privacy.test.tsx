import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivacyScreen } from './Privacy';
import type { AdaptiveSnapshot } from '../../_lib/adaptive-client';

const mocks = vi.hoisted(() => ({ read: vi.fn(), confirm: vi.fn(), present: vi.fn(), consent: vi.fn(), save: vi.fn(), correct: vi.fn(), remove: vi.fn(), agent: vi.fn(), agents: vi.fn() }));
vi.mock('../../_lib/adaptive-client', () => ({ adaptiveApi: mocks }));
vi.mock('../ProductPausePanel', () => ({ ProductPausePanel: () => null }));
vi.mock('../../_lib/product-pause-client', () => ({ useProductPause: () => ({ coveredBlocked: false, status: null }) }));
vi.mock('../../_lib/client', () => ({ tg: () => null, api: { agents: mocks.agents } }));
const snapshot = (extra: Partial<AdaptiveSnapshot> = {}): AdaptiveSnapshot => ({
  schemaVersion: 1, revision: 2, space: 'work', scope: 'private_account_profile',
  identity: { accountId: 'synthetic-account', personId: 'synthetic-person', confirmed: true, verification: 'account_confirmation', adultDeclared: true },
  purposes: [{ purpose: 'optional.personalization', state: 'not_asked', revision: 1, available: true,
    notice: { id: 'synthetic-notice', version: 'synthetic-v1', title: 'Personalization terms', body: 'Synthetic exact notice.', copyHash: 'synthetic-hash', locale: 'en' } }],
  memories: [], agents: [], explicitMemoryAvailable: true, ...extra,
});
beforeEach(() => { vi.resetAllMocks(); mocks.read.mockResolvedValue(snapshot()); mocks.agents.mockResolvedValue({ agents: [] }); });
afterEach(cleanup);

describe('Privacy and memory controls', () => {
  it('does not grant anything on load or on a space switch and clears previous-space text immediately', async () => {
    mocks.read.mockResolvedValueOnce(snapshot({ memories: [{ id: 'private-note', text: 'WORK_ONLY_SECRET', revision: 1, createdAt: 1, expiresAt: 2_000_000_000_000 }] }));
    render(<PrivacyScreen />);
    expect(await screen.findAllByText('WORK_ONLY_SECRET')).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: 'WORK_ONLY_SECRET' })).toBeVisible();
    mocks.read.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(screen.getByRole('button', { name: 'Personal', exact: true }));
    await waitFor(() => expect(screen.queryAllByText('WORK_ONLY_SECRET')).toHaveLength(0));
    expect(screen.queryByRole('checkbox', { name: 'WORK_ONLY_SECRET' })).not.toBeInTheDocument();
    expect(mocks.consent).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('presents server receipt copy before grant and offers an equal keep-off action', async () => {
    const presented = snapshot({ purposes: [{ ...snapshot().purposes[0], state: 'presented', revision: 2 }] });
    mocks.present.mockResolvedValue({ ...presented, receipt: 'receipt-from-server', notice: presented.purposes[0].notice });
    mocks.consent.mockResolvedValue(snapshot({ purposes: [{ ...snapshot().purposes[0], state: 'declined', revision: 3 }] }));
    render(<PrivacyScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review choice' }));
    await screen.findByText('Synthetic exact notice.');
    expect(mocks.consent).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep off' }));
    await waitFor(() => expect(mocks.consent).toHaveBeenCalledWith('work', 'optional.personalization', 2, 'declined', 'receipt-from-server'));
  });
  it('never claims failed deletion succeeded and retains the visible authoritative note', async () => {
    mocks.read.mockResolvedValue(snapshot({ memories: [{ id: 'm', text: 'A synthetic note', revision: 4, createdAt: 1, expiresAt: 2_000_000_000_000 }] }));
    mocks.remove.mockRejectedValue(new Error('conflict'));
    render(<PrivacyScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    await screen.findByRole('alert');
    expect(screen.getAllByText('A synthetic note')).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: 'A synthetic note' })).toBeVisible();
    expect(screen.queryByText('The saved memory was deleted.')).not.toBeInTheDocument();
  });
  it('renders Persian RTL with the same server purposes and no automatic consent', async () => {
    const { container } = render(<PrivacyScreen />);
    await screen.findByRole('button', { name: 'Review choice' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'fa' } });
    await screen.findByRole('button', { name: 'بررسی انتخاب' });
    expect(container.querySelector('section')).toHaveAttribute('dir', 'rtl');
    expect(mocks.read).toHaveBeenLastCalledWith('work', 'fa');
    expect(mocks.consent).not.toHaveBeenCalled();
  });
});

it('renders an inherited unverified claim caveat alongside summary provenance in EN and FA', async () => {
  const summary = { id: 'summary', text: 'Inherited summary claim', revision: 1, createdAt: 1, expiresAt: 2_000_000_000_000,
    origin: 'user_reviewed_claim' as const, sourceRefs: [{ id: 'source-one', revision: 1 }, { id: 'source-two', revision: 1 }] };
  mocks.read.mockResolvedValue(snapshot({ memories: [summary] }));
  const view = render(<PrivacyScreen />); await screen.findAllByText(summary.text);
  let article = view.container.querySelector('article')!;
  expect(within(article).getByText('User-reviewed claim; not independently verified.')).toBeVisible();
  expect(within(article).getByText('Reviewed summary of 2 notes; deleting this summary keeps the originals.')).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'fa' } });
  await screen.findByText('ادعای بررسی‌شدهٔ شما؛ به‌طور مستقل تأیید نشده است.'); article = view.container.querySelector('article')!;
  expect(within(article).getByText('خلاصهٔ بررسی‌شده از 2 یادداشت؛ حذف خلاصه، اصل یادداشت‌ها را نگه می‌دارد.')).toBeVisible();
  expect(summary.revision).toBe(1); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.consent).not.toHaveBeenCalled();
});

it('serializes own-note corrections and preserves the first authoritative result when the next note saves', async () => {
  const notes = ['First own note', 'Second own note'].map((text, index) => ({ id: `note-${index}`, text, revision: 1, createdAt: 1, expiresAt: 2_000_000_000_000 }));
  const initial = snapshot({ memories: notes, memoryCorrectionAvailable: true }); mocks.read.mockResolvedValue(initial);
  const release: Array<(value: AdaptiveSnapshot) => void> = [];
  mocks.correct.mockImplementation(() => new Promise(resolve => release.push(resolve)));
  const view = render(<PrivacyScreen />); await screen.findAllByRole('button', { name: 'Edit note' });
  const first=view.container.querySelectorAll('.vx-privacy-note')[0] as HTMLElement;
  fireEvent.click(within(first).getByRole('button',{name:'Edit note'}));fireEvent.change(within(first).getByRole('textbox'),{target:{value:'Corrected 0'}});fireEvent.click(within(first).getByRole('button',{name:'Review correction'}));fireEvent.click(within(first).getByRole('button',{name:'Save correction'}));
  const second=view.container.querySelectorAll('.vx-privacy-note')[1] as HTMLElement;
  const edit=within(second).getByRole('button',{name:'Edit note'});expect(edit).toBeDisabled();fireEvent.click(edit);expect(within(second).queryByRole('textbox')).not.toBeInTheDocument();expect(mocks.correct).toHaveBeenCalledOnce();
  const firstSaved={...notes[0],revision:2,text:'Corrected 0'};
  await act(async()=>release[0]({...initial,revision:3,memories:[firstSaved,notes[1]]}));
  expect(within(first).getByText('Corrected 0')).toBeVisible();expect(edit).toBeEnabled();
  fireEvent.click(edit);fireEvent.change(within(second).getByRole('textbox'),{target:{value:'Corrected 1'}});fireEvent.click(within(second).getByRole('button',{name:'Review correction'}));fireEvent.click(within(second).getByRole('button',{name:'Save correction'}));
  await act(async()=>release[1]({...initial,revision:4,memories:[firstSaved,{...notes[1],revision:2,text:'Corrected 1'}]}));
  expect(view.container.querySelectorAll('.vx-privacy-note')[0]).toHaveTextContent('Corrected 0');expect(view.container.querySelectorAll('.vx-privacy-note')[1]).toHaveTextContent('Corrected 1');expect(mocks.correct).toHaveBeenCalledTimes(2);
});

it.each(['en','fa'] as const)('owns a pending %s correction without self-aborting or allowing competing scope/writes', async locale=>{
  const note={id:'pending-note',text:'Scoped original note',revision:1,createdAt:1,expiresAt:Date.now()+86400_000};
  const current=snapshot({memoryCorrectionAvailable:true,memories:[note]});mocks.read.mockImplementation((space:string)=>Promise.resolve({...current,space,memories:space==='work'?[note]:[]}));
  let release!:(v:AdaptiveSnapshot)=>void;mocks.correct.mockImplementation(()=>new Promise(r=>{release=r;}));
  const navigation={shared:vi.fn(),experience:vi.fn(),connections:vi.fn(),pending:vi.fn(()=>true)};
  render(<PrivacyScreen onShared={navigation.shared} onExperience={navigation.experience} onConnections={navigation.connections} onCorrectionPendingChange={navigation.pending}/>);
  await screen.findByRole('button',{name:'Edit note'});if(locale==='fa'){fireEvent.change(screen.getByRole('combobox',{name:'Language'}),{target:{value:'fa'}});await screen.findByRole('button',{name:'ویرایش یادداشت'});}
  const fa=locale==='fa';fireEvent.click(screen.getByRole('button',{name:fa?'ویرایش یادداشت':'Edit note'}));
  fireEvent.change(screen.getByRole('textbox',{name:fa?'یادداشت اصلاح‌شده':'Corrected note'}),{target:{value:'Scoped corrected note'}});
  fireEvent.click(screen.getByRole('button',{name:fa?'بررسی اصلاح':'Review correction'}));fireEvent.click(screen.getByRole('button',{name:fa?'ذخیرهٔ اصلاح':'Save correction'}));
  const signal=mocks.correct.mock.calls[0][2] as AbortSignal,token=mocks.correct.mock.calls[0][1].eventId;
  expect(signal.aborted).toBe(false);expect(navigation.pending).toHaveBeenCalledExactlyOnceWith(token,true);
  const personal=screen.getByRole('button',{name:fa?'شخصی':'Personal',exact:true}),language=screen.getByRole('combobox',{name:fa?'زبان':'Language'});
  for(const control of [personal,language,screen.getByRole('button',{name:fa?'انصراف':'Cancel',exact:true}),screen.getByRole('button',{name:fa?'ذخیرهٔ حافظهٔ خصوصی':'Save private memory'}),screen.getByRole('button',{name:fa?'حذف':'Delete',exact:true})])expect(control).toBeDisabled();
  fireEvent.click(personal);fireEvent.change(language,{target:{value:fa?'en':'fa'}});expect(personal).toHaveAttribute('aria-pressed','false');
  for(const name of [fa?'ترجیح‌ها و صندوق اعلان':'Preferences & notification inbox',fa?'اتصال‌ها و دسترسی عامل‌ها':'Connections & agent access',fa?'حافظه‌های مشترک':'Shared memories']){const button=screen.getByRole('button',{name});expect(button).toBeDisabled();fireEvent.click(button);}
  expect(navigation.shared).not.toHaveBeenCalled();expect(navigation.experience).not.toHaveBeenCalled();expect(navigation.connections).not.toHaveBeenCalled();expect(signal.aborted).toBe(false);expect(mocks.correct).toHaveBeenCalledOnce();
  await act(async()=>release({...current,revision:3,memories:[{...note,text:'Scoped corrected note',revision:2}]}));
  expect(navigation.pending).toHaveBeenLastCalledWith(token,false);expect(personal).toBeEnabled();expect(screen.getAllByText('Scoped corrected note').length).toBeGreaterThan(0);
  fireEvent.click(personal);await waitFor(()=>expect(screen.queryByText('Scoped corrected note')).not.toBeInTheDocument());expect(mocks.read).toHaveBeenLastCalledWith('personal',locale);
});
