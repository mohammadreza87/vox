'use client';
import { useEffect, useState } from 'react';
import { api, type AgentView } from '../../_lib/client';
import { ConversationPanel } from '../ConversationPanel';
import { LoadingFill, useNav } from '../StudioApp';
import { TopBar } from '../ui';

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
  return <><TopBar onBack={nav.back} title={agent?.persona.name ?? (fa ? 'گفتگو' : 'Conversation')}
    right={<button className="vx-chip" onClick={() => setFa(value => !value)}>{fa ? 'English' : 'فارسی'}</button>} />
    {failed ? <p role="alert">{fa ? 'عامل در دسترس نیست.' : 'This agent is unavailable.'}</p> : !agent ? <LoadingFill /> :
      <div className="vx-scroll vx-privacy" dir={fa ? 'rtl' : 'ltr'} lang={fa ? 'fa' : 'en'}>
        <div className="vx-privacy-spaces" role="group" aria-label={fa ? 'فضای گفتگو' : 'Conversation space'}>
          {(['work', 'personal'] as const).map(value => <button key={value} className="vx-btn vx-btn-secondary" aria-pressed={space === value}
            onClick={() => setSpace(value)}>{value === 'work' ? (fa ? 'کاری' : 'Work') : (fa ? 'شخصی' : 'Personal')}</button>)}
          <button className="vx-chip" onClick={() => nav.push({ name: 'privacy' })}>{fa ? 'حریم خصوصی' : 'Privacy'}</button>
        </div>
        <ConversationPanel key={`${id}:${space}`} agentId={id} space={space} locale={fa ? 'fa' : 'en'} />
      </div>}
  </>;
}
