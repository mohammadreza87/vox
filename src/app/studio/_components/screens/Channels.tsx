'use client';

import { useCallback, useEffect, useState } from 'react';
import { channelsCopy } from '../../_lib/agents-copy';
import { api, haptic, openTelegram, type AgentView, type ChannelDraftView, type ChannelsView } from '../../_lib/client';
import { Cloud, PALETTE } from '../Cloud';
import { errorMessage, useNav } from '../StudioApp';
import { Banner, ErrorState, hueVars, Icon, Row, Section, Seg, SkeletonRows, Spinner, Switch, TopBar } from '../ui';

const tile = <span className="vx-tile icon" aria-hidden="true"><Icon name="telegram" size={20} /></span>;

/**
 * Agent > Channels (Circles S5, post-only). The agent's channels and their comments-group offer, Add to a channel
 * for people who can manage it, and the post flow: a brief, the agent's draft (persona only, nothing stored), the
 * host's preview with Post / Edit / Cancel and a notify switch. Nothing goes to the channel before Post.
 */
export function ChannelsScreen({ id }: { id: string }) {
  const nav = useNav();
  const locale = nav.locale ?? 'en';
  const c = channelsCopy[locale];
  const [agent, setAgent] = useState<AgentView | null>(() => nav.cache?.get(id) ?? null);
  const [info, setInfo] = useState<ChannelsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [brief, setBrief] = useState('');
  const [draft, setDraft] = useState<ChannelDraftView | null>(null);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [chatId, setChatId] = useState<number | null>(null);
  const [silent, setSilent] = useState(false);
  const [busy, setBusy] = useState<'write' | 'post' | null>(null);

  useEffect(() => {
    api.agent(id).then((r) => { nav.cache?.set(id, r.agent); setAgent(r.agent); })
      .catch((e) => { if (!nav.cache?.get(id)) { nav.toast(errorMessage(e), 'error'); nav.back(); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const load = useCallback(async () => {
    setLoadError(null);
    try { setInfo(await api.channels(id)); } catch (e) { setLoadError(errorMessage(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (!agent) return <><TopBar lead="back" onLead={nav.back} /><div className="vx-scroll"><SkeletonRows rows={3} lead="tile" label={c.loading} /></div></>;
  const name = agent.persona.name;
  const pal = PALETTE[agent.look.hue];
  const channels = info?.channels ?? [];
  const canPost = !!info?.public && channels.length > 0;

  const write = async () => {
    if (busy || !brief.trim()) return;
    setBusy('write');
    try {
      const r = await api.channelDraft(id, brief.trim());
      setDraft(r.draft); setText(r.draft.text); setChatId(r.draft.channels[0]?.chatId ?? null); setSilent(r.draft.silent); setEditing(false);
      haptic.success();
    } catch (e) { nav.toast(errorMessage(e), 'error'); } finally { setBusy(null); }
  };
  const post = async () => {
    if (busy || !draft || chatId === null || !text.trim()) return;
    setBusy('post');
    try {
      const r = await api.channelPost(id, { id: draft.id, chatId, text, silent });
      haptic.success();
      nav.toast(c.posted(r.title));
      setDraft(null); setBrief(''); setText(''); setEditing(false);
    } catch (e) {
      nav.toast(errorMessage(e), 'error');
      // 502: the draft is still there (Post again). 409/504: this preview can't post any more; the text becomes the brief to write it again from.
      const status = (e as { status?: unknown }).status;
      if (status === 409 || status === 504) { setDraft(null); setBrief(text.slice(0, 2000)); setText(''); setEditing(false); void load(); }
    } finally { setBusy(null); }
  };
  const cancel = () => {
    if (draft) void api.channelCancel(id, draft.id).catch(() => undefined);
    setDraft(null); setEditing(false); setText('');
  };

  return (
    <div className="vx-hue-scope" style={hueVars(pal)}>
      <TopBar lead="back" onLead={nav.back} leadLabel={name} />
      <div className="vx-scroll vx-stack">
        <div className="vx-subhead">
          <Cloud look={agent.look} size={64} stage={agent.stage} expr={busy ? 'listening' : 'idle'} label={name} />
          <div className="vx-subhead-text">
            <h1 className="vx-title">{c.title}</h1>
            <span className="vx-small vx-2">{c.sub}</span>
          </div>
        </div>

        {loadError && !info ? (
          <ErrorState title={c.loadError} reason={loadError} onRetry={() => void load()} />
        ) : !info ? (
          <SkeletonRows rows={3} lead="tile" label={c.loading} />
        ) : (
          <>
            <Section title={c.section}>
              {!channels.length && <div className="vx-row"><span className="vx-row-sub">{c.none(name)}</span></div>}
              {channels.map((ch) => (
                <div key={ch.chatId} className="vx-li">
                  <Row size="l" lead={tile} title={<span className="vx-ellipsis">{ch.title}</span>} sub={ch.posting === 'needs_rights' ? c.needsRights(name) : c.comments[ch.comments]} />
                  {ch.comments === 'offer' && info.groupLink && (
                    <Row plain lead={<span className="vx-tile icon" aria-hidden="true"><Icon name="groups" size={20} /></span>} title={c.addComments(name)}
                      sub={c.addCommentsSub} chevron onClick={() => { haptic.tap(); openTelegram(info.groupLink!); }} />
                  )}
                </div>
              ))}
              {info.full && <div className="vx-row"><span className="vx-row-sub">{c.full(name, channels.length)}</span></div>}
              {info.link && (
                <Row plain lead={<span className="vx-tile icon" aria-hidden="true"><Icon name="plus" size={20} /></span>} title={c.addChannel}
                  sub={c.addChannelSub} chevron onClick={() => { haptic.tap(); openTelegram(info.link!); }} />
              )}
            </Section>
            {!info.public && <Banner tone="info">{c.notPublic(name)}</Banner>}
            {canPost && !draft && (
              <label className="vx-field">
                <span className="vx-label">{c.brief}</span>
                <textarea className="vx-textarea" rows={4} maxLength={2000} value={brief} disabled={!!busy} dir="auto" onChange={(e) => setBrief(e.target.value)} />
                <span className="vx-small vx-2">{c.briefHint}</span>
              </label>
            )}
            {canPost && draft && (
              <Section title={c.preview} foot={c.meetNote(name)}>
                {editing
                  ? <label className="vx-field"><span className="vx-label">{c.edit}</span>
                    <textarea className="vx-textarea" rows={6} maxLength={3500} value={text} disabled={!!busy} dir="auto" onChange={(e) => setText(e.target.value)} /></label>
                  : <div className="vx-row"><span className="vx-doc-text" dir="auto">{text}</span></div>}
                {draft.channels.length > 1 && (
                  <div className="vx-row">
                    <Seg label={c.to} value={String(chatId)} disabled={!!busy} onChange={(v) => setChatId(Number(v))}
                      options={draft.channels.map((ch) => ({ value: String(ch.chatId), label: ch.title }))} />
                  </div>
                )}
                <Switch checked={!silent} onChange={(on) => setSilent(!on)} label={c.notify} sub={c.notifySub} disabled={!!busy} />
              </Section>
            )}
          </>
        )}
      </div>
      {canPost && (
        <div className="vx-dock stack">
          {draft ? (
            <>
              <div className="vx-dock-row">
                <button type="button" className="vx-btn vx-btn-secondary" disabled={!!busy} onClick={() => setEditing((e) => !e)}>{editing ? c.done : c.edit}</button>
                <button type="button" className="vx-btn vx-btn-secondary" disabled={!!busy} onClick={cancel}>{c.cancel}</button>
              </div>
              <button type="button" className="vx-btn vx-btn-primary vx-btn-block" disabled={!!busy || !text.trim() || chatId === null} onClick={() => void post()}>
                {busy === 'post' ? <><Spinner size={16} />{c.posting}</> : c.postNow}
              </button>
            </>
          ) : (
            <button type="button" className="vx-btn vx-btn-primary vx-btn-block" disabled={!!busy || !brief.trim()} onClick={() => void write()}>
              {busy === 'write' ? <><Spinner size={16} />{c.writing}</> : c.write}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
