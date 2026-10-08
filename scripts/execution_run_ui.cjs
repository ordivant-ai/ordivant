// Real browser Run inspector/control acceptance; owned QA only.
const { chromium } = require('../.cache/browser-qa/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const BASE='http://127.0.0.1:8092';
const directory=path.resolve('.data/validation/execution-run-browser');
const checks={};
let stage='initialization';
function check(name,value){stage=name;checks[name]=Boolean(value);assert.ok(value,name);}
async function main(){
 await fs.mkdir(directory,{recursive:true});
 const resources=JSON.parse(await fs.readFile('.data/validation/execution-run-browser-resources.json','utf8'));
 const report={status:'failed',target:BASE,checks};
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.setDefaultTimeout(12000);
 try{
  await page.goto(BASE+'/work');
  await page.getByLabel('電子郵件').fill(process.env.ORDIVANT_QA_EMAIL);
  await page.getByLabel('密碼',{exact:true}).fill(process.env.ORDIVANT_QA_PASSWORD);
  await page.locator('button[type="submit"]').click();
  const projectInput=page.getByRole('combobox',{name:'選擇專案'});
  await projectInput.waitFor();
  await projectInput.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," ant-select ")][1]').click();
  const popup=page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
  await popup.waitFor({state:'visible'});
  const option=popup.locator('.ant-select-item-option').filter({hasText:resources.project.name});
  for(let i=0;i<80 && !await option.count();i++){
   const bounds=await popup.locator('.rc-virtual-list-holder').boundingBox();
   assert.ok(bounds,'project_popup_visible');
   await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
   await page.mouse.wheel(0,180);
   await option.waitFor({state:'attached',timeout:200}).catch(error=>{if(error.name!=='TimeoutError')throw error;});
  }
  await option.click();
  await page.locator('button.nav-item').filter({hasText:'Run 執行'}).click();
  await page.getByRole('textbox',{name:'依 Task ID 篩選 Run'}).fill(resources.task_id);
  const row=page.getByRole('row',{name:'檢視 Run '+resources.run_id,exact:true});
  await row.click();
  const drawer=page.locator('.ant-drawer-content');
  await drawer.getByText(resources.task_id,{exact:true}).waitFor();
  check('real_run_task_link_visible',true);
  check('unstarted_execution_is_honest',await drawer.getByText('尚未建立',{exact:true}).isVisible());
  check('unknown_cost_is_honest',await drawer.locator('.run-usage-grid').getByText('未知',{exact:true}).count()===7);
  const originalControl=BASE+'/api/runs/'+resources.run_id+'/control';
  const stoppedResponse=page.waitForResponse(r=>r.url()===originalControl && r.request().method()==='POST');
  await drawer.getByRole('button',{name:/停\s*止/}).click();
  const stopped=await (await stoppedResponse).json();
  check('mouse_stop_aborts_queued_run',stopped.status==='aborted');
  await drawer.getByRole('button',{name:/重\s*跑/}).waitFor();
  const keys=[]; let committedId;
  await page.route(originalControl,async route=>{
   if(route.request().postDataJSON().action!=='retry'){await route.continue();return;}
   keys.push(route.request().headers()['idempotency-key']);
   const response=await route.fetch();
   assert.ok(response.ok(),'retry_reached_real_server');
   const value=await response.json();
   if(keys.length===1){committedId=value.id;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'合成 QA：已建立重跑 Run，但回應傳輸失敗；請重試。'})});}
   else await route.fulfill({response});
  });
  const lostResponse=page.waitForResponse(r=>r.url()===originalControl && r.request().method()==='POST');
  await drawer.getByRole('button',{name:/重\s*跑/}).click();
  check('real_retry_response_lost',(await lostResponse).status()===503);
  await drawer.getByText(/回應傳輸失敗/).waitFor();
  const retriedResponse=page.waitForResponse(r=>r.url()===originalControl && r.request().method()==='POST');
  await drawer.getByRole('button',{name:/重\s*跑/}).click();
  const retry=await (await retriedResponse).json();
  await page.unroute(originalControl);
  check('retry_reuses_operation_key',keys.length===2 && Boolean(keys[0]) && keys[0]===keys[1]);
  check('retry_receives_same_committed_run',retry.id===committedId && retry.id!==resources.run_id && retry.retry_of===resources.run_id);
  await drawer.getByText(resources.run_id,{exact:true}).waitFor();
  await page.screenshot({path:path.join(directory,'desktop-run-retry.png')});
  const cleanupResponse=page.waitForResponse(r=>r.url()===BASE+'/api/runs/'+retry.id+'/control' && r.request().method()==='POST');
  await drawer.getByRole('button',{name:/停\s*止/}).click();
  check('retried_run_stopped_for_cleanup',(await (await cleanupResponse).json()).status==='aborted');
  await drawer.getByRole('button',{name:/重\s*跑/}).waitFor();
  await page.setViewportSize({width:390,height:844});
  const bounds=await drawer.boundingBox();
  check('mobile_run_drawer_within_viewport',bounds && bounds.x>=-1 && bounds.x+bounds.width<=391);
  await page.screenshot({path:path.join(directory,'mobile-run-inspector.png')});
  await drawer.locator('.ant-drawer-close').click();
  await page.getByRole('row',{name:'檢視 Run '+resources.run_id,exact:true}).waitFor();
  await page.getByRole('row',{name:'檢視 Run '+retry.id,exact:true}).waitFor();
  check('original_and_retry_history_both_visible',true);
  report.resources={original_run_id:resources.run_id,retry_run_id:retry.id,task_id:resources.task_id};
  report.status='passed';
 }catch(error){
  report.failed_check=stage;report.error_type=error.name;
  report.error_message=String(error.message).replaceAll(process.env.ORDIVANT_QA_PASSWORD,'[REDACTED]');
  await page.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});
 }finally{
  await browser.close();
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  console.log(`EXECUTION_RUN_UI_${report.status.toUpperCase()} ${Object.keys(checks).length} checks; ${report.failed_check||'stop/retry/response loss/mobile'}`);
  if(report.status!=='passed'){console.log(report.error_message);process.exitCode=1;}
 }
}
main().catch(error=>{console.error(error.name);process.exitCode=1;});
