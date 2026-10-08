import { useEffect, useState } from 'react';
import { Button, Modal, Space, Typography, message } from 'antd';
import { CopyOutlined, EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
import { formatNumber, useI18n } from '../i18n';
import './auth.css';

const { Paragraph, Text } = Typography;

export function RecoveryCodesDialog({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => setRevealed(false), [codes]);

  async function copyCodes() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      messageApi.success(t('復原碼已複製。請將它存放在安全位置。'));
    } catch {
      messageApi.error(t('無法使用剪貼簿，請解鎖顯示後手動保存復原碼。'));
    }
  }

  return (
    <>
      {contextHolder}
      <Modal
        title={t('保存帳號復原碼')}
        open={codes.length > 0}
        closable={false}
        keyboard={false}
        maskClosable={false}
        destroyOnClose
        className="auth-recovery-modal"
        footer={<Button type="primary" disabled={!revealed} onClick={onClose}>{t('我已安全保存')}</Button>}
      >
        <Paragraph>{t('每組復原碼只能使用一次。請先顯示並安全保存；確認後，系統不會再次顯示這批復原碼。')}</Paragraph>
        <div className="auth-recovery-toolbar">
          <Text type="secondary">{t('{{count}} 組一次性復原碼', { count: formatNumber(codes.length) })}</Text>
          <Space>
            <Button size="small" icon={revealed ? <EyeInvisibleOutlined /> : <EyeOutlined />} onClick={() => setRevealed((value) => !value)}>
              {t(revealed ? '隱藏' : '顯示')}
            </Button>
            <Button size="small" icon={<CopyOutlined />} disabled={!revealed} onClick={() => void copyCodes()}>{t('複製')}</Button>
          </Space>
        </div>
        <div className={`auth-recovery-codes${revealed ? ' auth-recovery-codes-visible' : ''}`} aria-label={t(revealed ? '復原碼' : '已隱藏的復原碼')}>
          {codes.map((code, index) => <code key={`${index}-${code}`}>{revealed ? code : '************'}</code>)}
        </div>
      </Modal>
    </>
  );
}
