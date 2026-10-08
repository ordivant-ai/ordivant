import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Empty, Input, Select, Skeleton, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PauseOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { api, createIdempotencyKey, isDefinitiveClientError } from './api';
import type { Run, RunEvent } from './types';
import './RunConsole.css';

const { Text, Title } = Typography;
const statusLabels: Record<Run['status'], string> = {
  queued: '排隊中',
  running: '執行中',
  paused: '已暫停',
  done: '已提交',
  failed: '失敗',
  aborted: '已停止',
};

const statusColors: Record<Run['status'], string> = {
  queued: 'default',
  running: 'blue',
  paused: 'gold',
  done: 'green',
  failed: 'red',
  aborted: 'default',
};

function shortId(value: string | null) {
  return value ? value.slice(0, 8) : '—';
}

function dateText(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-TW', { hour12: false }) : '—';
}

function modelText(providerId: string, modelId: string) {
  return `${providerId} · ${modelId}`;
}

export function RunConsole({ projectId, canControl }: { projectId: string; canControl: boolean }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [taskFilter, setTaskFilter] = useState('');
  const [reloadRevision, setReloadRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyAction, setBusyAction] = useState<'' | 'pause' | 'resume' | 'stop' | 'retry'>('');
  const pendingControlKeys = useRef(new Map<string, string>());
  const [messageApi, messageContext] = message.useMessage();

  useEffect(() => {
    pendingControlKeys.current.clear();
    setRuns([]);
    setLoading(true);
    setSelectedRunId('');
    setDrawerOpen(false);
    setSelectedRun(null);
    setEvents([]);
    setDetailBusy(false);
    setBusyAction('');
    setListError('');
    setDetailError('');
    setActionError('');
  }, [projectId]);

  useEffect(() => {
    let active = true;
    let busy = false;
    const load = async (initial = false) => {
      if (busy) return;
      busy = true;
      if (initial) setLoading(true);
      try {
        const nextRuns = await api.runs(projectId, { status: statusFilter || undefined, task_id: taskFilter.trim() || undefined });
        if (active) {
          setRuns(nextRuns);
          setListError('');
        }
      } catch (error) {
        if (active) setListError(error instanceof Error ? error.message : 'Run 清單無法載入。');
      } finally {
        busy = false;
        if (active) setLoading(false);
      }
    };
    void load(true);
    const timer = window.setInterval(() => void load(), 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [projectId, statusFilter, taskFilter, reloadRevision]);

  useEffect(() => {
    if (!drawerOpen || !selectedRunId) return;
    let active = true;
    let busy = false;
    const load = async (initial = false) => {
      if (busy) return;
      busy = true;
      if (initial) setDetailBusy(true);
      try {
        const [nextRun, nextEvents] = await Promise.all([api.run(selectedRunId), api.runEvents(selectedRunId)]);
        if (nextRun.project_id !== projectId) throw new Error('Run 不屬於目前選取的專案。');
        if (active) {
          setSelectedRun(nextRun);
          setEvents(nextEvents);
          setDetailError('');
        }
      } catch (error) {
        if (active) setDetailError(error instanceof Error ? error.message : 'Run 詳情無法載入。');
      } finally {
        busy = false;
        if (active) setDetailBusy(false);
      }
    };
    void load(true);
    const timer = window.setInterval(() => void load(), 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [drawerOpen, projectId, selectedRunId]);

  async function control(action: 'pause' | 'resume' | 'stop' | 'retry') {
    if (!selectedRun) return;
    const runOperationPrefix = `${selectedRun.id}\u0000`;
    const operation = `${runOperationPrefix}${action}`;
    for (const key of pendingControlKeys.current.keys()) {
      if (key.startsWith(runOperationPrefix) && key !== operation) pendingControlKeys.current.delete(key);
    }
    const idempotencyKey = pendingControlKeys.current.get(operation) ?? createIdempotencyKey();
    pendingControlKeys.current.set(operation, idempotencyKey);
    setBusyAction(action);
    setActionError('');
    try {
      const result = await api.controlRun(selectedRun.id, action, idempotencyKey);
      pendingControlKeys.current.delete(operation);
      setSelectedRun(result);
      setRuns((current) => action === 'retry'
        ? [result, ...current.filter((run) => run.id !== result.id)]
        : current.map((run) => run.id === result.id ? result : run));
      if (action === 'retry') setSelectedRunId(result.id);
      messageApi.success(action === 'pause' ? '已送出暫停請求。' : action === 'resume' ? '已送出恢復請求。' : action === 'stop' ? '已送出停止請求。' : '已建立新的重跑 Run。');
    } catch (error) {
      if (isDefinitiveClientError(error)) pendingControlKeys.current.delete(operation);
      setActionError(error instanceof Error ? error.message : 'Run 控制操作失敗。');
    } finally {
      setBusyAction('');
    }
  }

  const columns: ColumnsType<Run> = [
    { title: 'Run', dataIndex: 'id', key: 'id', width: 118, render: (id: string, run) => <div className="run-id-cell"><strong>{shortId(id)}</strong><span>{dateText(run.created_at)}</span></div> },
    { title: '狀態', dataIndex: 'status', key: 'status', width: 100, render: (status: Run['status']) => <Tag color={statusColors[status]}>{statusLabels[status]}</Tag> },
    { title: '任務 / Agent', key: 'task_agent', render: (_: unknown, run) => <div className="run-id-cell"><strong>任務 {shortId(run.task_id)}</strong><span>Agent {shortId(run.agent_id)}</span></div> },
    { title: '模式', dataIndex: 'mode', key: 'mode', width: 90, render: (mode: Run['mode']) => mode === 'demo' ? <Tag color="gold">DEMO</Tag> : mode === 'live' ? <Tag color="green">Live</Tag> : <Text type="secondary">未知</Text> },
    { title: '模型', key: 'model', render: (_: unknown, run) => run.receipt?.returned ? modelText(run.receipt.returned.provider_id, run.receipt.returned.model_id) : run.model_config?.model_id ?? '未知' },
  ];

  function openRun(run: Run) {
    pendingControlKeys.current.clear();
    setSelectedRunId(run.id);
    setSelectedRun(run);
    setEvents([]);
    setDetailError('');
    setActionError('');
    setDrawerOpen(true);
  }

  const selectedMode = selectedRun?.receipt?.mode ?? selectedRun?.mode;
  const receipt = selectedRun?.receipt;
  const canPause = selectedRun?.status === 'running' && selectedRun.desired_action === null;
  const canResume = selectedRun?.status === 'paused' && !['resume', 'stop'].includes(selectedRun.desired_action ?? '');
  const canStop = selectedRun && ['queued', 'running', 'paused'].includes(selectedRun.status) && selectedRun.desired_action !== 'stop';
  const canRetry = selectedRun && ['failed', 'aborted'].includes(selectedRun.status);

  return (
    <section className="run-console">
      {messageContext}
      <div className="run-toolbar">
        <Input allowClear value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)} placeholder="依 Task ID 篩選" aria-label="依 Task ID 篩選 Run" />
        <Select
          aria-label="依 Run 狀態篩選"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[{ value: '', label: '全部狀態' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]}
        />
        <Tooltip title="立即重新載入"><Button icon={<ReloadOutlined />} onClick={() => setReloadRevision((value) => value + 1)} aria-label="重新載入 Run" /></Tooltip>
        <Text className="run-poll-note">每 3 秒更新</Text>
      </div>
      {listError && <Alert className="run-alert" type="error" showIcon message="Run 清單無法載入" description={listError} action={<Button size="small" onClick={() => setReloadRevision((value) => value + 1)}>重試</Button>} />}
      <div className="run-table-shell">
        <Table<Run>
          rowKey="id"
          columns={columns}
          dataSource={runs}
          loading={loading}
          pagination={{ pageSize: 15, showSizeChanger: false }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={listError ? '無法顯示 Run' : '此專案尚無 Run'} /> }}
          scroll={{ x: 650 }}
          onRow={(run) => ({ onClick: () => openRun(run), tabIndex: 0, onKeyDown: (event) => { if (event.key === 'Enter') openRun(run); }, 'aria-label': `檢視 Run ${run.id}` })}
        />
      </div>

      <Drawer
        title={<div className="run-drawer-title"><div><Text className="eyebrow">RUN · {selectedRun ? shortId(selectedRun.id) : '—'}</Text><Title level={4}>{selectedRun ? statusLabels[selectedRun.status] : 'Run 詳情'}</Title></div>{selectedRun && <Tag color={statusColors[selectedRun.status]}>{statusLabels[selectedRun.status]}</Tag>}</div>}
        open={drawerOpen}
        onClose={() => { pendingControlKeys.current.clear(); setDrawerOpen(false); }}
        width={760}
        className="run-drawer"
      >
        {detailError && <Alert className="run-alert" type="error" showIcon message="Run 詳情更新失敗" description={detailError} action={<Button size="small" onClick={() => { setDrawerOpen(false); window.setTimeout(() => setDrawerOpen(true), 0); }}>重試</Button>} />}
        {detailBusy && !selectedRun && <Skeleton active paragraph={{ rows: 8 }} />}
        {selectedRun && <>
          <div className="run-control-bar">
            <Space wrap>
              {selectedMode === 'demo' ? <Tag color="gold">DEMO 執行</Tag> : selectedMode === 'live' ? <Tag color="green">Live 執行</Tag> : <Tag>模式未知</Tag>}
              {selectedRun.desired_action === 'pause' && <Tag color="gold">於下一個工具操作前暫停</Tag>}
              {selectedRun.desired_action === 'resume' && <Tag color="blue">恢復中</Tag>}
              {selectedRun.desired_action === 'stop' && <Tag color="red">停止中</Tag>}
            </Space>
            {canControl && <Space wrap>
              {canPause && <Button icon={<PauseOutlined />} loading={busyAction === 'pause'} disabled={Boolean(busyAction)} onClick={() => void control('pause')}>暫停</Button>}
              {canResume && <Button icon={<PlayCircleOutlined />} loading={busyAction === 'resume'} disabled={Boolean(busyAction)} onClick={() => void control('resume')}>恢復</Button>}
              {canStop && <Button danger icon={<StopOutlined />} loading={busyAction === 'stop'} disabled={Boolean(busyAction)} onClick={() => void control('stop')}>停止</Button>}
              {canRetry && <Button type="primary" icon={<ReloadOutlined />} loading={busyAction === 'retry'} disabled={Boolean(busyAction)} onClick={() => void control('retry')}>重跑</Button>}
            </Space>}
          </div>
          {actionError && <Alert className="run-alert" type="error" showIcon message="控制操作未完成" description={actionError} />}
          <Descriptions className="run-metadata" size="small" column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="任務">{selectedRun.task_id}</Descriptions.Item>
            <Descriptions.Item label="Business Execution">{selectedRun.execution_id ?? '尚未建立'}</Descriptions.Item>
            <Descriptions.Item label="Agent">{selectedRun.agent_id}</Descriptions.Item>
            <Descriptions.Item label="重跑來源">{selectedRun.retry_of ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="開始時間">{dateText(selectedRun.started_at)}</Descriptions.Item>
            <Descriptions.Item label="結束時間">{dateText(selectedRun.finished_at)}</Descriptions.Item>
          </Descriptions>
          {selectedRun.error && <Alert className="run-alert" type="error" showIcon message="執行錯誤" description={selectedRun.error} />}
          <div className="run-inspect-section">
            <div className="run-section-heading"><strong>模型與用量</strong><span>{receipt?.returned ? '實際回報模型' : '實際模型尚未回報'}</span></div>
            <div className="run-model-lines">
              <div><span>要求模型</span><strong>{receipt?.requested ? modelText(receipt.requested.provider_id, receipt.requested.model_id) : selectedRun.model_config ? modelText(selectedRun.model_config.provider_id, selectedRun.model_config.model_id) : '未知'}</strong></div>
              <div><span>實際模型</span><strong>{receipt?.returned ? modelText(receipt.returned.provider_id, receipt.returned.model_id) : '未知'}</strong></div>
              <div><span>模式</span><strong>{selectedMode === 'demo' ? 'DEMO' : selectedMode === 'live' ? 'Live' : '未知'}</strong></div>
            </div>
            <div className="run-usage-grid">
              {(['input_tokens', 'uncached_input_tokens', 'cached_input_tokens', 'cache_write_tokens', 'output_tokens', 'total_tokens'] as const).map((key) => <div key={key}><span>{({ input_tokens: '輸入 Tokens', uncached_input_tokens: '未快取輸入', cached_input_tokens: '快取讀取', cache_write_tokens: '快取寫入', output_tokens: '輸出 Tokens', total_tokens: '合計 Tokens' })[key]}</span><strong>{receipt?.usage?.[key] ?? '未知'}</strong></div>)}
              <div><span>成本</span><Tooltip title="尚未設定經驗證的費率與帳單資料，無法顯示美元費用。"><strong>未知</strong></Tooltip></div>
            </div>
            <div className="run-section-heading run-subheading"><strong>觀察到的工具呼叫</strong><span>{receipt?.tools.length ?? 0} 種工具</span></div>
            {receipt?.tools.length ? <div className="run-tool-list">{receipt.tools.map((tool) => <div key={tool.name}><code>{tool.name}</code><span>{tool.calls} 次</span></div>)}</div> : <Text type="secondary">尚無工具呼叫紀錄</Text>}
          </div>
          <div className="run-inspect-section">
            <div className="run-section-heading"><strong>事件與工具錯誤</strong><span>{events.length} 筆 · 每 3 秒更新</span></div>
            {events.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={detailError ? '事件無法載入' : '尚無事件'} /> : <div className="run-event-list">{events.map((event) => <article className="run-event" key={event.sequence}>
              <div className="run-event-heading"><Tag color={event.kind === 'error' ? 'red' : event.kind.startsWith('tool_') ? 'blue' : 'default'}>{event.kind}</Tag><time>{dateText(event.created_at)}</time><span>#{event.sequence}</span></div>
              {event.kind === 'sandbox' && <SandboxEventOutput data={event.data} />}
              <details><summary>檢視事件資料</summary><pre>{JSON.stringify(event.data, null, 2)}</pre></details>
            </article>)}</div>}
          </div>
          {selectedRun.sandbox && <div className="run-inspect-section"><div className="run-section-heading"><strong>Sandbox 狀態與輸出</strong></div><pre className="run-json-block">{JSON.stringify(selectedRun.sandbox, null, 2)}</pre></div>}
          {selectedRun.answer && <div className="run-inspect-section"><div className="run-section-heading"><strong>Run 回覆</strong><span>模型回合已提交，任務仍須獨立審核</span></div><pre className="run-answer">{selectedRun.answer}</pre></div>}
        </>}
      </Drawer>
    </section>
  );
}

function SandboxEventOutput({ data }: { data: Record<string, unknown> }) {
  const stdout = typeof data.observed === 'string' ? data.observed : typeof data.stdout === 'string' ? data.stdout : '';
  const stderr = typeof data.diagnostic === 'string' ? data.diagnostic : typeof data.stderr === 'string' ? data.stderr : '';
  const hasResult = 'exit_code' in data || Boolean(stdout) || Boolean(stderr);
  const duration = data.duration_seconds ?? data.duration;
  if (!hasResult) return null;
  return <div className="run-sandbox-result">
    <div><strong>{'exit_code' in data ? `Exit ${String(data.exit_code)}` : 'Sandbox 輸出'}</strong>{data.truncated === true && <Tag color="gold">輸出已截斷</Tag>}{duration !== undefined && <span>耗時 {String(duration)} 秒</span>}</div>
    {stdout && <pre><span>stdout</span>{stdout}</pre>}
    {stderr && <pre className="run-sandbox-stderr"><span>stderr</span>{stderr}</pre>}
    {!stdout && !stderr && <Text type="secondary">沒有輸出內容</Text>}
  </div>;
}
