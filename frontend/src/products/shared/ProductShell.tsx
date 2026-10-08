import type { ReactNode } from 'react';
import { Avatar, Typography } from 'antd';
import type { ProductPrincipal } from './types';
import { ProductSwitcher, type ProductKey } from './ProductSwitcher';
import { AccountControl } from '../../auth/AccountSettings';

const { Text, Title } = Typography;

export type ProductNavItem = { key: string; label: string; icon: ReactNode; count?: number };

export function ProductShell({
  product,
  productLabel,
  principal,
  sectionLabel,
  navigation,
  activeSection,
  onSectionChange,
  mode,
  serviceStatus,
  headerExtra,
  title,
  eyebrow,
  actions,
  children,
}: {
  product: Exclude<ProductKey, 'work'>;
  productLabel: string;
  principal: ProductPrincipal;
  sectionLabel: string;
  navigation: ProductNavItem[];
  activeSection: string;
  onSectionChange: (key: string) => void;
  mode: string;
  serviceStatus: 'ok' | 'error' | 'checking';
  headerExtra?: ReactNode;
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`app-shell product-shell product-${product}`}>
      <aside className="side-rail">
        <div className="side-brand"><span className="brand-mark">O</span><div><strong>Ordivant</strong><span>Agent operations</span></div></div>
        <ProductSwitcher active={product} />
        <div className="rail-label">{sectionLabel}</div>
        <nav className="rail-nav" aria-label={`${productLabel} 導覽`}>
          {navigation.map((item) => <button type="button" key={item.key} className={`nav-item${activeSection === item.key ? ' nav-item-active' : ''}`} onClick={() => onSectionChange(item.key)}><span className="nav-item-icon">{item.icon}</span><span>{item.label}</span>{item.count ? <span className="nav-count">{item.count}</span> : null}</button>)}
        </nav>
        <div className="rail-bottom">
          <div className="workspace-identity"><Avatar size={28}>{principal.name.slice(0, 1).toUpperCase()}</Avatar><div className="workspace-user"><strong>{principal.name}</strong><span>{principal.role}</span></div><AccountControl product={product} productLabel={productLabel} displayName={principal.name} businessRole={principal.role} /></div>
          <div className="rail-service"><span className={`health-dot ${serviceStatus === 'ok' ? 'health-good' : serviceStatus === 'error' ? 'health-bad' : ''}`} />{serviceStatus === 'ok' ? `${productLabel} API 已連線` : serviceStatus === 'error' ? `${productLabel} API 無法連線` : '檢查服務中'}</div>
        </div>
      </aside>
      <main className="main-pane">
        <header className="topbar product-topbar">
          <div className="topbar-project"><span className="project-caption">{productLabel}</span>{headerExtra}</div>
          <div className="topbar-right"><Text className={`product-mode${serviceStatus === 'error' ? ' product-mode-error' : ''}`}>{serviceStatus === 'error' ? 'OFFLINE' : mode === 'development' ? 'DEV' : mode === 'production' ? 'PROD' : 'API'}</Text></div>
        </header>
        <div className="workspace-content product-content">
          <div className="page-heading"><div>{eyebrow && <Text className="eyebrow">{eyebrow}</Text>}<Title level={2}>{title}</Title></div>{actions}</div>
          {children}
        </div>
      </main>
    </div>
  );
}
