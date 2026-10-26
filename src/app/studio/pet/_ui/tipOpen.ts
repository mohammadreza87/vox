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
