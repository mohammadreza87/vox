'use client';

import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, haptic, type AgentView } from '../../../_lib/client';
import { spawnCopy } from '../../../_lib/spawn-copy';
import { DUR, EASE, SPRING } from '../../../_lib/motion';
import { PALETTE } from '../../Cloud';
import { markFreshAgent } from '../../motion/useStageUp';
import { errorMessage, LoadingFill, useNav } from '../../StudioApp';
import { Banner, hueVars, Icon, Steps, TopBar, useConfirm } from '../../ui';
import { BriefStep } from './BriefStep';
import { CatalogContext, useCatalogLoader } from './catalog';
import { HireStep } from './HireStep';
import { LookStep } from './LookStep';
import { PersonaStep } from './PersonaStep';
import { type Busy } from './shared';
import { SayHiSheet } from './TestStep';
import { VoiceStep } from './VoiceStep';

/** Board order (D15). "Say hi" is a sheet reachable from Draft and Hire, not a step. */
export type SpawnStep = 'brief' | 'draft' | 'voice' | 'look' | 'hire';
const FLOW: readonly SpawnStep[] = ['brief', 'draft', 'voice', 'look', 'hire'];
/** Refining a live agent: the voice is fixed at hire and there is nothing to hire. */
const LIVE_FLOW: readonly SpawnStep[] = ['draft', 'look'];

interface StepCtx { d: number; rtl: boolean; reduced: boolean }
/** Shared-axis X with direction (motion §3.7): forward enters from the end, back from the start; RTL mirrors. */
const stepVariants: Variants = {
  enter: (c: StepCtx) => (c.reduced ? { opacity: 0 } : { opacity: 0, x: 24 * c.d * (c.rtl ? -1 : 1) }),
  center: (c: StepCtx) => ({
    opacity: 1, x: 0,
    transition: c.reduced ? { duration: 0.15 } : { x: SPRING.page, opacity: { duration: 0.21, ease: EASE.enter } },
  }),
  exit: (c: StepCtx) => (c.reduced
    ? { opacity: 0, transition: { duration: 0.1 } }
    : { opacity: 0, x: -24 * c.d * (c.rtl ? -1 : 1), transition: { duration: DUR.instant, ease: EASE.exit } }),
};

/**
 * One flow for new hires and refines. `refine` (the profile's Refine button) needs no branch of its
 * own: a live agent's status already selects LIVE_FLOW, so the prop is accepted for the route's shape.
 */
export function SpawnScreen({ draftId, successorOf }: { draftId?: string; successorOf?: string; refine?: boolean }) {
  const nav = useNav();
  const c = spawnCopy[nav.locale ?? 'en'];
  const confirm = useConfirm();
  // The role and skill library, fetched once per Spawn session (Brief routing, Draft skills, Say-hi starters).
  const catalog = useCatalogLoader();
  const [agent, setAgent] = useState<AgentView | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [step, setStep] = useState<SpawnStep | null>(draftId ? null : 'brief');
  const [busy, setBusy] = useState<Busy>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [sayHi, setSayHi] = useState(false);
  /** A draft just landed: the Brief step's forming creature poofs into its look before Draft opens */
  const [drafted, setDrafted] = useState(false);
  const briefDirty = useRef(false);
  /** The agent this session's Brief drafted: from then on there is a saved draft, not a brief, to lose */
  const draftedId = useRef<string | null>(null);
  /** The person left (Discard, or the screen went away) while a draft request was still out */
  const left = useRef(false);
  const dir = useRef(1);

  // Stable, so BriefStep's effect doesn't re-report a stale "dirty" after the draft landed (the text is still in its composer).
  const onBriefDirty = useCallback((d: boolean) => { briefDirty.current = d && !draftedId.current; }, []);
  useEffect(() => { left.current = false; return () => { left.current = true; }; }, []);

  useEffect(() => {
    if (!draftId) return;
    api.agent(draftId)
      .then((r) => { setAgent(r.agent); setStep(r.agent.status === 'awaiting_bot' ? 'hire' : 'draft'); })
      .catch((e) => { nav.toast(errorMessage(e), 'error'); nav.back(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  /** One owner per error: the banner under the top bar stays until the next attempt (interaction §2.1). */
  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setOperationError(null);
    setBusy(label);
    try {
      return await fn();
    } catch (e) {
      setOperationError(errorMessage(e));
      haptic.error();
      return undefined;
    } finally {
      setBusy(null);
    }
  };
  const update = (a: AgentView) => { nav.cache?.set(a.id, a); setAgent(a); };

  // Step 'hire' with an active agent is the "just hired" screen, not a refine.
  const live = agent?.status === 'active' && step !== 'hire';
  const flow = live ? LIVE_FLOW : FLOW;
  const index = step ? flow.indexOf(step) : -1;

  const go = (to: SpawnStep) => {
    dir.current = Math.sign(flow.indexOf(to) - index) || 1;
    setOperationError(null);
    setStep(to);
  };
  const next = () => {
    haptic.tap();
    if (index >= flow.length - 1) { nav.back(); return; }   // live refine: Look is the last step
    go(flow[index + 1]);
  };

  /**
   * Back leaves the wizard from its first reachable step and from Telegram's waiting/hired states.
   * Draft is first once an agent exists (a reopened draft, or one the Brief just made): stepping back
   * into an empty Brief would only draft a second agent and leave this one behind on Home.
   */
  const leaves = step === 'brief' || step === 'draft'
    || (step === 'hire' && (agent?.status === 'active' || (!!draftId && agent?.status === 'awaiting_bot')));
  const prev = async () => {
    // An open sheet takes Back first, as Telegram's Back does: it closes and the step (and brief) stay.
    if (nav.consumeBack()) return;
    if (step === 'hire' && agent?.status === 'active') {
      nav.cache?.set(agent.id, agent);
      nav.reset({ name: 'home' }, { name: 'agent', id: agent.id });
    } else if (leaves) {
      if (step === 'brief' && briefDirty.current) {
        if (!(await confirm({ title: c.discardBriefTitle, confirmLabel: c.discard, tone: 'danger', body: c.discardBriefBody }))) return;
        // "Won't be kept": a draft that landed while this dialog was open goes too.
        const landed = draftedId.current;
        if (landed) { nav.cache?.delete(landed); void api.deleteDraft(landed).catch(() => {}); }
      }
      // Leaving the Brief while a draft is still in flight: onDraft deletes it when it lands.
      if (step === 'brief') left.current = true;
      nav.back();
    } else if (index > 0) go(flow[index - 1]);
  };

  if (!step || (step !== 'brief' && !agent)) return <><TopBar lead="close" onLead={nav.back} /><LoadingFill /></>;

  const discard = agent && agent.status === 'draft' ? (
    <button type="button" className="vx-icon-btn" aria-label={c.discardDraft} onClick={async () => {
      const agreed = await confirm({
        title: c.discardTitle(agent.persona.name), confirmLabel: c.discardDraft, tone: 'danger',
        body: c.discardBody(agent.persona.name),
        look: agent.look, expr: 'sleeping',
      });
      if (!agreed) return;
      const ok = await run('discard', () => api.deleteDraft(agent.id));
      if (ok) nav.reset({ name: 'home' });
    }}><Icon name="trash" size={20} /></button>
  ) : undefined;

  const ctx: StepCtx = { d: dir.current, rtl: nav.dir === 'rtl', reduced: nav.tier === 'reduced' };

  return (
    <CatalogContext.Provider value={catalog}>
      <div className="vx-hue-scope" style={agent ? hueVars(PALETTE[agent.look.hue]) : undefined}>
        {/* Board spawn-2/3: a bare 44px chevron (aria "Back"), never a "‹ Back" label, so the dots stay the focus */}
        <TopBar lead={leaves ? 'close' : 'back'} onLead={() => void prev()}
          title={<Steps total={flow.length} current={Math.max(index, 0)} />} end={discard} />
        {/* The Brief step shows its own failure inline with Retry, above the dock: one alert, never two. */}
        {operationError && step !== 'brief' && <div className="vx-spawn-error"><Banner tone="danger">{operationError}</Banner></div>}
        <AnimatePresence mode="wait" initial={false} custom={ctx}>
          <motion.div key={step} className="vx-step" custom={ctx} variants={stepVariants} initial="enter" animate="center" exit="exit">
            {step === 'brief' && (
              <BriefStep busy={busy} successorOf={successorOf} error={operationError} onDirty={onBriefDirty} onDraft={async (brief) => {
                left.current = false;   // asking for a draft means the person is here, whatever an earlier Close did
                const r = await run('draft', () => api.draft(brief, successorOf));
                if (!r) return;
                // Discarded (or closed) while Claude was drafting: nothing is kept, so no orphan draft on Home.
                if (left.current) { void api.deleteDraft(r.agent.id).catch(() => {}); return; }
                draftedId.current = r.agent.id;
                haptic.success(); briefDirty.current = false; update(r.agent); setNames(r.names); setDrafted(true); markFreshAgent(r.agent.id);
              }} drafted={drafted ? agent?.look : null} onDrafted={() => { setDrafted(false); go('draft'); }} />
            )}
            {step === 'draft' && agent && <PersonaStep agent={agent} names={names} busy={busy} run={run} onUpdate={update} onNext={next} live={live} onSayHi={() => setSayHi(true)} />}
            {step === 'voice' && agent && <VoiceStep agent={agent} busy={busy} run={run} onUpdate={update} onNext={next} />}
            {step === 'look' && agent && <LookStep agent={agent} busy={busy} run={run} onUpdate={update} onNext={next} />}
            {step === 'hire' && agent && <HireStep agent={agent} busy={busy} run={run} onUpdate={update} onSayHi={() => setSayHi(true)} onEdit={go} />}
          </motion.div>
        </AnimatePresence>
        {agent && <SayHiSheet agent={agent} open={sayHi} onClose={() => setSayHi(false)} />}
      </div>
    </CatalogContext.Provider>
  );
}
