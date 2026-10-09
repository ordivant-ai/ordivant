<span id="真實模型與設定驗收"></span>
<span id="真实模型与设置验收"></span>

# 真实模型与设置验收 {#live-model-and-settings-acceptance}

日期：2026-10-07，Asia/Taipei。模型设置、Pi runtime 和前端分别由三位 luna-worker 实作，PM 负责共同契约、受信任的本机导入、容器集成、HTTP／鼠标／真实模型验收。

<span id="實際完成範圍"></span>
<span id="实际完成范围"></span>

## 实际完成范围 {#scope-actually-completed}

| 验收 | 证据 | 结果 |
|---|---|---|
| Work 设置与安全性单元测试 | `backend/tests/test_model_settings.py`；全 Work 测试 | 31 项测试通过；加密、跨组织隔离、管理员限制、revision、错误屏蔽、null 清除、快照、handoff scope/fence/期限与撤销 |
| Runtime 与 Responses adapter | `runtime/test/runtime.test.mjs` | 5 项测试通过；实际 Pi Harness／本机合成 Responses server、工具回合、usage cache breakdown、redirect 拒绝且只请求一次、pending live 重启等候 handoff |
| 前端 | TypeScript；Suite／Work／Knowledge／Code 建置 | 全部通过 |
| 真实端点协定测试 | `.data/validation/live-probe-388b5ccd/report.json` | `/models` 找到指定模型；两个串流 `/responses` 完成事件、模型发起工具调用并使用 42 的工具结果 |
| Cookie 管理员与 scoped manager 设置 | `.data/validation/model-settings-76ed3fd4/report.json` | 全部通过；只使用隔离 QA 合成 key，未调用模型 |
| 桌面／390px 真实鼠标操作 | `.data/validation/model-browser/report.json` 及 PNG | 全域保存、key 空白、Agent 新建 override、编辑继承、reload 保留、Modal popup 命中与手机保存通过 |
| 真实 Work → Pi → provider → tools → evidence → review | `.data/validation/live-work-08fdbdb1/report.json` | 全部通过；新建项目／Agent、幂等派工、模型工具调用、单一 execution、成果／receipt、禁止运行者自审、独立审查与重启持久化 |
| 加密与 runtime 纪录检查 | `.data/validation/live-work-08fdbdb1/record-checks.json` | Provider key 加密；临时 Agent delivery token 已撤销；Pi／request SQLite、idempotency response 与近期 API/runtime logs 未包含 key 或 delivery token |
| 本机 production image runtime 回归 | `.data/validation/model-production-runtime.json` | 无模型连接的 DEMO 派工、evidence、独立审查通过；没有外部 provider 请求 |

最后一份 live receipt 回报：

```json
{
  "mode": "live",
  "requested_model": "gpt-6.1-sol",
  "returned_model": "gpt-6.1-sol",
  "input_tokens": 17157,
  "uncached_input_tokens": 6661,
  "cached_input_tokens": 10496,
  "cache_write_tokens": 0,
  "output_tokens": 97,
  "total_tokens": 17254,
  "tools": {"get_task_context": 1, "report_progress": 1},
  "cost_usd": null
}
```

模型回报 `SYNTHETIC_RESULT=42`，由平台受限工具读取自己的任务与回报进度，结果进入 `in_review`。独立、已授权的测试 reviewer 验证 receipt 和结果后接受，任务成为 `done`；它是测试程序，不宣称是另一个 AI 模型审查。重启 runtime 后仍是同一个 submission 和 receipt。

较早的 `.data/validation/live-work-2be61825/` 是修正 cache 统计前的验收，其 input 字段只有 uncached 部分；以最后报告为准。没有改写或丢弃先前历史纪录。

<span id="重現"></span>
<span id="重现"></span>

## 重现 {#reproduce}

一般程序检查不会调用外部模型：

```powershell
$env:UV_CACHE_DIR = Join-Path (Get-Location) '.cache/uv'
uv run --project backend --no-sync pytest backend/tests -q
Set-Location runtime
npm test
Set-Location ../frontend
npm run typecheck
npm run build:suite
npm run build:work
npm run build:knowledge
npm run build:code
```

隔离设置 API 验收需要已准备的 `ordivant-auth-qa`、8092 及原有合成账号，只操作该 QA：

```powershell
$env:ORDIVANT_WEB_PORT = '8092'
.\scripts\containers.ps1 -ProjectName ordivant-auth-qa
uv run --project backend --no-sync python scripts/model_settings_acceptance.py
```

公开版本的 Live 验收需依[Live 验收设置](execution-usage.md#isolated-acceptance)明确提供 `ORDIVANT_TEST_PROVIDER_BASE`、`ORDIVANT_TEST_PROVIDER_MODEL`、`ORDIVANT_TEST_PROVIDER_PROJECT`（隔离 `*-qa` Compose project）与 `ORDIVANT_TEST_PROVIDER_KEY_FILE`。没有预设付费端点，不会自动读取主环境密钥；请先在自己的隔离 QA 设置兼容 Responses 模型。

```powershell
uv run --project backend --no-sync python scripts/model_probe.py
uv run --project backend --no-sync python scripts/live_model_acceptance.py --restart
uv run --project backend --no-sync python scripts/live_model_record_checks.py PATH_TO_LIVE_REPORT
```

操作员导入只会作用于明确指定且所有权相符的隔离 QA 环境；凭证透过 Docker exec 的 stdin 传递，不会放入进程参数。HTTP 仍要求 Identity 管理员权限。上述摘要是公开前留下的历史证据，原始 `.data/validation/` 报告与私人连接设置不包含在储存库副本中。

`scripts/integration.py` 的原有 runtime 验收明确限制未设置的 DEMO Agent，避免把 live run 误标为 demo；已设置模型时应使用独立 live 脚本。

<span id="驗收限制"></span>
<span id="验收限制"></span>

## 验收限制 {#acceptance-limitations}

只发送合成算术／任务数据，没有发送仓库或用户项目内容。验证的是此端点的实际模型请求、上游回报的 model ID、usage 和平台工具；代理服务的底层模型路由、容量与美元帐单未独立验证。Context／output ceilings 是用户提供的 metadata。硬性费用上限、费率与帐单比对、企业 SSO、外部 CI、完整备份还原、多人负载仍是各自独立门槛。

隔离 QA 容器及浏览器测试页在完成后关闭，volumes 保留；开发 5173 与本机 production 8088 的更新 images 保持运作。测试 Provider 只设置在开发环境，production 未配置模型连接。未进行远程部署、推送或发布。
