'use client';

import { useState } from 'react';
import { agentCopy } from '../../../_lib/agents-copy';
import type { AgentView } from '../../../_lib/client';
import { LookEditor } from '../../look/LookEditor';
import { PhotoPicker } from '../../look/PhotoPicker';
import { useNav } from '../../StudioApp';
import { Seg, Sheet } from '../../ui';

export type LookSheetTab = 'character' | 'photo';

/**
 * Look and Telegram photo for a live agent (also after the lock, PLAN D9), as
 * a sheet over the profile. Edits save as you go without a Telegram push;
 * closing the sheet (Done, back or a swipe) pushes once (PLAN D5).
 * `autoGenerate` starts drawing portraits as it opens on the photo tab.
 */
export function LookSheet({ agent, open, onClose, onUpdate, autoGenerate, tab = 'character' }: {
  agent: AgentView; open: boolean; onClose: () => void; onUpdate: (a: AgentView) => void; autoGenerate?: boolean; tab?: LookSheetTab;
}) {
  const c = agentCopy[useNav().locale ?? 'en'];
  return (
    <Sheet open={open} onClose={onClose} label={c.look(agent.persona.name)}
      dock={<button type="button" className="vx-btn vx-btn-primary vx-btn-block" onClick={onClose}>{c.done}</button>}>
      <Body agent={agent} onUpdate={onUpdate} autoGenerate={autoGenerate} initial={tab} />
    </Sheet>
  );
}

/** Mounted per opening, so each opening starts on the tab it was asked for. */
function Body({ agent, onUpdate, autoGenerate, initial }: { agent: AgentView; onUpdate: (a: AgentView) => void; autoGenerate?: boolean; initial: LookSheetTab }) {
  const c = agentCopy[useNav().locale ?? 'en'];
  const [tab, setTab] = useState(initial);
  const name = agent.persona.name;
  return (
    <div className="vx-look-sheet">
      <div className="vx-look-mode">
        <Seg label={c.look(name)} value={tab} onChange={setTab}
          options={[{ value: 'character', label: c.character }, { value: 'photo', label: c.telegramPhoto }]} />
      </div>
      <div hidden={tab !== 'character'}>
        <LookEditor agent={agent} onUpdate={onUpdate} mode="live" title={c.look(name)} heading="h2" onPhoto={() => setTab('photo')} />
      </div>
      <div hidden={tab !== 'photo'}>
        <PhotoPicker agent={agent} onUpdate={onUpdate} autoGenerate={autoGenerate && initial === 'photo'} />
      </div>
    </div>
  );
}
