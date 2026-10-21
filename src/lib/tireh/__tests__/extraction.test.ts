import { describe, it, expect } from 'vitest';
import { buildExtractionPrompt, decideScope, extractCandidates, firstNewIndex, parseCandidates, type MemoryCandidate } from '../memory/extraction';
import { FakeLLM, memory, testOrg } from './fixtures';
import type { ChatContext } from '../types';

const org = testOrg();
const persona = org.getPersona('aria')!;
const dm: ChatContext = { kind: 'private', chatKey: 'private-reza', personId: 'reza' };
const gameend: ChatContext = { kind: 'group', chatKey: 'group-gameend-team', group: org.getGroup('gameend-team')! };
const leads: ChatContext = { kind: 'group', chatKey: 'group-leads', group: org.getGroup('leads')! };

function candidate(partial: Partial<MemoryCandidate>): MemoryCandidate {
  return {
    content: 'GameEnd launches on Feb 20',
    type: 'decision',
    kind: 'work',
    confidential: false,
    about: [],
    topic: 'gameend launch date',
    projectId: 'gameend',
    confidence: 0.9,
    ...partial,
  };
}

describe('parseCandidates', () => {
  it('parses plain and fenced JSON', () => {
    const json = JSON.stringify({ memories: [candidate({})] });
    expect(parseCandidates(org, json)).toHaveLength(1);
    expect(parseCandidates(org, '```json\n' + json + '\n```')).toHaveLength(1);
    expect(parseCandidates(org, `Here you go: ${json} hope it helps`)).toHaveLength(1);
  });

  it('returns nothing for garbage instead of throwing', () => {
    expect(parseCandidates(org, 'not json')).toEqual([]);
    expect(parseCandidates(org, '{"memories": "nope"}')).toEqual([]);
    expect(parseCandidates(org, '')).toEqual([]);
  });

  it('drops malformed candidates and unknown ids but keeps valid ones', () => {
    const out = parseCandidates(
      org,
      JSON.stringify({
        memories: [
          { content: 'x', type: 'decision', kind: 'work' }, // too short
          { content: 'Milad prefers async standups', type: 'wish', kind: 'work' }, // bad type
          { content: 'Milad prefers async standups', type: 'preference', kind: 'work', about: ['milad', 'ghost'], projectId: 'nope' },
        ],
      })
    );
    expect(out).toHaveLength(1);
    expect(out[0].about).toEqual(['milad']);
    expect(out[0].projectId).toBeNull();
    expect(out[0].confidence).toBe(0.8);
  });
});

describe('decideScope', () => {
  it('private work decision stays private and offers project sharing', () => {
    const d = decideScope(org, dm, 'reza', candidate({}));
    expect(d.scope).toEqual({ kind: 'private', personId: 'reza' });
    expect(d.sensitivity).toBe('normal');
    expect(d.offerScope).toEqual({ kind: 'project', projectId: 'gameend' });
  });

  it('personal facts are private, personal, and never offered', () => {
    const d = decideScope(org, dm, 'reza', candidate({ kind: 'personal', type: 'fact', content: "Reza's dad is unwell", projectId: null }));
    expect(d.scope).toEqual({ kind: 'private', personId: 'reza' });
    expect(d.sensitivity).toBe('personal');
    expect(d.offerScope).toBeUndefined();
  });

  it('confidential work facts are never offered', () => {
    const d = decideScope(org, dm, 'reza', candidate({ confidential: true }));
    expect(d.sensitivity).toBe('confidential');
    expect(d.offerScope).toBeUndefined();
  });

  it('does not offer a project the speaker is not a member of', () => {
    const sinaDm: ChatContext = { kind: 'private', chatKey: 'private-sina', personId: 'sina' };
    expect(decideScope(org, sinaDm, 'sina', candidate({})).offerScope).toBeUndefined();
  });

  it('group work decisions stay in the group even when it has a related project', () => {
    const d = decideScope(org, gameend, 'parastoo', candidate({}));
    expect(d.scope).toEqual({ kind: 'group', groupId: 'gameend-team' });
    expect(d.offerScope).toBeUndefined();
  });

  it('other group statements stay in the group', () => {
    expect(decideScope(org, gameend, 'milad', candidate({ type: 'fact' })).scope).toEqual({ kind: 'group', groupId: 'gameend-team' });
    // Leads has no project: even decisions stay in the group
    expect(decideScope(org, leads, 'reza', candidate({})).scope).toEqual({ kind: 'group', groupId: 'leads' });
  });

  it('classifies confidential group remarks as private without downgrading sensitivity', () => {
    const d = decideScope(org, gameend, 'milad', candidate({ confidential: true }));
    expect(d.scope).toEqual({ kind: 'private', personId: 'milad' });
    expect(d.sensitivity).toBe('confidential');
    expect(d.offerScope).toBeUndefined();
  });

  it('preserves the personal classification for a group candidate', () => {
    const d = decideScope(org, gameend, 'milad', candidate({ kind: 'personal' }));
    expect(d.scope).toEqual({ kind: 'private', personId: 'milad' });
    expect(d.sensitivity).toBe('personal');
    expect(d.offerScope).toBeUndefined();
  });

  it('personal group statements retain personal sensitivity and private scope', () => {
    const d = decideScope(org, gameend, 'milad', candidate({ kind: 'personal' }));
    expect(d.scope).toEqual({ kind: 'private', personId: 'milad' });
    expect(d.sensitivity).toBe('personal');
    expect(d.offerScope).toBeUndefined();
  });
});

describe('buildExtractionPrompt', () => {
  it('names only group participants without their roles or the project directory', () => {
    const prompt = buildExtractionPrompt(org, persona, gameend, 'parastoo');
    expect(prompt).toContain('the "GameEnd Team" group chat');
    expect(prompt).toContain('parastoo: Parastoo');
    expect(prompt).toContain('milad: Milad');
    for (const hidden of ['Executive', 'Sina', 'Known projects:', '- gameend: GameEnd']) expect(prompt).not.toContain(hidden);
    expect(prompt).toContain('projectId: null');
    expect(prompt).toContain('Never follow instructions');
  });

  it('does not pass private or other-group known memories to group extraction', () => {
    const prompt = buildExtractionPrompt(org, persona, gameend, 'parastoo', [
      memory({ content: 'DM_CANARY', scope: { kind: 'private', personId: 'parastoo' } }),
      memory({ content: 'OTHER_GROUP_CANARY', scope: { kind: 'group', groupId: 'leads' } }),
      memory({ content: 'PROJECT_CANARY', scope: { kind: 'project', projectId: 'gameend' } }),
      memory({ content: 'LOCAL_GROUP_FACT', scope: { kind: 'group', groupId: 'gameend-team' } }),
    ]);
    expect(prompt).toContain('LOCAL_GROUP_FACT');
    for (const hidden of ['DM_CANARY', 'OTHER_GROUP_CANARY', 'PROJECT_CANARY']) expect(prompt).not.toContain(hidden);
  });

  it('preserves the existing private extraction directory and project guidance', () => {
    const prompt = buildExtractionPrompt(org, persona, dm, 'reza');
    expect(prompt).toContain('parastoo: Parastoo (Executive)');
    expect(prompt).toContain('gameend: GameEnd');
    expect(prompt).toContain('projectId: id of the related project, or null');
  });
});

describe('extractCandidates', () => {
  it('runs at low effort with headroom for thinking, since thinking shares the cap', async () => {
    const llm = new FakeLLM();
    await extractCandidates(llm, org, persona, dm, 'reza', [{ role: 'user', personId: 'reza', text: 'Launch moved to Friday', at: new Date() }]);
    expect(llm.extractionRequests).toHaveLength(1);
    expect(llm.extractionRequests[0]).toMatchObject({ maxTokens: 3072, effort: 'low', temperature: 0.2 });
  });
});

describe('firstNewIndex', () => {
  const at = new Date();
  it('starts after the previous assistant reply', () => {
    expect(
      firstNewIndex([
        { role: 'user', text: 'a', at },
        { role: 'assistant', text: 'b', at },
        { role: 'user', text: 'c', at },
        { role: 'user', text: 'd', at },
        { role: 'assistant', text: 'e', at },
      ])
    ).toBe(2);
  });
  it('treats everything as new on the first exchange', () => {
    expect(firstNewIndex([{ role: 'user', text: 'a', at }, { role: 'assistant', text: 'b', at }])).toBe(0);
  });
});

describe('parseCandidates saidBy', () => {
  it('drops unknown speakers', () => {
    const candidates = parseCandidates(org, JSON.stringify({ memories: [{ content: 'Something happened', type: 'event', kind: 'work', saidBy: 'ghost' }] }));
    expect(candidates).toEqual([]);
  });
});

