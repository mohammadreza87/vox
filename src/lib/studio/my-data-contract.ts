/**
 * "My data" in Vox: the person's own pet care, agent choices, group participation and notes, with export and erase.
 * It runs only in the manager bot's Mini App (VoxxBot-signed initData), never on an agent bot's page: an agent's
 * creator holds that agent's bot token, so agent-signed initData can be forged or harvested; VoxxBot's cannot.
 * Client-safe: constants and wire types only (the middleware, the page and the server share them).
 */

import type { PetExportResponse, PetForgetResponse } from '../pet/types';
import type { ConnectionsExport } from '../connections/rights';

/** The fixed, content-free start code: `t.me/<VoxxBot>?startapp=mydata` (or `?start=mydata`). */
export const MY_DATA_CODE = 'mydata';
/** The page: reached by the middleware rewrite of the Main Mini App launch, or the /start reply's web_app button. */
export const MY_DATA_PAGE = '/studio/my-data';
export const MY_DATA_API = '/api/studio/my-data';

/**
 * GET /api/studio/my-data: the pet export, the person's own connection records (one entry per space that holds any;
 * never tokens), and the display names of the agents these mention (only those). `connectionsUnavailable`: the
 * connection records could not be read just now; everything else is still complete.
 */
export interface MyDataResponse extends PetExportResponse { connections?: ConnectionsExport[]; connectionsUnavailable?: true; agentNames: Record<string, string> }
/**
 * POST /api/studio/my-data/forget, body `{ "confirm": true }`. Also stops the person's connections in both spaces for
 * every agent (best-effort, never fails the forget): `connectionsErased` gone now, `connectionsPending` gone once the
 * broker drops each vault entry.
 */
export type MyDataForgetResponse = PetForgetResponse;
/** DELETE /api/studio/my-data/notes/:copyId: their own copy only. */
export interface MyDataNoteEraseResponse { erased: boolean }

export type MyDataErrorCode = 'authentication_required' | 'origin_denied' | 'json_required' | 'invalid_request' | 'too_large'
  | 'rate_limited' | 'not_found' | 'my_data_unavailable';
