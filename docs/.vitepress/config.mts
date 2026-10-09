import { defineConfig } from 'vitepress'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(docsRoot, '..')
const repository = 'https://github.com/ordivant-ai/ordivant'
const base = process.env.DOCS_BASE ?? '/'
// Preserve organization project-site bookmarks after moving to the root site.
const legacyProjectRedirect = "if(location.hostname==='ordivant-ai.github.io'&&(location.pathname==='/ordivant'||location.pathname.startsWith('/ordivant/'))){const path=location.pathname.slice('/ordivant'.length)||'/';location.replace('https://ordivant-ai.github.io'+path+location.search+location.hash)}"

const localeTheme = (prefix: string, language: 'zh-Hant' | 'en' | 'zh-Hans') => {
  const isEnglish = language === 'en'
  const isSimplified = language === 'zh-Hans'
  const text = isEnglish ? {
    start: 'Get started', deploy: 'Deploy', architecture: 'Architecture & API',
    startGroup: 'Start here', overview: 'Project overview', install: 'Install and run', release: 'Release and known limits',
    guide: 'User guides', work: 'Work tasks and collaboration', runs: 'Runs, templates and automation',
    knowledge: 'Knowledge and citations', code: 'Code and version control', models: 'Model settings', login: 'Accounts and login',
    admin: 'Administration and deployment', permissions: 'Permissions and organization', sso: 'Enterprise SSO',
    containers: 'Docker development and deployment', ops: 'Backup and operations', troubleshooting: 'Troubleshooting',
    dev: 'Development and validation', reference: 'Architecture and API reference', validation: 'Validation records', i18n: 'Language and translation',
    execValidation: 'Execution validation', roadmap: 'Roadmap', contribute: 'Contributing', security: 'Security policy',
    outline: 'On this page', previous: 'Previous page', next: 'Next page', updated: 'Last updated',
    languageMenu: 'Change language', menu: 'Open navigation menu', appearance: 'Appearance', lightMode: 'Switch to light theme',
    darkMode: 'Switch to dark theme', returnTop: 'Return to top', skipContent: 'Skip to content',
    missing: 'Page not found', missingDescription: 'This page is unavailable. Return to the documentation home page.', home: 'Return home',
    edit: 'Edit this page on GitHub', footer: 'MIT licensed · Self-hosted · English interface',
  } : isSimplified ? {
    start: '开始使用', deploy: '部署', architecture: '架构与 API',
    startGroup: '开始', overview: '项目介绍', install: '安装与首次运行', release: '版本与已知限制',
    guide: '操作指南', work: 'Work 任务与协作', runs: 'Run、模板与自动化',
    knowledge: 'Knowledge 文档与引用', code: 'Code 与版本控制', models: '模型设置', login: '账号与登录',
    admin: '管理与部署', permissions: '权限与组织管理', sso: '企业 SSO',
    containers: 'Docker 开发／部署', ops: '备份与运维', troubleshooting: '问题排查',
    dev: '开发与验证', reference: '架构与 API 索引', validation: '验收记录', i18n: '语言与翻译',
    execValidation: '执行功能验收', roadmap: '路线图', contribute: '参与贡献', security: '安全政策',
    outline: '本页内容', previous: '上一页', next: '下一页', updated: '最后更新',
    languageMenu: '切换语言', menu: '打开导航菜单', appearance: '外观', lightMode: '切换到浅色主题',
    darkMode: '切换到深色主题', returnTop: '返回顶部', skipContent: '跳到正文',
    missing: '找不到页面', missingDescription: '此页面不存在，请返回文档首页。', home: '返回首页',
    edit: '在 GitHub 改进此页', footer: 'MIT 许可 · 自行部署 · 简体中文界面',
  } : {
    start: '開始使用', deploy: '部署', architecture: '架構與 API',
    startGroup: '開始', overview: '專案介紹', install: '安裝與第一次執行', release: '版本與已知限制',
    guide: '操作指南', work: 'Work 任務與協作', runs: 'Run、範本與自動化',
    knowledge: 'Knowledge 文件與引用', code: 'Code 與版控', models: '模型設定', login: '帳號與登入',
    admin: '管理與部署', permissions: '權限與組織管理', sso: '企業 SSO',
    containers: 'Docker 開發／部署', ops: '備份與維運', troubleshooting: '問題排查',
    dev: '開發與驗證', reference: '架構與 API 索引', validation: '驗收紀錄', i18n: '語言與翻譯',
    execValidation: '執行功能驗收', roadmap: '路線圖', contribute: '參與貢獻', security: '安全政策',
    outline: '本頁內容', previous: '上一頁', next: '下一頁', updated: '最後更新',
    languageMenu: '切換語言', menu: '開啟導覽選單', appearance: '外觀', lightMode: '切換為淺色主題',
    darkMode: '切換為深色主題', returnTop: '回到頁首', skipContent: '跳至正文',
    missing: '找不到頁面', missingDescription: '此頁面不存在，請返回文件首頁。', home: '返回首頁',
    edit: '在 GitHub 改善這一頁', footer: '以 MIT 授權釋出 · 自行部署 · 繁體中文介面',
  }
  const route = (path: string) => `${prefix === '/' ? '' : prefix}${path}`
  return {
    nav: [
      { text: text.start, link: route('/guide/getting-started') },
      { text: text.deploy, link: route('/containers') },
      { text: text.architecture, link: route('/reference') },
      { text: 'v0.1.0', link: route('/release') },
    ],
    sidebar: [
      { text: text.startGroup, items: [
        { text: text.overview, link: route('/overview') },
        { text: text.install, link: route('/guide/getting-started') },
        { text: text.release, link: route('/release') },
      ] },
      { text: text.guide, items: [
        { text: text.work, link: route('/guide/work') },
        { text: text.runs, link: route('/execution-usage') },
        { text: text.knowledge, link: route('/guide/knowledge') },
        { text: text.code, link: route('/guide/code') },
        { text: text.models, link: route('/model-usage') },
        { text: text.login, link: route('/human-login') },
      ] },
      { text: text.admin, items: [
        { text: text.permissions, link: route('/guide/administration') },
        { text: text.sso, link: route('/enterprise-sso') },
        { text: text.containers, link: route('/containers') },
        { text: text.ops, link: route('/guide/operations') },
        { text: text.troubleshooting, link: route('/guide/troubleshooting') },
      ] },
      { text: text.dev, items: [
        { text: text.reference, link: route('/reference') },
        { text: text.validation, link: route('/validation') },
        { text: text.execValidation, link: route('/execution-validation') },
        { text: text.i18n, link: route('/i18n') },
        { text: text.roadmap, link: route('/roadmap') },
        { text: text.contribute, link: `${repository}/blob/main/CONTRIBUTING.md` },
        { text: text.security, link: `${repository}/blob/main/SECURITY.md` },
      ] },
    ],
    socialLinks: [{ icon: 'github', link: repository }],
    outline: { label: text.outline, level: [2, 3] },
    notFound: { title: text.missing, quote: text.missingDescription, linkText: text.home, linkLabel: text.home },
    docFooter: { prev: text.previous, next: text.next },
    lastUpdated: { text: text.updated },
    langMenuLabel: text.languageMenu,
    sidebarMenuLabel: text.menu,
    darkModeSwitchLabel: text.appearance,
    lightModeSwitchTitle: text.lightMode,
    darkModeSwitchTitle: text.darkMode,
    returnToTopLabel: text.returnTop,
    skipToContentLabel: text.skipContent,
    editLink: { pattern: `${repository}/edit/main/docs/:path`, text: text.edit },
    footer: { message: text.footer, copyright: '© 2026 Ordivant contributors' },
  }
}

export default defineConfig({
  lang: 'zh-Hant', title: 'Ordivant',
  description: '開源、自行部署的 Agent 協作平台：Work、Knowledge、Code。',
  base, cleanUrls: false, lastUpdated: true,
  themeConfig: {
    logo: '/logo.svg', siteTitle: 'Ordivant', i18nRouting: true,
    search: { provider: 'local', options: { locales: {
      root: { translations: {
        button: { buttonText: '搜尋文件', buttonAriaLabel: '搜尋文件' },
        modal: { noResultsText: '找不到相關文件', resetButtonTitle: '清除搜尋', footer: { selectText: '選取', navigateText: '切換', closeText: '關閉' } },
      } },
      en: { translations: {
        button: { buttonText: 'Search docs', buttonAriaLabel: 'Search docs' },
        modal: { noResultsText: 'No results found', resetButtonTitle: 'Clear search', footer: { selectText: 'Select', navigateText: 'Navigate', closeText: 'Close' } },
      } },
      'zh-CN': { translations: {
        button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
        modal: { noResultsText: '未找到相关文档', resetButtonTitle: '清除搜索', footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' } },
      } },
    } } },
  },
  locales: {
    root: { label: '繁體中文', lang: 'zh-Hant', themeConfig: localeTheme('/', 'zh-Hant') },
    en: { label: 'English', lang: 'en', title: 'Ordivant', description: 'An open-source, self-hosted collaboration platform for agents.', themeConfig: localeTheme('/en', 'en') },
    'zh-CN': { label: '简体中文', lang: 'zh-Hans', title: 'Ordivant', description: '开源、自行部署的 Agent 协作平台。', themeConfig: localeTheme('/zh-CN', 'zh-Hans') },
  },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
    ['script', {}, legacyProjectRedirect],
  ],
  sitemap: { hostname: 'https://ordivant-ai.github.io/' },
  markdown: {
    config(md) {
      const copyLabel = (env: any) => {
        const source = env.path ?? env.filePath ?? ''
        const relative = path.relative(docsRoot, source).split(path.sep).join('/')
        return relative.startsWith('en/') ? 'Copy code' : relative.startsWith('zh-CN/') ? '复制代码' : '複製程式碼'
      }
      const fence = md.renderer.rules.fence!
      md.renderer.rules.fence = (tokens, index, options, env, renderer) => {
        const label = copyLabel(env)
        return fence(tokens, index, options, env, renderer).replace(/<button title="[^"]*" class="copy">/g, `<button title="${label}" aria-label="${label}" class="copy">`)
      }
      md.core.ruler.push('localized-section-labels', (state) => {
        const source = state.env.path ?? state.env.filePath ?? ''
        const relative = path.relative(docsRoot, source).split(path.sep).join('/')
        const label = relative.startsWith('en/') ? 'Link to section' : relative.startsWith('zh-CN/') ? '链接到章节' : '連至章節'
        const visit = (tokens: any[]) => tokens.forEach(token => {
          if (token.type === 'link_open' && token.attrGet('class') === 'header-anchor') {
            const previous = token.attrGet('aria-label') ?? ''
            token.attrSet('aria-label', previous.replace(/^Permalink to/, label))
          }
          if (token.children) visit(token.children)
        })
        visit(state.tokens)
      })
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
