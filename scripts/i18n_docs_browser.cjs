const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(path.resolve('.cache/browser-qa/node_modules/playwright'));

const DEFAULT_BASE = 'http://127.0.0.1:4174/ordivant/';
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
      process.stdout.write('Usage: node scripts/i18n_docs_browser.cjs [--base http://127.0.0.1:4174/ordivant/|https://bigtongue5566.github.io/ordivant/]\n');
      process.exit(0);
    }
    if (argv[i] !== '--base' || !argv[i + 1]) throw new Error(`Unexpected argument: ${argv[i]}`);
    value = argv[++i];
  }
  const parsed = new URL(value);
  const local = ['127.0.0.1', 'localhost'].includes(parsed.hostname)
    && parsed.port === '4174' && parsed.protocol === 'http:';
  const pages = parsed.hostname === 'bigtongue5566.github.io'
    && parsed.protocol === 'https:' && !parsed.port;
  if ((!local && !pages) || parsed.pathname !== '/ordivant/' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Base must be the local preview at :4174/ordivant/ or the public Pages URL, with no credentials, query, or fragment.');
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
      check(`${locale.key}: homepage GitHub source`, await page.locator('a[href="https://github.com/bigtongue5566/ordivant"]').count() > 0);

      const articleUrl = new URL(`${locale.prefix}guide/getting-started.html`, base).href;
      const articleResponse = await page.goto(articleUrl, { waitUntil: 'networkidle' });
      check(`${locale.key}: quickstart HTTP`, articleResponse && articleResponse.ok(), String(articleResponse && articleResponse.status()));
      check(`${locale.key}: quickstart document language`, await page.locator('html').getAttribute('lang') === locale.htmlLang);
      const h1 = await page.getByRole('heading', { level: 1 }).first().innerText();
      const normalizedH1 = h1.replace(/\u200b/g, '').trim();
      check(`${locale.key}: quickstart heading`, normalizedH1 === locale.title, normalizedH1);

      const editLinks = page.locator('a[href*="/edit/main/docs/"]');
      const editHref = await editLinks.first().getAttribute('href');
      const editSuffix = locale.key === 'root'
        ? '/docs/guide/getting-started.md'
        : `/docs/${locale.key}/guide/getting-started.md`;
      check(`${locale.key}: GitHub edit link has one locale prefix`, Boolean(editHref && editHref.endsWith(editSuffix) && !editHref.includes(`/docs/${locale.key}/${locale.key}/`)), editHref);

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
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== 'passed') process.exitCode = 1;
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
