'use client';

import { Fragment, type CSSProperties } from 'react';
import type { Hue } from '@/lib/studio/types';
import type { AgentView, PersonaSpec } from '../../../_lib/client';
import { AgentFace, PALETTE } from '../../Cloud';
import { packTitle, useCatalog } from './catalog';
import type { BriefCopy } from './copy';
import { textAttrs } from './routing';

/** "● UA Manager · Mobile company": the hue dot is the agent's colour; custom agents get a quiet dot and no pack. */
export function RoleLine({ t, persona, hue }: { t: BriefCopy; persona: PersonaSpec; hue: Hue }) {
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
export function VoiceExamples({ t, agent }: { t: BriefCopy; agent: AgentView }) {
  const examples = (agent.persona.voiceExamples ?? []).filter((e) => e && e.user?.trim() && e.reply?.trim()).slice(0, 3);
  if (!examples.length) return null;
  return (
    <section className="vx-section" aria-label={t.howTheyTalk}>
      <span className="vx-over">{t.howTheyTalk}</span>
      <div className="vx-card vx-samples">
        {examples.map((e, i) => (
          <Fragment key={i}>
            <div className="vx-bubble me" {...textAttrs(e.user)}><span className="vx-sr">{t.you}: </span>{e.user}</div>
            <div className="vx-said">
              <span className="vx-still vx-catalog-layout-69271fc9" aria-hidden="true" >
                <AgentFace look={agent.look} size={20} preferCloud label="" />
              </span>
              <div className="vx-bubble them" {...textAttrs(e.reply)}><span className="vx-sr">{agent.persona.name}: </span>{e.reply}</div>
            </div>
          </Fragment>
        ))}
      </div>
    </section>
  );
}
