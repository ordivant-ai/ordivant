import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { documentPaths } from './docs_pages.mjs';
export { documentPaths } from './docs_pages.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireDocs = createRequire(path.join(repoRoot, 'docs/package.json'));
const { createMarkdownRenderer } = await import(pathToFileURL(requireDocs.resolve('vitepress')).href);
const markdown = await createMarkdownRenderer(path.join(repoRoot, 'docs'), { highlight: source => source });
const CJK = /[\u3400-\u9fff]/u;
const TECHNICAL_LABELS = new Set([
  'Ordivant', 'Work', 'Knowledge', 'Code', 'Agent', 'Agents', 'Identity', 'Manager', 'Worker', 'Reviewer', 'Writer', 'Reader', 'API', 'REST', 'MCP',
  'SSO', 'PM', 'ID', 'UI', 'SDK', 'Runtime', 'Secret Manager', 'Vault', 'KMS', 'OIDC', 'OAuth', 'OAuth 2.0', 'SAML', 'LDAP', 'AD', 'LDAP/AD', 'HTTP', 'HTTPS',
  'JSON', 'JSON-RPC', 'JSON Schema', 'SSE', 'HTML', 'CSS', 'SQL', 'RBAC', 'PKCE', 'JWKS',
  'Docker', 'Docker Compose', 'Docker Engine', 'Docker Desktop', 'PostgreSQL', 'SQLite',
  'Python', 'FastAPI', 'React', 'TypeScript', 'JavaScript', 'Node.js', 'npm', 'uv', 'Vite',
  'VitePress', 'Ant Design', 'Pi', 'Pi Durable', 'Gitea', 'Forgejo', 'Git', 'GitHub', 'GitLab',
  'Bitbucket', 'Azure DevOps', 'GitHub Actions', 'OpenAI', 'OpenAI Responses', 'Keycloak',
  'Okta', 'Auth0', 'Microsoft Entra ID', 'Entra ID', 'Google Workspace', 'Amazon Cognito',
  'AWS', 'CI', 'QA', 'MIT', 'DEMO', 'PASS', 'PASSED', 'FAIL', 'FAILED', 'N/A', 'stdout', 'stderr',
]);
const PROSE_WORDS = /\b(?:the|a|an|this|that|these|those|is|are|was|were|be|been|with|without|from|to|and|or|for|of|in|on|only|must|should|not|does|when|can|use|uses|using|will|has|have)\b/gi;
const VISIBLE_FRONTMATTER = new Set(['name', 'text', 'tagline', 'title', 'details', 'label', 'alt']);

function normal(text) {
  return text.replace(/\{#[^}]+\}/g, '').replace(/[\u200b\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripIdentifiers(text) {
  return text.replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\S*[\\/]\S*/g, ' ')
    .replace(/\b\w+(?:[._-]\w+)+\b/g, ' ')
    .replace(/\b(?:[a-z]+[A-Z]\w*|[A-Z][a-z]+[A-Z]\w*)\b/g, word => TECHNICAL_LABELS.has(word) ? word : ' ')
    .replace(/\b\w*\d\w*\b/g, ' ');
}

export function languageIssues(text, locale, kind = 'paragraph') {
  const value = normal(text);
  if (!value) return [];
  if (locale === 'en') return CJK.test(value) ? ['Chinese prose in English page'] : [];
  if (TECHNICAL_LABELS.has(value)) return [];
  const hasChinese = CJK.test(value);
  const fragments = hasChinese ? value.split(/[\u3400-\u9fff]+/u) : [value];
  for (const fragment of fragments) {
    let cleaned = fragment;
    for (const label of [...TECHNICAL_LABELS].filter(item => item.includes(' ')).sort((a, b) => b.length - a.length)) cleaned = cleaned.replaceAll(label, ' ');
    const plain = stripIdentifiers(cleaned).trim();
    const words = plain.match(/\b[A-Za-z]+(?:'[A-Za-z]+)?\b/g) || [];
    if (!words.length || TECHNICAL_LABELS.has(plain)) continue;
    const proseCount = (plain.match(PROSE_WORDS) || []).length;
    if (!hasChinese && !words.every(word => TECHNICAL_LABELS.has(word))) {
      return ['Untranslated English prose in Chinese page'];
    }
    if (hasChinese && words.length >= 8 && proseCount >= 2) {
      return ['Untranslated English sentence inside Chinese prose'];
    }
  }
  return [];
}

export function sourceBlocks(source) {
  const environment = {};
  markdown.render(source, environment);
  const data = environment.frontmatter || {};
  const content = environment.content || '';
  const blocks = [];
  const walk = (value, key = '') => {
    if (typeof value === 'string' && VISIBLE_FRONTMATTER.has(key)) blocks.push({ text: value, kind: 'heading', line: 1 });
    else if (Array.isArray(value)) value.forEach(item => walk(item));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([name, item]) => walk(item, name));
  };
  walk(data);
  const tokens = markdown.parse(content, {});
  const lineOffset = source.slice(0, source.length - content.length).split('\n').length - 1;
  let currentLine = 0;
  tokens.forEach((token, index) => {
    if (token.map) currentLine = token.map[0];
    if (token.type !== 'inline') return;
    const text = (token.children || []).map(child => ['text', 'softbreak', 'hardbreak'].includes(child.type) ? child.content || ' ' : '').join('');
    blocks.push({ text, kind: tokens[index - 1]?.type === 'heading_open' ? 'heading' : 'paragraph', line: currentLine + lineOffset + 1 });
  });
  return blocks.filter(block => normal(block.text));
}

export function headingRecords(source) {
  const environment = {};
  markdown.render(source, environment);
  const content = environment.content || '';
  const lineOffset = source.slice(0, source.length - content.length).split('\n').length - 1;
  const tokens = markdown.parse(content, {});
  return tokens.flatMap((token, index) => token.type === 'heading_open' ? [{
    id: token.attrGet('id'), tag: token.tag, line: token.map[0] + lineOffset,
    text: tokens[index + 1].content,
  }] : []);
}

export function auditSource(source, locale) {
  return sourceBlocks(source).flatMap(block => languageIssues(block.text, locale, block.kind).map(reason => ({ ...block, reason })));
}

function runRegressionChecks() {
  const cases = [
    ['original English container heading', auditSource('# Container workflow', 'zh-Hant').length > 0],
    ['original English container paragraph', auditSource('The host needs Docker Engine/Desktop with Docker Compose; it does not need Python.', 'zh-Hans').length > 0],
    ['English paragraph below translated heading', auditSource('# 容器部署\n\nThe helper builds the selected development targets and waits for the APIs.', 'zh-Hant').length > 0],
    ['English table explanations', auditSource('| 功能 | 說明 |\n| --- | --- |\n| API | The service validates the user session. |', 'zh-Hans').length > 0],
    ['fenced commands and inline identifiers', auditSource('# 容器部署\n\n使用 `ORDIVANT_AUTH_ORIGINS` 設定來源。\n\n```sh\n# The original command remains unchanged\ndocker compose up\n```', 'zh-Hant').length === 0],
    ['proper product and protocol labels', auditSource('# Work\n\nDocker Compose\n\nOIDC\n\nOrdivant', 'zh-Hant').length === 0],
    ['Chinese text on English page', auditSource('# Container workflow\n\n這裡尚未翻譯。', 'en').length > 0],
    ['localized frontmatter', auditSource('---\nhero:\n  tagline: The platform gives agents a shared workspace.\n---\n', 'zh-Hans').length > 0],
  ];
  const failures = cases.filter(([, passed]) => !passed);
  if (failures.length) throw new Error(`Body-language regression checks failed: ${failures.map(([name]) => name).join(', ')}`);
  return cases.length;
}

function main() {
  const regressions = runRegressionChecks();
  const errors = [];
  let checked = 0;
  let blocks = 0;
  for (const document of documentPaths()) {
    const englishFile = path.join(repoRoot, 'docs/en', document);
    const expectedHeadings = fs.existsSync(englishFile) ? headingRecords(fs.readFileSync(englishFile, 'utf8')) : [];
    for (const [prefix, locale] of [['', 'zh-Hant'], ['en/', 'en'], ['zh-CN/', 'zh-Hans']]) {
      const relative = prefix + document;
      const file = path.join(repoRoot, 'docs', relative);
      if (!fs.existsSync(file)) { errors.push({ file: relative, reason: 'Missing language counterpart' }); continue; }
      const source = fs.readFileSync(file, 'utf8');
      blocks += sourceBlocks(source).length;
      const headings = headingRecords(source);
      if (headings.length !== expectedHeadings.length || headings.some((heading, index) => heading.id !== expectedHeadings[index]?.id || heading.tag !== expectedHeadings[index]?.tag)) errors.push({ file: relative, reason: 'Section IDs differ between languages' });
      errors.push(...auditSource(source, locale).map(error => ({ file: relative, ...error })));
      checked++;
    }
  }
  for (const error of errors) process.stderr.write(`${error.file}:${error.line || 1}: ${error.reason}: ${normal(error.text || '').slice(0, 180)}\n`);
  process.stdout.write(`DOCS_I18N_${errors.length ? 'FAILED' : 'PASSED'}: ${checked} sources, ${blocks} prose blocks, ${regressions} regression checks, ${errors.length} errors\n`);
  if (errors.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
