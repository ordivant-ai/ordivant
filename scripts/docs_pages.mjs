import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = path.join(repoRoot, 'docs');
export const localePrefixes = ['', 'en/', 'zh-CN/'];

// All repository documentation still receives translation checks.
export function documentPaths() {
  const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', '.vitepress', 'en', 'zh-CN'].includes(entry.name)) return [];
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name.endsWith('.md') ? [path.relative(docsRoot, full).split(path.sep).join('/')] : [];
  });
  return walk(docsRoot).sort();
}

// Publication is opt-in: adding a Markdown file cannot publish an internal record.
export function publicDocumentPaths() {
  const pages = JSON.parse(fs.readFileSync(path.join(docsRoot, '.vitepress/public-pages.json'), 'utf8'));
  if (!Array.isArray(pages) || !pages.length || new Set(pages).size !== pages.length) {
    throw new Error('The public documentation manifest must contain unique page paths.');
  }
  const sources = new Set(documentPaths());
  for (const page of pages) {
    if (typeof page !== 'string' || !sources.has(page)) throw new Error(`Unknown public documentation page: ${page}`);
    for (const prefix of localePrefixes) {
      if (!fs.existsSync(path.join(docsRoot, prefix, page))) throw new Error(`Missing public translation: ${prefix}${page}`);
    }
  }
  return [...pages].sort();
}

export function repositoryDocumentPaths() {
  const published = new Set(publicDocumentPaths());
  return documentPaths().filter(page => !published.has(page));
}

export function excludedDocumentPaths() {
  return repositoryDocumentPaths().flatMap(page => localePrefixes.map(prefix => prefix + page));
}
