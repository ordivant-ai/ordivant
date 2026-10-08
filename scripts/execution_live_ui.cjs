// Inspect a real completed live receipt with mouse input on owned QA only.
const { chromium } = require('../.cache/browser-qa/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const BASE = 'http://127.0.0.1:8092';
const directory = path.resolve('.data/validation/execution-live-browser');
const checks = {};
let stage = 'initialization';
function check(name, value) { stage = name; checks[name] = Boolean(value); assert.ok(value, name); }

async function main() {
  await fs.mkdir(directory, { recursive: true });
  const source = JSON.parse(await fs.readFile(process.env.ORDIVANT_QA_LIVE_REPORT, 'utf8'));
  assert.equal(source.target, 'ordivant-execution-qa');
  assert.equal(source.status, 'passed');
  const report = { status: 'failed', target: BASE, run_id: source.run_id, checks };
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.name));
  try {
    await page.goto(BASE + '/work');
    await page.getByLabel('電子郵件').fill(process.env.ORDIVANT_QA_EMAIL);
    await page.getByLabel('密碼', { exact: true }).fill(process.env.ORDIVANT_QA_PASSWORD);
    await page.locator('button[type="submit"]').click();
    const projectInput = page.getByRole('combobox', { name: '選擇專案' });
    await projectInput.waitFor();
    const project = await page.request.get(BASE + '/api/projects/' + source.project_id);
    assert.ok(project.ok(), 'real_project_available');
    const projectName = (await project.json()).name;
    await projectInput.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," ant-select ")][1]').click();
    const popup = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    await popup.waitFor({ state: 'visible' });
    const option = popup.locator('.ant-select-item-option').filter({ hasText: projectName });
    for (let i = 0; i < 100 && !await option.count(); i++) {
      const bounds = await popup.locator('.rc-virtual-list-holder').boundingBox();
      assert.ok(bounds, 'project_popup_visible');
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.wheel(0, 180);
      await option.waitFor({ state: 'attached', timeout: 200 }).catch(error => { if (error.name !== 'TimeoutError') throw error; });
    }
    await option.click();
    await page.locator('button.nav-item').filter({ hasText: 'Run 執行' }).click();
    await page.getByRole('textbox', { name: '依 Task ID 篩選 Run' }).fill(source.task_id);
    await page.getByRole('row', { name: '檢視 Run ' + source.run_id, exact: true }).click();
    const drawer = page.locator('.ant-drawer-content');
    await drawer.getByText(source.task_id, { exact: true }).waitFor();
    await drawer.locator('.run-tool-list').getByText(source.mcp_tools.synthetic_add, { exact: true }).waitFor();
    check('actual_live_mcp_receipt_visible', true);
    check('actual_live_model_visible', await drawer.locator('.run-model-lines').getByText(/gpt-6\.1-sol/).count() === 2);
    check('actual_total_tokens_visible', await drawer.locator('.run-usage-grid').getByText(String(source.receipt.usage.total_tokens), { exact: true }).isVisible());
    const outputs = drawer.locator('.run-sandbox-result');
    const successOutput = outputs.getByText(/ACTUAL_SANDBOX_TEST_PASS/).first();
    await successOutput.waitFor();
    check('actual_sandbox_stdout_displayed', true);
    check('actual_success_and_failure_codes_displayed', await outputs.getByText('Exit 0', { exact: true }).first().isVisible() && await outputs.getByText('Exit 7', { exact: true }).first().isVisible());
    check('live_currency_unknown_is_honest', await drawer.locator('.run-usage-grid').getByText('未知', { exact: true }).count() === 1);
    check('completed_run_has_no_stop_or_retry', await drawer.getByRole('button', { name: /停\s*止|重\s*跑/ }).count() === 0);
    await page.screenshot({ path: path.join(directory, 'desktop-live-receipt.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await successOutput.scrollIntoViewIfNeeded();
    const bounds = await drawer.boundingBox();
    check('mobile_live_drawer_fits', bounds && bounds.x >= -1 && bounds.x + bounds.width <= 391);
    check('mobile_actual_output_visible', await successOutput.isVisible());
    await page.screenshot({ path: path.join(directory, 'mobile-live-sandbox.png') });
    check('no_browser_javascript_errors', errors.length === 0);
    report.status = 'passed';
  } catch (error) {
    report.failed_check = stage;
    report.error_type = error.name;
    report.error_message = String(error.message).replaceAll(process.env.ORDIVANT_QA_PASSWORD, '[REDACTED]');
    await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
  } finally {
    await browser.close();
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log('EXECUTION_LIVE_BROWSER_' + report.status.toUpperCase() + ' ' + Object.keys(checks).length + ' checks');
  if (report.status !== 'passed') { console.log('Failed check: ' + stage); process.exitCode = 1; }
}
main().catch(error => { console.log('EXECUTION_LIVE_BROWSER_FAILED ' + error.name); process.exitCode = 1; });
