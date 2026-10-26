'use client';

import { useState } from 'react';
import type { ConnectionProviderView } from '@/lib/connections/application';
import type { ConnectionView, GrantInput } from '@/lib/connections/contracts';
import type { AgentView } from '../../../_lib/client';
import { connectionsApi } from '../../../_lib/connections-client';
import { connectorsCopy } from '../../../_lib/connectors-copy';
import { haptic } from '../../../_lib/haptics';
import { Banner, Icon, Row, Section, SkeletonRows } from '../../ui';
import { Activity, ErrorBanner, GrantSheet, McpAddSheet, ReviewSheet, SetupSheet, TaskSheet, useConnections, useSetup, type Review } from './connections-kit';
import { LetterTile, SettingsPage, SpaceBar } from './kit';

const HOUR = 3_600_000;

/**
 * Connectors & plugins (Settings v2, "<Agent> and you"): this person's apps and MCP servers for one agent, in the
 * app-level space. Every provider in the catalog shows its true state for this person, agent and space: connected
 * (with its access time), ready to connect, waiting for sign-in, or what Vox still has to set up (named, never a
 * secret). Connect, allow, renew, ask and disconnect use the existing reviewed flows; nothing here widens access.
 */
export function ConnectorsPage({ agent }: { agent: AgentView }) {
  return <ScopedConnectors key={agent.id} agent={agent} />;
}

function ScopedConnectors({ agent }: { agent: AgentView }) {
  const x = useConnections(agent.id);
  const { data } = x;
  const k = connectorsCopy[x.nav.locale];
  const name = agent.persona.name;
  const setup = useSetup(x);
  const [review, setReview] = useState<Review | null>(null);
  const [grantFor, setGrantFor] = useState<ConnectionView | null>(null);
  const [askFor, setAskFor] = useState<ConnectionView | null>(null);
  const [mcp, setMcp] = useState<{ resume: ConnectionView | null } | null>(null);
  /** A Renew whose old access ended but whose new access wasn't saved: what to allow again, kept until it is. */
  const [renewRetry, setRenewRetry] = useState<{ connectionId: string; grant: Omit<GrantInput, 'space' | 'connectionId' | 'expectedRevision' | 'expiresAt'>; hours: number } | null>(null);
  const now = Date.now();
  const mine = data?.connections.filter((c) => c.agentId === agent.id && c.lifecycle !== 'deleted') ?? [];
  const typed = data?.providers.filter((p) => p.id !== 'remote_mcp') ?? [];
  const connection = (p: ConnectionProviderView) => mine.find((c) => c.id === p.state?.connectionId) ?? mine.find((c) => c.providerId === p.id && ['connected', 'pending'].includes(c.lifecycle));
  const connected = mine.filter((c) => c.lifecycle === 'connected' && !c.mcp);
  const servers = mine.filter((c) => c.mcp && ['connected', 'pending', 'paused'].includes(c.lifecycle));
  const grantOf = (c: ConnectionView) => data?.grants.find((g) => g.connectionId === c.id && g.agentId === agent.id && g.status === 'active');
  const providerName = (c: ConnectionView) => c.mcp ? c.displayLabel : data?.providers.find((p) => p.id === c.providerId)?.name ?? c.displayLabel;
  const needsText = (needs: readonly string[]) => needs.map((n) => k.needs[n as keyof typeof k.needs]).filter(Boolean).join(' ');
  /** What Vox must still set up before a connected app or server can be used (answers_off is the processor note below). */
  const blockedBy = (c: ConnectionView): string[] => (c.mcp ? (data?.mcp && !data.mcp.available ? data.mcp.needs : [])
    : data?.providers.find((p) => p.id === c.providerId)?.state?.needs ?? []).filter((n) => n !== 'answers_off');

  const connect = (p: ConnectionProviderView) => data && x.act(async (turn) => {
    const before = new Set(data.connections.map((c) => c.id));
    const result = await connectionsApi.enroll(x.space, p.id, p.name, agent.id);
    const created = result.connections.find((c) => !before.has(c.id));
    await x.reload();
    if (created && x.current(turn)) await setup.begin(await connectionsApi.setup(x.space, created.id));
  });
  /** Allow the remembered tools and resources again for the remembered length of time (Renew's second step, and its retry). */
  const allowAgain = async (connectionId: string, retry: NonNullable<typeof renewRetry>) => {
    // A grant-only revoke leaves the connection's revision as it was, so this render's revision still holds.
    const c = data!.connections.find((v) => v.id === connectionId)!;
    try {
      await connectionsApi.grant({ space: x.space, connectionId, expectedRevision: c.revision, ...retry.grant, expiresAt: Math.min(Date.now() + retry.hours * HOUR, data!.maxGrantExpiryAt) });
      setRenewRetry(null); haptic.success(); x.nav.snack({ message: x.c.saved, tone: 'success' });
    } catch (cause) { setRenewRetry(retry); throw cause; } finally { await x.reload().catch(() => undefined); }
  };
  /** Renew = stop the ended access, then allow the same tools and resources for the same length of time. */
  const renew = (c: ConnectionView) => {
    const old = grantOf(c);
    if (!old || !data) return;
    const retry = { connectionId: c.id, hours: old.expiresAt - old.createdAt > 1.5 * HOUR ? 8 : 1, grant: { agentId: agent.id, toolIds: old.toolIds, resourceIds: old.resourceIds,
      destinationIds: old.destinationIds, effects: old.effects, maxCalls: old.maxCalls, maxBytes: old.maxBytes } };
    return x.act(async () => {
      await connectionsApi.revoke(x.space, c.id, c.revision, old.id, old.revision);
      await allowAgain(c.id, retry);
    });
  };
  // Shown until access is back, by this retry or by Allow access; gone with the connection.
  const retryConnection = renewRetry && mine.find((c) => c.id === renewRetry.connectionId && c.lifecycle === 'connected');
  const showRetry = !!retryConnection && !grantOf(retryConnection);
  const details = (c: ConnectionView) => x.nav.push({ name: 'settings', page: 'connection', params: { connectionId: c.id, agentId: agent.id } });

  /** A connected app or server: its access time, and the one next step that fits (ask, allow, renew), or what Vox must set up first. */
  const connectedRow = (c: ConnectionView) => {
    const grant = grantOf(c);
    const live = !!grant && grant.expiresAt > now;
    const tone = live ? ' live' : grant ? ' warn' : '';
    const label = providerName(c);
    const blocked = blockedBy(c);
    const named = (verb: string) => `${verb}: ${label}`;
    return <div key={c.id} className="vx-row l top">
      <LetterTile text={label} />
      <span className="vx-row-main">
        <span className="vx-row-title">{label}</span>
        <span className="vx-row-sub">{blocked.length ? needsText(blocked) || k.askVox : c.mcp ? k.mcpSub : k.readOnly}</span>
        <span className="vx-pref-actions">
          {!blocked.length && live && data?.canRunTasks !== false && <button type="button" className="vx-btn vx-btn-tonal vx-btn-xs" disabled={x.busy} aria-label={named(k.ask(name))} onClick={() => setAskFor(c)}>{k.ask(name)}</button>}
          {!blocked.length && !grant && <button type="button" className="vx-btn vx-btn-tonal vx-btn-xs" disabled={x.busy} aria-label={named(k.allow)} onClick={() => setGrantFor(c)}>{k.allow}</button>}
          {!blocked.length && grant && !live && <button type="button" className="vx-btn vx-btn-tonal vx-btn-xs" disabled={x.busy} aria-label={named(k.renew)} onClick={() => void renew(c)}>{k.renew}</button>}
          <button type="button" className="vx-btn vx-btn-ghost vx-btn-xs" disabled={x.busy} aria-label={named(k.details)} onClick={() => details(c)}>{k.details}</button>
        </span>
      </span>
      <span className={`vx-pill${tone}`}>{live ? k.onFor(Math.max(1, Math.ceil((grant!.expiresAt - now) / HOUR))) : grant ? k.ended : k.noAccessYet}</span>
    </div>;
  };

  /** A catalog provider not connected here: Connect, Finish, or what is missing. */
  const addRow = (p: ConnectionProviderView) => {
    const state = p.state ?? { status: 'needs_vox' as const, how: 'vox_adds' as const, needs: [] };
    const pending = state.status === 'pending' ? connection(p) : undefined;
    const sub = state.status === 'needs_vox' || state.status === 'pending' && state.needs.length ? [k.how[state.how], needsText(state.needs) || k.askVox].join(' · ')
      : state.status === 'not_here' ? needsText(state.needs) : state.status === 'pending' ? k.waiting : k.how[state.how];
    const end = state.status === 'available' ? <button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" disabled={x.busy} onClick={() => void connect(p)} aria-label={`${k.connect}: ${p.name}`}>{k.connect}</button>
      : pending && !state.needs.length ? <button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" disabled={x.busy} onClick={() => void setup.start(pending)} aria-label={`${k.finish}: ${p.name}`}>{k.finish}</button>
        : <span className="vx-pill lock">{state.status === 'not_here' ? k.personalOnly : k.voxSets}</span>;
    return <Row key={p.id} plain size="l" lead={<LetterTile text={p.name} />} title={p.name} sub={sub} end={end} />;
  };

  return <SettingsPage title={k.title} back={name} busy={x.busy} className="vx-conn">
    <SpaceBar disabled={x.busy || setup.pending} label={k.title} />
    <ErrorBanner x={x} />
    {showRetry && <Banner tone="warn" action={<button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" disabled={x.busy}
      aria-label={`${k.renewRetry}: ${providerName(retryConnection)}`} onClick={() => void x.act(() => allowAgain(retryConnection.id, renewRetry))}>{k.renewRetry}</button>}>{k.renewFailed(providerName(retryConnection))}</Banner>}
    {!data && !x.error && <SkeletonRows rows={4} lead="tile" label={x.c.loading} />}
    {data && <>
      {!data.enabled && <Banner tone="info">{needsText(typed[0]?.state?.needs.filter((n) => n === 'connections_off' || n === 'service_off') ?? []) || x.c.unavailable}</Banner>}
      {setup.pending && !setup.open && <Banner tone="info" icon="plug" action={<button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" onClick={() => setup.setOpen(true)}>{x.c.finish}</button>}>{x.c.waiting}</Banner>}

      <Section title={k.connected}>
        {!connected.length && <div className="vx-row"><span className="vx-row-sub">{k.emptyConnected(name)}</span></div>}
        {connected.map(connectedRow)}
      </Section>

      <Section title={k.add}>
        {typed.filter((p) => p.state?.status !== 'connected').map(addRow)}
      </Section>

      <Section title={k.plugins} foot={data.mcp && !data.mcp.available ? needsText(data.mcp.needs.filter((n) => n !== 'answers_off')) : k.mcpHint(name)}>
        {!servers.length && <div className="vx-row"><span className="vx-row-sub">{k.emptyPlugins}</span></div>}
        {servers.map((c) => c.lifecycle === 'connected' ? connectedRow(c)
          : <Row key={c.id} plain size="l" lead={<LetterTile text={c.displayLabel} />} title={c.displayLabel} sub={k.waiting}
            end={<button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" disabled={x.busy || !data.mcp?.available} aria-label={`${k.finish}: ${c.displayLabel}`} onClick={() => setMcp({ resume: c })}>{k.finish}</button>} />)}
        {data.mcp?.available && <Row plain lead={<span className="vx-tile icon vx-tile-add" aria-hidden="true"><Icon name="plus" size={20} /></span>} title={k.addMcp}
          disabled={x.busy} onClick={() => setMcp({ resume: null })} />}
      </Section>

      <Activity x={x} agentId={agent.id} onReview={setReview} />

      <footer className="vx-you-foot">
        <p className="vx-footnote"><Icon name="lock" size={14} /> {k.foot(name)}</p>
        <p className="vx-footnote">{k.where(name)}</p>
        {data.modelProcessor && <p className="vx-footnote">{x.c.processor} <bdi>{data.modelProcessor.provider} · {data.modelProcessor.model}</bdi>.</p>}
        {data.canRunTasks === false && <p className="vx-footnote">{x.c.processorPending}</p>}
      </footer>
    </>}
    <SetupSheet x={x} s={setup} />
    <ReviewSheet x={x} review={review} onClose={() => setReview(null)} />
    {grantFor && <GrantSheet x={x} connection={grantFor} agentId={agent.id} open onClose={() => setGrantFor(null)} />}
    {askFor && <TaskSheet x={x} connection={askFor} agentIds={[agent.id]} open onClose={() => setAskFor(null)} />}
    <McpAddSheet x={x} agentId={agent.id} agentName={name} open={!!mcp} resume={mcp?.resume} onClose={() => setMcp(null)} />
  </SettingsPage>;
}
