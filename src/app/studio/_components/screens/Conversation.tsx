'use client';
import { useEffect, useState } from 'react';
import { api, type AgentView } from '../../_lib/client';
import { ConversationPanel } from '../ConversationPanel';
import { LoadingFill, useNav } from '../StudioApp';
import { Icon, TopBar } from '../ui';
import { AgentFace } from '../Cloud';

export function ConversationScreen({ id }: { id: string }) {
  const nav = useNav();
  const [agent, setAgent] = useState<AgentView | null>(null);
  const [space, setSpace] = useState<'work' | 'personal'>('work');
  const [fa, setFa] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    api.agent(id).then(result => { if (active) setAgent(result.agent); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [id]);
  return <><TopBar onBack={nav.back} title={agent ? <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><AgentFace look={agent.look} size={28} label={agent.persona.name} />{agent.persona.name}</span> : (fa ? 'گفتگو' : 'Conversation')}
    right={<button className="vx-chip" onClick={() => setFa(value => !value)}>{fa ? 'English' : 'فارسی'}</button>} />
    {failed ? <div className="vx-scroll"><div className="vx-banner danger" role="alert">{fa ? 'عامل در دسترس نیست.' : 'This agent is unavailable.'}</div></div> : !agent ? <LoadingFill /> :
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} dir={fa ? 'rtl' : 'ltr'} lang={fa ? 'fa' : 'en'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px 8px' }}>
          <div className="vx-segmented compact" role="group" aria-label={fa ? 'فضای گفتگو' : 'Conversation space'} style={{ flex: 1 }}>
            {(['work', 'personal'] as const).map(value => <button key={value} aria-pressed={space === value}
              onClick={() => setSpace(value)}>{value === 'work' ? (fa ? 'کاری' : 'Work') : (fa ? 'شخصی' : 'Personal')}</button>)}
          </div>
          <button className="vx-icon-btn" style={{ width: 36, height: 36 }} aria-label={fa ? 'حریم خصوصی' : 'Privacy'} onClick={() => nav.push({ name: 'privacy' })}><Icon name="lock" size={18} /></button>
        </div>
        <ConversationPanel key={`${id}:${space}`} agentId={id} space={space} locale={fa ? 'fa' : 'en'} />
      </div>}
  </>;
}
