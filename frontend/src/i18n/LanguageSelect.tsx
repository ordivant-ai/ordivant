import { GlobalOutlined } from '@ant-design/icons';
import { Select } from 'antd';
import { useI18n } from './index';
import './language.css';

export function LanguageSelect() {
  const { locale, setLocale, t } = useI18n();
  return <div className="language-control"><GlobalOutlined aria-hidden /><Select
    aria-label={t('介面語言')}
    value={locale}
    onChange={setLocale}
    size="small"
    popupMatchSelectWidth={156}
    options={[{ value: 'zh-TW', label: '繁體中文' }, { value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }]}
  /></div>;
}
