import { memo } from 'react';
import type { TFunction } from 'i18next';

import { BlinkingLogo } from '../BlinkingLogo';
import { AnimatedText } from '../AnimatedText';
import { APP_VERSION } from '../../version/version';

const ROOT_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: '#555',
  gap: '16px',
};

const LOGO_WRAPPER_STYLE: React.CSSProperties = { position: 'relative', display: 'inline-block' };

export interface WelcomeScreenProps {
  /** Runtime CLI provider (qwen / dsh); welcome logo follows the active CLI */
  currentProvider: string;
  t: TFunction;
  onProviderChange: (provider: string) => void;
}

export const WelcomeScreen = memo(function WelcomeScreen({
  currentProvider,
  t,
  onProviderChange,
}: WelcomeScreenProps): React.ReactElement {
  const providerLabels: Record<string, string> = {
    qwen: t('providers.qwen.label', { defaultValue: 'Qwen Code' }),
    dsh: t('providers.dsh.label', { defaultValue: 'DSH' }),
  };

  return (
    <div style={ROOT_STYLE}>
      <div style={LOGO_WRAPPER_STYLE}>
        <BlinkingLogo provider={currentProvider} onProviderChange={onProviderChange} />
        <span className="version-tag">
          v{APP_VERSION}
        </span>
      </div>
      <div>
        <AnimatedText text={t('chat.sendMessage', { provider: providerLabels[currentProvider] ?? currentProvider })} />
      </div>
    </div>
  );
});
