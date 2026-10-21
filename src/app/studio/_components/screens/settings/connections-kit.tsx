'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionResourceView, ConnectionsDashboard, SetupReceipt } from '@/lib/connections/application';
import type { ConnectionView, OperationReceipt, SpaceKind } from '@/lib/connections/contracts';
import type { ConnectionTaskResult } from '@/lib/connections/task-runtime';
import { ApiError } from '../../../_lib/client';
import { connectionsApi, openConnectionSignIn } from '../../../_lib/connections-client';
import { connectionSkillTitle, connectionsCopy } from '../../../_lib/connections-copy';
import { haptic } from '../../../_lib/haptics';
import { useNav } from '../../StudioApp';
import { Banner, Check, Composer, Icon, Picker, Row, Section, Seg, Sheet, SheetHead, SkeletonRows, useConfirm } from '../../ui';
import { Fact, IconTile, LetterTile, SheetError, formatWhen, useOnReturn } from './kit';

export type Copy = (typeof connectionsCopy)['en' | 'fa'];
export type Review = { receipt: OperationReceipt; arguments: Record<string, unknown> };

/**
 * Dashboard for the app-level space. Data is stored with the space it was read for, so a space switch hides
 * the previous space's accounts in the same render (never a flash of Work labels while Personal loads).
 */
export function useConnections(agentId?: string) {
  const nav = useNav();
  const space: SpaceKind = nav.space;
  const fa = nav.locale === 'fa';
  const c: Copy = connectionsCopy[nav.locale];
  const copy = useRef(c); copy.current = c;
  const [stored, setStored] = useState<{ space: SpaceKind; agentId?: string; data: ConnectionsDashboard } | null>(null);
  const data = stored?.space === space && stored.agentId === agentId ? stored.data : null;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0), lock = useRef(false);
  const refresh = useCallback(async () => {
    const turn = ++generation.current;
    setStored(null); setError('');
    try { const result = await (agentId ? connectionsApi.read(space, agentId) : connectionsApi.read(space)); if (turn === generation.current) setStored({ space, agentId, data: result }); }
    catch (cause) { if (turn === generation.current) setError(cause instanceof ApiError && cause.message === 'profile_confirmation_required' ? copy.current.identity : copy.current.loadError); }
  }, [space, agentId]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => { void refresh(); return invalidate; }, [refresh, invalidate]);
  /** Re-read without blanking the screen (after a change). */
  const reload = async () => {
    const turn = generation.current;
    const result = await (agentId ? connectionsApi.read(space, agentId) : connectionsApi.read(space));
    if (turn === generation.current) setStored({ space, agentId, data: result });
  };
  /** One change at a time; a refused change says so and asks for a refresh, never a blind retry. */
  const act = async (task: (turn: number) => Promise<void>) => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try { await task(generation.current); return true; }
    catch { haptic.error(); setError(copy.current.error); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  const current = (turn: number) => turn === generation.current;
  const agentName = (id: string) => data?.agents.find(a => a.id === id)?.name ?? id;
  const toolName = (id: string) => data?.providers.flatMap(p => p.tools).find(tool => tool.id === id)?.name ?? id;
  const when = (at: number) => formatWhen(at, fa);
  return { nav, space, agentId, fa, c, data, error, busy, refresh, reload, act, current, agentName, toolName, when };
}
export type Connections = ReturnType<typeof useConnections>;

export const stateLabel = (c: Copy, state: OperationReceipt['state']) => state === 'needs_approval' ? c.pendingApproval : c[state];
export const lifecycleTone = (lifecycle: ConnectionView['lifecycle']) => lifecycle === 'connected' ? 'live' : lifecycle === 'pending' || lifecycle === 'paused' ? 'warn' : '';

export function ErrorBanner({ x }: { x: Connections }) {
  if (!x.error) return null;
  return <Banner tone="danger" action={<button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" disabled={x.busy} onClick={() => void x.refresh()}>{x.c.refresh}</button>}>{x.error}</Banner>;
}

/* ---------- setup (OAuth round trip) ---------- */

/** Sign-in flow for one connection. Coming back to the app checks the sign-in by itself (Telegram `activated`). */
export function useSetup(x: Connections) {
  const [flow, setFlow] = useState<SetupReceipt | null>(null);
  const [open, setOpen] = useState(false);
  const pending = flow?.status === 'pending';
  const landed = async (result: SetupReceipt) => {
    setFlow(result);
    if (result.status === 'connected') { haptic.success(); setOpen(false); x.nav.snack({ message: x.c.zero, tone: 'success' }); await x.reload(); }
  };
  const start = (connection: ConnectionView) => x.act(async () => { const result = await connectionsApi.setup(x.space, connection.id); setOpen(true); await landed(result); });
  const begin = async (result: SetupReceipt) => { setOpen(true); await landed(result); };
  const check = () => flow && x.act(async () => landed(await connectionsApi.claim(x.space, flow.flowId)));
  const cancel = () => flow && x.act(async () => { setFlow(await connectionsApi.cancelSetup(x.space, flow.flowId)); setOpen(false); await x.reload(); });
  useOnReturn(() => { if (flow?.status === 'pending' && !x.busy) void check(); }, pending);
  return { flow, pending, open, setOpen, start, begin, check, cancel };
}

export function SetupSheet({ x, s }: { x: Connections; s: ReturnType<typeof useSetup> }) {
  const { c } = x;
  const flow = s.flow;
  const done = flow && flow.status !== 'pending';
  return <Sheet open={s.open && !!flow} onClose={() => s.setOpen(false)} label={c.waiting}
    dock={flow?.status === 'pending' && <>
      {flow.authorizationUrl && <button type="button" className="vx-btn vx-btn-primary vx-btn-block" disabled={x.busy} onClick={() => { haptic.tap(); openConnectionSignIn(flow.authorizationUrl!); }}>
        <Icon name="external" size={18} />{c.browser}</button>}
      <div className="vx-dock-row">
        <button type="button" className="vx-btn vx-btn-ghost" disabled={x.busy} onClick={() => void s.cancel()}>{c.cancelSetup}</button>
        <button type="button" className="vx-btn vx-btn-secondary" disabled={x.busy} onClick={() => void s.check()}>{c.check}</button>
      </div>
    </>}>
    {flow && <div className="vx-sheet-stack">
      <div className="vx-conn-wait" aria-hidden="true"><span className={`vx-conn-wait-ring${done ? ' done' : ''}`}><Icon name={done ? 'check' : 'plug'} size={26} /></span></div>
      <SheetHead title={flow.status === 'pending' ? c.waiting : c[flow.status === 'failed' ? 'failed' : flow.status]} sub={c.returnNote} />
      {flow.status !== 'pending' && flow.status !== 'connected' && <Banner tone="warn"><span role="status">{c[flow.status === 'failed' ? 'failed' : flow.status]}</span></Banner>}
      {x.error && <SheetError>{x.error}</SheetError>}
    </div>}
  </Sheet>;
}

/* ---------- add a service ---------- */

export function AddServiceSheet({ x, open, onClose, onSetup }: { x: Connections; open: boolean; onClose: () => void; onSetup: (r: SetupReceipt) => void }) {
  const { c, data } = x;
  const add = (provider: ConnectionsDashboard['providers'][number]) => data && x.act(async turn => {
    const before = new Set(data.connections.map(connection => connection.id));
    const result = await (x.agentId ? connectionsApi.enroll(x.space, provider.id, provider.name, x.agentId) : connectionsApi.enroll(x.space, provider.id, provider.name));
    const created = result.connections.find(connection => !before.has(connection.id));
    await x.reload();
    if (!x.current(turn)) return;
    onClose();
    if (created) onSetup(await connectionsApi.setup(x.space, created.id));
  });
  return <Sheet open={open} onClose={onClose} label={c.chooseService}>
    <div className="vx-sheet-stack">
      <SheetHead title={c.chooseService} sub={c.returnNote} />
      {!data?.enabled && <Banner tone="info">{c.unavailable}</Banner>}
      <div className="vx-group">
        {data?.providers.map(p => {
          const ready = p.availability === 'ready' && data.enabled;
          return <div key={p.id} className="vx-conn-provider">
            <Row size="l" lead={<LetterTile text={p.name} />} title={p.name} sub={p.description} disabled={x.busy || !ready} onClick={() => void add(p)} aria-label={`${c.add}: ${p.name}`}
              end={p.availability !== 'ready' ? <span className="vx-pill lock">{p.availability === 'setup_required' ? c.setupRequired : c.notAvailable}</span> : <Icon name="plus" size={20} />} />
            {p.reason && <details className="vx-disclosure vx-conn-reason"><summary>{c.requirements}</summary><p className="vx-footnote">{p.reason}</p></details>}
          </div>;
        })}
      </div>
      {x.error && <SheetError>{x.error}</SheetError>}
    </div>
  </Sheet>;
}

/* ---------- grant editor ---------- */

/** Grant editor (UI §4.13): agent picker, Can read / Can do check rows, expiry seg, targets disclosure, volt Allow access in the dock. */
export function GrantSheet({ x, connection, agentId, open, onClose }: { x: Connections; connection: ConnectionView; agentId?: string; open: boolean; onClose: () => void }) {
  const { c, data } = x;
  const [resources, setResources] = useState<ConnectionResourceView[] | null>(null);
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [agent, setAgent] = useState(agentId ?? '');
  const [hours, setHours] = useState<'1' | '8'>('1');
  const [base, setBase] = useState(() => Date.now());
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (!open) return;
    setResources(null); setResourceIds([]); setToolIds([]); setAgent(agentId ?? connection.agentId ?? ''); setHours('1'); setBase(Date.now());
    void x.act(async turn => { const result = await connectionsApi.resources(x.space, connection.id); if (x.current(turn)) setResources(result.resources); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connection.id, connection.agentId, agentId]);
  const provider = data?.providers.find(p => p.id === connection.providerId);
  const chosen = resources?.filter(r => resourceIds.includes(r.id)) ?? [];
  const tools = provider?.tools.filter(tool => chosen.length > 0 && chosen.every(r => r.toolIds.includes(tool.id))) ?? [];
  const active = tools.filter(tool => toolIds.includes(tool.id));
  const destinations = [...new Set(chosen.flatMap(r => r.destinationIds))];
  const expiry = Math.min(base + Number(hours) * 3_600_000, data?.maxGrantExpiryAt ?? 0);
  const toggle = (list: string[], id: string) => list.includes(id) ? list.filter(v => v !== id) : [...list, id];
  const fixedAgent = agentId ?? connection.agentId;
  const selectedAgent = fixedAgent ?? agent;
  const ready = !!selectedAgent && !!data?.agents.some(item => item.id === selectedAgent) && !!resourceIds.length && !!active.length && !!destinations.length;
  const allow = () => x.act(async () => {
    await connectionsApi.grant({ space: x.space, connectionId: connection.id, expectedRevision: connection.revision, agentId: selectedAgent,
      toolIds: active.map(tool => tool.id), resourceIds, destinationIds: destinations, effects: [...new Set(active.map(tool => tool.effect))],
      expiresAt: expiry, maxCalls: 100, maxBytes: 1_000_000 });
    haptic.success(); onClose(); await x.reload(); x.nav.snack({ message: c.saved, tone: 'success' });
  });
  return <><Sheet open={open} onClose={() => { if (!x.busy) onClose(); }} label={c.reviewAccess}
    dock={<button type="button" className="vx-btn vx-btn-primary vx-btn-block" disabled={x.busy || !ready} onClick={() => void allow()}>{x.busy && resources ? c.working : c.allow}</button>}>
    <div className="vx-sheet-stack">
      <SheetHead title={c.reviewAccess} sub={connection.displayLabel} />
      <div className="vx-group">
        <Row plain lead={selectedAgent ? <LetterTile text={x.agentName(selectedAgent)} round /> : <IconTile name="user" />} title={c.agent} value={selectedAgent ? x.agentName(selectedAgent) : c.select}
          chevron={!fixedAgent} disabled={x.busy || !!fixedAgent} onClick={() => { if (!fixedAgent) setPicking(true); }} aria-label={`${c.agent}: ${selectedAgent ? x.agentName(selectedAgent) : c.select}`} />
      </div>
      <Section title={x.fa ? 'می‌تواند بخواند' : 'Can read'}>
        {!resources && <SkeletonRows rows={2} lead={false} label={c.loading} />}
        {resources && !resources.length && <div className="vx-row"><span className="vx-row-sub">{c.noResources}</span></div>}
        {resources?.map(r => <Row key={r.id} role="checkbox" aria-checked={resourceIds.includes(r.id)} disabled={x.busy} align="top" end={<Check />}
          title={r.label} sub={<bdi className="vx-conn-id">{r.id}</bdi>} onClick={() => { haptic.select(); setResourceIds(toggle(resourceIds, r.id)); setToolIds([]); }} />)}
      </Section>
      <Section title={x.fa ? 'می‌تواند انجام دهد' : 'Can do'} foot={c.reviewNote}>
        {!tools.length && <div className="vx-row"><span className="vx-row-sub">{x.fa ? 'ابتدا یک منبع انتخاب کنید.' : 'Choose a resource first.'}</span></div>}
        {tools.map(tool => <Row key={tool.id} role="checkbox" aria-checked={toolIds.includes(tool.id)} disabled={x.busy} end={<Check />}
          title={tool.name} sub={c[tool.effect]} onClick={() => { haptic.select(); setToolIds(toggle(toolIds, tool.id)); }} />)}
      </Section>
      <Section title={c.expiry} foot={`${x.fa ? 'تا' : 'Until'} ${x.when(expiry)}`} plain>
        <Seg label={c.expiry} value={hours} onChange={setHours} disabled={x.busy} options={[{ value: '1', label: c.oneDay }, { value: '8', label: c.sevenDays }]} />
      </Section>
      <details className="vx-disclosure">
        <summary>{c.target} · {destinations.length}</summary>
        {destinations.length ? <ul className="vx-conn-targets">{destinations.map(id => <li key={id}><bdi>{id}</bdi></li>)}</ul> : <p className="vx-footnote">{x.fa ? 'هنوز مقصدی انتخاب نشده است.' : 'No target yet.'}</p>}
      </details>
      {x.error && <SheetError>{x.error}</SheetError>}
    </div>
  </Sheet>
  <Picker open={picking && !fixedAgent} onClose={() => setPicking(false)} title={c.agent} value={agent || null} search={(data?.agents.length ?? 0) > 6}
    options={data?.agents.map(a => ({ value: a.id, label: a.name, lead: <LetterTile text={a.name} round /> })) ?? []} onChange={setAgent} /></>;
}

/* ---------- approval review ---------- */

/** Plain-language value of one argument; objects and lists stay in the technical details. */
function argumentValue(value: unknown, fa: boolean): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every(v => typeof v === 'string' || typeof v === 'number')) return value.join(', ');
  if (value == null) return fa ? 'خالی' : 'Empty';
  return null;
}
const humanKey = (key: string) => key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, ch => ch.toUpperCase());

/**
 * Approval summary (UI §4.13): who, what, where, which resources and until when, then the exact content as readable
 * rows. The raw arguments sit behind "Technical details"; nothing is JSON by default. Approve asks once more.
 */
export function ReviewSheet({ x, review, onClose }: { x: Connections; review: Review | null; onClose: () => void }) {
  const { c, fa } = x;
  const confirm = useConfirm();
  const receipt = review?.receipt;
  const entries = review ? Object.entries(review.arguments) : [];
  const readable = entries.map(([key, value]) => [key, argumentValue(value, fa)] as const);
  const approve = async () => {
    if (!receipt) return;
    const ok = await confirm({ title: fa ? 'این کار تأیید شود؟' : 'Approve this action?', confirmLabel: c.approve, cancelLabel: c.cancel,
      body: `${x.agentName(receipt.agentId)} · ${c[receipt.effect]} · ${receipt.destinationId}` });
    if (!ok) return;
    await x.act(async () => {
      const approved = await connectionsApi.approve(x.space, receipt);
      onClose(); haptic.success();
      await connectionsApi.execute(x.space, approved.operationId); await x.reload();
    });
  };
  const decline = () => receipt && x.act(async () => { await connectionsApi.cancel(x.space, receipt); onClose(); await x.reload(); });
  return <Sheet open={!!review} onClose={() => { if (!x.busy) onClose(); }} label={c.review}
    dock={receipt && <div className="vx-dock-row">
      <button type="button" className="vx-btn vx-btn-ghost" disabled={x.busy} onClick={() => void decline()}>{c.cancel}</button>
      <button type="button" className="vx-btn vx-btn-primary" disabled={x.busy || receipt.state !== 'needs_approval'} onClick={() => void approve()}>{c.approve}</button>
    </div>}>
    {receipt && review && <div className="vx-sheet-stack">
      <SheetHead title={c.review} sub={x.toolName(receipt.toolId)} />
      <div className="vx-group">
        <Fact label={c.agent}>{x.agentName(receipt.agentId)}</Fact>
        <Fact label={c.effect}><span className={`vx-pill${receipt.effect === 'read' ? '' : receipt.effect === 'destructive' || receipt.effect === 'privileged' ? ' danger' : ' warn'}`}>{c[receipt.effect]}</span></Fact>
        <Fact label={c.target}><bdi>{receipt.destinationId}</bdi></Fact>
        <Fact label={c.resources} sub={<span className="vx-conn-list">{receipt.resourceIds.map(id => <bdi key={id}>{id}</bdi>)}</span>}>{receipt.resourceIds.length.toLocaleString(fa ? 'fa-IR' : 'en-US')}</Fact>
        <Fact label={c.deadline}>{x.when(receipt.deadlineAt)}</Fact>
      </div>
      {!!readable.length && <Section title={c.payload}>
        {readable.map(([key, value]) => <div key={key} className="vx-row top vx-conn-arg">
          <span className="vx-row-main"><span className="vx-row-sub">{humanKey(key)}</span>
            <span className="vx-conn-arg-value" dir="auto">{value ?? (fa ? 'در جزئیات فنی' : 'See technical details')}</span></span>
        </div>)}
      </Section>}
      <details className="vx-disclosure">
        <summary>{fa ? 'جزئیات فنی' : 'Technical details'}</summary>
        <pre className="vx-code" dir="ltr">{JSON.stringify(review.arguments, null, 2)}</pre>
      </details>
      {x.error && <SheetError>{x.error}</SheetError>}
    </div>}
  </Sheet>;
}

/* ---------- ask an agent ---------- */

export function TaskSheet({ x, connection, agentIds, open, onClose }: { x: Connections; connection: ConnectionView; agentIds: string[]; open: boolean; onClose: () => void }) {
  const { c, data } = x;
  const [agent, setAgent] = useState(agentIds[0] ?? '');
  const [skill, setSkill] = useState('');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<ConnectionTaskResult | null>(null);
  const [picking, setPicking] = useState<'agent' | 'skill' | null>(null);
  useEffect(() => { if (open) { setAgent(agentIds[0] ?? ''); setSkill(''); setMessage(''); setResult(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const skills = data?.skills?.filter(s => s.providerIds.includes(connection.providerId)) ?? [];
  const run = () => x.act(async turn => {
    const value = await connectionsApi.task({ space: x.space, agentId: agent, connectionId: connection.id, message, requestId: crypto.randomUUID(), ...(skill ? { skillId: skill, skillVersion: 1 as const } : {}) });
    if (!x.current(turn)) return;
    setResult(value); await x.reload();
  });
  const skillLabel = (id: string) => { const s = skills.find(item => item.id === id); return s ? `${connectionSkillTitle(s.id, s.title, x.nav.locale)} · v${s.version}` : c.general; };
  return <><Sheet open={open} onClose={() => { if (!x.busy) onClose(); }} label={c.task}>
    <div className="vx-sheet-stack">
      <SheetHead title={c.task} sub={connection.displayLabel} />
      <div className="vx-group">
        <Row plain lead={<LetterTile text={x.agentName(agent)} round />} title={c.agent} value={x.agentName(agent)} chevron disabled={x.busy || agentIds.length < 2} onClick={() => setPicking('agent')} />
        <Row plain lead={<IconTile name="spark" />} title={c.skill} value={skillLabel(skill)} chevron disabled={x.busy || !skills.length} onClick={() => setPicking('skill')} />
      </div>
      <p className="vx-footnote">{c.taskHint}</p>
      <Composer multiline value={message} onChange={v => { setMessage(v); setResult(null); }} onSend={() => void run()} busy={x.busy} maxLength={8000}
        label={c.taskLabel} sendLabel={c.runTask} placeholder={c.taskLabel} disabled={!agent} />
      {result && <div className="vx-panel vx-conn-result" role="status" dir="auto">{result.text}</div>}
      {x.error && <SheetError>{x.error}</SheetError>}
    </div>
  </Sheet>
    <Picker open={picking === 'agent'} onClose={() => setPicking(null)} title={c.agent} value={agent || null}
      options={agentIds.map(id => ({ value: id, label: x.agentName(id), lead: <LetterTile text={x.agentName(id)} round /> }))} onChange={v => { setAgent(v); setResult(null); }} />
    <Picker open={picking === 'skill'} onClose={() => setPicking(null)} title={c.skill} value={skill}
      options={[{ value: '', label: c.general }, ...skills.map(s => ({ value: s.id, label: skillLabel(s.id) }))]} onChange={v => { setSkill(v); setResult(null); }} /></>;
}

/* ---------- activity ---------- */

const STATE_ICON: Partial<Record<OperationReceipt['state'], string>> = { needs_approval: 'warn', authorized: 'check', queued: 'clock', sending: 'send', verified: 'check', committed: 'check', failed: 'close', cancelled: 'close', expired: 'clock', outcome_unknown: 'info' };

/** Recent activity: what each agent did or asked to do. An uncertain outcome is said plainly and never offers a blind retry. */
export function Activity({ x, agentId, onReview }: { x: Connections; agentId?: string; onReview: (r: Review) => void }) {
  const { c, data } = x;
  if (!data) return null;
  const ops = data.operations.filter(o => !agentId || o.agentId === agentId).slice(-30).reverse();
  const open = (operation: OperationReceipt) => x.act(async turn => { const r = await connectionsApi.review(x.space, operation); if (x.current(turn)) onReview(r); });
  const review = ops.filter(o => o.state === 'needs_approval');
  const rest = ops.filter(o => o.state !== 'needs_approval');
  const row = (operation: OperationReceipt) => {
    const tone = operation.state === 'outcome_unknown' || operation.state === 'failed' ? 'warn' : operation.state === 'verified' || operation.state === 'committed' ? 'live' : '';
    return <div key={operation.operationId} className="vx-row top vx-conn-op">
      <span className={`vx-tile icon${tone ? ` ${tone}` : ''}`} aria-hidden="true"><Icon name={STATE_ICON[operation.state] ?? 'spark'} size={20} /></span>
      <span className="vx-row-main">
        <span className="vx-row-title">{x.toolName(operation.toolId)}</span>
        <span className="vx-row-sub">{x.agentName(operation.agentId)} · {stateLabel(c, operation.state)}</span>
        {operation.state === 'outcome_unknown' && <span className="vx-row-sub warn">{c.unknown}</span>}
        {['authorized', 'queued'].includes(operation.state) && <span className="vx-pref-actions">
          {operation.state === 'authorized' && <button type="button" className="vx-btn vx-btn-tonal vx-btn-xs" disabled={x.busy}
            onClick={() => void x.act(async () => { await connectionsApi.execute(x.space, operation.operationId); await x.reload(); })}>{c.run}</button>}
          <button type="button" className="vx-btn vx-btn-ghost vx-btn-xs" disabled={x.busy} onClick={() => void x.act(async () => { await connectionsApi.cancel(x.space, operation); await x.reload(); })}>{c.cancel}</button>
        </span>}
      </span>
    </div>;
  };
  return <>
    {!!review.length && <Section title={c.pendingApproval}>
      {review.map(operation => <Row key={operation.operationId} size="l" chevron disabled={x.busy} onClick={() => void open(operation)} aria-label={`${c.review}: ${x.toolName(operation.toolId)}`}
        lead={<IconTile name="warn" tone="warn" />} title={x.toolName(operation.toolId)} sub={`${x.agentName(operation.agentId)} · ${c[operation.effect]} · ${c.deadline} ${x.when(operation.deadlineAt)}`} />)}
    </Section>}
    <Section title={c.recent}>
      {!rest.length && <div className="vx-row"><span className="vx-row-sub">{c.noActivity}</span></div>}
      {rest.map(row)}
    </Section>
  </>;
}
