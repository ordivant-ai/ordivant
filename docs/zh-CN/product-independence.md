# 独立产品冒烟检查 {#product-independence-smoke}

`scripts/product_smoke.py` 会确认 Knowledge 和 Code 都能各自初始化数据并作为独立产品运行。脚本每次启动一项产品，使用随机 loopback port、该产品自己的 `.venv` Python，以及全新的 `.data/validation/standalone-*` 数据目录。它不会启动 Work、Pi runtime 或其他产品的服务。

依序检查两项产品：

```powershell
products/code/backend/.venv/Scripts/python.exe scripts/product_smoke.py --product all
```

协调程序只使用 Python 标准函数库。每项产品的官方 MCP Python SDK 都从该产品自己的环境运行。使用 `--product knowledge` 或 `--product code` 可单独检查其中一项产品。

Knowledge 检查会以 seed 创建的 writer 身分添加文档，读取不可变的 version 1，并确认文档正文，以及创建文档和读取版本时回传的 SHA-256 完全相符；接着搜索该文档并检查引用指向正确版本。此检查也会列出 MCP 工具，并通过 SDK 调用 `get_document_context`。

Code 检查会以 manager 身分读取 seed 创建的 `code-demo` 项目，确认 health 回报 `gitea_configured: false`，并确认创建 repository 时回传 `503 gitea_not_configured`。此检查也会列出 MCP 工具，并通过 SDK 调用 `list_code_projects`。测试时，会从 Code 子程序环境中移除继承的 `ORDIVANT_CODE_GITEA_*` 和 `ORDIVANT_CODE_WEBHOOK_SECRET` 设置。

冒烟检查命令会输出不含 token 的 JSON 证据，其中有产品状态、port、数据目录、API 检查及 MCP 往返结果。它只会停止自己启动的程序。唯一的验证数据目录会保留下来；其中含有本机 bootstrap 凭证，因此应保持未追踪状态，且不可公开发布。

2026-10-06 验证结果：Knowledge 和 Code 的独立运行均通过，包括 API 和 MCP 检查。`all` 选项会在同一次运行中依序进行相同检查。
