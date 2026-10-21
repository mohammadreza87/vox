'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { api, haptic, mediaUrl, type AgentView, type LibraryVoice, type VoiceOptions } from '../../../_lib/client';
import { listItem, T } from '../../../_lib/motion';
import { spawnCopy } from '../../../_lib/spawn-copy';
import { ProgressPill } from '../../motion/ProgressPill';
import { errorMessage, useNav } from '../../StudioApp';
import { Banner, Choose, Icon, Option, Picker, Row, Seg, Sheet, SheetHead, SkeletonRows, Spinner } from '../../ui';
import { Bars, Chips, Dock, languageCode, sampleLine, usePlayer, type StepProps } from './shared';

/** Language shortcuts and gender filters: codes go to the server, labels come from spawnCopy. */
const VOICE_LANGUAGE_CODES = ['en', 'fa', 'vi'] as const;
const GENDERS = ['female', 'male', 'neutral'] as const;
type Tab = 'default' | 'design' | 'library';

/** Play/pause disc: hue on option cards, s3 on library rows (board spawn-3). */
function Play({ playing, onPlay, label, disabled, quiet }: { playing: boolean; onPlay: () => void; label: string; disabled?: boolean; quiet?: boolean }) {
  return (
    <button type="button" className={`vx-option-play${quiet ? ' s3' : ''}`} aria-label={label} aria-pressed={playing} disabled={disabled} onClick={onPlay}>
      <Icon name={playing ? 'pause' : 'play'} size={quiet ? 14 : 16} width={2.25} flip={false} />
    </button>
  );
}

/**
 * Voice (board spawn-3): Built-in · Design · Library as a segmented control, voices as option cards
 * with a hue play disc and a Choose → Chosen pill. Only the dock CTA is volt. Model and plan details
 * sit behind ⓘ.
 */
export function VoiceStep({ agent, busy, run, onUpdate, onNext }: StepProps) {
  const nav = useNav();
  const all = spawnCopy[nav.locale ?? 'en'];
  const c = all.voice;
  const VOICE_LANGUAGE_CHOICES = VOICE_LANGUAGE_CODES.map((code) => ({ code, label: c.languages[code] }));
  const p = agent.persona;
  // The design preview the creator picked here (the saved voice gets a new id, so the server can't say which)
  const [designed, setDesigned] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('default');
  const [brief, setBrief] = useState(p.voiceBrief);
  const initialLanguage = languageCode(p.languages[0]);
  const [query, setQuery] = useState({ gender: p.presentation === 'feminine' ? 'female' : p.presentation === 'masculine' ? 'male' : '', accent: '', language: initialLanguage, search: '' });
  const [results, setResults] = useState<LibraryVoice[] | null>(null);
  const [options, setOptions] = useState<VoiceOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [details, setDetails] = useState(false);
  const [languagePicker, setLanguagePicker] = useState(false);
  const libraryRequest = useRef(0);
  const player = usePlayer();
  const voicesOn = nav.me.features.voices;

  useEffect(() => {
    if (!voicesOn) return;
    let cancelled = false;
    setOptionsError(null);
    api.voiceOptions().then((r) => { if (!cancelled) setOptions(r); })
      .catch((e) => { if (!cancelled) setOptionsError(errorMessage(e)); });
    return () => { cancelled = true; };
  }, [voicesOn, optionsRetry]);

  const model = options?.models.find((m) => m.id === options.ttsModel);
  const languageNames = new Map<string, string>(VOICE_LANGUAGE_CODES.map((code) => [code, c.languageNames[code]]));
  for (const m of options?.models ?? []) for (const language of m.languages) {
    // the shortcut languages keep their own labels (Persian and Vietnamese in their script; all three in fa)
    if (!(VOICE_LANGUAGE_CODES as readonly string[]).includes(language.code) || (language.code === 'en' && nav.locale !== 'fa')) languageNames.set(language.code, language.name);
  }
  const languageLabel = (code: string) => VOICE_LANGUAGE_CHOICES.find((l) => l.code === code)?.label ?? languageNames.get(code) ?? code;

  const searchWith = async (filters: typeof query) => {
    const request = ++libraryRequest.current;
    const r = await run('search', () => api.searchVoices(filters));
    if (r && request === libraryRequest.current) setResults(r.voices);
  };
  const filter = (patch: Partial<typeof query>) => {
    const filters = { ...query, ...patch };
    setQuery(filters);
    if ('language' in patch) setResults(null);
    if (tab === 'library') void searchWith(filters);
  };
  const pickTab = (t: Tab) => { setTab(t); if (t === 'library' && !results) void searchWith(query); };

  const sample = async () => {
    const blob = await run('speak', () => api.speak(agent.id, sampleLine(p, query.language || initialLanguage)));
    if (blob) player.play('sample', URL.createObjectURL(blob));
  };

  // One busy flag per option, so only the tapped card spins; every choice waits for the server.
  const choose = async (key: string, fn: () => Promise<{ agent: AgentView }>, after?: () => void) => {
    const r = await run(`choose:${key}`, fn);
    if (r) { onUpdate(r.agent); haptic.success(); after?.(); }
  };
  const design = async () => {
    const r = await run('design', () => api.designVoices(agent.id, brief));
    if (r) { onUpdate(r.agent); haptic.success(); }
  };
  const voice = agent.voice;
  const previews = agent.voicePreviews ?? [];

  if (!voicesOn) {
    return (
      <>
        <div className="vx-scroll vx-form">
          <div className="vx-step-head"><h1 className="vx-title-l">{c.title(p.name)}</h1></div>
          <Banner tone="info">{c.off(p.name)}</Banner>
        </div>
        <Dock><button type="button" className="vx-btn vx-btn-primary vx-btn-block" onClick={onNext}>{c.nextLook}</button></Dock>
      </>
    );
  }

  return (
    <>
      <div className="vx-scroll vx-form">
        <div className="vx-step-head">
          <h1 className="vx-title-l">{c.title(p.name)}</h1>
          <p className="vx-2 vx-with-info">
            {c.same(nav.me.org)}
            <button type="button" className="vx-icon-btn vx-info-btn" aria-label={c.details} onClick={() => setDetails(true)}><Icon name="info" size={18} /></button>
          </p>
        </div>

        {/* The chosen voice shows in the list (UI §4.4, no "Current voice" card); the sample plays it in the picked language */}
        <div className="vx-voice-langs">
          <div className="vx-chip-wrap" role="group" aria-label={c.shortcuts}>
            {VOICE_LANGUAGE_CHOICES.map((l) => (
              <button key={l.code} type="button" className="vx-chip" aria-pressed={query.language === l.code} disabled={!!busy}
                onClick={() => { haptic.select(); filter({ language: l.code }); }}>{l.label}</button>
            ))}
          </div>
          {voice && (
            <button type="button" className="vx-chip vx-chip-sample" aria-pressed={player.playing === 'sample'} disabled={busy === 'speak'}
              aria-label={c.hearSample(languageLabel(query.language || initialLanguage || 'en'))} onClick={() => void sample()}>
              {busy === 'speak' ? <Spinner size={14} /> : <Icon name={player.playing === 'sample' ? 'pause' : 'play'} size={14} width={2.25} flip={false} />}{c.sample}
            </button>
          )}
        </div>

        <Seg label={c.source} value={tab} onChange={pickTab}
          options={[{ value: 'default', label: c.builtIn }, { value: 'design', label: c.design }, { value: 'library', label: c.library }]} />

        {optionsError && (
          <Banner tone="warn" action={<button type="button" className="vx-btn vx-btn-xs" onClick={() => setOptionsRetry((n) => n + 1)}>{c.retryOptions}</button>}>
            <span role="alert">{c.optionsError(optionsError)}</span>
          </Banner>
        )}

        {tab === 'default' ? (
          <div className="vx-options" role="tabpanel" aria-label={c.builtInVoices}>
            {!options && !optionsError && <SkeletonRows rows={3} label={c.loadingVoices} />}
            {options?.defaultVoices.length === 0 && <p className="vx-small vx-2">{c.noBuiltIn}</p>}
            {options?.defaultVoices.map((v, i) => {
              // AgentView carries only the voice's label and source; labels are `${name} · built-in` / `· voice library`
              const chosen = voice?.source === 'default' && (voice.choiceId ? voice.choiceId === v.voiceId : voice.label === `${v.name} · built-in`);
              const playing = player.playing === v.voiceId;
              return (
                <motion.div key={v.voiceId} {...listItem} transition={T.listItem(i)}>
                  <Option selected={chosen} title={v.name} sub={[v.gender, v.accent].filter(Boolean).join(' · ') || c.everyLanguage}
                    lead={<Play playing={playing} label={c.play(v.name)} disabled={!v.previewUrl} onPlay={() => v.previewUrl && player.play(v.voiceId, v.previewUrl)} />}
                    action={<Choose chosen={chosen} label={c.choose(v.name)} busy={busy === `choose:${v.voiceId}`} disabled={!!busy && !chosen}
                      onClick={() => { if (!chosen) void choose(v.voiceId, () => api.chooseDefaultVoice(agent.id, v.voiceId)); }} />}>
                    <Bars active={playing} />
                  </Option>
                </motion.div>
              );
            })}
          </div>
        ) : tab === 'design' ? (
          <div className="vx-options" role="tabpanel" aria-label={c.designVoice}>
            <label className="vx-panel vx-brief">
              <span className="vx-over">{c.briefOver}</span>
              <textarea className="vx-textarea bare" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={1000} dir="auto"
                aria-label={c.describe} placeholder={c.briefPlaceholder} />
            </label>
            {busy === 'design' ? (
              <ProgressPill active labels={c.designing} tau={3.5} slow={all.slow} />
            ) : previews.length === 0 ? (
              <button type="button" className="vx-btn vx-btn-secondary vx-btn-sm vx-self-start" disabled={!!busy || brief.trim().length < 20} onClick={() => void design()}>
                <Icon name="spark" size={18} />{c.designThree}
              </button>
            ) : null}
            {previews.map((v, i) => {
              const chosen = voice?.source === 'design' && (designed ?? voice.choiceId) === v.generatedVoiceId;
              const playing = player.playing === v.file;
              const letter = String.fromCharCode(65 + i);
              return (
                <motion.div key={v.generatedVoiceId} {...listItem} transition={T.listItem(i)}>
                  <Option selected={chosen} title={c.take(letter)}
                    lead={<Play playing={playing} label={c.playTake(letter)} onPlay={() => player.play(v.file, mediaUrl(v.file))} />}
                    action={<Choose chosen={chosen} label={c.chooseTake(letter)} busy={busy === `choose:${v.generatedVoiceId}`} disabled={!!busy && !chosen}
                      onClick={() => { if (!chosen) void choose(v.generatedVoiceId, () => api.chooseDesignedVoice(agent.id, v.generatedVoiceId), () => setDesigned(v.generatedVoiceId)); }} />}>
                    <Bars active={playing} count={14} />
                  </Option>
                </motion.div>
              );
            })}
            {previews.length > 0 && busy !== 'design' && (
              <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm vx-self-start" disabled={!!busy || brief.trim().length < 20} onClick={() => void design()}>{c.designMore}</button>
            )}
          </div>
        ) : (
          <div className="vx-options" role="tabpanel" aria-label={c.voiceLibrary}>
            <div className="vx-field" role="group" aria-label={c.gender}>
              <Chips options={GENDERS.map((g) => ({ value: g, label: c.genders[g] }))} value={query.gender ? [query.gender] : []} disabled={busy === 'search'} onChange={(v) => filter({ gender: v[0] ?? '' })} />
            </div>
            <div className="vx-group">
              <Row plain title={c.voiceLanguage} value={query.language ? languageLabel(query.language) : c.anyLanguage} chevron onClick={() => setLanguagePicker(true)} />
            </div>
            <form className="vx-composer" role="search" onSubmit={(e) => { e.preventDefault(); void searchWith(query); }}>
              <input value={query.search} onChange={(e) => setQuery({ ...query, search: e.target.value })} placeholder={c.searchPlaceholder} aria-label={c.searchVoices} dir="auto" />
              <button type="submit" className="vx-composer-send quiet" aria-label={c.search} disabled={busy === 'search'}>
                {busy === 'search' ? <Spinner size={16} /> : <Icon name="search" size={18} />}
              </button>
            </form>
            {options && !options.libraryAllowed && (
              <p className="vx-footnote">{c.libraryPlan} <button type="button" className="vx-link-btn" onClick={() => setDetails(true)}>{c.why}</button></p>
            )}
            {results === null && busy === 'search' && <SkeletonRows rows={3} label={c.searching} />}
            {results?.length === 0 && <p className="vx-small vx-2" role="status">{c.noMatch}</p>}
            {!!results?.length && (
              <div className="vx-group">
                {results.map((v) => {
                  const key = `${v.publicOwnerId}-${v.voiceId}`;
                  const chosen = voice?.source === 'library' && (voice.choiceId ? voice.choiceId === v.voiceId : voice.label === `${v.name} · voice library`);
                  const preview = v.verifiedLanguages?.find((l) => l.language === query.language && l.previewUrl)?.previewUrl ?? v.previewUrl;
                  return (
                    <Row key={key} align="top" lead={<Play quiet playing={player.playing === v.voiceId} label={c.play(v.name)} disabled={!preview} onPlay={() => preview && player.play(v.voiceId, preview)} />}
                      title={<span className="vx-ellipsis vx-line">{v.name}</span>}
                      sub={<>
                        <span className="vx-line">{[v.gender, v.age, v.accent, v.descriptive, v.category === 'generated' ? c.generated : ''].filter(Boolean).join(' · ')}</span>
                        {v.language && <span className="vx-line">{`${v.category === 'professional' ? c.nativeLanguage : c.language}${languageNames.get(v.language) ?? v.language}`}</span>}
                        {typeof v.rate === 'number' && v.rate > 1 && <span className="vx-line">{c.costs(v.rate)}</span>}
                      </>}
                      end={<Choose chosen={chosen} label={c.choose(v.name)} busy={busy === `choose:${key}`} disabled={(!!busy && !chosen) || !options?.libraryAllowed}
                        onClick={() => { if (!chosen) void choose(key, () => api.chooseLibraryVoice(agent.id, v)); }} />} />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      <Dock>
        <button type="button" className="vx-btn vx-btn-primary vx-btn-block" onClick={onNext} disabled={!!busy}>{voice ? c.use : c.skip}</button>
      </Dock>

      <Picker open={languagePicker} onClose={() => setLanguagePicker(false)} title={c.voiceLanguage} search
        value={query.language} onChange={(language) => filter({ language })}
        options={[{ value: '', label: c.anyLanguage }, ...[...languageNames].sort((a, b) => a[1].localeCompare(b[1], nav.locale === 'fa' ? 'fa' : undefined)).map(([value, label]) => ({ value, label }))]} />

      <Sheet open={details} onClose={() => setDetails(false)} label={c.details}>
        <SheetHead title={c.details} sub={options ? c.usesModel(model?.name ?? options.ttsModel) : undefined} />
        <div className="vx-sheet-groups">
          {options && (
            <section className="vx-section">
              <h3 className="vx-over vx-section-head">{c.speechModels}</h3>
              <div className="vx-group">
                {options.models.map((m) => (
                  <Row key={m.id} plain title={m.name}
                    sub={[m.kind === 'realtime' ? c.realtime : m.kind === 'quality' ? c.quality : c.earlier,
                      ...VOICE_LANGUAGE_CHOICES.filter((l) => m.languages.some((s) => s.code === l.code)).map((l) => c.supported(l.label))].join(' · ')}
                    value={m.id === options.ttsModel ? c.inUse : undefined} />
                ))}
              </div>
              {query.language && model?.languages.some((l) => l.code === query.language) && (
                <p className="vx-section-foot">{c.speaks(model.name, languageLabel(query.language))}</p>
              )}
            </section>
          )}
          {options && !options.libraryAllowed && (
            <Banner tone="info">
              {options.tier === 'free' ? c.freePlan : c.unchecked}
            </Banner>
          )}
        </div>
      </Sheet>
    </>
  );
}
