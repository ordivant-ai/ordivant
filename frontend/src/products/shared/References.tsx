import { Button, Form, Input, Select, Space, Tag } from 'antd';
import type { Reference } from './types';

const productOptions = [
  { value: 'work', label: 'Work' },
  { value: 'knowledge', label: 'Knowledge' },
  { value: 'code', label: 'Code' },
  { value: 'external', label: 'External' },
];

const kindOptions = [
  { value: 'task', label: '任務' },
  { value: 'document_version', label: '文件版本' },
  { value: 'pull_request', label: 'Pull request' },
  { value: 'test_report', label: '測試報告' },
  { value: 'url', label: '網址' },
];

export function ReferenceFields() {
  return (
    <Form.List name="source_refs">
      {(fields, { add, remove }) => (
        <div className="reference-form-list">
          {fields.map(({ key, name }) => (
            <div className="reference-form-row" key={key}>
              <Form.Item name={[name, 'product']} rules={[{ required: true, message: '選擇來源產品' }]}><Select aria-label="來源產品" placeholder="產品" options={productOptions} /></Form.Item>
              <Form.Item name={[name, 'kind']} rules={[{ required: true, message: '選擇來源類型' }]}><Select aria-label="來源類型" placeholder="類型" options={kindOptions} /></Form.Item>
              <Form.Item name={[name, 'title']} rules={[{ required: true, whitespace: true, message: '輸入來源標題' }]}><Input aria-label="來源標題" placeholder="來源標題" /></Form.Item>
              <Form.Item name={[name, 'uri']} rules={[{ required: true, whitespace: true, message: '輸入來源 URI' }]}><Input aria-label="來源 URI" placeholder="來源 URI" /></Form.Item>
              <Button danger type="text" onClick={() => remove(name)} aria-label="移除此來源">移除</Button>
            </div>
          ))}
          <Button size="small" onClick={() => add({ product: 'work', kind: 'task' })}>新增來源</Button>
        </div>
      )}
    </Form.List>
  );
}

export function ReferenceList({ references }: { references: Reference[] }) {
  if (!references?.length) return <span className="empty-value">沒有來源引用</span>;
  return (
    <div className="product-reference-list">
      {references.map((reference, index) => (
        <div className="product-reference-row" key={`${reference.product}-${reference.uri}-${index}`}>
          <Space size={6} wrap><Tag>{reference.product}</Tag><Tag bordered={false}>{reference.kind}</Tag><strong>{reference.title}</strong></Space>
          <code>{reference.uri}</code>
        </div>
      ))}
    </div>
  );
}
