import type { Metadata, Viewport } from 'next';
import '../pet.css';
import { PetLaunch } from '../_ui/PetLaunch';

export const metadata: Metadata = { title: 'Vox', robots: { index: false, follow: false } };
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: 'cover', themeColor: '#0E1013',
};

/**
 * A pet opened over a group (Circles S4): the manager bot's Main Mini App is /studio, and the middleware rewrites a
 * `startapp=p_…` launch here. The page asks the server which agent the signed launch code names, then shows that
 * person's own pet for it. The static segment wins over `[agentId]`.
 */
export default function PetLaunchPage() {
  return <PetLaunch />;
}
