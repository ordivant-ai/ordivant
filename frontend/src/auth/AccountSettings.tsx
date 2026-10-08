import { useCallback, useEffect, useState } from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Alert, Avatar, Button, Descriptions, Drawer, Form, Input, Modal, Select, Switch, Table, Tabs, Tag, Tooltip, Typography, message } from 'antd';
import { LogoutOutlined, SettingOutlined } from '@ant-design/icons';
import { authApi } from './client';
import { useAuth } from './AuthContext';
import type { AuthPermissions, IdentitySessionRecord, IdentityUser, ProductKey } from './types';
import { PermissionEditor, usePermissionCatalogs } from './permissions';
import { EnterpriseSsoPanel, IdentityAuditPanel } from './SsoSettings';
import './auth.css';

const { Text, Paragraph } = Typography;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '請求失敗，請稍後重試。';
}

function dateText(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function permissionsDiffer(left: AuthPermissions, right: AuthPermissions) {
  return (['work', 'knowledge', 'code'] as ProductKey[]).some((product) => {
    const first = left[product];
    const second = right[product];
    if (first?.role !== second?.role) return true;
    const firstScopes = [...(first?.scope_ids ?? [])].sort();
    const secondScopes = [...(second?.scope_ids ?? [])].sort();
    return firstScopes.length !== secondScopes.length || firstScopes.some((scope, index) => scope !== secondScopes[index]);
  });
}

export function AccountControl({
  product,
  productLabel,
  displayName,
  businessRole,
}: {
  product: ProductKey;
  productLabel: string;
  displayName: string;
  businessRole: string;
}) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const [messageApi, contextHolder] = message.useMessage();
  const auth = useAuth();

  async function signOut() {
    setSigningOut(true);
    setSignOutError('');
    try {
      await auth.logout();
    } catch (error) {
      const text = errorText(error);
      setSignOutError(text);
      messageApi.error(`伺服器登出未完成：${text}`);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <>
      {contextHolder}
      <div className="auth-account-control" data-product={product}>
        <Tooltip title="帳號與安全性">
          <Button type="text" size="small" icon={<SettingOutlined />} aria-label="帳號與安全性" onClick={() => setOpen(true)} />
        </Tooltip>
        <Tooltip title="登出">
          <Button type="text" size="small" icon={<LogoutOutlined />} aria-label={`${productLabel} 登出`} loading={signingOut} onClick={() => void signOut()} />
        </Tooltip>
      </div>
      <Drawer title="帳號與安全性" open={open} onClose={() => setOpen(false)} width={560} className="auth-account-drawer" destroyOnClose>
        {signOutError && <Alert className="auth-drawer-alert" type="error" showIcon message="登出失敗，工作階段仍有效" description={signOutError} />}
        <div className="auth-drawer-identity">
          <Avatar size={38}>{displayName.slice(0, 1).toUpperCase()}</Avatar>
          <div><strong>{displayName}</strong><span>{auth.session?.user.email}</span><span>{auth.session?.authentication?.method === 'oidc' ? `企業登入 · ${auth.session.authentication.provider_name || auth.sso?.display_name || 'OIDC'}` : 'Ordivant 帳號登入'}</span></div>
          <Tag color={auth.session?.user.role === 'admin' ? 'purple' : 'default'}>{auth.session?.user.role === 'admin' ? 'Admin' : 'Member'}</Tag>
        </div>
        <Tabs
          items={[
            { key: 'security', label: '安全性', children: <SecurityPanel onLogout={signOut} /> },
            { key: 'profile', label: '帳號', children: <ProfilePanel businessRole={businessRole} /> },
            ...(auth.session?.user.role === 'admin' ? [{ key: 'users', label: '使用者與邀請', children: <AdminPanel /> }] : []),
            ...(auth.session?.user.role === 'admin' ? [{ key: 'sso', label: '企業 SSO', children: <EnterpriseSsoPanel /> }, { key: 'identity-audit', label: '身分稽核', children: <IdentityAuditPanel /> }] : []),
          ]}
        />
      </Drawer>
    </>
  );
}

function ProfilePanel({ businessRole }: { businessRole: string }) {
  const auth = useAuth();
  return (
    <div className="auth-settings-panel">
      <Descriptions size="small" column={1} colon={false}>
        <Descriptions.Item label="姓名">{auth.session?.user.name}</Descriptions.Item>
        <Descriptions.Item label="電子郵件">{auth.session?.user.email}</Descriptions.Item>
        <Descriptions.Item label="Suite 角色">{auth.session?.user.role === 'admin' ? '管理員' : '成員'}</Descriptions.Item>
        <Descriptions.Item label="目前產品角色">{businessRole || '尚未授權'}</Descriptions.Item>
        <Descriptions.Item label="登入來源">{auth.session?.authentication?.method === 'oidc' ? `企業 SSO · ${auth.session.authentication.provider_name || auth.sso?.display_name || 'OIDC'}` : 'Ordivant 帳號'}</Descriptions.Item>
        <Descriptions.Item label="權限管理">{auth.session?.user.permissions_source === 'sso' ? '由企業群組同步' : '由管理員設定'}</Descriptions.Item>
        <Descriptions.Item label="工作階段到期">{auth.session ? dateText(auth.session.expires_at) : '—'}</Descriptions.Item>
      </Descriptions>
      <Paragraph type="secondary">產品角色與可存取資源由各產品 API 分別授權。</Paragraph>
    </div>
  );
}

function SecurityPanel({ onLogout }: { onLogout: () => Promise<void> }) {
  const auth = useAuth();
  const [sessions, setSessions] = useState<IdentitySessionRecord[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState('');
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [form] = Form.useForm();

  const loadSessions = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const result = await authApi.sessions();
      setSessions(result.sessions);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  async function revokeSession(session: IdentitySessionRecord) {
    setRevoking(session.id);
    setError('');
    try {
      await authApi.revokeSession(session.id);
      if (session.current) auth.clearSession('此工作階段已撤銷，請重新登入。');
      else await loadSessions();
    } catch (revokeError) {
      setError(errorText(revokeError));
    } finally {
      setRevoking('');
    }
  }

  async function logoutAll() {
    setLoggingOutAll(true);
    setError('');
    try {
      await authApi.logoutAll();
      auth.clearSession('所有工作階段已登出。');
    } catch (logoutError) {
      setError(errorText(logoutError));
    } finally {
      setLoggingOutAll(false);
    }
  }

  async function changePassword(values: { current_password: string; new_password: string; confirm_password: string }) {
    if (values.new_password !== values.confirm_password) {
      setFormError('兩次輸入的新密碼不一致。');
      return;
    }
    setChangingPassword(true);
    setFormError('');
    try {
      const next = await authApi.changePassword({ current_password: values.current_password, new_password: values.new_password });
      auth.updateSession(next);
      form.resetFields();
      await loadSessions();
    } catch (passwordError) {
      setFormError(errorText(passwordError));
    } finally {
      form.resetFields(['current_password', 'new_password', 'confirm_password']);
      setChangingPassword(false);
    }
  }

  const columns: ColumnsType<IdentitySessionRecord> = [
    { title: '工作階段', key: 'session', render: (_value, session) => <div className="auth-session-cell"><strong>{session.current ? '目前工作階段' : '已登入裝置'}</strong><span>最近活動 {dateText(session.last_seen_at)}</span></div> },
    { title: '到期時間', dataIndex: 'expires_at', key: 'expires_at', render: dateText, width: 150 },
    { title: '', key: 'action', width: 88, render: (_value, session) => <Button size="small" danger loading={revoking === session.id} onClick={() => void revokeSession(session)}>撤銷</Button> },
  ];

  return (
    <div className="auth-settings-panel">
      {error && <Alert className="auth-drawer-alert" type="error" showIcon message="帳號操作失敗" description={error} action={<Button size="small" onClick={() => void loadSessions()}>重試</Button>} />}
      {formError && <Alert className="auth-drawer-alert" type="error" showIcon message={formError} />}
      {auth.session?.user.credential_type === 'sso' ? <Alert type="info" showIcon message="此帳號由企業身分服務管理" description="請透過企業身分服務更新密碼與多重要素驗證。Ordivant 不提供此帳號的密碼或復原碼操作。" /> : <>
        <div className="auth-section-heading"><div><strong>更改密碼</strong><span>完成後會撤銷其他已登入工作階段。</span></div></div>
        <Form form={form} layout="vertical" onFinish={(values) => void changePassword(values)} requiredMark={false}>
          <Form.Item name="current_password" label="目前密碼" rules={[{ required: true, message: '請輸入目前密碼' }]}><Input.Password autoComplete="current-password" /></Form.Item>
          <Form.Item name="new_password" label="新密碼" rules={[{ required: true, min: 12, message: '密碼至少 12 個字元' }]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Form.Item name="confirm_password" label="再次輸入新密碼" rules={[{ required: true, message: '請再次輸入新密碼' }]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Button type="primary" htmlType="submit" loading={changingPassword}>更新密碼</Button>
        </Form>
      </>}
      <div className="auth-section-heading auth-session-heading"><div><strong>已登入工作階段</strong><span>撤銷不再使用的登入。</span></div><Button size="small" danger loading={loggingOutAll} onClick={() => void logoutAll()}>登出全部</Button></div>
      <Table<IdentitySessionRecord> rowKey="id" size="small" dataSource={sessions} columns={columns} loading={busy} pagination={false} scroll={{ x: 430 }} locale={{ emptyText: '沒有其他工作階段' }} />
      <Button className="auth-reload-sessions" size="small" onClick={() => void loadSessions()}>重新整理工作階段</Button>
      <Button className="auth-drawer-signout" icon={<LogoutOutlined />} onClick={() => void onLogout()}>登出此帳號</Button>
    </div>
  );
}

function AdminPanel() {
  const auth = useAuth();
  const [users, setUsers] = useState<IdentityUser[]>([]);
  const [usersBusy, setUsersBusy] = useState(true);
  const [usersError, setUsersError] = useState('');
  const { catalogs, reload: loadCatalogs } = usePermissionCatalogs();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteForm] = Form.useForm();
  const [invitePermissions, setInvitePermissions] = useState<AuthPermissions>({});
  const [inviteCredential, setInviteCredential] = useState<{ code: string; expiresAt: string } | null>(null);
  const [credentialVisible, setCredentialVisible] = useState(false);
  const [credentialError, setCredentialError] = useState('');
  const [editingUser, setEditingUser] = useState<IdentityUser | null>(null);
  const [editPermissions, setEditPermissions] = useState<AuthPermissions>({});
  const [editName, setEditName] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [togglingUser, setTogglingUser] = useState('');
  const [messageApi, contextHolder] = message.useMessage();

  const loadUsers = useCallback(async () => {
    setUsersBusy(true);
    setUsersError('');
    try {
      const result = await authApi.users();
      setUsers(result.users);
    } catch (loadError) {
      setUsersError(errorText(loadError));
    } finally {
      setUsersBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function setUserActive(user: IdentityUser, active: boolean) {
    setTogglingUser(user.id);
    setUsersError('');
    try {
      const updated = await authApi.updateUser(user.id, { active });
      setUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (updateError) {
      setUsersError(errorText(updateError));
    } finally {
      setTogglingUser('');
    }
  }

  async function createInvitation(values: { name: string; email: string; role: IdentityUser['role'] }) {
    setInviteBusy(true);
    setInviteError('');
    try {
      const invitation = await authApi.invite({ ...values, email: values.email.trim(), name: values.name.trim(), permissions: invitePermissions });
      setInviteCredential({ code: invitation.invitation_code, expiresAt: invitation.expires_at });
      setCredentialVisible(false);
      inviteForm.resetFields();
      setInvitePermissions({});
      setInviteOpen(false);
    } catch (creationError) {
      setInviteError(errorText(creationError));
    } finally {
      setInviteBusy(false);
    }
  }

  function openEdit(user: IdentityUser) {
    setEditingUser(user);
    setEditName(user.name);
    setEditPermissions(user.permissions ?? {});
    setEditError('');
  }

  async function saveUser() {
    if (!editingUser) return;
    setEditBusy(true);
    setEditError('');
    try {
      const permissionChanges = permissionsDiffer(editPermissions, editingUser.permissions ?? {});
      const updated = await authApi.updateUser(editingUser.id, { name: editName.trim(), ...(permissionChanges ? { permissions: editPermissions } : {}) });
      setUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditingUser(null);
      messageApi.success('使用者設定已更新。');
    } catch (saveError) {
      setEditError(errorText(saveError));
    } finally {
      setEditBusy(false);
    }
  }

  const columns: ColumnsType<IdentityUser> = [
    { title: '使用者', key: 'user', render: (_value, user) => <div className="auth-user-cell"><strong>{user.name}</strong><span>{user.email}</span><span>{user.credential_type === 'sso' ? `企業登入 · ${user.permissions_source === 'sso' ? '群組管理' : '手動管理'}` : 'Ordivant 帳號登入'}</span></div> },
    { title: '角色', dataIndex: 'role', key: 'role', width: 84, render: (role: IdentityUser['role']) => <Tag color={role === 'admin' ? 'purple' : 'default'}>{role === 'admin' ? 'Admin' : 'Member'}</Tag> },
    { title: '啟用', dataIndex: 'active', key: 'active', width: 72, render: (active: boolean, user) => <Tooltip title={user.id === auth.session?.user.id ? '無法停用目前登入的帳號' : active ? '停用帳號' : '啟用帳號'}><Switch size="small" checked={active} disabled={user.id === auth.session?.user.id || togglingUser === user.id} loading={togglingUser === user.id} onChange={(value) => void setUserActive(user, value)} /></Tooltip> },
    { title: '', key: 'actions', width: 78, render: (_value, user) => <Button size="small" onClick={() => openEdit(user)}>管理</Button> },
  ];

  const credentialDialog = inviteCredential;

  return (
    <div className="auth-settings-panel auth-admin-panel">
      {contextHolder}
      <div className="auth-section-heading"><div><strong>使用者與邀請</strong><span>邀請碼只顯示一次，過期後需重新簽發。</span></div><Button type="primary" size="small" onClick={() => { setInviteError(''); setInviteOpen(true); }}>新增邀請</Button></div>
      {usersError && <Alert className="auth-drawer-alert" type="error" showIcon message="使用者清單或更新失敗" description={usersError} action={<Button size="small" onClick={() => void loadUsers()}>重試</Button>} />}
      <Table<IdentityUser> rowKey="id" size="small" dataSource={users} columns={columns} loading={usersBusy} pagination={{ pageSize: 6, hideOnSinglePage: true }} scroll={{ x: 430 }} />
      <div className="auth-scope-refresh"><Text type="secondary">產品資源目錄透過各產品 API 載入。離線產品的授權欄位會保留且暫時鎖定。</Text><Button size="small" onClick={() => void loadCatalogs()}>重新載入資源</Button></div>

      <Modal title="邀請使用者" open={inviteOpen} onCancel={() => setInviteOpen(false)} onOk={() => inviteForm.submit()} confirmLoading={inviteBusy} okText="建立邀請" cancelText="取消" width={700} destroyOnClose className="auth-permissions-modal">
        {inviteError && <Alert className="auth-drawer-alert" type="error" showIcon message={inviteError} />}
        <Form form={inviteForm} layout="vertical" onFinish={(values) => void createInvitation(values)} initialValues={{ role: 'member' }}>
          <Form.Item name="name" label="姓名" rules={[{ required: true, whitespace: true, message: '請輸入姓名' }]}><Input maxLength={120} autoComplete="name" /></Form.Item>
          <Form.Item name="email" label="電子郵件" rules={[{ required: true, type: 'email', message: '請輸入有效的電子郵件' }]}><Input autoComplete="email" /></Form.Item>
          <Form.Item name="role" label="Suite 角色" rules={[{ required: true }]}><Select options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]} /></Form.Item>
        </Form>
        <PermissionEditor value={invitePermissions} catalogs={catalogs} onChange={setInvitePermissions} />
      </Modal>

      <Modal title="產品角色與資源" open={Boolean(editingUser)} onCancel={() => setEditingUser(null)} onOk={() => void saveUser()} confirmLoading={editBusy} okText="儲存" cancelText="取消" width={700} destroyOnClose className="auth-permissions-modal">
        {editError && <Alert className="auth-drawer-alert" type="error" showIcon message={editError} />}
        {editingUser?.credential_type === 'sso' && editingUser.permissions_source === 'sso' && <Alert className="auth-drawer-alert" type="warning" showIcon message="變更產品權限會改由 Ordivant 管理" description="只有調整產品角色或資源範圍時，才會停止依企業群組同步權限；只修改姓名不會改變管理方式。" />}
        <Form layout="vertical"><Form.Item label="顯示名稱"><Input value={editName} maxLength={120} onChange={(event) => setEditName(event.target.value)} /></Form.Item></Form>
        <PermissionEditor value={editPermissions} catalogs={catalogs} onChange={setEditPermissions} />
      </Modal>

      <Modal
        title="一次性邀請碼"
        open={Boolean(credentialDialog)}
        closable={false}
        keyboard={false}
        maskClosable={false}
        className="auth-recovery-modal"
        footer={<Button type="primary" disabled={!credentialVisible} onClick={() => { setInviteCredential(null); setCredentialVisible(false); }}>我已安全保存邀請碼</Button>}
      >
        <Paragraph>請先顯示並安全交付給受邀者。關閉後，系統不會再次顯示此代碼。</Paragraph>
        <div className="auth-recovery-toolbar"><Text type="secondary">有效期限：{credentialDialog ? dateText(credentialDialog.expiresAt) : ''}</Text><Button size="small" onClick={() => setCredentialVisible((value) => !value)}>{credentialVisible ? '隱藏' : '顯示'}</Button></div>
        <div className={`auth-one-time-code${credentialVisible ? ' auth-one-time-code-visible' : ''}`}>{credentialVisible ? credentialDialog?.code : '********************'}</div>
        {credentialError && <Alert className="auth-drawer-alert" type="error" showIcon message={credentialError} />}
        <Button size="small" disabled={!credentialVisible} onClick={() => void (async () => {
          try { await navigator.clipboard.writeText(credentialDialog?.code ?? ''); setCredentialError(''); messageApi.success('邀請碼已複製。'); }
          catch { setCredentialError('無法使用剪貼簿，請解鎖顯示後手動複製。'); }
        })()}>複製邀請碼</Button>
      </Modal>
    </div>
  );
}
