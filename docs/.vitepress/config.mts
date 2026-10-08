import { defineConfig } from 'vitepress'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(docsRoot, '..')
const repository = 'https://github.com/bigtongue5566/ordivant'
const base = process.env.DOCS_BASE ?? '/ordivant/'

export default defineConfig({
  lang: 'zh-Hant', title: 'Ordivant',
  description: '開源、自行部署的 Agent 協作平台：Work、Knowledge、Code。',
  base, cleanUrls: false, lastUpdated: true,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }]],
  sitemap: { hostname: 'https://bigtongue5566.github.io/ordivant/' },
  themeConfig: {
    logo: '/logo.svg', siteTitle: 'Ordivant',
    nav: [
      { text: '開始使用', link: '/guide/getting-started' },
      { text: '部署', link: '/containers' },
      { text: '架構與 API', link: '/reference' },
      { text: 'v0.1.0', link: '/release' },
    ],
    sidebar: [
      { text: '開始', items: [
        { text: '專案介紹', link: '/overview' },
        { text: '安裝與第一次執行', link: '/guide/getting-started' },
        { text: '版本與已知限制', link: '/release' },
      ] },
      { text: '操作指南', items: [
        { text: 'Work 任務與協作', link: '/guide/work' },
        { text: 'Run、範本與自動化', link: '/execution-usage' },
        { text: 'Knowledge 文件與引用', link: '/guide/knowledge' },
        { text: 'Code 與版控', link: '/guide/code' },
        { text: '模型設定', link: '/model-usage' },
        { text: '帳號與登入', link: '/human-login' },
      ] },
      { text: '管理與部署', items: [
        { text: '權限與組織管理', link: '/guide/administration' },
        { text: '企業 SSO', link: '/enterprise-sso' },
        { text: 'Docker 開發／部署', link: '/containers' },
        { text: '備份與維運', link: '/guide/operations' },
        { text: '問題排查', link: '/guide/troubleshooting' },
      ] },
      { text: '開發與驗證', items: [
        { text: '架構與 API 索引', link: '/reference' },
        { text: '驗收紀錄', link: '/validation' },
        { text: '執行功能驗收', link: '/execution-validation' },
        { text: '路線圖', link: '/roadmap' },
        { text: '參與貢獻', link: `${repository}/blob/main/CONTRIBUTING.md` },
        { text: '安全政策', link: `${repository}/blob/main/SECURITY.md` },
      ] },
    ],
    socialLinks: [{ icon: 'github', link: repository }],
    search: { provider: 'local', options: { locales: { root: { translations: {
      button: { buttonText: '搜尋文件', buttonAriaLabel: '搜尋文件' },
      modal: { noResultsText: '找不到相關文件', resetButtonTitle: '清除搜尋',
        footer: { selectText: '選取', navigateText: '切換', closeText: '關閉' } },
    } } } } },
    outline: { label: '本頁內容', level: [2, 3] },
    docFooter: { prev: '上一頁', next: '下一頁' },
    lastUpdated: { text: '最後更新' },
    editLink: { pattern: `${repository}/edit/main/docs/:path`, text: '在 GitHub 改善這一頁' },
    footer: { message: '以 MIT 授權釋出 · 自行部署 · 繁體中文介面', copyright: '© 2026 Ordivant contributors' },
  },
  markdown: {
    config(md) {
      // Source links stay useful both in GitHub Markdown and in the published site.
      md.core.ruler.after('inline', 'repository-source-links', (state) => {
        const source = state.env.path ?? state.env.filePath
        if (!source) return
        const visit = (tokens: any[]) => tokens.forEach(token => {
          if (token.type === 'link_open') {
            const href = token.attrGet('href')
            if (href && !/^(?:[a-z]+:|\/|#)/i.test(href)) {
              const [pathname, anchor] = href.split('#')
              const target = path.resolve(path.dirname(source), decodeURIComponent(pathname))
              if (fs.existsSync(target) && !target.startsWith(docsRoot + path.sep)) {
                const relative = path.relative(repoRoot, target).split(path.sep).join('/')
                if (!relative.startsWith('..')) token.attrSet('href', `${repository}/blob/main/${relative}${anchor ? '#' + anchor : ''}`)
              }
            }
          }
          if (token.children) visit(token.children)
        })
        visit(state.tokens)
      })
    },
  },
})
