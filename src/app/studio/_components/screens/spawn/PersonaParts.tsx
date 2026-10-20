'use client';

import { useState, type CSSProperties } from 'react';
import type { AgentView, PersonaSpec } from '../../../_lib/client';
import { AgentFace, PALETTE } from '../../Cloud';
import { Icon, Spinner } from '../../ui';
import { packTitle, useCatalog } from './catalog';
import type { SpawnCopy } from './copy';
import { textAttrs } from './routing';

/** "● UA Manager · Mobile company": the hue dot is the agent's colour; custom agents get a quiet dot and no pack. */
export function RoleLine({ t, persona, hue }: { t: SpawnCopy; persona: PersonaSpec; hue: string }) {
  const catalog = useCatalog();
  const role = persona.roleId ? catalog.roles.get(persona.roleId) : undefined;
  const pack = role ? packTitle(catalog, role.pack, t.packFull[role.pack], false) : undefined;
  const dot = role ? PALETTE[hue]?.base : undefined;
  return (
    <div className="vx-role-line">
      <span className="vx-hue-dot" aria-hidden="true" style={dot ? ({ '--hue': dot } as CSSProperties) : undefined} />
      <span {...textAttrs(persona.role || role?.title)} className="vx-ellipsis">{persona.role || role?.title}{pack && <span className="vx-3"> · {pack}</span>}</span>
    </div>
  );
}

/** Two or three short exchanges in the agent's own voice. Hidden until the draft has them. */
export function VoiceExamples({ t, agent }: { t: SpawnCopy; agent: AgentView }) {
  const examples = (agent.persona.voiceExamples ?? []).filter((e) => e && e.user?.trim() && e.reply?.trim()).slice(0, 3);
  if (!examples.length) return null;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label={t.howTheyTalk}>
      <span className="vx-over">{t.howTheyTalk}</span>
      <div className="vx-card vx-samples">
        {examples.map((e, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <div className="vx-bubble me" {...textAttrs(e.user)}><span className="vx-sr">{t.you}: </span>{e.user}</div>
            <div className="vx-said">
              <span className="vx-still" aria-hidden="true" style={{ flexShrink: 0 }}>
                <AgentFace look={agent.look} size={20} preferCloud label="" />
              </span>
              <div className="vx-bubble them" {...textAttrs(e.reply)}><span className="vx-sr">{agent.persona.name}: </span>{e.reply}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The pinned "Ask Claude" pill. Resolves true when the refine landed. */
export function RefineComposer({ t, name, busy, onSubmit, onFocusChange }: {
  t: SpawnCopy; name: string; busy: boolean; onSubmit: (instruction: string) => Promise<boolean>; onFocusChange: (focused: boolean) => void;
}) {
  const [value, setValue] = useState('');
  const send = async () => {
    const instruction = value.trim();
    if (!instruction || busy) return;
    if (await onSubmit(instruction)) setValue('');
  };
  return (
    <form className="vx-refine" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <Icon name="spark" size={16} width={2} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
      <input value={value} {...textAttrs(value)} onChange={(e) => setValue(e.target.value)} maxLength={400} placeholder={t.refinePh}
        aria-label={t.refineLabel(name)} enterKeyHint="send"
        onFocus={() => onFocusChange(true)} onBlur={() => onFocusChange(false)} />
      <button type="submit" className="vx-send vx-hit-44" aria-label={t.refineSend} disabled={!value.trim() || busy}
        onMouseDown={(e) => e.preventDefault()}>
        {busy ? <Spinner size={16} /> : <Icon name="send" size={18} width={2.25} />}
      </button>
    </form>
  );
}
