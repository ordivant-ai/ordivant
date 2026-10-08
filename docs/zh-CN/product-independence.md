# Product Independence Smoke

`scripts/product_smoke.py` checks that Knowledge and Code can each seed and run as a standalone product. It starts one product at a time on a random loopback port, using that product's own `.venv` Python and a fresh `.data/validation/standalone-*` data directory. It does not start Work, the Pi runtime, or peer services.

Run both products sequentially with:

```powershell
products/code/backend/.venv/Scripts/python.exe scripts/product_smoke.py --product all
```

The script uses only Python's standard library in the orchestrator. Each product's official MCP Python SDK runs from that product's environment. Use `--product knowledge` or `--product code` to check one product.

The Knowledge check creates a document as the seeded writer, retrieves immutable version 1 and verifies its exact body plus the matching SHA-256 returned by creation and version read, then searches for it and checks the exact version citation. It also lists MCP tools and calls `get_document_context` through the SDK.

The Code check reads the seeded `code-demo` project as manager, verifies health reports `gitea_configured: false`, and confirms repository creation returns `503 gitea_not_configured`. It also lists MCP tools and calls `list_code_projects` through the SDK. Inherited `ORDIVANT_CODE_GITEA_*` and `ORDIVANT_CODE_WEBHOOK_SECRET` settings are removed from the Code child environment for this test.

The smoke command prints token-free JSON evidence with product status, port, data directory, API checks, and MCP round trips. It stops only processes it started. It leaves the unique validation data directories in place; these contain local bootstrap credentials, so keep them untracked and do not publish them.

Verified on 2026-10-06: Knowledge and Code passed their independent runs, including API and MCP checks. The `all` option runs the same checks sequentially in a single invocation.
