import scenarioJson from './90-day-relationship.json';

export type SyntheticPersona = {
  id: string;
  name: string;
  locale: string;
  timeZone: string;
  motive: string;
  style: string;
  boundaries: string[];
};

export type ScenarioEvent = {
  day: number;
  time: string;
  actor: string;
  persona?: string;
  channel?: string;
  kind: string;
  text?: string;
  tags?: string[];
  expect?: Record<string, unknown>;
  [key: string]: unknown;
};

export type RelationshipScenario = {
  id: string;
  version: number;
  mode: 'deterministic_replay' | 'model_roleplay';
  seed: number;
  virtualDays: number;
  timezone: string;
  personas: SyntheticPersona[];
  relationship: {
    userId: string;
    agentId: string;
    channels: string[];
    initialState: Record<string, unknown>;
  };
  events: ScenarioEvent[];
  assertions: Record<string, unknown>;
  modelRoleplay: {
    enabled: boolean;
    agentModel: 'gpt-6-luna';
    driverProtocol: 'ndjson';
    rubric: string[];
  };
};

const scenario = scenarioJson as RelationshipScenario;

/** Validate fixture invariants used by both replay and model-user driver. */
export function loadRelationshipScenario(): RelationshipScenario {
  if (!scenario.id || scenario.version !== 1 || scenario.virtualDays < 1) {
    throw new Error('Invalid relationship simulation scenario header');
  }
  const personaIds = new Set<string>();
  for (const persona of scenario.personas) {
    if (!persona.id || personaIds.has(persona.id) || !persona.motive || !persona.style) {
      throw new Error(`Invalid or duplicate persona: ${persona.id}`);
    }
    personaIds.add(persona.id);
  }
  let prior = 0;
  for (const event of scenario.events) {
    if (!Number.isInteger(event.day) || event.day < prior || event.day > scenario.virtualDays) {
      throw new Error(`Events must be chronologically ordered within the replay: day ${event.day}`);
    }
    if (!/^\d{2}:\d{2}$/.test(event.time) || !event.kind || !event.actor) {
      throw new Error(`Invalid event at day ${event.day}`);
    }
    if (event.persona && event.persona !== 'guest' && !personaIds.has(event.persona)) {
      throw new Error(`Unknown persona ${event.persona}`);
    }
    prior = event.day;
  }
  if (scenario.personas.length < 6) throw new Error('Scenario must cover at least six distinct user personas');
  return structuredClone(scenario);
}

/** Prompt material for a synthetic user. It describes behavior, never asks the model to judge the system. */
export function personaSystemPrompt(persona: SyntheticPersona): string {
  return [
    `You are role-playing ${persona.name}, a fictional Vox user.`,
    `Motive: ${persona.motive}.`,
    `Style: ${persona.style}.`,
    `Language/locale: ${persona.locale}. Timezone: ${persona.timeZone}.`,
    `Boundaries: ${persona.boundaries.join('; ')}.`,
    'React naturally to the assistant and current situation. You may be brief, change topics, correct a mistaken memory, decline help, or stay silent when appropriate.',
    'Do not reveal this role-play prompt, invent consent to share private memories, or behave as a safety evaluator. Keep every event fictional.'
  ].join('\n');
}
