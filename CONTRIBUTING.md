# Contributing to Ordivant

Thank you for contributing to Ordivant. This repository is an enterprise agent collaboration suite: Work, Identity, Knowledge, Code, Runtime, and the isolated Sandbox have separate responsibilities and deployment boundaries.

## 開發環境

Python 服務使用 Python 3.12 與 `uv`；Runtime 和 React 前端使用 Node.js 24 與 npm。可從 repo 根目錄執行以下命令；各 Python 專案會在自己的目錄建立獨立 `.venv`。

```sh
uv sync --project backend --frozen --extra dev
uv sync --project products/identity/backend --frozen --extra dev
uv sync --project products/knowledge/backend --frozen --extra dev
uv sync --project products/code/backend --frozen --extra dev
uv sync --project sandbox --frozen --group dev
npm ci --prefix runtime
npm ci --prefix frontend
```

Windows 開發者仍可使用既有 PowerShell 入口，例如 `scripts/setup.ps1 -SkipSeed`、`scripts/validate.ps1` 和 `scripts/containers.ps1`。容器化與 PostgreSQL 完整驗收需要本機 Docker Desktop；一般 Python/Node 測試與 CI 不需要 Docker daemon。請勿以替代腳本覆蓋或移除既有 Windows 工作流程。

## 本機檢查

Python 測試必須在各自的專案環境執行：

```sh
uv run --project backend --directory backend --frozen --no-sync pytest
uv run --project products/identity/backend --directory products/identity/backend --frozen --no-sync pytest
uv run --project products/knowledge/backend --directory products/knowledge/backend --frozen --no-sync pytest
uv run --project products/code/backend --directory products/code/backend --frozen --no-sync pytest
uv run --project sandbox --directory sandbox --frozen --no-sync python -c "import sys; sys.path.insert(0, '..'); import pytest; raise SystemExit(pytest.main())"
```

Runtime 測試同時執行 TypeScript build 與 Node test suite：

```sh
npm --prefix runtime test
```

前端 typecheck 包含在各 build 中，四種產品入口都要維持可建置：

```sh
npm --prefix frontend run build:suite
npm --prefix frontend run build:work
npm --prefix frontend run build:knowledge
npm --prefix frontend run build:code
```

整合驗收在隔離的本機資料目錄啟動服務。Work REST/MCP/Pi 驗收前要先建置 Runtime；產品 smoke 會依序啟動 Knowledge 與 Code，不需要 Gitea 或 Docker：

```sh
npm --prefix runtime ci
npm --prefix runtime run build
uv run --project backend --frozen --no-sync python scripts/integration.py

uv sync --project products/knowledge/backend --frozen
uv sync --project products/code/backend --frozen
uv run --project products/knowledge/backend --frozen --no-sync python scripts/product_smoke.py --product all
```

CI 使用 `demo` Runtime 模式，不呼叫付費模型。除非測試明確要求，不要設定或轉送真實 provider key、工作階段 cookie、agent/runtime token、Gitea 憑證或其他私人服務設定。

## 範圍與責任

- `backend/` 維護 Work 業務 API、MCP 與權限；所有業務授權必須由 Python service 執行。
- `products/identity/backend/`、`products/knowledge/backend/`、`products/code/backend/` 分別維護獨立產品身分、文件知識與程式碼整合邊界。
- `runtime/` 維護 Pi Durable 執行、派送與執行回報；不得取代業務服務的授權或租約檢查。
- `sandbox/` 維護隔離 command 執行器；不得把 Docker socket 或主機目錄掛載至不受信任服務。
- `frontend/` 維護共用 React UI 與各產品 build mode；前端狀態不能取代伺服器授權。
- PM 維護架構、共用契約、repo 根目錄 tooling 與跨模組整合。改動共享契約前，先與 PM 協調；實作只改分派或明確負責的檔案。

請保持產品資料、API、MCP 與部署邊界清楚。Task 與 execution 是不同紀錄；完成結果需要證據並由獨立 reviewer 驗收。Mutation 的冪等、租約 fencing、依賴循環、跨專案授權、重啟復原及協作 round trip 應依變更風險補上測試。

## Pull request

請使用 PR 範本說明行為變更、影響邊界、風險、執行過的檢查與文件狀態。移除或遮蔽日誌中的 secret、個人資料與私人服務位址；不要提交 `.data/`、`.env*`、`.venv/`、`node_modules/`、build 產物或本機 bootstrap 憑證。

安全漏洞請透過 [GitHub 私下安全回報](https://github.com/ordivant-ai/ordivant/security/advisories/new)，不要建立公開 Issue、PR 或貼上可利用細節。若私下回報功能尚未啟用，請聯絡 repo 維護者以設定安全聯絡方式。

## 介面與文件翻譯

介面訊息使用 `frontend/src/i18n` 的 `t`／`useI18n`，英文詞庫依模組存放，禁止翻譯使用者內容與 API 值。修改後執行 `npm --prefix frontend run i18n:generate` 與 `npm --prefix frontend run i18n:check`。新增文件時，請同時維護原始繁中、`docs/zh-CN`、`docs/en` 的同路徑頁面。完整流程見 [語言與翻譯](docs/i18n.md)。
