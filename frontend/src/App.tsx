import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Skeleton,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  AppstoreOutlined,
  AuditOutlined,
  BranchesOutlined,
  CheckOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  CopyOutlined,
  CodeOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
  InboxOutlined,
  LinkOutlined,
  LockOutlined,
  PlusOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SendOutlined,
  SettingOutlined,
  TeamOutlined,
  ToolOutlined,
  UnorderedListOutlined,
  UserAddOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { api } from './api';
import { RunConsole } from './RunConsole';
import { Automation } from './Automation';
import { ToolSettings } from './ToolSettings';
import './AgentExecution.css';
import { ProductSwitcher } from './products/shared/ProductSwitcher';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AuthScreen } from './auth/AuthScreen';
import { AuthAccessDenied } from './auth/AuthAccessDenied';
import { AccountControl } from './auth/AccountSettings';
import { AgentModelConfigFields, ModelSettings } from './models/ModelSettings';
import type {
  Agent,
  AgentTemplate,
  Artifact,
  AuditEvent,
  ClaimedExecution,
  Execution,
  ExecutionConfig,
  Message as ProjectMessage,
  ModelCatalog,
  ModelSelection,
  Overview,
  Principal,
  Project,
  ProjectContext,
  Task,
  TaskContext,
  TaskStatus,
} from './types';

const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

type Section = 'tasks' | 'runs' | 'automation' | 'tools' | 'overview' | 'agents' | 'inbox' | 'audit' | 'model-settings';
type Lease = Pick<ClaimedExecution, 'execution' | 'lease_token'>;
type TaskOperation = 'progress' | 'submit' | 'block' | 'release';
type ExistingPullRequest = {
  provider: 'github' | 'gitlab' | 'gitea';
  repository: string;
  number: number;
  title: string;
  state: string;
  web_url: string;
  head_sha: string;
  head: string;
  base: string;
  checks: Array<{ context: string; state: string; description: string | null; target_url: string | null }>;
  checks_available: boolean;
  source: 'provider_api';
};

const sectionNames: Record<Section, string> = {
  tasks: '任務工作區',
  runs: 'Run 執行',
  automation: '自動化',
  tools: '工具與沙箱',
  overview: '專案總覽',
  agents: 'Agent 名錄',
  inbox: '協作收件匣',
  audit: '操作稽核',
  'model-settings': '模型連線',
};

const statusLabel: Record<string, string> = {
  backlog: '待整理',
  ready: '待執行',
  in_progress: '進行中',
  blocked: '受阻',
  in_review: '待審核',
  done: '已完成',
  cancelled: '已取消',
};

const statusColor: Record<string, string> = {
  backlog: 'default',
  ready: 'blue',
  in_progress: 'purple',
  blocked: 'red',
  in_review: 'gold',
  done: 'green',
  cancelled: 'default',
};

const priorityLabel: Record<string, string> = {
  urgent: '緊急',
  high: '高',
  medium: '一般',
  low: '低',
};

const priorityColor: Record<string, string> = {
  urgent: 'red',
  high: 'volcano',
  medium: 'blue',
  low: 'default',
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '發生未預期的錯誤。';
}

function displayDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? '—'
    : new Intl.DateTimeFormat('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function money(value?: number | null): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value ?? 0);
}

function nameFor(
  id: string | null | undefined,
  people: Array<{ id: string; principal_id?: string; name: string }>,
  principal?: Pick<Principal, 'id' | 'name'> | null,
): string {
  if (!id) return '未指派';
  if (principal?.id === id) return principal.name;
  return people.find((person) => person.id === id || person.principal_id === id)?.name ?? id.slice(0, 8);
}

function splitLines(value?: string): string[] {
  return (value ?? '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function safeWebUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function taskStatusTag(status: TaskStatus) {
  return <Tag color={statusColor[status] ?? 'default'}>{statusLabel[status] ?? status}</Tag>;
}

function NavItem({
  active,
  icon,
  label,
  onClick,
  count,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button className={`nav-item${active ? ' nav-item-active' : ''}`} onClick={onClick} type="button">
      <span className="nav-item-icon">{icon}</span>
      <span>{label}</span>
      {typeof count === 'number' && count > 0 && <span className="nav-count">{count > 99 ? '99+' : count}</span>}
    </button>
  );
}

export default function App() {
  return <AuthProvider><WorkWorkspace /></AuthProvider>;
}

function WorkWorkspace() {
  const auth = useAuth();
  const canCreateProject = auth.session?.user.role === 'admin';
  const [messageApi, messageContext] = message.useMessage();
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [principalError, setPrincipalError] = useState('');
  const [principalErrorStatus, setPrincipalErrorStatus] = useState(0);
  const [principalSessionKey, setPrincipalSessionKey] = useState('');
  const [health, setHealth] = useState<'checking' | 'ok' | 'error'>('checking');
  const [apiMode, setApiMode] = useState<'development' | 'production' | ''>('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [section, setSection] = useState<Section>('tasks');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksBusy, setTasksBusy] = useState(false);
  const [tasksError, setTasksError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [taskContext, setTaskContext] = useState<TaskContext | null>(null);
  const [taskContextBusy, setTaskContextBusy] = useState(false);
  const [taskContextError, setTaskContextError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [leases, setLeases] = useState<Record<string, Lease>>({});
  const [claimAgentId, setClaimAgentId] = useState<string>();
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskSaving, setTaskSaving] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectSaving, setProjectSaving] = useState(false);
  const [agentList, setAgentList] = useState<Agent[]>([]);
  const [agentsBusy, setAgentsBusy] = useState(false);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentTemplates, setAgentTemplates] = useState<AgentTemplate[]>([]);
  const [agentToolConnections, setAgentToolConnections] = useState<import('./types').ToolConnection[]>([]);
  const [agentSandboxProfiles, setAgentSandboxProfiles] = useState<import('./types').SandboxProfile[]>([]);
  const [agentExecutionOptionsLoading, setAgentExecutionOptionsLoading] = useState(false);
  const [agentExecutionOptionsError, setAgentExecutionOptionsError] = useState('');
  const [newAgentToken, setNewAgentToken] = useState('');
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog | null>(null);
  const [modelCatalogLoading, setModelCatalogLoading] = useState(false);
  const [modelCatalogError, setModelCatalogError] = useState('');
  const [inbox, setInbox] = useState<ProjectMessage[]>([]);
  const [inboxBusy, setInboxBusy] = useState(false);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [eventsBusy, setEventsBusy] = useState(false);
  const [messageModal, setMessageModal] = useState<{ open: boolean; replyTo?: ProjectMessage; taskId?: string; kind?: ProjectMessage['kind'] }>({ open: false });
  const [messageSaving, setMessageSaving] = useState(false);
  const [delegateOpen, setDelegateOpen] = useState(false);
  const [delegateSaving, setDelegateSaving] = useState(false);
  const [operationModal, setOperationModal] = useState<TaskOperation | null>(null);
  const [operationSaving, setOperationSaving] = useState(false);
  const [reviewDecision, setReviewDecision] = useState<'accept' | 'reject' | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [taskForm] = Form.useForm();
  const [projectForm] = Form.useForm();
  const [agentForm] = Form.useForm();
  const [messageForm] = Form.useForm();
  const [delegateForm] = Form.useForm();
  const [operationForm] = Form.useForm();
  const [reviewForm] = Form.useForm();
  const agentRuntime = (Form.useWatch('runtime', agentForm) as Agent['runtime'] | undefined) ?? 'external';
  const agentModelMode = Form.useWatch('modelMode', agentForm) as 'inherit' | 'override' | undefined;
  const taskRequestSequence = useRef(0);
  const agentExecutionOptionsSequence = useRef(0);

  useEffect(() => {
    agentExecutionOptionsSequence.current += 1;
    setAgentTemplates([]);
    setAgentToolConnections([]);
    setAgentSandboxProfiles([]);
    setAgentExecutionOptionsLoading(false);
    setAgentExecutionOptionsError('');
    setAgentModalOpen(false);
    setEditingAgent(null);
    setNewAgentToken('');
    agentForm.resetFields();
  }, [projectId]);

  const currentProject = projects.find((project) => project.id === projectId) ?? projectContext?.project ?? null;
  const people = projectContext?.agents ?? agentList.filter((agent) => !projectId || agent.project_ids.includes(projectId));
  const selectedTask = taskContext?.task ?? tasks.find((task) => task.id === selectedTaskId) ?? null;
  const lease = selectedTaskId ? leases[selectedTaskId] : undefined;
  const canManageAgents = Boolean(principal && ['admin', 'manager'].includes(principal.role));
  const activeReviewer = taskContext?.executions.find((execution) => execution.status === 'submitted') ?? null;
  const submittedByCurrentAgent = Boolean(activeReviewer && people.some((agent) => agent.id === activeReviewer.agent_id && agent.principal_id === principal?.id));
  const designatedReviewerPrincipal = selectedTask?.reviewer_id
    ? people.find((agent) => agent.id === selectedTask.reviewer_id)?.principal_id
    : undefined;
  const canReview = Boolean(
    selectedTask?.status === 'in_review'
      && principal
      && ['admin', 'manager', 'reviewer'].includes(principal.role)
      && activeReviewer?.agent_id !== principal.id
      && !submittedByCurrentAgent
      && (!selectedTask.reviewer_id || selectedTask.reviewer_id === principal.id || designatedReviewerPrincipal === principal.id),
  );

  useEffect(() => {
    api.get<{ status: string; mode?: 'development' | 'production' }>('/api/health')
      .then((result) => { setHealth('ok'); setApiMode(result.mode ?? ''); })
      .catch(() => setHealth('error'));
  }, []);

  useEffect(() => {
    if (!auth.session) {
      setPrincipal(null);
      setPrincipalSessionKey('');
      setPrincipalError('');
      setPrincipalErrorStatus(0);
      setProjects([]);
      setProjectId('');
      setProjectContext(null);
      setOverview(null);
      setTasks([]);
      setTaskContext(null);
      setAgentList([]);
      setModelCatalog(null);
      setModelCatalogError('');
      setInbox([]);
      setEvents([]);
      setLeases({});
      setDrawerOpen(false);
      return;
    }
    let current = true;
    setPrincipal(null);
    setPrincipalSessionKey(auth.session.csrf_token);
    setAuthBusy(true);
    setPrincipalError('');
    setPrincipalErrorStatus(0);
    api.me()
      .then((result) => {
        if (!current) return;
        setPrincipal(result);
        setPrincipalSessionKey(auth.session?.csrf_token ?? '');
      })
      .catch((error) => { if (current) { setPrincipalError(errorText(error)); setPrincipalErrorStatus(error instanceof Error && 'status' in error ? Number((error as { status: unknown }).status) : 0); } })
      .finally(() => { if (current) setAuthBusy(false); });
    return () => { current = false; };
  }, [auth.session]);

  useEffect(() => {
    if (!principal) return;
    let current = true;
    api.projects()
      .then((result) => {
        if (!current) return;
        setProjects(result);
        setProjectId((existing) => result.some((project) => project.id === existing) ? existing : result[0]?.id ?? '');
      })
      .catch((error) => {
        if (current) setProjectError(errorText(error));
      });
    return () => { current = false; };
  }, [principal]);

  useEffect(() => {
    if (!principal || !projectId) {
      setProjectContext(null);
      setOverview(null);
      return;
    }
    let current = true;
    setProjectBusy(true);
    setProjectError('');
    Promise.allSettled([
      api.projectContext(projectId),
      api.overview(projectId),
    ])
      .then(([contextResult, overviewResult]) => {
        if (!current) return;
        if (contextResult.status === 'fulfilled') setProjectContext(contextResult.value);
        else setProjectError(errorText(contextResult.reason));
        if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value);
        else if (contextResult.status === 'fulfilled') setProjectError(`專案摘要無法載入：${errorText(overviewResult.reason)}`);
      })
      .finally(() => { if (current) setProjectBusy(false); });
    return () => { current = false; };
  }, [principal, projectId]);

  const loadTasks = useCallback(async () => {
    if (!projectId) return;
    const sequence = ++taskRequestSequence.current;
    setTasksBusy(true);
    setTasksError('');
    try {
      const result = await api.tasks(projectId, statusFilter, search);
      if (sequence === taskRequestSequence.current) setTasks(result);
    } catch (error) {
      if (sequence === taskRequestSequence.current) setTasksError(errorText(error));
    } finally {
      if (sequence === taskRequestSequence.current) setTasksBusy(false);
    }
  }, [projectId, search, statusFilter]);

  useEffect(() => {
    if (!projectId) return;
    const timer = window.setTimeout(() => { void loadTasks(); }, search ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [loadTasks, projectId, search]);

  useEffect(() => {
    if (!selectedTaskId || !drawerOpen) {
      setTaskContext(null);
      return;
    }
    let current = true;
    setTaskContext(null);
    setTaskContextBusy(true);
    setTaskContextError('');
    api.taskContext(selectedTaskId)
      .then((context) => { if (current) setTaskContext(context); })
      .catch((error) => { if (current) setTaskContextError(errorText(error)); })
      .finally(() => { if (current) setTaskContextBusy(false); });
    return () => { current = false; };
  }, [selectedTaskId, drawerOpen]);

  useEffect(() => {
    if (!projectId || !principal || section !== 'agents') return;
    let current = true;
    setAgentsBusy(true);
    api.agents()
      .then((result) => { if (current) setAgentList(result.filter((agent) => agent.project_ids.includes(projectId))); })
      .catch((error) => { if (current) messageApi.error(errorText(error)); })
      .finally(() => { if (current) setAgentsBusy(false); });
    return () => { current = false; };
  }, [messageApi, principal, projectId, section]);

  useEffect(() => {
    if (!projectId || !principal || section !== 'inbox') return;
    let current = true;
    setInboxBusy(true);
    api.messages(projectId, true)
      .then((result) => { if (current) setInbox(result); })
      .catch((error) => { if (current) messageApi.error(errorText(error)); })
      .finally(() => { if (current) setInboxBusy(false); });
    return () => { current = false; };
  }, [messageApi, principal, projectId, section]);

  useEffect(() => {
    if (!projectId || !principal || section !== 'audit') return;
    let current = true;
    setEventsBusy(true);
    api.events(projectId)
      .then((result) => { if (current) setEvents(result); })
      .catch((error) => { if (current) messageApi.error(errorText(error)); })
      .finally(() => { if (current) setEventsBusy(false); });
    return () => { current = false; };
  }, [messageApi, principal, projectId, section]);

  const reloadTaskContext = useCallback(async (id = selectedTaskId) => {
    if (!id) return;
    const [context] = await Promise.all([
      api.taskContext(id).then((result) => { setTaskContext(result); return result; }),
      loadTasks(),
      projectId ? api.overview(projectId).then(setOverview).catch(() => undefined) : Promise.resolve(),
    ]);
    return context;
  }, [loadTasks, projectId, selectedTaskId]);

  const refreshProjectList = useCallback(async (selectId?: string) => {
    const result = await api.projects();
    setProjects(result);
    if (selectId) setProjectId(selectId);
    else if (!projectId && result[0]) setProjectId(result[0].id);
    return result;
  }, [projectId]);

  function openNewTask() {
    setEditingTask(null);
    taskForm.resetFields();
    taskForm.setFieldsValue({ priority: 'medium', acceptance_criteria: '', labels: [], dependency_ids: [], budget_usd: 0 });
    setTaskModalOpen(true);
  }

  function openEditTask(task: Task) {
    setEditingTask(task);
    taskForm.setFieldsValue({
      ...task,
      acceptance_criteria: task.acceptance_criteria.join('\n'),
      labels: task.labels,
      dependency_ids: task.dependency_ids,
    });
    setTaskModalOpen(true);
  }

  function openTask(task: Task) {
    setSelectedTaskId(task.id);
    setDrawerOpen(true);
  }

  function useExistingPullRequest(result: ExistingPullRequest) {
    operationForm.resetFields();
    operationForm.setFieldsValue({
      summary: `${result.provider} ${result.repository}#${result.number}「${result.title}」目前狀態：${result.state}。查詢來源為既有版控 provider API。`,
      kind: 'url',
      artifact_title: `${result.provider} ${result.repository}#${result.number} · ${result.title}`,
      uri: result.web_url,
      content: [
        `狀態：${result.state}`,
        `來源：${result.source}`,
        `Base：${result.base}`,
        `Head：${result.head}`,
        `Head SHA：${result.head_sha}`,
        result.checks_available
          ? `Provider checks：${result.checks.length ? result.checks.map((check) => `${check.context}: ${check.state}${check.description ? ` (${check.description})` : ''}`).join('\n') : 'provider 未回傳 check 項目。'}`
          : 'Provider 未提供 checks API。',
      ].join('\n'),
    });
    setOperationModal('submit');
  }

  async function saveTask(values: Record<string, unknown>) {
    if (!projectId) return;
    setTaskSaving(true);
    const body = {
      title: values.title,
      description: values.description ?? '',
      goal: values.goal ?? '',
      inputs: values.inputs ?? '',
      scope: values.scope ?? '',
      constraints: values.constraints ?? '',
      acceptance_criteria: splitLines(String(values.acceptance_criteria ?? '')),
      priority: values.priority,
      assignee_id: values.assignee_id || null,
      reviewer_id: values.reviewer_id || null,
      dependency_ids: values.dependency_ids ?? [],
      labels: values.labels ?? [],
      budget_usd: values.budget_usd ?? 0,
    };
    try {
      const saved = editingTask
        ? await api.patch<Task>(`/api/tasks/${encodeURIComponent(editingTask.id)}`, body)
        : await api.post<Task>('/api/tasks', { project_id: projectId, ...body });
      setTaskModalOpen(false);
      await Promise.all([loadTasks(), refreshProjectList()]);
      setSelectedTaskId(saved.id);
      setDrawerOpen(true);
      await reloadTaskContext(saved.id);
      messageApi.success(editingTask ? '任務規格已更新。' : '任務已建立。');
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setTaskSaving(false);
    }
  }

  async function saveProject(values: Record<string, unknown>) {
    if (auth.session?.user.role !== 'admin') {
      setProjectModalOpen(false);
      messageApi.error('只有管理員可以建立專案。');
      return;
    }
    setProjectSaving(true);
    try {
      const created = await api.post<Project>('/api/projects', {
        key: values.key,
        name: values.name,
        description: values.description ?? '',
        team_id: values.team_id || undefined,
        budget_usd: values.budget_usd ?? 0,
      });
      await refreshProjectList(created.id);
      setProjectModalOpen(false);
      projectForm.resetFields();
      messageApi.success('專案已建立。');
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setProjectSaving(false);
    }
  }

  async function claimTask() {
    if (!selectedTask || !principal) return;
    if (principal.kind === 'runtime') {
      messageApi.error('Runtime 身分不可代替 Agent 認領任務。');
      return;
    }
    if (principal.kind === 'human' && !claimAgentId) {
      messageApi.warning('請先選擇要代表的 Agent。');
      return;
    }
    try {
      const result = await api.claim(selectedTask.id, principal.kind === 'human' ? { agent_id: claimAgentId } : {});
      setLeases((current) => ({ ...current, [selectedTask.id]: { execution: result.execution, lease_token: result.lease_token } }));
      await reloadTaskContext(selectedTask.id);
      messageApi.success(`已開始執行 ${selectedTask.key}。`);
    } catch (error) {
      messageApi.error(errorText(error));
    }
  }

  async function runTaskOperation(values: Record<string, unknown>) {
    if (!selectedTask || !lease || !operationModal) return;
    setOperationSaving(true);
    const prefix = `/api/tasks/${encodeURIComponent(selectedTask.id)}`;
    const leaseBody = { execution_id: lease.execution.id, lease_token: lease.lease_token };
    try {
      if (operationModal === 'progress') {
        await api.post<Task>(`${prefix}/progress`, {
          ...leaseBody,
          progress: values.progress,
          summary: values.summary || undefined,
          cost_usd: values.cost_usd === undefined ? undefined : Number(values.cost_usd),
        });
      } else if (operationModal === 'submit') {
        const artifact: Partial<Artifact> = {
          kind: values.kind as Artifact['kind'],
          title: String(values.artifact_title),
          uri: values.uri ? String(values.uri) : null,
          content: values.content ? String(values.content) : null,
        };
        await api.post<TaskContext>(`${prefix}/submit`, {
          ...leaseBody,
          summary: values.summary,
          artifacts: [artifact],
          cost_usd: values.cost_usd === undefined ? 0 : Number(values.cost_usd),
        });
        setLeases((current) => { const next = { ...current }; delete next[selectedTask.id]; return next; });
      } else if (operationModal === 'block') {
        await api.post<Task>(`${prefix}/block`, {
          ...leaseBody,
          reason: values.reason,
          handoff: values.handoff || undefined,
        });
        setLeases((current) => { const next = { ...current }; delete next[selectedTask.id]; return next; });
      } else {
        await api.post<Task>(`${prefix}/release`, { ...leaseBody, handoff: values.handoff });
        setLeases((current) => { const next = { ...current }; delete next[selectedTask.id]; return next; });
      }
      setOperationModal(null);
      operationForm.resetFields();
      await reloadTaskContext(selectedTask.id);
      messageApi.success('執行狀態已更新。');
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setOperationSaving(false);
    }
  }

  async function renewLease() {
    if (!selectedTask || !lease) return;
    try {
      const result = await api.post<ClaimedExecution>(`/api/tasks/${encodeURIComponent(selectedTask.id)}/renew`, {
        execution_id: lease.execution.id,
        lease_token: lease.lease_token,
        lease_seconds: 300,
      });
      setLeases((current) => ({ ...current, [selectedTask.id]: { execution: result.execution, lease_token: result.lease_token } }));
      messageApi.success('執行租約已延長。');
    } catch (error) {
      setLeases((current) => { const next = { ...current }; delete next[selectedTask.id]; return next; });
      messageApi.error(errorText(error));
    }
  }

  async function unblockTask() {
    if (!selectedTask) return;
    try {
      await api.post<Task>(`/api/tasks/${encodeURIComponent(selectedTask.id)}/unblock`, {});
      await reloadTaskContext(selectedTask.id);
      messageApi.success('任務已解除阻塞。');
    } catch (error) {
      messageApi.error(errorText(error));
    }
  }

  async function reviewTask(values: Record<string, unknown>) {
    if (!selectedTask || !reviewDecision) return;
    setReviewSaving(true);
    try {
      const context = await api.post<TaskContext>(`/api/tasks/${encodeURIComponent(selectedTask.id)}/review`, {
        decision: reviewDecision,
        comment: values.comment,
      });
      setTaskContext(context);
      setReviewDecision(null);
      reviewForm.resetFields();
      await loadTasks();
      messageApi.success(reviewDecision === 'accept' ? '審核通過，任務已完成。' : '已退回執行，歷史證據仍保留。');
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setReviewSaving(false);
    }
  }

  async function loadModelCatalog() {
    setModelCatalogLoading(true);
    setModelCatalogError('');
    try {
      setModelCatalog(await api.modelCatalog());
    } catch (error) {
      setModelCatalog(null);
      setModelCatalogError(errorText(error));
    } finally {
      setModelCatalogLoading(false);
    }
  }

  async function loadAgentExecutionOptions() {
    const sequence = ++agentExecutionOptionsSequence.current;
    const requestedProjectId = projectId;
    setAgentExecutionOptionsLoading(true);
    setAgentExecutionOptionsError('');
    setAgentTemplates([]);
    setAgentToolConnections([]);
    setAgentSandboxProfiles([]);
    const results = await Promise.allSettled([api.agentTemplates(), api.toolConnections(projectId), api.sandboxProfiles(projectId)]);
    if (sequence !== agentExecutionOptionsSequence.current || requestedProjectId !== projectId) return;
    const failures: string[] = [];
    if (results[0].status === 'fulfilled') setAgentTemplates(results[0].value);
    else failures.push(`Agent 範本：${errorText(results[0].reason)}`);
    if (results[1].status === 'fulfilled') setAgentToolConnections(results[1].value);
    else failures.push(`工具連線：${errorText(results[1].reason)}`);
    if (results[2].status === 'fulfilled') setAgentSandboxProfiles(results[2].value);
    else failures.push(`Sandbox profiles：${errorText(results[2].reason)}`);
    setAgentExecutionOptionsError(failures.join('；'));
    setAgentExecutionOptionsLoading(false);
  }

  function applyTemplateToAgentForm(template: AgentTemplate) {
    agentForm.setFieldsValue({
      role: template.definition.role,
      runtime: 'pi',
      capabilities: template.definition.capabilities,
      template_id: template.id,
      modelMode: template.definition.model_config ? 'override' : 'inherit',
      model_config: template.definition.model_config ?? undefined,
      execution_config: {
        instructions: template.definition.instructions,
        tool_connection_ids: template.definition.tool_connection_ids,
        sandbox_profile_id: template.definition.sandbox_profile_id,
        limits: template.definition.limits,
      },
    });
  }

  function openNewAgent(template?: AgentTemplate) {
    setEditingAgent(null);
    setNewAgentToken('');
    agentForm.resetFields();
    agentForm.setFieldsValue({
      role: 'worker', capabilities: [], runtime: 'external', modelMode: 'inherit', model: undefined, model_config: undefined, template_id: undefined,
      execution_config: { instructions: '', tool_connection_ids: [], sandbox_profile_id: null, limits: { max_turns: 20, timeout_seconds: 600 } },
    });
    if (template) applyTemplateToAgentForm(template);
    setAgentModalOpen(true);
    void loadModelCatalog();
    void loadAgentExecutionOptions();
  }

  function openEditAgent(agent: Agent) {
    setEditingAgent(agent);
    agentForm.resetFields();
    agentForm.setFieldsValue({
      name: agent.name,
      role: agent.role,
      runtime: agent.runtime,
      model: agent.model,
      modelMode: agent.model_config ? 'override' : 'inherit',
      model_config: agent.model_config ?? undefined,
      capabilities: agent.capabilities,
      team_id: agent.team_id,
      template_id: agent.template_id,
      execution_config: agent.execution_config ?? { instructions: '', tool_connection_ids: [], sandbox_profile_id: null, limits: { max_turns: 20, timeout_seconds: 600 } },
    });
    setAgentModalOpen(true);
    void loadModelCatalog();
    void loadAgentExecutionOptions();
  }

  async function saveAgent(values: Record<string, unknown>) {
    setAgentSaving(true);
    try {
      const executionConfig = values.execution_config as ExecutionConfig;
      const templateId = values.template_id ? String(values.template_id) : null;
      if (editingAgent) {
        const modelConfig = values.runtime === 'pi' && values.modelMode === 'override'
          ? values.model_config as ModelSelection | undefined ?? null
          : null;
        const updated = await api.patch<Agent>(`/api/agents/${encodeURIComponent(editingAgent.id)}`, {
          capabilities: values.capabilities ?? [],
          model: values.model || null,
          model_config: modelConfig,
          template_id: templateId,
          execution_config: executionConfig,
        });
        setAgentList((current) => current.map((agent) => agent.id === updated.id ? updated : agent));
      } else {
        const modelConfig = values.runtime === 'pi' && values.modelMode === 'override'
          ? values.model_config as ModelSelection | undefined ?? null
          : null;
        const result = await api.post<Agent & { token?: string }>('/api/agents', {
          name: values.name,
          role: values.role,
          team_id: values.team_id || undefined,
          capabilities: values.capabilities ?? [],
          project_ids: [projectId],
          runtime: values.runtime,
          model: values.model || null,
          model_config: modelConfig,
          template_id: templateId,
          execution_config: executionConfig,
        });
        setNewAgentToken(result.token ?? '');
        if (projectId) {
          const fresh = await api.agents();
          setAgentList(fresh.filter((agent) => agent.project_ids.includes(projectId)));
        }
      }
      setAgentModalOpen(false);
      setEditingAgent(null);
      agentForm.resetFields();
      messageApi.success(editingAgent ? 'Agent 能力與模型設定已更新。' : 'Agent 已建立。');
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setAgentSaving(false);
    }
  }

  async function disableAgent(agent: Agent) {
    try {
      await api.patch<Agent>(`/api/agents/${encodeURIComponent(agent.id)}`, { status: 'disabled' });
      setAgentList((current) => current.map((entry) => entry.id === agent.id ? { ...entry, status: 'disabled' } : entry));
      messageApi.success(`${agent.name} 已停用。`);
    } catch (error) {
      messageApi.error(errorText(error));
    }
  }

  async function copyNewAgentToken() {
    if (!newAgentToken) return;
    try {
      await navigator.clipboard.writeText(newAgentToken);
      messageApi.success('Agent token 已複製。');
    } catch {
      messageApi.error('瀏覽器無法存取剪貼簿，請在關閉提示前手動複製。');
    }
  }

  async function sendProjectMessage(values: Record<string, unknown>) {
    if (!projectId) return;
    setMessageSaving(true);
    const replyTo = messageModal.replyTo;
    try {
      await api.post<ProjectMessage>('/api/messages', {
        project_id: projectId,
        task_id: messageModal.taskId ?? replyTo?.task_id ?? undefined,
        recipient_id: replyTo ? replyTo.sender_id : values.recipient_id || undefined,
        kind: replyTo ? 'reply' : (values.kind ?? messageModal.kind ?? 'question'),
        body: values.body,
        reply_to_id: replyTo?.id,
      });
      setMessageModal({ open: false });
      messageForm.resetFields();
      messageApi.success(replyTo ? '回覆已送出。' : '訊息已送出。');
      if (section === 'inbox') setInbox(await api.messages(projectId, true));
      if (selectedTaskId && drawerOpen) await reloadTaskContext(selectedTaskId);
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setMessageSaving(false);
    }
  }

  async function acknowledgeMessage(item: ProjectMessage, status: 'accepted' | 'completed') {
    try {
      await api.post<ProjectMessage>(`/api/messages/${encodeURIComponent(item.id)}/ack`, { status });
      setInbox((current) => current.map((entry) => entry.id === item.id ? { ...entry, status } : entry));
      messageApi.success(status === 'accepted' ? '已接收訊息。' : '訊息已標記完成。');
    } catch (error) {
      messageApi.error(errorText(error));
    }
  }

  async function delegateTask(values: Record<string, unknown>) {
    if (!selectedTask) return;
    setDelegateSaving(true);
    try {
      await api.post<Task>(`/api/tasks/${encodeURIComponent(selectedTask.id)}/delegate`, {
        agent_id: values.agent_id,
        title: values.title,
        goal: values.goal,
        description: values.description ?? '',
        inputs: values.inputs ?? '',
        scope: values.scope ?? '',
        constraints: values.constraints ?? '',
        acceptance_criteria: splitLines(String(values.acceptance_criteria ?? '')),
        priority: values.priority ?? 'medium',
        budget_usd: values.budget_usd ?? 0,
      });
      setDelegateOpen(false);
      delegateForm.resetFields();
      await reloadTaskContext(selectedTask.id);
      messageApi.success('子任務已委派。');
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setDelegateSaving(false);
    }
  }

  const taskColumns: ColumnsType<Task> = useMemo(() => [
    {
      title: '任務',
      dataIndex: 'title',
      key: 'title',
      render: (_: unknown, task) => (
        <div className="task-title-cell">
          <span className="task-key">{task.key}</span>
          <span className="task-title">{task.title}</span>
          {task.labels?.length > 0 && <span className="task-label-preview">{task.labels.slice(0, 2).join(' · ')}</span>}
        </div>
      ),
    },
    {
      title: '狀態',
      dataIndex: 'status',
      key: 'status',
      width: 112,
      render: (value: TaskStatus) => taskStatusTag(value),
    },
    {
      title: '優先級',
      dataIndex: 'priority',
      key: 'priority',
      width: 88,
      render: (value: string) => <Tag color={priorityColor[value] ?? 'default'}>{priorityLabel[value] ?? value}</Tag>,
    },
    {
      title: '負責 Agent',
      dataIndex: 'assignee_id',
      key: 'assignee',
      width: 140,
      render: (value: string | null) => <span className="muted-cell">{nameFor(value, people)}</span>,
    },
    {
      title: '進度',
      dataIndex: 'progress',
      key: 'progress',
      width: 118,
      render: (value: number) => (
        <div className="progress-cell"><Progress percent={Math.max(0, Math.min(100, value ?? 0))} size="small" showInfo={false} /><span>{value ?? 0}%</span></div>
      ),
    },
    {
      title: '更新',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 110,
      render: (value: string) => <span className="muted-cell">{displayDate(value)}</span>,
    },
  ], [people]);

  const agentColumns: ColumnsType<Agent> = [
    {
      title: 'Agent',
      dataIndex: 'name',
      key: 'name',
      render: (_: unknown, agent) => (
        <div className="agent-identity"><Avatar size={30} className="agent-avatar">{agent.name.slice(0, 1).toUpperCase()}</Avatar><div><strong>{agent.name}</strong><div className="subline">{agent.role === 'reviewer' ? '審核者' : '執行者'} · {agent.runtime === 'pi' ? 'Pi runtime' : 'External runtime'}</div></div></div>
      ),
    },
    { title: '能力', dataIndex: 'capabilities', key: 'capabilities', render: (items: string[]) => <span>{items?.length ? items.join(' · ') : '未設定'}</span> },
    {
      title: '模型',
      dataIndex: 'effective_model_config',
      key: 'model',
      render: (_: Agent['effective_model_config'], agent) => {
        if (agent.runtime !== 'pi') return agent.model || '未指定';
        const selection = agent.effective_model_config ?? agent.model_config;
        if (selection) {
          return <span>{selection.model_id}<div className="subline">{selection.provider_id} · {selection.reasoning_effort} · {selection.max_output_tokens.toLocaleString()} tokens</div></span>;
        }
        return agent.runtime === 'pi' ? '繼承全域預設（尚未設定）' : agent.model || '未指定';
      },
    },
    { title: '狀態', dataIndex: 'status', key: 'status', width: 110, render: (value: Agent['status']) => <Tag color={value === 'available' ? 'green' : value === 'busy' ? 'blue' : value === 'disabled' ? 'default' : 'gold'}>{({ available: '可用', busy: '執行中', offline: '離線', disabled: '已停用' })[value]}</Tag> },
    {
      title: '',
      key: 'actions',
        width: 160,
        render: (_: unknown, agent) => (
          <Space><Button size="small" icon={<EditOutlined />} disabled={!canManageAgents} onClick={() => openEditAgent(agent)} aria-label={`編輯 ${agent.name}`}>編輯</Button><Button size="small" icon={<LockOutlined />} disabled={!canManageAgents || agent.status === 'disabled'} onClick={() => void disableAgent(agent)} aria-label={`停用 ${agent.name}`}>停用</Button></Space>
        ),
    },
  ];

  const inboxColumns: ColumnsType<ProjectMessage> = [
    { title: '訊息', dataIndex: 'body', key: 'body', render: (body: string, item) => <div className="message-cell"><Tag>{({ question: '問題', reply: '回覆', help_request: '求助', decision: '決議', handoff: '交接' })[item.kind]}</Tag><span>{body}</span>{item.task_id && <span className="subline">任務 {tasks.find((task) => task.id === item.task_id)?.key ?? item.task_id.slice(0, 8)}</span>}</div> },
    { title: '寄件者', dataIndex: 'sender_id', key: 'sender_id', width: 150, render: (id: string) => nameFor(id, people, principal) },
    { title: '狀態', dataIndex: 'status', key: 'status', width: 100, render: (value: ProjectMessage['status']) => <Tag color={value === 'completed' ? 'green' : value === 'accepted' ? 'blue' : 'default'}>{({ delivered: '待處理', accepted: '已接收', completed: '已完成' })[value]}</Tag> },
    { title: '時間', dataIndex: 'created_at', key: 'created_at', width: 118, render: (value: string) => displayDate(value) },
    { title: '', key: 'actions', width: 230, render: (_: unknown, item) => <Space wrap><Button size="small" icon={<SendOutlined />} onClick={() => { messageForm.resetFields(); setMessageModal({ open: true, replyTo: item }); }}>回覆</Button>{item.status !== 'accepted' && item.status !== 'completed' && <Button size="small" onClick={() => void acknowledgeMessage(item, 'accepted')}>接收</Button>}{item.status !== 'completed' && <Button size="small" onClick={() => void acknowledgeMessage(item, 'completed')}>完成</Button>}</Space> },
  ];

  if (!auth.session) return <>{messageContext}<AuthScreen product="work" productName="Ordivant Work" /></>;
  if (authBusy || principalSessionKey !== auth.session.csrf_token) return <>{messageContext}<div className="auth-loading"><Spin size="large" /><Text>正在確認 Work 存取權</Text></div></>;
  if (!principal) return <>{messageContext}<AuthAccessDenied product="work" productName="Work" error={principalError} forbidden={principalErrorStatus === 403} onRetry={() => window.location.reload()} /></>;

  const navSections: Array<{ id: Section; icon: React.ReactNode; label: string; count?: number }> = [
    { id: 'tasks', icon: <UnorderedListOutlined />, label: '任務' },
    { id: 'runs', icon: <PlayCircleOutlined />, label: 'Run 執行' },
    { id: 'automation', icon: <BranchesOutlined />, label: '自動化' },
    { id: 'tools', icon: <ToolOutlined />, label: '工具與沙箱' },
    { id: 'overview', icon: <AppstoreOutlined />, label: '專案總覽' },
    { id: 'agents', icon: <TeamOutlined />, label: 'Agent 名錄' },
    { id: 'inbox', icon: <InboxOutlined />, label: '協作收件匣', count: inbox.filter((item) => item.status === 'delivered').length },
    { id: 'audit', icon: <AuditOutlined />, label: '操作稽核' },
  ];
  if (auth.session.user.role === 'admin') navSections.push({ id: 'model-settings', icon: <SettingOutlined />, label: '模型連線' });

  return (
    <div className="app-shell">
      {messageContext}
      <aside className="side-rail">
        <div className="side-brand"><span className="brand-mark">O</span><div><strong>Ordivant</strong><span>Agent operations</span></div></div>
        <ProductSwitcher active="work" />
        <div className="rail-label">工作區</div>
        <div className="rail-nav" role="navigation" aria-label="主要導覽">
          {navSections.map((item) => <NavItem key={item.id} active={section === item.id} icon={item.icon} label={item.label} count={item.id === 'inbox' ? undefined : item.count} onClick={() => setSection(item.id)} />)}
        </div>
        <div className="rail-bottom">
          <div className="workspace-identity"><Avatar size={28}>{principal.name.slice(0, 1).toUpperCase()}</Avatar><div className="workspace-user"><strong>{principal.name}</strong><span>{principal.role}</span></div><AccountControl product="work" productLabel="Ordivant Work" displayName={principal.name} businessRole={principal.role} /></div>
          <div className="rail-service"><span className={`health-dot ${health === 'ok' ? 'health-good' : health === 'error' ? 'health-bad' : ''}`} />{health === 'ok' ? 'API 已連線' : health === 'error' ? 'API 連線中斷' : '檢查服務中'}</div>
        </div>
      </aside>

      <main className="main-pane">
        <header className="topbar">
          <div className="topbar-project">
            <span className="project-caption">專案</span>
            <Select
              aria-label="選擇專案"
              value={projectId || undefined}
              placeholder="選擇專案"
              options={projects.map((project) => ({ value: project.id, label: <span><b>{project.key}</b><span className="project-option-name">{project.name}</span></span> }))}
              onChange={(value) => {
                if (value !== projectId) agentExecutionOptionsSequence.current += 1;
                setProjectId(value);
                setSelectedTaskId('');
                setDrawerOpen(false);
              }}
              className="project-select"
              popupMatchSelectWidth={false}
              notFoundContent="尚無可存取的專案"
            />
            {canCreateProject && <Button icon={<PlusOutlined />} onClick={() => setProjectModalOpen(true)} aria-label="建立專案" title="建立專案" />}
          </div>
          <div className="topbar-right">
            <Tag bordered={false} color={apiMode === 'production' ? 'green' : 'purple'}>{apiMode === 'production' ? 'PROD' : apiMode === 'development' ? 'DEV' : 'API'}</Tag>
            <Tooltip title="重新整理工作資料"><Button type="text" icon={<ReloadOutlined />} onClick={() => { void loadTasks(); if (projectId) api.overview(projectId).then(setOverview).catch((error) => messageApi.error(errorText(error))); }} aria-label="重新整理" /></Tooltip>
            <span className="topbar-date">{new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}</span>
          </div>
        </header>

        <div className="workspace-content">
          {projectError && <Alert className="page-alert" type="error" showIcon message="專案資料無法載入" description={projectError} action={<Button size="small" onClick={() => { if (projectId) { setProjectId(''); window.setTimeout(() => setProjectId(projectId), 0); } }}>重試</Button>} />}
          {!projectId && section !== 'model-settings' ? (
            <div className="empty-project"><div className="empty-icon"><AppstoreOutlined /></div><Title level={3}>{canCreateProject ? '建立第一個專案' : '目前沒有可存取的專案'}</Title><Paragraph>{canCreateProject ? '目前帳號沒有可用專案。建立專案後即可新增任務、邀請 Agent 並追蹤執行證據。' : '請聯絡管理員授予專案存取權，或由管理員建立新專案。'}</Paragraph>{canCreateProject && <Button type="primary" icon={<PlusOutlined />} onClick={() => setProjectModalOpen(true)}>建立專案</Button>}</div>
          ) : (
            <>
              <div className="page-heading">
                <div><Text className="eyebrow">{section === 'model-settings' ? 'ORGANIZATION SETTINGS' : `${currentProject?.key ?? 'PROJECT'} · ${currentProject?.name ?? '專案'}`}</Text><Title level={2}>{sectionNames[section]}</Title></div>
                {section === 'tasks' && <Button type="primary" icon={<PlusOutlined />} onClick={openNewTask}>新增任務</Button>}
                {section === 'agents' && canManageAgents && <Button type="primary" icon={<UserAddOutlined />} onClick={() => openNewAgent()}>新增 Agent</Button>}
                {section === 'inbox' && <Button type="primary" icon={<SendOutlined />} onClick={() => { messageForm.resetFields(); setMessageModal({ open: true }); }}>傳送訊息</Button>}
              </div>

              {section === 'tasks' && (
                <>
                  <section className="metric-strip" aria-label="專案任務摘要">
                    <Metric label="全部任務" value={overview?.counts.total} loading={projectBusy} />
                    <Metric label="待執行" value={overview?.counts.ready} loading={projectBusy} />
                    <Metric label="進行中" value={overview?.counts.in_progress} loading={projectBusy} />
                    <Metric label="待審核" value={overview?.counts.in_review} loading={projectBusy} />
                    <Metric label="已完成" value={overview?.counts.done} loading={projectBusy} />
                    <div className="metric-cost"><span>執行成本彙總</span><strong>{overview ? money(overview.cost_usd) : '—'}</strong><small>成本來源依執行紀錄標示</small></div>
                  </section>
                  <div className="task-toolbar">
                    <Input allowClear prefix={<FileSearchOutlined />} placeholder="搜尋任務名稱或內容" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="搜尋任務" />
                    <Select aria-label="依狀態篩選" value={statusFilter} onChange={setStatusFilter} options={[{ value: '', label: '全部狀態' }, ...Object.entries(statusLabel).map(([value, label]) => ({ value, label }))]} />
                    <span className="result-count">{tasksBusy ? '載入中' : `${tasks.length} 個任務`}</span>
                  </div>
                  {tasksError && <Alert type="error" showIcon message="任務清單無法載入" description={tasksError} action={<Button size="small" onClick={() => void loadTasks()}>重試</Button>} />}
                  <div className="task-list-shell">
                    <Table<Task>
                      rowKey="id"
                      size="middle"
                      columns={taskColumns}
                      dataSource={tasks}
                      loading={tasksBusy}
                      pagination={{ pageSize: 12, showSizeChanger: false, showTotal: (total) => `共 ${total} 個任務` }}
                      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search || statusFilter ? '沒有符合條件的任務' : '尚無任務'}>{!search && !statusFilter && <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openNewTask}>建立任務</Button>}</Empty> }}
                      onRow={(task) => ({ onClick: () => openTask(task), tabIndex: 0, onKeyDown: (event) => { if (event.key === 'Enter') openTask(task); }, 'aria-label': `檢視 ${task.key} ${task.title}` })}
                      rowClassName={(task) => task.id === selectedTaskId ? 'task-row-selected' : 'task-row'}
                      scroll={{ x: 780 }}
                    />
                  </div>
                </>
              )}

              {section === 'overview' && <OverviewView overview={overview} loading={projectBusy} project={currentProject} events={overview?.activity ?? []} agents={projectContext?.agents ?? []} onSelectTask={() => setSection('tasks')} />}

              {section === 'runs' && <RunConsole key={projectId} projectId={projectId} canControl={canManageAgents} />}

              {section === 'automation' && <Automation key={projectId} projectId={projectId} canManage={canManageAgents} agents={people} onApplyTemplate={(template) => { setSection('agents'); openNewAgent(template); }} />}

              {section === 'tools' && <ToolSettings key={projectId} projectId={projectId} canAdmin={auth.session.user.role === 'admin'} />}

              {section === 'model-settings' && auth.session.user.role === 'admin' && <ModelSettings />}

              {section === 'agents' && (
                <section className="table-section">
                  <div className="section-tools"><span>{agentsBusy ? '正在載入' : `${agentList.length} 位 Agent`}</span><span>能力與模型設定來自 Ordivant API</span></div>
                  {newAgentToken && <Alert className="token-alert" type="warning" showIcon closable onClose={() => setNewAgentToken('')} message="Agent 憑證只會顯示一次" description={<div className="token-value"><code>{newAgentToken}</code><Space wrap><Button size="small" icon={<CopyOutlined />} onClick={() => void copyNewAgentToken()}>複製 token</Button><Text>若為本機開發，請將憑證設在該 Agent 專用 runtime 環境；不要提交至版本控制或寫入日誌。關閉提示後無法再次查看。</Text></Space></div>} />}
                  <Table<Agent> rowKey="id" columns={agentColumns} dataSource={agentList} loading={agentsBusy} pagination={{ pageSize: 15, showSizeChanger: false }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="此專案尚無 Agent" /> }} scroll={{ x: 720 }} />
                </section>
              )}

              {section === 'inbox' && (
                <section className="table-section">
                  <div className="section-tools"><span>{inboxBusy ? '正在載入' : `${inbox.length} 則收件訊息`}</span><span>僅顯示寄送至目前身分的訊息</span></div>
                  <Table<ProjectMessage> rowKey="id" columns={inboxColumns} dataSource={inbox} loading={inboxBusy} pagination={{ pageSize: 12, showSizeChanger: false }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="收件匣目前沒有訊息" /> }} scroll={{ x: 920 }} />
                </section>
              )}

              {section === 'audit' && (
                <section className="audit-list">
                  <div className="section-tools"><span>{eventsBusy ? '正在載入' : `最近 ${events.length} 筆操作`}</span><span>稽核資料由服務端記錄</span></div>
                  {eventsBusy && <Skeleton active />}
                  {!eventsBusy && events.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="目前沒有稽核事件" />}
                  {events.map((event) => <AuditRow key={event.id} event={event} actor={nameFor(event.actor_id, people, principal)} />)}
                </section>
              )}
            </>
          )}
        </div>
      </main>

      <Drawer
        title={<div className="drawer-title"><div><span className="task-key">{selectedTask?.key ?? 'TASK'}</span><Title level={4}>{selectedTask?.title ?? '任務詳情'}</Title></div>{selectedTask && taskStatusTag(selectedTask.status)}</div>}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={620}
        className="task-drawer"
        destroyOnClose={false}
      >
        {taskContextError && <Alert type="error" showIcon message="任務脈絡無法載入" description={taskContextError} action={<Button size="small" onClick={() => void reloadTaskContext()}>重試</Button>} />}
        {taskContextBusy && !taskContext && <Skeleton active paragraph={{ rows: 8 }} />}
        {selectedTask && (
          <>
            <div className="drawer-actions">
              <Button icon={<EditOutlined />} onClick={() => openEditTask(selectedTask)}>編輯規格</Button>
              <Button icon={<SendOutlined />} onClick={() => { messageForm.resetFields(); setMessageModal({ open: true, taskId: selectedTask.id, kind: 'help_request' }); }}>請求協作</Button>
              <Button icon={<CodeOutlined />} onClick={() => { delegateForm.resetFields(); delegateForm.setFieldsValue({ priority: 'medium', acceptance_criteria: '', budget_usd: 0 }); setDelegateOpen(true); }}>委派子任務</Button>
            </div>
            <div className="claim-bar">
              {principal.kind === 'human' && <Select aria-label="選擇代執行 Agent" placeholder="選擇執行 Agent" value={claimAgentId} onChange={setClaimAgentId} options={people.filter((agent) => agent.status === 'available' && agent.role === 'worker').map((agent) => ({ value: agent.id, label: agent.name }))} className="claim-agent-select" />}
              {principal.kind !== 'runtime' && !lease && selectedTask.status === 'ready' && <Button type="primary" icon={<CheckOutlined />} onClick={() => void claimTask()} disabled={principal.kind === 'human' && !claimAgentId}>認領任務</Button>}
              {lease && <Tag color="green" icon={<CheckCircleOutlined />}>目前工作階段持有執行租約</Tag>}
              {selectedTask.status === 'blocked' && ['admin', 'manager'].includes(principal.role) && <Button type="primary" onClick={() => void unblockTask()}>解除阻塞</Button>}
            </div>
            {lease && (
              <div className="lease-panel">
                <div className="lease-heading"><span><ClockCircleOutlined /> 執行控制</span><span>到期 {displayDate(lease.execution.lease_expires_at)}</span></div>
                <Progress percent={selectedTask.progress ?? lease.execution.progress ?? 0} size="small" />
                <Space wrap>
                  <Button size="small" icon={<ReloadOutlined />} onClick={() => void renewLease()}>延長租約</Button>
                  <Button size="small" onClick={() => { operationForm.resetFields(); operationForm.setFieldsValue({ progress: selectedTask.progress, summary: lease.execution.summary ?? '' }); setOperationModal('progress'); }}>回報進度</Button>
                  <Button size="small" onClick={() => { operationForm.resetFields(); operationForm.setFieldsValue({ kind: 'summary', artifact_title: `${selectedTask.key} 執行摘要` }); setOperationModal('submit'); }}>提交成果</Button>
                  <Button size="small" onClick={() => { operationForm.resetFields(); setOperationModal('release'); }}>交接並釋出</Button>
                  <Button size="small" danger onClick={() => { operationForm.resetFields(); setOperationModal('block'); }}>標記受阻</Button>
                </Space>
                <Text className="lease-footnote">執行租約與 fencing token 僅保留在此分頁記憶體。重新整理後需重新認領。</Text>
              </div>
            )}
            <Tabs
              className="detail-tabs"
              items={[
                {
                  key: 'spec', label: '規格', children: taskContextBusy && !taskContext ? <Spin /> : <TaskSpecification task={selectedTask} context={taskContext} agents={people} />,
                },
                {
                  key: 'execution', label: '執行與審核', children: <ExecutionReview context={taskContext} agents={people} canReview={canReview} projectId={selectedTask.project_id} hasLease={Boolean(lease)} onUsePullRequest={useExistingPullRequest} onReview={(decision) => { reviewForm.resetFields(); setReviewDecision(decision); }} />,
                },
                {
                  key: 'collaboration', label: `協作${taskContext?.messages.length ? ` (${taskContext.messages.length})` : ''}`, children: <TaskCollaboration context={taskContext} people={people} principal={principal} onReply={(item) => { messageForm.resetFields(); setMessageModal({ open: true, replyTo: item }); }} />,
                },
                {
                  key: 'history', label: '事件', children: <div className="compact-event-list">{taskContext?.events.map((event) => <AuditRow key={event.id} event={event} actor={nameFor(event.actor_id, people, principal)} />) ?? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚無事件" />}</div>,
                },
              ]}
            />
          </>
        )}
      </Drawer>

      <Modal title={editingTask ? '編輯任務規格' : '建立任務'} open={taskModalOpen} onCancel={() => setTaskModalOpen(false)} onOk={() => taskForm.submit()} confirmLoading={taskSaving} okText={editingTask ? '儲存變更' : '建立任務'} cancelText="取消" width={760} destroyOnClose>
        <Form form={taskForm} layout="vertical" onFinish={(values) => void saveTask(values)} className="form-grid">
          <Form.Item name="title" label="任務名稱" rules={[{ required: true, message: '請輸入任務名稱' }]}><Input maxLength={180} /></Form.Item>
          <Form.Item name="priority" label="優先級" rules={[{ required: true }]}><Select options={[{ value: 'urgent', label: '緊急' }, { value: 'high', label: '高' }, { value: 'medium', label: '一般' }, { value: 'low', label: '低' }]} /></Form.Item>
          <Form.Item name="description" label="描述" className="form-span"><TextArea rows={2} /></Form.Item>
          <Form.Item name="goal" label="目標"><TextArea rows={2} /></Form.Item>
          <Form.Item name="inputs" label="輸入資料"><TextArea rows={2} /></Form.Item>
          <Form.Item name="scope" label="範圍"><TextArea rows={2} /></Form.Item>
          <Form.Item name="constraints" label="限制條件"><TextArea rows={2} /></Form.Item>
          <Form.Item name="acceptance_criteria" label="驗收條件" className="form-span" extra="每行一項"><TextArea rows={3} /></Form.Item>
          <Form.Item name="assignee_id" label="負責 Agent"><Select allowClear placeholder="未指派" options={people.filter((agent) => agent.role === 'worker').map((agent) => ({ value: agent.id, label: agent.name }))} /></Form.Item>
          <Form.Item name="reviewer_id" label="指定審核者"><Select allowClear placeholder="未指定" options={people.filter((agent) => agent.role === 'reviewer').map((agent) => ({ value: agent.id, label: agent.name }))} /></Form.Item>
          <Form.Item name="dependency_ids" label="相依任務" className="form-span"><Select mode="multiple" placeholder="選擇必須先完成的任務" options={tasks.filter((task) => task.id !== editingTask?.id).map((task) => ({ value: task.id, label: `${task.key} · ${task.title}` }))} /></Form.Item>
          <Form.Item name="labels" label="標籤"><Select mode="tags" tokenSeparators={[',']} placeholder="輸入後按 Enter" /></Form.Item>
          <Form.Item name="budget_usd" label="預算上限 (USD)"><InputNumber min={0} precision={2} className="full-width" /></Form.Item>
          {!editingTask && <div className="form-note form-span">新任務會依服務端預設進入待執行狀態。狀態轉換由受保護的工作流程操作管理。</div>}
        </Form>
      </Modal>

      {canCreateProject && <Modal title="建立專案" open={projectModalOpen} onCancel={() => setProjectModalOpen(false)} onOk={() => projectForm.submit()} confirmLoading={projectSaving} okText="建立專案" cancelText="取消" destroyOnClose>
        <Form form={projectForm} layout="vertical" onFinish={(values) => void saveProject(values)}>
          <Form.Item name="key" label="專案代碼" rules={[{ required: true, message: '請輸入專案代碼' }]}><Input maxLength={12} placeholder="例如 ORD" /></Form.Item>
          <Form.Item name="name" label="專案名稱" rules={[{ required: true, message: '請輸入專案名稱' }]}><Input maxLength={120} /></Form.Item>
          <Form.Item name="description" label="描述"><TextArea rows={3} /></Form.Item>
          <Form.Item name="team_id" label="Team ID"><Input /></Form.Item>
          <Form.Item name="budget_usd" label="預算上限 (USD)"><InputNumber min={0} precision={2} className="full-width" /></Form.Item>
        </Form>
      </Modal>}

      <Modal className="agent-execution-modal" title={editingAgent ? `編輯 Agent · ${editingAgent.name}` : '新增 Agent'} open={agentModalOpen} onCancel={() => { setAgentModalOpen(false); setEditingAgent(null); }} onOk={() => agentForm.submit()} confirmLoading={agentSaving} okButtonProps={{ disabled: agentRuntime === 'pi' && agentModelMode === 'override' && (modelCatalogLoading || Boolean(modelCatalogError)) }} okText={editingAgent ? '儲存變更' : '建立 Agent'} cancelText="取消" width={760} destroyOnClose>
        <Form form={agentForm} layout="vertical" onFinish={(values) => void saveAgent(values)}>
          <Form.Item name="name" label="名稱" rules={[{ required: true }]}><Input maxLength={100} disabled={Boolean(editingAgent)} /></Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}><Select disabled={Boolean(editingAgent)} options={[{ value: 'worker', label: '執行者' }, { value: 'reviewer', label: '審核者' }]} /></Form.Item>
          <Form.Item name="runtime" label="Runtime" rules={[{ required: true }]}><Select disabled={Boolean(editingAgent)} options={[{ value: 'external', label: 'External' }, { value: 'pi', label: 'Pi Durable' }]} /></Form.Item>
          {agentExecutionOptionsError && <Alert className="agent-execution-alert" type="error" showIcon message="範本或執行資源無法完整載入" description={agentExecutionOptionsError} action={<Button size="small" loading={agentExecutionOptionsLoading} onClick={() => void loadAgentExecutionOptions()}>重試</Button>} />}
          <Form.Item name="template_id" label="Agent 範本版本" extra="選擇後會套用此不可變版本；可再調整執行設定。">
            <Select
              allowClear
              loading={agentExecutionOptionsLoading}
              placeholder="不套用範本"
              options={agentTemplates.filter((template) => !editingAgent || template.definition.role === editingAgent.role).map((template) => ({ value: template.id, label: `${template.key} · v${template.version} · ${template.name}` }))}
              onChange={(templateId: string | undefined) => {
                if (!templateId) {
                  agentForm.setFieldValue('template_id', undefined);
                  return;
                }
                const template = agentTemplates.find((item) => item.id === templateId);
                if (template) applyTemplateToAgentForm(template);
              }}
            />
          </Form.Item>
          <AgentModelConfigFields
            form={agentForm}
            catalog={modelCatalog}
            catalogLoading={modelCatalogLoading}
            catalogError={modelCatalogError}
            agent={editingAgent}
            onRetry={() => void loadModelCatalog()}
          />
          <Form.Item name="capabilities" label="能力標籤"><Select mode="tags" tokenSeparators={[',']} placeholder="例如 frontend, testing" /></Form.Item>
          <div className="agent-execution-fields">
            <div className="agent-execution-heading"><strong>Pi 執行設定</strong><Text type="secondary">套用於新 Run；已建立的 Run 保留當時快照。</Text></div>
            <Form.Item name={['execution_config', 'instructions']} label="Agent 指令"><TextArea rows={4} maxLength={16000} showCount /></Form.Item>
            <div className="agent-execution-grid">
              <Form.Item name={['execution_config', 'tool_connection_ids']} label="可用工具連線" rules={[{ validator: async (_, value: string[]) => { if ((value?.length ?? 0) > 30) throw new Error('工具連線最多 30 個'); } }]}><Select mode="multiple" maxCount={30} allowClear placeholder="不綁定外部連線" options={agentToolConnections.map((connection) => ({ value: connection.id, label: `${connection.name}${connection.enabled ? '' : ' · 已停用'}`, disabled: !connection.enabled }))} /></Form.Item>
              <Form.Item name={['execution_config', 'sandbox_profile_id']} label="Sandbox profile"><Select allowClear placeholder="不使用 Sandbox" options={agentSandboxProfiles.map((profile) => ({ value: profile.id, label: `${profile.name}${profile.enabled ? '' : ' · 已停用'}`, disabled: !profile.enabled }))} /></Form.Item>
              <Form.Item name={['execution_config', 'limits', 'max_turns']} label="最多模型回合" rules={[{ required: true, type: 'number', min: 1, max: 100 }]}><InputNumber className="full-width" min={1} max={100} precision={0} /></Form.Item>
              <Form.Item name={['execution_config', 'limits', 'timeout_seconds']} label="執行逾時（秒）" rules={[{ required: true, type: 'number', min: 30, max: 3600 }]}><InputNumber className="full-width" min={30} max={3600} precision={0} /></Form.Item>
            </div>
          </div>
          <Form.Item name="team_id" label="Team ID"><Input disabled={Boolean(editingAgent)} /></Form.Item>
        </Form>
      </Modal>

      <Modal title={messageModal.replyTo ? '回覆訊息' : messageModal.kind === 'help_request' ? '請求協作' : '傳送訊息'} open={messageModal.open} onCancel={() => setMessageModal({ open: false })} onOk={() => messageForm.submit()} confirmLoading={messageSaving} okText="送出" cancelText="取消" destroyOnClose>
        <Form form={messageForm} layout="vertical" onFinish={(values) => void sendProjectMessage(values)}>
          <Form.Item label="專案">{currentProject ? `${currentProject.key} · ${currentProject.name}` : '—'}</Form.Item>
          {messageModal.replyTo && <Form.Item label="回覆對象">{nameFor(messageModal.replyTo.sender_id, people, principal)}</Form.Item>}
          {!messageModal.replyTo && <>
            <Form.Item name="recipient_id" label="收件 Agent" rules={messageModal.kind === 'help_request' ? [{ required: true, message: '請選擇要求協作的 Agent' }] : []}><Select allowClear placeholder="專案訊息（不指定收件者）" options={people.map((agent) => ({ value: agent.principal_id ?? agent.id, label: agent.name }))} /></Form.Item>
            <Form.Item name="kind" label="訊息類型" initialValue={messageModal.kind ?? 'question'}><Select options={[{ value: 'question', label: '問題' }, { value: 'help_request', label: '求助' }, { value: 'decision', label: '決議' }, { value: 'handoff', label: '交接' }]} /></Form.Item>
          </>}
          <Form.Item name="body" label="訊息內容" rules={[{ required: true, whitespace: true, message: '請輸入訊息內容' }]}><TextArea rows={5} maxLength={5000} showCount /></Form.Item>
        </Form>
      </Modal>

      <Modal title="委派子任務" open={delegateOpen} onCancel={() => setDelegateOpen(false)} onOk={() => delegateForm.submit()} confirmLoading={delegateSaving} okText="委派任務" cancelText="取消" destroyOnClose>
        <Form form={delegateForm} layout="vertical" onFinish={(values) => void delegateTask(values)}>
          <Form.Item name="agent_id" label="負責 Agent" rules={[{ required: true }]}><Select options={people.filter((agent) => agent.role === 'worker' && agent.status !== 'disabled').map((agent) => ({ value: agent.id, label: `${agent.name} · ${agent.status === 'available' ? '可用' : agent.status}` }))} /></Form.Item>
          <Form.Item name="title" label="子任務名稱" rules={[{ required: true }]}><Input maxLength={180} /></Form.Item>
          <Form.Item name="goal" label="交付目標" rules={[{ required: true }]}><TextArea rows={2} /></Form.Item>
          <Form.Item name="description" label="描述"><TextArea rows={2} /></Form.Item>
          <Form.Item name="scope" label="範圍"><TextArea rows={2} /></Form.Item>
          <Form.Item name="inputs" label="輸入資料"><TextArea rows={2} /></Form.Item>
          <Form.Item name="constraints" label="限制條件"><TextArea rows={2} /></Form.Item>
          <Form.Item name="acceptance_criteria" label="驗收條件" extra="每行一項"><TextArea rows={3} /></Form.Item>
          <Form.Item name="priority" label="優先級"><Select options={[{ value: 'urgent', label: '緊急' }, { value: 'high', label: '高' }, { value: 'medium', label: '一般' }, { value: 'low', label: '低' }]} /></Form.Item>
          <Form.Item name="budget_usd" label="預算上限 (USD)"><InputNumber min={0} precision={2} className="full-width" /></Form.Item>
        </Form>
      </Modal>

      <Modal title={operationTitle(operationModal)} open={operationModal !== null} onCancel={() => setOperationModal(null)} onOk={() => operationForm.submit()} confirmLoading={operationSaving} okText="送出" cancelText="取消" destroyOnClose>
        <Form form={operationForm} layout="vertical" onFinish={(values) => void runTaskOperation(values)}>
          {operationModal === 'progress' && <>
            <Form.Item name="progress" label="完成進度" rules={[{ required: true }]}><InputNumber min={0} max={99} addonAfter="%" className="full-width" /></Form.Item>
            <Form.Item name="summary" label="執行摘要"><TextArea rows={3} /></Form.Item>
            <Form.Item name="cost_usd" label="自陳成本 (USD)"><InputNumber min={0} precision={4} className="full-width" /></Form.Item>
          </>}
          {operationModal === 'submit' && <>
            <Form.Item name="summary" label="完成摘要" rules={[{ required: true, whitespace: true }]}><TextArea rows={4} /></Form.Item>
            <Divider orientation="left" plain>驗收證據</Divider>
            <Form.Item name="kind" label="證據類型" rules={[{ required: true }]}><Select options={[{ value: 'summary', label: '摘要' }, { value: 'document', label: '文件' }, { value: 'url', label: '網址' }, { value: 'test_report', label: '測試報告' }, { value: 'file', label: '檔案' }]} /></Form.Item>
            <Form.Item name="artifact_title" label="證據標題" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="uri" label="URI"><Input prefix={<LinkOutlined />} placeholder="可選" /></Form.Item>
            <Form.Item name="content" label="證據內容"><TextArea rows={3} /></Form.Item>
            <Form.Item name="cost_usd" label="自陳成本 (USD)"><InputNumber min={0} precision={4} className="full-width" /></Form.Item>
            <div className="form-note">成本為執行者回報，不代表已驗證的付費模型用量。</div>
          </>}
          {operationModal === 'block' && <>
            <Form.Item name="reason" label="阻塞原因" rules={[{ required: true, whitespace: true }]}><TextArea rows={3} /></Form.Item>
            <Form.Item name="handoff" label="交接資訊"><TextArea rows={3} /></Form.Item>
          </>}
          {operationModal === 'release' && <Form.Item name="handoff" label="交接資訊" rules={[{ required: true, whitespace: true }]}><TextArea rows={4} /></Form.Item>}
        </Form>
      </Modal>

      <Modal title={reviewDecision === 'accept' ? '通過審核' : '退回任務'} open={reviewDecision !== null} onCancel={() => setReviewDecision(null)} onOk={() => reviewForm.submit()} confirmLoading={reviewSaving} okText={reviewDecision === 'accept' ? '確認通過' : '確認退回'} cancelText="取消" destroyOnClose>
        <Form form={reviewForm} layout="vertical" onFinish={(values) => void reviewTask(values)}>
          <Alert className="review-separation-note" type="info" showIcon message="獨立審核" description="審核決定由服務端檢查角色、指定審核者與執行者分離。" />
          <Form.Item name="comment" label="審核意見" rules={[{ required: true, whitespace: true, message: '請填寫審核意見' }]}><TextArea rows={4} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function Metric({ label, value, loading }: { label: string; value?: number; loading: boolean }) {
  return <div className="metric-item"><span>{label}</span>{loading ? <Skeleton.Input active size="small" /> : <strong>{value ?? '—'}</strong>}</div>;
}

function operationTitle(operation: TaskOperation | null): string {
  return ({ progress: '回報執行進度', submit: '提交成果與證據', block: '標記任務受阻', release: '交接並釋出任務' } as Record<string, string>)[operation ?? ''] ?? '執行操作';
}

function OverviewView({
  overview,
  loading,
  project,
  events,
  agents,
  onSelectTask,
}: {
  overview: Overview | null;
  loading: boolean;
  project: Project | null;
  events: AuditEvent[];
  agents: Agent[];
  onSelectTask: () => void;
}) {
  return (
    <div className="overview-page">
      <section className="overview-intro">
        <div><Text className="eyebrow">{project?.key ?? 'PROJECT'}</Text><Title level={3}>{project?.name ?? '專案'}</Title><Paragraph>{project?.description || '專案工作狀態與資源概況'}</Paragraph></div>
        <div className="overview-budget"><span>預算額度</span><strong>{money(project?.budget_usd)}</strong></div>
      </section>
      <section className="overview-metrics">
        {[
          ['待整理', overview?.counts.total === undefined ? undefined : Math.max(0, overview.counts.total - overview.counts.ready - overview.counts.in_progress - overview.counts.blocked - overview.counts.in_review - overview.counts.done)],
          ['待執行', overview?.counts.ready],
          ['進行中', overview?.counts.in_progress],
          ['受阻', overview?.counts.blocked],
          ['待審核', overview?.counts.in_review],
          ['已完成', overview?.counts.done],
        ].map(([label, value]) => <div className="overview-metric" key={String(label)}><span>{label}</span><strong>{loading ? '—' : value ?? '—'}</strong></div>)}
      </section>
      <div className="overview-columns">
        <section className="overview-section">
          <div className="section-heading"><div><Text className="eyebrow">執行資源</Text><Title level={4}>Agent 與成本</Title></div><Button type="link" onClick={onSelectTask}>開啟任務清單</Button></div>
          <div className="overview-row"><span>Agent 總數</span><strong>{loading ? '—' : overview?.agents.total ?? agents.length}</strong></div>
          <div className="overview-row"><span>可用</span><strong>{loading ? '—' : overview?.agents.available ?? agents.filter((agent) => agent.status === 'available').length}</strong></div>
          <div className="overview-row"><span>執行中</span><strong>{loading ? '—' : overview?.agents.busy ?? agents.filter((agent) => agent.status === 'busy').length}</strong></div>
          <div className="overview-row"><span>執行成本彙總</span><strong>{loading ? '—' : money(overview?.cost_usd)}</strong></div>
          <div className="overview-cost-note"><WarningOutlined /> 成本彙總不是付費模型用量驗證。請在執行明細確認來源是自陳或量測。</div>
        </section>
        <section className="overview-section">
          <div className="section-heading"><div><Text className="eyebrow">最近紀錄</Text><Title level={4}>專案動態</Title></div></div>
          {loading && <Skeleton active paragraph={{ rows: 4 }} />}
          {!loading && events.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="目前沒有操作紀錄" />}
          {!loading && events.slice(0, 8).map((event) => <div className="overview-activity" key={event.id}><span className="activity-dot" /><div><strong>{event.action.replaceAll('_', ' ')}</strong><span>{event.entity_type} · {event.entity_id.slice(0, 8)}</span></div><time>{displayDate(event.created_at)}</time></div>)}
        </section>
      </div>
    </div>
  );
}

function TaskSpecification({ task, context, agents }: { task: Task; context: TaskContext | null; agents: Agent[] }) {
  const dependencyTasks = context?.dependencies ?? [];
  return (
    <div className="spec-view">
      <Descriptions column={1} size="small" colon={false}>
        <Descriptions.Item label="負責 Agent">{nameFor(task.assignee_id, agents)}</Descriptions.Item>
        <Descriptions.Item label="審核者">{nameFor(task.reviewer_id, agents)}</Descriptions.Item>
        <Descriptions.Item label="預算上限">{money(task.budget_usd)}</Descriptions.Item>
        <Descriptions.Item label="建立時間">{displayDate(task.created_at)}</Descriptions.Item>
      </Descriptions>
      <SpecBlock title="描述" value={task.description} />
      <SpecBlock title="目標" value={task.goal} />
      <SpecBlock title="輸入資料" value={task.inputs} />
      <SpecBlock title="範圍" value={task.scope} />
      <SpecBlock title="限制條件" value={task.constraints} />
      <div className="spec-block"><h4>驗收條件</h4>{task.acceptance_criteria.length ? <ul>{task.acceptance_criteria.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <span className="empty-value">尚未設定</span>}</div>
      <div className="spec-block"><h4>相依任務</h4>{dependencyTasks.length ? <div className="dependency-list">{dependencyTasks.map((dependency) => <Tag key={dependency.id} color={dependency.status === 'done' ? 'green' : 'default'}>{dependency.key} · {dependency.title}</Tag>)}</div> : task.dependency_ids.length ? <span>{task.dependency_ids.join(', ')}</span> : <span className="empty-value">無</span>}</div>
      {task.blocked_reason && <Alert type="error" showIcon icon={<ExclamationCircleOutlined />} message="阻塞原因" description={task.blocked_reason} />}
      {task.handoff && <SpecBlock title="交接資訊" value={task.handoff} />}
      {task.labels.length > 0 && <div className="spec-block"><h4>標籤</h4><Space wrap>{task.labels.map((label) => <Tag key={label}>{label}</Tag>)}</Space></div>}
    </div>
  );
}

function SpecBlock({ title, value }: { title: string; value?: string | null }) {
  return <div className="spec-block"><h4>{title}</h4>{value ? <Paragraph>{value}</Paragraph> : <span className="empty-value">尚未設定</span>}</div>;
}

function ExecutionReview({ context, agents, canReview, projectId, hasLease, onUsePullRequest, onReview }: { context: TaskContext | null; agents: Agent[]; canReview: boolean; projectId: string; hasLease: boolean; onUsePullRequest: (result: ExistingPullRequest) => void; onReview: (decision: 'accept' | 'reject') => void }) {
  return (
    <div className="execution-view">
      {!context && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="載入執行記錄中" />}
      {context && <>
      {context.task.status === 'in_review' && (
        <div className="review-panel">
          <div className="review-heading"><div><span className="eyebrow">INDEPENDENT REVIEW</span><h3>審核決定</h3></div><Tag color="gold">待審核</Tag></div>
          {canReview ? <Space><Button type="primary" icon={<CheckOutlined />} onClick={() => onReview('accept')}>通過</Button><Button danger icon={<CloseOutlined />} onClick={() => onReview('reject')}>退回</Button></Space> : <Text type="secondary">目前身分未符合指定審核權限，或執行者不可審核自己的成果。</Text>}
        </div>
      )}
      <div className="detail-section-heading"><h3>執行歷程</h3><span>{context.executions.length} 筆</span></div>
      {!context.executions.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚無執行記錄" />}
      {context.executions.map((execution) => <ExecutionRow key={execution.id} execution={execution} agentName={nameFor(execution.agent_id, agents)} />)}
      <div className="detail-section-heading evidence-heading"><h3>成果與證據</h3><span>{context.artifacts.length} 項</span></div>
      {!context.artifacts.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚無提交證據" />}
      {context.artifacts.map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} />)}
      </>}
      <ExistingPullRequestLookup projectId={projectId} hasLease={hasLease} onUseResult={onUsePullRequest} />
    </div>
  );
}

function ExistingPullRequestLookup({ projectId, hasLease, onUseResult }: { projectId: string; hasLease: boolean; onUseResult: (result: ExistingPullRequest) => void }) {
  const [provider, setProvider] = useState<ExistingPullRequest['provider']>('github');
  const [repository, setRepository] = useState('');
  const [number, setNumber] = useState<number | null>(null);
  const [result, setResult] = useState<ExistingPullRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function lookup() {
    const normalizedRepository = repository.trim();
    if (!normalizedRepository || number === null || number < 1) return;
    setBusy(true);
    setError('');
    setResult(null);
    const params = new URLSearchParams({ repository: normalizedRepository });
    try {
      const response = await api.get<ExistingPullRequest>(`/api/projects/${encodeURIComponent(projectId)}/vcs/pulls/${provider}/${number}?${params.toString()}`);
      setResult(response);
    } catch (lookupError) {
      setError(errorText(lookupError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="existing-pr-lookup" aria-labelledby="existing-pr-title">
      <div className="detail-section-heading"><h3 id="existing-pr-title">查詢既有 PR / MR</h3><span>專案版控</span></div>
      <div className="existing-pr-fields">
        <Select aria-label="版控服務" value={provider} onChange={(value: ExistingPullRequest['provider']) => setProvider(value)} options={[{ value: 'github', label: 'GitHub' }, { value: 'gitlab', label: 'GitLab' }, { value: 'gitea', label: 'Gitea' }]} />
        <Input aria-label="儲存庫 owner/repo" placeholder="owner/repo" value={repository} onChange={(event) => setRepository(event.target.value)} onPressEnter={() => void lookup()} />
        <InputNumber aria-label="PR 或 MR 編號" min={1} precision={0} placeholder="#" value={number} onChange={setNumber} onPressEnter={() => void lookup()} />
        <Button type="primary" onClick={() => void lookup()} loading={busy} disabled={!repository.trim() || !number || number < 1}>查詢</Button>
      </div>
      <Text className="existing-pr-help">使用此專案已設定的 provider allowlist。尚未設定時會顯示服務端錯誤。</Text>
      {error && <Alert className="existing-pr-result-alert" type="error" showIcon message="既有版控查詢失敗" description={error} />}
      {result && <div className="existing-pr-result">
        <div className="existing-pr-result-heading"><div><Tag color={result.state === 'open' ? 'green' : 'default'}>{result.state}</Tag><strong>{result.provider} · {result.repository}#{result.number}</strong></div><span>資料來源：provider API</span></div>
        <strong className="existing-pr-title-text">{result.title}</strong>
        {safeWebUrl(result.web_url) ? <a href={safeWebUrl(result.web_url)!} target="_blank" rel="noreferrer">{result.web_url}</a> : <code>{result.web_url}</code>}
        <div className="existing-pr-meta"><span>Base <code>{result.base}</code></span><span>Head <code>{result.head}</code></span><span>SHA <code>{result.head_sha.slice(0, 12)}</code></span></div>
        <div className="existing-pr-checks"><strong>Provider checks</strong>{result.checks_available ? result.checks.length ? result.checks.map((check, index) => <div className="existing-pr-check" key={`${check.context}-${index}`}><Tag>{check.state}</Tag><span>{check.context}{check.description ? ` · ${check.description}` : ''}</span>{safeWebUrl(check.target_url) && <a href={safeWebUrl(check.target_url)!} target="_blank" rel="noreferrer">查看</a>}</div>) : <Text type="secondary">Provider API 未回傳 check 項目。</Text> : <Text type="secondary">此 provider 未提供 checks API。平台未執行 CI。</Text>}</div>
        {hasLease && <Button size="small" onClick={() => onUseResult(result)}>帶入成果草稿</Button>}
        {!hasLease && <Text type="secondary">持有此分頁的執行租約後，可將 URL 與查詢摘要帶入提交成果。</Text>}
      </div>}
    </section>
  );
}

function ExecutionRow({ execution, agentName }: { execution: Execution; agentName: string }) {
  const label = ({ running: '執行中', submitted: '已提交', accepted: '已通過', rejected: '已退回', expired: '租約逾期', released: '已釋出' })[execution.status];
  return (
    <div className="execution-row">
      <div className="execution-mark"><span /></div>
      <div className="execution-body">
        <div className="execution-top"><strong>{label}</strong><span>{displayDate(execution.started_at)}</span></div>
        {execution.summary && <Paragraph>{execution.summary}</Paragraph>}
        {execution.status === 'running' && <Progress percent={execution.progress} size="small" />}
        <div className="execution-meta"><Tag>{agentName}</Tag><span>{money(execution.cost_usd)}</span><Tag color={execution.cost_source === 'self_reported' ? 'orange' : 'green'}>{execution.cost_source === 'self_reported' ? '自陳' : '量測'}</Tag>{execution.finished_at && <span>{displayDate(execution.finished_at)}</span>}</div>
      </div>
    </div>
  );
}

function ArtifactRow({ artifact }: { artifact: Artifact }) {
  const safeUri = safeWebUrl(artifact.uri);
  return (
    <div className="artifact-row"><div className="artifact-icon">{artifact.kind === 'url' ? <LinkOutlined /> : <FileSearchOutlined />}</div><div className="artifact-body"><strong>{artifact.title}</strong><span>{({ document: '文件', url: '網址', test_report: '測試報告', file: '檔案', summary: '摘要' })[artifact.kind]} · {displayDate(artifact.created_at)}</span>{safeUri && <a href={safeUri} target="_blank" rel="noreferrer">{safeUri}</a>}{artifact.uri && !safeUri && <code className="artifact-uri">{artifact.uri}</code>}{artifact.content && <Paragraph ellipsis={{ rows: 4, expandable: true, symbol: '展開' }}>{artifact.content}</Paragraph>}</div></div>
  );
}

function TaskCollaboration({ context, people, principal, onReply }: { context: TaskContext | null; people: Agent[]; principal: Principal; onReply: (item: ProjectMessage) => void }) {
  if (!context) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="載入協作記錄中" />;
  return (
    <div className="task-collaboration">
      {!context.messages.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="此任務尚無訊息" />}
      {context.messages.map((item) => <div className="thread-message" key={item.id}><div className="thread-message-head"><Avatar size={26}>{nameFor(item.sender_id, people, principal).slice(0, 1).toUpperCase()}</Avatar><strong>{nameFor(item.sender_id, people, principal)}</strong><Tag>{({ question: '問題', reply: '回覆', help_request: '求助', decision: '決議', handoff: '交接' })[item.kind]}</Tag><time>{displayDate(item.created_at)}</time></div><Paragraph>{item.body}</Paragraph><div className="thread-message-foot"><Tag color={item.status === 'completed' ? 'green' : item.status === 'accepted' ? 'blue' : 'default'}>{({ delivered: '待處理', accepted: '已接收', completed: '已完成' })[item.status]}</Tag><Button size="small" type="link" onClick={() => onReply(item)}>回覆</Button></div></div>)}
    </div>
  );
}

function AuditRow({ event, actor }: { event: AuditEvent; actor: string }) {
  return (
    <div className="audit-row"><div className="audit-symbol"><AuditOutlined /></div><div className="audit-content"><div className="audit-title"><strong>{event.action.replaceAll('_', ' ')}</strong><span>{actor}</span><time>{displayDate(event.created_at)}</time></div><div className="audit-reference">{event.entity_type} · {event.entity_id}</div>{Object.keys(event.data ?? {}).length > 0 && <details><summary>查看事件資料</summary><pre>{JSON.stringify(event.data, null, 2)}</pre></details>}</div></div>
  );
}
