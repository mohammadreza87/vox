'use client';

import { useEffect, useRef, useState } from 'react';
import { MAX_AGENT_SKILLS } from '@/lib/studio/skills/types';
import { agentCopy } from '../../../_lib/agents-copy';
import { api, haptic, type AgentView } from '../../../_lib/client';
import { firstName, settingsCopy } from '../../../_lib/settings-copy';
import { errorMessage, useNav } from '../../StudioApp';
import { Banner, Icon, Section, Spinner, Switch, TopBar } from '../../ui';
import { useAgentActions } from '../agent/useAgentActions';
import { CatalogContext, useCatalogLoader } from '../spawn/catalog';
import { briefCopy } from '../spawn/copy';
import { mergeSelection, onIds, type SkillToggle } from '../spawn/roles';
import { languageCode, sampleLine, usePlayer, type Busy, type Run } from '../spawn/shared';
import { SkillChips } from '../spawn/SkillChips';
import { SkillsSheet } from '../spawn/SkillsSheet';
import { VoiceStep } from '../spawn/VoiceStep';
import { SettingsPage } from './kit';

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Why voice and skills can or can't change right now (product rule: only the creator, only while the
 * agent forms; afterwards it is formed and only keeps learning from conversations).
 */
export function IdentityBanner({ agent }: { agent: AgentView }) {
  const s = settingsCopy[useNav().locale ?? 'en'];
  const name = agent.persona.name;
  if (agent.status === 'fired') return <Banner tone="info" icon="lock">{s.retired(name)}</Banner>;
  if (agent.canShapeIdentity) {
    return <Banner tone="info" icon="clock">{agent.formingDaysLeft ? s.forming(name, agent.formingDaysLeft) : s.formingDraft(name)}</Banner>;
  }
  if (agent.locked) return <Banner tone="info" icon="lock">{s.formed(name)}</Banner>;
  return <Banner tone="info" icon="lock">{s.onlyCreator(firstName(agent.creatorName), name)}</Banner>;
}

/** The voice as everyone hears it, with one spoken line (fetched once per voice, through the speak route). */
function CurrentVoice({ agent }: { agent: AgentView }) {
  const nav = useNav();
  const s = settingsCopy[nav.locale ?? 'en'];
  const p = agent.persona;
  const player = usePlayer();
  const sample = useRef<{ voice: string; url: string } | null>(null);
  const [sampling, setSampling] = useState(false);
  const voiceKey = `${agent.voice?.source ?? ''}:${agent.voice?.choiceId ?? agent.voice?.label ?? ''}`;
  const play = async () => {
    if (sample.current?.voice === voiceKey) { player.play('voice', sample.current.url); return; }
    setSampling(true);
    try {
      const blob = await api.speak(agent.id, sampleLine(p, languageCode(p.languages[0])));
      if (!blob) return;
      sample.current = { voice: voiceKey, url: URL.createObjectURL(blob) };
      player.play('voice', sample.current.url);
    } catch (e) { nav.toast(errorMessage(e), 'error'); } finally { setSampling(false); }
  };
  const playing = player.playing === 'voice';
  return (
    <section className="vx-panel" aria-label={s.soundsLike(p.name)}>
      <span className="vx-over" aria-hidden="true">{s.soundsLike(p.name)}</span>
      <div className="vx-panel-divide">
        {agent.voice ? (
          <button type="button" className="vx-voice-play" aria-label={playing ? s.pause(p.name) : s.play(p.name)}
            aria-busy={sampling || undefined} disabled={sampling} onClick={() => void play()}>
            {sampling ? <Spinner size={14} /> : <Icon name={playing ? 'pause' : 'play'} size={14} width={2.5} flip={false} />}
          </button>
        ) : <span className="vx-voice-play off" aria-hidden="true"><Icon name="chat" size={16} /></span>}
        <span className="vx-row-main">
          <span className="vx-voice-title">{agent.voice?.label ?? s.textOnly}</span>
          <span className="vx-small vx-2">{p.languages.join(' · ')}</span>
        </span>
      </div>
    </section>
  );
}

/**
 * Voice (Settings v2): the current voice with play; while the creator may shape it, the spawn VoiceStep in
 * edit mode (built-in voices, design from a description, the library) with one Save for everyone.
 * Otherwise read-only, saying why.
 */
export function VoicePage({ agent, onUpdate }: { agent: AgentView; onUpdate: (a: AgentView) => void }) {
  const nav = useNav();
  const s = settingsCopy[nav.locale ?? 'en'];
  const name = agent.persona.name;
  const [busy, setBusy] = useState<Busy>(null);
  const run: Run = async (label, fn) => {
    setBusy(label);
    try { return await fn(); } catch (e) { haptic.error(); nav.toast(errorMessage(e), 'error'); return undefined; } finally { setBusy(null); }
  };
  const head = <><IdentityBanner agent={agent} /><CurrentVoice agent={agent} /></>;
  if (!agent.canShapeIdentity) {
    return <SettingsPage title={s.voiceTitle} back={name}>
      {head}
      <p className="vx-footnote">{s.sameForEveryone(name)}</p>
    </SettingsPage>;
  }
  return <>
    <TopBar lead="back" onLead={nav.back} leadLabel={name} title={<span role="heading" aria-level={1}>{s.voiceTitle}</span>} />
    <VoiceStep agent={agent} busy={busy} run={run} onUpdate={onUpdate} onNext={nav.back}
      edit={{ head, saveLabel: s.saveVoice, savedLabel: s.voiceSaved, note: s.sameForEveryone(name) }} />
  </>;
}

/** Skills (Settings v2): the library skills, up to 8, the same for everyone; live web for managers. */
export function SkillsPage({ agent, onUpdate }: { agent: AgentView; onUpdate: (a: AgentView) => void }) {
  const catalog = useCatalogLoader();
  return <CatalogContext.Provider value={catalog}><SkillsBody agent={agent} onUpdate={onUpdate} /></CatalogContext.Provider>;
}

function SkillsBody({ agent, onUpdate }: { agent: AgentView; onUpdate: (a: AgentView) => void }) {
  const nav = useNav();
  const locale = nav.locale ?? 'en';
  const s = settingsCopy[locale], t = briefCopy[locale], c = agentCopy[locale];
  const p = agent.persona;
  const editable = agent.canShapeIdentity === true;
  const manager = agent.canManageSettings ?? (agent.canManageAccess && agent.status !== 'fired');
  const actions = useAgentActions(agent, onUpdate);
  const saved = p.skillIds ?? [];
  const savedKey = saved.join('|');
  const [items, setItems] = useState<SkillToggle[]>(() => saved.map((id) => ({ id, on: true })));
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ids = onIds(items);
  const dirty = !same(ids, saved);
  // The server copy changed (saved here or elsewhere): follow it unless there are unsaved toggles.
  useEffect(() => {
    if (!saving) setItems((cur) => (same(onIds(cur), saved) ? cur : saved.map((id) => ({ id, on: true }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const toggle = (id: string) => {
    const target = items.find((i) => i.id === id);
    if (!editable || !target || (!target.on && ids.length >= MAX_AGENT_SKILLS)) return;
    setItems(items.map((i) => (i.id === id ? { ...i, on: !i.on } : i)));
  };
  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const r = await api.updatePersona(agent.id, { skillIds: ids });
      onUpdate(r.agent);
      setItems((r.agent.persona.skillIds ?? []).map((id) => ({ id, on: true })));
      haptic.success();
      nav.snack({ message: s.skillsSaved, tone: 'success' });
    } catch (e) { haptic.error(); nav.toast(errorMessage(e), 'error'); } finally { setSaving(false); }
  };

  return <SettingsPage title={s.skillsTitle} back={p.name}
    dock={editable ? <>
      <button type="button" className="vx-btn vx-btn-primary vx-btn-block" disabled={!dirty || saving} aria-busy={saving || undefined} onClick={() => void save()}>{s.saveSkills}</button>
      <p className="vx-footnote">{s.skillsBody(p.name)}</p>
    </> : undefined}>
    <IdentityBanner agent={agent} />
    <Section title={s.skillsTitle} foot={editable ? undefined : s.skillsBody(p.name)} plain>
      {items.length || editable
        ? <SkillChips t={t} items={items} onToggle={toggle} readOnly={!editable} fa={locale === 'fa'} label={s.skillsTitle}
          onAdd={editable ? () => setOpen(true) : undefined} />
        : <p className="vx-small vx-2">{s.noSkillsYet(p.name)}</p>}
    </Section>
    {manager && <Section title={s.tools}>
      <Switch checked={agent.liveWeb} onChange={actions.toggleLiveWeb} disabled={actions.busy} label={c.liveWeb} sub={c.liveWebSub} />
    </Section>}
    {editable && <SkillsSheet t={t} open={open} onClose={() => setOpen(false)} roleId={p.roleId} fa={locale === 'fa'}
      selected={ids} onChange={(next) => setItems((cur) => mergeSelection(cur, next))} />}
  </SettingsPage>;
}
