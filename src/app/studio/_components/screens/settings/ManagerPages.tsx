'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type AgentView, type ConnectorUsage, type HistoryRow } from '../../../_lib/client';
import { connectorsCopy } from '../../../_lib/connectors-copy';
import { errorMessage, useNav } from '../../StudioApp';
import { ErrorState, Row, Section, SkeletonRows } from '../../ui';
import { LetterTile, SettingsPage, formatWhen } from './kit';

/** One read for a manager page; a failure offers a retry. */
function useRead<T>(read: () => Promise<T>) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    let active = true;
    setError(''); setValue(null);
    read().then((v) => { if (active) setValue(v); }).catch((e) => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(load, [load]);
  return { value, error, load };
}

/**
 * Connectors people use ("<Agent> for everyone", managers only): per app, how many people connected it to this
 * agent. The server returns counts and nothing else; no names, accounts, resources or times reach this page.
 */
export function ConnectorUsagePage({ agent }: { agent: AgentView }) {
  const nav = useNav();
  const k = connectorsCopy[nav.locale];
  const name = agent.persona.name;
  const { value, error, load } = useRead<ConnectorUsage>(() => api.connectorUsage(agent.id));
  return <SettingsPage title={k.usageTitle} back={name}>
    {error ? <ErrorState title={k.usageUnavailable} reason={error} retryLabel={nav.locale === 'fa' ? 'تلاش دوباره' : 'Try again'} onRetry={load} />
      : !value ? <SkeletonRows rows={3} lead="tile" label={k.usageTitle} />
        : <Section foot={k.usageFoot}>
          {value.unavailable && <div className="vx-row"><span className="vx-row-sub">{k.usageUnavailable}</span></div>}
          {value.chosenAudience && <div className="vx-row"><span className="vx-row-sub">{k.usageChosen(name)}</span></div>}
          {!value.unavailable && !value.chosenAudience && !value.providers.length && <div className="vx-row"><span className="vx-row-sub">{k.usageNone(name)}</span></div>}
          {value.providers.map((p) => {
            const label = p.id === 'remote_mcp' ? k.customMcp : p.name;
            return <Row key={p.id} plain lead={<LetterTile text={label} />} title={label} value={k.people(p.people)} />;
          })}
        </Section>}
  </SettingsPage>;
}

/**
 * Change history ("<Agent> for everyone", managers only): what changed and when, with who as a role. The server
 * scrubs every row to a fixed vocabulary; free text and ids never reach this page.
 */
export function HistoryPage({ agent }: { agent: AgentView }) {
  const nav = useNav();
  const k = connectorsCopy[nav.locale];
  const fa = nav.locale === 'fa';
  const { value, error, load } = useRead<{ history: HistoryRow[] }>(() => api.agentHistory(agent.id));
  const who = (row: HistoryRow) => row.actor === 'agent' ? agent.persona.name : k.actor[row.actor];
  return <SettingsPage title={k.historyTitle} back={agent.persona.name}>
    {error ? <ErrorState title={k.historyTitle} reason={error} retryLabel={fa ? 'تلاش دوباره' : 'Try again'} onRetry={load} />
      : !value ? <SkeletonRows rows={4} lead={false} label={k.historyTitle} />
        : <Section foot={k.historyFoot}>
          {!value.history.length && <div className="vx-row"><span className="vx-row-sub">{k.historyEmpty}</span></div>}
          {value.history.map((row, i) => <Row key={`${row.at}:${i}`} plain title={k.action(row)}
            sub={`${who(row)} · ${formatWhen(Date.parse(row.at), fa, { dateStyle: 'medium', timeStyle: 'short' })}`} />)}
        </Section>}
  </SettingsPage>;
}
