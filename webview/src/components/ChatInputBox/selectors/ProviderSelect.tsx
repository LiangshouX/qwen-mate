import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AVAILABLE_PROVIDERS } from '../types';
import { ProviderModelIcon } from '../../shared/ProviderModelIcon';
import AlertDialog from '../../AlertDialog';
import { useDropdownPosition } from '../../../hooks/useDropdownPosition';
import { useBetaProviderNotice } from '../../../hooks/useBetaProviderNotice';
import { useHiddenCliProviders } from '../../../hooks/useCliProviderVisibility';
import { ProviderOptionRow } from './ProviderOptionRow';
import { ProviderCliFooter } from './ProviderCliFooter';

const RELATIVE_INLINE_BLOCK_STYLE: React.CSSProperties = { position: 'relative', display: 'inline-block' };
const CHEVRON_ICON_STYLE: React.CSSProperties = { fontSize: '10px', marginLeft: '2px' };
const DROPDOWN_STYLE: React.CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  marginBottom: '4px',
  zIndex: 10000,
  maxWidth: 'calc(100vw - 16px)',
};
const TOAST_STYLE: React.CSSProperties = { zIndex: 20000 };

interface ProviderSelectProps {
  value: string;
  onChange?: (providerId: string) => void;
  /** When true, shows only the provider icon without text or chevron */
  compact?: boolean;
  /** Open Settings → Providers → CLI management from the dropdown footer */
  onOpenCliSettings?: () => void;
}

/**
 * ProviderSelect - AI provider selector component
 * Supports switching between Claude, Codex, Gemini, and other providers
 * compact mode: icon-only button for toolbar use
 */
export const ProviderSelect = ({ value, onChange, compact = false, onOpenCliSettings }: ProviderSelectProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openingFocusRef = useRef<'selected' | 'first' | 'last' | null>(null);
  const { positionedStyle, maxHeight, recalculate } = useDropdownPosition({ buttonRef, dropdownRef });
  const betaNotice = useBetaProviderNotice();

  const currentProvider = AVAILABLE_PROVIDERS.find(p => p.id === value) || AVAILABLE_PROVIDERS[0];
  // Hidden CLI providers stay usable when already active; they are only
  // removed from the switcher menu below.
  const hiddenProviders = useHiddenCliProviders();
  const visibleProviders = AVAILABLE_PROVIDERS.filter((p) => !hiddenProviders.has(p.id));

  // Helper function to get translated provider label
  const getProviderLabel = (providerId: string) => {
    return t(`providers.${providerId}.label`);
  };

  const closeMenu = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpen) {
      closeMenu();
    } else {
      openingFocusRef.current = e.detail === 0 ? 'selected' : null;
      setIsOpen(true);
    }
  }, [isOpen, closeMenu]);

  const focusMenuItem = useCallback((position: 'selected' | 'first' | 'last') => {
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    if (!items?.length) return;
    const selected = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    const target = position === 'selected' ? selected ?? items[0]
      : position === 'last' ? items[items.length - 1] : items[0];
    target.focus();
  }, []);

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const position = event.key === 'ArrowDown' ? 'first' : 'last';
      if (isOpen) {
        focusMenuItem(position);
      } else {
        openingFocusRef.current = position;
        setIsOpen(true);
      }
    } else if (event.key === 'Tab' && isOpen) {
      // Pointer opening leaves focus here; remove the footer before native Tab navigation.
      closeMenu();
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    }
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      buttonRef.current?.focus();
      return;
    }
    if (event.key === 'Tab') {
      // Exit from the trigger's place in the toolbar instead of the removed row.
      closeMenu();
      buttonRef.current?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const items = Array.from(dropdownRef.current?.querySelectorAll<HTMLElement>(
      '[role="menuitemradio"], .provider-cli-footer-btn',
    ) ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  /**
   * Show toast message
   */
  const showToastMessage = useCallback((message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
    }, 1500);
  }, []);

  /**
   * Select provider
   */
  const handleSelect = useCallback((providerId: string) => {
    const provider = AVAILABLE_PROVIDERS.find(p => p.id === providerId);

    if (!provider) return;

    const proceed = () => {
      if (!provider.enabled) {
        showToastMessage(t('settings.provider.featureComingSoon'));
        return;
      }
      onChange?.(providerId);
    };

    // Close the menu immediately so the beta dialog is not hidden behind it.
    closeMenu();
    buttonRef.current?.focus();
    // First click on a Beta provider shows an informational notice once.
    // Disabled providers skip the notice — they only show the coming-soon toast.
    betaNotice.requestSelect(!!provider.beta && provider.enabled, proceed);
  }, [onChange, showToastMessage, t, betaNotice, closeMenu]);

  /**
   * Close on outside click
   */
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        !dropdownRef.current?.contains(e.target as Node)
        && !buttonRef.current?.contains(e.target as Node)
      ) {
        closeMenu();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, closeMenu]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    recalculate();
    if (openingFocusRef.current) {
      focusMenuItem(openingFocusRef.current);
      openingFocusRef.current = null;
    }
  }, [isOpen, recalculate, focusMenuItem]);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('resize', recalculate);
    return () => window.removeEventListener('resize', recalculate);
  }, [isOpen, recalculate]);

  return (
    <>
      <div
        style={RELATIVE_INLINE_BLOCK_STYLE}
        onBlur={(event) => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) closeMenu();
        }}
      >
        <button
          type="button"
          ref={buttonRef}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={isOpen ? menuId : undefined}
          className={`selector-button${compact ? ' provider-compact' : ''}`}
          onClick={handleToggle}
          onKeyDown={handleTriggerKeyDown}
          title={`${t('config.switchProvider')}: ${getProviderLabel(currentProvider.id)}`}
        >
          <ProviderModelIcon providerId={currentProvider.id} size={compact ? 16 : 12} colored={compact} />
          {!compact && (
            <>
              <span>{getProviderLabel(currentProvider.id)}</span>
              <span className={`codicon codicon-chevron-${isOpen ? 'up' : 'down'}`} style={CHEVRON_ICON_STYLE} />
            </>
          )}
        </button>

        {isOpen && (
          <div
            ref={dropdownRef}
            className="selector-dropdown provider-dropdown provider-dropdown--scrollable"
            style={{ ...DROPDOWN_STYLE, ...positionedStyle, maxHeight }}
            onKeyDown={handleMenuKeyDown}
          >
            <div className="provider-option-list">
              <div ref={menuRef} id={menuId} role="menu" aria-label={t('config.switchProvider')}>
                {visibleProviders.map((provider) => (
                  <ProviderOptionRow
                    key={provider.id}
                    provider={provider}
                    isSelected={provider.id === value}
                    label={getProviderLabel(provider.id)}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
              {onOpenCliSettings && (
                <div>
                  <ProviderCliFooter
                    onOpenCliSettings={() => {
                      closeMenu();
                      onOpenCliSettings();
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Toast message */}
      {showToast && createPortal(
        <div className="selector-toast" style={TOAST_STYLE}>
          {toastMessage}
        </div>,
        document.body
      )}

      <AlertDialog
        isOpen={betaNotice.isOpen}
        type="warning"
        title={t('providers.beta.title', { defaultValue: 'Beta Feature' })}
        message={t('providers.beta.message', {
          defaultValue:
            'This feature is still in Beta. If you encounter any bugs, please report them to the author promptly.',
        })}
        confirmText={t('common.gotIt', { defaultValue: 'Got it' })}
        onClose={() => {
          betaNotice.close();
          buttonRef.current?.focus();
        }}
      />
    </>
  );
};

export default ProviderSelect;
