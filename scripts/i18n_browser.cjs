// Run through: uv run --project backend --no-sync python scripts/execution_browser.py scripts/i18n_browser.cjs
// Uses the explicitly isolated synthetic QA account on 8092 only.
const { chromium } = require('../.cache/browser-qa/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../frontend/node_modules/typescript');
const assert = require('node:assert/strict');
const BASE = 'http://127.0.0.1:8092';
const directory = path.resolve('.data/validation/i18n-browser');
const checks = {};
const catalogs = { en: {}, 'zh-CN': {} };
const languages = [{locale:'zh-TW', label:'繁體中文',lang:'zh-Hant'}, {locale:'zh-CN',label:'简体中文',lang:'zh-Hans'}, {locale:'en',label:'English',lang:'en'}];
let current = 'initialization';
const check = (name, condition) => { current = name; checks[name] = Boolean(condition); assert.ok(condition,name); };
const exact = text => new RegExp(Array.from(text).map(c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s*'));
const label = (locale,key) => locale==='zh-TW' ? key : catalogs[locale][key] ?? key;
async function changeLanguage(page, language, prefix) {
  await page.locator('.language-control .ant-select').click();
  const option=page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({hasText:language.label});
  await option.waitFor({state:'visible'});
  const box=await option.boundingBox(); const viewport=page.viewportSize();
  check(prefix+'_popup_bounds',box && box.x>=0 && box.y>=0 && box.x+box.width<=viewport.width+1 && box.y+box.height<=viewport.height+1);
  check(prefix+'_popup_mouse',await option.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
  await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  await page.waitForFunction(lang=>document.documentElement.lang===lang,language.lang);
  const stored=await page.evaluate(()=>localStorage.getItem('ordivant.locale'));check(prefix+'_stored',stored===language.locale || (prefix==='login_zh-TW' && stored===null));
}
async function screenshot(page,name) {await page.screenshot({path:path.join(directory,name+'.png'),fullPage:false});}
async function main() {
  assert.ok(process.env.ORDIVANT_QA_EMAIL && process.env.ORDIVANT_QA_PASSWORD,'Launch through the synthetic QA wrapper');
  await fs.mkdir(directory,{recursive:true});
  for (const name of await fs.readdir('frontend/src/i18n/catalogs')) {
    if(name.endsWith('.en.ts')) {const context={exports:{}};vm.runInNewContext(ts.transpileModule(await fs.readFile('frontend/src/i18n/catalogs/'+name,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);Object.assign(catalogs.en,context.exports.default);}
    if(name.endsWith('.zh-CN.json')) Object.assign(catalogs['zh-CN'],JSON.parse(await fs.readFile('frontend/src/i18n/catalogs/'+name,'utf8')));
  }
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-TW'});
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const report={status:'failed',target:BASE,checks};
  try {
    await page.goto(BASE+'/work');await page.locator('.language-control').waitFor();
    for(const language of languages) {
      await changeLanguage(page,language,'login_'+language.locale);
      check('login_'+language.locale+'_copy',(await page.locator('body').innerText()).includes(label(language.locale,'電子郵件')));
    }
    await page.locator('form').getByRole('button',{name:exact(label('en','登入'))}).click();
    await page.locator('.ant-form-item-explain-error').first().waitFor();
    check('english_validation_copy',!/[\u3400-\u9fff]/u.test((await page.locator('.ant-form-item-explain-error').allInnerTexts()).join(' ')));
    await changeLanguage(page,languages[0],'validation_switch');
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('.ant-form-item-explain-error')).some(el=>el.textContent.includes('請輸入有效的電子郵件')));
    check('existing_validation_error_retranslated',true);
    // Drafts survive an ordinary language switch without remounting the form.
    const email=page.locator('input[autocomplete=email]');await email.fill(process.env.ORDIVANT_QA_EMAIL);
    await changeLanguage(page,languages[0],'draft');
    check('login_email_draft_preserved',await email.inputValue()===process.env.ORDIVANT_QA_EMAIL);
    await page.locator('input[type=password]').first().fill(process.env.ORDIVANT_QA_PASSWORD);
    await page.locator('form').getByRole('button',{name:exact('登入')}).click();
    await page.locator('.side-rail .workspace-identity').waitFor();
    for (const language of languages) {
      current=language.locale+'_work';await changeLanguage(page,language,'work_'+language.locale);
      // Every Work section is actually visited; headers/columns must switch too.
      const navigation=page.locator('.rail-nav .nav-item');const count=await navigation.count();check(language.locale+'_work_sections_exist',count>=8);
      for(let index=0;index<count;index++) {await navigation.nth(index).click();await page.locator('.page-heading h2').waitFor();
        const title=await page.locator('.page-heading h2').innerText();check(language.locale+'_work_section_'+index,Boolean(title.trim()) && (language.locale!=='en' || !/[\u3400-\u9fff]/u.test(title)));
        if(language.locale==='en') check('en_work_columns_'+index,!/[\u3400-\u9fff]/u.test((await page.locator('thead').allInnerTexts()).join(' ')));
      }
      await navigation.first().click();
      const search=page.getByLabel(label(language.locale,'搜尋任務'),{exact:true});await search.fill('QA 原文保持 unchanged');
      await page.reload();await page.locator('.language-control').waitFor();
      check(language.locale+'_reload_locale',await page.locator('html').getAttribute('lang')===language.lang);
      await screenshot(page,'work-'+language.locale);
      // Shared Identity account tabs are available in all three languages.
      await page.getByRole('button',{name:exact(label(language.locale,'帳號與安全性'))}).click();
      const drawer=page.locator('.ant-drawer-content').last();await drawer.waitFor();
      const tabs=drawer.getByRole('tab');check(language.locale+'_account_tabs',await tabs.count()>=4);
      for(let index=0;index<await tabs.count();index++) {await tabs.nth(index).click();if(language.locale==='en') check('en_account_tab_'+index,!/[\u3400-\u9fff]/u.test(await tabs.nth(index).innerText()));}
      await drawer.locator('.ant-drawer-close').click();
      for(const product of ['knowledge','code']) {
        await page.goto(BASE+'/'+product);await page.locator('.side-rail .workspace-identity').waitFor();
        check(language.locale+'_'+product+'_shared_locale',await page.locator('html').getAttribute('lang')===language.lang);
        const nav=page.locator('.rail-nav .nav-item');for(let index=0;index<await nav.count();index++){await nav.nth(index).click();const title=await page.locator('.page-heading h2').innerText();check(language.locale+'_'+product+'_section_'+index,Boolean(title.trim()) && (language.locale!=='en'||!/[\u3400-\u9fff]/u.test(title)));}
        const createKey=product==='knowledge'?'建立 Space':'建立 Code project';
        await page.getByRole('button',{name:exact(label(language.locale,createKey))}).click();
        const dialog=page.getByRole('dialog');await dialog.waitFor();
        if(language.locale==='en') check('en_'+product+'_form_labels',!/[\u3400-\u9fff]/u.test((await dialog.locator('label').allInnerTexts()).join(' ')));
        await dialog.getByRole('button',{name:exact(label(language.locale,'取消'))}).click();
        await screenshot(page,product+'-'+language.locale);
      }
      await page.goto(BASE+'/work');await page.locator('.side-rail .workspace-identity').waitFor();
    }
    // A second tab changes the locale while an unsaved task remains open.
    await changeLanguage(page,languages[0],'cross_tab_initial');
    await page.getByRole('button',{name:exact('新增任務')}).click();
    const taskDialog=page.getByRole('dialog');await taskDialog.waitFor();
    const input=taskDialog.locator('input').first();await input.fill('不翻譯的草稿 unchanged draft');
    const second=await context.newPage();await second.goto(BASE+'/knowledge');await second.locator('.language-control').waitFor();
    await changeLanguage(second,languages[2],'cross_tab_source');await page.waitForFunction(()=>document.documentElement.lang==='en');
    check('cross_tab_keeps_open_task_draft',await input.inputValue()==='不翻譯的草稿 unchanged draft');
    check('cross_tab_updates_modal_title',!/[\u3400-\u9fff]/u.test(await taskDialog.locator('.ant-modal-title').innerText()));
    await taskDialog.getByRole('button',{name:exact(label('en','取消'))}).click();await second.close();
    for(const language of languages) {
      await page.setViewportSize({width:390,height:844});await changeLanguage(page,language,'mobile_'+language.locale);
      check('mobile_'+language.locale+'_no_horizontal_overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await screenshot(page,'mobile-'+language.locale);
    }
    check('no_javascript_errors',errors.length===0);report.status='passed';
  } catch(error) {report.current=current;report.error=error.message;await screenshot(page,'failure').catch(()=>{});throw error;}
  finally {report.javascriptErrors=errors;await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));await browser.close();}
  console.log(JSON.stringify({status:report.status,checks:Object.keys(checks).length,report:path.join(directory,'report.json')}));
}
main().catch(error=>{console.error(current+': '+error.message);process.exitCode=1;});
