// @cap-context CAP F-064 extraction — pinned aesthetic families, wizard-map, and anti-slop rule strings.
// @cap-decision(F-064) Extracted from cap-design.cjs once that file crossed 40KB. Pure data module, zero-deps,
//                      re-exported verbatim by cap-design.cjs so the public API surface is unchanged.
// @cap-constraint Zero external dependencies -- Node.js built-ins only (none needed here).

'use strict';

// @cap-feature(feature:F-062) cap:design Core — Aesthetic family data
// @cap-feature(feature:F-064) cap:design --review — Anti-Slop rule strings live here so rules + DESIGN.md output share one source

// @cap-todo(ac:F-062/AC-6) Anti-Slop constraint block -- surfaced in both agent prompt and DESIGN.md output.
// @cap-decision Anti-Slop rules pinned as constants so agent and writer share the same source of truth.
const ANTI_SLOP_RULES = Object.freeze([
  'No generic fonts: Inter, Roboto, Arial, Helvetica, SF Pro are forbidden as primary display typefaces.',
  'No cliche gradients: linear-gradient(to right, #667eea, #764ba2) and similar purple-blue combos are forbidden.',
  'No cookie-cutter layouts: centered hero + 3-column feature cards + CTA is a banned template.',
]);

// @cap-todo(ac:F-062/AC-2) Nine Aesthetic Families lookup -- pinned tokens for determinism (AC-7).
// @cap-decision Canonical Button + Card components specified per family so buildDesignMd satisfies AC-3 minimum.
const AESTHETIC_FAMILIES = Object.freeze({
  'editorial-minimalism': Object.freeze({
    key: 'editorial-minimalism',
    name: 'Editorial Minimalism',
    referenceBrands: ['Linear', 'Vercel', 'Stripe'],
    colors: Object.freeze({
      primary: '#111111',
      secondary: '#555555',
      background: '#FAFAFA',
      surface: '#FFFFFF',
      text: '#0A0A0A',
      muted: '#888888',
      accent: '#2B6CB0',
    }),
    spacing: Object.freeze([4, 8, 16, 24, 40, 64]),
    typography: Object.freeze({
      family: 'Söhne, Neue Haas Grotesk',
      familyMono: 'Söhne Mono, JetBrains Mono',
      scale: Object.freeze([12, 14, 16, 20, 28, 40]),
    }),
    components: Object.freeze({
      Button: Object.freeze({
        variants: Object.freeze(['primary', 'secondary', 'ghost']),
        states: Object.freeze(['default', 'hover', 'active', 'disabled']),
      }),
      Card: Object.freeze({
        variants: Object.freeze(['plain', 'outlined']),
        states: Object.freeze(['default', 'hover']),
      }),
    }),
  }),
  'terminal-core': Object.freeze({
    key: 'terminal-core',
    name: 'Terminal-Core',
    referenceBrands: ['Warp', 'Ghostty', 'Fly.io'],
    colors: Object.freeze({
      primary: '#00FF9C',
      secondary: '#2E7D5B',
      background: '#0B0F0D',
      surface: '#111614',
      text: '#D7FFE6',
      muted: '#6B8A7A',
      accent: '#FFB020',
    }),
    spacing: Object.freeze([4, 8, 16, 24, 32]),
    typography: Object.freeze({
      family: 'Berkeley Mono, iA Writer Quattro',
      familyMono: 'Berkeley Mono, JetBrains Mono',
      scale: Object.freeze([12, 14, 16, 20, 24, 32]),
    }),
    components: Object.freeze({
      Button: Object.freeze({
        variants: Object.freeze(['primary', 'ghost', 'danger']),
        states: Object.freeze(['default', 'hover', 'active', 'disabled']),
      }),
      Card: Object.freeze({
        variants: Object.freeze(['framed', 'ascii-bordered']),
        states: Object.freeze(['default', 'focus']),
      }),
    }),
  }),
  'warm-editorial': Object.freeze({
    key: 'warm-editorial',
    name: 'Warm Editorial',
    referenceBrands: ['Are.na', 'Ghost', 'Substack Reader'],
    colors: Object.freeze({
      primary: '#6B4423',
      secondary: '#8B5A3C',
      background: '#F5EFE6',
      surface: '#FFFAF0',
      text: '#2D1F15',
      muted: '#9C8A78',
      accent: '#B85C38',
    }),
    spacing: Object.freeze([4, 8, 16, 24, 40, 72]),
    typography: Object.freeze({
      family: 'GT Super, Tiempos Text',
      familyMono: 'GT America Mono',
      scale: Object.freeze([14, 16, 18, 22, 32, 48]),
    }),
    components: Object.freeze({
      Button: Object.freeze({
        variants: Object.freeze(['primary', 'secondary', 'text']),
        states: Object.freeze(['default', 'hover', 'active', 'disabled']),
      }),
      Card: Object.freeze({
        variants: Object.freeze(['article', 'quote']),
        states: Object.freeze(['default', 'hover']),
      }),
    }),
  }),
  'data-dense-pro': Object.freeze({
    key: 'data-dense-pro',
    name: 'Data-Dense Pro',
    referenceBrands: ['Bloomberg Terminal', 'Retool', 'Grafana'],
    colors: Object.freeze({
      primary: '#1F4E79',
      secondary: '#4A7BAA',
      background: '#0E1117',
      surface: '#161B22',
      text: '#E6EDF3',
      muted: '#7D8590',
      accent: '#F78166',
    }),
    spacing: Object.freeze([2, 4, 8, 12, 16, 24]),
    typography: Object.freeze({
      family: 'Söhne Mono, IBM Plex Sans',
      familyMono: 'IBM Plex Mono',
      scale: Object.freeze([11, 12, 13, 14, 16, 20]),
    }),
    components: Object.freeze({
      Button: Object.freeze({
        variants: Object.freeze(['primary', 'secondary', 'ghost', 'danger']),
        states: Object.freeze(['default', 'hover', 'active', 'disabled', 'loading']),
      }),
      Card: Object.freeze({
        variants: Object.freeze(['metric', 'table-wrapper', 'dense']),
        states: Object.freeze(['default', 'selected']),
      }),
    }),
  }),
  'cinematic-dark': Object.freeze({
    key: 'cinematic-dark',
    name: 'Cinematic Dark',
    referenceBrands: ['Arc Browser', 'Raycast', 'Linear dark'],
    colors: Object.freeze({
      primary: '#8B5CF6',
      secondary: '#5B4BC9',
      background: '#0A0A0F',
      surface: '#13131A',
      text: '#EDEDF2',
      muted: '#6E6E7A',
      accent: '#F59E0B',
    }),
    spacing: Object.freeze([4, 8, 16, 24, 40, 64]),
    typography: Object.freeze({
      family: 'Söhne, Neue Haas Grotesk',
      familyMono: 'Berkeley Mono',
      scale: Object.freeze([12, 14, 16, 20, 28, 44]),
    }),
    components: Object.freeze({
      Button: Object.freeze({
        variants: Object.freeze(['primary', 'glass', 'ghost']),
        states: Object.freeze(['default', 'hover', 'active', 'disabled']),
      }),
      Card: Object.freeze({
        variants: Object.freeze(['elevated', 'flush']),
        states: Object.freeze(['default', 'hover']),
      }),
    }),
  }),
  'playful-color': Object.freeze({
    key: 'playful-color',
    name: 'Playful Color',
    referenceBrands: ['Notion', 'Figma Community', 'Duolingo'],
    colors: Object.freeze({
      primary: '#FF5E5B',
      secondary: '#FFD23F',
      background: '#FFFDF6',
      surface: '#FFFFFF',
      text: '#1B1B1F',
      muted: '#6E6E73',
      accent: '#00CECB',
    }),
    spacing: Object.freeze([4, 8, 16, 24, 40]),
    typography: Object.freeze({
      family: 'GT Walsheim, Söhne Breit',
      familyMono: 'Fira Code',
      scale: Object.freeze([13, 15, 17, 22, 30, 44]),
    }),
    components: Object.freeze({
      Button: Object.freeze({
        variants: Object.freeze(['primary', 'secondary', 'ghost', 'icon']),
        states: Object.freeze(['default', 'hover', 'active', 'disabled']),
      }),
      Card: Object.freeze({
        variants: Object.freeze(['tile', 'sticker', 'highlight']),
        states: Object.freeze(['default', 'hover', 'active']),
      }),
    }),
  }),
  'glass-soft-futurism': Object.freeze({
    key: 'glass-soft-futurism',
    name: 'Glass/Soft-Futurism',
    referenceBrands: ['Apple Vision Pro', 'Spline', 'visionOS patterns'],
    colors: Object.freeze({
      primary: '#A5B4FC',
      secondary: '#C4B5FD',
      background: '#0F172A',
      surface: 'rgba(255,255,255,0.06)',
      text: '#F1F5F9',
      muted: '#94A3B8',
      accent: '#FBBF24',
    }),
    spacing: Object.freeze([4, 8, 16, 24, 40, 56]),
    typography: Object.freeze({
      family: 'SF Pro Display Rounded, Söhne',
      familyMono: 'SF Mono',
      scale: Object.freeze([12, 14, 16, 20, 28, 40]),
    }),
    components: Object.freeze({
      Button: Object.freeze({
        variants: Object.freeze(['glass-primary', 'glass-secondary', 'ghost']),
        states: Object.freeze(['default', 'hover', 'active', 'disabled']),
      }),
      Card: Object.freeze({
        variants: Object.freeze(['glass', 'frosted', 'floating']),
        states: Object.freeze(['default', 'hover']),
      }),
    }),
  }),
  'neon-brutalist': Object.freeze({
    key: 'neon-brutalist',
    name: 'Neon Brutalist',
    referenceBrands: ['Figma Config sites', 'Gumroad', 'Readymag'],
    colors: Object.freeze({
      primary: '#FF00E5',
      secondary: '#00FFD1',
      background: '#FFFF00',
      surface: '#FFFFFF',
      text: '#000000',
      muted: '#333333',
      accent: '#0057FF',
    }),
    spacing: Object.freeze([4, 8, 16, 32, 56]),
    typography: Object.freeze({
      family: 'PP Neue Machina, Söhne Breit',
      familyMono: 'Departure Mono',
      scale: Object.freeze([14, 18, 24, 36, 56, 88]),
    }),
    components: Object.freeze({
      Button: Object.freeze({
        variants: Object.freeze(['slab', 'outline', 'inverse']),
        states: Object.freeze(['default', 'hover', 'active', 'disabled']),
      }),
      Card: Object.freeze({
        variants: Object.freeze(['slab', 'shadowed', 'offset']),
        states: Object.freeze(['default', 'hover']),
      }),
    }),
  }),
  'cult-indie': Object.freeze({
    key: 'cult-indie',
    name: 'Cult/Indie Picks',
    referenceBrands: ['Pitchfork.com', 'Are.na clubs', 'Cortex'],
    colors: Object.freeze({
      primary: '#D62828',
      secondary: '#003049',
      background: '#FDF6E3',
      surface: '#FFFBEA',
      text: '#1A1A1A',
      muted: '#7A6E57',
      accent: '#F77F00',
    }),
    spacing: Object.freeze([4, 8, 12, 20, 36, 60]),
    typography: Object.freeze({
      family: 'PP Editorial New, PP Right Serif',
      familyMono: 'Cartograph CF',
      scale: Object.freeze([13, 15, 18, 24, 36, 56]),
    }),
    components: Object.freeze({
      Button: Object.freeze({
        variants: Object.freeze(['primary', 'underlined', 'mono']),
        states: Object.freeze(['default', 'hover', 'active', 'disabled']),
      }),
      Card: Object.freeze({
        variants: Object.freeze(['zine', 'poster']),
        states: Object.freeze(['default', 'hover']),
      }),
    }),
  }),
});

// @cap-todo(ac:F-062/AC-2) 3-Question Wizard mapping to one of 9 Aesthetic Families.
// @cap-decision Mapping is a pure deterministic lookup (AC-7): same input triplet -> same family, no randomness.
// Answer space: readHeavy ∈ {read-heavy, scan-heavy}, userType ∈ {consumer, professional, developer}, courageFactor ∈ {safe, balanced, bold}.
// 2 * 3 * 3 = 18 cells, each mapped explicitly to one of the 9 families. Avoids fall-through ambiguity.
const FAMILY_MAP = Object.freeze({
  // read-heavy branch — content-first aesthetics
  'read-heavy|consumer|safe': 'warm-editorial',
  'read-heavy|consumer|balanced': 'warm-editorial',
  'read-heavy|consumer|bold': 'cult-indie',
  'read-heavy|professional|safe': 'editorial-minimalism',
  'read-heavy|professional|balanced': 'editorial-minimalism',
  'read-heavy|professional|bold': 'cult-indie',
  'read-heavy|developer|safe': 'editorial-minimalism',
  'read-heavy|developer|balanced': 'terminal-core',
  'read-heavy|developer|bold': 'terminal-core',
  // scan-heavy branch — dense/visual aesthetics
  'scan-heavy|consumer|safe': 'playful-color',
  'scan-heavy|consumer|balanced': 'playful-color',
  'scan-heavy|consumer|bold': 'neon-brutalist',
  'scan-heavy|professional|safe': 'data-dense-pro',
  'scan-heavy|professional|balanced': 'cinematic-dark',
  'scan-heavy|professional|bold': 'glass-soft-futurism',
  'scan-heavy|developer|safe': 'data-dense-pro',
  'scan-heavy|developer|balanced': 'cinematic-dark',
  'scan-heavy|developer|bold': 'neon-brutalist',
});

const VALID_READ_HEAVY = Object.freeze(['read-heavy', 'scan-heavy']);
const VALID_USER_TYPES = Object.freeze(['consumer', 'professional', 'developer']);
const VALID_COURAGE = Object.freeze(['safe', 'balanced', 'bold']);

module.exports = {
  ANTI_SLOP_RULES,
  AESTHETIC_FAMILIES,
  FAMILY_MAP,
  VALID_READ_HEAVY,
  VALID_USER_TYPES,
  VALID_COURAGE,
};
