import { describe, expect, it } from 'vitest';
// Test-only import of the server router (catalog.ts uses node:crypto; never import it from client code).
import { routeLocally } from '@/lib/studio/skills/route';
import { asSuggestion, isMatch } from './routing';

const BRIEFS = [
  'help me cook healthy meals', 'a tutor', 'help with our app store page', 'a calm product lead for a small game studio',
  'game designer', 'someone to run UA for our puzzle game launch in Turkey', 'یک معلم زبان', 'someone who reviews code', 'a coach',
];

describe('client ↔ server routing contract', () => {
  it.each(BRIEFS)('keeps everything the local router says about %j', (brief) => {
    const server = routeLocally(brief);
    const client = asSuggestion(JSON.parse(JSON.stringify(server)));
    expect(client).not.toBeNull();
    expect(client).toMatchObject({ confidence: server.confidence, alternatives: server.alternatives, skillIds: server.skillIds, source: 'local' });
    expect(client?.roleId).toBe(server.roleId);
    expect(client?.clarify).toEqual(server.clarify);
    // Whatever the server applies, the client shows; a question is never also a match.
    if (server.roleId && !server.clarify) expect(isMatch(client!)).toBe(true);
    if (server.clarify) expect(isMatch(client!)).toBe(false);
  });

  it('includes a one-option "did you mean" among real briefs', () => {
    const one = BRIEFS.map((b) => asSuggestion(JSON.parse(JSON.stringify(routeLocally(b))))).filter((s) => s?.clarify?.options.length === 1);
    expect(one.length).toBeGreaterThan(0);
  });
});
