<span id="v0-1-0-公開版本"></span>
<span id="v0-1-0-公开版本"></span>

# v0.1.0 公开版本 {#public-release-v0-1-0}

发布日期：2026-10-08。授权：[MIT](../../LICENSE)。源代码与下载：[GitHub Releases](https://github.com/ordivant-ai/ordivant/releases)。

<span id="本版內容"></span>
<span id="本版内容"></span>

## 本版内容 {#included-in-this-release}

Work／Knowledge／Code 与共用 Identity、Docker 开发和部署、Run 运行控制台、自动工作流程、Agent 模板、MCP 工具及沙箱。完整更新见 [Changelog](../../CHANGELOG.md)。

<span id="驗證方式"></span>
<span id="验证方式"></span>

## 验证方式 {#validation}

GitHub Actions [CI](https://github.com/ordivant-ai/ordivant/actions) 会在 push 与 Pull Request 上运行。它会测试各 Python 产品与 Runtime、构建四种前端模式，并运行合成 REST／MCP 集成检查与产品 smoke checks；详情见 [CI workflow](https://github.com/ordivant-ai/ordivant/blob/main/.github/workflows/ci.yml)。独立的 [Documentation workflow](https://github.com/ordivant-ai/ordivant/blob/main/.github/workflows/pages.yml) 会检查文档语言、公开清单、链接与网站构建。CI 使用可重现的合成数据与 Demo Runtime，不调用付费模型，也不代表每种客户环境或 IdP 都已验证。

贡献者可依照[贡献指南](https://github.com/ordivant-ai/ordivant/blob/main/CONTRIBUTING.md)安装锁定依赖，并在本机重跑相同的 Python、Runtime、前端及文档检查。CI 工作流程与重现步骤会随源代码一同维护。

<span id="升級與限制"></span>
<span id="升级与限制"></span>

## 升级与限制 {#upgrade-and-limitations}

从 source 部署请先备份数据库、持久化 volumes 与 `.data/container-secrets/`，确认 Work／Identity 加密密钥也备妥，再更新程序并用相同 ProjectName 启动。不要以删除 volumes 处理升级错误。正式投入企业使用前应在隔离环境演练还原；本版未宣称提供跨区灾难恢复、完成性能负载测试，或已针对所有企业 IdP 验证。

建议先阅读[运维指南](./guide/operations.md)与[已知功能边界](./roadmap.md)。
