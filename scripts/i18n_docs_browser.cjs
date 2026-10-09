const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(path.resolve('.cache/browser-qa/node_modules/playwright'));

const DEFAULT_BASE = 'http://127.0.0.1:4174/';
const REPORT_PATH = '.data/validation/i18n-docs-browser.json';
const SCREENSHOT_DIR = '.data/validation/i18n-docs-browser';
const LOCALES = [
  { key: 'root', htmlLang: 'zh-Hant', prefix: '', search: '沙箱', title: '開始使用 Ordivant', label: '繁體中文', next: 'en' },
  { key: 'en', htmlLang: 'en', prefix: 'en/', search: 'sandbox', title: 'Getting started with Ordivant', label: 'English', next: 'zh-CN' },
  { key: 'zh-CN', htmlLang: 'zh-Hans', prefix: 'zh-CN/', search: '沙箱', title: '开始使用 Ordivant', label: '简体中文', next: 'root' },
];

function parseBase(argv) {
  let value = DEFAULT_BASE;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') {
      process.stdout.write('Usage: node scripts/i18n_docs_browser.cjs [--base http://127.0.0.1:4174/|https://ordivant-ai.github.io/]\n');
      process.exit(0);
    }
    if (argv[i] !== '--base' || !argv[i + 1]) throw new Error(`Unexpected argument: ${argv[i]}`);
    value = argv[++i];
  }
  const parsed = new URL(value);
  const local = ['127.0.0.1', 'localhost'].includes(parsed.hostname)
    && parsed.port === '4174' && parsed.protocol === 'http:';
  const pages = parsed.hostname === 'ordivant-ai.github.io'
    && parsed.protocol === 'https:' && !parsed.port;
  if ((!local && !pages) || parsed.pathname !== '/' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Base must be the local preview at :4174/ or the public Pages URL, with no credentials, query, or fragment.');
  }
  return parsed.href;
}

function languagePrefix(key) {
  return key === 'root' ? '' : `${key}/`;
}

function expectedArticlePath(base, localeKey) {
  return new URL(`${languagePrefix(localeKey)}guide/getting-started.html`, base).pathname;
}

async function main() {
  const base = parseBase(process.argv);
  const { languageIssues } = await import(pathToFileURL(path.resolve('scripts/check_docs_i18n.mjs')).href);
  const { publicDocumentPaths, repositoryDocumentPaths } = await import(pathToFileURL(path.resolve('scripts/docs_pages.mjs')).href);
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const report = { base, status: 'running', checks: [], pageErrors: [], startedAt: new Date().toISOString() };
  const check = (name, passed, details = null) => {
    report.checks.push({ name, passed: Boolean(passed), ...(details === null ? {} : { details }) });
    if (!passed) process.stderr.write(`FAIL ${name}${details ? `: ${details}` : ''}\n`);
  };

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.pageErrors.push(error.message));

  try {
    for (const locale of LOCALES) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      const homeUrl = new URL(locale.prefix, base).href;
      const homeResponse = await page.goto(homeUrl, { waitUntil: 'networkidle' });
      check(`${locale.key}: homepage HTTP`, homeResponse && homeResponse.ok(), String(homeResponse && homeResponse.status()));
      check(`${locale.key}: homepage document language`, await page.locator('html').getAttribute('lang') === locale.htmlLang);
      check(`${locale.key}: homepage brand`, (await page.getByRole('heading', { level: 1 }).first().innerText()).includes('Ordivant'));
      check(`${locale.key}: homepage GitHub source`, await page.locator('a[href="https://github.com/ordivant-ai/ordivant"]').count() > 0);
      const screenshotLocale = locale.key === 'root' ? 'zh-TW' : locale.key;
      const heroImage = page.locator('.VPHero img[src*="/screenshots/"]');
      check(`${locale.key}: homepage shows a real localized product screenshot`,
        await heroImage.count() === 1 && await heroImage.evaluate((img, suffix) => img.complete && img.naturalWidth >= 1200 && img.src.endsWith(`/work-${suffix}.png`), screenshotLocale));
      check(`${locale.key}: homepage explains features and first-use steps`, await page.locator('#use-cases, #product-tour, #start-your-first-project, #find-your-guide').count() === 4);
      const featureTabs = page.locator('.feature-tabs [role="tab"]');
      check(`${locale.key}: product tour exposes four accessible tabs`, await featureTabs.count() === 4);
      for (const [index, feature] of ['work', 'workflow', 'knowledge', 'code'].entries()) {
        await featureTabs.nth(index).click();
        const panel = page.locator('.feature-panel[role="tabpanel"]');
        const preview = panel.locator('img');
        await preview.waitFor({ state: 'visible' });
        await preview.evaluate(img => img.complete ? Promise.resolve() : new Promise(resolve => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        }));
        check(`${locale.key}: ${feature} tab shows its localized screenshot`, await preview.evaluate((img, suffix) => img.naturalWidth === 1400 && img.src.endsWith(suffix), `/screenshots/${feature}-${screenshotLocale}.png`));
        check(`${locale.key}: ${feature} tab links to a localized guide`, new URL(await panel.locator('.feature-action').getAttribute('href'), base).pathname.startsWith('/' + locale.prefix));
        check(`${locale.key}: ${feature} is the single selected tab`, await page.locator('.feature-tabs [aria-selected="true"]').count() === 1 && await featureTabs.nth(index).getAttribute('aria-selected') === 'true');
      }
      await featureTabs.nth(3).press('Home');
      check(`${locale.key}: keyboard Home selects Work`, await featureTabs.nth(0).getAttribute('aria-selected') === 'true' && await featureTabs.nth(0).evaluate(element => element === document.activeElement));
      await featureTabs.nth(0).press('ArrowRight');
      check(`${locale.key}: keyboard arrows select automation`, await featureTabs.nth(1).getAttribute('aria-selected') === 'true');
      await featureTabs.nth(1).press('End');
      check(`${locale.key}: keyboard End selects Code`, await featureTabs.nth(3).getAttribute('aria-selected') === 'true');
      await featureTabs.nth(3).press('Home');
      const screenshotTrigger = page.locator('.feature-panel .screenshot-trigger');
      const viewerLabels = {
        root: { open: '放大畫面', original: '原始尺寸', fit: '符合螢幕', close: '關閉畫面' },
        en: { open: 'Enlarge screenshot', original: 'Original size', fit: 'Fit to screen', close: 'Close screenshot' },
        'zh-CN': { open: '放大画面', original: '原始尺寸', fit: '适应屏幕', close: '关闭画面' },
      }[locale.key];
      check(`${locale.key}: screenshot control has localized accessible text`, (await screenshotTrigger.getAttribute('aria-label')).startsWith(viewerLabels.open + ':'));
      await screenshotTrigger.focus();
      await screenshotTrigger.press('Enter');
      const viewer = page.locator('dialog.screenshot-viewer[open]');
      await viewer.waitFor({ state: 'visible' });
      check(`${locale.key}: screenshot opens a modal and prevents background scroll`, await viewer.evaluate(element => element.matches(':modal') && document.documentElement.style.overflow === 'hidden'));
      await viewer.getByRole('button', { name: viewerLabels.original, exact: true }).click();
      check(`${locale.key}: original screenshot size is available`, await viewer.locator('.original-size img').evaluate(img => Math.round(img.getBoundingClientRect().width) === 1400));
      await viewer.getByRole('button', { name: viewerLabels.fit, exact: true }).click();
      check(`${locale.key}: screenshot returns to fit view`, await viewer.locator('.original-size').count() === 0);
      await page.keyboard.press('Escape');
      await viewer.waitFor({ state: 'hidden' });
      check(`${locale.key}: Escape restores focus and scrolling`, await screenshotTrigger.evaluate(element => element === document.activeElement && document.documentElement.style.overflow !== 'hidden'));
      const homeDesktopWidth = await page.evaluate(() => ({ inner: window.innerWidth, document: document.documentElement.scrollWidth }));
      check(`${locale.key}: desktop homepage has no horizontal overflow`, homeDesktopWidth.document <= homeDesktopWidth.inner, homeDesktopWidth);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${locale.key}-home-desktop.png`), fullPage: false });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload({ waitUntil: 'networkidle' });
      const homeMobileWidth = await page.evaluate(() => ({ inner: window.innerWidth, document: document.documentElement.scrollWidth }));
      check(`${locale.key}: 390px homepage has no horizontal overflow`, homeMobileWidth.document <= homeMobileWidth.inner, homeMobileWidth);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${locale.key}-home-mobile.png`), fullPage: false });
      await page.locator('.feature-panel .screenshot-trigger').click();
      const mobileViewer = page.locator('dialog.screenshot-viewer[open]');
      await mobileViewer.waitFor({ state: 'visible' });
      await mobileViewer.getByRole('button', { name: viewerLabels.original, exact: true }).click();
      check(`${locale.key}: mobile original-size image scrolls inside the viewer`, await mobileViewer.locator('.screenshot-canvas').evaluate(element => element.scrollWidth > element.clientWidth && document.documentElement.scrollWidth <= window.innerWidth));
      await mobileViewer.getByRole('button', { name: new RegExp(viewerLabels.close) }).click();
      await mobileViewer.waitFor({ state: 'hidden' });
      await page.goto(new URL(`${locale.prefix}guide/first-project.html`, base).href, { waitUntil: 'networkidle' });
      check(`${locale.key}: complete tutorial includes setup, execution, and independent review`, await page.locator('#create-project, #configure-model, #create-agent, #create-task, #dispatch-and-run, #submit-review, #manual-route, #templates-workflows').count() === 8);
      check(`${locale.key}: complete tutorial supplies copyable specification examples`, await page.locator('.vp-doc table').count() >= 3 && await page.locator('.vp-doc pre').count() >= 2);
      const tutorialMobileWidth = await page.evaluate(() => ({ inner: window.innerWidth, document: document.documentElement.scrollWidth }));
      check(`${locale.key}: 390px complete tutorial has no horizontal overflow`, tutorialMobileWidth.document <= tutorialMobileWidth.inner, tutorialMobileWidth);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${locale.key}-first-project-mobile.png`), fullPage: false });
      await page.setViewportSize({ width: 1440, height: 1000 });

      const articleUrl = new URL(`${locale.prefix}guide/getting-started.html`, base).href;
      const articleResponse = await page.goto(articleUrl, { waitUntil: 'networkidle' });
      check(`${locale.key}: quickstart HTTP`, articleResponse && articleResponse.ok(), String(articleResponse && articleResponse.status()));
      check(`${locale.key}: quickstart document language`, await page.locator('html').getAttribute('lang') === locale.htmlLang);
      const h1 = await page.getByRole('heading', { level: 1 }).first().innerText();
      const normalizedH1 = h1.replace(/\u200b/g, '').trim();
      check(`${locale.key}: quickstart heading`, normalizedH1 === locale.title, normalizedH1);

      const sectionLabel = { root: '連至章節', en: 'Link to section', 'zh-CN': '链接到章节' }[locale.key];
      check(`${locale.key}: localized section link`, (await page.locator('.vp-doc .header-anchor').first().getAttribute('aria-label')).startsWith(sectionLabel));
      check(`${locale.key}: quickstart uses the application without shell commands`, await page.locator('.vp-doc pre').count() === 0);
      const sidebarText = await page.locator('.VPSidebar').innerText();
      const sidebarGroups = {
        root: ['開始使用', '日常操作', '管理與部署'],
        en: ['Get started', 'Daily work', 'Administration and deployment'],
        'zh-CN': ['开始使用', '日常操作', '管理与部署'],
      }[locale.key];
      check(`${locale.key}: sidebar guides users and administrators`, sidebarGroups.every(label => sidebarText.includes(label)));
      const navigationHrefs = await page.locator('.VPSidebar a, .VPNavBar a').evaluateAll(links => links.map(link => link.getAttribute('href') || ''));
      check(`${locale.key}: navigation omits developer documentation`, navigationHrefs.every(href => !/(?:reference|i18n|validation)\.html|\/(?:CONTRIBUTING|SECURITY)\.md/.test(href)));

      await page.locator('#local-search button').click();
      const searchInput = page.locator('#localsearch-input');
      await searchInput.waitFor({ state: 'visible' });
      await searchInput.fill(locale.search);
      const expectedResult = page.locator(`.VPLocalSearchBox a.result[href*="execution-usage.html"]`);
      await expectedResult.first().waitFor({ state: 'visible', timeout: 10000 });
      const resultHref = await expectedResult.first().getAttribute('href');
      const expectedGuidePath = new URL(`${locale.prefix}execution-usage.html`, base).pathname;
      const resultPath = resultHref ? new URL(resultHref, base).pathname : null;
      check(`${locale.key}: local search returns localized sandbox guide`, resultPath === expectedGuidePath, resultHref);
      const repositoryRoutes = repositoryDocumentPaths().map(document => document.replace(/\.md$/, '.html'));
      const resultLinks = await page.locator('.VPLocalSearchBox a.result').evaluateAll(links => links.map(link => link.getAttribute('href')));
      check(`${locale.key}: local search contains only public articles`, resultLinks.every(href => !repositoryRoutes.some(route => new URL(href, base).pathname.endsWith('/' + route))));
      await page.keyboard.press('Escape');
      await page.locator('.VPLocalSearchBox').waitFor({ state: 'hidden' });

      await page.locator('.VPNavBarTranslations button').click();
      const languageLinks = page.locator('.VPNavBarTranslations a[href*="guide/getting-started.html"]');
      const nextPrefix = languagePrefix(locale.next);
      const expectedSwitchedPath = new URL(`${nextPrefix}guide/getting-started.html`, base).pathname;
      const switchLink = page.locator(`.VPNavBarTranslations a[href="${expectedSwitchedPath}"]`);
      const switchHref = await switchLink.getAttribute('href');
      check(`${locale.key}: language switch keeps article path`, await languageLinks.count() === 2 && Boolean(switchHref), switchHref);
      if (switchHref) {
        await Promise.all([
          page.waitForURL(url => url.pathname === expectedSwitchedPath),
          switchLink.click(),
        ]);
        const targetLocale = LOCALES.find(item => item.key === locale.next);
        await page.waitForFunction(expectedLang => document.documentElement.lang === expectedLang, targetLocale.htmlLang);
        check(`${locale.key}: switched page language`, await page.locator('html').getAttribute('lang') === targetLocale.htmlLang);
        check(`${locale.key}: switched page remains quickstart`, (await page.getByRole('heading', { level: 1 }).first().innerText()).includes('Ordivant'));
      }

      for (const document of publicDocumentPaths()) {
        const route = `${locale.prefix}${document.replace(/\.md$/, '.html')}`;
        const response = await page.goto(new URL(route, base).href, { waitUntil: 'domcontentloaded' });
        await page.locator('.vp-doc').first().waitFor({ state: 'attached' });
        const blocks = await page.locator('.vp-doc').first().evaluate(element => {
          const clone = element.cloneNode(true);
          clone.querySelectorAll('pre, code, .header-anchor').forEach(node => node.remove());
          return [...clone.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,th,td')].map(node => ({
            text: node.textContent.trim(), kind: /^H/.test(node.tagName) ? 'heading' : 'paragraph',
          })).filter(block => block.text);
        });
        const issues = blocks.flatMap(block => languageIssues(block.text, locale.htmlLang, block.kind).map(reason => ({ reason, text: block.text.slice(0, 160) })));
        check(`${locale.key}: ${document} HTTP`, response && response.ok(), String(response && response.status()));
        check(`${locale.key}: ${document} declared language`, await page.locator('html').getAttribute('lang') === locale.htmlLang);
        check(`${locale.key}: ${document} translated body`, blocks.length > 0 && issues.length === 0, issues.length ? issues.slice(0, 4) : { blocks: blocks.length });
        const screenshotResults = await page.locator('.vp-doc img[src*="/screenshots/"]').evaluateAll(async (images, suffix) => Promise.all(images.map(img => new Promise(resolve => {
          const result = () => resolve(img.naturalWidth >= 1200 && img.src.endsWith(`-${suffix}.png`) && Boolean(img.alt.trim()));
          if (img.complete) result();
          else { img.addEventListener('load', result, { once: true }); img.addEventListener('error', () => resolve(false), { once: true }); }
        }))), screenshotLocale);
        if (screenshotResults.length) check(`${locale.key}: ${document} localized screenshots load`, screenshotResults.every(Boolean), { screenshots: screenshotResults.length });
      }

      const containerUrl = new URL(`${locale.prefix}containers.html#development`, base).href;
      await page.goto(containerUrl, { waitUntil: 'domcontentloaded' });
      const copyLabel = { root: '複製程式碼', en: 'Copy code', 'zh-CN': '复制代码' }[locale.key];
      const copyButton = page.locator('.vp-doc button.copy').first();
      check(`${locale.key}: localized deployment copy button`, await copyButton.getAttribute('title') === copyLabel && await copyButton.getAttribute('aria-label') === copyLabel);
      check(`${locale.key}: legacy container bookmark preserved`, await page.locator('#development').count() === 1);
      const deploymentCommands = (await page.locator('.vp-doc pre').allInnerTexts()).join('\n');
      check(`${locale.key}: installation uses native Docker Compose`, deploymentCommands.includes('docker compose -f compose.init.yaml run --rm init') && !/pwsh|containers\.ps1/i.test(deploymentCommands));
      await page.locator('.VPNavBarTranslations button').click();
      const sectionSwitch = page.locator(`.VPNavBarTranslations a[href="${new URL(`${languagePrefix(locale.next)}containers.html#development`, base).pathname}#development"]`);
      check(`${locale.key}: language switch preserves section`, await sectionSwitch.count() === 1);
      await sectionSwitch.click();
      await page.waitForURL(url => url.hash === '#development' && url.pathname.includes('containers.html'));
      check(`${locale.key}: switched section exists`, await page.locator('#development').count() === 1);
      await page.goto(containerUrl, { waitUntil: 'domcontentloaded' });
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${locale.key}-containers.png`), fullPage: true });

      await page.goto(new URL(`${locale.prefix}missing-i18n-page.html`, base).href, { waitUntil: 'networkidle' });
      const missingTitle = { root: '找不到頁面', en: 'Page not found', 'zh-CN': '找不到页面' }[locale.key];
      check(`${locale.key}: localized 404 message`, await page.locator('.NotFound .title').innerText() === missingTitle);

      for (const document of repositoryDocumentPaths()) {
        const route = `${locale.prefix}${document.replace(/\.md$/, '.html')}`;
        const response = await page.goto(new URL(route, base).href, { waitUntil: 'domcontentloaded' });
        await page.locator('.NotFound .title').waitFor({ state: 'visible' });
        // VitePress preview serves its fallback with HTTP 200; GitHub Pages returns 404.
        check(`${locale.key}: repository-only ${document} is unavailable`,
          response && (new URL(base).hostname !== 'ordivant-ai.github.io' || response.status() === 404)
          && await page.locator('.vp-doc').count() === 0
          && await page.locator('.NotFound .title').innerText() === missingTitle);
      }

      await page.goto(articleUrl, { waitUntil: 'networkidle' });
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${locale.key}-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload({ waitUntil: 'networkidle' });
      const width = await page.evaluate(() => ({ inner: window.innerWidth, document: document.documentElement.scrollWidth }));
      check(`${locale.key}: 390px has no horizontal overflow`, width.document <= width.inner, width);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${locale.key}-mobile.png`), fullPage: true });

      await page.locator('.VPNavBarHamburger').click();
      const mobileNav = page.locator('.VPNavScreen');
      await mobileNav.waitFor({ state: 'visible' });
      check(`${locale.key}: mobile navigation opens`, await mobileNav.isVisible());
      await page.locator('.VPNavScreenTranslations .title').click();
      const mobileLanguageLinks = page.locator('.VPNavScreenTranslations .list a');
      const mobileHrefs = await mobileLanguageLinks.evaluateAll(links => links.map(link => link.getAttribute('href')));
      const mobileExpected = LOCALES.filter(item => item.key !== locale.key)
        .map(item => new URL(`${languagePrefix(item.key)}guide/getting-started.html`, base).pathname);
      check(`${locale.key}: mobile language links preserve article`, mobileHrefs.length === 2 && mobileExpected.every(href => mobileHrefs.includes(href)), mobileHrefs);
    }

    if (new URL(base).hostname === 'ordivant-ai.github.io') {
      await page.setViewportSize({ width: 1440, height: 1000 });
      for (const locale of LOCALES) {
        const legacyUrl = new URL(`ordivant/${locale.prefix}containers.html?source=bookmark#development`, base).href;
        const target = new URL(`${locale.prefix}containers.html?source=bookmark#development`, base);
        await page.goto(legacyUrl, { waitUntil: 'commit' });
        await page.waitForURL(url => url.href === target.href, { waitUntil: 'networkidle' });
        check(`${locale.key}: legacy project bookmark redirects intact`, page.url() === target.href && await page.locator('#development').count() === 1);
        check(`${locale.key}: legacy project destination language`, await page.locator('html').getAttribute('lang') === locale.htmlLang);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${locale.key}-legacy-container.png`), fullPage: false });
      }
      await page.goto(new URL('ordivant/', base).href, { waitUntil: 'commit' });
      await page.waitForURL(url => url.href === base, { waitUntil: 'networkidle' });
      check('legacy project homepage redirects to root', page.url() === base);
    }
    check('all locales: no page JavaScript errors', report.pageErrors.length === 0, report.pageErrors);
  } catch (error) {
    report.error = error.stack || error.message;
    check('browser flow completed', false, error.message);
  } finally {
    await browser.close();
    report.completedAt = new Date().toISOString();
    report.checkCount = report.checks.length;
    report.status = report.checks.every(item => item.passed) && report.pageErrors.length === 0 ? 'passed' : 'failed';
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`DOCS_BROWSER_${report.status.toUpperCase()}: ${report.checkCount} checks, ${report.checks.filter(item => !item.passed).length} failures, report ${REPORT_PATH}\n`);
    if (report.status !== 'passed') process.exitCode = 1;
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
