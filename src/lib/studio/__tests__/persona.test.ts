import { describe, expect, it, vi } from 'vitest';
import { briefToText, draftPersona, PersonaGenerationError, personaToRuntime, randomLook, refinePersona, suggestUsername, validatePersona } from '../persona';
import { HUES } from '../types';
import { ACCESSORIES, HAIR_STYLES, HAIR_TONES, SPECIES, isCompatible } from '../character';

/** Seeded Park–Miller PRNG. */
const rng = (seed: number) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
import { draftJson, personaSpec, ScriptedLLM } from './helpers';

/** Deterministic rand from a list of values */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

const LANGUAGES = ['English', 'Persian', 'Arabic', 'Turkish', 'French', 'German', 'Spanish'];

/** Inspect the actual schema sent to the provider, rather than a second copy of the schema. */
function promptedSchema(system: string) {
  const json = system.split('\n').find((line) => line.startsWith('{"$schema":'));
  expect(json).toBeDefined();
  return JSON.parse(json!);
}

describe('draftPersona', () => {
  it('parses Claude JSON (even fenced, with chatter) and keeps Claude\'s look', async () => {
    const llm = new ScriptedLLM().push(`Here you go:\n\`\`\`json\n${draftJson({ name: 'Leyla' })}\n\`\`\`\nEnjoy!`);
    const draft = await draftPersona(llm, { role: 'Producer', culture: 'Iranian' }, 'HOOR');
    expect(draft.names[0]).toBe('Leyla');
    expect(draft.persona.name).toBe('Leyla');
    expect(draft.look).toEqual({ hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } });
    const req = llm.requests[0];
    expect(req.system).toContain('HOOR');
    expect(req.messages[0].content).toContain('Role: Producer');
    expect(req.messages[0].content).toContain('Nationality / culture: Iranian');
  });

  it('falls back to a random look when Claude omits it', async () => {
    const llm = new ScriptedLLM().push(JSON.stringify({ names: ['Nova'], persona: personaSpec({ presentation: 'masculine' }) }));
    const { look } = await draftPersona(llm, {}, 'HOOR');
    expect(HUES).toContain(look.hue);
    expect(['puff', 'tower', 'drift']).toContain(look.family);
    expect(llm.requests).toHaveLength(1);
  });

  it('falls back to a random look when Claude\'s look is invalid instead of failing the whole draft', async () => {
    const llm = new ScriptedLLM().push(draftJson({}, { hue: 'neon', family: 'blob', features: {} }));
    const { look, persona } = await draftPersona(llm, {}, 'HOOR');
    expect(persona.name).toBe('Nova');
    expect(HUES).toContain(look.hue);
    expect(llm.requests).toHaveLength(1);
  });

  it('keeps Claude\'s v2 character parts', async () => {
    const v2 = { hue: 'lagoon', family: 'tower', features: { cheeks: true, lashes: false, brows: false }, species: 'owl', hair: 'fringe', hairTone: 'cocoa', accessory: 'specs', accent: 'navy' };
    const { look } = await draftPersona(new ScriptedLLM().push(draftJson({}, v2)), {}, 'HOOR');
    expect(look).toEqual(v2);
  });

  it('drops only the clashing part when Claude picks an incompatible look', async () => {
    const clash = { hue: 'rose', family: 'puff', features: { cheeks: true, lashes: true, brows: false }, species: 'bunny', hair: 'tuft', accessory: 'cap' };
    const { look } = await draftPersona(new ScriptedLLM().push(draftJson({}, clash)), {}, 'HOOR');
    expect(look).toMatchObject({ hue: 'rose', species: 'bunny', hair: 'tuft', accessory: 'none' });
    expect(isCompatible(look).ok).toBe(true);
    const chick = { hue: 'butter', family: 'puff', features: { cheeks: true, lashes: false, brows: false }, species: 'chick', hair: 'curls', accessory: 'bowtie' };
    expect((await draftPersona(new ScriptedLLM().push(draftJson({}, chick)), {}, 'HOOR')).look).toMatchObject({ species: 'chick', hair: 'none', accessory: 'bowtie' });
  });

  it('falls back to a compatible random v2 look when Claude invents a species', async () => {
    const llm = new ScriptedLLM().push(draftJson({ role: 'Customer support lead' }, { hue: 'sky', family: 'puff', features: { cheeks: true, lashes: false, brows: false }, species: 'fox' }));
    const { look } = await draftPersona(llm, {}, 'HOOR');
    expect(SPECIES).toContain(look.species);
    expect(isCompatible(look).ok).toBe(true);
    expect(llm.requests).toHaveLength(1);
  });

  it('asks Claude for species, hair and accessory from the enums and the role guide', async () => {
    const llm = new ScriptedLLM().push(draftJson());
    await draftPersona(llm, { role: 'Support' }, 'HOOR');
    const look = promptedSchema(llm.requests[0].system).properties.look;
    expect(look.properties.species.enum).toEqual([...SPECIES]);
    expect(look.properties.hair.enum).toEqual([...HAIR_STYLES]);
    expect(look.properties.accessory.enum).toEqual([...ACCESSORIES]);
    expect(look.properties.hairTone.enum).toEqual([...HAIR_TONES]);
    expect(look.required).toEqual(expect.arrayContaining(['hue', 'family', 'features', 'species', 'hair', 'accessory']));
    expect(look.required).not.toContain('accent');
    const system = llm.requests[0].system;
    expect(system).toContain('support → headset');
    expect(system).toContain('a chick with any hair');
    expect(system).toContain('Never derive it from culture or gender');
  });

  it('applies schema defaults for optional fields', async () => {
    const minimal = { names: ['Kai'], persona: { name: 'Kai', role: 'QA', backstory: 'b', personality: 'p', communicationStyle: 'c', voiceBrief: 'v' } };
    const { persona } = await draftPersona(new ScriptedLLM().push(JSON.stringify(minimal)), {}, 'HOOR');
    expect(persona.languages).toEqual(['English']);
    expect(persona.presentation).toBe('neutral');
    expect(persona.values).toEqual([]);
  });

  it('accepts all seven selectable languages and supplies the precise field limits to Claude', async () => {
    const llm = new ScriptedLLM().push(draftJson({ languages: LANGUAGES }));
    const draft = await draftPersona(llm, { languages: LANGUAGES }, 'HOOR');
    expect(draft.persona.languages).toEqual(LANGUAGES);
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0].maxTokens).toBe(4096);
    expect(promptedSchema(llm.requests[0].system)).toMatchObject({
      properties: {
        persona: { properties: {
          languages: { maxItems: 32, items: { maxLength: 40 } },
          culture: { maxLength: 200 },
          accent: { maxLength: 80 },
        } },
        look: { properties: { family: { enum: ['puff', 'tower', 'drift'] } } },
      },
    });
  });

  it('repairs overlong culture and accent without clipping identity or losing any languages', async () => {
    const brief = {
      description: 'A woman from Tehran: a broad-knowledge social companion, curious about people and everyday life.',
      presentation: 'feminine' as const, culture: 'Iranian, raised in Tehran', accent: 'Tehrani Persian', languages: LANGUAGES,
    };
    const invalid = draftJson({
      name: 'Leila', role: 'Companion', languages: LANGUAGES,
      culture: 'Iranian, raised in Tehran with a warm, contemporary outlook. '.repeat(8),
      accent: 'Natural Tehrani Persian, with clear pronunciation in her other languages. '.repeat(3),
    });
    const corrected = {
      name: 'Leila', role: 'Companion', languages: LANGUAGES, culture: 'Iranian, raised in Tehran', accent: 'Tehrani Persian',
    };
    const llm = new ScriptedLLM().push(invalid, draftJson(corrected));
    const draft = await draftPersona(llm, brief, 'HOOR');
    expect(draft.persona).toMatchObject(corrected);
    expect(llm.requests.map((request) => request.maxTokens)).toEqual([4096, 8192]);
    const repair = llm.requests[1];
    expect(repair.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(repair.messages[1].content).toBe(invalid);
    expect(repair.messages[2].content).toContain(briefToText(brief));
    expect(repair.messages[2].content).toMatch(/persona\.culture[^\n]*200/);
    expect(repair.messages[2].content).toMatch(/persona\.accent[^\n]*80/);
    expect(repair.messages[2].content).toMatch(/persona\.culture[^\n]*at most 120 characters/);
    expect(repair.messages[2].content).toMatch(/persona\.accent[^\n]*at most 48 characters/);
  });

  it('repairs a valid-shaped answer that silently omits selected languages', async () => {
    const llm = new ScriptedLLM().push(draftJson({ languages: ['English'] }), draftJson({ languages: LANGUAGES }));
    const draft = await draftPersona(llm, { languages: LANGUAGES }, 'HOOR');
    expect(draft.persona.languages).toEqual(LANGUAGES);
    expect(llm.requests).toHaveLength(2);
    const correction = llm.requests[1].messages[2].content;
    expect(correction).toContain('persona.languages');
    for (const language of LANGUAGES) expect(correction).toContain(language);
  });

  it('repairs truncated JSON using the original request and entire unfinished answer', async () => {
    const truncated = '{"names":["Leila"],"persona":{"name":"Leila","backstory":"Grew up in Tehran';
    const llm = new ScriptedLLM().push(truncated, draftJson({ name: 'Leila', culture: 'Iranian' }));
    const draft = await draftPersona(llm, { description: 'A curious companion from Tehran' }, 'HOOR');
    expect(draft.persona.name).toBe('Leila');
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[1].messages[1].content).toBe(truncated);
    expect(llm.requests[1].messages[2].content).toContain('JSON');
    expect(llm.requests[1].messages[2].content).toContain('A curious companion from Tehran');
  });

  it('ends after one failed JSON correction with a safe typed error', async () => {
    const llm = new ScriptedLLM().push('I cannot help with that.', '{"names":[', draftJson());
    const error = await draftPersona(llm, {}, 'HOOR').catch((error: unknown) => error);
    expect(error).toBeInstanceOf(PersonaGenerationError);
    expect(error).toMatchObject({
      invalidFields: ['JSON'],
      message: "Claude couldn't finish a valid profile after one correction. Your brief is kept; try drafting again.",
    });
    expect(llm.requests).toHaveLength(2);
    expect(llm.queue).toHaveLength(1);
  });

  it('reports the final invalid field paths after one failed schema correction', async () => {
    const invalid = draftJson({ culture: 'private-generated-content '.repeat(20), accent: 'x'.repeat(81) });
    const llm = new ScriptedLLM().push(invalid, invalid, draftJson());
    const error = await draftPersona(llm, {}, 'HOOR').catch((error: unknown) => error);
    expect(error).toBeInstanceOf(PersonaGenerationError);
    expect(error).toMatchObject({ invalidFields: ['persona.culture', 'persona.accent'] });
    expect((error as Error).message).not.toContain('private-generated-content');
    expect(llm.requests).toHaveLength(2);
  });

  it.each([
    new Error('Provider authentication failed'),
    new Error('Network connection reset'),
    new SyntaxError('Provider response could not be decoded'),
  ])('propagates provider failure without retrying: %s', async (failure) => {
    const llm = { complete: vi.fn().mockRejectedValue(failure) };
    await expect(draftPersona(llm, {}, 'HOOR')).rejects.toBe(failure);
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });
});

describe('refinePersona', () => {
  it('sends the current persona and the instruction, returns the refined persona', async () => {
    const llm = new ScriptedLLM().push(JSON.stringify(personaSpec({ personality: 'More playful' })));
    const refined = await refinePersona(llm, personaSpec(), 'make her more playful');
    expect(refined.personality).toBe('More playful');
    expect(llm.requests[0].messages[0].content).toContain('"name":"Nova"');
    expect(llm.requests[0].messages[0].content).toContain('make her more playful');
  });

  it('uses the same bounded repair while preserving identity and explicit language changes', async () => {
    const current = personaSpec({ name: 'Leila', role: 'Companion', languages: LANGUAGES, culture: 'Iranian, raised in Tehran' });
    const requested = { ...current, personality: 'More playful', languages: ['Persian', 'Turkish'] };
    const invalid = JSON.stringify({ ...requested, communicationStyle: 'Keep replies warm, natural, and conversational. '.repeat(12) });
    const llm = new ScriptedLLM().push(invalid, JSON.stringify(requested));
    const instruction = 'Make her more playful and change her languages to only Persian and Turkish.';
    const refined = await refinePersona(llm, current, instruction);
    expect(refined).toMatchObject(requested);
    expect(llm.requests.map((request) => request.maxTokens)).toEqual([4096, 8192]);
    expect(promptedSchema(llm.requests[0].system)).toMatchObject({ properties: { communicationStyle: { maxLength: 400 }, languages: { maxItems: 32 } } });
    const repair = llm.requests[1].messages;
    expect(repair[1].content).toBe(invalid);
    expect(repair[2].content).toContain(JSON.stringify(current));
    expect(repair[2].content).toContain(instruction);
    expect(repair[2].content).toMatch(/communicationStyle[^\n]*400/);
  });

  it('does not make a third refinement attempt after the correction also fails', async () => {
    const invalid = JSON.stringify(personaSpec({ accent: 'x'.repeat(81) }));
    const llm = new ScriptedLLM().push(invalid, invalid, JSON.stringify(personaSpec()));
    await expect(refinePersona(llm, personaSpec(), 'make her more playful')).rejects.toMatchObject({ invalidFields: ['accent'] });
    expect(llm.requests).toHaveLength(2);
    expect(llm.queue).toHaveLength(1);
  });
});

describe('validatePersona', () => {
  it('accepts a full persona and rejects wrong types or unknown keys', () => {
    expect(validatePersona(personaSpec()).ok).toBe(true);
    expect(validatePersona({ ...personaSpec(), values: 'not-a-list' }).ok).toBe(false);
    expect(validatePersona({ ...personaSpec(), presentation: 'robot' }).ok).toBe(false);
    expect(validatePersona({ ...personaSpec(), isAdmin: true }).ok).toBe(false);
    expect(validatePersona(personaSpec({ culture: 'x'.repeat(201) })).ok).toBe(false);
  });

  it('allows up to 32 languages while keeping the manual edit count and item limits strict', () => {
    const languages = Array.from({ length: 32 }, (_, index) => `Language ${index}`);
    expect(validatePersona(personaSpec({ languages })).ok).toBe(true);
    expect(validatePersona(personaSpec({ languages: [...languages, 'One too many'] })).ok).toBe(false);
    expect(validatePersona(personaSpec({ languages: ['x'.repeat(41)] })).ok).toBe(false);
  });
});

describe('briefToText', () => {
  it('describes sliders and falls back to a surprise prompt', () => {
    expect(briefToText({})).toContain('Surprise us');
    const text = briefToText({ traits: { warmDirect: 10, playfulSerious: 50, conciseExpansive: 90 }, languages: ['Persian', 'English'] });
    expect(text).toContain('leans warm');
    expect(text).toContain('balanced playful/serious');
    expect(text).toContain('leans expansive');
    expect(text).toContain('Languages: Persian, English');
  });
});

describe('randomLook', () => {
  it('leans on presentation 3 times in 4', () => {
    expect(randomLook('feminine', seq(0.1)).family).toBe('puff');
    expect(randomLook('masculine', seq(0.1)).family).toBe('tower');
    expect(randomLook('neutral', seq(0.1)).family).toBe('drift');
  });

  it('sometimes shuffles the family so looks never become a rule', () => {
    // 0.9 → shuffle; next 0.0 → families[0] = puff even for masculine
    expect(randomLook('masculine', seq(0.9, 0.0, 0.5)).family).toBe('puff');
  });

  it('always yields a valid hue and boolean features, even for rand() edge values', () => {
    for (const r of [0, 0.5, 0.999999]) {
      const look = randomLook('neutral', seq(r));
      expect(HUES).toContain(look.hue);
      expect(Object.values(look.features).every((v) => typeof v === 'boolean')).toBe(true);
    }
  });

  it('varies over many draws', () => {
    const hues = new Set(Array.from({ length: 200 }, () => randomLook('neutral').hue));
    expect(hues.size).toBeGreaterThan(4);
  });

  it('is always a complete, compatible v2 look (1,000 seeds)', () => {
    const species = new Set<string>(), hair = new Set<string>(), accessories = new Set<string>();
    for (let seed = 1; seed <= 1000; seed++) {
      const look = randomLook((['feminine', 'masculine', 'neutral'] as const)[seed % 3], rng(seed), seed % 2 ? 'Data analyst' : undefined);
      expect(isCompatible(look)).toEqual({ ok: true });
      expect(look.accent).toBeDefined();
      expect(look.hairTone).not.toBe(look.hue);
      species.add(look.species!); hair.add(look.hair!); accessories.add(look.accessory!);
    }
    expect(species.size).toBe(SPECIES.length);
    expect(hair.size).toBe(HAIR_STYLES.length);
    expect(accessories.size).toBe(ACCESSORIES.length);
  });

  it('stays compatible for constant rand() edge values', () => {
    for (const r of [0, 0.3, 0.5, 0.999999]) for (const role of [undefined, 'Engineer']) expect(isCompatible(randomLook('masculine', seq(r), role)).ok).toBe(true);
  });

  it('leans the accessory on the role', () => {
    const r = rng(42);
    const draws = Array.from({ length: 400 }, () => randomLook('neutral', r, 'Customer support').accessory);
    expect(draws.filter((a) => a === 'headset').length / draws.length).toBeGreaterThan(0.6);
    const design = Array.from({ length: 400 }, () => randomLook('neutral', r, 'Brand designer').accessory);
    expect(design.filter((a) => ['beret', 'flower', 'star'].includes(a!)).length / design.length).toBeGreaterThan(0.6);
  });
});

describe('suggestUsername', () => {
  it('builds a Telegram-valid bot username ending in _bot', () => {
    expect(suggestUsername('Nova')).toBe('hoor_nova_bot');
    expect(suggestUsername('Zoë Ann-Marie')).toBe('hoor_zoeannmarie_bot');
    expect(suggestUsername('لیلا')).toBe('hoor_agent_bot');
    const long = suggestUsername('A'.repeat(80));
    expect(long.length).toBeLessThanOrEqual(32);
    for (const u of [long, suggestUsername('x!y'), suggestUsername('Nova', 'ludaxis')]) {
      expect(u).toMatch(/^[a-z][a-z0-9_]{3,30}bot$/);
      expect(u.endsWith('_bot')).toBe(true);
    }
  });
});

describe('personaToRuntime', () => {
  it('folds backstory, culture, expertise, limits and languages into the personality', () => {
    const r = personaToRuntime(personaSpec());
    expect(r.personality).toContain('Curious and candid');
    expect(r.personality).toContain('Background: Shipped three puzzle games.');
    expect(r.personality).toContain('Expertise: Level design');
    expect(r.personality).toContain("Won't do: Legal advice");
    expect(r.personality).toContain('Reply in the language the person uses');
    expect(r.values).toEqual(['Craft']);
  });
});
