/**
 * Border Radius Design Tokens
 * Consistent border radius scale for rounded corners
 */

export const radii = {
  // Base radius scale
  none: '0',
  sm: '0.25rem',      // 4px
  DEFAULT: '0.375rem', // 6px
  md: '0.5rem',       // 8px
  lg: '0.75rem',      // 12px
  xl: '1rem',         // 16px
  '2xl': '1.5rem',    // 24px
  '3xl': '2rem',      // 32px
  full: '9999px',     // Fully rounded (pills, circles)
} as const;

// Semantic radius aliases
export const radiusAliases = {
  // Components
  button: radii.xl,           // 16px - default button radius
  buttonSm: radii.lg,         // 12px - small button radius
  buttonLg: radii['2xl'],     // 24px - large button radius
  buttonPill: radii.full,     // Pill-shaped buttons

  // Inputs
  input: radii.xl,            // 16px - default input radius
  inputSm: radii.lg,          // 12px - small input radius

  // Cards
  card: radii['3xl'],         // 32px - default card radius (liquid glass style)
  cardSm: radii['2xl'],       // 24px - smaller cards
  cardLg: radii['3xl'],       // 32px - large cards

  // Modals & Sheets
  modal: radii['3xl'],        // 32px - modal corners
  sheet: radii['3xl'],        // 32px - bottom sheet top corners

  // Avatars
  avatar: radii.full,         // Circular avatars
  avatarSquare: radii.xl,     // Square avatars with rounded corners

  // Badges
  badge: radii.full,          // Pill-shaped badges
  badgeSquare: radii.md,      // Square badges

  // Tabs
  tab: radii.xl,              // 16px - tab radius
  tabContainer: radii['2xl'], // 24px - tab container radius

  // Messages
  messageSent: radii['2xl'],      // 24px - sent message bubble
  messageReceived: radii['2xl'],  // 24px - received message bubble
  messageTail: radii.md,          // 8px - message tail corner

  // Images
  image: radii.xl,            // 16px - default image radius
  imageLg: radii['2xl'],      // 24px - large image radius
  thumbnail: radii.lg,        // 12px - thumbnail radius

  // Tooltips & Popovers
  tooltip: radii.lg,          // 12px
  popover: radii.xl,          // 16px
  dropdown: radii.xl,         // 16px

  // Progress & Sliders
  progress: radii.full,       // Fully rounded progress bars
  slider: radii.full,         // Fully rounded slider tracks
} as const;

// Type exports
export type RadiusToken = keyof typeof radii;
export type RadiusAlias = keyof typeof radiusAliases;
