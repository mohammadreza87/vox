/** Tips timing on open (design §7.1, S2, S3; P-16). Tiny on purpose: the living page reads it with the hello. */

/**
 * The opening seconds belong to the hello (§7.1, S2, S3): no tip until the pet has said hello and then either the
 * person has done something (a touch, a toy, the talk pill) or TIP_OPEN_MS has passed since the hello. The page keeps
 * every tip and ask behind its `open` busy key until this says the open is over.
 */
export const TIP_OPEN_MS = 20_000;
export function openOver(o: { hello: boolean; touched: boolean; sinceHelloMs: number }): boolean {
  return o.hello && (o.touched || o.sinceHelloMs >= TIP_OPEN_MS);
}

/**
 * What else holds tips and asks back (§7.1 "a calm moment"; N-1): the page's busy keys besides a room's own (`game`,
 * `closet`, a sheet). `round`: a Bop round on Home is in play; `bedtime`: the moon was tapped and the pet is going to
 * sleep; `replay`: a check-in's moment or a stage-up is the open event and is still being read.
 */
export const BUSY = { open: 'open', round: 'round', bedtime: 'bedtime', replay: 'replay' } as const;
export const BEDTIME_MS = 4000;
