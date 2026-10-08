import { Alert, Button, Typography } from 'antd';
import { useState } from 'react';
import { ProductSwitcher, type ProductKey } from '../products/shared/ProductSwitcher';
import { useI18n } from '../i18n';
import { AccountControl } from './AccountSettings';
import { useAuth } from './AuthContext';
import './auth.css';

const { Text, Title } = Typography;

export function AuthAccessDenied({ product, productName, error, forbidden, onRetry }: { product: ProductKey; productName: string; error: string; forbidden: boolean; onRetry: () => void }) {
  const { t } = useI18n();
  const auth = useAuth();
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  async function logout() {
    setLogoutBusy(true);
    setLogoutError('');
    try {
      await auth.logout();
    } catch (failure) {
      setLogoutError(failure instanceof Error && 'sourceMessage' in failure ? String((failure as Error & { sourceMessage: string }).sourceMessage) : failure instanceof Error ? failure.message : '無法登出，請確認帳號服務連線。');
    } finally {
      setLogoutBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <main className="auth-panel auth-access-panel">
        <div className="auth-brand-row"><span className="brand-mark">O</span><div><strong>Ordivant</strong><span>{productName}</span></div></div>
        <Title level={3}>{t(forbidden ? '尚未取得 {{product}} 存取權' : '無法確認 {{product}} 存取權', { product: productName })}</Title>
        <Alert
          type={forbidden ? 'warning' : 'error'}
          showIcon
          message={t(forbidden ? '帳號已登入，但此產品沒有可用的授權範圍' : '產品服務目前無法驗證此帳號')}
          description={t(error || (forbidden ? '請聯絡組織管理員，為你的帳號指派此產品的資源與角色。' : '請確認產品 API 已啟動後重試。'))}
          action={!forbidden ? <Button size="small" onClick={onRetry}>{t('重試')}</Button> : undefined}
        />
        {logoutError && <Alert type="error" showIcon message={t('登出失敗，工作階段仍有效')} description={t(logoutError)} />}
        <div className="auth-current-user"><Text>{auth.session?.user.name}</Text><Text type="secondary">{auth.session?.user.email}</Text></div>
        <ProductSwitcher active={product} compact />
        <div className="auth-access-actions">
          <AccountControl product={product} productLabel={productName} displayName={auth.session?.user.name ?? t('帳號')} businessRole="尚未授權" />
          <Button loading={logoutBusy} onClick={() => void logout()}>{t('登出')}</Button>
        </div>
      </main>
    </div>
  );
}
