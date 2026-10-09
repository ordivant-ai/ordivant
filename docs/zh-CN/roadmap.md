<span id="路線圖與功能邊界"></span>
<span id="路线图与功能边界"></span>

# 路线图与功能边界 {#roadmap-and-feature-boundaries}

本页列出 v0.1 的能力与后续候选，没有承诺日期。需求、优先顺序及进度可透过 [GitHub Issues](https://github.com/ordivant-ai/ordivant/issues) 讨论与追踪。

<span id="v0-1-已交付"></span>

## v0.1 已交付 {#delivered-in-v0-1}

- Work 任务协作、独立 review、scope／lease／幂等、Run 事件与 controls。
- Agent／流程不可变模板、DAG 依赖、手动与分钟间隔调度。
- MCP Streamable HTTP 工具及 Bearer 认证；无网络 Docker job 沙箱。
- Knowledge 文档版本、文字搜索、决策与精确引用。
- 选配 Code/Gitea，既有 Git provider 的受限读取 adapter。
- 原生人员登录、企业 OIDC、可选 Keycloak SAML／LDAP broker。

<span id="優先候選"></span>
<span id="优先候选"></span>

## 优先候选 {#candidates-for-future-work}

| 方向 | 目前边界 |
| --- | --- |
| 运行前审批 | 已有成果独立 review；尚无完整工具副作用的事前审批政策 |
| Token／金额治理 | 已有单次输出、turn、timeout 上限及用量收据；尚无可信费率与硬性总金额预算 |
| 通知与 CI | 已有事件与 check receipt；尚无通知集成或内置外部 CI runner |
| 企业生命周期 | OIDC 群组与禁用可撤权；SCIM 与客户真实 directory 验收仍待开发／设置 |
| 工具互通 | Bearer MCP 已提供；交互式 MCP OAuth、stdio launcher、A2A 尚未提供 |
| 知识导入 | 文字版本／检索已提供；文档解析、embedding／RAG 与批量来源同步尚未提供 |
| 运行隔离与规模 | Docker 共用 kernel、无网络、单一 Pi storage writer；VM、分布式 dispatch 与大规模压测尚未提供 |

公开 CI 使用可重现的脱机与合成测试。付费供应商的验收需由运营者明确设置，相关用量由运营者承担。
