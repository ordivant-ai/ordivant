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

GitHub Actions 对公开源代码运行锁定依赖安装、Python 业务与授权测试、Runtime 测试、四种前端建置及文档站建置。实际使用版本可从仓库的 Actions 结果确认。

公开前的本机验收包括 Work 41、Identity 28、Knowledge 10、Code 20、Sandbox 3 与 Runtime 25 个测试；另有真实 Docker、MCP、付费模型、重启、并发及桌面／手机操作。这些是日期明确的维护者验收，不代表每种客户环境已验证。历史原始 QA 数据含本机合成资源，未放入 GitHub；可重跑的程序与结果摘要保留于源代码。详见[验收纪录](./validation.md)。

<span id="升級與限制"></span>
<span id="升级与限制"></span>

## 升级与限制 {#upgrade-and-limitations}

从 source 部署请先备份数据库、持久化 volumes 与 `.data/container-secrets/`，确认 Work/Identity 加密密钥也备妥，再更新程序并用相同 ProjectName 启动。不要以删除 volumes 处理升级错误。正式投入企业使用前应在隔离环境演练还原；本版未宣称完成跨区容灾、性能压测或所有企业 IdP 验收。

建议先阅读[运维指南](./guide/operations.md)与[已知功能边界](./roadmap.md)。
