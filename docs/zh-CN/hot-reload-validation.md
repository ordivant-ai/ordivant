<span id="開發容器-hot-reload-驗收"></span>
<span id="开发容器-hot-reload-验收"></span>

# 开发容器 Hot Reload 验收 {#development-container-hot-reload-acceptance}

此验收器检查已启动的 development Compose project `ordivant-dev`，确认 Work、Knowledge、Code 三个 Uvicorn API、Pi runtime 的 TypeScript compiler/Node `--watch`，以及 React Vite 都透过唯读 host source bind mount 实际重载。

运行前，请暂停会操作这些产品的浏览器验收，避免把 probe 期间的页面更新当成产品回归。Docker daemon 必须可连接，指定 project 的 API、runtime、web containers 必须已启动。从 repository root 运行：

```powershell
$env:UV_CACHE_DIR = ".cache/uv"
uv run --project backend python scripts/hot_reload_acceptance.py --project ordivant-dev
```

脚本只依序在五个指定 source 档尾端附加带唯一识别码的注解：Work `main.py`、Knowledge `main.py`、Code `main.py`、runtime `server.ts`、frontend `main.tsx`。它确认容器内 source marker 可见；Python API 必须观察到 Uvicorn worker PID 改变并恢复 health；runtime 必须确认 marker 编译到 `dist/server.js`、非-watch `server.js` child PID 改变并恢复 health；Vite 必须经 HTTP 回传更新 source 并添加对应 HMR/page-reload log event。

runtime stage 分别记录 source bind marker 是否可见、marker 是否出现在 `dist/server.js`、实际 Node server child PID 是否改变，以及 reload 后 health 是否回传 200，失败报告会指出未满足的 predicate。每个 stage 结束时，以及脚本总体 `finally`，都会用开始前保存的 bytes 还原 source 并核对 SHA-256。脚本只读取容器 mount/process/log metadata 与公开 health/HTTP 回应，不读 secret、不在容器内写 source、不停止或删除容器与 volumes。避免强制终止进程；若遇到正常错误或 Ctrl+C，`finally` 会运行还原。

结果写入忽略目录 `.data/validation/hot-reload-acceptance-<timestamp>-<id>.json`，stdout 也输出不含 token 的 JSON。总耗时受每个 reload stage 40 秒 timeout 限制；若任何服务未确认 reload，报告会标示失败 stage，应交由 PM 检查，不应据此修改 Compose 或服务架构。
