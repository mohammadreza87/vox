'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../_lib/client';
import { errorMessage } from './StudioApp';
import { Icon, Spinner } from './ui';

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
  const rows = (entries: Array<[string, number]>, names: Record<string, string>, other: string) => (
    <div className="vx-group">
      {entries.map(([key, count]) => <div key={key} className="vx-row" style={{ minHeight: 48 }}>
        <span className="vx-2" style={{ flex: 1 }}>{names[key] ?? other}</span>
        <span className="vx-num" style={{ fontWeight: 600 }}>{count}</span>
      </div>)}
    </div>
  );
  return <section className="vx-section" aria-labelledby="relationship-observation-title">
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <h2 id="relationship-observation-title" className="vx-over" style={{ margin: 0, flex: 1 }}>Conversation activity</h2>
      {value && <span className={`vx-pill ${value.mode === 'live' ? 'live' : value.mode === 'shadow' ? 'warn' : 'lock'}`}>{value.mode === 'live' ? 'Pilot active' : value.mode === 'shadow' ? 'Evaluation only' : 'Check-ins off'}</span>}
      <button className="vx-icon-btn" style={{ width: 32, height: 32 }} disabled={busy} onClick={() => void load()} aria-label="Refresh conversation activity">
        {busy ? <Spinner size={16} /> : <Icon name="refresh" size={18} />}
      </button>
    </div>
    {error && <div role="alert" className="vx-banner danger">{error}</div>}
    {!value && !error && <p role="status" className="vx-small vx-2" style={{ margin: 0 }}>Loading activity…</p>}
    {value && (!value.sampledEvents
      ? <div className="vx-group"><div className="vx-row"><span className="vx-2">No activity recorded yet.</span></div></div>
      : <>
        {rows(Object.entries(value.counts), labels, 'Other activity')}
        {!!Object.keys(value.feedbackOutcomes ?? {}).length && <>
          <p className="vx-small vx-2" style={{ margin: '4px 0 0' }}>Detected feedback on delivered check-ins. These classifications can be mistaken; a reply alone does not count as helpful.</p>
          {rows(Object.entries(value.feedbackOutcomes ?? {}), feedbackLabels, 'Other feedback')}
        </>}
        <p className="vx-small vx-3" style={{ margin: 0 }}>{value.sampledEvents} recent events{value.windowEnd ? ` · Latest ${new Date(value.windowEnd).toLocaleString()}` : ''}. Up to 500 events are shown; these are not all-time totals.</p>
      </>)}
    <p className="vx-small vx-3" style={{ margin: 0 }}>Operational counts only. Personal messages and memories stay private.</p>
  </section>;
}
