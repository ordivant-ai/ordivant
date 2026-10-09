"""Check built documentation links, assets and anchors without network requests."""
from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit
import sys
import os
import json
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1] / 'docs/.vitepress/dist'
BASE = os.environ.get('DOCS_BASE', '/')


class Page(HTMLParser):
    def __init__(self, text: str):
        super().__init__()
        self.links: list[str] = []
        self.ids: set[str] = set()
        self.lang = ''
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'html':
            self.lang = values.get('lang', '')
        if values.get('id'):
            self.ids.add(values['id'])
        for attr in ('href', 'src'):
            value = values.get(attr)
            if value:
                self.links.append(value)


def main() -> int:
    pages = {p.relative_to(ROOT).as_posix(): Page(p.read_text(encoding='utf-8')) for p in ROOT.rglob('*.html')}
    if not pages:
        print('Build the documentation first: npm run build --prefix docs')
        return 1
    errors = set()
    checked = 0
    docs = ROOT.parent.parent
    sources = {p.relative_to(docs).as_posix() for p in docs.rglob('*.md')
               if not any(part in {'node_modules', '.vitepress', 'en', 'zh-CN'} for part in p.relative_to(docs).parts)}
    for locale in ('en', 'zh-CN'):
        translations = {p.relative_to(docs / locale).as_posix() for p in (docs / locale).rglob('*.md')}
        for missing in sources - translations:
            errors.add((locale, missing, 'missing translated source'))
        for extra in translations - sources:
            errors.add((locale, extra, 'translated page has no source counterpart'))
    manifest = json.loads((docs / '.vitepress/public-pages.json').read_text(encoding='utf-8'))
    if not isinstance(manifest, list) or not manifest or any(not isinstance(page, str) for page in manifest):
        print('Invalid public documentation manifest')
        return 1
    public = set(manifest)
    if len(public) != len(manifest) or public - sources:
        print('Public documentation manifest contains duplicate or unknown pages')
        return 1
    expected_pages = {'404.html'}
    for source in public:
        for prefix, lang in (('', 'zh-Hant'), ('en/', 'en'), ('zh-CN/', 'zh-Hans')):
            target = prefix + source.removesuffix('.md') + '.html'
            expected_pages.add(target)
            if target not in pages:
                errors.add((target, source, 'translated HTML missing'))
            elif pages[target].lang != lang:
                errors.add((target, pages[target].lang, 'incorrect document language'))
    for extra in pages.keys() - expected_pages:
        errors.add((extra, extra, 'HTML outside the public documentation manifest'))
    if '404.html' not in pages:
        errors.add(('404.html', '', 'missing not-found page'))

    sitemap = ROOT / 'sitemap.xml'
    if not sitemap.is_file():
        errors.add(('sitemap.xml', '', 'missing sitemap'))
    else:
        # Check both canonical entries and localized alternate links.
        tree = ET.parse(sitemap)
        sitemap_pages = set()
        for element in tree.iter():
            urls = [element.text] if element.tag.endswith('}loc') else []
            if element.attrib.get('href'):
                urls.append(element.attrib['href'])
            for url in urls:
                route = unquote(urlsplit(url).path).removeprefix(BASE)
                if not route or route.endswith('/'):
                    route += 'index.html'
                sitemap_pages.add(route)
        for route in sitemap_pages - (expected_pages - {'404.html'}):
            errors.add(('sitemap.xml', route, 'entry outside the public documentation manifest'))
        for missing in (expected_pages - {'404.html'}) - sitemap_pages:
            errors.add(('sitemap.xml', missing, 'missing public page'))

    search_indexes = list((ROOT / 'assets').rglob('@localSearchIndex*.js'))
    if len(search_indexes) != 3:
        errors.add(('search', str(len(search_indexes)), 'expected three localized search indexes'))
    for index in search_indexes:
        content = index.read_text(encoding='utf-8')
        for route in set(re.findall(r'/[a-zA-Z0-9_/-]+\.html', content)):
            if route.removeprefix(BASE) not in expected_pages:
                errors.add((index.name, route, 'search entry outside the public documentation manifest'))
    for source in sources - public:
        for prefix in ('', 'en/', 'zh-CN/'):
            bundle_name = (prefix + source).replace('/', '_') + '.'
            for bundle in (ROOT / 'assets').glob(bundle_name + '*.js'):
                errors.add((bundle.name, source, 'repository-only content bundled for the website'))
    for name, page in pages.items():
        for href in page.links:
            parsed = urlsplit(urljoin('https://docs.invalid' + BASE + name, href))
            if parsed.netloc != 'docs.invalid' or parsed.scheme not in ('http', 'https'):
                continue
            if not parsed.path.startswith(BASE):
                errors.add((name, href, 'outside site base'))
                continue
            target = unquote(parsed.path[len(BASE):])
            if not target or target.endswith('/'):
                target += 'index.html'
            destination = ROOT / target
            if not destination.is_file():
                errors.add((name, href, 'missing file'))
            elif parsed.fragment and target in pages and unquote(parsed.fragment) not in pages[target].ids:
                errors.add((name, href, 'missing anchor'))
            checked += 1
    for name, href, reason in sorted(errors):
        print(f'{name}: {reason}: {href}')
    print(f'DOCS_LINKS_{"FAILED" if errors else "PASSED"}: {len(pages)} pages, {checked} local references, {len(errors)} errors; '
          f'publication boundary: {len(public)} topics, {len(search_indexes)} search indexes')
    return bool(errors)


if __name__ == '__main__':
    sys.exit(main())
