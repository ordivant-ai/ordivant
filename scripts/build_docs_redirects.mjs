import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicDocumentPaths } from './docs_pages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/docs-project-redirects');
const destination = 'https://ordivant-ai.github.io';
const locales = [
  { prefix: '', lang: 'zh-Hant', title: 'Ordivant 文件已移轉', message: '文件已移至新站。', link: '前往對應文件' },
  { prefix: 'en/', lang: 'en', title: 'Ordivant documentation has moved', message: 'Documentation is now available at the new site.', link: 'Open this documentation page' },
  { prefix: 'zh-CN/', lang: 'zh-Hans', title: 'Ordivant 文档已迁移', message: '文档已移至新站。', link: '前往对应文档' },
];

function redirectPage(locale, route, fallback = false) {
  const target = `${destination}/${route === 'index.html' ? '' : route}`;
  const script = fallback
    ? `const target=new URL(${JSON.stringify(destination)});const previous=location.pathname;target.pathname=(previous==='/ordivant'||previous.startsWith('/ordivant/'))?previous.slice('/ordivant'.length)||'/':previous;target.search=location.search;target.hash=location.hash;location.replace(target.href);`
    : `const target=new URL(${JSON.stringify(target)});target.search=location.search;target.hash=location.hash;location.replace(target.href);`;
  return `<!doctype html>
<html lang="${locale.lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${locale.title}</title><link rel="canonical" href="${target}">
<script>${script}</script>
<style>body{max-width:48rem;margin:15vh auto;padding:1.5rem;font:1.1rem/1.7 system-ui,sans-serif;color:#1e293b}a{color:#2563eb}h1{font-size:1.8rem}</style></head>
<body><h1>${locale.title}</h1><p>${locale.message}</p><p><a href="${target}">${locale.link}</a></p></body></html>
`;
}

// The output is generated only within this repository's cache directory.
if (path.dirname(output) !== path.join(root, '.cache')) throw new Error('Invalid redirect output directory');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
let pages = 0;
for (const locale of locales) {
  for (const document of publicDocumentPaths()) {
    const route = locale.prefix + document.replace(/\.md$/, '.html');
    const file = path.join(output, route);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, redirectPage(locale, route));
    pages++;
  }
}
fs.writeFileSync(path.join(output, '404.html'), redirectPage(locales[0], '', true));
process.stdout.write(`DOCS_REDIRECTS_BUILT: ${pages + 1} pages, destination ${destination}/\n`);
