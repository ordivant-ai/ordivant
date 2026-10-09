# Ordivant Knowledge

Knowledge 用來保存可追溯的規格、決策和背景資料。每個 Space 都有獨立成員範圍；文件內容採不可變版本，搜尋依目前實際保存的標題和正文做文字比對。

<span id="建立文件與版本"></span>
<span id="创建文档与版本"></span>

## 建立文件與版本 {#create-a-document-and-publish-versions}

1. 由 Identity 管理員建立 Space 及其資源範圍，填入唯一 key、名稱與說明；Space 建立後，再授權 Knowledge manager、writer 或 reader。
2. 選擇 Space，建立文件，填入標題、摘要、正文和標籤。初次建立會同時保存文件及 `v1`。
3. 在「來源與 provenance」加入文件採用的 Work、Code 或外部來源。來源是可追溯引用，不代表讀者自動取得來源產品的存取權。
4. 修改已存在的文件時選擇「發佈新版本」，確認預期目前版本，填入正文、變更摘要和引用後發佈。系統建立新版本；舊版本、內容 hash 和引用保持不變。若其他人已先發佈，會提示版本衝突，請檢視最新內容後再調整草稿。

文件讀者可用標題、正文文字和標籤搜尋，打開文件後切換檢視任一精確版本。畫面會顯示版本 URI、建立時間、內容 SHA-256、變更摘要和來源。搜尋是持久化文字搜尋；本產品不提供向量索引或 RAG 搜尋。

<span id="引用特定版本"></span>

## 引用特定版本 {#cite-an-exact-version}

文件版本的標準 URI 格式如下：

```text
ordivant://knowledge/spaces/{space_id}/documents/{document_id}/versions/{version}
```

從版本閱讀頁複製完整 URI，引用時保留 `/versions/{version}`，不要只連到可變動的文件首頁。可在 Work Task 的輸入／證據中記錄該 URI，或在 Code 建立 PR 時加入 Knowledge 來源引用。Knowledge 的版本引用不會替其他產品查詢或授權資料；讀者仍須有該 Space 的權限。

<span id="記錄決策"></span>
<span id="记录决策"></span>

## 記錄決策 {#record-decisions}

在「決策紀錄」建立標題與內容，可選擇關聯文件，再附上依據來源。決策紀錄保留建立者與引用，適合記錄採用的方向、取捨和生效版本；後續改變決策時另建新紀錄，避免抹除歷史脈絡。

<span id="權限與範圍"></span>
<span id="权限与范围"></span>

## 權限與範圍 {#permissions-and-scope}

- **Manager**：管理 Space 與授權範圍，可建立文件、發佈版本和決策。
- **Writer**：在已授權 Space 建立文件、發佈新版本和記錄決策。
- **Reader**：閱讀、搜尋與複製引用，不可修改或發佈。

Identity 管理員授予成員明確 Space 範圍。登入 Knowledge 不代表能讀取所有 Space；同一個 URI 也不是跨產品權限。管理員與成員管理方式見[管理指南](administration.md)。
