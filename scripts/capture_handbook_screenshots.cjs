#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(path.resolve('.cache/browser-qa/node_modules/playwright'));

const BASE = 'http://127.0.0.1:8092';
const EXPECTED_COMPOSE_PROJECT = 'ordivant-docs-handbook-qa';
const OUTPUT_DIR = path.resolve('docs/public/screenshots');
const VIEWPORT = { width: 1400, height: 900 };
const ADMIN_EMAIL_ENV = 'ORDIVANT_QA_EMAIL';
const ADMIN_PASSWORD_ENV = 'ORDIVANT_QA_PASSWORD';
const RUN_TAG = Date.now().toString(36);
const MARKDOWN_CHECK_ONLY = process.argv.includes('--markdown-check');

const LOCALES = [
  { key: 'zh-TW', label: '繁體中文', htmlLang: 'zh-Hant' },
  { key: 'en', label: 'English', htmlLang: 'en' },
  { key: 'zh-CN', label: '简体中文', htmlLang: 'zh-Hans' },
];
const SCREEN_NAMES = ['agent', 'models', 'template', 'workflow', 'tools', 'review'];
const REVIEW_ONLY = process.argv.includes('--review-only') || process.env.HANDBOOK_REVIEW_ONLY === '1';
const ACCEPTANCE_REPORT = path.resolve('.data/validation/handbook-platform-acceptance.json');
const PROJECT = {
  key: 'HDBKQA',
  name: '產品上線準備 · 文件示例',
  description: '合成資料：示範 Agent 設定、工作流程、工具隔離與成果審核。',
};
const PROFILE_NAME = 'Docs QA Isolated Workspace';
const TEMPLATE_KEY = 'docs-handbook-release-worker';
const TEMPLATE_NAME = 'Release Readiness Writer';
const AGENT_NAME = 'Pi Worker · Release Guide QA';
const WORKFLOW_KEY = 'docs-handbook-release-review';
const WORKFLOW_NAME = '產品上線核對流程';
const REVIEW_TASK_TITLE = 'DEMO · Northstar synthetic launch checklist · independent review';
const REVIEW_ARTIFACT_TITLE = 'Northstar synthetic launch checklist';
const PUBLIC_GUIDE_URI = 'docs/guide/first-project.md#practice-background';
const MARKDOWN_CHECK_CONTENT = [
  '# Markdown safety check',
  '',
  'This is **bold** and *emphasized* text.',
  'Inline `code` stays literal.',
  '',
  '[Safe external link](https://docs.example.org/guide)',
  '',
  '| Area | Status |',
  '| --- | --- |',
  '| Product | Unknown |',
  '',
  '```html',
  '<script>window.__markdownCodeExecuted = true</script>',
  '```',
  '',
  '- [ ] Unchecked task',
  '- [x] Checked task',
  '',
  '<script>window.__markdownScriptRan = true</script>',
  '<img src="data:image/png;base64,invalid" onerror="window.__markdownImageHandlerRan = true" />',
  '[JavaScript link](javascript:window.__markdownScriptRan=true)',
  '[Data link](data:text/html,blocked)',
  '![Unsafe image](javascript:window.__markdownImageHandlerRan=true)',
].join('\n');
const REVIEW_WORKER_EMAIL = 'qa-handbook-worker@example.com';
const REVIEW_WORKER_NAME = 'QA Review Separation Worker';

let enCatalog;
let zhCnCatalog;
let pageErrorCount = 0;
const externalHttpRequests = [];
let blockedInjectedRequestCount = 0;
const blockedInjectedHost = 'local.adguard.org';
const inMemorySecrets = new Set();

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
  assert(bindings.every(binding => binding.project === EXPECTED_COMPOSE_PROJECT),
    'Port 8092 has a Docker binding outside the expected QA Compose project.');
}

function cleanData(value) {
  if (Array.isArray(value)) return value.map(cleanData);
  if (!value || typeof value !== 'object') return value;
  const safe = {};
  for (const [key, child] of Object.entries(value)) {
    if (/token|password|secret|cookie|authorization|csrf|recovery|invitation_code|api[_-]?key/i.test(key)) continue;
    safe[key] = cleanData(child);
  }
  return safe;
}

async function callApi(page, route, method = 'GET', body = undefined, options = {}) {
  assert(/^\/(api|auth-api)\//.test(route), 'Refusing an unapproved QA API route.');
  const result = await page.evaluate(async ({ origin, route, method, body, skipCsrf, exposeInvitationCode }) => {
    if (location.origin !== origin) return { ok: false, status: 0 };
    const url = new URL(route, location.origin);
    if (url.origin !== location.origin || !/^\/(api|auth-api)\//.test(url.pathname)) return { ok: false, status: 0 };
    const headers = new Headers();
    const request = { method, credentials: 'same-origin', cache: 'no-store', headers };
    if (body !== undefined) {
      if (!skipCsrf) {
        const identityResponse = await fetch('/auth-api/me', { credentials: 'same-origin', cache: 'no-store' });
        if (!identityResponse.ok) return { ok: false, status: identityResponse.status };
        const identity = await identityResponse.json();
        headers.set('X-CSRF-Token', identity.csrf_token);
      }
      if (url.pathname.startsWith('/api/')) headers.set('Idempotency-Key', crypto.randomUUID());
      headers.set('Content-Type', 'application/json');
      request.body = JSON.stringify(body);
    }
    let response;
    try { response = await fetch(url.href, request); }
    catch { return { ok: false, status: 0 }; }
    if (!response.ok) return { ok: false, status: response.status };
    if (response.status === 204) return { ok: true, status: response.status, data: null };
    let data;
    try { data = await response.json(); }
    catch { return { ok: false, status: response.status }; }
    const strip = value => {
      if (Array.isArray(value)) return value.map(strip);
      if (!value || typeof value !== 'object') return value;
      const safe = {};
      for (const [key, child] of Object.entries(value)) {
        if (/token|password|secret|cookie|authorization|csrf|recovery|invitation_code|api[_-]?key/i.test(key)) continue;
        safe[key] = strip(child);
      }
      return safe;
    };
    if (exposeInvitationCode && url.pathname === '/auth-api/invitations') {
      return { ok: true, status: response.status, data: { invitation_code: data.invitation_code } };
    }
    return { ok: true, status: response.status, data: strip(data) };
  }, {
    origin: BASE,
    route,
    method,
    body,
    skipCsrf: options.skipCsrf === true,
    exposeInvitationCode: options.exposeInvitationCode === true,
  });
  if (!result.ok) throw new Error('QA API request failed (' + method + ' ' + route + ', HTTP ' + result.status + ').');
  return result.data;
}

function translation(source, locale) {
  if (locale.key === 'zh-TW') return source;
  if (locale.key === 'zh-CN') {
    if (!zhCnCatalog) zhCnCatalog = Object.assign(
      {},
      JSON.parse(fs.readFileSync(path.resolve('frontend/src/i18n/catalogs/work.zh-CN.json'), 'utf8')),
      JSON.parse(fs.readFileSync(path.resolve('frontend/src/i18n/catalogs/account.zh-CN.json'), 'utf8')),
    );
    const translated = zhCnCatalog[source];
    assert(translated, 'A required Simplified Chinese translation is missing: ' + source);
    return translated;
  }
  if (!enCatalog) enCatalog = fs.readFileSync(path.resolve('frontend/src/i18n/catalogs/work.en.ts'), 'utf8')
    + fs.readFileSync(path.resolve('frontend/src/i18n/catalogs/account.en.ts'), 'utf8');
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = enCatalog.match(new RegExp("^[\\t ]*['\\\"]" + escaped + "['\\\"]\\s*:\\s*'((?:\\\\.|[^'\\\\])*)'", 'm'));
  assert(match && match[1], 'A required English translation is missing: ' + source);
  return match[1].replaceAll("\\'", "'").replaceAll('\\\\', '\\');
}

async function visit(page, route) {
  assert(route.startsWith('/'), 'Browser routes must be relative.');
  const response = await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
  assert(response && response.ok(), 'The isolated QA page returned an unsuccessful HTTP response.');
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 20000 });
  await page.locator('.auth-page, .main-pane').first().waitFor({ state: 'visible', timeout: 30000 });
  assert(await page.evaluate(() => location.origin) === BASE, 'The browser left the isolated QA origin.');
}

async function selectAntOption(page, select, optionText) {
  await select.waitFor({ state: 'visible', timeout: 20000 });
  await select.click();
  const dropdown = page.locator('.ant-select-dropdown:visible').last();
  await dropdown.waitFor({ state: 'visible', timeout: 10000 });
  await dropdown.getByText(optionText, { exact: true }).last().click();
}

async function selectLocale(page, locale) {
  await selectAntOption(page, page.locator('.language-control .ant-select'), locale.label);
  await page.waitForFunction(expected => document.documentElement.lang === expected, locale.htmlLang, { timeout: 10000 });
}

async function selectProject(page, project) {
  const selected = page.locator('.topbar-project .project-select .ant-select-selection-item').first();
  const current = await selected.innerText().catch(() => '');
  if (current.includes(project.key) && current.includes(project.name)) return;
  await selectAntOption(page, page.locator('.topbar-project .project-select'), project.name);
  await page.locator('.topbar-project .project-select .ant-select-selection-item').filter({ hasText: project.key }).waitFor({ state: 'visible' });
}

async function openWorkProject(page, project) {
  await visit(page, '/work');
  await page.locator('.main-pane').waitFor({ state: 'visible', timeout: 30000 });
  await selectProject(page, project);
}

async function clickNav(page, sourceLabel, locale) {
  const label = translation(sourceLabel, locale);
  await page.locator('.rail-nav .nav-item').filter({ hasText: label }).first().click();
}

async function clickSegmented(page, selector, sourceLabel, locale) {
  const label = translation(sourceLabel, locale);
  await page.locator(selector).locator('.ant-segmented-item').filter({ hasText: label }).click();
}

async function waitHeading(page, source, locale) {
  const name = translation(source, locale);
  await page.getByRole('heading', { name, exact: true }).first().waitFor({ state: 'visible', timeout: 20000 });
}

async function dismissRecoveryCodes(page) {
  const modal = page.locator('.auth-recovery-modal');
  if (!await modal.isVisible().catch(() => false)) return;
  const display = modal.locator('.auth-recovery-toolbar button').filter({ hasText: '顯示' }).last();
  if (await display.isVisible().catch(() => false)) await display.click();
  await modal.locator('.auth-recovery-codes-visible').waitFor({ state: 'visible', timeout: 10000 });
  const saved = modal.locator('.ant-modal-footer button').last();
  await page.waitForFunction(() => {
    const dialog = document.querySelector('.auth-recovery-modal');
    const button = dialog && dialog.querySelector('.ant-modal-footer button');
    return Boolean(dialog && dialog.querySelector('.auth-recovery-codes-visible') && button && !button.disabled);
  }, null, { timeout: 10000 });
  await saved.click();
  await modal.waitFor({ state: 'hidden', timeout: 10000 });
}

async function loginWithPassword(page, email, password, allowSetup = false) {
  await visit(page, '/work');
  if (await page.locator('.main-pane').isVisible().catch(() => false)) return;
  const heading = page.locator('.auth-heading h2');
  await heading.waitFor({ state: 'visible', timeout: 20000 });
  const title = await heading.innerText();
  if (allowSetup && title === '建立管理員帳號') {
    await page.getByLabel('姓名', { exact: true }).fill('QA Handbook Admin');
    await page.getByLabel('電子郵件', { exact: true }).fill(email);
    await page.getByLabel('設定密碼', { exact: true }).fill(password);
    await page.getByLabel('再次輸入密碼', { exact: true }).fill(password);
    await page.locator('.auth-page form button[type="submit"]').click();
  } else {
    assert(title === '登入 Ordivant', 'The QA workspace did not show the expected password login.');
    await page.getByLabel('電子郵件', { exact: true }).fill(email);
    await page.getByLabel('密碼', { exact: true }).fill(password);
    const submit = page.locator('.auth-page form button[type="submit"]');
    await submit.waitFor({ state: 'visible', timeout: 20000 });
    assert(await submit.isEnabled(), 'The synthetic QA login form is not ready.');
    await submit.click();
  }
  await page.locator('.main-pane').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.auth-account-control').waitFor({ state: 'visible', timeout: 30000 });
  await dismissRecoveryCodes(page);
}

function profileBody(projectId, enabled = true) {
  return {
    ...(projectId ? { project_id: projectId } : {}),
    name: PROFILE_NAME,
    enabled,
    limits: {
      timeout_seconds: 45,
      memory_mb: 256,
      cpu_count: 1,
      pids_limit: 32,
      output_bytes: 8192,
      workspace_mb: 16,
    },
  };
}

function templateDefinition(profileId) {
  return {
    role: 'worker',
    capabilities: ['release-readiness', 'documentation'],
    instructions: 'Prepare a concise release checklist from scoped project context. Cite every source. Do not call external providers or services.',
    model_config: null,
    tool_connection_ids: [],
    sandbox_profile_id: profileId,
    limits: { max_turns: 4, timeout_seconds: 120 },
  };
}

function workflowSteps(agentId) {
  return [
    {
      key: 'collect-evidence',
      title: '整理上線準備項目',
      goal: '彙整文件、權限與部署檢查項目，並標示來源。',
      description: '在專案範圍內整理可追溯的準備清單。',
      acceptance_criteria: ['每項檢查都有可讀來源。', '未知事項明確標示為待確認。'],
      dependency_keys: [],
      agent_id: agentId,
      capabilities: [],
      reviewer_id: null,
      priority: 'high',
    },
    {
      key: 'independent-review',
      title: '獨立審核準備清單',
      goal: '核對清單證據與驗收條件，提出接受或退回意見。',
      description: '必須等上游清單完成後才可進行。',
      acceptance_criteria: ['逐項核對來源與範圍。', '由非提交者完成審查。'],
      dependency_keys: ['collect-evidence'],
      agent_id: null,
      capabilities: [],
      reviewer_id: null,
      priority: 'medium',
    },
  ];
}

function reviewTaskBody(projectId, agentId) {
  return {
    project_id: projectId,
    title: REVIEW_TASK_TITLE,
    description: 'Synthetic practice task based on the public first-project guide.',
    goal: 'Prepare a reviewable checklist for six launch-readiness areas while preserving unknowns.',
    inputs: 'Northstar synthetic practice data from docs/en/guide/first-project.md#practice-background; no API or external source is needed.',
    scope: 'Write one checklist line for each of Product, Login, Backup, Docs, Support, and Analytics. Preserve unknown status and unassigned owners, and give each line a next action.',
    constraints: 'Do not invent dates, owners, approvals, or test results. Do not change external systems. Do not call a model or external service.',
    acceptance_criteria: [
      'The checklist has a line for Product, Login, Backup, Docs, Support, and Analytics.',
      'Every missing owner is marked unassigned and every unsupported status is marked unknown.',
      'Every line includes a next action and the public guide source URI.',
      'No test, approval, or external system check is claimed.',
      'The submitter and reviewer are different people.',
    ],
    priority: 'high',
    assignee_id: agentId,
    reviewer_id: null,
    dependency_ids: [],
    labels: ['DEMO', 'release-readiness'],
  };
}

async function createOrReuseFixtures(page) {
  const projects = await callApi(page, '/api/projects');
  let project = projects.find(item => item.key === PROJECT.key);
  if (!project) project = await callApi(page, '/api/projects', 'POST', PROJECT);
  assert(project && project.id, 'The synthetic documentation project is unavailable.');

  const profiles = await callApi(page, '/api/sandbox-profiles?project_id=' + encodeURIComponent(project.id));
  let profile = profiles.find(item => item.name === PROFILE_NAME);
  const desiredProfile = profileBody(project.id);
  if (!profile) profile = await callApi(page, '/api/sandbox-profiles', 'POST', desiredProfile);
  else {
    const existingBody = profileBody(undefined, profile.enabled);
    if (JSON.stringify(profile.limits) !== JSON.stringify(existingBody.limits) || !profile.enabled) {
      profile = await callApi(page, '/api/sandbox-profiles/' + encodeURIComponent(profile.id), 'PATCH', profileBody(undefined));
    }
  }
  assert(profile && profile.id && profile.enabled === true, 'The synthetic Sandbox profile is unavailable.');

  const templates = await callApi(page, '/api/agent-templates');
  let template = templates.find(item => item.key === TEMPLATE_KEY);
  const desiredDefinition = templateDefinition(profile.id);
  if (!template) {
    template = await callApi(page, '/api/agent-templates', 'POST', {
      key: TEMPLATE_KEY,
      name: TEMPLATE_NAME,
      description: '合成文件示例：以明確範圍、來源與隔離設定產生上線清單。',
      definition: desiredDefinition,
    });
  }
  assert(template && template.id && template.definition.role === 'worker', 'The saved Agent template is unavailable.');

  const agents = await callApi(page, '/api/agents?project_id=' + encodeURIComponent(project.id));
  let agent = agents.find(item => item.name === AGENT_NAME && item.runtime === 'pi' && item.role === 'worker');
  const executionConfig = {
    instructions: desiredDefinition.instructions,
    tool_connection_ids: [],
    sandbox_profile_id: profile.id,
    limits: { max_turns: 4, timeout_seconds: 120 },
  };
  if (!agent) {
    agent = await callApi(page, '/api/agents', 'POST', {
      name: AGENT_NAME,
      role: 'worker',
      capabilities: desiredDefinition.capabilities,
      project_ids: [project.id],
      runtime: 'pi',
      model_config: null,
      template_id: template.id,
      execution_config: executionConfig,
    });
  }
  assert(agent && agent.id && agent.runtime === 'pi' && agent.status === 'available' && agent.model_config === null
    && agent.effective_model_config === null, 'The Pi Worker must have no configured model provider.');

  const workflows = await callApi(page, '/api/workflows?project_id=' + encodeURIComponent(project.id));
  let workflow = workflows.find(item => item.key === WORKFLOW_KEY);
  const steps = workflowSteps(agent.id);
  if (!workflow) {
    workflow = await callApi(page, '/api/workflows', 'POST', {
      project_id: project.id,
      key: WORKFLOW_KEY,
      name: WORKFLOW_NAME,
      description: 'DEMO 兩步流程：先整理來源，再由不同人員獨立審查。',
      steps,
      schedule: { enabled: false, interval_minutes: 60, max_runs: 1 },
    });
  }
  assert(workflow && workflow.id && workflow.steps.length === 2
    && workflow.steps[1].dependency_keys.includes(workflow.steps[0].key),
  'The saved workflow must have two steps and a real prerequisite.');

  const tasks = await callApi(page, '/api/tasks?project_id=' + encodeURIComponent(project.id));
  let reviewTask = tasks.find(item => item.title === REVIEW_TASK_TITLE);
  if (!reviewTask) reviewTask = await callApi(page, '/api/tasks', 'POST', reviewTaskBody(project.id, agent.id));
  else if (reviewTask.assignee_id !== agent.id) {
    reviewTask = await callApi(page, '/api/tasks/' + encodeURIComponent(reviewTask.id), 'PATCH', { assignee_id: agent.id });
  }
  assert(reviewTask && reviewTask.id, 'The synthetic review task is unavailable.');

  const settings = await callApi(page, '/api/model-settings');
  assert(Array.isArray(settings.providers) && settings.providers.length === 0,
    'The isolated QA workspace already has model providers; refusing to display or alter them.');
  return { project, profile, template, agent, workflow, reviewTask };
}

async function waitForTaskToBeReviewable(page, taskId) {
  const deadline = Date.now() + 360000;
  let context = await callApi(page, '/api/tasks/' + encodeURIComponent(taskId) + '/context');
  while (context.task.status === 'in_progress' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    context = await callApi(page, '/api/tasks/' + encodeURIComponent(taskId) + '/context');
  }
  assert(['ready', 'backlog', 'in_review', 'done'].includes(context.task.status),
    'The QA review task is in an unexpected state.');
  return context;
}

function installBrowserGuards(context) {
  context.route('**/*', route => {
    let url;
    try { url = new URL(route.request().url()); }
    catch { return route.abort('blockedbyclient'); }
    if (url.origin === BASE) return route.continue();
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (url.hostname === blockedInjectedHost) blockedInjectedRequestCount += 1;
      else externalHttpRequests.push(url.origin);
    }
    return route.abort('blockedbyclient');
  });
  context.addInitScript(({ origin, key }) => {
    if (location.origin === origin && !localStorage.getItem(key)) localStorage.setItem(key, 'zh-TW');
  }, { origin: BASE, key: 'ordivant.locale' });
}

function trackPageErrors(page) {
  page.setDefaultTimeout(15000);
  page.on('pageerror', () => { pageErrorCount += 1; });
}

async function ensureWorkerPage(browser, adminPage, project, password) {
  const usersResponse = await callApi(adminPage, '/auth-api/users');
  const users = Array.isArray(usersResponse) ? usersResponse : usersResponse.users;
  assert(Array.isArray(users), 'The isolated QA user list is unavailable.');
  const existingUser = users.find(user => user.email === REVIEW_WORKER_EMAIL);
  if (existingUser) assert(existingUser.active, 'The synthetic review Worker account is disabled.');

  const workerContext = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  installBrowserGuards(workerContext);
  const workerPage = await workerContext.newPage();
  trackPageErrors(workerPage);
  inMemorySecrets.add(REVIEW_WORKER_EMAIL);
  inMemorySecrets.add(password);

  if (existingUser) {
    await loginWithPassword(workerPage, REVIEW_WORKER_EMAIL, password, false);
  } else {
    const invitation = await callApi(adminPage, '/auth-api/invitations', 'POST', {
      email: REVIEW_WORKER_EMAIL,
      name: REVIEW_WORKER_NAME,
      role: 'member',
      permissions: { work: { role: 'manager', scope_ids: [project.id] } },
    }, { exposeInvitationCode: true });
    const invitationCode = invitation && invitation.invitation_code;
    assert(invitationCode, 'The isolated QA Worker invitation did not return its one-time code.');
    inMemorySecrets.add(invitationCode);
    await visit(workerPage, '/work');
    const accepted = await callApi(workerPage, '/auth-api/accept-invitation', 'POST', {
      invitation_code: invitationCode,
      password,
    }, { skipCsrf: true });
    assert(accepted, 'The synthetic Worker invitation was not accepted.');
    await workerPage.reload({ waitUntil: 'domcontentloaded' });
    await workerPage.locator('.main-pane').waitFor({ state: 'visible', timeout: 30000 });
    await workerPage.locator('.auth-account-control').waitFor({ state: 'visible', timeout: 30000 });
    await dismissRecoveryCodes(workerPage);
  }

  const principal = await callApi(workerPage, '/api/me');
  assert(principal.kind === 'human' && principal.role === 'manager'
    && principal.project_ids.length === 1 && principal.project_ids.includes(project.id),
  'The synthetic Work manager must be scoped only to this QA project.');
  return { context: workerContext, page: workerPage, principal };
}

async function openTask(page, task, locale) {
  const row = page.locator('.task-list-shell .ant-table-row').filter({ hasText: task.title }).first();
  await row.waitFor({ state: 'visible', timeout: 20000 });
  await row.click();
  const drawer = page.locator('.task-drawer');
  await drawer.waitFor({ state: 'visible', timeout: 15000 });
  await drawer.getByText(task.title, { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  return drawer;
}

async function claimAndSubmitFromUi(workerPage, project, task, agent, locale) {
  await openWorkProject(workerPage, project);
  await workerPage.locator('.task-list-shell').waitFor({ state: 'visible', timeout: 20000 });
  await openTask(workerPage, task, locale);
  const selection = workerPage.locator('.claim-bar .claim-agent-select').first();
  await selectAntOption(workerPage, selection, agent.name);
  const claimButton = workerPage.locator('.claim-bar button').filter({ hasText: translation('認領任務', locale) }).first();
  await claimButton.click();
  await workerPage.locator('.lease-panel').waitFor({ state: 'visible', timeout: 20000 });
  const submitButton = workerPage.locator('.lease-panel button').filter({ hasText: translation('提交成果', locale) }).first();
  await submitButton.click();

  const modal = workerPage.locator('.ant-modal:visible').last();
  await modal.waitFor({ state: 'visible', timeout: 10000 });
  await modal.getByLabel(translation('完成摘要', locale), { exact: true }).fill(
    'Prepared a human-authored checklist for all six launch-readiness areas from the synthetic practice data. Unknown statuses and unassigned owners are preserved, with a next action for each. No tests, approvals, or external system checks are claimed.',
  );
  const kind = modal.locator('.ant-form-item').filter({ hasText: translation('證據類型', locale) }).locator('.ant-select').first();
  await selectAntOption(workerPage, kind, translation('文件', locale));
  await modal.getByLabel(translation('證據標題', locale), { exact: true }).fill(REVIEW_ARTIFACT_TITLE);
  await modal.getByLabel('URI', { exact: true }).fill(PUBLIC_GUIDE_URI);
  await modal.getByLabel(translation('證據內容', locale), { exact: true }).fill(
    '- [ ] Product: confirm release scope and owner; owner unassigned, status unknown; next action is to confirm scope and owner.\n' +
    '- [ ] Login: sign-in setup and validation evidence not supplied; owner unassigned, status unknown; next action is to obtain the approved setup and evidence.\n' +
    '- [ ] Backup: owner, latest backup record, and restore evidence not supplied; owner unassigned, status unknown; next action is to obtain backup and restore records.\n' +
    '- [ ] Docs: draft release notes are needed; owner unassigned, status unknown; next action is to assign a documentation owner and provide a draft.\n' +
    '- [ ] Support: owner, coverage hours, and escalation path not supplied; owner unassigned, status unknown; next action is to confirm support arrangements.\n' +
    '- [ ] Analytics: success metrics, event mapping, and dashboard evidence not supplied; owner unassigned, status unknown; next action is to confirm metrics and evidence.\n' +
    'Source: ' + PUBLIC_GUIDE_URI + '\n' +
    'Synthetic human-authored example only. No tests, approvals, or external system checks are claimed.',
  );
  await modal.locator('.ant-modal-footer .ant-btn-primary').last().click();
  await modal.waitFor({ state: 'hidden', timeout: 25000 });
  const submitted = await callApi(workerPage, '/api/tasks/' + encodeURIComponent(task.id) + '/context');
  assert(submitted.task.status === 'in_review' && submitted.artifacts.length > 0,
    'The Worker UI submission is not reviewable (status=' + submitted.task.status
      + ', evidence=' + submitted.artifacts.length + ').');
}

async function inspectAcceptedResult(page, project, task, agent, adminPrincipal, expectedSubmitterId) {
  const context = await callApi(page, '/api/tasks/' + encodeURIComponent(task.id) + '/context');
  const events = await callApi(page, '/api/events?project_id=' + encodeURIComponent(project.id));
  const submitted = events.find(event => event.entity_id === task.id && event.action === 'task.submitted');
  const accepted = events.find(event => event.entity_id === task.id && event.action === 'task.review.accept');
  assert(context.task.status === 'done', 'The review task is not done after acceptance.');
  assert(context.task.reviewer_id === null, 'The review screenshot task must not designate a specific reviewer.');
  assert(context.executions.some(execution => execution.agent_id === agent.id && execution.status === 'accepted'),
    'The review execution is not accepted.');
  const publicArtifact = context.artifacts.find(artifact => artifact.title === REVIEW_ARTIFACT_TITLE);
  assert(publicArtifact && publicArtifact.uri === PUBLIC_GUIDE_URI && publicArtifact.content
    && publicArtifact.content.includes(PUBLIC_GUIDE_URI)
    && ['Product', 'Login', 'Backup', 'Docs', 'Support', 'Analytics'].every(area => publicArtifact.content.includes(area))
    && publicArtifact.content.includes('owner unassigned') && publicArtifact.content.includes('status unknown')
    && !/docs\/(?:contracts|project-plan)\.md/i.test(publicArtifact.uri + '\n' + publicArtifact.content),
  'The accepted result is missing its public guide source or six-category synthetic evidence.');
  assert(submitted && accepted && submitted.actor_id !== accepted.actor_id
    && accepted.actor_id === adminPrincipal.id,
  'The API audit events do not show different submitter and review actors.');
  if (expectedSubmitterId) assert(submitted.actor_id === expectedSubmitterId,
    'The actual Worker identity did not submit the result.');
  return context;
}

async function ensureAcceptedReview(browser, adminPage, fixtures, adminPrincipal, password) {
  let context = await waitForTaskToBeReviewable(adminPage, fixtures.reviewTask.id);
  let worker = null;
  if (context.task.status === 'ready' || context.task.status === 'backlog') {
    if (context.task.status === 'backlog') {
      context = await callApi(adminPage, '/api/tasks/' + encodeURIComponent(fixtures.reviewTask.id), 'PATCH', { status: 'ready' });
    }
    worker = await ensureWorkerPage(browser, adminPage, fixtures.project, password);
    await claimAndSubmitFromUi(worker.page, fixtures.project, fixtures.reviewTask, fixtures.agent, LOCALES[0]);
    context = await callApi(adminPage, '/api/tasks/' + encodeURIComponent(fixtures.reviewTask.id) + '/context');
  }

  if (context.task.status === 'in_review') {
    const events = await callApi(adminPage, '/api/events?project_id=' + encodeURIComponent(fixtures.project.id));
    const submitted = events.find(event => event.entity_id === fixtures.reviewTask.id && event.action === 'task.submitted');
    assert(submitted && submitted.actor_id !== adminPrincipal.id,
      'The pending submission was not made by an independent human worker.');
    if (worker) assert(submitted.actor_id === worker.principal.id, 'The invited Worker did not submit the task.');

    const locale = LOCALES[0];
    await openWorkProject(adminPage, fixtures.project);
    await clickNav(adminPage, '任務', locale);
    await waitHeading(adminPage, '任務工作區', locale);
    const drawer = await openTask(adminPage, fixtures.reviewTask, locale);
    await drawer.locator('.detail-tabs .ant-tabs-tab').filter({ hasText: translation('執行與審核', locale) }).click();
    await drawer.locator('.execution-view').waitFor({ state: 'visible', timeout: 15000 });
    const reviewButton = drawer.locator('button').filter({ hasText: translation('通過', locale) }).first();
    await reviewButton.waitFor({ state: 'visible', timeout: 15000 });
    await reviewButton.click();
    const reviewModal = adminPage.locator('.ant-modal:visible').last();
    await reviewModal.waitFor({ state: 'visible', timeout: 10000 });
    await reviewModal.getByLabel(translation('審核意見', locale), { exact: true }).fill(
      'Checked all six areas against the public practice guide. Unknown statuses and unassigned owners are preserved; no tests, approvals, or external checks are claimed. The submitter is a different project-scoped Manager.',
    );
    await reviewModal.locator('.ant-modal-footer .ant-btn-primary').last().click();
    await adminPage.waitForFunction(async ({ origin, taskId }) => {
      const response = await fetch(origin + '/api/tasks/' + encodeURIComponent(taskId) + '/context', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return false;
      const context = await response.json();
      return context.task.status === 'done' && context.executions.some(execution => execution.status === 'accepted');
    }, { origin: BASE, taskId: fixtures.reviewTask.id }, { timeout: 20000 });
  }

  const result = await inspectAcceptedResult(adminPage, fixtures.project, fixtures.reviewTask, fixtures.agent, adminPrincipal,
    worker && worker.principal.id);
  const acceptedExecution = result.executions.some(execution => execution.agent_id === fixtures.agent.id && execution.status === 'accepted');
  return {
    context: result,
    workerContext: worker && worker.context,
    acceptance: {
      task_status: result.task.status,
      execution_accepted: acceptedExecution,
      artifact_count: result.artifacts.length,
      submitter_differs_from_reviewer: true,
      reviewer_id_null: result.task.reviewer_id === null,
      source_evidence_verified: true,
    },
  };
}

async function scrollModalBody(modal, amount) {
  const body = modal.locator('.ant-modal-body');
  await body.evaluate((element, requested) => {
    element.scrollTop = Math.min(requested, Math.max(0, element.scrollHeight - element.clientHeight));
  }, amount);
}

async function saveScreenshot(page, screenName, locale, outputs) {
  assert(SCREEN_NAMES.includes(screenName), 'Refusing an unexpected handbook screenshot name.');
  const htmlLang = await page.locator('html').getAttribute('lang');
  assert(htmlLang === locale.htmlLang, 'The active UI language does not match the screenshot locale.');
  const fileName = screenName + '-' + locale.key + '.png';
  const outputPath = path.join(OUTPUT_DIR, fileName);
  await page.screenshot({ path: outputPath, fullPage: false });
  outputs.push(outputPath);
}

async function captureAgent(page, project, agent, locale, outputs) {
  await openWorkProject(page, project);
  await clickNav(page, 'Agent 名錄', locale);
  await waitHeading(page, 'Agent 名錄', locale);
  const row = page.locator('.table-section .ant-table-row').filter({ hasText: agent.name }).first();
  await row.waitFor({ state: 'visible', timeout: 20000 });
  await row.locator('button').filter({ hasText: translation('編輯', locale) }).first().click();
  const modal = page.locator('.agent-execution-modal');
  await modal.waitFor({ state: 'visible', timeout: 12000 });
  const runtime = modal.locator('.ant-form-item').filter({ hasText: translation('Runtime', locale) }).first()
    .locator('.ant-select-selection-item');
  assert((await runtime.innerText()).trim() === 'Pi Durable', 'The Agent form does not show the Pi Durable runtime.');
  assert((await modal.getByLabel(translation('Agent 指令', locale), { exact: true }).inputValue()).includes('Do not call external providers'),
    'The saved Pi execution instructions are missing from the Agent form.');
  await scrollModalBody(modal, 250);
  await saveScreenshot(page, 'agent', locale, outputs);
  await modal.locator('.ant-modal-footer .ant-btn-default').first().click();
  await modal.waitFor({ state: 'hidden', timeout: 10000 });
}

async function captureModels(page, project, locale, outputs) {
  await openWorkProject(page, project);
  await clickNav(page, '模型連線', locale);
  await waitHeading(page, '模型連線', locale);
  await page.locator('.model-settings-page').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('.model-settings-page button').filter({ hasText: translation('新增 Provider', locale) }).click();
  const provider = page.locator('.model-provider').last();
  await provider.waitFor({ state: 'visible', timeout: 12000 });
  await provider.getByLabel('Provider ID', { exact: true }).fill('docs-handbook-placeholder');
  await provider.getByLabel(translation('顯示名稱', locale), { exact: true }).fill('OpenAI-compatible · not connected');
  await provider.getByLabel(translation('HTTPS API base URL', locale), { exact: true }).fill('https://api.openai.com/v1');
  const key = provider.getByLabel('API Key', { exact: true });
  assert(await key.inputValue() === '', 'The model Provider key field must remain blank.');
  await provider.locator('.model-definitions > button').click();
  const model = provider.locator('.model-definition-row').last();
  await model.getByLabel('Model ID', { exact: true }).fill('model-from-provider');
  await model.getByLabel(translation('名稱', locale), { exact: true }).fill('Example model');
  await model.getByLabel('Context', { exact: true }).fill('8192');
  await model.getByLabel(translation('輸出上限', locale), { exact: true }).fill('2048');
  assert(await key.inputValue() === '', 'The model Provider key field must remain blank.');
  await saveScreenshot(page, 'models', locale, outputs);
}

async function captureTemplate(page, project, template, profile, locale, outputs) {
  await openWorkProject(page, project);
  await clickNav(page, '自動化', locale);
  await waitHeading(page, '自動化', locale);
  await clickSegmented(page, '.automation-tabs', 'Agent 範本', locale);
  await page.locator('.automation-panel-heading').filter({ hasText: translation('Agent 範本版本', locale) }).waitFor({ state: 'visible' });
  const row = page.locator('.automation-table-shell .ant-table-row').filter({ hasText: template.key }).first();
  await row.waitFor({ state: 'visible', timeout: 20000 });
  await row.locator('button').filter({ hasText: translation('新增版本', locale) }).click();
  const modal = page.locator('.automation-editor-modal');
  await modal.waitFor({ state: 'visible', timeout: 12000 });
  assert(await modal.getByLabel(translation('顯示名稱', locale), { exact: true }).inputValue() === template.name,
    'The Agent template form is not populated from the saved version.');
  assert((await modal.getByLabel(translation('Agent 指令', locale), { exact: true }).inputValue()).includes('Do not call external providers'),
    'The saved Agent template instructions are missing from its version form.');
  const profileItem = modal.locator('.ant-form-item').filter({ hasText: translation('Sandbox 設定檔', locale) }).last();
  assert((await profileItem.innerText()).includes(profile.name), 'The template form does not show its saved Sandbox profile.');
  await scrollModalBody(modal, 160);
  await saveScreenshot(page, 'template', locale, outputs);
  await modal.locator('.ant-modal-footer .ant-btn-default').first().click();
  await modal.waitFor({ state: 'hidden', timeout: 10000 });
}

async function captureWorkflow(page, project, workflow, locale, outputs) {
  await openWorkProject(page, project);
  await clickNav(page, '自動化', locale);
  await waitHeading(page, '自動化', locale);
  await clickSegmented(page, '.automation-tabs', '工作流程', locale);
  await page.locator('.automation-panel-heading').filter({ hasText: translation('工作流程版本', locale) }).waitFor({ state: 'visible' });
  const row = page.locator('.automation-table-shell .ant-table-row').filter({ hasText: workflow.key }).first();
  await row.waitFor({ state: 'visible', timeout: 20000 });
  await row.locator('button').filter({ hasText: translation('新增版本', locale) }).click();
  const modal = page.locator('.automation-editor-modal');
  await modal.waitFor({ state: 'visible', timeout: 12000 });
  const steps = modal.locator('.workflow-step-row');
  assert(await steps.count() === 2, 'The workflow editor must show exactly two saved steps.');
  const dependencyItem = steps.nth(1).locator('.ant-form-item').filter({ hasText: translation('相依步驟', locale) });
  assert((await dependencyItem.innerText()).includes(workflow.steps[0].key),
    'The second workflow step does not show its saved prerequisite.');
  await steps.nth(1).scrollIntoViewIfNeeded();
  await saveScreenshot(page, 'workflow', locale, outputs);
  await modal.locator('.ant-modal-footer .ant-btn-default').first().click();
  await modal.waitFor({ state: 'hidden', timeout: 10000 });
}

async function captureTools(page, project, profile, locale, outputs) {
  await openWorkProject(page, project);
  await clickNav(page, '工具與沙箱', locale);
  await waitHeading(page, '工具與沙箱', locale);
  await clickSegmented(page, '.tool-settings-tabs', 'Sandbox 設定檔', locale);
  await page.locator('.sandbox-policy-note').waitFor({ state: 'visible', timeout: 15000 });
  const row = page.locator('.tool-settings-table-shell .ant-table-row').filter({ hasText: profile.name }).first();
  await row.waitFor({ state: 'visible', timeout: 20000 });
  await row.locator('button').last().click();
  const modal = page.locator('.tool-editor-modal');
  await modal.waitFor({ state: 'visible', timeout: 12000 });
  assert(await modal.getByLabel(translation('Profile 名稱', locale), { exact: true }).inputValue() === profile.name,
    'The Sandbox settings form is not showing the saved profile.');
  assert(await modal.getByLabel(translation('記憶體（MB）', locale), { exact: true }).inputValue() === '256',
    'The Sandbox memory limit does not match the saved profile.');
  await saveScreenshot(page, 'tools', locale, outputs);
  await modal.locator('.ant-modal-footer .ant-btn-default').first().click();
  await modal.waitFor({ state: 'hidden', timeout: 10000 });
}

async function captureReview(page, project, task, locale, outputs) {
  await openWorkProject(page, project);
  await clickNav(page, '任務', locale);
  await waitHeading(page, '任務工作區', locale);
  const drawer = await openTask(page, task, locale);
  await drawer.locator('.detail-tabs .ant-tabs-tab').filter({ hasText: translation('執行與審核', locale) }).click();
  const reviewView = drawer.locator('.execution-view');
  await reviewView.waitFor({ state: 'visible', timeout: 15000 });
  await reviewView.getByText(translation('已通過', locale), { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 });
  const artifact = drawer.locator('.artifact-row').filter({ hasText: REVIEW_ARTIFACT_TITLE });
  await artifact.waitFor({ state: 'visible', timeout: 15000 });
  const checkboxes = artifact.locator('input[type="checkbox"]');
  assert(await checkboxes.count() === 6, 'The Markdown renderer must produce six task-list checkboxes.');
  const checkboxStates = await checkboxes.evaluateAll(items => items.map(item => ({ disabled: item.disabled, checked: item.checked })));
  assert(checkboxStates.every(item => item.disabled && !item.checked),
    'Every review checklist checkbox must be disabled and unchecked.');
  const artifactText = await artifact.innerText();
  assert(['Product', 'Login', 'Backup', 'Docs', 'Support', 'Analytics'].every(area => artifactText.includes(area)),
    'The review screenshot does not show all six checklist areas.');
  assert(!/-\s*\[\s*\]/.test(artifactText), 'The review artifact exposes raw Markdown task-list syntax.');
  await assertSafeMarkdownDom(artifact);
  await saveScreenshot(page, 'review', locale, outputs);
}

async function assertSafeMarkdownDom(container) {
  const unsafe = await container.evaluate(element => {
    const descendants = [...element.querySelectorAll('*')];
    return descendants.some(node => {
      if (['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED'].includes(node.tagName)) return true;
      return [...node.attributes].some(attribute => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        return name.startsWith('on')
          || (['href', 'src', 'xlink:href'].includes(name) && /^(?:javascript|data):/i.test(value));
      });
    });
  });
  assert(!unsafe, 'The rendered Markdown contains an unsafe element, event handler, or URL.');
}

async function runMarkdownCheck(browser, adminPage, contexts, adminEmail, adminPassword) {
  const projects = await callApi(adminPage, '/api/projects');
  const project = projects.find(item => item.key === PROJECT.key);
  assert(project && project.id, 'The existing handbook QA project is unavailable for the Markdown check.');
  const tasks = await callApi(adminPage, '/api/tasks?project_id=' + encodeURIComponent(project.id));
  const task = tasks.find(item => item.title === REVIEW_TASK_TITLE);
  assert(task && task.id && task.status === 'done', 'The accepted handbook QA task is unavailable for the Markdown check.');
  const original = await callApi(adminPage, '/api/tasks/' + encodeURIComponent(task.id) + '/context');
  const originalArtifact = original.artifacts.find(item => item.title === REVIEW_ARTIFACT_TITLE);
  assert(originalArtifact && typeof originalArtifact.content === 'string'
    && !originalArtifact.content.includes('Markdown safety check'),
  'The stored review artifact is not the expected public handbook fixture.');

  const markdownContext = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  contexts.push(markdownContext);
  installBrowserGuards(markdownContext);
  await markdownContext.addInitScript(() => {
    window.__markdownScriptRan = false;
    window.__markdownImageHandlerRan = false;
    window.__markdownCodeExecuted = false;
  });
  const page = await markdownContext.newPage();
  trackPageErrors(page);
  let interceptedContexts = 0;
  const contextPath = '/api/tasks/' + encodeURIComponent(task.id) + '/context';
  await markdownContext.route(BASE + contextPath, async route => {
    assert(route.request().method() === 'GET', 'The Markdown overlay only permits the task context GET request.');
    const response = await route.fetch();
    assert(response.ok(), 'The Markdown check could not load the actual task context.');
    const apiContext = await response.json();
    const artifact = apiContext.artifacts.find(item => item.title === REVIEW_ARTIFACT_TITLE);
    assert(artifact, 'The Markdown check could not find the actual API artifact.');
    artifact.content = MARKDOWN_CHECK_CONTENT;
    const headers = response.headers();
    delete headers['content-length'];
    delete headers['content-encoding'];
    delete headers['transfer-encoding'];
    await route.fulfill({ status: response.status(), headers, body: JSON.stringify(apiContext) });
    interceptedContexts += 1;
  });

  await loginWithPassword(page, adminEmail, adminPassword, false);
  await openWorkProject(page, project);
  const locale = LOCALES.find(item => item.key === 'en');
  await selectLocale(page, locale);
  await clickNav(page, '任務', locale);
  await waitHeading(page, '任務工作區', locale);
  const drawer = await openTask(page, task, locale);
  await drawer.locator('.detail-tabs .ant-tabs-tab').filter({ hasText: translation('執行與審核', locale) }).click();
  const reviewView = drawer.locator('.execution-view');
  await reviewView.waitFor({ state: 'visible', timeout: 15000 });
  const artifact = drawer.locator('.artifact-row').filter({ hasText: REVIEW_ARTIFACT_TITLE });
  await artifact.waitFor({ state: 'visible', timeout: 15000 });
  assert(interceptedContexts > 0, 'The isolated Markdown response overlay was not used.');

  await artifact.getByRole('heading', { name: 'Markdown safety check', exact: true }).waitFor({ state: 'visible' });
  assert(await artifact.locator('strong').filter({ hasText: 'bold' }).count() === 1,
    'Markdown bold text was not rendered.');
  assert(await artifact.locator('em').filter({ hasText: 'emphasized' }).count() === 1,
    'Markdown emphasis was not rendered.');
  assert(await artifact.locator('table th').count() === 2, 'Markdown GFM table headers were not rendered.');
  assert((await artifact.locator('code').allTextContents()).some(value => value.includes('<script>window.__markdownCodeExecuted = true</script>')),
    'The fenced code example was not preserved as literal code.');
  assert(await artifact.locator('input[type="checkbox"]').count() === 2,
    'Markdown GFM task lists were not rendered.');
  const taskStates = await artifact.locator('input[type="checkbox"]').evaluateAll(items => items.map(item => ({ disabled: item.disabled, checked: item.checked })));
  assert(taskStates.length === 2 && taskStates.every(item => item.disabled)
    && taskStates[0].checked === false && taskStates[1].checked === true,
  'Markdown task list controls do not preserve their disabled checked states.');
  assert(await artifact.locator('script, iframe, object, embed').count() === 0,
    'Raw HTML rendered an active script or embedded element.');
  assert(await artifact.locator('[onerror]').count() === 0,
    'Raw HTML retained an image error handler.');
  const imageSources = await artifact.locator('img').evaluateAll(images => images.map(image => image.getAttribute('src') || ''));
  assert(imageSources.every(source => !/^(?:javascript|data):/i.test(source)),
    'An unsafe Markdown image URL remained active.');
  const unsafeLinkTargets = await artifact.locator('a').evaluateAll(links => links
    .map(link => link.getAttribute('href') || '')
    .filter(href => /^(?:javascript|data):/i.test(href)));
  assert(unsafeLinkTargets.length === 0, 'A JavaScript or data URL remained active in Markdown.');
  const externalLink = artifact.getByRole('link', { name: 'Safe external link', exact: true });
  assert(await externalLink.getAttribute('href') === 'https://docs.example.org/guide'
    && await externalLink.getAttribute('target') === '_blank'
    && (await externalLink.getAttribute('rel') || '').split(/\s+/).includes('noopener')
    && (await externalLink.getAttribute('rel') || '').split(/\s+/).includes('noreferrer'),
  'Safe external Markdown links must open in a protected new tab.');
  assert((await artifact.locator('code').allTextContents()).includes('code'),
    'Inline Markdown code was not preserved exactly.');
  await assertSafeMarkdownDom(artifact);
  assert(await page.evaluate(() => !window.__markdownScriptRan && !window.__markdownImageHandlerRan && !window.__markdownCodeExecuted),
    'Markdown test content executed script or image event-handler code.');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  assert(widths.document <= widths.viewport, 'The Markdown review page overflows at 390px width.');

  const after = await callApi(adminPage, '/api/tasks/' + encodeURIComponent(task.id) + '/context');
  const storedAfter = after.artifacts.find(item => item.title === REVIEW_ARTIFACT_TITLE);
  assert(storedAfter && storedAfter.content === originalArtifact.content
    && !storedAfter.content.includes('Markdown safety check'),
  'The Markdown check altered the persisted task evidence.');
}

function verifyPng(filePath) {
  const data = fs.readFileSync(filePath);
  assert(data.length > 1000, 'A handbook screenshot is unexpectedly small.');
  assert(data.readUInt32BE(0) === 0x89504e47 && data.toString('ascii', 1, 4) === 'PNG', 'A screenshot is not a valid PNG.');
  assert(data.readUInt32BE(16) === VIEWPORT.width && data.readUInt32BE(20) === VIEWPORT.height,
    'A screenshot does not have the required 1400x900 dimensions.');
}

async function main() {
  assert(!(REVIEW_ONLY && MARKDOWN_CHECK_ONLY), 'Choose either --review-only or --markdown-check.');
  inspectQaPortOwner();
  const adminEmail = process.env[ADMIN_EMAIL_ENV];
  const adminPassword = process.env[ADMIN_PASSWORD_ENV];
  assert(adminEmail && adminPassword, 'The ignored QA wrapper must provide the synthetic account credentials.');
  inMemorySecrets.add(adminEmail);
  inMemorySecrets.add(adminPassword);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--disable-extensions', '--disable-background-networking'],
  });
  const adminContext = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  installBrowserGuards(adminContext);
  const adminPage = await adminContext.newPage();
  trackPageErrors(adminPage);
  const contexts = [adminContext];
  const outputs = [];

  try {
    await loginWithPassword(adminPage, adminEmail, adminPassword, true);
    const adminPrincipal = await callApi(adminPage, '/api/me');
    assert(adminPrincipal.kind === 'human' && ['admin', 'manager'].includes(adminPrincipal.role),
      'The synthetic QA account needs a human Work admin or manager role.');
    const fixtures = await createOrReuseFixtures(adminPage);
    const review = await ensureAcceptedReview(browser, adminPage, fixtures, adminPrincipal, adminPassword);
    if (review.workerContext) contexts.push(review.workerContext);

    if (MARKDOWN_CHECK_ONLY) {
      await runMarkdownCheck(browser, adminPage, contexts, adminEmail, adminPassword);
    } else {
      for (const locale of LOCALES) {
        await openWorkProject(adminPage, fixtures.project);
        await selectLocale(adminPage, locale);
        if (REVIEW_ONLY) {
          await captureReview(adminPage, fixtures.project, fixtures.reviewTask, locale, outputs);
          continue;
        }
        await captureAgent(adminPage, fixtures.project, fixtures.agent, locale, outputs);
        await captureModels(adminPage, fixtures.project, locale, outputs);
        await captureTemplate(adminPage, fixtures.project, fixtures.template, fixtures.profile, locale, outputs);
        await captureWorkflow(adminPage, fixtures.project, fixtures.workflow, locale, outputs);
        await captureTools(adminPage, fixtures.project, fixtures.profile, locale, outputs);
        await captureReview(adminPage, fixtures.project, fixtures.reviewTask, locale, outputs);
      }
    }

    assert(pageErrorCount === 0, 'The browser recorded ' + pageErrorCount + ' JavaScript errors.');
    assert(externalHttpRequests.length === 0, 'The app or Provider attempted an external HTTP(S) request to: '
      + [...new Set(externalHttpRequests)].join(', '));
    const expectedCaptureCount = MARKDOWN_CHECK_ONLY ? 0 : REVIEW_ONLY ? 3 : 18;
    assert(outputs.length === expectedCaptureCount, 'Unexpected screenshot count: ' + outputs.length + '.');
    const screenshotRecords = [];
    for (const locale of LOCALES) {
      for (const screenName of SCREEN_NAMES) {
        const fileName = screenName + '-' + locale.key + '.png';
        const expected = path.join(OUTPUT_DIR, fileName);
        assert(fs.existsSync(expected), 'A required handbook screenshot is missing.');
        verifyPng(expected);
        if (!REVIEW_ONLY && !MARKDOWN_CHECK_ONLY) assert(outputs.includes(expected), 'A required handbook screenshot was not refreshed.');
        screenshotRecords.push({
          path: 'docs/public/screenshots/' + fileName,
          locale: locale.key,
          width: VIEWPORT.width,
          height: VIEWPORT.height,
        });
      }
    }
    assert(screenshotRecords.length === 18, 'The validated handbook screenshot set does not contain 18 images.');
    const acceptance = review.acceptance;
    assert(acceptance.task_status === 'done' && acceptance.execution_accepted
      && acceptance.submitter_differs_from_reviewer && acceptance.reviewer_id_null
      && acceptance.source_evidence_verified,
    'The accepted public-guide review fixture did not pass the required independent review checks.');
    fs.mkdirSync(path.dirname(ACCEPTANCE_REPORT), { recursive: true });
    fs.writeFileSync(ACCEPTANCE_REPORT, JSON.stringify({
      docker_compose_project_label: EXPECTED_COMPOSE_PROJECT,
      docker_owner_verified_before_browser: true,
      screenshots: screenshotRecords,
      review: acceptance,
      browser: {
        javascript_errors: pageErrorCount,
        markdown_dom_checks_run: MARKDOWN_CHECK_ONLY,
        response_overlay_used: MARKDOWN_CHECK_ONLY,
        app_provider_external_http_requests: externalHttpRequests.length,
        blocked_injected_requests: { host: blockedInjectedHost, count: blockedInjectedRequestCount },
      },
    }, null, 2) + '\n', 'utf8');
    for (const output of outputs) process.stdout.write(path.relative(process.cwd(), output).replaceAll('\\', '/') + '\n');
    process.stdout.write((MARKDOWN_CHECK_ONLY ? 'Markdown DOM safety checks passed; '
      : REVIEW_ONLY ? '3 review screenshots refreshed; ' : '18 screenshots captured; ')
      + 'all 18 valid 1400x900 screenshots verified; browser JavaScript errors: 0; '
      + 'app/Provider external HTTP(S) requests: 0; blocked injected ' + blockedInjectedHost
      + ' requests: ' + blockedInjectedRequestCount + '\n');
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
}

main().catch(error => {
  let message = error && typeof error.message === 'string' ? error.message : 'Unknown capture error.';
  for (const secret of inMemorySecrets) if (secret) message = message.split(secret).join('[redacted]');
  process.stderr.write('Handbook screenshot capture failed: ' + message + '\n');
  process.stderr.write('QA credentials, invitation code, cookies and CSRF state were not written.\n');
  process.exitCode = 1;
});
