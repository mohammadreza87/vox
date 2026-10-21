import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CharacterGallery } from './CharacterGallery';
import { MotionPlayground } from './MotionPlayground';

export const metadata: Metadata = { title: 'Vox Studio lab', robots: { index: false } };

/** Design lab: characters and motion on a real device. Only with NEXT_PUBLIC_STUDIO_LAB=1. */
export default function StudioLabPage() {
  if (process.env.NEXT_PUBLIC_STUDIO_LAB !== '1') notFound();
  return (
    <div className="vx">
      <div className="vx-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        <header className="vx-pagehead">
          <span className="vx-over">Vox Studio</span>
          <h1 className="vx-title">Lab</h1>
        </header>
        <CharacterGallery />
        <MotionPlayground />
      </div>
    </div>
  );
}
