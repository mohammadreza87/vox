import type { Studio } from './service';
import { settingsV2 } from './flags';

/**
 * Quiet Telegram records (Settings v2): a short silent DM when a person connects or disconnects an app or an MCP
 * server for an agent, and to the creator when its voice or skills change. The server stays the record of truth;
 * this is the person's copy in Telegram. Content-light: a provider name, an MCP host (never its path), the agent's
 * name and a duration. No account ids, labels, tokens or URLs.
 *
 * Connection records come from the manager bot (VoxxBot), never the agent's own bot: the agent's creator holds that
 * bot's token and can read anything it ever sent (forwardMessage/copyMessage), and connectors are Vox-only. Voice and
 * skills records go to the creator, from the agent's own bot (the only reader of that chat it could expose is them).
 *
 * Nothing records whether someone started a bot, so a send is tried and Telegram's refusal ("bot can't initiate
 * conversation", "blocked by the user") is the signal: it is skipped silently and not retried for a day.
 */
export type ReceiptKind = 'connected' | 'access' | 'access_ended' | 'disconnected' | 'mcp_added' | 'mcp_removed' | 'voice' | 'skills';
export interface ReceiptInput {
  agentId: string;
  telegramId: number;
  kind: ReceiptKind;
  locale?: 'en' | 'fa';
  /** Provider label (Gmail) */
  provider?: string;
  /** MCP server host only */
  host?: string;
  hours?: number;
  /** New voice label */
  voice?: string;
  count?: number;
  max?: number;
  /** From verified initData of the bot that sends this record: false means the person turned its messages off. */
  allowsWriteToPm?: boolean;
}
export type ReceiptOutcome = 'sent' | 'skipped' | 'failed';

/** Records about a person's connections: sent by the manager bot only. */
const CONNECTION_KINDS: ReadonlySet<ReceiptKind> = new Set(['connected', 'access', 'access_ended', 'disconnected', 'mcp_added', 'mcp_removed']);

const DAY = 86_400_000;
const num = (n: number, fa: boolean) => fa ? n.toLocaleString('fa-IR') : String(n);
const hrs = (n: number) => `${n} hour${n === 1 ? '' : 's'}`;

const TEXT: Record<'en' | 'fa', (r: ReceiptInput & { agent: string }) => string> = {
  en: (r) => {
    switch (r.kind) {
      case 'connected': return `Record: you connected ${r.provider} to ${r.agent}.`;
      case 'access': return `Record: you let ${r.agent} use ${r.provider} for ${hrs(r.hours ?? 1)}. It asks before each use.`;
      case 'access_ended': return `Record: ${r.agent}’s access to ${r.provider} ended.`;
      case 'disconnected': return `Record: ${r.agent} can no longer use ${r.provider}.`;
      case 'mcp_added': return `Record: you added an MCP server (${r.host}) to ${r.agent}.`;
      case 'mcp_removed': return `Record: ${r.agent} can no longer use the MCP server ${r.host}.`;
      case 'voice': return `Record: ${r.agent}’s voice is now ${r.voice}.`;
      case 'skills': return `Record: ${r.agent}’s skills changed (${r.count ?? 0} of ${r.max ?? 0}).`;
    }
  },
  fa: (r) => {
    switch (r.kind) {
      case 'connected': return `ثبت: ${r.provider} را به ${r.agent} وصل کردید.`;
      case 'access': return `ثبت: به ${r.agent} اجازه دادید ${num(r.hours ?? 1, true)} ساعت از ${r.provider} استفاده کند. پیش از هر استفاده از شما می‌پرسد.`;
      case 'access_ended': return `ثبت: دسترسی ${r.agent} به ${r.provider} پایان یافت.`;
      case 'disconnected': return `ثبت: ${r.agent} دیگر نمی‌تواند از ${r.provider} استفاده کند.`;
      case 'mcp_added': return `ثبت: یک سرور MCP (${r.host}) به ${r.agent} افزودید.`;
      case 'mcp_removed': return `ثبت: ${r.agent} دیگر نمی‌تواند از سرور MCP ${r.host} استفاده کند.`;
      case 'voice': return `ثبت: صدای ${r.agent} اکنون ${r.voice} است.`;
      case 'skills': return `ثبت: مهارت‌های ${r.agent} تغییر کرد (${num(r.count ?? 0, true)} از ${num(r.max ?? 0, true)}).`;
    }
  },
};

/** The receipt's text (exported for tests and copy review). */
export const receiptText = (input: ReceiptInput, agentName: string): string => TEXT[input.locale ?? 'en']({ ...input, agent: agentName });

/** Telegram's ways of saying this person never started the bot or turned it away. */
export const UNREACHABLE = /bot can't initiate|bot was blocked|user is deactivated|chat not found|forbidden/i;

/** "example.com" from an MCP server URL, or undefined (never the path or query). */
export function mcpHost(uri: string | undefined): string | undefined {
  try { return uri ? new URL(uri).hostname || undefined : undefined; } catch { return undefined; }
}

export class StudioReceipts {
  private readonly unreachable = new Map<string, number>();
  private readonly pending = new Set<Promise<unknown>>();
  private warned = false;
  constructor(private readonly studio: Pick<Studio, 'deps' | 'botToken'>) {}

  /** Sends one record now. Never throws. */
  async send(input: ReceiptInput): Promise<ReceiptOutcome> {
    try {
      if (!settingsV2() || input.allowsWriteToPm === false || !Number.isSafeInteger(input.telegramId) || input.telegramId <= 0) return 'skipped';
      const viaManager = CONNECTION_KINDS.has(input.kind);
      const key = `${viaManager ? 'manager' : input.agentId}:${input.telegramId}`, now = Date.now();
      const until = this.unreachable.get(key);
      if (until && until > now) return 'skipped';
      const agent = (await this.studio.deps.store.read()).agents.find(a => a.id === input.agentId);
      if (!agent || agent.status !== 'active') return 'skipped';
      const token = viaManager ? null : agent.bot ? this.studio.botToken(agent) : null;
      const client = viaManager ? this.studio.deps.managerBot : token ? this.studio.deps.botFor(token) : null;
      if (!client) return 'skipped';
      try {
        await client.sendMessage(input.telegramId, receiptText(input, agent.persona.name), { silent: true });
        return 'sent';
      } catch (error) {
        if (UNREACHABLE.test(error instanceof Error ? error.message : String(error))) {
          if (this.unreachable.size > 10_000) this.unreachable.clear();
          this.unreachable.set(key, now + DAY);
          return 'skipped';
        }
        throw error;
      }
    } catch {
      if (!this.warned) { this.warned = true; (this.studio.deps.logger ?? console).warn('[studio] receipt_failed'); }
      return 'failed';
    }
  }

  /** Off the response path: the caller never waits for Telegram. */
  queue(input: ReceiptInput): void { this.track(this.send(input)); }

  /** Tracks background work that ends in receipts (so tests can wait for it); its failures are swallowed. */
  track(work: Promise<unknown>): void {
    const p = work.catch(() => undefined).finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  /** Test seam: waits for every queued record. */
  async flush(): Promise<void> { while (this.pending.size) await Promise.all([...this.pending]); }
}
