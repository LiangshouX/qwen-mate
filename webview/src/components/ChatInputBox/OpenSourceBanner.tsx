import type { TFunction } from 'i18next';
import { openBrowser, DOCS_SITE_URL } from '../../utils/bridge';

/**
 * OpenSourceBanner - Open source banner
 * Displays the open source docs/dismiss banner
 */
export const OpenSourceBanner = ({
  show,
  onDismiss,
  t,
}: {
  show?: boolean;
  onDismiss?: () => void;
  t: TFunction;
}) => {
  if (!show) {
    return null;
  }

  return (
    <div className="open-source-banner">
      <span className="banner-text">{t('chat.openSourceBanner')}</span>
      <button
        type="button"
        className="banner-star"
        aria-label={t('chat.openSourceBannerStarAria')}
        onClick={(e) => {
          e.stopPropagation();
          openBrowser(DOCS_SITE_URL);
        }}
      >
        <svg
          className="star-icon"
          viewBox="0 0 24 24"
          width="12"
          height="12"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
        <span className="banner-star-text">{t('chat.openSourceBannerStar')}</span>
      </button>
      <button
        className="banner-close"
        aria-label="Close"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss?.();
        }}
      >
        &#x2715;
      </button>
    </div>
  );
};

export default OpenSourceBanner;
