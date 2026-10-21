import type { Metadata, Viewport } from 'next';
import { GuestRightsPanel } from './GuestRightsPanel';
import './guest-rights.css';
export const metadata: Metadata = { title: 'Privacy | Vox — Joyixir', description: 'Contact Joyixir about privacy or track a metadata-only guest request.', referrer: 'no-referrer', robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, userScalable: true, maximumScale: 5 };
export default function PrivacyPage() { return <main className="guest-privacy"><GuestRightsPanel /><noscript><p lang="en">For privacy help without JavaScript, contact info@joyixir.com. Do not send identity documents or private messages.</p><p lang="fa" dir="rtl">برای کمک حریم خصوصی بدون جاوااسکریپت با info@joyixir.com تماس بگیرید. مدرک هویتی یا پیام خصوصی نفرستید.</p><a href="mailto:info@joyixir.com">info@joyixir.com</a></noscript></main>; }
