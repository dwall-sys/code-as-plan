// @cap-context CAP F-062 DESIGN.md engine -- deterministic aesthetic picker + idempotent DESIGN.md writer.
// @cap-decision DESIGN.md is a single markdown file at project root next to FEATURE-MAP.md. Zero-deps, diffable, inspectable.
// @cap-decision v1 does NOT introduce DT-NNN / DC-NNN IDs. The DESIGN.md format is designed so F-063 can additively attach stable IDs without breaking v1 structure.
// @cap-decision Idempotence guaranteed by pinning all tokens per aesthetic family in a lookup table and emitting NO timestamps, NO LLM-generated flavor text.
// @cap-constraint Zero external dependencies -- Node.js built-ins only (fs, path).

'use strict';

// @cap-feature(feature:F-062) cap:design Core — DESIGN.md + Aesthetic Picker

const fs = require('node:fs');
const path = require('node:path');

const DESIGN_FILE = 'DESIGN.md';

/**
 * @typedef {Object} ColorTokens
 * @property {string} primary
 * @property {string} secondary
 * @property {string} background
 * @property {string} surface
 * @property {string} text
 * @property {string} muted
 * @property {string} accent
 */

/**
 * @typedef {Object} TypographyTokens
 * @property {string} family
 * @property {string} familyMono
 * @property {number[]} scale
 */

/**
 * @typedef {Object} AestheticFamily
 * @property {string} key
 * @property {string} name
 * @property {string[]} referenceBrands
 * @property {ColorTokens} colors
 * @property {number[]} spacing
 * @property {TypographyTokens} typography
 * @property {Object<string, { variants: string[], states: string[] }>} components
 */

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

// @cap-api mapAnswersToFamily(readHeavy, userType, courageFactor) -- Deterministic wizard-answer lookup.
// @cap-todo(ac:F-062/AC-2) Maps the 3 wizard answers to exactly one of the 9 aesthetic families.
// @cap-todo(ac:F-062/AC-7) Must return byte-identical result on repeated calls with same input.
/**
 * @param {string} readHeavy - 'read-heavy' | 'scan-heavy'
 * @param {string} userType - 'consumer' | 'professional' | 'developer'
 * @param {string} courageFactor - 'safe' | 'balanced' | 'bold'
 * @returns {AestheticFamily} The resolved family object (from AESTHETIC_FAMILIES lookup).
 * @throws {Error} If any answer is not in the valid set.
 */
function mapAnswersToFamily(readHeavy, userType, courageFactor) {
  if (!VALID_READ_HEAVY.includes(readHeavy)) {
    throw new Error(`Invalid readHeavy: ${readHeavy}. Expected one of ${VALID_READ_HEAVY.join(', ')}`);
  }
  if (!VALID_USER_TYPES.includes(userType)) {
    throw new Error(`Invalid userType: ${userType}. Expected one of ${VALID_USER_TYPES.join(', ')}`);
  }
  if (!VALID_COURAGE.includes(courageFactor)) {
    throw new Error(`Invalid courageFactor: ${courageFactor}. Expected one of ${VALID_COURAGE.join(', ')}`);
  }

  const key = `${readHeavy}|${userType}|${courageFactor}`;
  const familyKey = FAMILY_MAP[key];
  // @cap-risk If FAMILY_MAP becomes incomplete, this throws -- fail loud rather than returning default silently.
  if (!familyKey) {
    throw new Error(`No family mapping for key: ${key}`);
  }
  return AESTHETIC_FAMILIES[familyKey];
}

// @cap-api buildDesignMd({family, extras}) -- Returns DESIGN.md content string (idempotent).
// @cap-todo(ac:F-062/AC-3) Output contains: Aesthetic Family, Tokens (colors/spacing/typography), Components (Button + Card), Anti-Patterns.
// @cap-todo(ac:F-062/AC-6) Anti-Patterns block rendered from ANTI_SLOP_RULES.
// @cap-todo(ac:F-062/AC-7) No timestamps, no randomness -- same input -> byte-identical output.
// @cap-decision F-063 hook: tokens/components are written in a stable ordered list form so F-063 can append `id: DT-NNN` / `id: DC-NNN` inline without breaking the v1 parser.
/**
 * @param {{ family: AestheticFamily, extras?: Object }} input
 * @returns {string} Full DESIGN.md content.
 */
function buildDesignMd(input) {
  if (!input || !input.family) {
    throw new Error('buildDesignMd requires { family } input');
  }
  const fam = input.family;
  const lines = [];

  lines.push('# DESIGN.md');
  lines.push('');
  lines.push('> Single source of truth for design identity, tokens, components, and anti-patterns.');
  lines.push('> Written by /cap:design. Diff this file in git alongside FEATURE-MAP.md.');
  lines.push('');

  // Aesthetic Family
  lines.push(`## Aesthetic Family: ${fam.name}`);
  lines.push('');
  lines.push(`Key: \`${fam.key}\``);
  lines.push('');
  lines.push(`Reference brands: ${fam.referenceBrands.join(', ')}`);
  lines.push('');

  // Tokens
  lines.push('## Tokens');
  lines.push('');
  lines.push('### Colors');
  lines.push('');
  // Stable key order -- sorted alphabetically for determinism.
  const colorKeys = Object.keys(fam.colors).sort();
  for (const k of colorKeys) {
    lines.push(`- ${k}: ${fam.colors[k]}`);
  }
  lines.push('');

  lines.push('### Spacing');
  lines.push('');
  lines.push(`- scale: [${fam.spacing.join(', ')}]`);
  lines.push('');

  lines.push('### Typography');
  lines.push('');
  lines.push(`- family: "${fam.typography.family}"`);
  lines.push(`- familyMono: "${fam.typography.familyMono}"`);
  lines.push(`- scale: [${fam.typography.scale.join(', ')}]`);
  lines.push('');

  // Components
  lines.push('## Components');
  lines.push('');
  const compKeys = Object.keys(fam.components).sort();
  for (const compName of compKeys) {
    const comp = fam.components[compName];
    lines.push(`### ${compName}`);
    lines.push('');
    lines.push(`- variants: [${comp.variants.join(', ')}]`);
    lines.push(`- states: [${comp.states.join(', ')}]`);
    lines.push('');
  }

  // Anti-Patterns
  lines.push('## Anti-Patterns');
  lines.push('');
  lines.push('Hard constraints enforced by cap-designer. Violating entries will be rejected during /cap:design --extend.');
  lines.push('');
  for (const rule of ANTI_SLOP_RULES) {
    lines.push(`- ${rule}`);
  }
  lines.push('');

  return lines.join('\n');
}

// @cap-api readDesignMd(projectRoot) -- Read DESIGN.md from project root.
/**
 * @param {string} projectRoot - Absolute path to project root.
 * @returns {string|null} File contents, or null if the file does not exist.
 */
function readDesignMd(projectRoot) {
  const filePath = path.join(projectRoot, DESIGN_FILE);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

// @cap-api writeDesignMd(projectRoot, content) -- Write DESIGN.md to project root.
// @cap-todo(ac:F-062/AC-4) DESIGN.md lies at project root next to FEATURE-MAP.md and is versioned via git (no gitignore).
/**
 * @param {string} projectRoot - Absolute path to project root.
 * @param {string} content - Full DESIGN.md content.
 */
function writeDesignMd(projectRoot, content) {
  const filePath = path.join(projectRoot, DESIGN_FILE);
  fs.writeFileSync(filePath, content, 'utf8');
}

// @cap-api extendDesignMd(existing, additions) -- Append-only merge for /cap:design --extend.
// @cap-todo(ac:F-062/AC-5) Adds new tokens/components to existing DESIGN.md without overwriting existing entries.
// @cap-decision Line-scan merge instead of markdown parsing -- keeps zero-deps and preserves author edits in unrelated sections.
/**
 * @param {string} existing - Current DESIGN.md content.
 * @param {{ colors?: Object<string,string>, components?: Object<string, { variants: string[], states: string[] }> }} additions
 * @returns {string} Updated DESIGN.md content. Existing token/component entries are preserved verbatim.
 */
function extendDesignMd(existing, additions) {
  if (typeof existing !== 'string') {
    throw new Error('extendDesignMd requires existing content string');
  }
  const adds = additions || {};
  const lines = existing.split('\n');

  // --- Merge colors (append new keys under ### Colors, skip duplicates) ---
  if (adds.colors && Object.keys(adds.colors).length > 0) {
    const colorsIdx = lines.findIndex(l => l.trim() === '### Colors');
    if (colorsIdx !== -1) {
      // Find end of the Colors block (next blank line after the list)
      let insertAt = colorsIdx + 1;
      const existingColorKeys = new Set();
      // Skip the blank line after the header
      while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;
      // Walk the bullet list
      while (insertAt < lines.length && lines[insertAt].startsWith('- ')) {
        const match = lines[insertAt].match(/^-\s+([^:]+):/);
        if (match) existingColorKeys.add(match[1].trim());
        insertAt++;
      }
      // @cap-todo(ac:F-062/AC-5) Only append keys not already present -- preserves existing entries.
      const newLines = [];
      const newColorKeys = Object.keys(adds.colors).sort();
      for (const k of newColorKeys) {
        if (!existingColorKeys.has(k)) {
          newLines.push(`- ${k}: ${adds.colors[k]}`);
        }
      }
      if (newLines.length > 0) {
        lines.splice(insertAt, 0, ...newLines);
      }
    }
  }

  // --- Merge components (append new component sections under ## Components, skip duplicates) ---
  if (adds.components && Object.keys(adds.components).length > 0) {
    const compHdrIdx = lines.findIndex(l => l.trim() === '## Components');
    if (compHdrIdx !== -1) {
      // Find end of Components section (next "## " header or EOF)
      let sectionEnd = compHdrIdx + 1;
      while (sectionEnd < lines.length && !lines[sectionEnd].startsWith('## ')) {
        sectionEnd++;
      }
      // Collect existing component names (### Foo)
      const existingCompNames = new Set();
      for (let i = compHdrIdx + 1; i < sectionEnd; i++) {
        const m = lines[i].match(/^###\s+(\S+)/);
        if (m) existingCompNames.add(m[1]);
      }
      // @cap-todo(ac:F-062/AC-5) Only append components not already present.
      const newCompNames = Object.keys(adds.components).sort();
      const insertion = [];
      for (const name of newCompNames) {
        if (existingCompNames.has(name)) continue;
        const comp = adds.components[name];
        insertion.push(`### ${name}`);
        insertion.push('');
        insertion.push(`- variants: [${(comp.variants || []).join(', ')}]`);
        insertion.push(`- states: [${(comp.states || []).join(', ')}]`);
        insertion.push('');
      }
      if (insertion.length > 0) {
        lines.splice(sectionEnd, 0, ...insertion);
      }
    }
  }

  return lines.join('\n');
}

module.exports = {
  DESIGN_FILE,
  AESTHETIC_FAMILIES,
  ANTI_SLOP_RULES,
  FAMILY_MAP,
  VALID_READ_HEAVY,
  VALID_USER_TYPES,
  VALID_COURAGE,
  mapAnswersToFamily,
  buildDesignMd,
  readDesignMd,
  writeDesignMd,
  extendDesignMd,
};
