import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  FileAddOutlined,
  FileTextOutlined,
  HistoryOutlined,
  PlusOutlined,
  SearchOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ProductApiError, createProductApi, productApiPrefix } from '../shared/productApi';
import { ProductLogin } from '../shared/ProductLogin';
import { ProductShell } from '../shared/ProductShell';
import { AuthProvider, useAuth } from '../../auth/AuthContext';
import { AuthAccessDenied } from '../../auth/AuthAccessDenied';
import { ReferenceFields, ReferenceList } from '../shared/References';
import type { Decision, DocumentContext, DocumentHit, DocumentVersion, ProductHealth, ProductPrincipal, Space as KnowledgeSpace } from '../shared/types';

const { Paragraph, Text, Title } = Typography;
const { TextArea } = Input;
const knowledgeApi = createProductApi(productApiPrefix('knowledge'));

type KnowledgeSection = 'documents' | 'decisions';

function dateText(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未預期的錯誤。';
}

export default function KnowledgeApp() {
  return <AuthProvider><KnowledgeWorkspace /></AuthProvider>;
}

function KnowledgeWorkspace() {
  const auth = useAuth();
  const [messageApi, messageContext] = message.useMessage();
  const [health, setHealth] = useState<ProductHealth | null>(null);
  const [healthStatus, setHealthStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  const [healthError, setHealthError] = useState('');
  const [principal, setPrincipal] = useState<ProductPrincipal | null>(null);
  const [principalSessionKey, setPrincipalSessionKey] = useState('');
  const [principalErrorStatus, setPrincipalErrorStatus] = useState(0);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]);
  const [spacesError, setSpacesError] = useState('');
  const [spacesReload, setSpacesReload] = useState(0);
  const [spaceId, setSpaceId] = useState('');
  const [spaceBusy, setSpaceBusy] = useState(false);
  const [section, setSection] = useState<KnowledgeSection>('documents');
  const [documents, setDocuments] = useState<DocumentHit[]>([]);
  const [documentsBusy, setDocumentsBusy] = useState(false);
  const [documentsError, setDocumentsError] = useState('');
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [documentContext, setDocumentContext] = useState<DocumentContext | null>(null);
  const [history, setHistory] = useState<DocumentVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<DocumentVersion | null>(null);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [decisionsBusy, setDecisionsBusy] = useState(false);
  const [decisionsError, setDecisionsError] = useState('');
  const [spaceModalOpen, setSpaceModalOpen] = useState(false);
  const [createDocumentOpen, setCreateDocumentOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [spaceSaving, setSpaceSaving] = useState(false);
  const [documentSaving, setDocumentSaving] = useState(false);
  const [publishSaving, setPublishSaving] = useState(false);
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [formError, setFormError] = useState('');
  const [spaceForm] = Form.useForm();
  const [documentForm] = Form.useForm();
  const [publishForm] = Form.useForm();
  const [decisionForm] = Form.useForm();
  const listRequestId = useRef(0);
  const healthRequestId = useRef(0);
  const currentSpace = spaces.find((item) => item.id === spaceId) ?? null;
  const canWrite = Boolean(principal && ['admin', 'manager', 'writer'].includes(principal.role));
  const canCreateSpace = auth.session?.user.role === 'admin';

  const checkHealth = useCallback(async () => {
    const requestId = ++healthRequestId.current;
    setHealthStatus('checking');
    setHealthError('');
    try {
      const result = await knowledgeApi.health();
      if (requestId !== healthRequestId.current) return;
      setHealth(result);
      setHealthError('');
      setHealthStatus('ok');
    } catch (error) {
      if (requestId !== healthRequestId.current) return;
      setHealthError(errorMessage(error));
      setHealthStatus('error');
    }
  }, []);

  useEffect(() => {
    void checkHealth();
    return () => { healthRequestId.current += 1; };
  }, [checkHealth]);

  useEffect(() => {
    if (!principal) return;
    let current = true;
    setSpaceBusy(true);
    setSpacesError('');
    knowledgeApi.get<KnowledgeSpace[]>('/spaces')
      .then((result) => {
        if (!current) return;
        setSpaces(result);
        setSpaceId((existing) => result.some((space) => space.id === existing) ? existing : result[0]?.id ?? '');
      })
      .catch((error) => { if (current) setSpacesError(errorMessage(error)); })
      .finally(() => { if (current) setSpaceBusy(false); });
    return () => { current = false; };
  }, [principal, spacesReload]);

  const loadDocuments = useCallback(async () => {
    if (!spaceId) {
      setDocuments([]);
      return;
    }
    const requestId = ++listRequestId.current;
    const params = new URLSearchParams({ space_id: spaceId });
    if (query.trim()) params.set('q', query.trim());
    if (tagFilter.trim()) params.set('tag', tagFilter.trim());
    setDocumentsBusy(true);
    setDocumentsError('');
    try {
      const result = await knowledgeApi.get<DocumentHit[]>(`/documents?${params.toString()}`);
      if (requestId === listRequestId.current) {
        setDocuments(result);
        setDocumentId((existing) => result.some((document) => document.id === existing) ? existing : result[0]?.id ?? '');
      }
    } catch (error) {
      if (requestId === listRequestId.current) setDocumentsError(errorMessage(error));
    } finally {
      if (requestId === listRequestId.current) setDocumentsBusy(false);
    }
  }, [query, spaceId, tagFilter]);

  useEffect(() => {
    if (!principal || !spaceId || section !== 'documents') return;
    const timer = window.setTimeout(() => { void loadDocuments(); }, query ? 240 : 0);
    return () => window.clearTimeout(timer);
  }, [loadDocuments, principal, query, section, spaceId]);

  const loadDecisions = useCallback(async () => {
    if (!spaceId) return;
    setDecisionsBusy(true);
    setDecisionsError('');
    try {
      const params = new URLSearchParams({ space_id: spaceId });
      setDecisions(await knowledgeApi.get<Decision[]>(`/decisions?${params.toString()}`));
    } catch (error) {
      setDecisionsError(errorMessage(error));
    } finally {
      setDecisionsBusy(false);
    }
  }, [spaceId]);

  useEffect(() => {
    if (principal && spaceId && section === 'decisions') void loadDecisions();
  }, [loadDecisions, principal, section, spaceId]);

  const loadDocumentContext = useCallback(async (id = documentId) => {
    if (!id) return;
    setDocumentBusy(true);
    try {
      const results = await Promise.allSettled([
        knowledgeApi.get<DocumentContext>(`/documents/${encodeURIComponent(id)}`),
        knowledgeApi.get<DocumentVersion[]>(`/documents/${encodeURIComponent(id)}/versions`),
      ]);
      const contextResult = results[0];
      const historyResult = results[1];
      if (contextResult.status === 'rejected') throw contextResult.reason;
      setDocumentContext(contextResult.value);
      setSelectedVersion(contextResult.value.version);
      setHistory(historyResult.status === 'fulfilled' ? historyResult.value : contextResult.value.history);
    } finally {
      setDocumentBusy(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (!documentId || section !== 'documents') {
      setDocumentContext(null);
      setHistory([]);
      setSelectedVersion(null);
      return;
    }
    let current = true;
    setDocumentContext(null);
    setHistory([]);
    setSelectedVersion(null);
    setDocumentBusy(true);
    loadDocumentContext(documentId)
      .catch((error) => { if (current) messageApi.error(errorMessage(error)); })
      .finally(() => { if (current) setDocumentBusy(false); });
    return () => { current = false; };
  }, [documentId, loadDocumentContext, messageApi, section]);

  useEffect(() => {
    if (!auth.session) {
      setPrincipal(null);
      setPrincipalSessionKey('');
      setAuthError('');
      setPrincipalErrorStatus(0);
      setSpaces([]);
      setSpaceId('');
      setDocuments([]);
      setDecisions([]);
      setDocumentContext(null);
      return;
    }
    let current = true;
    setPrincipal(null);
    setPrincipalSessionKey(auth.session.csrf_token);
    setAuthBusy(true);
    setAuthError('');
    setPrincipalErrorStatus(0);
    knowledgeApi.me()
      .then((result) => { if (current) setPrincipal(result); })
      .catch((error) => { if (current) { setAuthError(errorMessage(error)); setPrincipalErrorStatus(error instanceof Error && 'status' in error ? Number((error as { status: unknown }).status) : 0); } })
      .finally(() => { if (current) setAuthBusy(false); });
    return () => { current = false; };
  }, [auth.session]);

  async function createSpace(values: Record<string, unknown>) {
    if (auth.session?.user.role !== 'admin') {
      setSpaceModalOpen(false);
      messageApi.error('只有管理員可以建立 Knowledge space。');
      return;
    }
    setSpaceSaving(true);
    setFormError('');
    try {
      const created = await knowledgeApi.post<KnowledgeSpace>('/spaces', { key: values.key, name: values.name, description: values.description ?? '' });
      const refreshed = await knowledgeApi.get<KnowledgeSpace[]>('/spaces');
      setSpaces(refreshed);
      setSpaceId(created.id);
      setSpaceModalOpen(false);
      spaceForm.resetFields();
      messageApi.success('Knowledge space 已建立。');
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSpaceSaving(false);
    }
  }

  function openCreateDocument() {
    documentForm.resetFields();
    documentForm.setFieldsValue({ tags: [], source_refs: [] });
    setFormError('');
    setCreateDocumentOpen(true);
  }

  async function createDocument(values: Record<string, unknown>) {
    if (!spaceId) return;
    setDocumentSaving(true);
    setFormError('');
    try {
      const created = await knowledgeApi.post<DocumentContext>('/documents', {
        space_id: spaceId,
        title: values.title,
        summary: values.summary ?? '',
        body: values.body,
        tags: values.tags ?? [],
        change_summary: values.change_summary ?? '初版建立',
        source_refs: values.source_refs ?? [],
      });
      setCreateDocumentOpen(false);
      documentForm.resetFields();
      setSection('documents');
      await loadDocuments();
      setDocumentId(created.document.id);
      messageApi.success('文件與 v1 已建立。');
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setDocumentSaving(false);
    }
  }

  async function selectExactVersion(versionNumber: number) {
    if (!documentId) return;
    setDocumentBusy(true);
    try {
      const version = await knowledgeApi.get<DocumentVersion>(`/documents/${encodeURIComponent(documentId)}/versions/${versionNumber}`);
      setSelectedVersion(version);
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setDocumentBusy(false);
    }
  }

  function openPublish() {
    if (!documentContext) return;
    setPublishError('');
    publishForm.resetFields();
    publishForm.setFieldsValue({
      expected_version: documentContext.document.current_version,
      title: documentContext.version.title,
      body: documentContext.version.body,
      change_summary: '',
      source_refs: [],
    });
    setPublishOpen(true);
  }

  async function publishVersion(values: Record<string, unknown>) {
    if (!documentId) return;
    setPublishSaving(true);
    setPublishError('');
    try {
      await knowledgeApi.post<DocumentVersion>(`/documents/${encodeURIComponent(documentId)}/versions`, {
        expected_version: values.expected_version,
        title: values.title,
        body: values.body,
        change_summary: values.change_summary,
        source_refs: values.source_refs ?? [],
      });
      setPublishOpen(false);
      publishForm.resetFields();
      await loadDocuments();
      await loadDocumentContext(documentId);
      messageApi.success('新版本已發佈；舊版本保持不變。');
    } catch (error) {
      if (error instanceof ProductApiError && error.status === 409) {
        setPublishError(`版本衝突：${error.message} 目前草稿仍保留，請確認最新版本後再決定如何發佈。`);
        void loadDocuments();
        void loadDocumentContext(documentId).catch(() => undefined);
      } else {
        setPublishError(errorMessage(error));
      }
    } finally {
      setPublishSaving(false);
    }
  }

  async function createDecision(values: Record<string, unknown>) {
    if (!spaceId) return;
    setDecisionSaving(true);
    setFormError('');
    try {
      await knowledgeApi.post<Decision>('/decisions', {
        space_id: spaceId,
        document_id: values.document_id || undefined,
        title: values.title,
        body: values.body,
        source_refs: values.source_refs ?? [],
      });
      setDecisionOpen(false);
      decisionForm.resetFields();
      await loadDecisions();
      if (documentId) await loadDocumentContext(documentId).catch(() => undefined);
      messageApi.success('決策紀錄已建立。');
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setDecisionSaving(false);
    }
  }

  const sectionItems = useMemo(() => [
    { key: 'documents', label: '文件庫', icon: <FileTextOutlined /> },
    { key: 'decisions', label: '決策紀錄', icon: <SafetyCertificateOutlined /> },
  ], []);

  if (!auth.session) {
    return <>{messageContext}<ProductLogin product="knowledge" productName="Knowledge" /></>;
  }
  if (authBusy || principalSessionKey !== auth.session.csrf_token) {
    return <>{messageContext}<div className="product-inline-loading"><Spin /></div></>;
  }
  if (!principal) {
    return <>{messageContext}<AuthAccessDenied product="knowledge" productName="Knowledge" error={authError} forbidden={principalErrorStatus === 403} onRetry={() => window.location.reload()} /></>;
  }

  return (
    <>
      {messageContext}
      <ProductShell
        product="knowledge"
        productLabel="Ordivant Knowledge"
        principal={principal}
        sectionLabel="Knowledge"
        navigation={sectionItems}
        activeSection={section}
        onSectionChange={(key) => setSection(key as KnowledgeSection)}
        mode={health?.mode ?? 'unavailable'}
        serviceStatus={healthStatus}
        headerExtra={<Space size={7}><Select aria-label="選擇 Knowledge space" className="product-scope-select" placeholder="選擇 Space" value={spaceId || undefined} loading={spaceBusy} onChange={(value) => { setSpaceId(value); setDocumentId(''); }} options={spaces.map((space) => ({ value: space.id, label: `${space.key} · ${space.name}` }))} notFoundContent="沒有可存取的 Space" />{canCreateSpace && <Button aria-label="建立 Space" icon={<PlusOutlined />} onClick={() => { spaceForm.resetFields(); setFormError(''); setSpaceModalOpen(true); }}>新增 Space</Button>}</Space>}
        title={section === 'documents' ? '文件庫' : '決策紀錄'}
        eyebrow={currentSpace ? `${currentSpace.key} · ${currentSpace.name}` : 'KNOWLEDGE'}
        actions={canWrite && section === 'documents'
          ? <Button type="primary" icon={<FileAddOutlined />} disabled={!spaceId} onClick={openCreateDocument}>新增文件</Button>
          : canWrite && section === 'decisions'
            ? <Button type="primary" icon={<PlusOutlined />} disabled={!spaceId} onClick={() => { decisionForm.resetFields(); decisionForm.setFieldsValue({ document_id: documentId || undefined, source_refs: [] }); setFormError(''); setDecisionOpen(true); }}>新增決策</Button>
            : undefined}
      >
        {healthStatus === 'error' && <Alert className="product-page-alert" type="warning" showIcon message="Knowledge API 健康檢查失敗" description={healthError} action={<Button size="small" onClick={() => void checkHealth()}>重試</Button>} />}
        {spacesError && <Alert className="product-page-alert" type="error" showIcon message="Space 清單載入失敗" description={spacesError} action={<Button size="small" onClick={() => setSpacesReload((value) => value + 1)}>重試</Button>} />}
        {!spaceId ? (
          <div className="product-empty-state"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={spaceBusy ? '正在載入 Space' : canCreateSpace ? '目前沒有可存取的 Knowledge space' : '目前沒有可存取的 Knowledge space，請聯絡管理員授予 Space 存取權或建立新 Space。'} />{canCreateSpace && <Button type="primary" icon={<PlusOutlined />} onClick={() => { spaceForm.resetFields(); setSpaceModalOpen(true); }}>建立 Space</Button>}</div>
        ) : section === 'documents' ? (
          <>
            {documentsError && <Alert className="product-page-alert" type="error" showIcon message="文件搜尋失敗" description={documentsError} action={<Button size="small" onClick={() => void loadDocuments()}>重試</Button>} />}
            <div className="knowledge-tools"><Input allowClear prefix={<SearchOutlined />} aria-label="搜尋文件文字" placeholder="搜尋標題或正文" value={query} onChange={(event) => setQuery(event.target.value)} /><Input allowClear aria-label="依標籤篩選" placeholder="標籤篩選" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} /><span>文字搜尋 · {documentsBusy ? '搜尋中' : `${documents.length} 份文件`}</span></div>
            <div className="knowledge-workspace">
              <aside className="knowledge-document-list" aria-label="文件搜尋結果">
                <div className="knowledge-list-heading"><span>搜尋結果</span><span>{documents.length}</span></div>
                {documentsBusy && !documents.length && <div className="product-inline-loading"><Spin size="small" /></div>}
                {!documentsBusy && documents.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query || tagFilter ? '沒有符合條件的文件' : '此 Space 尚無文件'}>{canWrite && !query && !tagFilter && <Button size="small" type="primary" onClick={openCreateDocument}>建立文件</Button>}</Empty>}
                {documents.map((document) => <button type="button" key={document.id} className={`knowledge-document-item${document.id === documentId ? ' knowledge-document-active' : ''}`} onClick={() => setDocumentId(document.id)}><span className="document-item-top"><strong>{document.title}</strong><Tag>v{document.version ?? document.current_version}</Tag></span><span className="document-item-summary">{document.snippet || document.summary || '尚無摘要'}</span><span className="document-item-bottom"><span>{document.tags?.slice(0, 3).map((tag) => `#${tag}`).join(' ') || '無標籤'}</span><time>{dateText(document.updated_at)}</time></span></button>)}
              </aside>
              <main className="knowledge-reader">
                {documentBusy && !documentContext && <div className="product-inline-loading"><Spin /></div>}
                {!documentId && !documentsBusy && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="選取一份文件以檢視版本與來源" />}
                {documentId && !documentContext && !documentBusy && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="文件脈絡無法載入" />}
                {documentContext && selectedVersion && <DocumentReader context={documentContext} selectedVersion={selectedVersion} history={history} busy={documentBusy} canWrite={canWrite} onVersion={selectExactVersion} onPublish={openPublish} onCreateDecision={() => { decisionForm.resetFields(); decisionForm.setFieldsValue({ document_id: documentContext.document.id, source_refs: [] }); setFormError(''); setDecisionOpen(true); }} />}
              </main>
            </div>
          </>
        ) : (
          <section className="knowledge-decisions">
            {decisionsError && <Alert className="product-page-alert" type="error" showIcon message="決策紀錄載入失敗" description={decisionsError} action={<Button size="small" onClick={() => void loadDecisions()}>重試</Button>} />}
            <div className="knowledge-decisions-heading"><div><Text type="secondary">依 Space 範圍載入；每筆決策保留來源引用與建立者。</Text></div><span>{decisionsBusy ? '載入中' : `${decisions.length} 筆決策`}</span></div>
            {decisionsBusy && !decisions.length && <div className="product-inline-loading"><Spin /></div>}
            {!decisionsBusy && decisions.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="此 Space 尚無決策紀錄" />}
            {decisions.map((decision) => <DecisionRow key={decision.id} decision={decision} documentTitle={documents.find((item) => item.id === decision.document_id)?.title} />)}
          </section>
        )}
      </ProductShell>

      {canCreateSpace && <Modal title="建立 Knowledge space" open={spaceModalOpen} onCancel={() => setSpaceModalOpen(false)} onOk={() => spaceForm.submit()} confirmLoading={spaceSaving} okText="建立 Space" cancelText="取消" destroyOnClose>
        {formError && <Alert className="product-form-alert" type="error" showIcon message={formError} />}
        <Form form={spaceForm} layout="vertical" onFinish={(values) => void createSpace(values)}><Form.Item name="key" label="Space 代碼" rules={[{ required: true, message: '請輸入代碼' }]}><Input maxLength={20} /></Form.Item><Form.Item name="name" label="名稱" rules={[{ required: true, message: '請輸入名稱' }]}><Input maxLength={120} /></Form.Item><Form.Item name="description" label="描述"><TextArea rows={3} /></Form.Item></Form>
      </Modal>}

      <Modal title="建立文件 v1" open={createDocumentOpen} onCancel={() => setCreateDocumentOpen(false)} onOk={() => documentForm.submit()} confirmLoading={documentSaving} okText="建立文件" cancelText="取消" width={760} destroyOnClose>
        {formError && <Alert className="product-form-alert" type="error" showIcon message={formError} />}
        <Form form={documentForm} layout="vertical" onFinish={(values) => void createDocument(values)}>
          <Form.Item name="title" label="文件標題" rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
          <Form.Item name="summary" label="摘要"><TextArea rows={2} /></Form.Item>
          <Form.Item name="body" label="正文（Markdown）" rules={[{ required: true, whitespace: true, message: '正文不得空白' }]}><TextArea rows={12} spellCheck /></Form.Item>
          <Form.Item name="tags" label="標籤"><Select mode="tags" tokenSeparators={[',']} placeholder="輸入標籤後按 Enter" /></Form.Item>
          <Form.Item name="change_summary" label="版本說明"><Input placeholder="初版建立" /></Form.Item>
          <Divider orientation="left" plain>來源與 provenance</Divider><ReferenceFields />
        </Form>
      </Modal>

      <Modal title={`發佈文件新版本${documentContext ? ` · ${documentContext.document.title}` : ''}`} open={publishOpen} onCancel={() => { setPublishOpen(false); setPublishError(''); }} onOk={() => publishForm.submit()} confirmLoading={publishSaving} okText="發佈新版本" cancelText="取消" width={780} destroyOnClose>
        {publishError && <Alert className="product-form-alert" type="error" showIcon message="未發佈新版本" description={publishError} />}
        {documentContext && <Alert className="product-form-alert" type="info" showIcon message={`目前最新版 v${documentContext.document.current_version}`} description="expected_version 採 compare-and-swap；舊版本不可變更。若遇版本衝突，先確認最新內容及來源再調整草稿。" />}
        <Form form={publishForm} layout="vertical" onFinish={(values) => void publishVersion(values)}>
          <Form.Item name="expected_version" label="預期目前版本" rules={[{ required: true }]}><InputNumber min={1} className="full-width" /></Form.Item>
          <Form.Item name="title" label="版本標題" rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
          <Form.Item name="body" label="正文（Markdown）" rules={[{ required: true, whitespace: true, message: '正文不得空白' }]}><TextArea rows={12} spellCheck /></Form.Item>
          <Form.Item name="change_summary" label="變更摘要" rules={[{ required: true, whitespace: true }]}><Input maxLength={300} /></Form.Item>
          <Divider orientation="left" plain>來源與 provenance</Divider><ReferenceFields />
        </Form>
      </Modal>

      <Modal title="記錄決策" open={decisionOpen} onCancel={() => setDecisionOpen(false)} onOk={() => decisionForm.submit()} confirmLoading={decisionSaving} okText="建立決策" cancelText="取消" width={720} destroyOnClose>
        {formError && <Alert className="product-form-alert" type="error" showIcon message={formError} />}
        <Form form={decisionForm} layout="vertical" onFinish={(values) => void createDecision(values)}>
          <Form.Item name="title" label="決策標題" rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
          <Form.Item name="document_id" label="關聯文件"><Select allowClear placeholder="不關聯特定文件" options={documents.map((document) => ({ value: document.id, label: document.title }))} /></Form.Item>
          <Form.Item name="body" label="決策內容" rules={[{ required: true, whitespace: true }]}><TextArea rows={5} /></Form.Item>
          <Divider orientation="left" plain>決策來源</Divider><ReferenceFields />
        </Form>
      </Modal>
    </>
  );
}

function DocumentReader({
  context,
  selectedVersion,
  history,
  busy,
  canWrite,
  onVersion,
  onPublish,
  onCreateDecision,
}: {
  context: DocumentContext;
  selectedVersion: DocumentVersion;
  history: DocumentVersion[];
  busy: boolean;
  canWrite: boolean;
  onVersion: (version: number) => void;
  onPublish: () => void;
  onCreateDecision: () => void;
}) {
  const isLatest = selectedVersion.version === context.document.current_version;
  return (
    <div className="document-reader-content">
      <div className="reader-toolbar"><div className="citation-uri">{selectedVersion.uri}</div><Space><Select aria-label="選擇文件版本" value={selectedVersion.version} loading={busy} onChange={(version) => onVersion(version)} options={history.slice().sort((a, b) => b.version - a.version).map((version) => ({ value: version.version, label: `v${version.version}${version.version === context.document.current_version ? ' · 最新' : ''}` }))} />{canWrite && isLatest && <Button type="primary" onClick={onPublish}>發佈新版本</Button>}</Space></div>
      {!isLatest && <Alert className="historical-version-alert" type="warning" showIcon icon={<HistoryOutlined />} message={`正在檢視不可變更的歷史版本 v${selectedVersion.version}`} />}
      <div className="reader-document-head"><div><div className="document-version-kicker">{context.document.space_id.slice(0, 8)} · VERSION {selectedVersion.version}</div><Title level={3}>{selectedVersion.title}</Title><Paragraph>{context.document.summary}</Paragraph></div><div className="reader-head-actions">{canWrite && <Button icon={<SafetyCertificateOutlined />} onClick={onCreateDecision}>記錄決策</Button>}</div></div>
      <Space wrap className="document-tags">{context.document.tags?.map((tag) => <Tag key={tag}>{tag}</Tag>)}</Space>
      {busy && <div className="reader-loading"><Spin size="small" /> 載入版本</div>}
      <article className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedVersion.body}</ReactMarkdown></article>
      <section className="version-metadata"><div><span>版本建立</span><strong>{dateText(selectedVersion.created_at)}</strong></div><div><span>編輯者</span><strong>{selectedVersion.author_id}</strong></div><div><span>內容 SHA-256</span><code>{selectedVersion.content_sha256}</code></div><div><span>變更摘要</span><strong>{selectedVersion.change_summary || '—'}</strong></div></section>
      <section className="provenance-section"><div className="knowledge-subhead"><h3>來源引用</h3><span>{selectedVersion.source_refs.length}</span></div><ReferenceList references={selectedVersion.source_refs} /></section>
      <section className="version-history-section"><div className="knowledge-subhead"><h3>不可變版本歷程</h3><span>{history.length}</span></div>{history.slice().sort((a, b) => b.version - a.version).map((version) => <button type="button" key={version.id} className={`version-history-row${version.version === selectedVersion.version ? ' version-history-current' : ''}`} onClick={() => onVersion(version.version)}><span className="version-history-number">v{version.version}</span><span className="version-history-summary">{version.change_summary || '沒有變更摘要'}<small>{dateText(version.created_at)} · SHA-256 {version.content_sha256.slice(0, 12)}…</small></span>{version.version === context.document.current_version && <Tag color="green">最新</Tag>}</button>)}</section>
      {context.decisions.length > 0 && <section className="version-history-section"><div className="knowledge-subhead"><h3>相關決策</h3><span>{context.decisions.length}</span></div>{context.decisions.map((decision) => <div className="inline-decision" key={decision.id}><strong>{decision.title}</strong><span>{decision.body}</span><ReferenceList references={decision.source_refs} /></div>)}</section>}
    </div>
  );
}

function DecisionRow({ decision, documentTitle }: { decision: Decision; documentTitle?: string }) {
  return (
    <article className="decision-row"><div className="decision-row-icon"><SafetyCertificateOutlined /></div><div className="decision-row-body"><div className="decision-row-header"><strong>{decision.title}</strong><time>{dateText(decision.created_at)}</time></div>{documentTitle && <span className="decision-document-link"><FileTextOutlined /> {documentTitle}</span>}<Paragraph>{decision.body}</Paragraph><div className="decision-provenance"><Text className="eyebrow">PROVENANCE</Text><ReferenceList references={decision.source_refs} /></div><span className="decision-actor">建立者 {decision.actor_id}</span></div></article>
  );
}
