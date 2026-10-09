<span id="v0-1-0-公開版本"></span>
<span id="v0-1-0-公开版本"></span>

# Public release v0.1.0

Release date: 2026-10-08. License: [MIT](../../LICENSE). Source code and downloads: [GitHub Releases](https://github.com/ordivant-ai/ordivant/releases).

<span id="本版內容"></span>
<span id="本版内容"></span>

## Included in this release

Work, Knowledge, and Code with shared Identity; Docker development and deployment; the Run console; automated workflows; Agent templates; MCP tools; and sandboxes. See the [Changelog](../../CHANGELOG.md) for the full update history.

<span id="驗證方式"></span>
<span id="验证方式"></span>

## Validation

GitHub Actions installs locked dependencies and runs Python business and authorization tests, Runtime tests, four frontend builds, and the documentation build against the public source. Check the repository's Actions results for the exact versions used.

Before release, local acceptance included 41 Work, 28 Identity, 10 Knowledge, 20 Code, 3 Sandbox, and 25 Runtime tests, plus real Docker, MCP, paid-model, restart, concurrency, and desktop/mobile interactions. These are maintainer checks performed on a stated date; they do not establish that every customer environment has been validated. Historical raw QA data contained local synthetic resources and is not included on GitHub. Re-runnable scripts and result summaries remain in the source repository. See the [validation records](./validation.md).

<span id="升級與限制"></span>
<span id="升级与限制"></span>

## Upgrade and limitations

For a source deployment, back up the database, persistent volumes, and `.data/container-secrets/`. Also ensure that the Work and Identity encryption keys are backed up before updating the code and restarting with the same ProjectName. Do not delete volumes to address an upgrade problem. Rehearse restoration in an isolated environment before enterprise use. This release does not claim cross-region disaster recovery, performance load testing, or validation with every enterprise IdP.

Read the [operations guide](./guide/operations.md) and [known feature boundaries](./roadmap.md) before deployment.
