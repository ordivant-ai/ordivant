// Isolated QA browser acceptance. Launch through execution_browser.py.
const { chromium } = require('../.cache/browser-qa/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const BASE = 'http://127.0.0.1:8092';
const directory = path.resolve('.data/validation/execution-browser');
const checks = {};
let currentCheck = 'initialization';
let page;
function check(name, value) { currentCheck=name; checks[name]=Boolean(value); assert.ok(value,name); }
async function nav(label) { await page.locator('button.nav-item').filter({hasText:label}).click(); }
async function choose(label, option, name, multi=false) {
 currentCheck=name;
 await page.getByLabel(label,{exact:true}).last().locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," ant-select ")][1]').click();
 const popup=page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
 await popup.waitFor({state:'visible'});
 const row=popup.locator('.ant-select-item-option').filter({hasText:option}).first();
 // Ant Design virtualizes long option lists. Use real wheel input to reach an
 // option that is not mounted yet, then check its position and mouse hit target.
 for(let index=0;index<80;index++) {
  if(await row.count()) break;
  const holder=popup.locator('.rc-virtual-list-holder').first();
  const holderBounds=await holder.boundingBox();
  assert.ok(holderBounds,'virtual_list_holder_visible');
  await page.mouse.move(holderBounds.x+holderBounds.width/2,holderBounds.y+holderBounds.height/2);
  await page.mouse.wheel(0,180);
  await row.waitFor({state:'attached',timeout:200}).catch(error=>{if(error.name!=='TimeoutError')throw error;});
 }
 await row.scrollIntoViewIfNeeded();
 const bounds=await row.boundingBox();
 const size=page.viewportSize();
 check(name+'_within_viewport',bounds && bounds.x>=-1 && bounds.y>=-1 && bounds.x+bounds.width<=size.width+1 && bounds.y+bounds.height<=size.height+1);
 const receives=await row.evaluate(el=>{ const r=el.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return el===hit || el.contains(hit); });
 check(name+'_receives_mouse',receives);
 await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
 if(multi) await page.keyboard.press('Escape');
}
async function submit(name, endpoint, method='POST') {
 currentCheck='submit_'+name;
 const result=page.waitForResponse(r=>r.url()===BASE+endpoint && r.request().method()===method);
 await page.getByRole('dialog').getByRole('button',{name,exact:true}).click();
 const response=await result;
 check('saved_'+name,response.ok());
 return response.json();
}
async function cancel() { await page.getByRole('dialog').getByRole('button',{name:/取\s*消/}).click(); }
async function shot(name) { await page.screenshot({path:path.join(directory,name+'.png'),fullPage:false}); }
async function tableRow(name) {
 for(let count=0;count<100;count++) {
  const row=page.locator('tr').filter({hasText:name});
  await row.first().waitFor({state:'attached',timeout:1500}).catch(error=>{if(error.name!=='TimeoutError')throw error;});
  if(await row.count()) return row;
  const next=page.locator('.ant-pagination-next:not(.ant-pagination-disabled)').last();
  assert.ok(await next.count(),'row_not_found_in_any_page');
  await next.click();
 }
 throw new Error('table_page_limit');
}
async function main() {
 await fs.mkdir(directory,{recursive:true});
 const resources=JSON.parse(await fs.readFile('.data/validation/execution-qa-resources.json','utf8'));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const report={status:'failed',target:BASE,checks};
 try {
  page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(12000);
  const pageErrors=[];
  page.on('pageerror',()=>pageErrors.push('page_error'));
  await page.goto(BASE+'/work');
  await page.getByLabel('電子郵件').fill(process.env.ORDIVANT_QA_EMAIL);
  await page.getByLabel('密碼',{exact:true}).fill(process.env.ORDIVANT_QA_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.getByRole('combobox',{name:'選擇專案'}).waitFor();
  await choose('選擇專案',resources.project.name,'desktop_project');
  const suffix=Date.now().toString(36);

  await nav('工具與沙箱');
  await page.getByRole('button',{name:/新增連線/}).first().click();
  await page.getByLabel('連線名稱').fill('UI MCP '+suffix);
  await page.getByLabel('MCP Streamable HTTP endpoint').fill('http://mcp-fixture:8050/mcp');
  await page.getByLabel('新連線 Token').fill('synthetic-ordivant-execution-mcp');
  // Tool allowlist is entered explicitly, and the server is contacted after save.
  const allow=page.getByRole('combobox',{name:'允許的工具'});
  await allow.fill('synthetic_add'); await allow.press('Enter'); await page.keyboard.press('Escape');
  const conn=await submit('儲存連線','/api/tool-connections');
  const connRow=page.locator('tr').filter({hasText:'UI MCP '+suffix});
  await connRow.getByRole('button',{name:/測試/}).click();
  await page.getByText('synthetic_add',{exact:true}).last().waitFor();
  check('ui_real_mcp_discovery',true);
  await shot('desktop-tools');

  await page.getByText('Sandbox profiles',{exact:true}).click();
  await page.getByRole('button',{name:/新增 Profile/}).first().click();
  await page.getByLabel('Profile 名稱').fill('UI Sandbox '+suffix);
  await page.getByLabel('Profile 狀態').click();
  const limits={'最長執行秒數':'8','記憶體（MB）':'128','CPU 數':'0.5','PID 上限':'32','輸出上限（bytes）':'4096','Workspace（MB）':'8'};
  for(const [label,value] of Object.entries(limits)) await page.getByLabel(label,{exact:true}).fill(value);
  const profile=await submit('儲存 Profile','/api/sandbox-profiles');
  check('ui_profile_limits_persist',profile.limits.timeout_seconds===8 && profile.limits.cpu_count===0.5);

  await nav('自動化');
  await page.getByRole('button',{name:/新增範本/}).first().click();
  await page.getByLabel('範本 key').fill('ui-'+suffix);
  await page.getByLabel('顯示名稱').fill('UI Builder '+suffix);
  await choose('Agent 角色','執行者','desktop_template_role');
  await choose('可用工具連線',resources.connection.name,'desktop_template_tools',true);
  await choose('Sandbox profile',resources.profile.name,'desktop_template_sandbox');
  await page.getByLabel('Agent 指令').fill('Only synthetic QA tasks. Capture real evidence.');
  const templateReload=page.waitForResponse(r=>r.request().method()==='GET' && r.url()===BASE+'/api/agent-templates');
  const template=await submit('建立 v1','/api/agent-templates');
  await templateReload;
  await page.locator('.automation-table-shell .ant-spin-spinning').waitFor({state:'hidden'});
  await (await tableRow('UI Builder '+suffix)).getByRole('button',{name:'套用此版本'}).click();
  await page.getByLabel('名稱',{exact:true}).fill('UI Agent '+suffix);
  const applied=await page.getByLabel('Agent 指令').inputValue();
  check('ui_template_exact_definition_applied',applied===template.definition.instructions);
  await page.getByLabel('Agent 指令').fill(applied+' With local override.');
  const agent=await submit('建立 Agent','/api/agents');
  check('ui_template_then_manual_override_saved',agent.template_id===template.id && agent.execution_config.instructions.endsWith('With local override.'));
  check('ui_template_tool_and_sandbox_bindings_saved',agent.execution_config.tool_connection_ids.includes(resources.connection.id) && agent.execution_config.sandbox_profile_id===resources.profile.id);
  // The one-time Agent credential is neither logged nor captured in screenshots.
  const credentialDialog=page.getByRole('dialog');
  if(await credentialDialog.isVisible()) {
   const close=credentialDialog.getByRole('button',{name:/完成|關閉|確定|我已/}).last();
   if(await close.count()) await close.click(); else await credentialDialog.locator('.ant-modal-close').click();
  }
  await page.getByRole('button',{name:'編輯 UI Agent '+suffix,exact:true}).click();
  await page.getByLabel('最多模型回合').fill('12');
  const edited=await submit('儲存變更','/api/agents/'+agent.id,'PATCH');
  check('ui_edit_execution_settings_saved',edited.execution_config.limits.max_turns===12);
  await shot('desktop-agents');

  await nav('自動化');
  await page.getByText('工作流程',{exact:true}).click();
  await page.getByRole('button',{name:/新增流程/}).first().click();
  await page.getByLabel('流程 key').fill('ui-flow-'+suffix);
  await page.getByLabel('顯示名稱').fill('UI flow '+suffix);
  await page.getByLabel('Step key').fill('verify');
  await page.getByLabel('步驟名稱').fill('Synthetic verification');
  await page.getByLabel('目標',{exact:true}).fill('Return real synthetic QA evidence');
  await choose('指定 Pi Agent',resources.agent.name,'desktop_flow_agent');
  await choose('獨立審核者',resources.reviewer.name,'desktop_flow_reviewer');
  await page.getByLabel('驗收條件').fill('Actual evidence and independent review');
  const workflowReload=page.waitForResponse(r=>r.request().method()==='GET' && r.url().startsWith(BASE+'/api/workflows?'));
  const flow=await submit('建立 v1','/api/workflows');
  await workflowReload;
  await page.locator('.automation-table-shell .ant-spin-spinning').waitFor({state:'hidden'});
  await (await tableRow('UI flow '+suffix)).getByRole('button',{name:/啟動/}).click();
  await page.getByLabel('流程輸入').fill('Browser synthetic QA');
  // Commit the first real API request, then lose only its response. A user retry
  // must reuse the operation key and receive the same instance without duplication.
  const startUrl=BASE+'/api/workflows/'+flow.id+'/start';
  const startKeys=[];
  let committedInstanceId;
  await page.route(startUrl,async route=>{
   startKeys.push(route.request().headers()['idempotency-key']);
   const upstream=await route.fetch();
   if(startKeys.length===1) {
    assert.ok(upstream.ok(),'first_start_reached_real_server');
    committedInstanceId=(await upstream.json()).id;
    await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'合成 QA：伺服器已處理，回應傳輸失敗；請重試。'})});
   } else await route.fulfill({response:upstream});
  });
  const lostResponse=page.waitForResponse(r=>r.url()===startUrl && r.request().method()==='POST');
  await page.getByRole('dialog').getByRole('button',{name:'啟動流程',exact:true}).click();
  check('ui_committed_start_response_loss',(await lostResponse).status()===503);
  await page.getByRole('dialog').getByText(/回應傳輸失敗/).waitFor();
  const instance=await submit('啟動流程','/api/workflows/'+flow.id+'/start');
  await page.unroute(startUrl);
  check('ui_start_retry_reuses_idempotency_key',startKeys.length===2 && Boolean(startKeys[0]) && startKeys[0]===startKeys[1]);
  check('ui_start_retry_returns_same_real_instance',instance.id===committedInstanceId);
  check('ui_workflow_start_real_instance',instance.steps.length===1 && instance.trigger==='manual');
  await shot('desktop-workflows');

  await page.setViewportSize({width:390,height:844});
  await nav('Run 執行');
  await choose('依 Run 狀態篩選','全部狀態','mobile_run_filter');
  await shot('mobile-runs');
  await nav('Agent 名錄');
  await page.getByRole('button',{name:/新增 Agent/}).click();
  await choose('角色','審核者','mobile_agent_role');
  await choose('Runtime','Pi Durable','mobile_agent_runtime');
  await choose('Agent 範本版本',template.name,'mobile_agent_template');
  await choose('可用工具連線',resources.connection.name,'mobile_agent_tools',true);
  await choose('Sandbox profile',resources.profile.name,'mobile_agent_sandbox');
  await shot('mobile-agent-form');
  await cancel();
  await nav('自動化');
  await page.getByText('工作流程',{exact:true}).click();
  await page.getByRole('button',{name:/新增流程/}).first().click();
  await choose('優先級','一般','mobile_flow_priority');
  await choose('指定 Pi Agent',resources.agent.name,'mobile_flow_agent');
  await shot('mobile-flow-form');
  await cancel();
  check('no_browser_javascript_errors',pageErrors.length===0);
  report.status='passed'; report.resources={connection_id:conn.id,profile_id:profile.id,template_id:template.id,agent_id:agent.id,workflow_id:flow.id,instance_id:instance.id};
 } catch(error) {
  report.failed_check=currentCheck; report.error_type=error.name;
  report.error_message=String(error.message).replaceAll(process.env.ORDIVANT_QA_PASSWORD,'[REDACTED]');
  report.comboboxes=await page.locator('[role="combobox"]').evaluateAll(els=>els.map(el=>({id:el.id,aria_label:el.getAttribute('aria-label'),labels:[...(el.labels||[])].map(x=>x.innerText)}))).catch(()=>[]);
  await shot('failure').catch(()=>{});
 } finally {
  await browser.close();
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  console.log(`EXECUTION_UI_${report.status.toUpperCase()} ${Object.keys(checks).length} checks; ${report.failed_check||'desktop + 390px'}`);
  if(report.status!=='passed') console.log(report.error_message);
  if(report.status!=='passed') console.log(JSON.stringify(report.comboboxes));
  if(report.status!=='passed')process.exitCode=1;
 }
}
main().catch(error=>{console.error(error.name);process.exitCode=1;});
