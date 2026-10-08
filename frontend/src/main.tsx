import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, Spin } from 'antd';
import zhTW from 'antd/locale/zh_TW';
import { Suspense, lazy } from 'react';
import './styles.css';
import './products/products.css';
import { getPopupContainer, PopupLayer } from './shared/PopupLayer';

const ProductRouter = lazy(() => import('./products/ProductRouter'));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhTW}
      getPopupContainer={getPopupContainer}
      theme={{
        token: {
          motion: false,
          colorPrimary: '#6c55c6',
          colorText: '#26252a',
          colorTextSecondary: '#77747d',
          colorBgLayout: '#f4f2ef',
          colorBgContainer: '#fffefd',
          colorBorder: '#e6e2dd',
          borderRadius: 6,
          fontFamily: 'Inter, "Noto Sans TC", "Microsoft JhengHei", sans-serif',
          controlHeight: 36,
        },
      }}
    >
      <PopupLayer />
      <Suspense fallback={<div className="app-loading"><Spin /></div>}>
        <ProductRouter />
      </Suspense>
    </ConfigProvider>
  </React.StrictMode>,
);
