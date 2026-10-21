'use client';
import { flushSync } from 'react-dom';
import { pageActive, subscribeActivity } from '../../_components/motion/activity';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionsDashboard, ConnectionResourceView, SetupReceipt, McpSetupPreview } from '@/lib/connections/application';
import type { ConnectionView, OperationReceipt, SpaceKind } from '@/lib/connections/contracts';
import { ApiError, initTelegram, tg } from '../../_lib/client';
import { createAgentConnectionsApi, type AgentConnectionsApi } from '../../_lib/agent-connections-client';
import { connectionsTranslate, type ConnectionsLocale, type ConnectionsTranslate } from './copy';
import { openConnectionSignIn } from '../../_lib/connections-client';

const errorText = (cause: unknown) => cause instanceof ApiError ? ({
  mcp_token_verification_unsupported: 'This server uses tokens Vox cannot verify yet. It needs signed access tokens for this exact server.',
  mcp_client_registration_unsupported: 'This server’s sign-in method is not supported yet. Choose another compatible MCP server.',
  mcp_url_unsupported: 'Use a public HTTPS MCP URL without a query or fragment.',
  mcp_setup_unavailable: 'MCP connections are awaiting service setup.',
  mcp_open_agent_bot: 'Open this agent’s Telegram Mini App to finish setup.',
  authentication_required: 'Open Connections from this agent’s Telegram bot to continue.',
  mcp_review_unavailable: 'Finish sign-in in the browser, then check again.',
  profile_confirmation_required: 'Confirm your own account before connecting a service.',
  agent_unavailable: 'This agent is unavailable for your account.',
  configuration_changed: 'Service settings changed. Refresh before trying again.',
  provider_setup_required: 'This service is not ready for sign-in yet.',
  connection_exists: 'This service is already connected here.',
  grant_exists: 'Stop the existing access before choosing new access.',
  task_tools_unavailable: 'The selected tools are not available for agent tasks yet.',
  connections_unavailable: 'Connections are temporarily unavailable. Try refreshing.',
}[cause.message] ?? 'The change could not be confirmed. Refresh before trying again.') : 'The change could not be confirmed. Refresh before trying again.';

/** A signed bot session owns all displayed state. Account switches/backgrounding discard it. */
export function AgentConnectionsApp({ agentId }: { agentId: string }) {
  const [session, setSession] = useState(() => ({ signed: tg()?.initData ?? '', generation: 0, active: true }));
  const latest = useRef(session); latest.current = session;
  useLayoutEffect(() => {
    let frame = 0;
    const update = (synchronous = true) => {
      const signed = tg()?.initData ?? '', active = pageActive();
      if (latest.current.signed !== signed || latest.current.active !== active) {
        const next = { signed, active, generation: latest.current.generation + 1 }; latest.current = next; if (synchronous) flushSync(() => setSession(next)); else setSession(next);
      }
    };
    const tick = () => { update(); frame = requestAnimationFrame(tick); };
    const off = subscribeActivity(() => update()); update(false); frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); off(); };
  }, [agentId]);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(agentId)) return <main className="vxc-root" role="alert">Open Connections from this agent’s Telegram bot to continue.</main>;
  if (!session.active || session.signed !== (tg()?.initData ?? '')) return <main className="vxc-root" aria-busy="true" />;
  return <ConnectionsSession key={`${agentId}:${session.generation}`} agentId={agentId} signed={session.signed} />;
}

function ConnectionsSession({ agentId, signed }: { agentId: string; signed: string }) {
  const [space, setSpace] = useState<SpaceKind>('personal');
  // Telegram exists only on the client. Keep the initial markup identical to SSR.
  const [locale, setLocale] = useState<ConnectionsLocale>('en');
  useEffect(() => {
    const app = tg() as ReturnType<typeof tg> & { initDataUnsafe?: { user?: { language_code?: string } } };
    setLocale(app?.initDataUnsafe?.user?.language_code?.startsWith('fa') ? 'fa' : 'en');
  }, [signed]);
  return <SpaceConnectionsSession key={space} agentId={agentId} signed={signed} space={space} setSpace={setSpace} locale={locale} setLocale={setLocale} />;
}
function SpaceConnectionsSession({ agentId, signed, space, setSpace, locale, setLocale }: { agentId: string; signed: string; space: SpaceKind; setSpace: (space: SpaceKind) => void; locale: ConnectionsLocale; setLocale: (locale: ConnectionsLocale) => void }) {
  const t = useMemo(() => connectionsTranslate(locale), [locale]);
  const controller = useRef(new AbortController());
  const api = useMemo(() => createAgentConnectionsApi(agentId, signed, () => controller.current.signal), [agentId, signed]);
  const [data, setData] = useState<ConnectionsDashboard | null>(null), [error, setError] = useState('');
  const [needsProfile, setNeedsProfile] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), lock = useRef(false), alive = useRef(true), scope = useRef(0);
  const [selected, setSelected] = useState<string | null>(null), [flow, setFlow] = useState<SetupReceipt | null>(null);
  const [mcpReview, setMcpReview] = useState<McpSetupPreview | null>(null);
  const [catalogAccepted, setCatalogAccepted] = useState(false);
  const [endpointUrl, setEndpointUrl] = useState(''), [serverName, setServerName] = useState('');
  const current = useCallback(() => alive.current && tg()?.initData === signed && pageActive(), [signed]);
  const onFailure = useCallback((cause: unknown) => {
    if (!current()) return;
    const lost = cause instanceof ApiError && [401, 403].includes(cause.status);
    if (lost) {
      controller.current.abort(); controller.current = new AbortController(); scope.current++;
      flushSync(() => { setError(errorText(cause)); setData(null); setSelected(null); setFlow(null); setMcpReview(null); setNeedsProfile(cause.message === 'profile_confirmation_required'); });
    } else setError(errorText(cause));
  }, [current]);
  const load = useCallback(async () => {
    const turn = ++scope.current; setError(''); setData(null); setSelected(null);
    try { const result = await api.read(space); if (current() && turn === scope.current) { setData(result); setNeedsProfile(false); } }
    catch (cause) { if (current() && turn === scope.current) onFailure(cause); }
  }, [api, space, current, onFailure]);
  const invalidate = useCallback(() => { scope.current++; }, []);
  useLayoutEffect(() => { if (controller.current.signal.aborted) controller.current = new AbortController(); alive.current = true;
    return () => { alive.current = false; invalidate(); controller.current.abort(); }; }, [invalidate]);
  useEffect(() => { initTelegram(); void load(); return invalidate; }, [load, invalidate]);
  const act = async (task: () => Promise<void>) => {
    if (lock.current || !current()) return; lock.current = true; setBusy(true); setError('');
    try { await task(); } catch (cause) { onFailure(cause); }
    finally { lock.current = false; if (current()) setBusy(false); }
  };
  const refresh = async () => { const result = await api.read(space); if (current()) setData(result); };
  const landed = async (result: SetupReceipt) => { if (!current()) return; setFlow(result); if (result.status === 'connected') { setFlow(null); await refresh(); } };
  const check = () => flow && act(async () => {
    if (flow.kind === 'remote_mcp') { const preview = await api.mcpPreview(space, flow.flowId); if (current()) { setMcpReview(preview); setCatalogAccepted(false); } }
    else await landed(await api.claim(space, flow.flowId));
  });
  useEffect(() => {
    const onReturn = () => { if (flow?.status === 'pending' && current()) void check(); };
    const app = tg() as ReturnType<typeof tg> & { onEvent?(name: string, fn: () => void): void; offEvent?(name: string, fn: () => void): void };
    window.addEventListener('focus', onReturn); app?.onEvent?.('activated', onReturn);
    return () => { window.removeEventListener('focus', onReturn); app?.offEvent?.('activated', onReturn); };
  });
  const addProvider = (id: string, name: string) => act(async () => {
    const result = await api.enroll(space, id, name); const connection = result.connections.find(c => c.agentId === agentId && c.providerId === id && c.lifecycle === 'pending');
    await refresh(); if (connection) await landed(await api.setup(space, connection.id));
  });
  const agentName = data?.agents.find(a => a.id === agentId)?.name ?? t('This agent');
  return <main className="vxc-root" lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'}><div className="vxc-wrap">
    <header className="vxc-head"><div><p className="vxc-kicker">{agentName}</p><h1>{t("Connections")}</h1></div><a href={`/studio/pet/${encodeURIComponent(agentId)}`}>{t("Back to agent")}</a></header>
    <p className="vxc-muted">{t("Connect your own accounts and choose what this agent may use. Each agent has separate access.")}</p>
    <label>{t('Language')}<select aria-label={t('Language')} value={locale} onChange={e => setLocale(e.target.value as ConnectionsLocale)}><option value="en">English</option><option value="fa">فارسی</option></select></label>
    <label>{t("Space")}<select aria-label={t('Space')} value={space} disabled={busy || !!flow} onChange={e => { setSpace(e.target.value as SpaceKind); setFlow(null); }}><option value="personal">{t("Personal · only you")}</option><option value="work">{t("Work · only you")}</option></select></label>
    {error && <div role="alert" className="vxc-note vxc-error">{t(error)}<div><button className="vxc-link" disabled={busy} onClick={() => void load()}>{t("Refresh")}</button></div></div>}
    {needsProfile && <section className="vxc-card"><h2>{t("Your account")}</h2><p>{t("This connects services you choose to your own Vox profile. It gives no agent access until you choose tools and resources.")}</p>
      <label className="vxc-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />{t("This is my Telegram account and I am connecting my own services.")}</label>
      <button className="vxc-primary" disabled={busy || !confirmed} onClick={() => void act(async () => { await api.confirm(space); await load(); })}>{t("Confirm my account")}</button></section>}
    {!data && !error && <p role="status">{t("Loading connections…")}</p>}
    {data && <>
      {!data.enabled && <div className="vxc-note">{t("Connections are awaiting service setup.")}</div>}
      {flow && <section className="vxc-card"><h2>{flow.status === 'pending' ? t('Finish sign-in') : `${t('Sign-in')} ${t(flow.status)}`}</h2><p className="vxc-muted">{t("Return here after choosing your account in the browser. Connecting gives no automatic agent access.")}</p>
        <div className="vxc-stack">{flow.authorizationUrl && flow.status === 'pending' && <button className="vxc-primary" disabled={busy} onClick={() => openConnectionSignIn(flow.authorizationUrl!)}>{t("Continue in browser")}</button>}
          {flow.status === 'pending' && <button disabled={busy} onClick={() => void check()}>{t("Check connection")}</button>}
          <button disabled={busy} onClick={() => void act(async () => { if (flow.status === 'pending') { if (flow.kind === 'remote_mcp') await api.mcpCancel(space, flow.flowId); else await api.cancelSetup(space, flow.flowId); } if (current()) setFlow(null); await refresh(); })}>{flow.status === 'pending' ? t('Cancel sign-in') : t('Close')}</button></div></section>}
      {mcpReview && <section className="vxc-card" aria-label={t('Review MCP server')}><h2>{t("Review this server")}</h2><p><bdi>{mcpReview.catalog.resource}</bdi></p>
        <p className="vxc-muted">{t("This server does not provide a verified human account identity. Its tool descriptions are supplied by the server. Every tool call needs your exact review.")}</p>
        {mcpReview.catalog.tools.map(tool => <details key={tool.id}><summary>{tool.title}</summary><p>{tool.description}</p><pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre></details>)}
        <label className="vxc-check"><input type="checkbox" checked={catalogAccepted} disabled={busy} onChange={e => setCatalogAccepted(e.target.checked)} />{t("I want to connect this server to this agent. I will choose tool access next.")}</label>
        <button className="vxc-primary" disabled={busy || !catalogAccepted} onClick={() => void act(async () => { await landed(await api.mcpClaim(space, mcpReview.flowId, mcpReview.catalog.catalogDigest)); if (current()) setMcpReview(null); })}>{t("Connect reviewed server")}</button>
      </section>}
      <section aria-label={t('Your connections')}><h2>{t("Your connections")}</h2>
        {!data.connections.length && <p className="vxc-muted">{t("No accounts connected to this agent yet.")}</p>}
        {data.connections.filter(c => c.agentId === agentId && c.lifecycle !== 'deleted').map(c => <section key={c.id} className="vxc-card"><div className="vxc-row"><h2>{c.displayLabel}</h2><span className="vxc-status">{t(c.lifecycle.replace(/_/g, ' '))}</span></div>
          {c.lifecycle === 'pending' ? <button disabled={busy} onClick={() => void act(async () => landed(await api.setup(space, c.id)))}>{t("Finish setup")}</button> : c.lifecycle === 'connected' ? <button disabled={busy} onClick={() => setSelected(selected === c.id ? null : c.id)}>{selected === c.id ? t('Close access') : t('Choose access')}</button> : <p className="vxc-muted">{t("Access stopped.")}</p>}
          {selected === c.id && c.lifecycle === 'connected' && <ConnectionAccess key={`${c.id}:${space}`} api={api} data={data} connection={c} space={space} agentId={agentId} busy={busy} act={act} refresh={refresh} current={current} onFailure={onFailure} t={t} locale={locale} />}
        </section>)}
      </section>
      <section className="vxc-card"><h2>{t("Connect a service")}</h2>{data.providers.filter(provider => provider.id !== 'remote_mcp' && provider.availability === 'ready').map(provider => {
        const exists = data.connections.some(c => c.agentId === agentId && c.providerId === provider.id && !['deleted', 'revoked'].includes(c.lifecycle));
        return <div className="vxc-resource" key={provider.id}><div className="vxc-row"><div><b>{provider.name}</b><p className="vxc-muted">{provider.description}</p></div><button disabled={busy || !data.enabled || provider.availability !== 'ready' || exists} onClick={() => void addProvider(provider.id, provider.name)}>{exists ? t('Connected') : t('Connect')}</button></div>
          {provider.availability !== 'ready' && <details><summary>{t("Availability")}</summary>{provider.reason || t('This service is not ready for sign-in yet.')}</details>}</div>;
      })}{data.mcpAvailable && !data.providers.some(p => p.id !== 'remote_mcp' && p.availability === 'ready') && <p className="vxc-muted">{t('Use a compatible MCP server below to connect your own service.')}</p>}</section>
      {'mcpAvailable' in data && data.mcpAvailable === true && <form className="vxc-card" onSubmit={e => { e.preventDefault(); void act(async () => {
        const result = await api.mcpEnroll(space, endpointUrl, serverName); const before = new Set(data.connections.map(c => c.id));
        const added = result.connections.find(c => !before.has(c.id)); await refresh(); if (added) await landed(await api.setup(space, added.id));
      }); }}><h2>{t("Connect an MCP server")}</h2><p className="vxc-muted">{t("Use a compatible public HTTPS server. You will review its tools before this agent can use them.")}</p>
        <label>{t("Server URL")}<input type="url" dir="ltr" required value={endpointUrl} onChange={e => setEndpointUrl(e.target.value)} placeholder="https://example.com/mcp" autoComplete="off" /></label>
        <label>{t("Name")}<input required maxLength={160} value={serverName} onChange={e => setServerName(e.target.value)} autoComplete="off" /></label>
        <button className="vxc-primary" disabled={busy || !endpointUrl || !serverName}>{t("Continue")}</button></form>}
      <p className="vxc-muted">{t("Accounts, connection results and access settings on this page belong to you. Your connection does not give another person or agent access.")}</p>
    </>}
  </div></main>;
}

function ConnectionAccess({ api, data, connection, space, agentId, busy, act, refresh, current, onFailure, t, locale }: { api: AgentConnectionsApi; data: ConnectionsDashboard; connection: ConnectionView;
  space: SpaceKind; agentId: string; busy: boolean; act: (task: () => Promise<void>) => Promise<void>; refresh: () => Promise<void>; current: () => boolean; onFailure: (cause: unknown) => void; t: ConnectionsTranslate; locale: ConnectionsLocale }) {
  const [resources, setResources] = useState<ConnectionResourceView[] | null>(null), [failure, setFailure] = useState('');
  const [chosen, setChosen] = useState<string[]>([]), [tools, setTools] = useState<string[]>([]), [hours, setHours] = useState(1);
  const [message, setMessage] = useState(''), [answer, setAnswer] = useState('');
  const [review, setReview] = useState<{ receipt: OperationReceipt; arguments: Record<string, unknown> } | null>(null);
  useEffect(() => { let alive = true; api.resources(space, connection.id).then(r => { if (alive && current()) setResources(r.resources); }).catch(cause => { if (alive && current()) { if (!(cause instanceof ApiError && [401, 403].includes(cause.status))) setFailure(errorText(cause)); onFailure(cause); } }); return () => { alive = false; }; }, [api, space, connection.id, current, onFailure]);
  const existingGrant = data.grants.find(g => g.connectionId === connection.id && g.agentId === agentId && g.status === 'active');
  const grant = existingGrant && existingGrant.expiresAt > Date.now() && existingGrant.scope.audienceRevision === data.scope.audienceRevision ? existingGrant : undefined;
  const selected = resources?.filter(r => chosen.includes(r.id)) ?? [];
  const connectionTools = resources?.some(r => r.tools) ? resources.flatMap(r => r.tools ?? []) : data.providers.find(p => p.id === connection.providerId)?.tools;
  const availableTools = connectionTools?.filter(t => selected.length > 0 && selected.every(r => r.toolIds.includes(t.id))) ?? [];
  const pending = data.operations.filter(o => o.agentId === agentId && o.state === 'needs_approval' && o.resourceIds.every(id => resources?.some(r => r.id === id)));
  return <div className="vxc-resource">
    {failure && <p role="alert">{t(failure)}</p>}
    {!resources && !failure && <p role="status">{t("Loading resources…")}</p>}
    {connection.mcp && <p className="vxc-muted">{t('Choosing this server does not narrow its external account permissions. Review each tool’s exact inputs. Vox checks this agent’s grants before every call.')}</p>}
    {existingGrant ? <><p>{grant ? <>{t('Access is allowed until')} {new Date(grant.expiresAt).toLocaleString(locale)}.</> : t('Previous access has ended. Stop it before choosing fresh access.')}</p><button disabled={busy} onClick={() => void act(async () => { await api.revoke(space, connection.id, connection.revision, existingGrant.id, existingGrant.revision); await refresh(); })}>{t("Stop agent access")}</button></> : resources && <>
      <fieldset disabled={busy}><legend>{t("Resources")}</legend>{resources.length === 0 && <p className="vxc-muted">{t("No verified resources are available for this account.")}</p>}{resources.map(r => <label className="vxc-check" key={r.id}><input type="checkbox" checked={chosen.includes(r.id)} onChange={e => { setChosen(e.target.checked ? [...chosen, r.id] : chosen.filter(id => id !== r.id)); setTools([]); }} />{r.label}</label>)}</fieldset>
      <fieldset disabled={busy}><legend>{t("Allowed actions")}</legend>{availableTools.map(t => <label className="vxc-check" key={t.id}><input type="checkbox" checked={tools.includes(t.id)} onChange={e => setTools(e.target.checked ? [...tools, t.id] : tools.filter(id => id !== t.id))} />{t.name}</label>)}</fieldset>
      <label>{t("Access ends")}<select value={hours} disabled={busy} onChange={e => setHours(Number(e.target.value))}><option value={1}>{t("Up to 1 hour")}</option><option value={8}>{t("Up to 8 hours")}</option></select></label>
      <p className="vxc-muted">{t("Only this agent can use the selected resources. Each change or external action still needs its own review.")}</p>
      <button className="vxc-primary" disabled={busy || !tools.length || !chosen.length} onClick={() => void act(async () => {
        const destinations = selected[0].destinationIds.filter(d => selected.every(r => r.destinationIds.includes(d)));
        await api.grant({ space, connectionId: connection.id, expectedRevision: connection.revision, toolIds: tools, resourceIds: chosen,
          destinationIds: destinations, effects: [...new Set(availableTools.filter(t => tools.includes(t.id)).map(t => t.effect))],
          expiresAt: Math.min(Date.now() + hours * 3_600_000, data.maxGrantExpiryAt), maxCalls: 20, maxBytes: 128_000 }); await refresh();
      })}>{t("Allow selected access")}</button>
    </>}
    {grant && data.canRunTasks && <form onSubmit={e => { e.preventDefault(); void act(async () => { const result = await api.task({ space, connectionId: connection.id, message, requestId: crypto.randomUUID() }); if (current()) setAnswer(result.text); await refresh(); }); }}>
      <hr />{data.modelProcessor && <p className="vxc-muted">{t('Your request and permitted results are sent to')} <bdi>{data.modelProcessor.provider} · {data.modelProcessor.model}</bdi>.</p>}<label>{t("Ask this agent about your selected resources")}<textarea required maxLength={8000} value={message} onChange={e => setMessage(e.target.value)} disabled={busy} /></label><button className="vxc-primary" disabled={busy || !message.trim()}>{t("Start task")}</button>{answer && <output>{answer}</output>}
    </form>}
    {pending.map(o => <div key={o.operationId} className="vxc-resource"><p>{t("Action waiting for your review")}</p><button disabled={busy} onClick={() => void act(async () => { const preview = await api.review(space, o); if (current()) setReview(preview); })}>{t("Review action")}</button></div>)}
    {review && <section className="vxc-card" aria-label="Review action"><h2>{t("Review exact action")}</h2><p>{review.receipt.toolId}</p><p className="vxc-muted">{review.receipt.resourceIds.join(', ')}</p><pre>{JSON.stringify(review.arguments, null, 2)}</pre>
      <div className="vxc-stack"><button className="vxc-primary" disabled={busy} onClick={() => void act(async () => { const approved = await api.approve(space, review.receipt); const result = await api.execute(space, approved.operationId); if (current()) { setReview(null); setAnswer(result.output ? JSON.stringify(result.output, null, 2) : result.receipt.state.replace(/_/g, ' ')); } await refresh(); })}>{t("Approve and run this action")}</button><button disabled={busy} onClick={() => setReview(null)}>{t("Close")}</button></div></section>}
    {answer && !data.canRunTasks && <output>{answer}</output>}
    <hr /><button disabled={busy} onClick={() => { if (window.confirm(t('Disconnect this account from this agent?'))) void act(async () => { await api.revoke(space, connection.id, connection.revision); await refresh(); }); }}>{t("Disconnect this account")}</button>
  </div>;
}
