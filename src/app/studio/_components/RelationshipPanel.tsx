'use client';

import { useEffect, useState } from 'react';
import { api, type RelationshipView } from '../_lib/client';
import { errorMessage } from './StudioApp';

export function RelationshipPanel({ agentId, name }: { agentId: string; name: string }) {
  const [value, setValue] = useState<RelationshipView | null>(null);
  const [zone, setZone] = useState('UTC');
  const [start, setStart] = useState('22:00');
  const [end, setEnd] = useState('08:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmForget, setConfirmForget] = useState(false);

  useEffect(() => {
    try { setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'); } catch { /* Keep a safe editable default. */ }
    api.relationship(agentId).then(({ relationship }) => {
      setValue(relationship);
      if (relationship.timeZone) setZone(relationship.timeZone);
      setStart(`${String(relationship.quietHours.start).padStart(2, '0')}:00`); setEnd(`${String(relationship.quietHours.end).padStart(2, '0')}:00`);
    }).catch(e => setError(errorMessage(e)));
  }, [agentId]);

  const update = async (input: Parameters<typeof api.updateRelationship>[1]) => {
    setBusy(true); setError('');
    try { setValue((await api.updateRelationship(agentId, input)).relationship); setConfirmForget(false); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const unavailable = !value?.available || value.mode === 'off';
  const paused = !!value?.pausedUntil && Date.parse(value.pausedUntil) > Date.now();
  return (
    <section className="vx-card" aria-labelledby="relationship-title" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h2 id="relationship-title" className="vx-title-m" style={{ margin: 0 }}>Staying in touch</h2>
        <p className="vx-small vx-2" style={{ margin: '5px 0 0' }}>Choose when {name} may follow up. You can change this any time.</p>
      </div>
      {!value && !error && <p className="vx-small vx-2" role="status">Loading your settings…</p>}
      {error && <div className="vx-banner danger" role="alert">{error}</div>}
      {value && !value.available && <p className="vx-small vx-2" style={{ margin: 0 }}>Follow-ups aren’t available for {name} right now.</p>}
      {value?.available && <>
        <p className="vx-small" style={{ margin: 0 }} role="status">
          {unavailable ? 'Follow-ups are turned off.' : paused ? `Follow-ups are paused until ${new Date(value.pausedUntil!).toLocaleString()}.` : value.disabled ? 'Follow-ups are stopped.' : !value.timeZone ? 'Save your time zone so check-ins arrive at a considerate time.' : value.mode === 'live' ? `${name} can follow up when there’s something useful to share.` : `${name} is quietly keeping track of open conversations.`}
        </p>
        <div className="vx-group" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
          <label className="vx-small">Your time zone
            <input aria-label="Your time zone" value={zone} disabled={unavailable || busy} onChange={e => setZone(e.target.value)} placeholder="Europe/Tallinn" style={fieldStyle} />
          </label>
          <div className="vx-small" style={{ gridColumn: '1 / -1' }}>Quiet hours</div>
          <label className="vx-small">From<input aria-label="Quiet hours start" type="time" step={3600} value={start} disabled={unavailable || busy} onChange={e => setStart(e.target.value)} style={fieldStyle} /></label>
          <label className="vx-small">Until<input aria-label="Quiet hours end" type="time" step={3600} value={end} disabled={unavailable || busy} onChange={e => setEnd(e.target.value)} style={fieldStyle} /></label>
        </div>
        <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={unavailable || busy || !zone.trim() || !/^([01]\d|2[0-3]):00$/.test(start) || !/^([01]\d|2[0-3]):00$/.test(end)} onClick={() => void update({ action: 'configure', timeZone: zone.trim(), quietHours: { start: Number(start.slice(0, 2)), end: Number(end.slice(0, 2)) } })}>Save quiet hours</button>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {value.disabled || paused
            ? <button className="vx-btn vx-btn-primary vx-btn-sm" disabled={unavailable || busy} onClick={() => void update({ action: 'resume' })}>Resume follow-ups</button>
            : <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={unavailable || busy} onClick={() => void update({ action: 'pause', until: new Date(Date.now() + 7 * 86_400_000).toISOString() })}>Pause for 7 days</button>}
          <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={unavailable || busy} onClick={() => void update({ action: 'stop' })}>Stop follow-ups</button>
        </div>
        <div className="vx-group" style={{ padding: 12 }}>
          <div className="vx-small" style={{ fontWeight: 600, marginBottom: 6 }}>What {name} has learned about how you like to communicate</div>
          {value.preferences.length ? <ul style={{ margin: 0, paddingLeft: 20 }}>{value.preferences.map((p, i) => <li key={`${p.key}-${i}`} className="vx-small">{p.value}</li>)}</ul> : <p className="vx-small vx-2" style={{ margin: 0 }}>No communication preferences saved yet.</p>}
        </div>
        <div>
          {!confirmForget ? <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={unavailable || busy} onClick={() => setConfirmForget(true)}>Reset working context</button> : <div role="group" aria-label="Reset working context confirmation" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span className="vx-small">Clear open conversation context and start fresh?</span>
            <button className="vx-btn vx-btn-danger vx-btn-sm" disabled={busy} onClick={() => void update({ action: 'forget' })}>Clear context</button>
            <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={busy} onClick={() => setConfirmForget(false)}>Keep it</button>
          </div>}
        </div>
      </>}
    </section>
  );
}

const fieldStyle: React.CSSProperties = { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, minHeight: 40, borderRadius: 10, border: '1px solid rgba(255,255,255,.12)', padding: '8px 10px', background: '#1E2228', color: 'inherit', font: 'inherit' };
