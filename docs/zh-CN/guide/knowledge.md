# Ordivant Knowledge

Knowledge 用来保存可追溯的规格、决策和背景数据。每个 Space 都有独立成员范围；文档内容采不可变版本，搜索依目前实际保存的标题和正文做文字比对。

![Knowledge 文档：查看正文、已发布版本与引用](/screenshots/knowledge-zh-CN.png)

<span id="建立文件與版本"></span>
<span id="创建文档与版本"></span>

## 创建文档与版本 {#create-a-document-and-publish-versions}

1. 由 Identity 管理员创建 Space 及其资源范围，填入唯一 key、名称与说明；Space 创建后，再授权 Knowledge manager、writer 或 reader。
2. 选择 Space，创建文档，填入标题、摘要、正文和标签。初次创建会同时保存文档及 `v1`。
3. 在「来源与 provenance」加入文档采用的 Work、Code 或外部来源。来源是可追溯引用，不代表读者自动取得来源产品的访问权。
4. 修改已存在的文档时选择「发布新版本」，确认预期目前版本，填入正文、变更摘要和引用后发布。系统创建新版本；旧版本、内容 hash 和引用保持不变。若其他人已先发布，会提示版本冲突，请查看最新内容后再调整草稿。

文档读者可用标题、正文文字和标签搜索，打开文档后切换查看任一精确版本。画面会显示版本 URI、创建时间、内容 SHA-256、变更摘要和来源。搜索是持久化文字搜索；本产品不提供矢量索引或 RAG 搜索。

<span id="引用特定版本"></span>

## 引用特定版本 {#cite-an-exact-version}

文档版本的标准 URI 格式如下：

```text
ordivant://knowledge/spaces/{space_id}/documents/{document_id}/versions/{version}
```

从版本阅读页拷贝完整 URI，引用时保留 `/versions/{version}`，不要只连到可变动的文档首页。可在 Work Task 的输入／证据中记录该 URI，或在 Code 创建 PR 时加入 Knowledge 来源引用。Knowledge 的版本引用不会替其他产品查找或授权数据；读者仍须有该 Space 的权限。

<span id="記錄決策"></span>
<span id="记录决策"></span>

## 记录决策 {#record-decisions}

在「决策纪录」创建标题与内容，可选择关联文档，再附上依据来源。决策纪录保留创建者与引用，适合记录采用的方向、取舍和生效版本；后续改变决策时另建新纪录，避免抹除历史脉络。

<span id="權限與範圍"></span>
<span id="权限与范围"></span>

## 权限与范围 {#permissions-and-scope}

- **Manager**：管理 Space 与授权范围，可创建文档、发布版本和决策。
- **Writer**：在已授权 Space 创建文档、发布新版本和记录决策。
- **Reader**：阅读、搜索与拷贝引用，不可修改或发布。

Identity 管理员授予成员明确 Space 范围。登录 Knowledge 不代表能读取所有 Space；同一个 URI 也不是跨产品权限。管理员与成员管理方式见[管理指南](administration.md)。
