import { useTranslation } from 'react-i18next';
import type { ProviderInfo } from '../types';
import { ProviderModelIcon } from '../../shared/ProviderModelIcon';

function getProviderOptionStyle(enabled: boolean): React.CSSProperties {
  return {
    opacity: enabled ? 1 : 0.5,
    cursor: enabled ? 'pointer' : 'not-allowed',
  };
}

interface ProviderOptionRowProps {
  provider: ProviderInfo;
  isSelected: boolean;
  label: string;
  onSelect: (providerId: string) => void;
}

/**
 * ProviderOptionRow - a single provider entry inside the provider dropdown
 */
export const ProviderOptionRow = ({
  provider,
  isSelected,
  label,
  onSelect,
}: ProviderOptionRowProps) => {
  const { t } = useTranslation();

  return (
    <div
      className={`selector-option ${isSelected ? 'selected' : ''} ${!provider.enabled ? 'disabled' : ''}`}
      role="menuitemradio"
      aria-checked={isSelected}
      aria-disabled={!provider.enabled || undefined}
      tabIndex={-1}
      onClick={() => onSelect(provider.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onSelect(provider.id);
        }
      }}
      style={getProviderOptionStyle(!!provider.enabled)}
      data-provider-id={provider.id}
    >
      <ProviderModelIcon providerId={provider.id} size={16} colored />
      <span>{label}</span>
      <span className="provider-option-trailing">
        {isSelected && (
          <span className="provider-active-dot" aria-hidden="true" />
        )}
        {provider.beta && (
          <span className="provider-beta-badge">
            {t('providers.beta.badge', { defaultValue: 'Beta' })}
          </span>
        )}
      </span>
    </div>
  );
};

export default ProviderOptionRow;
