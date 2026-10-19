'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionsDashboard, ConnectionResourceView, SetupReceipt } from '@/lib/connections/application';
import type { ConnectionView, OperationReceipt, SpaceKind } from '@/lib/connections/contracts';
import { connectionsApi, openConnectionSignIn } from '../../_lib/connections-client';
import { connectionsCopy, connectionSkillTitle, type ConnectionsLocale } from '../../_lib/connections-copy';
import { ApiError } from '../../_lib/client';
import { Icon, Spinner, TopBar } from '../ui';
import type { ConnectionTaskResult } from '@/lib/connections/task-runtime';
import { ConnectionWorkflows } from './ConnectionWorkflows';

const card = { padding: 18, display: 'flex', flexDirection: 'column' as const, gap: 12 };
const row = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const };

export function ConnectionsScreen({ onBack, agentId }: { onBack: () => void; agentId?: string }) {
  const [locale, setLocale] = useState<ConnectionsLocale>('en');
  const [space, setSpace] = useState<SpaceKind>('work');
  const [data, setData] = useState<ConnectionsDashboard | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<ConnectionView | null>(null);
  const [resources, setResources] = useState<ConnectionResourceView[]>([]);
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [chosenAgent, setChosenAgent] = useState(agentId ?? '');
  const [hours, setHours] = useState(1);
  const [expiryBase, setExpiryBase] = useState(Date.now());
  const [flow, setFlow] = useState<SetupReceipt | null>(null);
  const [review, setReview] = useState<{ receipt: OperationReceipt; arguments: Record<string, unknown> } | null>(null);
  const [taskConnection, setTaskConnection] = useState<string | null>(null);
  const [taskMessage, setTaskMessage] = useState('');
  const [taskResult, setTaskResult] = useState<ConnectionTaskResult | null>(null);
  const [skillId, setSkillId] = useState('');
  const generation = useRef(0);
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const c = connectionsCopy[locale];

  const refresh = useCallback(async () => {
    const turn = ++generation.current;
    setData(null); setError(''); setStatus(''); setSelected(null); setReview(null); setFlow(null); setTaskConnection(null); setTaskMessage(''); setTaskResult(null);
    try { const result = await connectionsApi.read(space); if (turn === generation.current) setData(result); }
    catch (cause) { if (turn === generation.current) setError(cause instanceof ApiError && cause.message === 'profile_confirmation_required' ? c.identity : c.loadError); }
  }, [space, c.identity, c.loadError]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => { void refresh(); return invalidate; }, [refresh, invalidate]);
  useEffect(() => { if (selected || review || adding) heading.current?.focus(); }, [selected, review, adding]);

  const act = async (task: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setStatus('');
    try { await task(); }
    catch { setError(c.error); }
    finally { lock.current = false; setBusy(false); }
  };
  const reload = async () => {
    const turn = generation.current;
    const result = await connectionsApi.read(space);
    if (turn === generation.current) setData(result);
  };
  const openAccess = (connection: ConnectionView) => act(async () => {
    const turn = generation.current;
    const result = await connectionsApi.resources(space, connection.id);
    if (turn !== generation.current) return;
    setResources(result.resources); setResourceIds([]); setToolIds([]); setSelected(connection); setReview(null); setAdding(false); setExpiryBase(Date.now());
  });
  const setup = (connection: ConnectionView) => act(async () => {
    const result = await connectionsApi.setup(space, connection.id);
    setFlow(result); setAdding(false);
    if (result.status === 'connected') { setStatus(c.zero); await reload(); }
  });
  const toggle = (current: string[], value: string) => current.includes(value) ? current.filter(id => id !== value) : [...current, value];
  const provider = data?.providers.find(p => p.id === selected?.providerId);
  const selectedResources = resources.filter(r => resourceIds.includes(r.id));
  const availableTools = provider?.tools.filter(t => selectedResources.length > 0 && selectedResources.every(r => r.toolIds.includes(t.id))) ?? [];
  const activeTools = availableTools.filter(t => toolIds.includes(t.id));
  const destinations = [...new Set(selectedResources.flatMap(r => r.destinationIds))];
  const grantExpiry = Math.min(expiryBase + hours * 3_600_000, data?.maxGrantExpiryAt ?? 0);
  const operationState = (operation: OperationReceipt) => operation.state === 'needs_approval' ? c.pendingApproval : c[operation.state];
  const closeDetail = () => { setSelected(null); setReview(null); setAdding(false); };

  return <section className="vx-scroll vx-privacy" dir={locale === 'fa' ? 'rtl' : 'ltr'} lang={locale} aria-busy={busy}>
    <TopBar onBack={selected || review || adding ? closeDetail : onBack} backLabel={c.back} />
    <header className="vx-privacy-heading"><span className="vx-privacy-symbol"><Icon name="shield" size={28} /></span>
      <div><p className="vx-over">{c.subtitle}</p><h1 className="vx-title" tabIndex={-1} ref={heading}>{review ? c.review : selected ? c.reviewAccess : adding ? c.chooseService : c.title}</h1></div>
      <label className="vx-small">{c.language}<select className="vx-input" value={locale} disabled={busy || !!flow && flow.status === 'pending'} onChange={e => setLocale(e.target.value as ConnectionsLocale)}><option value="en">English</option><option value="fa">فارسی</option></select></label>
    </header>
    <p className="vx-2">{c.intro}</p>
    <div className="vx-privacy-spaces" role="group" aria-label={c.title}>{(['work', 'personal'] as const).map(value => <button key={value} className="vx-btn vx-btn-secondary" aria-pressed={space === value} disabled={busy || !!flow && flow.status === 'pending'} onClick={() => setSpace(value)}>{c[value]}</button>)}</div>
    <p className="vx-small vx-2"><Icon name="lock" size={14} /> {c.audience}</p>
    {error && <div className="vx-banner danger" role="alert">{error}<button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void refresh()}>{c.refresh}</button></div>}
    {status && <p className="vx-banner info" role="status">{status}</p>}
    {!data && !error && <p role="status"><Spinner /> {c.loading}</p>}
    {data && <>
      {!data.enabled && <p className="vx-banner info">{c.unavailable}</p>}
      {data.modelProcessor && <p className="vx-small vx-2">{c.processor} <bdi>{data.modelProcessor.provider} · {data.modelProcessor.model}</bdi>.</p>}
      {data.canRunTasks === false && <p className="vx-small vx-2">{c.processorPending}</p>}
      {flow?.status === 'pending' && <div className="vx-card" style={card}>
        <h2 className="vx-head">{c.waiting}</h2><p className="vx-small vx-2">{c.returnNote}</p>
        {flow.authorizationUrl && <button className="vx-btn vx-btn-primary" disabled={busy} onClick={() => openConnectionSignIn(flow.authorizationUrl!)}>{c.browser}</button>}
        <div style={row}><button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void act(async () => { const result = await connectionsApi.claim(space, flow.flowId); setFlow(result); if (result.status === 'connected') { setStatus(c.zero); await reload(); } })}>{c.check}</button>
          <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void act(async () => { setFlow(await connectionsApi.cancelSetup(space, flow.flowId)); await reload(); })}>{c.cancelSetup}</button></div>
      </div>}
      {flow && flow.status !== 'pending' && flow.status !== 'connected' && <p role="status" className="vx-banner info">{c[flow.status === 'failed' ? 'failed' : flow.status]}</p>}
      {adding ? <div style={{ display: 'grid', gap: 12 }}>
        {data.providers.map(p => <article className="vx-card" style={card} key={p.id}>
          <div style={row}><h2 className="vx-head" style={{ flex: 1 }}>{p.name}</h2>{p.availability !== 'ready' && <span className="vx-pill lock">{p.availability === 'setup_required' ? c.setupRequired : c.notAvailable}</span>}</div>
          <p className="vx-small vx-2">{p.description}</p>
          {p.reason && <details><summary className="vx-small">{c.requirements}</summary><p className="vx-small vx-2">{p.reason}</p></details>}
          <button className="vx-btn vx-btn-secondary" disabled={busy || p.availability !== 'ready' || !data.enabled} onClick={() => void act(async () => {
            const before = new Set(data.connections.map(connection => connection.id));
            const result = await connectionsApi.enroll(space, p.id, p.name);
            const created = result.connections.find(connection => !before.has(connection.id));
            await reload(); setAdding(false);
            if (created) setFlow(await connectionsApi.setup(space, created.id));
          })}>{c.add}</button>
        </article>)}
      </div> : selected ? <div className="vx-card" style={card}>
        <p className="vx-head">{selected.displayLabel}</p>
        <label className="vx-small">{c.agent}<select className="vx-input" value={chosenAgent} disabled={busy} onChange={e => setChosenAgent(e.target.value)}><option value="">{c.select}</option>{data.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        <fieldset disabled={busy} style={{ border: 0, padding: 0 }}><legend className="vx-head">{c.resources}</legend>
          {!resources.length && <p className="vx-small vx-2">{c.noResources}</p>}
          {resources.map(resource => <label key={resource.id} className="vx-privacy-checkbox"><input type="checkbox" checked={resourceIds.includes(resource.id)} onChange={() => { setResourceIds(toggle(resourceIds, resource.id)); setToolIds([]); }} /><span>{resource.label}<br /><bdi className="vx-small vx-2" style={{ overflowWrap: 'anywhere' }}>{resource.id}</bdi></span></label>)}
        </fieldset>
        <fieldset disabled={busy} style={{ border: 0, padding: 0 }}><legend className="vx-head">{c.actions}</legend>{availableTools.map(tool => <label key={tool.id} className="vx-privacy-checkbox"><input type="checkbox" checked={toolIds.includes(tool.id)} onChange={() => setToolIds(toggle(toolIds, tool.id))} /><span>{tool.name} · {c[tool.effect]}</span></label>)}</fieldset>
        <label className="vx-small">{c.expiry}<select className="vx-input" value={hours} disabled={busy} onChange={e => setHours(Number(e.target.value))}><option value={1}>{c.oneDay}</option><option value={8}>{c.sevenDays}</option></select></label>
        <p className="vx-small">{new Date(grantExpiry).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB')}</p>
        <p className="vx-small vx-2">{c.reviewNote}</p>
        <details><summary className="vx-small">{c.target}</summary>{destinations.map(id => <p className="vx-small" key={id}><bdi>{id}</bdi></p>)}</details>
        <button className="vx-btn vx-btn-primary" disabled={busy || !chosenAgent || !resourceIds.length || !activeTools.length || !destinations.length} onClick={() => void act(async () => {
          await connectionsApi.grant({ space, connectionId: selected.id, expectedRevision: selected.revision, agentId: chosenAgent,
            toolIds: activeTools.map(t => t.id), resourceIds, destinationIds: destinations, effects: [...new Set(activeTools.map(t => t.effect))],
            expiresAt: grantExpiry, maxCalls: 100, maxBytes: 1_000_000 });
          setSelected(null); await reload(); setStatus(c.saved);
        })}>{busy ? c.working : c.allow}</button>
      </div> : review ? <div className="vx-card" style={card}>
        <h2 className="vx-head">{data.agents.find(a => a.id === review.receipt.agentId)?.name ?? review.receipt.agentId}</h2>
        <p>{c.effect}: {c[review.receipt.effect]}</p><p className="vx-small">{c.target}: <bdi>{review.receipt.destinationId}</bdi></p>
        <ul className="vx-small">{review.receipt.resourceIds.map(id => <li key={id}><bdi>{id}</bdi></li>)}</ul>
        <p className="vx-small">{c.deadline}: {new Date(review.receipt.deadlineAt).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB')}</p>
        <h3 className="vx-head">{c.payload}</h3><pre dir="ltr" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13, maxHeight: 360, overflow: 'auto' }}>{JSON.stringify(review.arguments, null, 2)}</pre>
        <div style={row}><button className="vx-btn vx-btn-primary" disabled={busy || review.receipt.state !== 'needs_approval'} onClick={() => void act(async () => { const approved = await connectionsApi.approve(space, review.receipt); setReview(null); await connectionsApi.execute(space, approved.operationId); await reload(); })}>{c.approve}</button>
          <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void act(async () => { await connectionsApi.cancel(space, review.receipt); setReview(null); await reload(); })}>{c.cancel}</button></div>
      </div> : <>
        <button className="vx-btn vx-btn-primary" disabled={busy} onClick={() => setAdding(true)}><Icon name="plus" />{c.add}</button>
        {!data.connections.length && <p className="vx-2">{c.empty}</p>}
        {data.connections.map(connection => {
          const grants = data.grants.filter(g => g.connectionId === connection.id && (!agentId || g.agentId === agentId));
          return <article key={connection.id} className="vx-card" style={card}>
            <div style={row}><h2 className="vx-head" style={{ flex: 1 }}>{connection.displayLabel}</h2><span className={`vx-pill ${connection.lifecycle === 'connected' ? 'live' : 'lock'}`}>{c[connection.lifecycle]}</span></div>
            {connection.health !== 'healthy' && connection.health !== 'unknown' && <p className="vx-small vx-2">{c.health}: <bdi>{connection.health}</bdi></p>}
            {!grants.length && <p className="vx-small vx-2">{c.noAccess}</p>}
            {grants.map(grant => <div key={grant.id} style={row}><span className="vx-small" style={{ flex: 1 }}>{data.agents.find(a => a.id === grant.agentId)?.name ?? grant.agentId} · {grant.resourceIds.length} {c.resources}</span><button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void act(async () => { await connectionsApi.revoke(space, connection.id, connection.revision, grant.id, grant.revision); setTaskResult(null); setTaskConnection(null); await reload(); setStatus(c.stopped); })}>{c.stop}</button></div>)}
            <div style={row}>
              {connection.lifecycle === 'connected' && <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void openAccess(connection)}>{c.manage}</button>}
              {connection.lifecycle === 'connected' && grants.length > 0 && <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy || data.canRunTasks === false} onClick={() => { setTaskConnection(connection.id); setChosenAgent(grants[0].agentId); setTaskResult(null); setTaskMessage(''); setSkillId(''); }}>{c.task}</button>}
              {connection.lifecycle === 'pending' && <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void setup(connection)}>{c.finish}</button>}
              {['connected', 'pending', 'paused'].includes(connection.lifecycle) && <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void act(async () => { await connectionsApi.revoke(space, connection.id, connection.revision); setTaskResult(null); setTaskConnection(null); await reload(); setStatus(c.stopped); })}>{c.disconnect}</button>}
            </div>
            {taskConnection === connection.id && <form onSubmit={event => { event.preventDefault(); void act(async () => {
              const result = await connectionsApi.task({ space, agentId: chosenAgent, connectionId: connection.id, message: taskMessage, requestId: crypto.randomUUID(), ...(skillId ? { skillId, skillVersion: 1 as const } : {}) });
              setTaskResult(result); await reload();
            }); }} style={{ display: 'grid', gap: 12 }}>
              <p className="vx-small vx-2">{c.taskHint}</p>
              <label className="vx-small">{c.agent}<select className="vx-input" value={chosenAgent} disabled={busy} onChange={e => { setChosenAgent(e.target.value); setTaskResult(null); }}>{grants.map(grant => <option value={grant.agentId} key={grant.id}>{data.agents.find(a => a.id === grant.agentId)?.name ?? grant.agentId}</option>)}</select></label>
              <label className="vx-small">{c.skill}<select className="vx-input" value={skillId} disabled={busy} onChange={e => { setSkillId(e.target.value); setTaskResult(null); }}><option value="">{c.general}</option>{data.skills?.filter(s => s.providerIds.includes(connection.providerId)).map(s => <option value={s.id} key={s.id}>{connectionSkillTitle(s.id, s.title, locale)} · v{s.version}</option>)}</select></label>
              <label className="vx-small">{c.taskLabel}<textarea className="vx-textarea" rows={3} maxLength={8000} value={taskMessage} disabled={busy} onChange={e => setTaskMessage(e.target.value)} /></label>
              <button className="vx-btn vx-btn-primary" disabled={busy || !taskMessage.trim()} type="submit">{busy ? c.working : c.runTask}</button>
              {taskResult && <p role="status" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{taskResult.text}</p>}
            </form>}
          </article>;
        })}
        <ConnectionWorkflows key={`${space}:${locale}`} data={data} space={space} locale={locale} agentId={agentId} />
        <h2 className="vx-title-m">{c.recent}</h2>
        {!data.operations.length && <p className="vx-small vx-2">{c.noActivity}</p>}
        {data.operations.filter(o => !agentId || o.agentId === agentId).slice(-30).reverse().map(operation => <article key={operation.operationId} className="vx-card" style={card}>
          <div style={row}><span className="vx-head">{data.providers.flatMap(p => p.tools).find(t => t.id === operation.toolId)?.name ?? operation.toolId}</span><span className="vx-small vx-2">{operationState(operation)}</span></div>
          {operation.state === 'outcome_unknown' && <p className="vx-small vx-2">{c.unknown}</p>}
          {operation.state === 'needs_approval' && <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void act(async () => { setReview(await connectionsApi.review(space, operation)); setSelected(null); })}>{c.review}</button>}
          {operation.state === 'authorized' && <button className="vx-btn vx-btn-secondary" disabled={busy} onClick={() => void act(async () => { await connectionsApi.execute(space, operation.operationId); await reload(); })}>{c.run}</button>}
          {['needs_approval', 'authorized', 'queued'].includes(operation.state) && <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void act(async () => { await connectionsApi.cancel(space, operation); await reload(); })}>{c.cancel}</button>}
        </article>)}
      </>}
    </>}
  </section>;
}
