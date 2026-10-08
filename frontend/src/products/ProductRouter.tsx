import { lazy, Suspense } from 'react';
import { Spin } from 'antd';
import type { ProductKey } from './shared/ProductSwitcher';

const standaloneMode = ['work', 'knowledge', 'code'].includes(import.meta.env.MODE)
  ? import.meta.env.MODE as ProductKey
  : null;
const standaloneApp = import.meta.env.MODE === 'work'
  ? lazy(() => import('../App'))
  : import.meta.env.MODE === 'knowledge'
    ? lazy(() => import('./knowledge/KnowledgeApp'))
    : import.meta.env.MODE === 'code'
      ? lazy(() => import('./code/CodeApp'))
      : null;
const suiteApps = import.meta.env.MODE === 'suite'
  ? {
      work: lazy(() => import('../App')),
      knowledge: lazy(() => import('./knowledge/KnowledgeApp')),
      code: lazy(() => import('./code/CodeApp')),
    }
  : null;

function routeProduct(): ProductKey {
  if (standaloneMode) return standaloneMode;
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  if (path === '/work') return 'work';
  if (path === '/knowledge') return 'knowledge';
  if (path === '/code') return 'code';
  return 'work';
}

export default function ProductRouter() {
  const product = routeProduct();
  const Application = standaloneApp ?? suiteApps?.[product];
  if (!Application) return <div className="app-loading">找不到產品工作區</div>;
  return <Suspense fallback={<div className="app-loading"><Spin /></div>}><Application /></Suspense>;
}
