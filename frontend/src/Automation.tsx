import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Segmented, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import type { FormInstance } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { BranchesOutlined, ClockCircleOutlined, PlusOutlined, ReloadOutlined, RocketOutlined } from '@ant-design/icons';
import { api, createIdempotencyKey, isDefinitiveClientError } from './api';
import type { Agent, AgentTemplate, AgentTemplateDefinition, ModelCatalog, SandboxProfile, ToolConnection, Workflow, WorkflowInstance, WorkflowStep } from './types';
import './Automation.css';

const { Text, Title } = Typography;
const { TextArea } = Input;
type AutomationTab = 'templates' | 'workflows' | 'history';
type TemplateFormValues = {
  key?: string;
  name: string;
  description?: string;
  definition: AgentTemplateDefinition;
};
type WorkflowStepForm = Omit<WorkflowStep, 'acceptance_criteria'> & { acceptance_criteria: string };
type WorkflowFormValues = {
  key?: string;
  name: string;
  description?: string;
  steps: WorkflowStepForm[];
  schedule?: WorkflowScheduleForm;
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '請求未完成。';
}

function dateText(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-TW', { hour12: false }) : '—';
}

function blankStep(key = 'step-1'): WorkflowStepForm {
  return { key, title: '', goal: '', description: '', acceptance_criteria: '', dependency_keys: [], agent_id: null, capabilities: [], reviewer_id: null, priority: 'medium' };
}

function workflowFormValues(workflow?: Workflow): WorkflowFormValues {
  return workflow ? {
    key: workflow.key,
    name: workflow.name,
    description: workflow.description,
    steps: workflow.steps.map((step) => ({ ...step, acceptance_criteria: step.acceptance_criteria.join('\n') })),
  } : { key: '', name: '', description: '', steps: [blankStep()], schedule: { enabled: false, interval_minutes: 60, max_runs: 1 } };
}

function toWorkflowSteps(steps: WorkflowStepForm[]): WorkflowStep[] {
  return steps.map((step) => ({
    ...step,
    acceptance_criteria: step.acceptance_criteria.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    dependency_keys: step.dependency_keys ?? [],
    capabilities: step.capabilities ?? [],
    agent_id: step.agent_id || null,
    reviewer_id: step.reviewer_id || null,
  }));
}

function validateSteps(steps: WorkflowStep[]) {
  if (steps.length < 1 || steps.length > 20) return '流程需要 1 至 20 個步驟。';
  const keys = new Set(steps.map((step) => step.key));
  if (keys.size !== steps.length || steps.some((step) => !step.key.trim())) return '步驟 key 必須填寫且不可重複。';
  for (const step of steps) {
    if (step.dependency_keys.includes(step.key) || step.dependency_keys.some((key) => !keys.has(key))) return `${step.key} 的相依步驟無效。`;
    if (Boolean(step.agent_id) === Boolean(step.capabilities.length)) return `${step.key} 請指定一位 Agent，或至少一項候選能力。`;
  }
  const dependencies = new Map(steps.map((step) => [step.key, step.dependency_keys]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    if ((dependencies.get(key) ?? []).some(hasCycle)) return true;
    visiting.delete(key);
    visited.add(key);
    return false;
  };
  return steps.some((step) => hasCycle(step.key)) ? '步驟相依形成循環，請調整 DAG。' : '';
}

export function Automation({ projectId, canManage, agents, onApplyTemplate }: {
  projectId: string;
  canManage: boolean;
  agents: Agent[];
  onApplyTemplate: (template: AgentTemplate) => void;
}) {
  const [tab, setTab] = useState<AutomationTab>('templates');
  return <section className="automation-page">
    <Segmented
      className="automation-tabs"
      value={tab}
      onChange={(value) => setTab(value as AutomationTab)}
      options={[{ value: 'templates', label: 'Agent 範本' }, { value: 'workflows', label: '工作流程' }, { value: 'history', label: '執行紀錄' }]}
    />
    {tab === 'templates' && <AgentTemplatePanel projectId={projectId} canManage={canManage} onApplyTemplate={onApplyTemplate} />}
    {tab === 'workflows' && <WorkflowPanel projectId={projectId} canManage={canManage} agents={agents} />}
    {tab === 'history' && <WorkflowHistoryPanel projectId={projectId} canManage={canManage} />}
  </section>;
}

function AgentTemplatePanel({ projectId, canManage, onApplyTemplate }: { projectId: string; canManage: boolean; onApplyTemplate: (template: AgentTemplate) => void }) {
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resourcesError, setResourcesError] = useState('');
  const [connections, setConnections] = useState<ToolConnection[]>([]);
  const [profiles, setProfiles] = useState<SandboxProfile[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [resourceBusy, setResourceBusy] = useState(false);
  const [editor, setEditor] = useState<{ kind: 'create' | 'version'; template?: AgentTemplate } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form] = Form.useForm<TemplateFormValues>();
  const [messageApi, messageContext] = message.useMessage();

  async function loadTemplates() {
    setLoading(true);
    setError('');
    try { setTemplates(await api.agentTemplates()); }
    catch (loadError) { setError(errorText(loadError)); }
    finally { setLoading(false); }
  }

  async function loadResources() {
    setResourceBusy(true);
    setResourcesError('');
    const results = await Promise.allSettled([api.modelCatalog(), api.toolConnections(projectId), api.sandboxProfiles(projectId)]);
    const failures: string[] = [];
    if (results[0].status === 'fulfilled') setCatalog(results[0].value);
    else failures.push(`模型目錄：${errorText(results[0].reason)}`);
    if (results[1].status === 'fulfilled') setConnections(results[1].value);
    else failures.push(`工具連線：${errorText(results[1].reason)}`);
    if (results[2].status === 'fulfilled') setProfiles(results[2].value);
    else failures.push(`Sandbox profiles：${errorText(results[2].reason)}`);
    setResourcesError(failures.join('；'));
    setResourceBusy(false);
  }

  useEffect(() => { void loadTemplates(); }, []);
  useEffect(() => { void loadResources(); }, [projectId]);

  function openCreate() {
    setEditor({ kind: 'create' });
    setFormError('');
    form.resetFields();
    form.setFieldsValue({
      key: '', name: '', description: '',
      definition: { role: 'worker', capabilities: [], instructions: '', model_config: null, tool_connection_ids: [], sandbox_profile_id: null, limits: { max_turns: 20, timeout_seconds: 600 } },
    });
  }

  function openVersion(template: AgentTemplate) {
    setEditor({ kind: 'version', template });
    setFormError('');
    form.resetFields();
    form.setFieldsValue({ name: template.name, description: template.description, definition: template.definition });
  }

  async function saveTemplate(values: TemplateFormValues) {
    setSaving(true);
    setFormError('');
    const definition = {
      ...values.definition,
      capabilities: values.definition.capabilities ?? [],
      instructions: values.definition.instructions ?? '',
      model_config: values.definition.model_config?.provider_id ? values.definition.model_config : null,
      tool_connection_ids: values.definition.tool_connection_ids ?? [],
      sandbox_profile_id: values.definition.sandbox_profile_id || null,
      limits: {
        max_turns: Number(values.definition.limits.max_turns),
        timeout_seconds: Number(values.definition.limits.timeout_seconds),
      },
    };
    try {
      if (editor?.kind === 'version' && editor.template) {
        await api.publishAgentTemplateVersion(editor.template.id, { name: values.name, description: values.description ?? '', definition });
        messageApi.success('範本新版本已發佈。');
      } else {
        await api.createAgentTemplate({ key: values.key!, name: values.name, description: values.description ?? '', definition });
        messageApi.success('Agent 範本 v1 已建立。');
      }
      setEditor(null);
      await loadTemplates();
    } catch (saveError) { setFormError(errorText(saveError)); }
    finally { setSaving(false); }
  }

  const columns: ColumnsType<AgentTemplate> = [
    { title: '範本', key: 'template', render: (_: unknown, item) => <div className="automation-name-cell"><strong>{item.name}</strong><span>{item.key} · v{item.version}</span></div> },
    { title: '角色', dataIndex: ['definition', 'role'], key: 'role', width: 90, render: (role: AgentTemplateDefinition['role']) => role === 'reviewer' ? '審核者' : '執行者' },
    { title: '能力', dataIndex: ['definition', 'capabilities'], key: 'capabilities', render: (items: string[]) => items?.length ? items.join(' · ') : '未設定' },
    { title: '更新時間', dataIndex: 'created_at', key: 'created_at', width: 150, render: dateText },
    { title: '', key: 'actions', width: 215, render: (_: unknown, item) => <Space wrap>{canManage && <Button size="small" onClick={() => onApplyTemplate(item)}>套用此版本</Button>}{canManage && <Button size="small" icon={<PlusOutlined />} onClick={() => openVersion(item)}>新增版本</Button>}</Space> },
  ];

  return <div className="automation-panel">
    {messageContext}
    <div className="automation-panel-heading"><div><Title level={4}>Agent 範本版本</Title><Text type="secondary">套用時固定精確版本；更新會建立新版本。</Text></div><Space><Button icon={<ReloadOutlined />} onClick={() => void loadTemplates()} loading={loading}>重新整理</Button>{canManage && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增範本</Button>}</Space></div>
    {error && <Alert className="automation-alert" type="error" showIcon message="Agent 範本無法載入" description={error} action={<Button size="small" onClick={() => void loadTemplates()}>重試</Button>} />}
    <div className="automation-table-shell"><Table<AgentTemplate> rowKey="id" columns={columns} dataSource={templates} loading={loading} pagination={{ pageSize: 12, showSizeChanger: false }} scroll={{ x: 760 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={error ? '無法顯示範本' : '目前沒有 Agent 範本'}>{canManage && !error && <Button size="small" type="primary" onClick={openCreate}>新增範本</Button>}</Empty> }} /></div>

    <Modal className="automation-editor-modal" title={editor?.kind === 'version' ? `新增 ${editor.template?.key} 範本版本` : '新增 Agent 範本'} open={Boolean(editor)} onCancel={() => setEditor(null)} onOk={() => form.submit()} confirmLoading={saving} okText={editor?.kind === 'version' ? '發佈新版本' : '建立 v1'} cancelText="取消" width={820} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={(values) => void saveTemplate(values)}>
        {formError && <Alert className="automation-alert" type="error" showIcon message="範本儲存失敗" description={formError} />}
        {resourcesError && <Alert className="automation-alert" type="error" showIcon message="執行資源無法完整載入" description={resourcesError} action={<Button size="small" loading={resourceBusy} onClick={() => void loadResources()}>重試</Button>} />}
        {editor?.kind === 'create' && <Form.Item name="key" label="範本 key" rules={[{ required: true, whitespace: true }]}><Input maxLength={80} autoComplete="off" /></Form.Item>}
        <div className="automation-form-grid">
          <Form.Item name="name" label="顯示名稱" rules={[{ required: true, whitespace: true }]}><Input maxLength={120} /></Form.Item>
          <Form.Item name="description" label="描述"><Input maxLength={500} /></Form.Item>
        </div>
        <TemplateDefinitionFields form={form} catalog={catalog} connections={connections} profiles={profiles} />
      </Form>
    </Modal>
  </div>;
}

function TemplateDefinitionFields({ form, catalog, connections, profiles }: {
  form: FormInstance<TemplateFormValues>;
  catalog: ModelCatalog | null;
  connections: ToolConnection[];
  profiles: SandboxProfile[];
}) {
  const providerId = Form.useWatch(['definition', 'model_config', 'provider_id'], form) as string | undefined;
  const modelId = Form.useWatch(['definition', 'model_config', 'model_id'], form) as string | undefined;
  const provider = catalog?.providers.find((item) => item.id === providerId);
  const model = provider?.models.find((item) => item.id === modelId);
  return <>
    <div className="automation-form-grid">
      <Form.Item name={['definition', 'role']} label="Agent 角色" rules={[{ required: true }]}><Select options={[{ value: 'worker', label: '執行者' }, { value: 'reviewer', label: '審核者' }]} /></Form.Item>
      <Form.Item name={['definition', 'capabilities']} label="能力標籤" rules={[{ validator: async (_, value: string[]) => { if ((value?.length ?? 0) > 100) throw new Error('範本能力標籤最多 100 項'); } }]}><Select mode="tags" maxCount={100} tokenSeparators={[',']} placeholder="輸入後按 Enter" /></Form.Item>
      <Form.Item name={['definition', 'model_config', 'provider_id']} label="模型 Provider">
        <Select allowClear placeholder="沿用組織預設" options={catalog?.providers.filter((item) => item.enabled).map((item) => ({ value: item.id, label: item.name })) ?? []} onChange={(id: string | undefined) => form.setFieldValue(['definition', 'model_config'], id ? { provider_id: id, model_id: undefined, reasoning_effort: undefined, max_output_tokens: undefined } : null)} />
      </Form.Item>
      <Form.Item name={['definition', 'model_config', 'model_id']} label="Model" rules={providerId ? [{ required: true, message: '選擇 Provider 後需指定模型' }] : []}>
        <Select allowClear disabled={!provider} placeholder="選擇模型" options={provider?.models.map((item) => ({ value: item.id, label: item.name })) ?? []} onChange={(id: string | undefined) => form.setFieldValue(['definition', 'model_config'], { ...(form.getFieldValue(['definition', 'model_config']) ?? {}), model_id: id, reasoning_effort: undefined, max_output_tokens: undefined })} />
      </Form.Item>
      <Form.Item name={['definition', 'model_config', 'reasoning_effort']} label="推理強度" rules={providerId ? [{ required: true }] : []}>
        <Select allowClear disabled={!model} placeholder="選擇推理強度" options={model?.reasoning_efforts.map((value) => ({ value, label: value })) ?? []} />
      </Form.Item>
      <Form.Item name={['definition', 'model_config', 'max_output_tokens']} label="輸出上限" rules={providerId ? [{ required: true, type: 'number', min: 16 }, { validator: async (_, value: number) => { if (value !== undefined && model && value > model.max_output_tokens) throw new Error(`不可超過此模型上限 ${model.max_output_tokens.toLocaleString()}`); } } ] : []}>
        <InputNumber className="full-width" min={16} max={model?.max_output_tokens} precision={0} disabled={!model} />
      </Form.Item>
      <Form.Item name={['definition', 'tool_connection_ids']} label="可用工具連線" rules={[{ validator: async (_, value: string[]) => { if ((value?.length ?? 0) > 30) throw new Error('工具連線最多 30 個'); } }]}><Select mode="multiple" maxCount={30} allowClear placeholder="選擇專案連線" options={connections.map((item) => ({ value: item.id, label: `${item.name}${item.enabled ? '' : ' · 已停用'}`, disabled: !item.enabled }))} /></Form.Item>
      <Form.Item name={['definition', 'sandbox_profile_id']} label="Sandbox profile"><Select allowClear placeholder="不使用 Sandbox" options={profiles.map((item) => ({ value: item.id, label: `${item.name}${item.enabled ? '' : ' · 已停用'}`, disabled: !item.enabled }))} /></Form.Item>
      <Form.Item className="automation-form-span" name={['definition', 'instructions']} label="Agent 指令" extra="上限 16,000 字元"><TextArea rows={5} maxLength={16000} showCount /></Form.Item>
      <Form.Item name={['definition', 'limits', 'max_turns']} label="最多模型回合" rules={[{ required: true, type: 'number', min: 1, max: 100 }]}><InputNumber className="full-width" min={1} max={100} precision={0} /></Form.Item>
      <Form.Item name={['definition', 'limits', 'timeout_seconds']} label="執行逾時（秒）" rules={[{ required: true, type: 'number', min: 30, max: 3600 }]}><InputNumber className="full-width" min={30} max={3600} precision={0} /></Form.Item>
    </div>
  </>;
}

function WorkflowPanel({ projectId, canManage, agents }: { projectId: string; canManage: boolean; agents: Agent[] }) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ kind: 'create' | 'version'; workflow?: Workflow } | null>(null);
  const [scheduleWorkflow, setScheduleWorkflow] = useState<Workflow | null>(null);
  const [startWorkflow, setStartWorkflow] = useState<Workflow | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form] = Form.useForm<WorkflowFormValues>();
  const [scheduleForm] = Form.useForm<WorkflowScheduleForm>();
  const [startForm] = Form.useForm<{ inputs?: string }>();
  const pendingStartKey = useRef<{ workflowId: string; inputs: string; key: string } | null>(null);
  const startBusy = useRef(false);
  const [messageApi, messageContext] = message.useMessage();

  async function loadWorkflows() {
    setLoading(true);
    setError('');
    try { setWorkflows(await api.workflows(projectId)); }
    catch (loadError) { setError(errorText(loadError)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadWorkflows(); }, [projectId]);

  function openCreate() {
    setEditor({ kind: 'create' });
    setFormError('');
    form.resetFields();
    form.setFieldsValue(workflowFormValues());
  }

  function openVersion(workflow: Workflow) {
    setEditor({ kind: 'version', workflow });
    setFormError('');
    form.resetFields();
    form.setFieldsValue(workflowFormValues(workflow));
  }

  async function saveWorkflow(values: WorkflowFormValues) {
    const steps = toWorkflowSteps(values.steps ?? []);
    const invalid = validateSteps(steps);
    if (invalid) { setFormError(invalid); return; }
    setSaving(true);
    setFormError('');
    try {
      if (editor?.kind === 'version' && editor.workflow) {
        await api.publishWorkflowVersion(editor.workflow.id, { name: values.name, description: values.description ?? '', steps });
        messageApi.success('工作流程新版本已發佈。');
      } else {
        await api.createWorkflow({
          project_id: projectId,
          key: values.key!,
          name: values.name,
          description: values.description ?? '',
          steps,
          ...(values.schedule?.enabled ? { schedule: values.schedule } : {}),
        });
        messageApi.success('工作流程 v1 已建立。');
      }
      setEditor(null);
      await loadWorkflows();
    } catch (saveError) { setFormError(errorText(saveError)); }
    finally { setSaving(false); }
  }

  async function saveSchedule(values: WorkflowScheduleForm) {
    if (!scheduleWorkflow) return;
    setSaving(true);
    setFormError('');
    try {
      await api.saveWorkflowSchedule(scheduleWorkflow.id, values);
      setScheduleWorkflow(null);
      messageApi.success(values.enabled ? '排程已啟用。' : '排程已停用。');
      await loadWorkflows();
    } catch (saveError) { setFormError(errorText(saveError)); }
    finally { setSaving(false); }
  }

  async function start(values: { inputs?: string }) {
    if (!startWorkflow || startBusy.current) return;
    const inputs = values.inputs ?? '';
    if (pendingStartKey.current?.workflowId !== startWorkflow.id || pendingStartKey.current.inputs !== inputs) {
      pendingStartKey.current = { workflowId: startWorkflow.id, inputs, key: createIdempotencyKey() };
    }
    const operation = pendingStartKey.current;
    startBusy.current = true;
    setSaving(true);
    setFormError('');
    try {
      const instance = await api.startWorkflow(startWorkflow.id, { inputs }, operation.key);
      if (pendingStartKey.current?.key === operation.key) {
        pendingStartKey.current = null;
        setStartWorkflow(null);
      }
      messageApi.success(`已啟動工作流程，Instance ${instance.id.slice(0, 8)}。`);
    } catch (startError) {
      if (isDefinitiveClientError(startError) && pendingStartKey.current?.key === operation.key) pendingStartKey.current = null;
      setFormError(errorText(startError));
    }
    finally { startBusy.current = false; setSaving(false); }
  }

  function showSchedule(workflow: Workflow) {
    setFormError('');
    scheduleForm.setFieldsValue(workflow.schedule ?? { enabled: false, interval_minutes: 60, max_runs: 1 });
    setScheduleWorkflow(workflow);
  }

  const columns: ColumnsType<Workflow> = [
    { title: '流程', key: 'workflow', render: (_: unknown, item) => <div className="automation-name-cell"><strong>{item.name}</strong><span>{item.key} · v{item.version}</span></div> },
    { title: '步驟', dataIndex: 'steps', key: 'steps', width: 80, render: (steps: WorkflowStep[]) => `${steps.length} 步` },
    { title: '排程', key: 'schedule', width: 190, render: (_: unknown, item) => <div className="automation-name-cell"><span>{item.schedule.enabled ? `每 ${item.schedule.interval_minutes} 分鐘 · 最多 ${item.schedule.max_runs} 次` : '未啟用'}</span><span>{item.schedule.enabled ? `下次 ${dateText(item.next_run_at)}` : '手動啟動'}</span></div> },
    { title: '', key: 'actions', width: 275, render: (_: unknown, item) => <Space wrap>{canManage && <Button size="small" type="primary" icon={<RocketOutlined />} onClick={() => { pendingStartKey.current = null; startForm.resetFields(); setFormError(''); setStartWorkflow(item); }}>手動啟動</Button>}{canManage && <Button size="small" icon={<BranchesOutlined />} onClick={() => openVersion(item)}>新增版本</Button>}{canManage && <Button size="small" icon={<ClockCircleOutlined />} onClick={() => showSchedule(item)}>排程</Button>}</Space> },
  ];

  return <div className="automation-panel">
    {messageContext}
    <div className="automation-panel-heading"><div><Title level={4}>工作流程版本</Title><Text type="secondary">每個 instance 固定使用一個版本，完成條件依各步驟獨立審核。</Text></div><Space><Button icon={<ReloadOutlined />} onClick={() => void loadWorkflows()} loading={loading}>重新整理</Button>{canManage && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增流程</Button>}</Space></div>
    {error && <Alert className="automation-alert" type="error" showIcon message="工作流程無法載入" description={error} action={<Button size="small" onClick={() => void loadWorkflows()}>重試</Button>} />}
    <div className="automation-table-shell"><Table<Workflow> rowKey="id" columns={columns} dataSource={workflows} loading={loading} pagination={{ pageSize: 12, showSizeChanger: false }} scroll={{ x: 760 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={error ? '無法顯示流程' : '此專案尚無工作流程'}>{canManage && !error && <Button size="small" type="primary" onClick={openCreate}>新增流程</Button>}</Empty> }} /></div>

    <Modal className="automation-editor-modal" title={editor?.kind === 'version' ? `新增 ${editor.workflow?.key} 工作流程版本` : '新增工作流程'} open={Boolean(editor)} onCancel={() => setEditor(null)} onOk={() => form.submit()} confirmLoading={saving} okText={editor?.kind === 'version' ? '發佈新版本' : '建立 v1'} cancelText="取消" width={900} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={(values) => void saveWorkflow(values)}>
        {formError && <Alert className="automation-alert" type="error" showIcon message="工作流程未儲存" description={formError} />}
        <div className="automation-form-grid">
          {editor?.kind === 'create' && <Form.Item name="key" label="流程 key" rules={[{ required: true, whitespace: true }]}><Input maxLength={80} /></Form.Item>}
          {editor?.kind === 'version' && <Form.Item name="key" hidden><Input /></Form.Item>}
          <Form.Item name="name" label="顯示名稱" rules={[{ required: true, whitespace: true }]}><Input maxLength={120} /></Form.Item>
          <Form.Item name="description" label="描述"><Input maxLength={500} /></Form.Item>
        </div>
        <WorkflowStepEditor form={form} agents={agents} />
        {editor?.kind === 'create' && <div className="workflow-schedule-create">
          <Form.Item name={['schedule', 'enabled']} valuePropName="checked" noStyle><Switch checkedChildren="啟用排程" unCheckedChildren="手動啟動" /></Form.Item>
          <ScheduleFields form={form} namePrefix="schedule" />
        </div>}
      </Form>
    </Modal>

    <Modal title={`排程 · ${scheduleWorkflow?.name ?? ''}`} open={Boolean(scheduleWorkflow)} onCancel={() => setScheduleWorkflow(null)} onOk={() => scheduleForm.submit()} confirmLoading={saving} okText="儲存排程" cancelText="取消" destroyOnClose>
      <Form form={scheduleForm} layout="vertical" onFinish={(values) => void saveSchedule(values)}>
        {formError && <Alert className="automation-alert" type="error" showIcon message="排程未儲存" description={formError} />}
        <Form.Item name="enabled" valuePropName="checked" label="排程狀態"><Switch checkedChildren="啟用" unCheckedChildren="停用" /></Form.Item>
        <ScheduleFields form={scheduleForm} namePrefix="" />
      </Form>
    </Modal>

    <Modal title={`啟動流程 · ${startWorkflow?.name ?? ''}`} open={Boolean(startWorkflow)} onCancel={() => { pendingStartKey.current = null; setStartWorkflow(null); }} onOk={() => startForm.submit()} confirmLoading={saving} okText="啟動流程" cancelText="取消" destroyOnClose>
      <Form form={startForm} layout="vertical" onFinish={(values) => void start(values)} onValuesChange={() => { pendingStartKey.current = null; }}>
        {formError && <Alert className="automation-alert" type="error" showIcon message="無法啟動工作流程" description={formError} />}
        <Form.Item name="inputs" label="流程輸入"><TextArea rows={5} maxLength={20000} showCount /></Form.Item>
      </Form>
    </Modal>
  </div>;
}

type WorkflowScheduleForm = { enabled: boolean; interval_minutes: number; max_runs: number };

function ScheduleFields<T extends WorkflowFormValues | WorkflowScheduleForm>({ form, namePrefix }: { form: FormInstance<T>; namePrefix: string }) {
  const enabledPath = namePrefix ? [namePrefix, 'enabled'] : 'enabled';
  const enabled = Form.useWatch(enabledPath, form) as boolean | undefined;
  const intervalName = namePrefix ? [namePrefix, 'interval_minutes'] : 'interval_minutes';
  const maxRunsName = namePrefix ? [namePrefix, 'max_runs'] : 'max_runs';
  return <div className={`automation-form-grid${!enabled ? ' workflow-schedule-fields-disabled' : ''}`}>
    <Form.Item name={intervalName} label="間隔（分鐘）" rules={enabled ? [{ required: true, type: 'number', min: 1, max: 525600 }] : []}><InputNumber className="full-width" min={1} max={525600} precision={0} disabled={!enabled} /></Form.Item>
    <Form.Item name={maxRunsName} label="最多執行次數" rules={enabled ? [{ required: true, type: 'number', min: 1, max: 1000 }] : []}><InputNumber className="full-width" min={1} max={1000} precision={0} disabled={!enabled} /></Form.Item>
  </div>;
}

function WorkflowStepEditor({ form, agents }: { form: FormInstance<WorkflowFormValues>; agents: Agent[] }) {
  const steps = (Form.useWatch('steps', form) ?? []) as WorkflowStepForm[];
  const workers = agents.filter((agent) => agent.runtime === 'pi' && agent.role === 'worker' && agent.status !== 'disabled');
  const reviewers = agents.filter((agent) => agent.role === 'reviewer' && agent.status !== 'disabled');
  const capabilities = [...new Set(workers.flatMap((agent) => agent.capabilities))].map((value) => ({ value, label: value }));
  return <Form.List name="steps">
    {(fields, { add, remove }) => <section className="workflow-step-editor">
      <div className="automation-panel-heading workflow-step-heading"><div><strong>流程步驟與相依</strong><Text type="secondary">依賴完成後才派送；每個步驟仍需獨立審核。</Text></div><Button icon={<PlusOutlined />} disabled={fields.length >= 20} onClick={() => add(blankStep(`step-${fields.length + 1}`))}>新增步驟</Button></div>
      {fields.map((field) => {
        const ownKey = steps[field.name]?.key;
        const dependencyOptions = steps.map((step) => step.key).filter((key) => key && key !== ownKey).map((key) => ({ value: key, label: key }));
        return <article className="workflow-step-row" key={field.key}>
          <div className="workflow-step-row-heading"><strong>步驟 {field.name + 1}</strong><Button danger type="text" disabled={fields.length <= 1} onClick={() => remove(field.name)}>移除</Button></div>
          <div className="automation-form-grid">
            <Form.Item name={[field.name, 'key']} label="Step key" rules={[{ required: true, whitespace: true }]}><Input maxLength={80} /></Form.Item>
            <Form.Item name={[field.name, 'title']} label="步驟名稱" rules={[{ required: true, whitespace: true }]}><Input maxLength={180} /></Form.Item>
            <Form.Item name={[field.name, 'goal']} label="目標" rules={[{ required: true, whitespace: true, max: 10000 }]}><Input maxLength={10000} /></Form.Item>
            <Form.Item name={[field.name, 'priority']} label="優先級" rules={[{ required: true }]}><Select options={[{ value: 'urgent', label: '緊急' }, { value: 'high', label: '高' }, { value: 'medium', label: '一般' }, { value: 'low', label: '低' }]} /></Form.Item>
            <Form.Item className="automation-form-span" name={[field.name, 'description']} label="描述" rules={[{ max: 10000 }]}><TextArea rows={2} maxLength={10000} /></Form.Item>
            <Form.Item name={[field.name, 'dependency_keys']} label="相依步驟" rules={[{ validator: async (_, value: string[]) => { if ((value?.length ?? 0) > 20) throw new Error('每個步驟最多 20 個相依項目'); } }]}><Select mode="multiple" maxCount={20} allowClear options={dependencyOptions} placeholder="此步驟可先執行" /></Form.Item>
            <Form.Item name={[field.name, 'agent_id']} label="指定 Pi Agent"><Select allowClear placeholder="依能力選擇" options={workers.map((agent) => ({ value: agent.id, label: `${agent.name} · ${agent.status}` }))} /></Form.Item>
            <Form.Item name={[field.name, 'capabilities']} label="候選能力" rules={[{ validator: async (_, value: string[]) => { if ((value?.length ?? 0) > 100) throw new Error('候選能力最多 100 項'); } }]}><Select mode="tags" maxCount={100} allowClear placeholder="指定 Agent 時留白" options={capabilities} /></Form.Item>
            <Form.Item name={[field.name, 'reviewer_id']} label="獨立審核者"><Select allowClear placeholder="依專案審核規則" options={reviewers.map((agent) => ({ value: agent.id, label: agent.name }))} /></Form.Item>
            <Form.Item className="automation-form-span" name={[field.name, 'acceptance_criteria']} label="驗收條件" extra="每行一項"><TextArea rows={2} /></Form.Item>
          </div>
        </article>;
      })}
    </section>}
  </Form.List>;
}

function WorkflowHistoryPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [runs, setRuns] = useState<WorkflowInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<WorkflowInstance | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [messageApi, messageContext] = message.useMessage();

  async function loadRuns() {
    setLoading(true);
    setError('');
    try { setRuns(await api.workflowRuns(projectId)); }
    catch (loadError) { setError(errorText(loadError)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadRuns(); }, [projectId]);

  async function openDetails(instance: WorkflowInstance) {
    setSelected(instance);
    setDetailBusy(true);
    setActionError('');
    try { setSelected(await api.workflowRun(instance.id)); }
    catch (loadError) { setActionError(errorText(loadError)); }
    finally { setDetailBusy(false); }
  }

  async function cancelInstance() {
    if (!selected) return;
    setActionBusy(true);
    setActionError('');
    try {
      const updated = await api.cancelWorkflowRun(selected.id);
      setSelected(updated);
      await loadRuns();
      messageApi.success('工作流程已取消。');
    } catch (cancelError) { setActionError(errorText(cancelError)); }
    finally { setActionBusy(false); }
  }

  const columns: ColumnsType<WorkflowInstance> = [
    { title: 'Instance', dataIndex: 'id', key: 'id', width: 118, render: (id: string) => <code>{id.slice(0, 8)}</code> },
    { title: '狀態', dataIndex: 'status', key: 'status', width: 110, render: (status: WorkflowInstance['status']) => <Tag color={status === 'completed' ? 'green' : status === 'failed' ? 'red' : status === 'cancelled' ? 'default' : 'blue'}>{status}</Tag> },
    { title: '觸發', dataIndex: 'trigger', key: 'trigger', width: 100, render: (trigger: WorkflowInstance['trigger']) => trigger === 'manual' ? '手動' : '排程' },
    { title: '更新時間', dataIndex: 'updated_at', key: 'updated_at', width: 160, render: dateText },
    { title: '步驟', dataIndex: 'steps', key: 'steps', render: (steps: WorkflowInstance['steps']) => <span className="automation-numeric">{steps.filter((step) => step.status === 'completed' || step.status === 'done').length}/{steps.length}</span> },
    { title: '', key: 'actions', width: 90, render: (_: unknown, item) => <Button size="small" onClick={() => void openDetails(item)}>檢視</Button> },
  ];
  return <div className="automation-panel">
    {messageContext}
    <div className="automation-panel-heading"><div><Title level={4}>工作流程執行紀錄</Title><Text type="secondary">等待中的步驟、失敗原因與 Run 關聯保留在 Instance。</Text></div><Button icon={<ReloadOutlined />} onClick={() => void loadRuns()} loading={loading}>重新整理</Button></div>
    {error && <Alert className="automation-alert" type="error" showIcon message="執行紀錄無法載入" description={error} action={<Button size="small" onClick={() => void loadRuns()}>重試</Button>} />}
    <div className="automation-table-shell"><Table<WorkflowInstance> rowKey="id" columns={columns} dataSource={runs} loading={loading} pagination={{ pageSize: 12, showSizeChanger: false }} scroll={{ x: 700 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={error ? '無法顯示執行紀錄' : '尚無工作流程執行紀錄'} /> }} /></div>
    <Drawer title={<div className="automation-drawer-title"><div><Text className="eyebrow">WORKFLOW INSTANCE</Text><Title level={4}>{selected?.id.slice(0, 8) ?? 'Instance 詳情'}</Title></div>{selected && <Tag>{selected.status}</Tag>}</div>} open={Boolean(selected)} onClose={() => setSelected(null)} width={620} className="automation-drawer">
      {detailBusy && <div className="automation-loading"><Text type="secondary">正在載入 Instance</Text></div>}
      {actionError && <Alert className="automation-alert" type="error" showIcon message="Instance 操作未完成" description={actionError} />}
      {selected && !detailBusy && <>
        {canManage && ['running', 'waiting'].includes(selected.status) && <Button className="workflow-cancel-button" danger loading={actionBusy} onClick={() => void cancelInstance()}>取消 Instance</Button>}
        <Descriptions size="small" column={1}>
          <Descriptions.Item label="Workflow version">{selected.workflow_id}</Descriptions.Item>
          <Descriptions.Item label="觸發方式">{selected.trigger === 'manual' ? '手動' : '排程'}</Descriptions.Item>
          <Descriptions.Item label="建立時間">{dateText(selected.created_at)}</Descriptions.Item>
          <Descriptions.Item label="更新時間">{dateText(selected.updated_at)}</Descriptions.Item>
        </Descriptions>
        <div className="workflow-instance-steps">{selected.steps.map((step) => <article className="workflow-instance-step" key={step.key}>
          <div><strong>{step.key}</strong><Tag>{step.status}</Tag></div>
          <span>Task {step.task_id}</span>
          {step.run_id && <span>Run {step.run_id}</span>}
          {step.error && <Alert type="error" showIcon message={step.error} />}
        </article>)}</div>
        {selected.inputs && <div className="workflow-instance-inputs"><strong>流程輸入</strong><pre>{selected.inputs}</pre></div>}
      </>}
    </Drawer>
  </div>;
}
