'use client';

import { useState } from 'react';
import { connectionsApi } from '../../../_lib/connections-client';
import { haptic } from '../../../_lib/haptics';
import { Banner, Empty, Icon, Row, Section, SkeletonRows, useConfirm } from '../../ui';
import { IconTile, LetterTile, SettingsPage } from './kit';
import { ErrorBanner, GrantSheet, SetupSheet, TaskSheet, lifecycleTone, useConnections, useSetup } from './connections-kit';

/**
 * One connected account (UI §4.13): who may use it and for what (each grant revocable with a confirmation),
 * ask an agent a question about it, and a separate danger group to disconnect.
 */
export function ConnectionDetailPage(props: { connectionId: string; agentId?: string }) {
  return <ScopedConnectionDetail key={`${props.connectionId}:${props.agentId ?? 'account'}`} {...props} />;
}
function ScopedConnectionDetail({ connectionId, agentId }: { connectionId: string; agentId?: string }) {
  const x = useConnections(agentId);
  const { c, data, fa } = x;
  const confirm = useConfirm();
  const setup = useSetup(x);
  const [sheet, setSheet] = useState<'grant' | 'task' | null>(null);
  const connection = data?.connections.find(item => item.id === connectionId && (!agentId || item.agentId === agentId)) ?? null;
  const provider = data?.providers.find(p => p.id === connection?.providerId);
  const grants = data?.grants.filter(g => g.connectionId === connectionId && g.status !== 'revoked' && (!agentId || g.agentId === agentId)) ?? [];
  const agentIds = [...new Set(grants.map(g => g.agentId))];
  const live = connection?.lifecycle === 'connected';
  const stop = async (grant: (typeof grants)[number]) => {
    if (!connection) return;
    const ok = await confirm({ title: fa ? `دسترسی ${x.agentName(grant.agentId)} متوقف شود؟` : `Stop ${x.agentName(grant.agentId)}’s access?`, body: c.stopped,
      confirmLabel: c.stop, cancelLabel: fa ? 'نگه داشتن' : 'Keep', tone: 'danger' });
    if (!ok) return;
    await x.act(async () => { await connectionsApi.revoke(x.space, connection.id, connection.revision, grant.id, grant.revision); await x.reload(); haptic.success(); x.nav.snack({ message: c.stopped, tone: 'info' }); });
  };
  const disconnect = async () => {
    if (!connection) return;
    const ok = await confirm({ title: fa ? `اتصال ${connection.displayLabel} قطع شود؟` : `Disconnect ${connection.displayLabel}?`,
      body: connection.agentId ? (fa ? 'دسترسی همین عامل به این اتصال متوقف می‌شود. پاک‌سازی سرویس ممکن است کمی طول بکشد.' : 'This agent loses access to this connection. Provider cleanup may take a little longer.') : fa ? 'دسترسی همهٔ عامل‌ها به این حساب متوقف می‌شود. پاک‌سازی سرویس ممکن است کمی طول بکشد.' : 'Every agent loses access to this account. Provider cleanup may take a little longer.',
      confirmLabel: c.disconnect, cancelLabel: fa ? 'نگه داشتن' : 'Keep', tone: 'danger' });
    if (!ok) return;
    const done = await x.act(async () => { await connectionsApi.revoke(x.space, connection.id, connection.revision); await x.reload(); });
    if (done) { haptic.success(); x.nav.snack({ message: c.stopped, tone: 'info' }); x.nav.back(); }
  };
  return <SettingsPage title={connection?.displayLabel ?? c.title} back={c.title} busy={x.busy} className="vx-conn">
    <ErrorBanner x={x} />
    {!data && !x.error && <SkeletonRows rows={3} lead="tile" label={c.loading} />}
    {data && !connection && <Empty title={fa ? 'این اتصال در این فضا نیست' : 'This connection isn’t in this space'}
      body={fa ? 'فضای دیگری را انتخاب کنید یا به فهرست اتصال‌ها برگردید.' : 'Switch space in You, or go back to your connections.'}
      action={<button type="button" className="vx-btn vx-btn-secondary vx-btn-sm" onClick={x.nav.back}>{c.back}</button>} />}
    {data && connection && <>
      <header className="vx-conn-head">
        <LetterTile text={connection.displayLabel} />
        <div className="vx-conn-head-main">
          <h1 className="vx-title-m">{connection.displayLabel}</h1>
          <span className="vx-row-sub">{provider?.name ?? connection.providerId}{connection.checkedAt ? ` · ${x.when(connection.checkedAt)}` : ''}</span>
          {connection.agentId && <span className="vx-row-sub">{c.agent}: {x.agentName(connection.agentId)}</span>}
        </div>
        <span className={`vx-pill${lifecycleTone(connection.lifecycle) ? ` ${lifecycleTone(connection.lifecycle)}` : ''}`}>{c[connection.lifecycle]}</span>
      </header>
      {connection.health !== 'healthy' && connection.health !== 'unknown' && <Banner tone="warn">{c.health}: <bdi>{connection.health.replace(/_/g, ' ')}</bdi></Banner>}
      {connection.lifecycle === 'pending' && <Section>
        <Row plain lead={<IconTile name="plug" tone="warn" />} title={connection.mcp ? (fa ? 'برای تکمیل اتصال، مینی‌اپ تلگرام همین عامل را باز کنید.' : 'Open this agent’s Telegram Mini App to finish setup.') : c.finish} sub={c.returnNote} chevron disabled={x.busy || !!connection.mcp} onClick={() => void setup.start(connection)} />
      </Section>}

      <Section title={c.grants} foot={live && !grants.length ? c.zero : undefined}>
        {!grants.length && <div className="vx-row"><span className="vx-row-sub">{c.noAccess}</span></div>}
        {grants.map(grant => <div key={grant.id} className="vx-row l">
          <LetterTile text={x.agentName(grant.agentId)} round />
          <span className="vx-row-main">
            <span className="vx-row-title">{x.agentName(grant.agentId)}</span>
            <span className="vx-row-sub">{grant.resourceIds.length.toLocaleString(fa ? 'fa-IR' : 'en-US')} {c.resources} · {grant.effects.map(e => c[e]).join(', ')}</span>
            <span className="vx-row-sub">{c.expiry} {x.when(grant.expiresAt)}</span>
          </span>
          <button type="button" className="vx-btn vx-btn-ghost vx-btn-xs vx-danger-text" disabled={x.busy} onClick={() => void stop(grant)}>{c.stop}</button>
        </div>)}
        {live && <Row plain lead={<span className="vx-tile icon vx-tile-add" aria-hidden="true"><Icon name="plus" size={20} /></span>} title={c.manage}
          disabled={x.busy || !data.agents.length} onClick={() => setSheet('grant')} />}
      </Section>

      {live && <Section title={x.fa ? 'کارها' : 'Tasks'} foot={data.canRunTasks === false ? c.processorPending : c.taskHint}>
        <Row plain lead={<IconTile name="chat" />} title={c.task} chevron disabled={x.busy || !grants.length || data.canRunTasks === false} onClick={() => setSheet('task')} />
      </Section>}

      {(!agentId || connection.agentId === agentId) && ['connected', 'pending', 'paused'].includes(connection.lifecycle) && <Section>
        <Row tone="danger" lead={<Icon name="close" size={20} />} title={c.disconnect} disabled={x.busy} onClick={() => void disconnect()} />
      </Section>}

      <GrantSheet x={x} connection={connection} agentId={agentId} open={sheet === 'grant'} onClose={() => setSheet(null)} />
      <TaskSheet x={x} connection={connection} agentIds={agentIds} open={sheet === 'task'} onClose={() => setSheet(null)} />
    </>}
    <SetupSheet x={x} s={setup} />
  </SettingsPage>;
}
