/**
 * Spacing Design Tokens
 * Consistent spacing scale for margins, paddings, and gaps
 */

export const spacing = {
  // Base spacing scale (in pixels, applied as rem)
  px: '1px',
  0: '0',
  0.5: '0.125rem',  // 2px
  1: '0.25rem',     // 4px
  1.5: '0.375rem',  // 6px
  2: '0.5rem',      // 8px
  2.5: '0.625rem',  // 10px
  3: '0.75rem',     // 12px
  3.5: '0.875rem',  // 14px
  4: '1rem',        // 16px
  5: '1.25rem',     // 20px
  6: '1.5rem',      // 24px
  7: '1.75rem',     // 28px
  8: '2rem',        // 32px
  9: '2.25rem',     // 36px
  10: '2.5rem',     // 40px
  11: '2.75rem',    // 44px
  12: '3rem',       // 48px
  14: '3.5rem',     // 56px
  16: '4rem',       // 64px
  20: '5rem',       // 80px
  24: '6rem',       // 96px
  28: '7rem',       // 112px
  32: '8rem',       // 128px
  36: '9rem',       // 144px
  40: '10rem',      // 160px
  44: '11rem',      // 176px
  48: '12rem',      // 192px
  52: '13rem',      // 208px
  56: '14rem',      // 224px
  60: '15rem',      // 240px
  64: '16rem',      // 256px
  72: '18rem',      // 288px
  80: '20rem',      // 320px
  96: '24rem',      // 384px
} as const;

// Semantic spacing aliases
export const spacingAliases = {
  // Component internal spacing
  componentXs: spacing[1],    // 4px - tight internal padding
  componentSm: spacing[2],    // 8px - small internal padding
  componentMd: spacing[4],    // 16px - default internal padding
  componentLg: spacing[6],    // 24px - large internal padding
  componentXl: spacing[8],    // 32px - extra large internal padding

  // Layout spacing
  layoutXs: spacing[2],       // 8px
  layoutSm: spacing[4],       // 16px
  layoutMd: spacing[6],       // 24px
  layoutLg: spacing[8],       // 32px
  layoutXl: spacing[12],      // 48px
  layout2xl: spacing[16],     // 64px

  // Page margins
  pagePaddingX: spacing[4],   // 16px horizontal page padding
  pagePaddingY: spacing[6],   // 24px vertical page padding

  // Card spacing
  cardPadding: spacing[6],    // 24px default card padding
  cardGap: spacing[4],        // 16px gap between card items

  // Form spacing
  formGap: spacing[4],        // 16px gap between form fields
  inputPaddingX: spacing[4],  // 16px horizontal input padding
  inputPaddingY: spacing[3],  // 12px vertical input padding

  // Button spacing
  buttonPaddingXSm: spacing[3],   // 12px
  buttonPaddingXMd: spacing[4],   // 16px
  buttonPaddingXLg: spacing[6],   // 24px
  buttonPaddingYSm: spacing[2],   // 8px
  buttonPaddingYMd: spacing[3],   // 12px
  buttonPaddingYLg: spacing[4],   // 16px

  // List spacing
  listItemGap: spacing[2],    // 8px gap between list items
  listItemPadding: spacing[4], // 16px list item padding

  // Modal spacing
  modalPadding: spacing[6],   // 24px modal padding
  modalGap: spacing[4],       // 16px gap in modal content

  // Safe areas (for mobile)
  safeAreaTop: 'env(safe-area-inset-top)',
  safeAreaBottom: 'env(safe-area-inset-bottom)',
  safeAreaLeft: 'env(safe-area-inset-left)',
  safeAreaRight: 'env(safe-area-inset-right)',
} as const;

// Type exports
export type SpacingToken = keyof typeof spacing;
export type SpacingAlias = keyof typeof spacingAliases;
