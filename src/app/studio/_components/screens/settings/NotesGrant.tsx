'use client';

import { haptic, type AgentView } from '../../../_lib/client';
import { AgentFace } from '../../Cloud';
import { Row } from '../../ui';

/**
 * One agent's "may use your private notes" switch (the per-agent grant, per space). Rendered in You › Agent
 * access for every agent, and on an agent's own Permissions page. The caller owns the write and its guard.
 */
export function NotesGrantRow({ agent, allowed, disabled, label, onToggle }: {
  agent: Pick<AgentView, 'look' | 'stage' | 'persona'>; allowed: boolean; disabled: boolean; label: string; onToggle: () => void;
}) {
  return <Row role="switch" aria-checked={allowed} aria-label={`${agent.persona.name}: ${label}`}
    lead={<AgentFace look={agent.look} stage={agent.stage} size={32} variant="disc" still label={agent.persona.name} />}
    title={agent.persona.name} sub={label} end={<span className="vx-switch" aria-hidden="true" />} disabled={disabled}
    onClick={() => { haptic.select(); onToggle(); }} />;
}
