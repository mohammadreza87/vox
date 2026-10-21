'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, haptic, openTelegram, type AgentView } from '../../_lib/client';
import { AgentFace } from '../Cloud';
import { ConversationPanel } from '../ConversationPanel';
import { useNav } from '../StudioApp';
import { ErrorState, Icon, TopBar } from '../ui';

/** "Chat here": the in-app conversation. Locale and space are the app's; options sit behind ··· in the top bar. */
export function ConversationScreen({ id }: { id: string }) {
  const nav = useNav();
  const fa = nav.locale === 'fa';
  const t = (en: string, persian: string) => fa ? persian : en;
  const [agent, setAgent] = useState<AgentView | null>(() => nav.cache.get(id) ?? null);
  const [failed, setFailed] = useState(false);
  const [options, setOptions] = useState(false);
  const load = useCallback(() => {
    let active = true;
    setFailed(false);
    api.agent(id).then(result => { if (active) { setAgent(result.agent); nav.cache.set(id, result.agent); } }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(load, [load]);
  const spaceName = nav.space === 'work' ? t('Work', 'کاری') : t('Personal', 'شخصی');
  const bot = agent?.bot?.username;
  return <div className="vx-chat-screen" dir={nav.dir} lang={nav.locale}>
    <TopBar lead="back" onLead={nav.back}
      title={agent ? <span className="vx-chat-title"><AgentFace look={agent.look} stage={agent.stage} size={24} variant="disc" still label={agent.persona.name} />{agent.persona.name}</span> : t('Conversation', 'گفتگو')}
      subtitle={agent ? `${spaceName} · ${agent.persona.role}` : undefined}
      end={agent && <span className="vx-chat-actions">
        {bot && <button type="button" className="vx-icon-btn" aria-label={t('Open in Telegram', 'باز کردن در تلگرام')} onClick={() => { haptic.tap(); openTelegram(`https://t.me/${bot}`); }}>
          <Icon name="external" size={20} /></button>}
        <button type="button" className="vx-icon-btn" aria-label={t('Chat options', 'گزینه‌های گفتگو')} aria-haspopup="dialog" aria-expanded={options}
          onClick={() => { haptic.light(); setOptions(true); }}><Icon name="more" size={22} /></button>
      </span>} />
    {failed && !agent ? <ErrorState title={t('This agent is unavailable.', 'عامل در دسترس نیست.')} retryLabel={t('Try again', 'تلاش دوباره')} onRetry={load} />
      : !agent ? <div className="vx-chat-skel" role="status" aria-label={t('Loading', 'در حال دریافت')}>
        <span className="vx-skeleton" data-delay /><span className="vx-skeleton me" data-delay /><span className="vx-skeleton" data-delay />
      </div>
      : <ConversationPanel key={`${id}:${nav.space}`} agentId={id} space={nav.space} locale={nav.locale}
        agent={{ name: agent.persona.name, look: agent.look, stage: agent.stage }}
        optionsOpen={options} onOptionsClose={() => setOptions(false)} onSpaceChange={s => { setOptions(false); nav.setSpace(s); }} />}
  </div>;
}
