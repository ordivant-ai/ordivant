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

GitHub Actions [CI](https://github.com/ordivant-ai/ordivant/actions) runs on pushes and pull requests. It tests each Python product and Runtime, builds all four frontend modes, and runs synthetic REST/MCP integration checks and product smoke checks; see the [CI workflow](https://github.com/ordivant-ai/ordivant/blob/main/.github/workflows/ci.yml). The separate [Documentation workflow](https://github.com/ordivant-ai/ordivant/blob/main/.github/workflows/pages.yml) checks document locales, the public-page allowlist, links, and the site build. CI uses reproducible synthetic data and the Demo Runtime; it does not call paid models or verify every customer environment or identity provider.

Contributors can install locked dependencies and reproduce the Python, Runtime, frontend, and documentation checks locally by following the [contributor guide](https://github.com/ordivant-ai/ordivant/blob/main/CONTRIBUTING.md). The workflow and reproduction steps are maintained with the source.

<span id="升級與限制"></span>
<span id="升级与限制"></span>

## Upgrade and limitations

For a source deployment, back up the database, persistent volumes, and `.data/container-secrets/`. Also ensure that the Work and Identity encryption keys are backed up before updating the code and restarting with the same ProjectName. Do not delete volumes to address an upgrade problem. Rehearse restoration in an isolated environment before enterprise use. This release does not claim cross-region disaster recovery, completed performance load testing, or validation with every enterprise IdP.

Read the [operations guide](./guide/operations.md) and [known feature boundaries](./roadmap.md) before deployment.
