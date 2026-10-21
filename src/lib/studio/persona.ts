/**
 * Persona design with Claude: turn an optional brief into a complete persona,
 * and refine it with plain-language instructions ("make her more playful").
 */

import { z } from 'zod';
import type { LLM, LLMMessage } from '../tireh/llm';
import { BANNED_PHRASES, squashPersian } from '../tireh/conversation/voice';
import type { Accessory, AgentLook, CloudFamily, CloudSpecies, HairStyle, HairTone, Hue, PersonaSpec, Presentation, SpawnBrief, VoiceExample } from './types';
import { HUES } from './types';
import { ACCENT_COLORS, ACCESSORIES, DEFAULT_ACCENT, FAMILY_IDS, HAIR_STYLES, HAIR_TONES, SPECIES, isCompatible, suggestAccessories } from './character/look';
import { MAX_AGENT_SKILLS, type AgentRole, type AgentSkill } from './skills/types';

/** One short exchange in the persona's own voice (a style example, never a memory). */
const voiceExampleSchema = z.object({
  user: z.string().max(200),
  reply: z.string().max(400),
});

/** What Claude writes (draft and refine). Library ids are never Claude's to choose. */
const personaSchema = z.object({
  name: z.string().min(1).max(40),
  role: z.string().min(1).max(60),
  tagline: z.string().max(140).default(''),
  backstory: z.string().max(700),
  personality: z.string().max(500),
  communicationStyle: z.string().max(400),
  values: z.array(z.string().max(120)).max(6).default([]),
  expertise: z.array(z.string().max(80)).max(10).default([]),
  wontDo: z.string().max(300).default(''),
  languages: z.array(z.string().max(40)).max(32).default(['English']),
  culture: z.string().max(200).default(''),
  presentation: z.enum(['feminine', 'masculine', 'neutral']).default('neutral'),
  age: z.string().max(20).default(''),
  accent: z.string().max(80).default(''),
  voiceBrief: z.string().max(400),
  avatarHint: z.string().max(160).default(''),
  withStrangers: z.string().max(400).default(''),
  openness: z.number().int().min(0).max(100).default(50),
  // Older drafts and hand-written fixtures have none of these: default, never fail.
  opinions: z.array(z.string().max(160)).max(4).default([]),
  signatureMoves: z.array(z.string().max(120)).max(4).default([]),
  petPeeves: z.array(z.string().max(120)).max(3).default([]),
  voiceExamples: z.array(voiceExampleSchema).max(3).default([]),
});

/** Claude's look: v2 fields are optional so a v1-shaped answer still parses (it renders as a plain cloud). */

/**
 * The schema Claude is shown: asks for the character fields outright. Parsing
 * stays lenient (personaSchema) so a missing list never costs a repair call.
 */
const promptPersonaSchema = personaSchema.extend({
  opinions: z.array(z.string().min(1).max(160)).min(2).max(4),
  signatureMoves: z.array(z.string().min(1).max(120)).min(2).max(4),
  petPeeves: z.array(z.string().min(1).max(120)).max(3),
  voiceExamples: z.array(z.object({ user: z.string().min(1).max(200), reply: z.string().min(1).max(400) })).min(2).max(3),
});

/** The full stored shape a creator may PATCH: Claude's fields plus the library ids. */
const storedPersonaSchema = personaSchema.extend({
  voiceExamples: z.array(voiceExampleSchema.strict()).max(3).default([]),
  roleId: z.string().min(1).max(64).optional(),
  skillIds: z.array(z.string().min(1).max(64)).max(MAX_AGENT_SKILLS).optional(),
}).strict();

const lookSchema = z.object({
  hue: z.enum(HUES),
  family: z.enum(FAMILY_IDS),
  features: z.object({ cheeks: z.boolean(), lashes: z.boolean(), brows: z.boolean() }),
  species: z.enum(SPECIES).optional(),
  hair: z.enum(HAIR_STYLES).optional(),
  hairTone: z.enum(HAIR_TONES).optional(),
  accessory: z.enum(ACCESSORIES).optional(),
  accent: z.enum(ACCENT_COLORS).optional(),
});
/** What Claude is asked for: the character parts are required (hair tone and accent stay optional). */
const promptLookSchema = lookSchema.extend({ species: z.enum(SPECIES), hair: z.enum(HAIR_STYLES), accessory: z.enum(ACCESSORIES) });

const draftSchema = z.object({
  names: z.array(z.string().min(1).max(40)).min(1).max(3),
  persona: personaSchema,
  // Validated separately: a bad look falls back to randomLook instead of failing the draft.
  look: z.unknown().optional(),
});

export type PersonaDraft = { names: string[]; persona: PersonaSpec; look: AgentLook };

/** The library role and skills an agent is built from (validated by the caller). */
export interface PersonaLibrary {
  role?: AgentRole;
  skills?: AgentSkill[];
}

export class PersonaGenerationError extends Error {
  constructor(public readonly invalidFields: string[]) {
    super("Claude couldn't finish a valid profile after one correction. Your brief is kept; try drafting again.");
    this.name = 'PersonaGenerationError';
  }
}

const PERSONA_RULES = `Rules:
- Design one persona. Write every field about them in the third person, except voiceExamples, which are in their own voice.
- Preserve the requested purpose: a broad-knowledge assistant or social companion must not be narrowed to a specialist company job.
- Make them a specific person, not a template. Every field needs at least one concrete detail a colleague would recognise: a habit, a place, a kind of project they shipped, something they would never say. If a sentence could describe any assistant, rewrite it.
- Do not use these words to describe them unless the same sentence shows the behaviour behind it: passionate, dedicated, empathetic, caring, friendly, approachable, warm, curious, detail-oriented, dynamic, innovative, driven, creative, hardworking, team player, go-to person, loves helping people. Write the behaviour instead: not "empathetic" but "asks how the launch went before asking for the numbers".
- "personality": two or three traits, each shown as something they do, plus one real, likeable flaw (for example impatient with vague plans, too fond of spreadsheets) and at least one constructive edge: they push back when it matters.
- "communicationStyle": observable habits only: usual reply length, how they open (straight in, no greeting ritual), how they disagree, how and how often they joke, words they avoid. Say how they sound in each language they speak; for Persian, say whether they default to شما or تو and how colloquial they are, and that they keep English work terms the way colleagues say them.
- "expertise": specific sub-skills, not job titles ("live-ops event calendars for casual games", not "project management").
- "opinions": two to four positions they actually hold about their field, each with a short reason, that a reasonable colleague could disagree with. No platitudes such as "communication is key".
- "signatureMoves": two to four things they reliably do in a conversation that make them useful (for example "gives the number before the caveat", "asks what the real deadline is before planning"). Habits, not catchphrases: never invent a phrase they repeat.
- "petPeeves": up to three small things that bother them at work, said with good humour.
- "values": trade-offs they make, not virtues ("a small release this week over a perfect one next month", not "excellence").
- "voiceExamples": three short Telegram exchanges that show how they sound. If they speak more than one language, write at least one exchange in each of the first two. Unless starter messages are given below, cover one ordinary request answered directly, one where they push back on a weak idea, and one casual or emotional moment. Each "user" line is a realistic message. Each "reply" is one to three sentences of plain chat: no greeting, sign-off, list, markdown or emoji, and none of "Great question", "I'd be happy to help", "As an AI", "Let me know if you need anything else", «خوشحال می‌شم کمک کنم», «امیدوارم مفید بوده باشه», «می‌باشد». Persian replies use natural colloquial written Persian (می‌خواید، نمی‌دونم), not literary forms. Every fact in a reply comes from the user line or from general knowledge of their field, never invented company details or claims to have looked at data.
- Culture and nationality shape their references, warmth and perspective. Be authentic and specific, never stereotyped or caricatured; no accents written into text.
- "backstory": two to four concrete facts that explain their expertise and opinions. Never "has always had a passion for".
- "tagline": what a colleague would say about them, under ten words, not a slogan.
- "wontDo" states honest limits (what they defer to humans or specialists).
- "voiceBrief" is a description for a voice designer: gender presentation, age range, timbre, pace, energy, and accent with the language it applies to. Max 2 sentences.
- "withStrangers" is how they treat people outside the company if they are made public, in their own character: what they happily talk about, what they keep private, and when they politely end a conversation (spam, abuse, endless requests). Max 2 sentences.
- "openness" (0-100) is how readily they engage strangers: guarded personalities are low, sociable ones high.
- "culture" and "accent" are short labels. Put cultural background in backstory and voice detail in voiceBrief. Aim comfortably below each field's character limit.
- When you choose names, fit their culture and age and avoid stock AI-assistant names (Nova, Aria, Sage, Echo, Luna) unless the brief asks for one.
- Keep every field concise. Respond with JSON only.`;

const LOOK_RULES = `Also design their mascot "look": a cute vinyl-toy cloud creature. Pick:
- hue: a colour that suits their energy.
- family: "puff" (wide and round), "tower" (a little taller, two shoulder puffs) or "drift" (asymmetric, the larger puff on the right).
- species: "cloud" (pure cloud) or a light animal hint that suits their personality: cat, dog, bunny, bear, owl or chick. Never derive it from culture or gender.
- hair: none, tuft, fringe, bun, curls, spiky or pony; optional hairTone: deep (a darker shade of the body), cream, cocoa, ink or a hue name.
- accessory: one small item hinting at their work. Role guide: support → headset; research, analyst, finance → specs or glasses; design, creative, marketing → beret, flower or star; engineering, ops → headphones, cap or beanie; sales, exec, host → bowtie; coach, wellbeing → flower or bow; anything else → none or bow.
- features: cheeks, lashes and brows (on/off). Presentation may inform but never dictates any part.
Combinations that never work: a beret, cap or beanie with tuft, bun or spiky hair; a chick with any hair (its crest is its hair); an owl with hair other than none or fringe; a bunny with a cap, a beanie or spiky hair; a drift dog with headphones or a headset.
Surprise us: vary looks between agents.`;

/** Drops the part that breaks a compatibility rule (an incompatible part is never worth failing a draft). */
function repairLook(look: AgentLook): AgentLook {
  let out = look;
  for (let i = 0; i < 3; i++) {
    const c = isCompatible(out);
    if (c.ok) return out;
    out = c.field === 'hair' ? { ...out, hair: 'none' } : { ...out, accessory: 'none', accent: DEFAULT_ACCENT.none };
  }
  return out;
}

/** Stock assistant lines that would teach the wrong voice if kept as an example. */
const CLICHES = [...BANNED_PHRASES.englishOpeners, ...BANNED_PHRASES.englishClosers];
const PERSIAN_CLICHES = [...BANNED_PHRASES.persian, 'می‌باشد'].map(squashPersian);
const MARKDOWN = /(^|\n)\s*([-*•]|\d+\.)\s|\*\*|(^|\n)\s*#|`/;

function isPlainVoice(reply: string): boolean {
  const lower = reply.toLowerCase();
  const squashed = squashPersian(reply);
  return !MARKDOWN.test(reply) && !CLICHES.some((c) => lower.includes(c)) && !PERSIAN_CLICHES.some((c) => squashed.includes(c));
}

const cleanList = (items: string[] | undefined) => (items ?? []).map((item) => item.trim()).filter(Boolean);

/**
 * Tidy Claude's character fields: blank items go, and an example written in
 * assistant clichés or markdown is dropped rather than taught to the agent.
 */
function tidyCharacter<T extends PersonaSpec>(persona: T): T {
  const voiceExamples: VoiceExample[] = (persona.voiceExamples ?? [])
    .map((e) => ({ user: e.user.trim(), reply: e.reply.trim() }))
    .filter((e) => e.user && e.reply && isPlainVoice(e.reply));
  return {
    ...persona,
    opinions: cleanList(persona.opinions),
    signatureMoves: cleanList(persona.signatureMoves),
    petPeeves: cleanList(persona.petPeeves),
    voiceExamples,
  };
}

function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new SyntaxError('Claude did not return JSON');
  return JSON.parse(body.slice(start, end + 1));
}

/** Correct invalid generated data once; provider/auth/network failures propagate unchanged. */
async function generateValidated<T>(llm: LLM, options: {
  schema: z.ZodType<T>;
  promptSchema?: z.ZodType;
  system: string;
  user: string;
  /** Ignored by Claude 5 models (llm.ts drops non-default sampling); kept for other providers. */
  temperature: number;
  /** Sees the raw JSON object that passed validation (before schema defaults fill gaps). */
  onRaw?: (raw: unknown) => void;
}): Promise<T> {
  const system = `${options.system}
JSON Schema for your response (obey every field type, string length, array count and numeric bound):
${JSON.stringify(z.toJSONSchema(options.promptSchema ?? options.schema))}`;
  const messages: LLMMessage[] = [{ role: 'user', content: options.user }];
  for (let attempt = 0; attempt < 2; attempt++) {
    // Keep this outside the validation catch: transport/provider errors must never trigger a repair.
    const output = await llm.complete({
      system,
      messages: [...messages],
      maxTokens: attempt === 0 ? 8192 : 12000,
      temperature: options.temperature,
      // Thinking shares max_tokens: medium keeps room for the whole JSON object.
      effort: 'medium',
    });
    try {
      const raw = parseJsonObject(output);
      const parsed = options.schema.parse(raw);
      options.onRaw?.(raw);
      return parsed;
    } catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof z.ZodError)) throw error;
      const issues = error instanceof z.ZodError
        ? error.issues.slice(0, 12).map((issue) => ({
          field: issue.path.join('.') || 'profile',
          message: issue.code === 'too_big' && issue.origin === 'string' && typeof issue.maximum === 'number'
            ? `${issue.message}. Rewrite this field to at most ${Math.floor(issue.maximum * 0.6)} characters, comfortably below the hard limit of ${issue.maximum}. Use a short label where appropriate.`
            : issue.message,
        }))
        : [{ field: 'JSON', message: 'Return one complete, valid JSON object without truncation.' }];
      if (attempt === 1) throw new PersonaGenerationError([...new Set(issues.map((issue) => issue.field))]);
      messages.push(
        { role: 'assistant', content: output.slice(0, 24_000) },
        { role: 'user', content: `Correct the previous answer to satisfy the JSON Schema. Return the complete corrected JSON object only; do not clip fields or drop requested languages to fit the limits. Preserve the requested purpose, identity, culture and presentation while expressing overlong fields more concisely.
Original request:
${options.user}
Validation issues:
${issues.map((issue) => `${issue.field}: ${issue.message}`).join('\n')}` },
      );
    }
  }
  throw new Error('Persona generation exhausted without a result');
}

type Traits = { warmDirect?: number; playfulSerious?: number; conciseExpansive?: number };

function traitsText(t: Traits): string {
  const slider = (v: number | undefined, a: string, b: string) =>
    v === undefined ? null : v < 40 ? `leans ${a}` : v > 60 ? `leans ${b}` : `balanced ${a}/${b}`;
  return [
    slider(t.warmDirect, 'warm', 'direct'),
    slider(t.playfulSerious, 'playful', 'serious'),
    slider(t.conciseExpansive, 'concise', 'expansive'),
  ].filter(Boolean).join('; ');
}

export function briefToText(brief: SpawnBrief): string {
  const lines: string[] = [];
  if (brief.description) lines.push(`Description: ${brief.description}`);
  if (brief.role) lines.push(`Role: ${brief.role}`);
  if (brief.domain) lines.push(`Domain of knowledge: ${brief.domain}`);
  if (brief.presentation) lines.push(`Presents as: ${brief.presentation}`);
  if (brief.age) lines.push(`Age: ${brief.age}`);
  if (brief.culture) lines.push(`Nationality / culture: ${brief.culture}`);
  if (brief.languages?.length) lines.push(`Languages: ${brief.languages.join(', ')}`);
  if (brief.accent) lines.push(`Accent: ${brief.accent}`);
  const traits = traitsText(brief.traits ?? {});
  if (traits) lines.push(`Traits: ${traits}`);
  return lines.length ? lines.join('\n') : 'No preferences given. Surprise us with a useful teammate for a small game studio.';
}

const sentence = (text: string) => (/[.!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/**
 * The library role and skills, as drafting context: the persona becomes a
 * specific person who practises this craft. Starters become the user lines of
 * the voice examples, so the creator sees the agent answer real requests.
 */
function libraryText(library: PersonaLibrary | undefined, { starters = true } = {}): string {
  const role = library?.role;
  const skills = (library?.skills ?? []).slice(0, MAX_AGENT_SKILLS);
  if (!role && !skills.length) return '';
  const lines = ['This persona practises a craft from the Vox role library. Make them a specific person who does this work, not a summary of it: ground "expertise" in the knowledge and skills below, write "opinions" in their own words and with their own reasons from the point of view, and let "wontDo" reflect the honest limits. Never copy these lines verbatim.'];
  if (role) {
    lines.push(
      `Role: ${role.title}. ${sentence(role.summary)} Use "${role.title}" as persona.role unless the brief names a different role.`,
      `Mission: ${sentence(role.mission)}`,
      `Knows deeply: ${role.knowledge.join('; ')}.`,
      `Point of view: ${role.pointOfView.map(sentence).join(' ')}`,
      `How this role sounds at its best: ${sentence(role.voice)}`,
      `Honest limits: ${sentence(role.boundaries)}`,
      `Default temperament (the brief's own traits win): ${traitsText(role.traits)}.`,
    );
  }
  if (skills.length) lines.push(`Skills they carry: ${skills.map((skill) => `${skill.title} (${skill.summary.replace(/[.]+$/, '')})`).join('; ')}.`);
  if (starters && role?.starters.length) lines.push(`Starter messages for voiceExamples: use these as the three "user" lines, in this order, and answer each in character, showing their edge in at least one reply. If they speak more than one language, translate one message into their second language so both appear.\n${role.starters.map((starter, i) => `${i + 1}. ${starter}`).join('\n')}`);
  return lines.join('\n');
}

const HUMOUR = ['dry humour', 'gentle humour', 'rare, deadpan humour', 'playful humour'];
const PACE = ['quick and decisive', 'deliberate and thorough', 'calm and unhurried', 'brisk and energetic'];

/**
 * Sampling temperature is ignored by Claude 5 models, so variety between
 * agents has to come from the prompt: a light temperament suggestion when the
 * creator set no traits and picked no role.
 */
function temperamentHint(brief: SpawnBrief, library: PersonaLibrary | undefined, rand: () => number = Math.random): string {
  if (library?.role || Object.values(brief.traits ?? {}).some((v) => v !== undefined)) return '';
  const pick = (list: string[]) => list[Math.floor(rand() * list.length) % list.length];
  return `Temperament suggestion for variety (drop it if it clashes with the brief): ${pick(HUMOUR)}, ${pick(PACE)}.`;
}

export async function draftPersona(llm: LLM, brief: SpawnBrief, orgName: string, library?: PersonaLibrary): Promise<PersonaDraft> {
  const requiredLanguages = brief.languages ?? [];
  const schema = draftSchema.superRefine((draft, ctx) => {
    const generatedLanguages = new Set(draft.persona.languages.map((language) => language.trim().toLowerCase()));
    const missing = requiredLanguages.filter((language) => !generatedLanguages.has(language.trim().toLowerCase()));
    if (missing.length) ctx.addIssue({
      code: 'custom', path: ['persona', 'languages'], message: `Include all requested languages, using their requested names: ${missing.join(', ')}.`,
    });
  });
  const context = [libraryText(library), temperamentHint(brief, library)].filter(Boolean).join('\n');
  const parsed = await generateValidated(llm, {
    schema,
    // A malformed look still gets a random fallback at validation time.
    promptSchema: draftSchema.extend({ persona: promptPersonaSchema, look: promptLookSchema }),
    system: `You design AI personas for ${orgName}: a colleague, general assistant or companion as requested by the brief. Given a brief, propose a complete persona.
${PERSONA_RULES}
Include every requested language in persona.languages using the names given in the brief.
${context ? `${context}\n` : ''}${LOOK_RULES}
Offer up to three names in names, with your pick first and matching persona.name.
Seed for variety (use it to vary colour and shape): ${Math.floor(Math.random() * 1e6)}`,
    user: briefToText(brief),
    temperature: 0.9,
  });
  const persona = tidyCharacter(parsed.persona as PersonaSpec);
  const look = lookSchema.safeParse(parsed.look);
  return { names: parsed.names, persona, look: look.success ? repairLook(look.data as AgentLook) : randomLook(persona.presentation, Math.random, persona.role) };
}

/** Validate a hand-edited persona (PATCH): Claude's limits plus the library ids; unknown keys are refused. */
export function validatePersona(input: unknown): { ok: true; persona: PersonaSpec } | { ok: false; error: string } {
  const result = storedPersonaSchema.safeParse(input);
  if (result.success) return { ok: true, persona: result.data as PersonaSpec };
  const issue = result.error.issues[0];
  return { ok: false, error: `${issue?.path.join('.') || 'persona'}: ${issue?.message ?? 'invalid'}` };
}

const CHARACTER_LISTS = ['opinions', 'signatureMoves', 'petPeeves', 'voiceExamples'] as const;

export async function refinePersona(llm: LLM, persona: PersonaSpec, instruction: string, library?: PersonaLibrary): Promise<PersonaSpec> {
  // Library ids are the service's to keep; Claude neither sees nor returns them.
  const { roleId, skillIds, ...editable } = persona;
  const context = libraryText(library, { starters: false });
  let returned: Record<string, unknown> = {};
  const refined = tidyCharacter(await generateValidated(llm, {
    schema: personaSchema,
    promptSchema: promptPersonaSchema,
    system: `You refine an AI persona. Apply the requested change and keep everything else as it is unless the change requires it. Preserve every current language unless the requested change explicitly changes the languages.
${PERSONA_RULES}
If the change affects how they sound, rewrite voiceExamples to match; otherwise keep them. If opinions, signatureMoves or voiceExamples are missing, write them in character.
${context ? `${context}\n` : ''}Return the full persona JSON object with the same fields.`,
    user: `Current persona:\n${JSON.stringify(editable)}\n\nChange requested: ${instruction}`,
    temperature: 0.6,
    onRaw: (raw) => { if (raw && typeof raw === 'object') returned = raw as Record<string, unknown>; },
  }) as PersonaSpec);
  // A list Claude left out parses as empty: keep what the agent already had. A list
  // it returned empty on purpose ("drop the pet peeves") is cleared.
  const kept: Partial<PersonaSpec> = {};
  for (const key of CHARACTER_LISTS) {
    if (!(key in returned) && persona[key]?.length) Object.assign(kept, { [key]: persona[key] });
  }
  return { ...refined, ...kept, ...(roleId !== undefined ? { roleId } : {}), ...(skillIds !== undefined ? { skillIds } : {}) };
}

/**
 * A random character look. Shape family leans on presentation (puff / tower /
 * drift), but one time in four it is shuffled so looks never become a rule;
 * colour, face, species and hair are random, and the accessory leans on the
 * role (character §6). Always compatible. `rand` is injectable for tests.
 */
export function randomLook(presentation: Presentation, rand: () => number = Math.random, role?: string): AgentLook {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length) % list.length];
  const families: CloudFamily[] = ['puff', 'tower', 'drift'];
  const leaning: CloudFamily = presentation === 'feminine' ? 'puff' : presentation === 'masculine' ? 'tower' : 'drift';
  const family = rand() < 0.75 ? leaning : families[Math.floor(rand() * 3) % 3];
  const hue: Hue = HUES[Math.floor(rand() * HUES.length) % HUES.length];
  const features = {
    cheeks: family !== 'tower' ? rand() < 0.85 : rand() < 0.3,
    lashes: family === 'puff' ? rand() < 0.7 : rand() < 0.1,
    brows: family === 'tower' ? rand() < 0.8 : rand() < 0.15,
  };
  const species: CloudSpecies = pick(SPECIES);
  const hair: HairStyle = rand() < 0.3 ? 'none' : pick(HAIR_STYLES.slice(1));
  // mostly the same-hue deep tone; never the body's own hue (it would vanish)
  const hairTone: HairTone = rand() < 0.55 ? 'deep' : pick((['cocoa', 'ink', 'cream', ...HUES] as HairTone[]).filter((t) => t !== hue));
  const suggested = role?.trim() ? suggestAccessories(role) : [];
  const accessory: Accessory = suggested.length && rand() < 0.7 ? pick(suggested) : pick(ACCESSORIES);
  return repairLook({ hue, family, features, species, hair, hairTone, accessory, accent: DEFAULT_ACCENT[accessory] });
}

export function suggestUsername(name: string, org = 'hoor'): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'agent';
  return `${org}_${base}_bot`;
}

export interface RuntimePersonaParts {
  /** Legacy folded summary (kept for callers and configs that read it). */
  personality: string;
  communicationStyle: string;
  values: string[];
  /** The full character, in second person, for the prompt's <character> block. */
  character: string;
  /** Style examples in their own voice (blank or empty ones removed). */
  voiceExamples: VoiceExample[];
}

/** The persona as the runtime system prompt understands it */
export function personaToRuntime(p: PersonaSpec): RuntimePersonaParts {
  const personality = [
    p.personality,
    p.backstory && `Background: ${p.backstory}`,
    p.culture && `Culture: ${p.culture}`,
    p.expertise.length ? `Expertise: ${p.expertise.join(', ')}` : '',
    p.wontDo && `Won't do: ${p.wontDo}`,
    p.languages.length ? `Speaks: ${p.languages.join(', ')}. Reply in the language the person uses.` : '',
  ].filter(Boolean).join('\n');
  const list = (items: string[] | undefined, separator: string) => cleanList(items).map((item) => item.replace(/[.;]+$/, '')).join(separator);
  const opinions = list(p.opinions, '. ');
  const moves = list(p.signatureMoves, '. ');
  const peeves = list(p.petPeeves, '. ');
  // The voice charter owns language and register; here only who they are.
  const character = [
    p.backstory && `Background: ${p.backstory}`,
    `Personality: ${p.personality}`,
    `How you talk: ${p.communicationStyle}`,
    p.expertise.length ? `Good at: ${p.expertise.join('; ')}` : '',
    opinions && `Views you hold: ${opinions}.`,
    moves && `What you reliably do: ${moves}.`,
    peeves && `Pet peeves: ${peeves}.`,
    p.values.length ? `Trade-offs you make: ${p.values.join('; ')}` : '',
    p.wontDo && `You leave to others: ${p.wontDo}`,
    p.tagline && `How people sum you up: ${p.tagline}`,
    `${p.culture ? `Culture: ${p.culture}. ` : ''}Languages: ${p.languages.join(', ') || 'English'}.`,
  ].filter(Boolean).join('\n');
  const voiceExamples = (p.voiceExamples ?? [])
    .map((e) => ({ user: e.user.trim(), reply: e.reply.trim() }))
    .filter((e) => e.user && e.reply);
  return { personality, communicationStyle: p.communicationStyle, values: p.values, character, voiceExamples };
}
