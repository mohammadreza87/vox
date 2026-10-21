'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../_lib/client';
import { errorMessage } from './StudioApp';
import { Banner, Icon, SkeletonRows, Spinner, Stat, Stats } from './ui';

const labels: Record<string, string> = {
  turn: 'Interactions observed', planned: 'Situations to revisit', decision: 'Decisions made', sent: 'Check-ins delivered',
  deferred: 'Waiting for a better time', closed: 'Topics closed', suppressed: 'Contact avoided', stale: 'Outdated actions avoided',
  assessment_failed: 'Context assessments unavailable', delivery_unknown: 'Delivery unconfirmed', duplicate: 'Duplicate events avoided',
  control: 'Preference changes', invalidated: 'Context cleared', feedback: 'Feedback observations',
};
const feedbackLabels: Record<string, string> = { helpful: 'Helpful check-ins', unwanted: 'Unwanted check-ins', correction: 'Corrections', neutral: 'Replies without explicit feedback' };

/** Bounded content-free operational view; no administrator conversation feed. */
export function RelationshipObservations() {
  const [value, setValue] = useState<Awaited<ReturnType<typeof api.relationshipObservations>> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setValue(await api.relationshipObservations()); setError(''); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000); return () => clearInterval(timer); }, [load]);
  const mode = value?.mode === 'live' ? ['Pilot active', 'live'] : value?.mode === 'shadow' ? ['Evaluation only', 'volt'] : ['Check-ins off', ''];
  const feedback = Object.entries(value?.feedbackOutcomes ?? {});
  return <section className="vx-section vx-obs" aria-labelledby="relationship-observation-title" aria-busy={busy}>
    <div className="vx-section-head">
      <h2 id="relationship-observation-title" className="vx-over">Conversation activity</h2>
      {value && <span className={`vx-pill${mode[1] ? ` ${mode[1]}` : ''}`}><span className="vx-pill-dot" aria-hidden="true" />{mode[0]}</span>}
      <button type="button" className="vx-icon-btn" disabled={busy} onClick={() => void load()} aria-label="Refresh conversation activity">{busy ? <Spinner /> : <Icon name="refresh" size={18} />}</button>
    </div>
    {error && <Banner tone="danger">{error}</Banner>}
    {!value && !error && <SkeletonRows rows={2} lead={false} label="Loading activity…" />}
    {value && (!value.sampledEvents
      ? <div className="vx-group"><div className="vx-row"><span className="vx-row-sub">No activity recorded yet.</span></div></div>
      : <>
        <Stats>{Object.entries(value.counts).map(([key, count]) => <Stat key={key} label={labels[key] ?? 'Other activity'} value={count.toLocaleString('en-US')} />)}</Stats>
        {!!feedback.length && <>
          <p className="vx-section-foot">Detected feedback on delivered check-ins. These classifications can be mistaken; a reply alone does not count as helpful.</p>
          <Stats>{feedback.map(([key, count]) => <Stat key={key} label={feedbackLabels[key] ?? 'Other feedback'} value={count.toLocaleString('en-US')} />)}</Stats>
        </>}
        <p className="vx-section-foot">{value.sampledEvents} recent events{value.windowEnd ? ` · Latest ${new Date(value.windowEnd).toLocaleString()}` : ''}. Up to 500 events are shown; these are not all-time totals.</p>
      </>)}
    <p className="vx-section-foot">Operational counts only. Personal messages and memories stay private.</p>
  </section>;
}
