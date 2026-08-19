/**
 * The COS theme.
 *
 * Direction: friendly restraint over a Notion-like working surface. A rich
 * navy carries every primary action, the page sits on a cool paper ground
 * rather than pure white, and corners are a touch softer than the Astryx
 * default so dense calendar cells still read as tappable objects.
 *
 * Only the accent seed and a handful of ground tones are set here. Astryx
 * derives the rest through its HCT colour model, and the categorical hues
 * (used for event categories) are deliberately left at their defaults so they
 * stay distinguishable from the navy chrome.
 *
 * This is a starting point, not a brand guide - see docs/OPEN-QUESTIONS.md,
 * the product name and visual identity are both still open.
 */

import {defineTheme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral';

/** Rich navy. Carries primary actions and selected nav state. */
const NAVY = '#1B3B6F';

export const cosTheme = defineTheme({
  name: 'cos',
  extends: neutralTheme,

  color: {
    accent: NAVY,
    // Let the navy hue bleed into the neutrals so greys read blue-cool
    // rather than dead grey next to the accent.
    neutralStyle: 'cool',
    contrast: 'standard',
  },

  // DM Sans over the system stack: a humanist grotesque with a taller
  // x-height and rounder terminals, which reads as considerably friendlier
  // than SF Pro/Segoe UI on the dense surfaces this product is mostly made
  // of (calendar cells, tables, forms). Loaded via next/font/google in
  // app/layout.tsx, which self-hosts it and exposes it as this CSS variable
  // - the fallback stack is what renders in the gap before it loads.
  typography: {
    scale: {base: 15, ratio: 1.2},
    body: {
      family: 'var(--font-dm-sans)',
      fallbacks:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    },
    heading: {weight: 'semibold'},
    code: {
      family: 'ui-monospace',
      fallbacks: '"SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
    },
  },

  // Slightly softer than default; Apple leans rounder than Astryx's 4dp base.
  radius: {base: 4, multiplier: 1.25},

  // Quick but not instant. Calendar interactions should feel immediate.
  motion: {fast: 140, medium: 320, ratio: 0.75},

  tokens: {
    // A cool paper ground. Pure white pages lose the sense of a surface
    // floating above a workspace, which the calendar grid depends on.
    '--color-background-body': ['#F4F6FA', '#0E1116'],
    // Warm amber as the contrasting secondary: used only for "today" and
    // other orientation markers, never for an action.
    '--color-warning': ['#B7791F', '#E8B341'],
  },

  components: {
    // Navy primary buttons read better with slightly heavier text.
    button: {
      base: {fontWeight: '590'},
    },
    // Tighten heading letterspacing; the system stack is a little loose at
    // display sizes.
    heading: {
      base: {letterSpacing: '-0.014em'},
    },
  },
});

export default cosTheme;
