import type { Metadata, Viewport } from 'next';
import '../connect.css';
import { AgentConnectionsApp } from '../_ui/AgentConnectionsApp';
export const metadata: Metadata = { title: 'Connections · Vox', robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0E1013' };
export default async function AgentConnectionsPage({ params }: { params: Promise<{ agentId: string }> }) {
  return <AgentConnectionsApp agentId={(await params).agentId} />;
}
