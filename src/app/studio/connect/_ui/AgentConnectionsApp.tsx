'use client';
import { flushSync } from 'react-dom';
import { pageActive, subscribeActivity } from '../../_components/motion/activity';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AgentConnectionsHandoff } from '@/lib/connections/contracts';
import { ApiError, initTelegram, tg } from '../../_lib/client';
import { createAgentConnectionsApi } from '../../_lib/agent-connections-client';
import { connectionsTranslate, type ConnectionsLocale } from './copy';

const errorText = (cause: unknown) => cause instanceof ApiError ? ({
  mcp_token_verification_unsupported: 'This server uses tokens Vox cannot verify yet. It needs signed access tokens for this exact server.',
  mcp_client_registration_unsupported: 'This server’s sign-in method is not supported yet. Choose another compatible MCP server.',
  mcp_url_unsupported: 'Use a public HTTPS MCP URL without a query or fragment.',
  mcp_setup_unavailable: 'MCP connections are awaiting service setup.',
  mcp_open_agent_bot: 'Open this agent’s Telegram Mini App to finish setup.',
  authentication_required: 'Open Connections from this agent’s Telegram bot to continue.',
  mcp_review_unavailable: 'Finish sign-in in the browser, then check again.',
  profile_confirmation_required: 'Manage connections in Vox. This page only shows them.',
  agent_unavailable: 'This agent is unavailable for your account.',
  configuration_changed: 'Service settings changed. Refresh before trying again.',
  provider_setup_required: 'This service is not ready for sign-in yet.',
  connection_exists: 'This service is already connected here.',
  grant_exists: 'Stop the existing access before choosing new access.',
  task_tools_unavailable: 'The selected tools are not available for agent tasks yet.',
  connections_unavailable: 'Connections are temporarily unavailable. Try refreshing.',
}[cause.message] ?? 'The change could not be confirmed. Refresh before trying again.') : 'The change could not be confirmed. Refresh before trying again.';

/** A signed bot session owns all displayed state. Account switches/backgrounding discard it. */
export function AgentConnectionsApp({ agentId }: { agentId: string }) {
  const [session, setSession] = useState(() => ({ signed: tg()?.initData ?? '', generation: 0, active: true }));
  const latest = useRef(session); latest.current = session;
  useLayoutEffect(() => {
    let frame = 0;
    const update = (synchronous = true) => {
      const signed = tg()?.initData ?? '', active = pageActive();
      if (latest.current.signed !== signed || latest.current.active !== active) {
        const next = { signed, active, generation: latest.current.generation + 1 }; latest.current = next; if (synchronous) flushSync(() => setSession(next)); else setSession(next);
      }
    };
    const tick = () => { update(); frame = requestAnimationFrame(tick); };
    const off = subscribeActivity(() => update()); update(false); frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); off(); };
  }, [agentId]);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(agentId)) return <main className="vxc-root" role="alert">Open Connections from this agent’s Telegram bot to continue.</main>;
  if (!session.active || session.signed !== (tg()?.initData ?? '')) return <main className="vxc-root" aria-busy="true" />;
  return <ConnectionsSession key={`${agentId}:${session.generation}`} agentId={agentId} signed={session.signed} />;
}

function ConnectionsSession({ agentId, signed }: { agentId: string; signed: string }) {
  // Telegram exists only on the client. Keep the initial markup identical to SSR.
  const [locale, setLocale] = useState<ConnectionsLocale>('en');
  useEffect(() => {
    const app = tg() as ReturnType<typeof tg> & { initDataUnsafe?: { user?: { language_code?: string } } };
    setLocale(app?.initDataUnsafe?.user?.language_code?.startsWith('fa') ? 'fa' : 'en');
  }, [signed]);
  return <HandoffSession agentId={agentId} signed={signed} locale={locale} setLocale={setLocale} />;
}
/**
 * Content-free (decision 8). This page runs on initData signed by the agent's own bot, whose token the agent's creator
 * holds: they could repoint the bot's menu and harvest it. So it shows no connection, provider or account at all (the
 * server answers only the agent's name, connections/http.ts) and sends people to Vox, where they see and manage them.
 */
function HandoffSession({ agentId, signed, locale, setLocale }: { agentId: string; signed: string; locale: ConnectionsLocale; setLocale: (locale: ConnectionsLocale) => void }) {
  const t = useMemo(() => connectionsTranslate(locale), [locale]);
  const controller = useRef(new AbortController());
  const api = useMemo(() => createAgentConnectionsApi(agentId, signed, () => controller.current.signal), [agentId, signed]);
  const [data, setData] = useState<AgentConnectionsHandoff | null>(null), [error, setError] = useState('');
  const alive = useRef(true), scope = useRef(0);
  const current = useCallback(() => alive.current && tg()?.initData === signed && pageActive(), [signed]);
  const load = useCallback(async () => {
    const turn = ++scope.current; setError(''); setData(null);
    try { const result = await api.read(); if (current() && turn === scope.current) setData(result); }
    catch (cause) {
      if (!current() || turn !== scope.current) return;
      if (cause instanceof ApiError && [401, 403].includes(cause.status)) { controller.current.abort(); controller.current = new AbortController(); scope.current++; }
      flushSync(() => { setError(errorText(cause)); setData(null); });
    }
  }, [api, current]);
  const invalidate = useCallback(() => { scope.current++; }, []);
  useLayoutEffect(() => { if (controller.current.signal.aborted) controller.current = new AbortController(); alive.current = true;
    return () => { alive.current = false; invalidate(); controller.current.abort(); }; }, [invalidate]);
  useEffect(() => { initTelegram(); void load(); return invalidate; }, [load, invalidate]);
  const agentName = data?.agent.id === agentId && data.agent.name ? data.agent.name : t('This agent');
  return <main className="vxc-root" lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'}><div className="vxc-wrap">
    <header className="vxc-head"><div><p className="vxc-kicker">{agentName}</p><h1>{t("Connections")}</h1></div><a href={`/studio/pet/${encodeURIComponent(agentId)}`}>{t("Back to agent")}</a></header>
    <label>{t('Language')}<select aria-label={t('Language')} value={locale} onChange={e => setLocale(e.target.value as ConnectionsLocale)}><option value="en">English</option><option value="fa">فارسی</option></select></label>
    {error && <div role="alert" className="vxc-note vxc-error">{t(error)}<div><button className="vxc-link" onClick={() => void load()}>{t("Refresh")}</button></div></div>}
    {!data && !error && <p role="status">{t("Loading connections…")}</p>}
    {data && <p className="vxc-note">{t("Your connected apps are in Vox. Open Vox to see them or change what this agent may use.")}</p>}
  </div></main>;
}
