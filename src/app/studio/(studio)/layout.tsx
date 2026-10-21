import type { Metadata } from 'next';
import '../../globals.css';
import '../studio.css';
import '../catalog.css';
import '../shell.css';
import '../motion.css';
import '../look.css';
import '../settings.css';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  title: 'Vox Studio',
  description: 'Spawn, call and manage your AI colleagues.',
};

/**
 * The Studio's own CSS (≈ 159 KB) and, since /studio is a root layout of its own, the app-wide CSS,
 * error boundary and providers it always had. A route group, so URLs are unchanged and the pet page
 * (`/studio/pet/[agentId]`, outside this group) loads none of it.
 */
export default function StudioShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Providers>{children}</Providers>
    </ErrorBoundary>
  );
}
