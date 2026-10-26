'use client';

import { useEffect, useRef, useState } from 'react';
import type { RoundOutcome } from '@/lib/pet/play';
import type { PetHost } from '../host';
import { t } from '../strings';
import { roundId } from './starfall';

/** A round's pips (§4.2): one lights per question the pet answered, never a number; Zen has none. */
export const GUESS_PIPS = 10;
/** Device-local and content-free: a Guess was left mid-way on this device (the next tap resumes it, C11's in-app half). */
export const UNFINISHED = (agentId: string) => `vox.pet.guess.${agentId}`;
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
};
export const guessUnfinished = (agentId: string) => store.get(UNFINISHED(agentId)) === '1';

/**
 * Guess my word (design §4.2): the pet keeps a word; the person asks yes-or-no questions and guesses, in talk (chips or
 * the keyboard). Every turn is an ordinary talk turn, so it reaches the chat and memory like any other, and the card
 * says so. Pips light per answer, Zen has none and offers a hint instead of giving up. Done ends the round: one `play`
 * care action, the round reaction, and the outcome as a `gameRound` play op (`guess`; the words never leave talk). The
 * first round played to the end (not Zen, not given up, at least one answer heard) is the best one: the server adds the
 * `bestGuess` Life Book page and the pet says its line.
 */
export function Guess({ host, zen, resume, onDone }: { host: PetHost; zen: boolean; resume: boolean; onDone(best?: boolean): void }) {
  const [heard, setHeard] = useState(0);
  const [giving, setGiving] = useState(false);
  const gaveUp = useRef(false);
  const started = useRef(performance.now());
  const over = useRef(false);
  const lang = host.lang;
  const e = () => host.engine();

  const finish = () => {
    if (over.current) return;
    over.current = true;
    store.set(UNFINISHED(host.agentId), null);
    host.act('play');
    const best = !zen && !gaveUp.current && heard > 0 && !host.view()?.play?.games.guess?.best;
    const outcome: RoundOutcome = zen ? 'zen' : best ? 'best' : 'finished';
    const req = { op: 'gameRound' as const, game: 'guess' as const, outcome, round: roundId() };
    void host.play(req).then((ok) => { if (!ok) setTimeout(() => void host.play(req), 3000); });
    e()?.guessReact?.(best ? 'right' : 'reveal', { zen });
    e()?.roomReact?.('roundEnd', { won: best, zen });
    if (best) host.say(t('book.page.bestGuess', undefined, lang));
    host.emit({ type: 'round', ms: performance.now() - started.current, zen, game: 'guess' });
    onDone(best);
  };

  useEffect(() => {
    store.set(UNFINISHED(host.agentId), '1');
    // the answer to the opening line is the pet taking its word, not a question answered
    let skip = resume ? 0 : 1;
    const off = host.on((s) => {
      if (s.type !== 'reply' || over.current) return;
      if (skip > 0) { skip--; return; }
      setHeard((n) => n + 1);
      e()?.guessReact?.('heard', { zen });
    });
    e()?.guessReact?.('think', { zen });
    if (resume) host.say(t('play.guess.resume', undefined, lang));
    else void host.send?.(t('play.guess.start', undefined, lang)).then((ok) => { if (!ok && !over.current) { over.current = true; store.set(UNFINISHED(host.agentId), null); onDone(); } });
    return off;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const giveUp = async () => {
    if (giving) return;
    setGiving(true);
    gaveUp.current = true;
    await host.send?.(t('play.guess.giveUp', undefined, lang));
    finish();
  };
  const hint = () => { void host.send?.(t('play.guess.hint', undefined, lang)); };

  return (
    <div className="pet-guess" data-room="play">
      {!zen && (
        <div className="pet-pips" data-inline="" role="img" aria-label={t('play.starfall.pips', undefined, lang)}>
          {Array.from({ length: GUESS_PIPS }, (_, i) => <i key={i} data-on={i < heard ? '' : undefined} />)}
        </div>
      )}
      <div className="pet-verbs">
        <button type="button" className="pet-link" onClick={() => host.focusTalk()}>{t('play.guess.ask', undefined, lang)}</button>
        {zen
          ? <button type="button" className="pet-link" onClick={hint}>{t('play.guess.hint', undefined, lang)}</button>
          : <button type="button" className="pet-link" disabled={giving} onClick={() => void giveUp()}>{t('play.guess.giveUp', undefined, lang)}</button>}
        <button type="button" className="pet-link" onClick={finish}>{t('play.done', undefined, lang)}</button>
      </div>
      <small className="pet-guess-note">{t('play.guess.note', undefined, lang)}</small>
    </div>
  );
}
