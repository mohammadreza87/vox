/**
 * Circles wire formats (GROUP_AGENTS_SPEC §9 S1, §13). Telegram caps callback_data at 64 bytes and
 * start/startapp payloads at 64 chars of [A-Za-z0-9_-], so both carry only short opaque ids; the
 * server keeps the payload (a presentation receipt, a group's joinCode). Codes are routing hints and
 * unverified intent: every use re-checks identity and membership on the server.
 */

import { randomBytes } from 'crypto';

/** STUDIO_CIRCLES kill switch: off = today; reply = agent choices and reply-only DMs (S1); circles = full. */
export type CirclesMode = 'off' | 'reply' | 'circles';
export const parseCirclesMode = (value?: string): CirclesMode => {
  const mode = value?.trim().toLowerCase();
  return mode === 'reply' || mode === 'circles' ? mode : 'off';
};

/** cj join · cr only reply · cd not me (DM card receipts); ci include agent · cs save · cn don't save (later slices). */
export type CardAction = 'cj' | 'cr' | 'cd' | 'ci' | 'cs' | 'cn';
const CALLBACK = /^(c[jrdisn]):([A-Za-z0-9_-]{1,40})$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
export const MAX_CALLBACK_BYTES = 64;

export function cardCallback(action: CardAction, id: string): string {
  const data = `${action}:${id}`;
  if (!ID.test(id) || Buffer.byteLength(data) > MAX_CALLBACK_BYTES) throw new Error('invalid_card_callback');
  return data;
}

export function parseCardCallback(data?: string): { action: CardAction; id: string } | null {
  const match = data && Buffer.byteLength(data) <= MAX_CALLBACK_BYTES ? CALLBACK.exec(data) : null;
  return match ? { action: match[1] as CardAction, id: match[2] } : null;
}

/** j_ group join code · c_ channel code · a_ agent card. */
export type StartPayload = { kind: 'join' | 'channel' | 'agent'; code: string };
const PAYLOAD = /^[A-Za-z0-9_-]{1,64}$/;
const KINDS = { j: 'join', c: 'channel', a: 'agent' } as const;

export function startPayload(kind: StartPayload['kind'], code: string): string {
  const prefix = (Object.keys(KINDS) as Array<keyof typeof KINDS>).find((k) => KINDS[k] === kind)!;
  const payload = `${prefix}_${code}`;
  if (!PAYLOAD.test(payload) || !code) throw new Error('invalid_start_payload');
  return payload;
}

/** The deep-link payload of a `/start <payload>`; null for none, unknown or malformed (treated as a plain /start). */
export function parseStartPayload(payload?: string): StartPayload | null {
  if (!payload || !PAYLOAD.test(payload)) return null;
  const match = /^([jca])_([A-Za-z0-9_-]+)$/.exec(payload);
  return match ? { kind: KINDS[match[1] as keyof typeof KINDS], code: match[2] } : null;
}

/** 22 random base64url characters: a group's rotatable join code. */
export const newJoinCode = () => randomBytes(16).toString('base64url');
/**
 * A presentation receipt id that fits any callback: the owner's Telegram id in base36, '-', then 12
 * random base64url characters. The owner part routes a tap to the owner's record (a forwarded card
 * names someone else and is refused); the random part is what proves the card.
 */
export const receiptIdFor = (telegramId: number) => `${telegramId.toString(36)}-${randomBytes(9).toString('base64url')}`;
export function receiptOwner(id: string): number | undefined {
  const match = /^([0-9a-z]{1,11})-[A-Za-z0-9_-]{12}$/.exec(id);
  const owner = match ? parseInt(match[1], 36) : NaN;
  return Number.isSafeInteger(owner) && owner > 0 ? owner : undefined;
}

/** STUDIO_CIRCLE_CHATS: the pilot allowlist of group chat ids, comma-separated; anything malformed is ignored (fail closed). */
export function parseCircleChats(value?: string): ReadonlySet<number> {
  return new Set((value ?? '').split(',').map((v) => v.trim()).filter((v) => /^-?[1-9]\d{0,15}$/.test(v)).map(Number).filter(Number.isSafeInteger));
}

/** A group card's id in its callback data: 12 random base64url characters, never a receipt id (no '-' owner part). */
export const newCardId = () => `g${randomBytes(9).toString('base64url').replace(/-/g, '_')}`;

/**
 * The URL button on every group card, welcome and nudge. S2: the DM hop `t.me/<bot>?start=j_<joinCode>`.
 * S4 switches this one function to the direct Mini App link (R2 decision 5).
 */
export function circleJoinUrl(botUsername: string, joinCode: string): string {
  return `https://t.me/${botUsername}?start=${startPayload('join', joinCode)}`;
}
