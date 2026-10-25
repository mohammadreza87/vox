import type { Metadata, Viewport } from 'next';
import './my-data.css';
import { MyDataApp } from './_ui/MyDataApp';

export const metadata: Metadata = { title: 'My data · Vox', robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0E1013' };

/**
 * The person's own data in Vox (export, erase, notes), in the manager bot's Mini App only: reached by
 * t.me/<VoxxBot>?startapp=mydata (the middleware rewrites /studio here) or the /start mydata reply's button.
 * Outside StudioApp: no member record is needed or created, so people who only use public agents get it too.
 */
export default function MyDataPage() {
  return <MyDataApp />;
}
