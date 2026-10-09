import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { documentPaths, localePrefixes } from './docs_pages.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireDocs = createRequire(path.join(repoRoot, 'docs/package.json'));
const { createMarkdownRenderer } = await import(pathToFileURL(requireDocs.resolve('vitepress')).href);
const markdown = await createMarkdownRenderer(path.join(repoRoot, 'docs'), { highlight: source => source });

function countPairs(value) {
  return (value.match(/\*\*/g) || []).length;
}

function isEscaped(value, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor--) slashes++;
  return slashes % 2 === 1;
}

function withoutInlineCode(source) {
  const visible = [];
  let index = 0;
  let start = 0;
  while (index < source.length) {
    if (source[index] !== '`' || isEscaped(source, index)) {
      index++;
      continue;
    }
    let runEnd = index + 1;
    while (source[runEnd] === '`') runEnd++;
    const runLength = runEnd - index;
    let closing = runEnd;
    let closeStart = -1;
    while (closing < source.length) {
      if (source[closing] !== '`' || isEscaped(source, closing)) {
        closing++;
        continue;
      }
      let candidateEnd = closing + 1;
      while (source[candidateEnd] === '`') candidateEnd++;
      if (candidateEnd - closing === runLength) {
        closeStart = closing;
        break;
      }
      closing = candidateEnd;
    }
    if (closeStart < 0) {
      index = runEnd;
      continue;
    }
    visible.push(source.slice(start, index));
    index = closing + runLength;
    start = index;
  }
  visible.push(source.slice(start));
  return visible.join('');
}

function inlineHasUnparsedStrong(inline) {
  const text = (inline.children || [])
    .filter(child => child.type === 'text')
    .map(child => child.content || '')
    .join('\n');
  const textPairs = countPairs(text);
  const escapedPairs = (withoutInlineCode(inline.content || '').match(/\\\*\\\*/g) || []).length;
  return textPairs > escapedPairs;
}

function unparsedStrongIssues(source) {
  const environment = {};
  markdown.render(source, environment);
  const content = environment.content || '';
  const lineOffset = source.slice(0, source.length - content.length).split('\n').length - 1;
  const tokens = markdown.parse(content, {});
  const issues = [];
  let currentLine = 0;
  for (const token of tokens) {
    if (token.map) currentLine = token.map[0];
    if (token.type !== 'inline' || !inlineHasUnparsedStrong(token)) continue;
    issues.push({
      line: currentLine + lineOffset + 1,
      source: (token.content || '').replace(/\s+/g, ' ').trim(),
    });
  }
  return issues;
}

function runRegressionChecks() {
  const cases = [
    ['Chinese punctuation adjacent to closing delimiter', '**Work：**建立任務清單', true],
    ['space before closing delimiter', '**Work： **建立任務清單', true],
    ['Chinese punctuation outside bold', '**Work**：建立任務清單', false],
    ['English colon inside bold', '**Work:** Create a task list', false],
    ['escaped delimiter example', String.raw`\*\*Work\*\* stays literal`, false],
    ['inline code example', 'Use `**Work：**` as a literal sample.', false],
    ['fenced code example', '```md\n**Work：** stays literal\n```', false],
  ];
  for (const [name, source, expected] of cases) {
    assert.equal(unparsedStrongIssues(source).length > 0, expected, `Markdown strong-delimiter regression: ${name}`);
  }
  return cases.length;
}

function main() {
  const regressions = runRegressionChecks();
  const pages = documentPaths();
  const errors = [];
  let checked = 0;
  for (const document of pages) {
    for (const prefix of localePrefixes) {
      const relative = prefix + document;
      const file = path.join(repoRoot, 'docs', relative);
      if (!fs.existsSync(file)) {
        errors.push({ file: relative, line: 1, source: '', reason: 'missing source' });
        continue;
      }
      const source = fs.readFileSync(file, 'utf8');
      checked++;
      for (const issue of unparsedStrongIssues(source)) errors.push({ file: relative, ...issue, reason: 'unparsed ** in inline text' });
    }
  }
  for (const error of errors) {
    const excerpt = error.source ? `: ${error.source.slice(0, 220)}` : '';
    process.stderr.write(`${error.file}:${error.line}: ${error.reason}${excerpt}\n`);
  }
  process.stdout.write(`DOCS_MARKDOWN_${errors.length ? 'FAILED' : 'PASSED'}: ${checked} sources, ${pages.length} documents x ${localePrefixes.length} locales, ${regressions} parser regression checks, ${errors.length} errors\n`);
  if (errors.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
