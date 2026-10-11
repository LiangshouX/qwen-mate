import { defineConfig } from 'vitepress'

const repoLink = 'https://github.com/LiangshouX/qwen-mate'

// Per-locale theme options must live in top-level locales[key].themeConfig.
// The default theme reads siteData.locales[locale].themeConfig — placing nav/
// sidebar under themeConfig.locales is never read and silently renders nothing.

const zhNav = [
  { text: '安装', link: '/guide/installation' },
  { text: '快速上手', link: '/guide/getting-started' },
  { text: '设置参考', link: '/guide/settings' },
  { text: 'FAQ', link: '/guide/faq' },
  { text: '迭代计划', link: '/guide/roadmap' }
]

const enNav = [
  { text: 'Installation', link: '/en/guide/installation' },
  { text: 'Getting Started', link: '/en/guide/getting-started' },
  { text: 'Settings', link: '/en/guide/settings' },
  { text: 'FAQ', link: '/en/guide/faq' },
  { text: 'Roadmap', link: '/en/guide/roadmap' }
]

const zhSidebar = [
  {
    text: '入门指南',
    items: [
      { text: '安装指南', link: '/guide/installation' },
      { text: '快速上手', link: '/guide/getting-started' }
    ]
  },
  {
    text: '参考',
    items: [
      { text: '设置与配置参考', link: '/guide/settings' },
      { text: 'FAQ 与故障排查', link: '/guide/faq' }
    ]
  },
  {
    text: '关于',
    items: [{ text: '迭代计划与技术说明', link: '/guide/roadmap' }]
  }
]

const enSidebar = [
  {
    text: 'Guide',
    items: [
      { text: 'Installation', link: '/en/guide/installation' },
      { text: 'Getting Started', link: '/en/guide/getting-started' }
    ]
  },
  {
    text: 'Reference',
    items: [
      { text: 'Settings Reference', link: '/en/guide/settings' },
      { text: 'FAQ & Troubleshooting', link: '/en/guide/faq' }
    ]
  },
  {
    text: 'About',
    items: [{ text: 'Roadmap & Technical Notes', link: '/en/guide/roadmap' }]
  }
]

const zhThemeConfig = {
  nav: zhNav,
  sidebar: zhSidebar,
  outline: { level: [2, 3], label: '本页目录' },
  editLink: {
    pattern: `${repoLink}/edit/main/docs-site/:path`,
    text: '在 GitHub 上编辑此页'
  },
  footer: {
    message: 'QwenMate 为社区项目，与阿里云、JetBrains 无隶属或背书关系。MIT License。',
    copyright: 'Copyright © LiangshouX'
  },
  docFooter: { prev: '上一页', next: '下一页' },
  lastUpdated: { text: '最后更新' },
  returnToTopLabel: '回到顶部',
  sidebarMenuLabel: '菜单',
  darkModeSwitchLabel: '主题',
  lightModeSwitchTitle: '切换到浅色模式',
  darkModeSwitchTitle: '切换到深色模式'
}

const enThemeConfig = {
  nav: enNav,
  sidebar: enSidebar,
  outline: { level: [2, 3], label: 'On this page' },
  editLink: {
    pattern: `${repoLink}/edit/main/docs-site/:path`,
    text: 'Edit this page on GitHub'
  },
  footer: {
    message: 'QwenMate is a community project, not affiliated with or endorsed by Alibaba Cloud or JetBrains. MIT License.',
    copyright: 'Copyright © LiangshouX'
  },
  docFooter: { prev: 'Previous page', next: 'Next page' },
  lastUpdated: { text: 'Last updated' },
  returnToTopLabel: 'Back to top',
  sidebarMenuLabel: 'Menu',
  darkModeSwitchLabel: 'Appearance',
  lightModeSwitchTitle: 'Switch to light mode',
  darkModeSwitchTitle: 'Switch to dark mode'
}

export default defineConfig({
  title: 'QwenMate',
  description: 'QwenMate 帮助文档 — Qwen Code 可视化 GUI，JetBrains IDE 插件',
  base: '/qwen-mate/',
  lang: 'zh-CN',
  lastUpdated: true,
  cleanUrls: true,
  sitemap: { hostname: 'https://liangshoux.github.io/qwen-mate/' },

  head: [
    ['meta', { name: 'keywords', content: 'QwenMate, Qwen Code, JetBrains, IDE 插件, AI 编程' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/qwen-mate/favicon.svg' }]
  ],

  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      themeConfig: zhThemeConfig
    },
    en: {
      label: 'English',
      lang: 'en-US',
      description: 'QwenMate help documentation — a visual GUI for Qwen Code, the JetBrains IDE plugin.',
      themeConfig: enThemeConfig
    }
  },

  themeConfig: {
    logo: '/logo.svg',
    socialLinks: [{ icon: 'github', link: repoLink }],
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' }
        },
        locales: {
          en: {
            translations: {
              button: { buttonText: 'Search', buttonAriaLabel: 'Search' }
            }
          }
        }
      }
    }
  }
})
