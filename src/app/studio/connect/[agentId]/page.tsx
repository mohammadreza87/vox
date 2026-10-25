import type { Metadata, Viewport } from 'next';
import '../connect.css';
import { AgentConnectionsApp } from '../_ui/AgentConnectionsApp';
import { settingsV2 } from '@/lib/studio/flags';
export const metadata: Metadata = { title: 'Connections · Vox', robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0E1013' };
export default async function AgentConnectionsPage({ params, searchParams }: { params: Promise<{ agentId: string }>; searchParams: Promise<{ ask?: string | string[] }> }) {
  // `?ask=1` (the bot's /ask handoff) is a Settings v2 behaviour: with the flag off the page opens as it always did.
  return <AgentConnectionsApp agentId={(await params).agentId} ask={settingsV2() && (await searchParams).ask === '1'} />;
}
