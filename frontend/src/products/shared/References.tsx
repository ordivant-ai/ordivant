import { useI18n } from '../../i18n';
import { Button, Form, Input, Select, Space, Tag } from 'antd';
import type { Reference } from './types';

const productOptions = [
  { value: 'work', label: 'Work' },
  { value: 'knowledge', label: 'Knowledge' },
  { value: 'code', label: 'Code' },
  { value: 'external', label: '外部' },
];

const kindOptions = [
  { value: 'task', label: '任務' },
  { value: 'document_version', label: '文件版本' },
  { value: 'pull_request', label: 'Pull request' },
  { value: 'test_report', label: '測試報告' },
  { value: 'url', label: '網址' },
];

export function ReferenceFields() {
  const { t } = useI18n();
  return (
    <Form.List name="source_refs">
      {(fields, { add, remove }) => (
        <div className="reference-form-list">
          {fields.map(({ key, name }) => (
            <div className="reference-form-row" key={key}>
              <Form.Item name={[name, 'product']} rules={[{ required: true, message: t('選擇來源產品') }]}><Select aria-label={t('來源產品')} placeholder={t('產品')} options={productOptions.map(option => ({ ...option, label: t(option.label) }))} /></Form.Item>
              <Form.Item name={[name, 'kind']} rules={[{ required: true, message: t('選擇來源類型') }]}><Select aria-label={t('來源類型')} placeholder={t('類型')} options={kindOptions.map(option => ({ ...option, label: t(option.label) }))} /></Form.Item>
              <Form.Item name={[name, 'title']} rules={[{ required: true, whitespace: true, message: t('輸入來源標題') }]}><Input aria-label={t('來源標題')} placeholder={t('來源標題')} /></Form.Item>
              <Form.Item name={[name, 'uri']} rules={[{ required: true, whitespace: true, message: t('輸入來源 URI') }]}><Input aria-label={t('來源 URI')} placeholder={t('來源 URI')} /></Form.Item>
              <Button danger type="text" onClick={() => remove(name)} aria-label={t('移除此來源')}>{t('移除')}</Button>
            </div>
          ))}
          <Button size="small" onClick={() => add({ product: 'work', kind: 'task' })}>{t('新增來源')}</Button>
        </div>
      )}
    </Form.List>
  );
}

export function ReferenceList({ references }: { references: Reference[] }) {
  const { t } = useI18n();
  if (!references?.length) return <span className="empty-value">{t('沒有來源引用')}</span>;
  return (
    <div className="product-reference-list">
      {references.map((reference, index) => (
        <div className="product-reference-row" key={`${reference.product}-${reference.uri}-${index}`}>
          <Space size={6} wrap><Tag>{t(productOptions.find(option => option.value === reference.product)?.label ?? reference.product)}</Tag><Tag bordered={false}>{t(kindOptions.find(option => option.value === reference.kind)?.label ?? reference.kind)}</Tag><strong>{reference.title}</strong></Space>
          <code>{reference.uri}</code>
        </div>
      ))}
    </div>
  );
}
