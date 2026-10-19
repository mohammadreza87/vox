/**
 * Persona design with Claude: turn an optional brief into a complete persona,
 * and refine it with plain-language instructions ("make her more playful").
 */

import { z } from 'zod';
import type { LLM } from '../tireh/llm';
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
  languages: z.array(z.string().max(40)).max(6).default(['English']),
  culture: z.string().max(200).default(''),
  presentation: z.enum(['feminine', 'masculine', 'neutral']).default('neutral'),
  age: z.string().max(20).default(''),
  accent: z.string().max(80).default(''),
  voiceBrief: z.string().max(400),
  avatarHint: z.string().max(160).default(''),
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

const PERSONA_RULES = `Rules:
- The persona is ONE colleague shared by everyone at the company; write about them in the third person.
- Culture and nationality shape their references, warmth and perspective. Be authentic and specific, never stereotyped or caricatured; no accents written into text.
- Personality must fit the role and the requested traits, and include at least one constructive edge (they push back when it matters).
- "wontDo" states honest limits (what they defer to humans or specialists).
- "voiceBrief" is a description for a voice designer: gender presentation, age range, timbre, pace, energy, and accent with the language it applies to. Max 2 sentences.
- "avatarHint" is one small respectful accessory or detail for a cute cloud mascot (e.g. "tiny headphones", "a small notebook"). Never national flags, religious symbols or costumes.
- Keep every field concise. Respond with JSON only.`;

function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Claude did not return JSON');
  return JSON.parse(body.slice(start, end + 1));
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
  const output = await llm.complete({
    system: `You design AI colleagues for ${orgName}, a small company building games and AI products. Given a brief, propose a complete persona.
${PERSONA_RULES}
Also design their cloud mascot "look": pick a colour (hue) that suits their energy, a shape family ("puff": wide and round, "tower": tall with broad shoulders, "drift": asymmetric lens) and face features. Surprise us: vary looks between agents; presentation may inform but never dictate the shape.
Shape: {"names": [3 name options, the first is your pick], "persona": {"name", "role", "tagline", "backstory", "personality", "communicationStyle", "values": [], "expertise": [], "wontDo", "languages": [], "culture", "presentation": "feminine"|"masculine"|"neutral", "age", "accent", "voiceBrief", "avatarHint"}, "look": {"hue": "apricot"|"rose"|"butter"|"matcha"|"lagoon"|"sky"|"lilac"|"ash", "family": "puff"|"tower"|"drift", "features": {"cheeks": bool, "lashes": bool, "brows": bool}}}
Seed for variety (use it to vary colour and shape): ${Math.floor(Math.random() * 1e6)}`,
    messages: [{ role: 'user', content: briefToText(brief) }],
    maxTokens: 1500,
    temperature: 0.9,
  });
  const parsed = draftSchema.parse(parseJsonObject(output));
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
  const output = await llm.complete({
    system: `You refine an AI colleague's persona. Apply the requested change and keep everything else as it is unless the change requires it.
${PERSONA_RULES}
Return the full persona JSON object with the same fields.`,
    messages: [{ role: 'user', content: `Current persona:\n${JSON.stringify(persona)}\n\nChange requested: ${instruction}` }],
    maxTokens: 1500,
    temperature: 0.6,
  });
  return personaSchema.parse(parseJsonObject(output)) as PersonaSpec;
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
