'use client';

import { useState } from 'react';
import { Banner, Icon, Row, Section, SkeletonRows } from '../ui';
import { ConnectionWorkflows } from './ConnectionWorkflows';
import { Enter, LetterTile, SettingsPage, SpaceBar, useFirstLoad } from './settings/kit';
import { Activity, AddServiceSheet, ErrorBanner, ReviewSheet, SetupSheet, lifecycleTone, useConnections, useSetup, type Review } from './settings/connections-kit';

/**
 * Connections (UI §4.13): one row per connected account, each pushing its detail page; actions waiting for your review;
 * scheduled checks; recent activity. Language and space are app-level (nav).
 */
export function ConnectionsScreen({ agentId }: { onBack?: () => void; agentId?: string }) {
  const x = useConnections();
  const { c, data } = x;
  const setup = useSetup(x);
  const [adding, setAdding] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const first = useFirstLoad(!!data);
  const visible = data?.connections.filter(connection => connection.lifecycle !== 'deleted') ?? [];
  const grantsFor = (id: string) => data?.grants.filter(g => g.connectionId === id && g.status !== 'revoked' && (!agentId || g.agentId === agentId)) ?? [];
  const sub = (id: string) => {
    const agents = new Set(grantsFor(id).map(g => g.agentId)).size;
    return agents ? (x.fa ? `${agents.toLocaleString('fa-IR')} عامل` : `${agents} agent${agents === 1 ? '' : 's'}`) : c.noAccess;
  };
  return <SettingsPage title={c.title} back={agentId ? c.back : undefined} busy={x.busy} className="vx-conn">
    <SpaceBar disabled={x.busy || setup.pending} label={c.title} />
    <ErrorBanner x={x} />
    {!data && !x.error && <SkeletonRows rows={3} lead="tile" label={c.loading} />}
    {data && <>
      {!data.enabled && <Banner tone="info">{c.unavailable}</Banner>}
      {setup.pending && !setup.open && <Banner tone="info" icon="plug" action={<button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" onClick={() => setup.setOpen(true)}>{c.finish}</button>}>{c.waiting}</Banner>}
      <Enter i={0} first={first}>
        <Section title={x.fa ? 'حساب‌های متصل' : 'Your connections'} foot={c.intro}>
          {!visible.length && <div className="vx-row"><span className="vx-row-sub">{c.empty}</span></div>}
          {visible.map(connection => {
            const tone = lifecycleTone(connection.lifecycle);
            const attention = connection.health !== 'healthy' && connection.health !== 'unknown';
            return <Row key={connection.id} size="l" chevron lead={<LetterTile text={connection.displayLabel} />} title={connection.displayLabel}
              sub={attention ? `${c.health}: ${connection.health.replace(/_/g, ' ')}` : sub(connection.id)} subTone={attention ? 'warn' : undefined}
              end={<span className={`vx-pill${tone ? ` ${tone}` : ''}`}>{c[connection.lifecycle]}</span>}
              onClick={() => x.nav.push({ name: 'settings', page: 'connection', params: { connectionId: connection.id, ...(agentId ? { agentId } : {}) } })} />;
          })}
          <Row plain lead={<span className="vx-tile icon vx-tile-add" aria-hidden="true"><Icon name="plus" size={20} /></span>} title={c.add}
            disabled={x.busy} onClick={() => setAdding(true)} />
        </Section>
      </Enter>
      <Enter i={1} first={first} className="vx-stack-s">
        <Activity x={x} agentId={agentId} onReview={setReview} />
      </Enter>
      <Enter i={2} first={first}>
        <ConnectionWorkflows key={`${x.space}:${x.nav.locale}`} data={data} space={x.space} locale={x.nav.locale} agentId={agentId} />
      </Enter>
      <footer className="vx-you-foot">
        <p className="vx-footnote"><Icon name="lock" size={14} /> {c.audience}</p>
        {data.modelProcessor && <p className="vx-footnote">{c.processor} <bdi>{data.modelProcessor.provider} · {data.modelProcessor.model}</bdi>.</p>}
        {data.canRunTasks === false && <p className="vx-footnote">{c.processorPending}</p>}
      </footer>
    </>}
    <AddServiceSheet x={x} open={adding} onClose={() => setAdding(false)} onSetup={r => void setup.begin(r)} />
    <SetupSheet x={x} s={setup} />
    <ReviewSheet x={x} review={review} onClose={() => setReview(null)} />
  </SettingsPage>;
}
