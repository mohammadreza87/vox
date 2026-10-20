'use client';

import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const PATHS: Record<string, string> = {
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 5l7 7-7 7',
  refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  attach: 'M21 11.5l-8.5 8.5a5 5 0 0 1-7-7L14 4.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15.5 7.5',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  cloud: 'M7 17a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17.3 8.5 4.25 4.25 0 0 1 17 17Z',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  groups: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14a6.5 6.5 0 0 1 3 6',
  shield: 'M12 3l8 4v5c0 4.5-3.4 8.4-8 9-4.6-.6-8-4.5-8-9V7Z',
  chat: 'M4 5h16v11H9l-5 4Z',
  memory: 'M12 3a6 6 0 0 0-4 10.5V17h8v-3.5A6 6 0 0 0 12 3ZM9 21h6',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  send: 'M12 19V5M5 12l7-7 7 7',
  mic: 'M9 3h6v11H9zM5 11a7 7 0 0 0 14 0M12 18v3',
  micOff: 'M9 3h6v11H9zM5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16',
  play: 'M7 4l13 8-13 8Z',
  pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
  lock: 'M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3',
  dice: 'M4 4h16v16H4zM8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01M12 12h.01',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  image: 'M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M15 8.5h.01',
  check: 'M5 12.5l4.5 4.5L19 7',
  warn: 'M12 3l9 16H3ZM12 10v4M12 17h.01',
  trash: 'M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0',
  captions: 'M3 5h18v14H3zM10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3',
  end: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
};

export function Icon({ name, size = 22, width = 1.75, style }: { name: keyof typeof PATHS | string; size?: number; width?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...STROKE} strokeWidth={width} aria-hidden="true" style={style}>
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

export function TopBar({ onBack, title, right, backLabel }: { onBack?: () => void; title?: ReactNode; right?: ReactNode; backLabel?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, padding: '4px 8px 0', flexShrink: 0 }}>
      {onBack ? (
        <button className="vx-icon-btn" onClick={onBack} aria-label={backLabel ?? 'Back'} style={{ width: 'auto', padding: '0 8px', gap: 4 }}>
          <Icon name="back" />{backLabel && <span style={{ fontSize: 15 }}>{backLabel}</span>}
        </button>
      ) : <span style={{ width: 44 }} />}
      {title && <div className="vx-head" style={{ textAlign: 'center' }}>{title}</div>}
      <div style={{ minWidth: 44, display: 'flex', justifyContent: 'flex-end' }}>{right}</div>
    </div>
  );
}

export function Steps({ total, current }: { total: number; current: number }) {
  return (
    <div aria-label={`Step ${current + 1} of ${total}`} style={{ display: 'flex', gap: 6 }}>
      {Array.from({ length: total }, (_, i) => (
        <motion.span key={i} animate={{ width: i === current ? 20 : 8, background: i <= current ? '#D6FF5C' : '#282D35' }}
          transition={{ type: 'spring', stiffness: 500, damping: 32 }} style={{ height: 4, borderRadius: 999, display: 'block' }} />
      ))}
    </div>
  );
}

export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="vx-sheet-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.26 }} />
          <motion.div className="vx-sheet" role="dialog" aria-modal="true" aria-label={label}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 800) onClose(); }}>
            <div className="vx-grabber" />
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg className="vx-spin" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Screen({ children, k }: { children: ReactNode; k: string }) {
  return (
    <motion.div key={k} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
      transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      {children}
    </motion.div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, padding: '48px 24px' }}>
      <div className="vx-title-m">{title}</div>
      {body && <p className="vx-2" style={{ margin: 0 }}>{body}</p>}
      {action}
    </div>
  );
}

/** A labelled block, as on the tab screens: small overline, then content. */
export function Section({ label, children, id }: { label: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="vx-section" aria-labelledby={id}>
      <span className="vx-over" id={id}>{label}</span>
      {children}
    </section>
  );
}

/** A grouped-list entry that opens another screen. */
export function NavRow({ label, detail, onClick, disabled }: { label: string; detail?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="vx-row vx-nav-row" onClick={onClick} disabled={disabled}>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>{label}</span>
        {detail && <span className="vx-small vx-2">{detail}</span>}
      </span>
      <span className="vx-chev"><Icon name="chevron" size={18} /></span>
    </button>
  );
}
