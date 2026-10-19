import { describe, expect, it } from 'vitest';
import { briefToText, draftPersona, personaToRuntime, randomLook, refinePersona, suggestUsername, validatePersona } from '../persona';
import { HUES } from '../types';
import { draftJson, personaSpec, ScriptedLLM } from './helpers';

/** Deterministic rand from a list of values */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

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
    const llm = new ScriptedLLM().push(draftJson({ presentation: 'masculine' }, undefined));
    const { look } = await draftPersona(llm, {}, 'HOOR');
    expect(HUES).toContain(look.hue);
    expect(['puff', 'tower', 'drift']).toContain(look.family);
  });

  it('falls back to a random look when Claude\'s look is invalid instead of failing the whole draft', async () => {
    const llm = new ScriptedLLM().push(draftJson({}, { hue: 'neon', family: 'blob', features: {} }));
    const { look, persona } = await draftPersona(llm, {}, 'HOOR');
    expect(persona.name).toBe('Nova');
    expect(HUES).toContain(look.hue);
  });

  it('applies schema defaults for optional fields', async () => {
    const minimal = { names: ['Kai'], persona: { name: 'Kai', role: 'QA', backstory: 'b', personality: 'p', communicationStyle: 'c', voiceBrief: 'v' } };
    const { persona } = await draftPersona(new ScriptedLLM().push(JSON.stringify(minimal)), {}, 'HOOR');
    expect(persona.languages).toEqual(['English']);
    expect(persona.presentation).toBe('neutral');
    expect(persona.values).toEqual([]);
  });

  it('throws on non-JSON or schema-violating output', async () => {
    await expect(draftPersona(new ScriptedLLM().push('I cannot help with that.'), {}, 'HOOR')).rejects.toThrow('did not return JSON');
    await expect(draftPersona(new ScriptedLLM().push(JSON.stringify({ names: [], persona: {} })), {}, 'HOOR')).rejects.toHaveProperty('issues');
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
});

describe('validatePersona', () => {
  it('accepts a full persona and rejects wrong types or unknown keys', () => {
    expect(validatePersona(personaSpec()).ok).toBe(true);
    expect(validatePersona({ ...personaSpec(), values: 'not-a-list' }).ok).toBe(false);
    expect(validatePersona({ ...personaSpec(), presentation: 'robot' }).ok).toBe(false);
    expect(validatePersona({ ...personaSpec(), isAdmin: true }).ok).toBe(false);
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
