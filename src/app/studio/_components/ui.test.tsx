import { act, useState, type ReactElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Banner, Check, Choose, Composer, ConfirmProvider, Empty, ErrorState, FilterChips, hueVars, Icon, Option, Picker, Radio, Row,
  Section, Seg, Sheet, SheetHead, SheetHostContext, SkeletonCards, SkeletonRows, Stat, Stats, Steps, Switch, Toggle, TopBar, useConfirm, type ConfirmOptions,
} from './ui';

// The character renderer is another stream's work; these tests are about layout and behaviour.
vi.mock('./Cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./Cloud')>();
  const Face = ({ label }: { label?: string }) => <span role="img" aria-label={label} />;
  return { ...actual, Cloud: Face, AgentFace: Face };
});

vi.mock('./StudioApp', () => ({ useNav: () => ({ space: 'work', setSpace: vi.fn() }) }));

afterEach(cleanup);

/** jsdom has no PointerEvent: dispatch a MouseEvent under the pointer event's name (React listens by name). */
function pointer(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', id: number, y: number) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: id });
  fireEvent(el, e);
}

describe('TopBar', () => {
  it('is a three-column grid with the title in the middle column whatever the lead', () => {
    const { container, rerender } = render(<TopBar lead="back" onLead={() => {}} leadLabel="Aria" title="Add to groups" end={<button>More</button>} />);
    const bar = container.querySelector('.vx-topbar')!;
    expect(bar.children).toHaveLength(3);
    expect(bar.children[1]).toHaveClass('vx-topbar-title');
    expect(within(bar.children[1] as HTMLElement).getByText('Add to groups')).toBeVisible();

    rerender(<TopBar title="Add to groups" />);
    expect(bar.children).toHaveLength(3);
    expect(bar.children[1]).toHaveTextContent('Add to groups');
  });

  it('mirrors the back chevron in RTL and names the button after its label', () => {
    const onLead = vi.fn();
    render(<TopBar lead="back" onLead={onLead} leadLabel="Aria" />);
    const back = screen.getByRole('button', { name: 'Aria' });
    expect(back.querySelector('svg')).toHaveClass('vx-flip');
    fireEvent.click(back);
    expect(onLead).toHaveBeenCalledOnce();
  });

  it('close and minimise leads are icon-only, unmirrored, with default names', () => {
    const { rerender } = render(<TopBar lead="close" onLead={() => {}} />);
    expect(screen.getByRole('button', { name: 'Close' }).querySelector('svg')).not.toHaveClass('vx-flip');
    rerender(<TopBar lead="down" onLead={() => {}} subtitle="Designer · 02:14" title="Nova" />);
    expect(screen.getByRole('button', { name: 'Minimise' })).toBeVisible();
    expect(screen.getByText('Designer · 02:14')).toBeVisible();
  });

  it('keeps the v1 props working on the centred grid', () => {
    const onBack = vi.fn();
    const { container } = render(<TopBar onBack={onBack} backLabel="Agents" title="Nova" right={<span>end</span>} />);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(container.querySelector('.vx-topbar')!.children[1]).toHaveTextContent('Nova');
    expect(screen.getByText('end')).toBeVisible();
  });

  describe('side tracks', () => {
    // jsdom has no layout: stub the few boxes TopBar reads, and capture the ResizeObserver callback
    let sizes: { end: number; back: number; label: [scroll: number, client: number]; bar: number };
    let onResize: () => void = () => {};
    const box = (prop: 'scrollWidth' | 'offsetWidth' | 'clientWidth', of: (el: Element) => number | undefined) => {
      const proto = prop === 'offsetWidth' ? HTMLElement.prototype : Element.prototype;
      const was = Object.getOwnPropertyDescriptor(proto, prop)!;
      Object.defineProperty(proto, prop, { configurable: true, get(this: Element) { return of(this) ?? was.get!.call(this); } });
      return () => Object.defineProperty(proto, prop, was);
    };
    let restore: Array<() => void> = [];
    const isEnd = (el: Element) => el.parentElement?.classList.contains('vx-topbar') && el === el.parentElement.lastElementChild;
    const mount = (node: ReactElement) => {
      restore = [
        box('scrollWidth', (el) => (isEnd(el) ? sizes.end : el.parentElement?.classList.contains('vx-back') ? sizes.label[0] : undefined)),
        box('clientWidth', (el) => (el.classList.contains('vx-topbar') ? sizes.bar : el.parentElement?.classList.contains('vx-back') ? sizes.label[1] : undefined)),
        box('offsetWidth', (el) => (el.classList.contains('vx-back') ? sizes.back : undefined)),
      ];
      const was = global.ResizeObserver;
      global.ResizeObserver = class { constructor(cb: () => void) { onResize = cb; } observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
      restore.push(() => { global.ResizeObserver = was; });
      return render(node).container.querySelector<HTMLElement>('.vx-topbar')!;
    };
    afterEach(() => { restore.forEach((r) => r()); restore = []; });

    it('both sides take the end actions’ width, and follow it when the actions change', () => {
      sizes = { end: 88, back: 44, label: [0, 0], bar: 375 };
      const bar = mount(<TopBar lead="back" onLead={() => {}} title="Aria" subtitle="Personal · Head of Growth & Live-Ops" end={<><button>Telegram</button><button>More</button></>} />);
      expect(bar.style.getPropertyValue('--tb-side')).toBe('88px');
      sizes.end = 132;
      act(() => onResize());
      expect(bar.style.getPropertyValue('--tb-side')).toBe('132px');
    });

    it('a long back label claims its natural width, up to a third of the bar; nothing goes under 44', () => {
      sizes = { end: 0, back: 60, label: [120, 30], bar: 300 };
      const bar = mount(<TopBar lead="back" onLead={() => {}} leadLabel="Connections" title="reza@joyixir.com" />);
      expect(bar.style.getPropertyValue('--tb-side')).toBe('100px');
      sizes.bar = 600;
      act(() => onResize());
      expect(bar.style.getPropertyValue('--tb-side')).toBe('150px');
      cleanup();
      sizes = { end: 0, back: 0, label: [0, 0], bar: 375 };
      expect(mount(<TopBar title="Nova" />).style.getPropertyValue('--tb-side')).toBe('44px');
    });
  });
});

describe('Steps', () => {
  it('names the step; the dots stay volt (no agent-hue variant)', () => {
    const { container } = render(<Steps total={5} current={1} />);
    expect(screen.getByRole('img', { name: 'Step 2 of 5' })).toHaveClass('vx-steps');
    expect(container.querySelectorAll('.vx-steps > span.on')).toHaveLength(2);
    expect(container.querySelector('.vx-steps')).toHaveAttribute('class', 'vx-steps');
  });
});

describe('SheetHead', () => {
  it('has an optional overline above the title', () => {
    const { container } = render(<SheetHead over="Telegram" title="Design crit" sub="6 members" />);
    const head = container.querySelector('.vx-sheet-head')!;
    expect(head.firstElementChild).toHaveClass('vx-over');
    expect(head).toHaveTextContent('TelegramDesign crit6 members');
  });
});

describe('Icon', () => {
  it('draws the more icon as three filled dots', () => {
    const { container } = render(<Icon name="more" />);
    expect(container.querySelectorAll('circle')).toHaveLength(3);
  });
});

describe('Seg', () => {
  function Harness({ onChange = vi.fn() }: { onChange?: (v: string) => void }) {
    const [v, setV] = useState<'a' | 'b' | 'c'>('a');
    return <Seg label="Voices" value={v} onChange={(n) => { setV(n); onChange(n); }}
      options={[{ value: 'a', label: 'Library' }, { value: 'b', label: 'Design' }, { value: 'c', label: 'Clone' }]} />;
  }

  it('is a tablist with one selected, roving tab stop', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Voices' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Library' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Design' })).toHaveAttribute('tabindex', '-1');
    fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
    expect(screen.getByRole('tab', { name: 'Design' })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves with arrow keys, reversed in RTL', () => {
    const onChange = vi.fn();
    const { container } = render(<div dir="rtl"><Harness onChange={onChange} /></div>);
    fireEvent.keyDown(within(container).getByRole('tab', { name: 'Library' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('b');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Design' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('a');
  });

  it('does not report a tap on the selected segment', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('FilterChips', () => {
  it('shows counts and marks the active chip pressed', () => {
    const onChange = vi.fn();
    render(<FilterChips label="Filter" value="all" onChange={onChange}
      options={[{ value: 'all', label: 'All', count: 4 }, { value: 'forming', label: 'Forming', count: 2 }]} />);
    expect(screen.getByRole('button', { name: 'All 4' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Forming 2' }));
    expect(onChange).toHaveBeenCalledWith('forming');
  });
});

describe('Switch, Toggle, Radio, Check', () => {
  it('Switch is a whole row with role=switch', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Live web search" sub="Searches when needed" />);
    const sw = screen.getByRole('switch', { name: /Live web search/ });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw.querySelector('.vx-switch.live .vx-switch-knob')).not.toBeNull();
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Switch marks an on-but-not-in-effect choice with attention', () => {
    const { rerender } = render(<Switch checked onChange={() => {}} label="Personalization" sub="Review needed" attention />);
    const sw = screen.getByRole('switch', { name: /Personalization/ });
    expect(sw.querySelector('.vx-switch.live.attention')).not.toBeNull();
    expect(screen.getByText('Review needed')).toHaveClass('vx-row-sub', 'warn');
    rerender(<Switch checked onChange={() => {}} label="Personalization" sub="In effect" />);
    expect(sw.querySelector('.vx-switch.attention')).toBeNull();
    expect(screen.getByText('In effect')).not.toHaveClass('warn');
  });

  it('Toggle is the bare control with its own name', () => {
    const onChange = vi.fn();
    render(<Toggle checked onChange={onChange} label="Can use your notes" disabled />);
    expect(screen.getByRole('switch', { name: 'Can use your notes' })).toBeDisabled();
  });

  it('Radio and Check marks are decorative inside checked rows', () => {
    render(<div className="vx-group">
      <Row role="radio" aria-checked title="Everyone" lead={<Radio />} onClick={() => {}} />
      <Row role="checkbox" aria-checked={false} title="Reza" lead={<Check />} onClick={() => {}} />
    </div>);
    expect(screen.getByRole('radio', { name: 'Everyone' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: 'Reza' }).querySelector('.vx-check')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Row and Section', () => {
  it('a clickable row is a button with a chevron; danger tone and sizes are classes', () => {
    const onClick = vi.fn();
    const { container } = render(<Section title="Control" foot="Plain words.">
      <Row title="Fire Nova" tone="danger" size="l" chevron onClick={onClick} value="Now" />
    </Section>);
    const row = screen.getByRole('button', { name: /Fire Nova/ });
    expect(row).toHaveClass('vx-row', 'vx-row-btn', 'danger', 'l');
    expect(row.querySelector('.vx-chev')).not.toBeNull();
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('region', { name: 'Control' })).toBeVisible();
    expect(container.querySelector('.vx-section-foot')).toHaveTextContent('Plain words.');
  });
});

describe('Option and Choose', () => {
  it('Choose reads Chosen once picked and is never volt', () => {
    const { container, rerender } = render(<Option selected={false} title="Option 1" action={<Choose chosen={false} onClick={() => {}} label="Choose option 1" />} />);
    const btn = screen.getByRole('button', { name: 'Choose option 1' });
    expect(btn).toHaveTextContent('Choose');
    expect(btn).not.toHaveClass('vx-btn-primary');
    rerender(<Option selected title="Option 1" action={<Choose chosen onClick={() => {}} label="Choose option 1" />} />);
    expect(screen.getByRole('button', { name: 'Choose option 1' })).toHaveTextContent('Chosen');
    expect(screen.getByRole('button', { name: 'Choose option 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.vx-option')).toHaveClass('selected');
  });
});

describe('Composer', () => {
  it('sends on Enter, not on Shift+Enter, and only with text', () => {
    const onSend = vi.fn();
    function Harness() {
      const [v, setV] = useState('');
      return <Composer multiline value={v} onChange={setV} onSend={onSend} label="Ask Claude" />;
    }
    render(<Harness />);
    const box = screen.getByRole('textbox', { name: 'Ask Claude' });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: 'warmer' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledOnce();
  });
});

describe('Sheet', () => {
  function Harness({ onClose }: { onClose?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <Sheet open={open} onClose={() => { onClose?.(); setOpen(false); }} label="Manage Nova" dock={<button>Save</button>}>
          <button>First</button><button>Last</button>
        </Sheet>
      </>
    );
  }

  it('opens as a modal dialog that takes focus, traps Tab and returns focus on Escape', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Manage Nova' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    screen.getByRole('button', { name: 'Save' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closes on a scrim tap', async () => {
    const onClose = vi.fn();
    const { container } = render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await act(async () => { fireEvent.click(container.querySelector('.vx-sheet-scrim')!); });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('dismisses when dragged down from the grabber past the threshold, and not for a short drag', async () => {
    const onClose = vi.fn();
    const { container } = render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const grab = container.querySelector('.vx-sheet-grab')!;
    pointer(grab, 'pointerdown', 1, 100);
    pointer(grab, 'pointermove', 1, 130);
    pointer(grab, 'pointermove', 1, 160);
    await act(async () => { pointer(grab, 'pointerup', 1, 160); });
    expect(onClose).not.toHaveBeenCalled();
    pointer(grab, 'pointerdown', 2, 100);
    pointer(grab, 'pointermove', 2, 200);
    pointer(grab, 'pointermove', 2, 320);
    await act(async () => { pointer(grab, 'pointerup', 2, 320); });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('dismisses when pulled down from the body at the top, but not when the pull starts on a text field', async () => {
    const onClose = vi.fn();
    const { container } = render(<Sheet open onClose={onClose} label="Notes"><input aria-label="Note" /><p>Body</p></Sheet>);
    const field = screen.getByRole('textbox', { name: 'Note' });
    pointer(field, 'pointerdown', 4, 100);
    pointer(field, 'pointermove', 4, 400);
    await act(async () => { pointer(field, 'pointerup', 4, 400); });
    expect(onClose).not.toHaveBeenCalled();
    const text = container.querySelector('.vx-sheet-body p')!;
    pointer(text, 'pointerdown', 5, 100);
    pointer(text, 'pointermove', 5, 140);
    pointer(text, 'pointermove', 5, 400);
    await act(async () => { pointer(text, 'pointerup', 5, 400); });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not start a drag from the body while it is scrolled', () => {
    const onClose = vi.fn();
    const { container } = render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const body = container.querySelector('.vx-sheet-body') as HTMLElement;
    body.scrollTop = 40;
    pointer(body, 'pointerdown', 3, 100);
    pointer(body, 'pointermove', 3, 400);
    pointer(body, 'pointerup', 3, 400);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape closes only the top sheet', async () => {
    const outer = vi.fn(), inner = vi.fn();
    render(<>
      <Sheet open onClose={outer} label="Outer"><p>o</p></Sheet>
      <Sheet open onClose={inner} label="Inner" layer="top"><p>i</p></Sheet>
    </>);
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('Sheet host', () => {
  it('mounts every sheet at the screen root, so a sheet opened inside another covers the screen', () => {
    const host = document.createElement('div');
    document.body.append(host);
    render(
      <SheetHostContext.Provider value={host}>
        <Sheet open onClose={() => {}} label="Outer">
          <p>Outer body</p>
          <Sheet open onClose={() => {}} label="Inner"><p>Inner body</p></Sheet>
        </Sheet>
      </SheetHostContext.Provider>,
    );
    const outer = screen.getByRole('dialog', { name: 'Outer' }), inner = screen.getByRole('dialog', { name: 'Inner' });
    expect(host.contains(outer) && host.contains(inner)).toBe(true);
    expect(outer.contains(inner)).toBe(false);
    host.remove();
  });

  it('renders nothing until the screen is attached, and in place outside a screen', () => {
    const { rerender } = render(<SheetHostContext.Provider value={null}><Sheet open onClose={() => {}} label="Early"><p>x</p></Sheet></SheetHostContext.Provider>);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<Sheet open onClose={() => {}} label="Early"><p>x</p></Sheet>);
    expect(screen.getByRole('dialog', { name: 'Early' })).toBeInTheDocument();
  });
});

describe('useConfirm', () => {
  function Asker({ options, onAnswer }: { options: ConfirmOptions; onAnswer: (ok: boolean) => void }) {
    const confirm = useConfirm();
    return <button onClick={() => void confirm(options).then(onAnswer)}>Discard</button>;
  }

  it('resolves true on confirm and starts focus on the safe choice', async () => {
    const onAnswer = vi.fn();
    render(<ConfirmProvider><Asker options={{ title: 'Discard Nova?', body: 'The draft is deleted.', confirmLabel: 'Discard', tone: 'danger' }} onAnswer={onAnswer} /></ConfirmProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    const sheet = within(screen.getByRole('dialog', { name: 'Discard Nova?' }));
    expect(sheet.getByRole('button', { name: 'Keep' })).toHaveFocus();
    expect(sheet.getByText('The draft is deleted.')).toBeVisible();
    await act(async () => { fireEvent.click(sheet.getByRole('button', { name: 'Discard' })); });
    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('resolves false on Keep and on Escape', async () => {
    const onAnswer = vi.fn();
    render(<ConfirmProvider><Asker options={{ title: 'Remove access?', confirmLabel: 'Remove', tone: 'danger' }} onAnswer={onAnswer} /></ConfirmProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Keep' })); });
    expect(onAnswer).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(onAnswer).toHaveBeenCalledTimes(2);
    expect(onAnswer).toHaveBeenLastCalledWith(false);
  });

  it('a non-danger confirm uses a primary button and Cancel', () => {
    render(<ConfirmProvider><Asker options={{ title: 'Make Nova public?', confirmLabel: 'Make public' }} onAnswer={vi.fn()} /></ConfirmProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('button', { name: 'Make public' })).toHaveClass('vx-btn-primary');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });
});

describe('Picker', () => {
  it('filters with search, picks a radio row and closes', async () => {
    const onChange = vi.fn(), onClose = vi.fn();
    render(<Picker open onClose={onClose} title="Language" value="en" onChange={onChange} search
      options={[{ value: 'en', label: 'English' }, { value: 'fa', label: 'فارسی', sub: 'Persian' }, { value: 'vi', label: 'Tiếng Việt', sub: 'Vietnamese' }]} />);
    expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Language' }), { target: { value: 'pers' } });
    expect(screen.queryByRole('radio', { name: 'English' })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /فارسی/ })); });
    expect(onChange).toHaveBeenCalledWith('fa');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('feedback states', () => {
  it('ErrorState is an alert with Try again', () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Can't load your agents" reason="Network error" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Can't load your agents");
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('Empty can drop the character', () => {
    const { container } = render(<Empty look={false} title="No groups yet" />);
    expect(container.querySelector('.vx-empty svg')).toBeNull();
  });

  it('skeletons are delayed, busy status regions shaped like the content', () => {
    const { container } = render(<><SkeletonRows rows={2} /><SkeletonCards count={2} label="Loading agents" /></>);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status', { name: 'Loading agents' })).toBeVisible();
    expect(container.querySelectorAll('.vx-skel-card[data-delay]')).toHaveLength(2);
    expect(container.querySelectorAll('.vx-group.vx-skeleton .vx-row')).toHaveLength(2);
  });

  it('a danger banner is an alert; others are not', () => {
    render(<><Banner tone="danger">Telegram refused the photo</Banner><Banner tone="warn">Guests here</Banner></>);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});

describe('Stats and hueVars', () => {
  it('Stats is a description list with the value after its label in the DOM', () => {
    render(<Stats><Stat value={12} label="Conversations" /></Stats>);
    expect(screen.getByRole('term')).toHaveTextContent('Conversations');
    expect(screen.getByRole('definition')).toHaveTextContent('12');
    cleanup();
    const { container } = render(<Stats compact><Stat value={3} label="Runs" /></Stats>);
    expect(container.querySelector('dl')).toHaveClass('vx-stats', 'vx-stats-compact');
  });

  it('hueVars exposes the hue and its tints as variables', () => {
    const vars = hueVars({ base: '#C3A6FF', light: '#E6DBFF', shadow: '#8D6BDB', glow: '#B08CFF' }) as Record<string, string>;
    expect(vars['--hue']).toBe('#C3A6FF');
    expect(vars['--hue-12']).toBe('rgba(195, 166, 255, 0.12)');
    expect(vars['--hue-22']).toBe('rgba(176, 140, 255, 0.22)');
  });
});
