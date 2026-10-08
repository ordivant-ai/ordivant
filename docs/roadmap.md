# 路線圖與功能邊界

本頁列出 v0.1 的能力與後續候選，沒有承諾日期。需求及實作可透過 [GitHub Issues](https://github.com/bigtongue5566/ordivant/issues) 討論。

## v0.1 已交付

- Work 任務協作、獨立 review、scope／lease／冪等、Run 事件與 controls。
- Agent／流程不可變範本、DAG 依賴、手動與分鐘間隔排程。
- MCP Streamable HTTP 工具及 Bearer 認證；無網路 Docker job 沙箱。
- Knowledge 文件版本、文字搜尋、決策與精確引用。
- 選配 Code/Gitea，既有 Git provider 的受限讀取 adapter。
- 原生人員登入、企業 OIDC、可選 Keycloak SAML／LDAP broker。

## 優先候選

| 方向 | 目前邊界 |
| --- | --- |
| 執行前審批 | 已有成果獨立 review；尚無完整工具副作用的事前審批政策 |
| Token／金額治理 | 已有單次輸出、turn、timeout 上限及用量收據；尚無可信費率與硬性總金額預算 |
| 通知與 CI | 已有事件與 check receipt；尚無通知整合或內建外部 CI runner |
| 企業生命週期 | OIDC 群組與停用可撤權；SCIM 與客戶真實 directory 驗收仍待開發／設定 |
| 工具互通 | Bearer MCP 已提供；互動式 MCP OAuth、stdio launcher、A2A 尚未提供 |
| 知識匯入 | 文字版本／檢索已提供；文件解析、embedding／RAG 與批次來源同步尚未提供 |
| 執行隔離與規模 | Docker 共用 kernel、無網路、單一 Pi storage writer；VM、分散式 dispatch 與大規模壓測尚未提供 |

更完整的設計背景見[功能缺口研究](./feature-gap-research.md)。公開 CI 驗證可重現的離線與合成測試；付費供應商的驗收需操作者明確設定並自行負擔用量。
