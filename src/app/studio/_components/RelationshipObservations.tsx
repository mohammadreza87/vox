'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../_lib/client';
import { errorMessage } from './StudioApp';

const labels: Record<string, string> = {
  turn: 'Interactions observed', planned: 'Situations to revisit', decision: 'Decisions made', sent: 'Check-ins delivered',
  deferred: 'Waiting for a better time', closed: 'Topics closed', suppressed: 'Contact avoided', stale: 'Outdated actions avoided',
  assessment_failed: 'Context assessments unavailable', delivery_unknown: 'Delivery unconfirmed', duplicate: 'Duplicate events avoided',
  control: 'Preference changes', invalidated: 'Context cleared',
};

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
  return <section className="vx-card" aria-labelledby="relationship-observation-title" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
      <h2 id="relationship-observation-title" className="vx-title-m" style={{ margin: 0 }}>Conversation activity</h2>
      <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => void load()} aria-label="Refresh conversation activity">Refresh</button>
    </div>
    <p className="vx-small vx-2" style={{ margin: 0 }}>Operational counts only. Personal messages and memories stay private.</p>
    {error && <p role="alert" className="vx-small">{error}</p>}
    {!value && !error && <p role="status" className="vx-small">Loading activity…</p>}
    {value && <>
      <span className="vx-pill">{value.mode === 'live' ? 'Pilot active' : value.mode === 'shadow' ? 'Evaluation only' : 'Check-ins off'}</span>
      {!value.sampledEvents ? <p className="vx-small vx-2">No activity recorded yet.</p> : <>
        <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '8px 16px', margin: 0 }}>
          {Object.entries(value.counts).map(([key, count]) => <div key={key} style={{ display: 'contents' }}><dt className="vx-small vx-2">{labels[key] ?? 'Other activity'}</dt><dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>{count}</dd></div>)}
        </dl>
        <p className="vx-small vx-3" style={{ margin: 0 }}>{value.sampledEvents} recent events{value.windowEnd ? ` · Latest ${new Date(value.windowEnd).toLocaleString()}` : ''}. Up to 500 events are shown; these are not all-time totals.</p>
      </>}
    </>}
  </section>;
}
