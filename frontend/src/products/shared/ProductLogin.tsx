import { AuthScreen } from '../../auth/AuthScreen';
import type { ProductKey } from './ProductSwitcher';

export function ProductLogin({ product, productName }: { product: Exclude<ProductKey, 'work'>; productName: string }) {
  return <AuthScreen product={product} productName={`Ordivant ${productName}`} />;
}
