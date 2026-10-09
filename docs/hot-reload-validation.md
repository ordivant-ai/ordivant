<span id="開發容器-hot-reload-驗收"></span>
<span id="开发容器-hot-reload-验收"></span>

# 開發容器 Hot Reload 驗收 {#development-container-hot-reload-acceptance}

此驗收器檢查已啟動的 development Compose project `ordivant-dev`，確認 Work、Knowledge、Code 三個 Uvicorn API、Pi runtime 的 TypeScript compiler/Node `--watch`，以及 React Vite 都透過唯讀 host source bind mount 實際重載。

執行前，請暫停會操作這些產品的瀏覽器驗收，避免把 probe 期間的頁面更新當成產品回歸。Docker daemon 必須可連線，指定 project 的 API、runtime、web containers 必須已啟動。從 repository root 執行：

```powershell
$env:UV_CACHE_DIR = ".cache/uv"
uv run --project backend python scripts/hot_reload_acceptance.py --project ordivant-dev
```

腳本只依序在五個指定 source 檔尾端附加帶唯一識別碼的註解：Work `main.py`、Knowledge `main.py`、Code `main.py`、runtime `server.ts`、frontend `main.tsx`。它確認容器內 source marker 可見；Python API 必須觀察到 Uvicorn worker PID 改變並恢復 health；runtime 必須確認 marker 編譯到 `dist/server.js`、非-watch `server.js` child PID 改變並恢復 health；Vite 必須經 HTTP 回傳更新 source 並新增對應 HMR/page-reload log event。

runtime stage 分別記錄 source bind marker 是否可見、marker 是否出現在 `dist/server.js`、實際 Node server child PID 是否改變，以及 reload 後 health 是否回傳 200，失敗報告會指出未滿足的 predicate。每個 stage 結束時，以及腳本總體 `finally`，都會用開始前保存的 bytes 還原 source 並核對 SHA-256。腳本只讀取容器 mount/process/log metadata 與公開 health/HTTP 回應，不讀 secret、不在容器內寫 source、不停止或刪除容器與 volumes。避免強制終止程序；若遇到正常錯誤或 Ctrl+C，`finally` 會執行還原。

結果寫入忽略目錄 `.data/validation/hot-reload-acceptance-<timestamp>-<id>.json`，stdout 也輸出不含 token 的 JSON。總耗時受每個 reload stage 40 秒 timeout 限制；若任何服務未確認 reload，報告會標示失敗 stage，應交由 PM 檢查，不應據此修改 Compose 或服務架構。
