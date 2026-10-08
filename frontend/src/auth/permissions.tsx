import { useCallback, useEffect, useState } from 'react';
import { Select } from 'antd';
import { api } from '../api';
import { createProductApi, productApiPrefix } from '../products/shared/productApi';
import type { Space as KnowledgeSpace } from '../products/shared/types';
import type { AuthPermissions, ProductKey, ProductScope } from './types';
import { formatNumber, useI18n } from '../i18n';

export type PermissionCatalog = { status: 'idle' | 'loading' | 'ready' | 'error'; scopes: ProductScope[]; error: string };
export type PermissionCatalogs = Record<ProductKey, PermissionCatalog>;

export const emptyPermissionCatalogs: PermissionCatalogs = {
  work: { status: 'idle', scopes: [], error: '' },
  knowledge: { status: 'idle', scopes: [], error: '' },
  code: { status: 'idle', scopes: [], error: '' },
};

const productCopy: Record<ProductKey, { label: string; roles: Array<{ value: string; label: string }>; scopeLabel: string }> = {
  work: { label: 'Work', roles: [{ value: 'manager', label: '管理者' }, { value: 'worker', label: '工作者' }, { value: 'reviewer', label: '審核者' }], scopeLabel: '專案' },
  knowledge: { label: 'Knowledge', roles: [{ value: 'manager', label: '管理者' }, { value: 'writer', label: '編輯者' }, { value: 'reader', label: '讀者' }], scopeLabel: '空間' },
  code: { label: 'Code', roles: [{ value: 'manager', label: '管理者' }, { value: 'writer', label: '編輯者' }, { value: 'reader', label: '讀者' }], scopeLabel: '專案' },
};

const knowledgeApi = createProductApi(productApiPrefix('knowledge'));
const codeApi = createProductApi(productApiPrefix('code'));

async function fetchScopes(product: ProductKey): Promise<ProductScope[]> {
  if (product === 'work') {
    const projects = await api.projects();
    return projects.map((project) => ({ id: project.id, key: project.key, name: project.name }));
  }
  if (product === 'knowledge') {
    const spaces = await knowledgeApi.get<KnowledgeSpace[]>('/spaces');
    return spaces.map((space) => ({ id: space.id, key: space.key, name: space.name }));
  }
  const projects = await codeApi.get<Array<{ id: string; key: string; name: string }>>('/projects');
  return projects.map((project) => ({ id: project.id, key: project.key, name: project.name }));
}

function errorText(error: unknown) {
  if (error instanceof Error && 'sourceMessage' in error) return String(error.sourceMessage);
  return error instanceof Error ? error.message : '請求失敗，請稍後重試。';
}

export function usePermissionCatalogs() {
  const [catalogs, setCatalogs] = useState<PermissionCatalogs>(emptyPermissionCatalogs);
  const reload = useCallback(async () => {
    setCatalogs({
      work: { status: 'loading', scopes: [], error: '' },
      knowledge: { status: 'loading', scopes: [], error: '' },
      code: { status: 'loading', scopes: [], error: '' },
    });
    const products: ProductKey[] = ['work', 'knowledge', 'code'];
    await Promise.all(products.map(async (product) => {
      try {
        const scopes = await fetchScopes(product);
        setCatalogs((current) => ({ ...current, [product]: { status: 'ready', scopes, error: '' } }));
      } catch (catalogError) {
        setCatalogs((current) => ({ ...current, [product]: { status: 'error', scopes: [], error: errorText(catalogError) } }));
      }
    }));
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { catalogs, reload };
}

export function PermissionEditor({ value, catalogs, onChange }: { value: AuthPermissions; catalogs: PermissionCatalogs; onChange: (next: AuthPermissions) => void }) {
  const { t } = useI18n();
  const products = Object.keys(productCopy) as ProductKey[];
  function update(product: ProductKey, field: 'role' | 'scope_ids', fieldValue: string | string[] | undefined) {
    const current = value[product];
    const next = { ...value };
    if (field === 'role' && !fieldValue) delete next[product];
    else {
      const updated = {
        role: field === 'role' ? String(fieldValue) : current?.role ?? productCopy[product].roles[0].value,
        scope_ids: field === 'scope_ids' ? (fieldValue as string[]) : current?.scope_ids ?? [],
      };
      if (product === 'work') next.work = updated as AuthPermissions['work'];
      if (product === 'knowledge') next.knowledge = updated as AuthPermissions['knowledge'];
      if (product === 'code') next.code = updated as AuthPermissions['code'];
    }
    onChange(next);
  }

  return (
    <div className="auth-permission-editor">
      {products.map((product) => {
        const copy = productCopy[product];
        const roles = copy.roles.map((role) => ({ ...role, label: t(role.label) }));
        const catalog = catalogs[product];
        const permission = value[product];
        return (
          <section className="auth-permission-row" key={product}>
            <div className="auth-permission-title"><strong>{copy.label}</strong><span>{catalog.status === 'ready' ? t('{{count}} {{scope}}', { count: formatNumber(catalog.scopes.length), scope: t(copy.scopeLabel) }) : catalog.status === 'loading' ? t('載入資源中') : catalog.status === 'error' ? t(catalog.error) : t('資源尚未載入')}</span></div>
            <div className="auth-permission-fields">
              <Select allowClear placeholder={t('不授予此產品')} value={permission?.role} options={roles} disabled={catalog.status !== 'ready'} onChange={(role) => update(product, 'role', role)} />
              <Select mode="multiple" allowClear placeholder={t('選擇 {{scope}}', { scope: t(copy.scopeLabel) })} value={permission?.scope_ids ?? []} options={catalog.scopes.map((scope) => ({ value: scope.id, label: `${scope.key ? `${scope.key} · ` : ''}${scope.name}` }))} disabled={catalog.status !== 'ready' || !permission?.role} onChange={(ids) => update(product, 'scope_ids', ids)} maxTagCount="responsive" />
            </div>
          </section>
        );
      })}
    </div>
  );
}
