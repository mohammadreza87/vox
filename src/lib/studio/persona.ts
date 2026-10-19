/**
 * Persona design with Claude: turn an optional brief into a complete persona,
 * and refine it with plain-language instructions ("make her more playful").
 */

import { z } from 'zod';
import type { LLM, LLMMessage } from '../tireh/llm';
import type { AgentLook, CloudFamily, Hue, PersonaSpec, Presentation, SpawnBrief } from './types';
import { HUES } from './types';

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
});

const lookSchema = z.object({
  hue: z.enum(['apricot', 'rose', 'butter', 'matcha', 'lagoon', 'sky', 'lilac', 'ash']),
  family: z.enum(['puff', 'tower', 'drift']),
  features: z.object({ cheeks: z.boolean(), lashes: z.boolean(), brows: z.boolean() }),
});

const draftSchema = z.object({
  names: z.array(z.string().min(1).max(40)).min(1).max(3),
  persona: personaSchema,
  // Validated separately: a bad look falls back to randomLook instead of failing the draft.
  look: z.unknown().optional(),
});

export type PersonaDraft = { names: string[]; persona: PersonaSpec; look: AgentLook };

export class PersonaGenerationError extends Error {
  constructor(public readonly invalidFields: string[]) {
    super("Claude couldn't finish a valid profile after one correction. Your brief is kept; try drafting again.");
    this.name = 'PersonaGenerationError';
  }
}

const PERSONA_RULES = `Rules:
- Design one persona and write about them in the third person.
- Preserve the requested purpose: a broad-knowledge assistant or social companion must not be narrowed to a specialist company job.
- Culture and nationality shape their references, warmth and perspective. Be authentic and specific, never stereotyped or caricatured; no accents written into text.
- Personality must fit the role and the requested traits, and include at least one constructive edge (they push back when it matters).
- "wontDo" states honest limits (what they defer to humans or specialists).
- "voiceBrief" is a description for a voice designer: gender presentation, age range, timbre, pace, energy, and accent with the language it applies to. Max 2 sentences.
- "withStrangers" is how they treat people outside the company if they are made public, in their own character: what they happily talk about, what they keep private, and when they politely end a conversation (spam, abuse, endless requests). Max 2 sentences.
- "openness" (0-100) is how readily they engage strangers: guarded personalities are low, sociable ones high.
- "avatarHint" is one small respectful accessory or detail for a cute cloud mascot (e.g. "tiny headphones", "a small notebook"). Never national flags, religious symbols or costumes.
- "culture" and "accent" are short labels. Put cultural background in backstory and voice detail in voiceBrief. Aim comfortably below each field's character limit.
- Keep every field concise. Respond with JSON only.`;

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
  temperature: number;
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
      maxTokens: attempt === 0 ? 4096 : 8192,
      temperature: options.temperature,
    });
    try {
      return options.schema.parse(parseJsonObject(output));
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
  const t = brief.traits ?? {};
  const slider = (v: number | undefined, a: string, b: string) =>
    v === undefined ? null : v < 40 ? `leans ${a}` : v > 60 ? `leans ${b}` : `balanced ${a}/${b}`;
  const traits = [
    slider(t.warmDirect, 'warm', 'direct'),
    slider(t.playfulSerious, 'playful', 'serious'),
    slider(t.conciseExpansive, 'concise', 'expansive'),
  ].filter(Boolean);
  if (traits.length) lines.push(`Traits: ${traits.join('; ')}`);
  return lines.length ? lines.join('\n') : 'No preferences given. Surprise us with a useful teammate for a small game studio.';
}

export async function draftPersona(llm: LLM, brief: SpawnBrief, orgName: string): Promise<PersonaDraft> {
  const requiredLanguages = brief.languages ?? [];
  const schema = draftSchema.superRefine((draft, ctx) => {
    const generatedLanguages = new Set(draft.persona.languages.map((language) => language.trim().toLowerCase()));
    const missing = requiredLanguages.filter((language) => !generatedLanguages.has(language.trim().toLowerCase()));
    if (missing.length) ctx.addIssue({
      code: 'custom', path: ['persona', 'languages'], message: `Include all requested languages, using their requested names: ${missing.join(', ')}.`,
    });
  });
  const parsed = await generateValidated(llm, {
    schema,
    // A malformed look still gets a random fallback at validation time.
    promptSchema: draftSchema.extend({ look: lookSchema }),
    system: `You design AI personas for ${orgName}: a colleague, general assistant or companion as requested by the brief. Given a brief, propose a complete persona.
${PERSONA_RULES}
Include every requested language in persona.languages using the names given in the brief.
Also design their cloud mascot "look": pick a colour (hue) that suits their energy, a shape family ("puff": wide and round, "tower": tall with broad shoulders, "drift": asymmetric lens) and face features. Surprise us: vary looks between agents; presentation may inform but never dictate the shape.
Offer up to three names in names, with your pick first and matching persona.name.
Seed for variety (use it to vary colour and shape): ${Math.floor(Math.random() * 1e6)}`,
    user: briefToText(brief),
    temperature: 0.9,
  });
  const persona = parsed.persona as PersonaSpec;
  const look = lookSchema.safeParse(parsed.look);
  return { names: parsed.names, persona, look: look.success ? (look.data as AgentLook) : randomLook(persona.presentation) };
}

/** Validate a hand-edited persona (PATCH): same rules as Claude's output. */
export function validatePersona(input: unknown): { ok: true; persona: PersonaSpec } | { ok: false; error: string } {
  const result = personaSchema.strict().safeParse(input);
  if (result.success) return { ok: true, persona: result.data as PersonaSpec };
  const issue = result.error.issues[0];
  return { ok: false, error: `${issue?.path.join('.') || 'persona'}: ${issue?.message ?? 'invalid'}` };
}

export async function refinePersona(llm: LLM, persona: PersonaSpec, instruction: string): Promise<PersonaSpec> {
  return await generateValidated(llm, {
    schema: personaSchema,
    system: `You refine an AI persona. Apply the requested change and keep everything else as it is unless the change requires it. Preserve every current language unless the requested change explicitly changes the languages.
${PERSONA_RULES}
Return the full persona JSON object with the same fields.`,
    user: `Current persona:\n${JSON.stringify(persona)}\n\nChange requested: ${instruction}`,
    temperature: 0.6,
  }) as PersonaSpec;
}

/**
 * A random cloud look. Shape family leans on presentation (puff / tower /
 * drift), but one time in four it is shuffled so looks never become a rule;
 * colour and face features are random. `rand` is injectable for tests.
 */
export function randomLook(presentation: Presentation, rand: () => number = Math.random): AgentLook {
  const families: CloudFamily[] = ['puff', 'tower', 'drift'];
  const leaning: CloudFamily = presentation === 'feminine' ? 'puff' : presentation === 'masculine' ? 'tower' : 'drift';
  const family = rand() < 0.75 ? leaning : families[Math.floor(rand() * 3) % 3];
  const hue: Hue = HUES[Math.floor(rand() * HUES.length) % HUES.length];
  return {
    hue,
    family,
    features: {
      cheeks: family !== 'tower' ? rand() < 0.85 : rand() < 0.3,
      lashes: family === 'puff' ? rand() < 0.7 : rand() < 0.1,
      brows: family === 'tower' ? rand() < 0.8 : rand() < 0.15,
    },
  };
}

export function suggestUsername(name: string, org = 'hoor'): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'agent';
  return `${org}_${base}_bot`;
}

/** The persona as the runtime system prompt understands it */
export function personaToRuntime(p: PersonaSpec): { personality: string; communicationStyle: string; values: string[] } {
  const personality = [
    p.personality,
    p.backstory && `Background: ${p.backstory}`,
    p.culture && `Culture: ${p.culture}`,
    p.expertise.length ? `Expertise: ${p.expertise.join(', ')}` : '',
    p.wontDo && `Won't do: ${p.wontDo}`,
    p.languages.length ? `Speaks: ${p.languages.join(', ')}. Reply in the language the person uses.` : '',
  ].filter(Boolean).join('\n');
  return { personality, communicationStyle: p.communicationStyle, values: p.values };
}
