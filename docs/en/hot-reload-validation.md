# Development container hot-reload acceptance

This acceptance script checks the running development Compose project `ordivant-dev` and verifies that all three Uvicorn APIs (Work, Knowledge, and Code), the Pi Runtime TypeScript compiler/Node `--watch`, and React Vite actually reload through read-only host-source bind mounts.

Before running it, pause browser acceptance that operates on these products so page updates during a probe are not mistaken for regressions. The Docker daemon must be reachable, and the specified project's API, Runtime, and Web containers must be running. Run this from the repository root:

```powershell
$env:UV_CACHE_DIR = ".cache/uv"
uv run --project backend python scripts/hot_reload_acceptance.py --project ordivant-dev
```

The script sequentially appends a uniquely identified comment to five specific source files: Work `main.py`, Knowledge `main.py`, Code `main.py`, Runtime `server.ts`, and frontend `main.tsx`. It checks that each source marker is visible inside the container. For each Python API, the Uvicorn worker PID must change and health must recover. For Runtime, the marker must compile into `dist/server.js`, the non-watch `server.js` child PID must change, and health must recover. Vite must return the updated source over HTTP and emit the corresponding HMR/page-reload log event.

The Runtime stage separately records whether the source bind marker is visible, whether it appears in `dist/server.js`, whether the actual Node server child PID changed, and whether health returns 200 after reload. A failure report identifies the unmet predicate. At the end of each stage and again in the script's overall `finally` block, the source is restored from its original bytes and its SHA-256 is checked. The script reads container mount/process/log metadata and public health/HTTP responses only. It does not read secrets, write source inside containers, stop containers, or remove containers or volumes. Avoid forcefully terminating the process; normal errors and Ctrl+C run the restoration in `finally`.

Results are written to the ignored directory `.data/validation/hot-reload-acceptance-<timestamp>-<id>.json`; stdout also prints token-free JSON. Each reload stage has a 40-second timeout. If a service does not confirm reload, the report identifies the failed stage for PM investigation; do not change Compose or service architecture based on that result alone.
