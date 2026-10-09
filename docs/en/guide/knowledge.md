# Ordivant Knowledge

Knowledge stores traceable specifications, decisions, and background material. Each Space has an independent membership scope. Document contents use immutable versions, and search matches the titles and body text actually stored.

![Knowledge document with content, published versions, and citations](/screenshots/knowledge-en.png)

<span id="建立文件與版本"></span>
<span id="创建文档与版本"></span>

## Create a document and publish versions

1. An Identity administrator creates a Space and its resource scope with a unique key, name, and description. Afterward, grant Knowledge manager, writer, or reader access to members.
2. Select the Space and create a document with a title, summary, body, and tags. Initial creation stores the document and `v1` together.
3. Under “Sources and provenance,” add the Work, Code, or external sources used by the document. A source is a traceable reference; it does not grant its readers access to the source product.
4. To change an existing document, choose “Publish new version,” confirm the expected current version, and enter the body, change summary, and citations. The system creates a new version; the old version, content hash, and citations remain unchanged. If someone published first, the version conflict prompts you to review the latest content before revising your draft.

Readers can search titles, body text, and tags, then open a document and view an exact version. The page shows its version URI, creation time, content SHA-256, change summary, and sources. Search is persistent text search; this product does not provide vector indexing or RAG.

<span id="引用特定版本"></span>

## Cite an exact version

The canonical URI for a document version is:

```text
ordivant://knowledge/spaces/{space_id}/documents/{document_id}/versions/{version}
```

Copy the complete URI from the version view and retain `/versions/{version}` in a citation. Do not link only to the mutable document home page. Record the URI in Work Task inputs or evidence, or add it as a Knowledge source when opening a Code pull request. A Knowledge version reference does not query or authorize data in another product; readers still need access to the Space.

<span id="記錄決策"></span>
<span id="记录决策"></span>

## Record decisions

Create a title and body in “Decision records,” optionally linking related documents and supporting sources. Decisions retain their author and citations, making them suitable for recording a chosen direction, trade-offs, and the effective version. When a decision changes, create a new record rather than erasing the previous context.

<span id="權限與範圍"></span>
<span id="权限与范围"></span>

## Permissions and scope

- **Manager:** manages Spaces and their access scopes, and can create documents, publish versions, and record decisions.
- **Writer:** creates documents, publishes new versions, and records decisions in authorized Spaces.
- **Reader:** reads, searches, and copies citations; cannot modify or publish.

Identity administrators grant membership in explicit Space scopes. Signing in to Knowledge does not grant access to every Space, and a URI is not cross-product authorization. See the [administration guide](administration.md) for managing members.
