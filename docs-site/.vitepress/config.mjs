// VitePress config for CAP Pro documentation site.
// Build: npm run docs:build  →  output in docs-site/.vitepress/dist/
// Dev:   npm run docs:dev    →  http://localhost:5173

export default {
  lang: 'en-US',
  title: 'CAP Pro',
  description: 'Code-First engineering framework for AI-assisted coding. Build first. Plan from code.',

  // Deployed via GitHub Pages at https://dwall-sys.github.io/code-as-plan/
  base: '/code-as-plan/',

  cleanUrls: true,
  lastUpdated: true,

  head: [
    ['link', { rel: 'icon', href: '/code-as-plan/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#7c3aed' }],
  ],

  themeConfig: {
    logo: { src: '/logo.svg', alt: 'CAP Pro' },
    siteTitle: 'CAP Pro',

    nav: [
      { text: 'Guide', link: '/guide/what-is-cap-pro', activeMatch: '/guide/' },
      { text: 'Features', link: '/features/code-first', activeMatch: '/features/' },
      { text: 'Best Practices', link: '/best-practices/prototype-driven', activeMatch: '/best-practices/' },
      { text: 'Reference', link: '/reference/commands', activeMatch: '/reference/' },
      { text: 'Roadmap', link: '/roadmap' },
      {
        text: 'v1.0.0',
        items: [
          { text: 'Changelog', link: 'https://github.com/dwall-sys/code-as-plan/blob/main/CHANGELOG.md' },
          { text: 'npm', link: 'https://www.npmjs.com/package/cap-pro' },
          { text: 'GitHub', link: 'https://github.com/dwall-sys/code-as-plan' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'What is CAP Pro?', link: '/guide/what-is-cap-pro' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Quick Start', link: '/guide/quick-start' },
            { text: 'The 5-Step Workflow', link: '/guide/workflow' },
            { text: 'Migrating from code-as-plan@7.x', link: '/guide/migrating' },
          ],
        },
      ],
      '/features/': [
        {
          text: 'Core Concepts',
          items: [
            { text: 'Code-First Principle', link: '/features/code-first' },
            { text: 'Feature Map', link: '/features/feature-map' },
            { text: 'Tag System', link: '/features/tag-system' },
            { text: 'The 9 Agents', link: '/features/agents' },
            { text: 'Slash Commands', link: '/features/commands' },
            { text: 'Project Memory', link: '/features/memory' },
            { text: 'Multi-User Workflow', link: '/features/multi-user' },
            { text: 'Multi-Runtime Support', link: '/features/multi-runtime' },
          ],
        },
      ],
      '/best-practices/': [
        {
          text: 'Best Practices',
          items: [
            { text: 'Prototype-Driven Development', link: '/best-practices/prototype-driven' },
            { text: 'Test-First Discipline', link: '/best-practices/test-first' },
            { text: 'Frontend Sprint Pattern', link: '/best-practices/frontend-sprint' },
            { text: 'Anti-Patterns', link: '/best-practices/anti-patterns' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'All Commands', link: '/reference/commands' },
            { text: 'All Agents', link: '/reference/agents' },
            { text: 'All Tags', link: '/reference/tags' },
            { text: 'Configuration', link: '/reference/configuration' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/dwall-sys/code-as-plan' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/cap-pro' },
    ],

    editLink: {
      pattern: 'https://github.com/dwall-sys/code-as-plan/edit/main/docs-site/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: '© 2026 TÂCHES — CAP Pro',
    },

    search: { provider: 'local' },
  },
}
