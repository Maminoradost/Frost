import type { CSSProperties } from 'react';
import { providerMeta } from '../lib/providers';
import type { Provider } from '../lib/types';

export function ProviderBadge({ provider, withLabel = false }: { provider: Provider; withLabel?: boolean }) {
  const meta = providerMeta(provider);
  return (
    <span className="provider-badge" style={{ '--provider': meta.color } as CSSProperties} title={meta.label}>
      <i />
      {withLabel ? meta.label : meta.short}
    </span>
  );
}
