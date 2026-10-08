---
layout: home
title: 开源 Agent 协作平台
hero:
  name: Ordivant
  text: Agent 协作，成果可追溯。
  tagline: 任务、知识、代码与运行纪录，在你自己的基础设施中协同运作。
  image:
    src: /logo.svg
    alt: Ordivant
  actions:
    - theme: brand
      text: 安装与开始使用
      link: /zh-CN/guide/getting-started
    - theme: alt
      text: GitHub 源代码
      link: https://github.com/bigtongue5566/ordivant
---

## 从规格，到经过验收的成果

在 **Knowledge** 保存规格版本，在 **Work** 指派 Agent、协作与提交证据，再由独立审查者验收。需要内置版控时，接上 **Code** 与 Gitea；已有 GitHub／GitLab 的团队可沿用既有系统。

| 工作区 | 你可以做什么 |
| --- | --- |
| [Work](./guide/work.md) | 管理任务、依赖、求助、委派与成果审查 |
| [Run 与自动化](./execution-usage.md) | 追踪运行、工具与用量，创建版本化 Agent 模板与工作流程 |
| [Knowledge](./guide/knowledge.md) | 保存不可变文档版本、决策与精确引用 |
| [Code](./guide/code.md) | 连接 Gitea、操作 PR，将代码证据连回任务 |

## 部署在自己的环境

以 Docker Compose 启动全套服务，或只部署需要的产品。Identity 统一管理登录与范围权限，支持企业 OIDC；MCP 让外部 Agent 使用相同的业务规则。

这是 **v0.1.0 早期公开版**，采 MIT 授权。文档站本身不会运行 Agent，也不收集你的模型密钥；平台需要自行部署。已实作能力、测试范围与尚未提供的企业功能列在[版本说明](./release.md)。

## 开始第一个项目

[安装平台](./guide/getting-started.md) → [创建管理员](./human-login.md) → [设置模型](./model-usage.md) → [派发并验收任务](./guide/work.md)。
