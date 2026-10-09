#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(path.resolve('.cache/browser-qa/node_modules/playwright'));

const BASE = 'http://127.0.0.1:8092';
const EXPECTED_COMPOSE_PROJECT = process.argv.includes('--handbook-qa') ? 'ordivant-docs-handbook-qa' : 'ordivant-docs-compose-qa';
const CONTENT_ONLY = process.argv.includes('--content-only');
const OUTPUT_DIR = path.resolve('docs/public/screenshots');
const VIEWPORT = { width: 1400, height: 900 };
const ADMIN_EMAIL_ENV = 'ORDIVANT_QA_EMAIL';
const ADMIN_PASSWORD_ENV = 'ORDIVANT_QA_PASSWORD';
const RUN_TAG = Date.now().toString(36);
const RUN_TASK_TITLE = 'DEMO · Agent 整理上線準備狀態';
const LEGACY_RUN_TASK_PREFIX = 'DEMO · 執行知識助理範例 · ';
const HISTORICAL_TASK_PREFIX = 'DEMO · 舊版執行範例 ';

const LOCALES = [
  { key: 'zh-TW', label: '繁體中文', htmlLang: 'zh-Hant', login: '登入 Ordivant', work: '任務工作區', runs: 'Run 執行', knowledge: '文件庫', code: '儲存庫', pulls: '合併請求' },
  { key: 'en', label: 'English', htmlLang: 'en', login: 'Sign in to Ordivant', work: 'Task workspace', runs: 'Run execution', knowledge: 'Documents', code: 'Repositories', pulls: 'Pull requests' },
  { key: 'zh-CN', label: '简体中文', htmlLang: 'zh-Hans', login: '登录 Ordivant', work: '任务工作区', runs: 'Run 运行', knowledge: '文档库', code: '保存库', pulls: '合并请求' },
];

const catalogCache = new Map();

const WORK_PROJECT = { key: 'DOCSQA', name: 'Ordivant 產品導覽示例' };
const PI_AGENT_NAME = 'DEMO Knowledge Assistant';
const TASKS = [
  {
    title: 'DEMO · 整理產品上線清單',
    legacyTitle: 'DEMO · 建立知識文件檢索範例',
    description: 'DEMO 示範任務：彙整產品正式上線前的必要準備。',
    goal: '整理一份可追蹤的產品上線清單，讓團隊知道上線前要完成哪些工作。',
    acceptance_criteria: ['列出文件、權限與部署檢查項目', '每項工作都有明確負責角色與完成條件'],
  },
  {
    title: 'DEMO · 確認上線前準備',
    legacyTitle: 'DEMO · 核對文件引用與版本',
    description: 'DEMO 示範任務：確認產品上線前的檢查結果與文件版本。',
    goal: '在上線前確認準備事項已完成，並保留需要追蹤的阻礙。',
    acceptance_criteria: ['逐項記錄準備狀態與依據', '未完成項目標明後續負責角色'],
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function inspectQaPortOwner() {
  let containers;
  try {
    const ids = execFileSync('docker', ['ps', '-q'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim().split(/\r?\n/).filter(Boolean);
    if (!ids.length) throw new Error('empty');
    containers = JSON.parse(execFileSync('docker', ['inspect', ...ids], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    throw new Error('Cannot verify the Docker owner of port 8092.');
  }

  const bindings = containers.flatMap(container => {
    const ports = container.NetworkSettings && container.NetworkSettings.Ports || {};
    return Object.entries(ports).flatMap(([containerPort, entries]) => (entries || []).map(entry => ({
      hostPort: entry.HostPort,
      containerPort,
      project: container.Config && container.Config.Labels && container.Config.Labels['com.docker.compose.project'],
    })));
  }).filter(binding => binding.hostPort === '8092');

  assert(bindings.length > 0, 'Port 8092 is not published by a running Docker container.');
  assert(bindings.every(binding => binding.project === EXPECTED_COMPOSE_PROJECT), 'Port 8092 is owned by an unexpected Docker Compose project.');
  return bindings.length;
}

function safeData(value) {
  if (Array.isArray(value)) return value.map(safeData);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (/token|password|secret|cookie|authorization|api[_-]?key/i.test(key)) continue;
    result[key] = safeData(child);
  }
  return result;
}

function catalogMessage(source, locale) {
  if (locale === 'zh-TW') return source;
  const cacheKey = locale + ':' + source;
  if (catalogCache.has(cacheKey)) return catalogCache.get(cacheKey);
  let message;
  if (locale === 'zh-CN') {
    const catalogPath = path.resolve('frontend/src/i18n/catalogs/work.zh-CN.json');
    message = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))[source];
  } else {
    const catalogPath = path.resolve('frontend/src/i18n/catalogs/work.en.ts');
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const catalog = fs.readFileSync(catalogPath, 'utf8');
    const match = catalog.match(new RegExp("^[\\t ]*['\\\"]" + escaped + "['\\\"]\\s*:\\s*'([^']*)'", 'm'));
    message = match && match[1];
  }
  assert(message, 'A required Work translation is missing from the frontend catalog.');
  catalogCache.set(cacheKey, message);
  return message;
}

async function callApi(page, route, method = 'GET', body = undefined) {
  assert(/^\/(api|knowledge-api|code-api)\//.test(route), 'Refusing a non-product API route.');
  const result = await page.evaluate(async ({ route, method, body }) => {
    if (location.origin !== 'http://127.0.0.1:8092') return { ok: false, status: 0 };
    const url = new URL(route, location.origin);
    if (url.origin !== location.origin) return { ok: false, status: 0 };
    const headers = new Headers();
    const options = { method, credentials: 'same-origin', headers };
    if (body !== undefined) {
      const identityResponse = await fetch('/auth-api/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!identityResponse.ok) return { ok: false, status: identityResponse.status };
      const identity = await identityResponse.json();
      headers.set('X-CSRF-Token', identity.csrf_token);
      headers.set('Idempotency-Key', crypto.randomUUID());
      headers.set('Content-Type', 'application/json');
      options.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(url.href, options);
    } catch {
      return { ok: false, status: 0 };
    }
    if (!response.ok) return { ok: false, status: response.status };
    if (response.status === 204) return { ok: true, status: response.status, data: null };
    try {
      return { ok: true, status: response.status, data: await response.json() };
    } catch {
      return { ok: false, status: response.status };
    }
  }, { route, method, body });

  if (!result.ok) throw new Error('QA API request failed (' + method + ' ' + route + ', HTTP ' + result.status + ').');
  return safeData(result.data);
}

async function createOrReuseWorkFixtures(page) {
  const projects = await callApi(page, '/api/projects');
  let project = projects.find(item => item.key === WORK_PROJECT.key);
  if (!project) {
    project = await callApi(page, '/api/projects', 'POST', {
      key: WORK_PROJECT.key,
      name: WORK_PROJECT.name,
      description: 'DEMO 示範資料：提供公開操作指南的畫面範例。',
      budget_usd: 0,
    });
  }

  const agents = await callApi(page, '/api/agents?project_id=' + encodeURIComponent(project.id));
  let agent = agents.find(item => item.name === PI_AGENT_NAME && item.runtime === 'pi');
  if (!agent) {
    agent = await callApi(page, '/api/agents', 'POST', {
      name: PI_AGENT_NAME,
      role: 'worker',
      capabilities: ['knowledge-demo'],
      project_ids: [project.id],
      runtime: 'pi',
      model_config: null,
      execution_config: {
        instructions: 'This is a synthetic DEMO documentation run. Read the actual task context, return a concise summary, and do not call external model providers.',
        tool_connection_ids: [],
        sandbox_profile_id: null,
        limits: { max_turns: 10, timeout_seconds: 120 },
      },
    });
  }
  assert(agent && agent.id && agent.runtime === 'pi', 'The DEMO Pi agent is unavailable.');
  assert(Object.prototype.hasOwnProperty.call(agent, 'effective_model_config') && agent.effective_model_config === null,
    'Refusing to dispatch because the Pi agent has an effective model configuration.');

  let tasks = await callApi(page, '/api/tasks?project_id=' + encodeURIComponent(project.id));
  for (const fixture of TASKS) {
    let task = tasks.find(item => item.title === fixture.title)
      || tasks.find(item => item.title === fixture.legacyTitle);
    const fields = {
      title: fixture.title,
      description: fixture.description,
      goal: fixture.goal,
      inputs: 'DEMO 示範內容，不含客戶資料或外部憑證。',
      scope: '僅使用此示範專案的文件與設定。',
      constraints: '不得呼叫付費模型或外部服務。',
      acceptance_criteria: fixture.acceptance_criteria,
      priority: 'high',
      labels: ['DEMO', 'Launch'],
      budget_usd: 0,
    };
    if (!task) {
      task = await callApi(page, '/api/tasks', 'POST', {
        project_id: project.id,
        ...fields,
        status: 'ready',
      });
    } else {
      const patch = Object.fromEntries(Object.entries(fields).filter(([key, value]) =>
        JSON.stringify(task[key]) !== JSON.stringify(value)));
      if (Object.keys(patch).length) {
        task = await callApi(page, '/api/tasks/' + encodeURIComponent(task.id), 'PATCH', patch);
      }
    }
    tasks = tasks.filter(item => item.id !== task.id).concat(task);
  }

  const runs = await callApi(page, '/api/runs?project_id=' + encodeURIComponent(project.id));
  assert(runs.length <= 1, 'The isolated DEMO project already has more than one Run.');
  const legacyRunTasks = tasks.filter(item => item.title.startsWith(LEGACY_RUN_TASK_PREFIX)
    || item.title.startsWith(HISTORICAL_TASK_PREFIX));
  let runTask = runs.length
    ? tasks.find(item => item.id === runs[0].task_id)
    : tasks.find(item => item.title === RUN_TASK_TITLE) || legacyRunTasks[0];
  assert(!runs.length || runTask, 'The existing DEMO Run task is unavailable.');

  const runFields = {
    title: RUN_TASK_TITLE,
    description: 'DEMO 示範執行：由 Pi runtime 以 DEMO 模式回傳任務摘要，不連接模型 Provider。',
    goal: '整理產品上線清單，回傳清楚標示為 DEMO 的摘要與驗收證據。',
    inputs: '示範內容：產品文件、權限與部署準備事項。',
    scope: '僅讀取目前任務脈絡，不呼叫任何外部工具。',
    constraints: 'DEMO 模式；不得呼叫模型 Provider；成本維持未驗證。',
    acceptance_criteria: ['回覆保留 DEMO 標示', '逐項摘要上線準備狀態'],
    priority: 'high',
    assignee_id: agent.id,
    labels: ['DEMO', 'Launch'],
    budget_usd: 0,
  };
  if (!runTask) {
    runTask = await callApi(page, '/api/tasks', 'POST', {
      project_id: project.id,
      ...runFields,
      status: 'ready',
    });
  } else {
    const patch = Object.fromEntries(Object.entries(runFields).filter(([key, value]) =>
      JSON.stringify(runTask[key]) !== JSON.stringify(value)));
    if (Object.keys(patch).length) {
      runTask = await callApi(page, '/api/tasks/' + encodeURIComponent(runTask.id), 'PATCH', patch);
    }
  }

  let legacyIndex = 1;
  for (const legacyTask of legacyRunTasks) {
    if (legacyTask.id === runTask.id) continue;
    const historyTitle = 'DEMO · 檢查知識文件版本' + (legacyIndex > 1 ? ' ' + String(legacyIndex).padStart(2, '0') : '');
    legacyIndex += 1;
    if (legacyTask.title !== historyTitle) {
      await callApi(page, '/api/tasks/' + encodeURIComponent(legacyTask.id), 'PATCH', { title: historyTitle });
    }
  }

  const task = tasks.find(item => item.title === TASKS[0].title);
  assert(task && task.status === 'ready', 'The stable DEMO task is not ready for a task detail screenshot.');
  if (!runs.length) assert(runTask.status === 'ready', 'The DEMO Run task is not ready to dispatch.');
  return { project, agent, tasks, task, runTask, existingRun: runs[0] || null };
}

async function waitForDemoRun(page, runId) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const run = await callApi(page, '/api/runs/' + encodeURIComponent(runId));
    if (run.mode === 'live') throw new Error('The Run became live; refusing to capture it.');
    if (run.status === 'failed' || run.status === 'aborted') throw new Error('The DEMO Run did not complete successfully.');
    const events = await callApi(page, '/api/runs/' + encodeURIComponent(runId) + '/events');
    if (run.status === 'done' && run.mode === 'demo' && run.receipt && run.receipt.mode === 'demo'
      && typeof run.answer === 'string' && run.answer.trim().length > 0 && events.length > 0) {
      return { run, events };
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  throw new Error('The DEMO Run did not finish before the QA timeout.');
}

async function createOrReuseKnowledgeFixture(page) {
  let spaces = await callApi(page, '/knowledge-api/spaces');
  let space = spaces.find(item => item.key === 'docsqa');
  if (!space) {
    space = await callApi(page, '/knowledge-api/spaces', 'POST', {
      key: 'docsqa',
      name: 'Ordivant 文件操作示例',
      description: 'DEMO 示範資料：文件閱讀、版本發佈與引用。',
    });
  }

  const params = new URLSearchParams({ space_id: space.id });
  const documents = await callApi(page, '/knowledge-api/documents?' + params.toString());
  const title = 'DEMO · 知識助理操作指南';
  let document = documents.find(item => item.title === title);
  if (!document) {
    const created = await callApi(page, '/knowledge-api/documents', 'POST', {
      space_id: space.id,
      title,
      summary: '公開產品畫面使用的合成示範文件，展示來源與版本。',
      body: '# 知識助理操作指南\n\n## 回答前先確認\n\n- 確認文件屬於目前授權的 Space。\n- 檢查文件版本與更新摘要。\n- 回覆時引用可追溯的來源。\n\n## 交付結果\n\n將答案、依據與未確認事項分開整理。這份文件是 DEMO 示範資料。',
      tags: ['DEMO', '知識管理'],
      change_summary: 'DEMO 示範文件初版',
      source_refs: [],
    });
    document = created.document;
  }
  assert(document && document.id, 'The Knowledge DEMO document is unavailable.');
  const context = await callApi(page, '/knowledge-api/documents/' + encodeURIComponent(document.id));
  if (context.document.current_version < 2) {
    await callApi(page, '/knowledge-api/documents/' + encodeURIComponent(document.id) + '/versions', 'POST', {
      expected_version: context.document.current_version,
      title,
      body: '# 知識助理操作指南\n\n## 回答前先確認\n\n- 確認文件屬於目前授權的 Space。\n- 檢查文件版本與更新摘要。\n- 回覆時引用可追溯的來源。\n\n## 交付結果\n\n將答案、依據與未確認事項分開整理。此版本保留原有內容並補充版本檢查步驟。這份文件是 DEMO 示範資料。',
      change_summary: '補充版本檢查與來源引用步驟',
      source_refs: [],
    });
  }
  return { space, document, title };
}

async function createOrReuseCodeFixture(page) {
  const health = await callApi(page, '/code-api/health');
  assert(health && health.gitea_configured === true, 'Code is not connected to Gitea in the isolated QA workspace.');
  let projects = await callApi(page, '/code-api/projects');
  let project = projects.find(item => item.key === 'docsqa');
  if (!project) {
    project = await callApi(page, '/code-api/projects', 'POST', {
      key: 'docsqa',
      name: 'Ordivant Code 操作示例',
      description: 'DEMO 示範資料：私有儲存庫、分支、提交與 PR。',
    });
  }

  let repositories = await callApi(page, '/code-api/repositories?project_id=' + encodeURIComponent(project.id));
  let repository = repositories.find(item => item.name === 'docs-demo');
  if (!repository) {
    repository = await callApi(page, '/code-api/repositories', 'POST', {
      project_id: project.id,
      name: 'docs-demo',
      description: 'DEMO 範例儲存庫：以實際 Gitea 分支和合併請求示範產品操作。',
      private: true,
    });
  }

  const existingPulls = await callApi(page, '/code-api/repositories/' + encodeURIComponent(repository.id) + '/pulls');
  let pull = existingPulls.find(item => item.title === 'DEMO · 更新操作指南範例' && item.state === 'open');
  if (!pull) {
    const branch = 'docs/demo-' + RUN_TAG;
    await callApi(page, '/code-api/repositories/' + encodeURIComponent(repository.id) + '/branches', 'POST', {
      name: branch,
      from_branch: repository.default_branch || 'main',
    });
    await callApi(page, '/code-api/repositories/' + encodeURIComponent(repository.id) + '/files', 'POST', {
      branch,
      path: 'docs/demo-guide-' + RUN_TAG + '.md',
      content: '# DEMO 操作指南\n\n這是 QA 工作區的合成範例，示範透過 Ordivant 建立實際 Gitea 提交。\n\n- 保留變更摘要\n- 以 PR 請求審查\n',
      commit_message: 'docs: add DEMO operation guide',
    });
    pull = await callApi(page, '/code-api/repositories/' + encodeURIComponent(repository.id) + '/pulls', 'POST', {
      head: branch,
      base: repository.default_branch || 'main',
      title: 'DEMO · 更新操作指南範例',
      body: 'DEMO 示範 PR：包含實際分支與文件提交，僅供公開產品操作畫面使用。',
      source_refs: [],
    });
  }
  assert(pull && pull.number && pull.state === 'open', 'The Code DEMO pull request is unavailable.');
  return { project, repository, pull };
}

async function waitForApp(page) {
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 15000 });
  await page.locator('.auth-page, .main-pane').first().waitFor({ state: 'visible', timeout: 20000 });
}

async function visit(page, route) {
  assert(route.startsWith('/'), 'App routes must be relative.');
  const response = await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
  assert(response && response.ok(), 'The QA page returned an unsuccessful HTTP response.');
  await waitForApp(page);
  assert(await page.evaluate(() => location.origin) === BASE, 'The browser left the isolated QA origin.');
}

async function dismissRecoveryCodes(page) {
  const modal = page.locator('.auth-recovery-modal');
  if (!await modal.isVisible().catch(() => false)) return;
  await modal.getByRole('button', { name: '顯示', exact: true }).click();
  await modal.getByRole('button', { name: '我已安全保存', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
}

async function signInOrSetup(page, email, password) {
  await visit(page, '/work');
  await page.locator('.auth-page').waitFor({ state: 'visible', timeout: 20000 });
  const heading = page.locator('.auth-heading h2');
  await heading.waitFor({ state: 'visible' });
  const text = await heading.innerText();
  if (text === '建立管理員帳號') {
    await page.getByLabel('姓名', { exact: true }).fill('Ordivant Docs QA');
    await page.getByLabel('電子郵件', { exact: true }).fill(email);
    await page.getByLabel('設定密碼', { exact: true }).fill(password);
    await page.getByLabel('再次輸入密碼', { exact: true }).fill(password);
    await page.getByRole('button', { name: '建立管理員', exact: true }).click();
    await dismissRecoveryCodes(page);
  } else if (text === '登入 Ordivant') {
    await page.getByLabel('電子郵件', { exact: true }).fill(email);
    await page.getByLabel('密碼', { exact: true }).fill(password);
    const submit = page.locator('.auth-page form button[type="submit"]');
    await submit.waitFor({ state: 'visible', timeout: 20000 });
    assert(await submit.isEnabled(), 'The QA login form is not ready to submit.');
    await submit.click();
  } else {
    throw new Error('The QA workspace did not show Setup or password login.');
  }
  await page.locator('.main-pane').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.auth-account-control').waitFor({ state: 'visible', timeout: 30000 });
}

async function setQaDisplayName(page) {
  const result = await page.evaluate(async name => {
    const identityResponse = await fetch('/auth-api/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!identityResponse.ok) return { ok: false, status: identityResponse.status };
    const identity = await identityResponse.json();
    if (identity.user.name === name) return { ok: true, unchanged: true };
    if (identity.user.role !== 'admin') return { ok: false, status: 403 };
    const response = await fetch('/auth-api/users/' + encodeURIComponent(identity.user.id), {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': identity.csrf_token,
      },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) return { ok: false, status: response.status };
    const user = await response.json();
    return { ok: user.name === name };
  }, 'Ordivant Demo');
  assert(result && result.ok, 'Could not set the synthetic QA display name (HTTP ' + (result && result.status || 0) + ').');
  if (!result.unchanged) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await page.locator('.auth-account-control').waitFor({ state: 'visible', timeout: 30000 });
  }
}

async function selectAntOption(page, selector, optionText) {
  const select = page.locator(selector).first();
  await select.waitFor({ state: 'visible', timeout: 20000 });
  await select.click();
  const dropdown = page.locator('.ant-select-dropdown:visible').last();
  await dropdown.waitFor({ state: 'visible' });
  await dropdown.getByText(optionText, { exact: true }).click();
}

async function selectWorkProject(page, project) {
  const selected = page.locator('.topbar-project .ant-select-selection-item').first();
  const label = await selected.innerText().catch(() => '');
  if (label.includes(project.key) && label.includes(project.name)) return;
  await selectAntOption(page, '.project-select', project.name);
  await page.locator('.task-list-shell').waitFor({ state: 'visible', timeout: 20000 });
}

async function selectProductProject(page, project) {
  await selectAntOption(page, '.product-scope-select', project.key + ' · ' + project.name);
}

async function selectLocale(page, locale) {
  await selectAntOption(page, '.language-control .ant-select', locale.label);
  await page.waitForFunction(expected => document.documentElement.lang === expected, locale.htmlLang, { timeout: 10000 });
}

async function expectHeading(page, text) {
  try {
    await page.getByRole('heading', { name: text, exact: true }).first().waitFor({ state: 'visible', timeout: 20000 });
  } catch {
    const details = await page.evaluate(() => ({
      path: location.pathname,
      language: document.documentElement.lang,
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).map(heading => heading.innerText.trim()).filter(Boolean),
    }));
    throw new Error('Expected heading "' + text + '"; current route=' + details.path + ', lang=' + details.language
      + ', headings=' + details.headings.join('|') + '.');
  }
}

async function capture(page, pageName, locale) {
  if (CONTENT_ONLY && !['run', 'knowledge', 'code'].includes(pageName)) return null;
  await page.locator('.ant-message-notice:visible').first().waitFor({ state: 'hidden', timeout: 10000 });
  const fileName = pageName + '-' + locale + '.png';
  await page.screenshot({ path: path.join(OUTPUT_DIR, fileName), fullPage: false });
  return 'docs/public/screenshots/' + fileName;
}

function dispatchButtonLocator(drawer, locale) {
  return drawer.locator('button').filter({ hasText: catalogMessage('派發給 Agent', locale.key) }).last();
}

async function createFixtures(page) {
  await visit(page, '/work');
  const work = await createOrReuseWorkFixtures(page);
  const knowledge = await createOrReuseKnowledgeFixture(page);
  const code = await createOrReuseCodeFixture(page);
  return { work, knowledge, code };
}

async function dispatchTaskFromUi(page, task, agent, locale) {
  const dispatchUrl = new URL('/api/tasks/' + encodeURIComponent(task.id) + '/dispatch', BASE).href;
  const responsePromise = page.waitForResponse(response =>
    response.url() === dispatchUrl && response.request().method() === 'POST', { timeout: 30000 })
    .then(response => ({ response }), error => ({ error }));
  const drawer = page.locator('.task-drawer');
  const dispatchSelect = drawer.locator('.claim-agent-select').last();
  await dispatchSelect.click();
  await page.locator('.ant-select-dropdown:visible').last().getByText(agent.name, { exact: true }).click();

  const dispatchButton = dispatchButtonLocator(drawer, locale);
  await dispatchButton.waitFor({ state: 'visible', timeout: 20000 });
  assert(await dispatchButton.isEnabled(), 'The Task Drawer dispatch button is disabled after selecting the Pi agent.');
  await dispatchButton.click();

  const dispatchResult = await responsePromise;
  if (dispatchResult.error) throw new Error('The Task Drawer dispatch request did not complete.');
  const response = dispatchResult.response;
  assert(response.ok(), 'The Task Drawer could not dispatch the DEMO task.');
  let dispatch;
  try { dispatch = safeData(await response.json()); } catch { throw new Error('The Task Drawer dispatch response was invalid.'); }
  assert(dispatch && dispatch.id && dispatch.payload && dispatch.payload.execution_mode === 'demo',
    'The Task Drawer did not admit the Run in DEMO mode.');
  return dispatch.id;
}

async function captureWorkPage(page, locale, project, task, runTask, agent, shouldDispatch) {
  await visit(page, '/work');
  await selectLocale(page, locale);
  await expectHeading(page, locale.work);
  await selectWorkProject(page, project);
  await expectHeading(page, locale.work);
  await page.locator('.task-list-shell').waitFor({ state: 'visible' });
  const taskRow = page.locator('.task-list-shell tr').filter({ hasText: task.title }).first();
  await taskRow.waitFor({ state: 'visible', timeout: 20000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const workPath = await capture(page, 'work', locale.key);
  await taskRow.click();
  const drawer = page.locator('.task-drawer');
  await drawer.waitFor({ state: 'visible' });
  await drawer.getByRole('heading', { name: task.title, exact: true }).waitFor({ state: 'visible' });
  const dispatchSelect = drawer.locator('.claim-agent-select').last();
  await dispatchSelect.click();
  await page.locator('.ant-select-dropdown:visible').last().getByText(agent.name, { exact: true }).click();
  const dispatchButton = dispatchButtonLocator(drawer, locale);
  const dispatchButtonCount = await dispatchButton.count();
  if (dispatchButtonCount !== 1) {
    const buttonLabels = await drawer.locator('button').evaluateAll(buttons => buttons.map(button =>
      (button.innerText || button.getAttribute('aria-label') || '').trim()).filter(Boolean));
    throw new Error('The Task Drawer dispatch button was not found by visible text; drawer buttons=' + buttonLabels.join('|') + '.');
  }
  assert(await dispatchButton.isEnabled(), 'The stable task dispatch control is not enabled for the Pi agent.');
  await page.evaluate(() => window.scrollTo(0, 0));
  const taskPath = await capture(page, 'task', locale.key);
  await drawer.locator('.ant-drawer-close').click();
  await drawer.waitFor({ state: 'hidden' });

  let runId = null;
  if (shouldDispatch) {
    const runTaskRow = page.locator('.task-list-shell tr').filter({ hasText: runTask.title }).first();
    await runTaskRow.waitFor({ state: 'visible', timeout: 20000 });
    await runTaskRow.click();
    await drawer.waitFor({ state: 'visible' });
    await drawer.getByRole('heading', { name: runTask.title, exact: true }).waitFor({ state: 'visible' });
    runId = await dispatchTaskFromUi(page, runTask, agent, locale);
    await drawer.locator('.ant-drawer-close').click();
    await drawer.waitFor({ state: 'hidden' });
  }

  const runNav = page.locator('.rail-nav button').filter({ hasText: locale.runs }).first();
  await runNav.click();
  await expectHeading(page, locale.runs);
  return { workPath, taskPath, runId };
}

async function captureRunPage(page, locale, runId) {
  const row = page.locator('.run-table-shell tr[aria-label*="' + runId + '"]');
  await row.waitFor({ state: 'visible', timeout: 30000 });
  await row.getByText(catalogMessage('已提交', locale.key), { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await row.click();
  const drawer = page.locator('.run-drawer');
  await drawer.waitFor({ state: 'visible' });
  await drawer.getByText('DEMO', { exact: true }).first().waitFor({ state: 'visible' });
  const eventList = drawer.locator('.run-event-list');
  await eventList.waitFor({ state: 'visible', timeout: 20000 });
  assert(await eventList.locator('.run-event').count() > 0, 'The DEMO Run has no timeline events.');
  await drawer.locator('.run-answer.rendered-markdown').waitFor({ state: 'visible' });
  assert(await drawer.locator('pre.run-answer').count() === 0, 'The Run reply is still rendered as raw source.');
  await drawer.locator('.ant-drawer-body').evaluate(element => { element.scrollTop = element.scrollHeight; });
  return capture(page, 'run', locale.key);
}

async function captureKnowledgePage(page, locale, fixture) {
  await visit(page, '/knowledge');
  await expectHeading(page, locale.knowledge);
  await selectProductProject(page, { key: fixture.space.key, name: fixture.space.name });
  const document = page.locator('.knowledge-document-item').filter({ hasText: fixture.title }).first();
  await document.waitFor({ state: 'visible', timeout: 20000 });
  await document.click();
  await page.locator('.knowledge-reader').getByRole('heading', { name: fixture.title, exact: true }).waitFor({ state: 'visible' });
  await expectHeading(page, locale.knowledge);
  const versionSelect = page.locator('.knowledge-reader .ant-select-selection-item');
  await versionSelect.waitFor({ state: 'visible' });
  assert((await versionSelect.innerText()).includes('2'), 'The Knowledge example has no published second version.');
  await page.locator('.knowledge-reader .markdown-content .rendered-markdown').waitFor({ state: 'visible' });
  assert(!/#|\*\*/.test(await document.locator('.document-item-summary').innerText()), 'The Knowledge search preview exposes Markdown heading or emphasis syntax.');
  return capture(page, 'knowledge', locale.key);
}

async function captureCodePage(page, locale, fixture) {
  await visit(page, '/code');
  await expectHeading(page, locale.code);
  await selectProductProject(page, fixture.project);
  const repository = page.locator('.repository-list-row').filter({ hasText: fixture.repository.name }).first();
  await repository.waitFor({ state: 'visible', timeout: 20000 });
  await repository.click();
  const pullNav = page.locator('.rail-nav button').filter({ hasText: locale.pulls }).first();
  await pullNav.click();
  await expectHeading(page, locale.pulls);
  const pullRow = page.locator('.pull-table-link').filter({ hasText: fixture.pull.title }).first();
  await pullRow.waitFor({ state: 'visible', timeout: 20000 });
  await pullRow.click();
  const drawer = page.locator('.code-pr-drawer');
  await drawer.waitFor({ state: 'visible' });
  await drawer.getByText(fixture.pull.title, { exact: false }).first().waitFor({ state: 'visible' });
  assert((await drawer.innerText()).includes(fixture.pull.title), 'The Code pull request detail is missing.');
  await drawer.locator('.rendered-markdown').waitFor({ state: 'visible' });
  const screenshot = await capture(page, 'code', locale.key);
  await drawer.locator('.ant-drawer-close').click();
  await drawer.waitFor({ state: 'hidden' });
  return screenshot;
}

async function captureLogin(page, locale) {
  await page.locator('.auth-page').waitFor({ state: 'visible', timeout: 20000 });
  await expectHeading(page, locale.login);
  const email = page.locator('.auth-page input[autocomplete="email"]');
  const password = page.locator('.auth-page input[autocomplete="current-password"]');
  await email.fill('');
  await password.fill('');
  assert(await email.inputValue() === '' && await password.inputValue() === '', 'The login form is not blank.');
  return capture(page, 'login', locale.key);
}

async function main() {
  inspectQaPortOwner();
  const email = process.env[ADMIN_EMAIL_ENV];
  const password = process.env[ADMIN_PASSWORD_ENV];
  assert(email && password, 'The parent QA wrapper must provide the synthetic login through environment variables.');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-extensions', '--disable-background-networking'] });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.route('**/*', route => {
    let origin = '';
    try { origin = new URL(route.request().url()).origin; } catch { /* Block malformed destinations. */ }
    return origin === BASE ? route.continue() : route.abort('blockedbyclient');
  });
  await context.addInitScript(({ origin, key }) => {
    if (location.origin === origin && !localStorage.getItem(key)) localStorage.setItem(key, 'zh-TW');
  }, { origin: BASE, key: 'ordivant.locale' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  let pageErrorCount = 0;
  page.on('pageerror', () => { pageErrorCount += 1; });

  try {
    await signInOrSetup(page, email, password);
    await setQaDisplayName(page);
    const principal = await callApi(page, '/api/me');
    assert(principal.kind === 'human' && ['admin', 'manager'].includes(principal.role),
      'The synthetic QA account needs a human admin or manager Work role for the dispatch UI.');
    const fixtures = await createFixtures(page);
    const outputs = [];
    let runId = fixtures.work.existingRun && fixtures.work.existingRun.id || null;
    if (runId) {
      await waitForDemoRun(page, runId);
      const projectRuns = await callApi(page, '/api/runs?project_id=' + encodeURIComponent(fixtures.work.project.id));
      assert(projectRuns.length === 1 && projectRuns[0].id === runId,
        'The isolated DEMO project must contain exactly one Run.');
    }

    for (const locale of LOCALES) {
      await selectLocale(page, locale);
      const workScreens = await captureWorkPage(
        page, locale, fixtures.work.project, fixtures.work.task, fixtures.work.runTask, fixtures.work.agent, !runId,
      );
      if (!runId) {
        runId = workScreens.runId;
        assert(runId, 'The Task Drawer did not return a Run id.');
        await waitForDemoRun(page, runId);
        const projectRuns = await callApi(page, '/api/runs?project_id=' + encodeURIComponent(fixtures.work.project.id));
        assert(projectRuns.length === 1 && projectRuns[0].id === runId,
          'The Task Drawer dispatch must create exactly one Run in the isolated DEMO project.');
      }
      outputs.push(workScreens.workPath, workScreens.taskPath);
      outputs.push(await captureRunPage(page, locale, runId));
      outputs.push(await captureKnowledgePage(page, locale, fixtures.knowledge));
      outputs.push(await captureCodePage(page, locale, fixtures.code));
    }

    await page.locator('.auth-account-control button').nth(1).click();
    await page.locator('.auth-page').waitFor({ state: 'visible', timeout: 20000 });
    for (const locale of LOCALES) {
      await selectLocale(page, locale);
      await visit(page, '/work');
      outputs.push(await captureLogin(page, locale));
    }

    assert(pageErrorCount === 0, 'The browser recorded ' + pageErrorCount + ' page JavaScript errors.');
    const captured = outputs.filter(Boolean);
    const expected = CONTENT_ONLY ? 9 : 18;
    assert(captured.length === expected, 'Expected ' + expected + ' screenshots but captured ' + captured.length + '.');
    for (const output of captured) process.stdout.write(output + '\n');
    process.stdout.write(String(captured.length) + ' screenshots captured; Markdown content surfaces verified; browser JavaScript errors: 0\n');
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(error => {
  let message = error && typeof error.message === 'string' ? error.message : 'Unknown capture error.';
  for (const secret of [process.env[ADMIN_EMAIL_ENV], process.env[ADMIN_PASSWORD_ENV]]) {
    if (secret) message = message.split(secret).join('[redacted]');
  }
  process.stderr.write('Screenshot capture failed: ' + message + '\n');
  process.stderr.write('Credentials and browser state were not written.\n');
  process.exitCode = 1;
});
