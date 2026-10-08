import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
import { Converter } from '../frontend/node_modules/opencc-js/dist/esm/full.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'frontend/src');
const directory = path.join(sourceRoot, 'i18n/catalogs');
const readCatalog = filename => {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const context = {exports: {}};
  vm.runInNewContext(code, context, {timeout: 1000});
  return context.exports.default;
};
const english = {};
const modules = {};
const converter = Converter({ from: 'twp', to: 'cn' });
const convert = text => converter(text).replaceAll('帐号', '账号').replaceAll('缺省', '默认').replaceAll('接口语言', '界面语言');
const placeholders = value => [...value.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort();
const errors = [];
for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.en.ts')).sort()) {
  const catalog = readCatalog(path.join(directory, name));
  modules[name] = {default: catalog};
  const simplifiedPath = path.join(directory, name.replace('.en.ts', '.zh-CN.json'));
  const generated = Object.fromEntries(Object.keys(catalog).map(key => [key, convert(key)]));
  const expected = JSON.stringify(generated, null, 2) + '\n';
  if (process.argv.includes('--write')) fs.writeFileSync(simplifiedPath, expected);
  else if (!fs.existsSync(simplifiedPath) || fs.readFileSync(simplifiedPath, 'utf8') !== expected) errors.push(`${name}: regenerate Simplified Chinese with npm run i18n:generate`);
  for (const [key, value] of Object.entries(catalog)) {
    if (!value?.trim()) errors.push(`${name}: empty translation: ${key}`);
    if (/[\u3400-\u9fff]/u.test(value)) errors.push(`${name}: untranslated English: ${key}`);
    if (JSON.stringify(placeholders(key)) !== JSON.stringify(placeholders(value))) errors.push(`${name}: interpolation mismatch: ${key}`);
    // Catalogs can share source keys only when they agree on the translation.
    if (english[key] && english[key] !== value) errors.push(`${name}: conflicting translation: ${key}`);
    english[key] = value;
  }
}
const files = fs.readdirSync(sourceRoot, { recursive: true }).filter(name => /\.tsx?$/.test(name) && !name.replaceAll('\\','/').startsWith('i18n/catalogs'));
for (const name of files) {
  const tree = ts.createSourceFile(name, fs.readFileSync(path.join(sourceRoot,name), 'utf8'), ts.ScriptTarget.Latest, true, name.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const walk = node => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 't' && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])) {
      const key = node.arguments[0].text;
      if (!Object.hasOwn(english,key)) errors.push(`${name}: missing translation: ${key}`);
    }
    if (ts.isJsxText(node) && /[\u3400-\u9fff]/u.test(node.text)) errors.push(`${name}: hardcoded JSX text: ${node.text.trim()}`);
    if (ts.isStringLiteralLike(node) && /[\u3400-\u9fff]/u.test(node.text) && !name.endsWith('LanguageSelect.tsx') && !Object.hasOwn(english,node.text)) {
      errors.push(`${name}: uncatalogued source copy: ${node.text}`);
    }
    ts.forEachChild(node,walk);
  };
  walk(tree);
}
// Exercise the actual locale store in a browser-shaped environment without mounting React.
const makeStore = ({ saved, languages = ['en-US'], denied = false } = {}) => {
  const storage = new Map(saved === undefined ? [] : [['ordivant.locale', saved]]);
  const handlers = {};
  const document = { documentElement: {lang:''} };
  const window = { navigator: {languages}, localStorage: { getItem: key => {if(denied) throw Error('blocked');return storage.get(key) ?? null;}, setItem: (key,value) => {if(denied) throw Error('blocked');storage.set(key,value);} }, addEventListener: (key,fn) => {handlers[key]=fn;} };
  const original = fs.readFileSync(path.join(sourceRoot,'i18n/index.ts'),'utf8')
    .replace(/import\.meta\.glob<\{ default: Catalog \}>\('\.\/catalogs\/\*\.en\.ts', \{ eager: true \}\)/, 'globalThis.englishModules')
    .replace(/import\.meta\.glob<\{ default: Catalog \}>\('\.\/catalogs\/\*\.zh-CN\.json', \{ eager: true \}\)/, 'globalThis.simplifiedModules');
  const context = { exports:{}, window, document, Intl, englishModules:modules, simplifiedModules: {all:{default:Object.fromEntries(Object.keys(english).map(key=>[key,convert(key)]))}}, require: name => {assert.equal(name,'react');return {useEffect:()=>{}, useSyncExternalStore: (_subscribe,getSnapshot) => getSnapshot()};} };
  const code = ts.transpileModule(original, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,context,{timeout:1000});
  return {...context.exports, document, storage, handlers};
};
let checks = 0;
const check = (name, callback) => { try { callback(); checks++; } catch (error) { errors.push(`${name}: ${error.message}`); } };
check('browser negotiation and supported fallback',()=>{ const s=makeStore();assert.equal(s.getLocale(),'en'); for(const [tag,expected] of [['zh-TW','zh-TW'],['zh-HK','zh-TW'],['zh-Hant','zh-TW'],['zh-CN','zh-CN'],['zh-SG','zh-CN'],['en-GB','en'],['fr-FR','zh-TW']]) assert.equal(s.resolveLocale([tag]),expected);assert.equal(s.resolveLocale(['fr','en']),'en'); });
check('saved preference and document language',()=>{const s=makeStore({saved:'zh-TW'});assert.equal(s.getLocale(),'zh-TW');assert.equal(s.document.documentElement.lang,'zh-Hant');s.setLocale('zh-CN');assert.equal(s.document.documentElement.lang,'zh-Hans');assert.equal(s.storage.get('ordivant.locale'),'zh-CN');s.setLocale('unsupported');assert.equal(s.getLocale(),'zh-CN');});
check('corrupt and inaccessible storage',()=>{assert.equal(makeStore({saved:'invalid'}).getLocale(),'en');const s=makeStore({denied:true});s.setLocale('zh-TW');assert.equal(s.getLocale(),'zh-TW');});
check('cross-tab synchronization',()=>{const s=makeStore();s.handlers.storage({key:'ordivant.locale',newValue:'zh-CN'});assert.equal(s.getLocale(),'zh-CN');assert.equal(s.document.documentElement.lang,'zh-Hans');s.handlers.storage({key:'other',newValue:'en'});assert.equal(s.getLocale(),'zh-CN');});
check('translation interpolation preserves external values',()=>{const s=makeStore();const value='<script>使用者內容</script>';assert.equal(s.t('{{product}} 導覽',{product:value}),`${value} navigation`);assert.equal(s.t('unknown user content'), 'unknown user content');s.setLocale('zh-CN');assert.equal(s.t('介面語言'),'界面语言');const message=s.localized('模型連線設定無法載入：{{error}}',{error:s.localized('請求未完成。')});s.setLocale('en');assert.equal(s.t(message),'Could not load model connections: The request could not be completed.');});
check('date and number locale formats',()=>{const s=makeStore();assert.equal(s.formatDate(null),'—');assert.equal(s.formatDate('invalid'),'—');const date=new Date('2026-10-08T00:00:00Z');for(const locale of ['en','zh-TW','zh-CN']) {s.setLocale(locale);const options={dateStyle:'full',timeZone:'UTC'};assert.equal(s.formatDate(date,options),new Intl.DateTimeFormat(locale,options).format(date));assert.equal(s.formatNumber(1234.5),new Intl.NumberFormat(locale).format(1234.5));}});
check('localized API errors retain codes and hide raw server text',()=>{
  for (const locale of ['zh-TW','zh-CN','en']) {
    const store=makeStore({saved:locale});const context={exports:{},require:()=>({t:store.t})};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(sourceRoot,'i18n/errors.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context,{timeout:1000});
    const error=context.exports.describeApiError({detail:{code:'stale_version',message:'PRIVATE SERVER DETAIL'}},409);
    assert.equal(error.code,'stale_version');assert.ok(!error.message.includes('PRIVATE'));assert.ok(error.message.length>0);
    const validation=context.exports.describeApiError({detail:[{loc:['body','title'],type:'missing',input:'PRIVATE INPUT'}]},422);
    assert.ok(validation.message.startsWith('title: '));assert.ok(!validation.message.includes('PRIVATE'));assert.equal(store.t(validation.sourceMessage),store.t('輸入資料不符合格式，請檢查表單。'));assert.ok(context.exports.describeApiError({detail:[null]},422).message.length>0);
    assert.ok(!context.exports.describeApiError({detail:'RAW ERROR'},500).message.includes('RAW'));
  }
});
if(errors.length) {console.error(errors.join('\n'));process.exitCode=1;} else console.log(`I18N_OK: ${Object.keys(english).length} messages, 3 locales, ${checks} behavior checks; catalogs and interpolation match.`);
