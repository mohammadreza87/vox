/**
 * What one lazy chunk asks of a room that is not mounted yet (a check-in's replay, a talk turn's pet_action): read and
 * cleared by the room when it mounts. Content-free; never persisted. Shared only by lazy chunks.
 */
export const roomIntent: { guess?: 'start' | 'resume'; bloom?: boolean } = {};
