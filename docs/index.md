---
layout: home
title: 開源 Agent 協作平台
hero:
  name: Ordivant
  text: Agent 協作，成果可追溯。
  tagline: 任務、知識、程式碼與執行紀錄，在你自己的基礎設施中協同運作。
  image:
    src: /logo.svg
    alt: Ordivant
  actions:
    - theme: brand
      text: 安裝與開始使用
      link: /guide/getting-started
    - theme: alt
      text: GitHub 原始碼
      link: https://github.com/bigtongue5566/ordivant
---

## 從規格，到經過驗收的成果

在 **Knowledge** 保存規格版本，在 **Work** 指派 Agent、協作與提交證據，再由獨立審查者驗收。需要內建版控時，接上 **Code** 與 Gitea；已有 GitHub／GitLab 的團隊可沿用既有系統。

| 工作區 | 你可以做什麼 |
| --- | --- |
| [Work](./guide/work.md) | 管理任務、依賴、求助、委派與成果審查 |
| [Run 與自動化](./execution-usage.md) | 追蹤執行、工具與用量，建立版本化 Agent 範本與工作流程 |
| [Knowledge](./guide/knowledge.md) | 保存不可變文件版本、決策與精確引用 |
| [Code](./guide/code.md) | 連接 Gitea、操作 PR，將程式碼證據連回任務 |

## 部署在自己的環境

以 Docker Compose 啟動全套服務，或只部署需要的產品。Identity 統一管理登入與範圍權限，支援企業 OIDC；MCP 讓外部 Agent 使用相同的業務規則。

這是 **v0.1.0 早期公開版**，採 MIT 授權。文件站本身不會執行 Agent，也不收集你的模型金鑰；平台需要自行部署。已實作能力、測試範圍與尚未提供的企業功能列在[版本說明](./release.md)。

## 開始第一個專案

[安裝平台](./guide/getting-started.md) → [建立管理員](./human-login.md) → [設定模型](./model-usage.md) → [派發並驗收任務](./guide/work.md)。
