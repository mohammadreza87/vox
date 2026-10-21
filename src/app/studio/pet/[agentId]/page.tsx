import type { Metadata, Viewport } from 'next';
import '../pet.css';
import { PetApp } from '../_ui/PetApp';

export const metadata: Metadata = { title: 'Vox', robots: { index: false, follow: false } };
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: 'cover', themeColor: '#0E1013',
};

/**
 * One agent's pet (brief §1.1, §3.4): a server shell only. No StudioApp, no Studio CSS (the route sits
 * outside the `(studio)` group); the page loads `pet.css` and the client app. `agentId` is a routing
 * hint: who the user is and which bot signed them comes from initData on every API call.
 */
export default async function PetPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return <PetApp agentId={agentId} />;
}
