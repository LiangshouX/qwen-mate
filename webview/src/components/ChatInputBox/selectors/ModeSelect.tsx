import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AVAILABLE_MODES, type ModeInfo, type PermissionMode } from '../types';
import { useDropdownPosition } from '../../../hooks/useDropdownPosition';

const RELATIVE_INLINE_BLOCK_STYLE: React.CSSProperties = { position: 'relative', display: 'inline-block' };
const CHEVRON_ICON_STYLE: React.CSSProperties = { fontSize: '10px', marginLeft: '2px' };
const DROPDOWN_STYLE: React.CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  marginBottom: '4px',
  zIndex: 10000,
  maxWidth: 'calc(100vw - 16px)',
  overflowX: 'hidden',
};
const MODE_INFO_STYLE: React.CSSProperties = { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden' };
const MODE_TEXT_STYLE: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

function getModeOptionStyle(disabled: boolean): React.CSSProperties {
  return {
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

interface ModeSelectProps {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  provider?: string;
}

/**
 * ModeSelect - Mode selector component
 * Supports switching between manual, agent, plan, provider-native auto, and
 * Full Auto modes.
 */
export const ModeSelect = ({
  value,
  onChange,
}: ModeSelectProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { positionedStyle, recalculate } = useDropdownPosition({
    buttonRef,
    dropdownRef,
    preferredAlignment: 'right',
  });

  const modeOptions = AVAILABLE_MODES;

  const currentMode = modeOptions.find((m: ModeInfo) => m.id === value) || modeOptions[0];

  // Helper function to get translated mode text
  const getModeText = (modeId: PermissionMode, field: 'label' | 'shortLabel' | 'tooltip' | 'description') => {
    if (field === 'shortLabel') {
      return t(`modes.${modeId}.shortLabel`, { defaultValue: t(`modes.${modeId}.label`) });
    }
    return t(`modes.${modeId}.${field}`);
  };

  /**
   * Toggle dropdown
   */
  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen) {
      recalculate();
    }
  }, [isOpen, recalculate]);

  /**
   * Select mode
   */
  const handleSelect = useCallback((mode: PermissionMode, disabled?: boolean) => {
    if (disabled) return; // Disabled options cannot be selected
    onChange(mode);
    setIsOpen(false);
  }, [onChange]);

  /**
   * Close on outside click
   */
  useEffect(() => {
    if (!isOpen) return;

    // Delay arming the listener to prevent the opening click from closing it
    let armed = false;
    const timer = setTimeout(() => { armed = true; }, 0);
    const handleClickOutside = (e: MouseEvent) => {
      if (!armed) return;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    if (isOpen) {
      recalculate();
    }
  }, [isOpen, recalculate]);

  return (
    <div style={RELATIVE_INLINE_BLOCK_STYLE}>
      <button
        ref={buttonRef}
        className={`selector-button${value === 'yolo' ? ' mode-full-auto-active' : ''}`}
        onClick={handleToggle}
        title={getModeText(currentMode.id, 'tooltip') || `${t('chat.currentMode', { mode: getModeText(currentMode.id, 'label') })}`}
      >
        <span className={`codicon ${currentMode.icon}`} />
        <span className="selector-button-text">{getModeText(currentMode.id, 'shortLabel')}</span>
        <span className={`codicon codicon-chevron-${isOpen ? 'up' : 'down'}`} style={CHEVRON_ICON_STYLE} />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="selector-dropdown"
          style={{ ...DROPDOWN_STYLE, ...positionedStyle }}
        >
          {modeOptions.map((mode) => (
            <div
              key={mode.id}
              data-testid={`mode-option-${mode.id}`}
              className={`selector-option ${mode.id === value ? 'selected' : ''} ${mode.disabled ? 'disabled' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => handleSelect(mode.id, mode.disabled)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSelect(mode.id, mode.disabled);
                }
              }}
              title={getModeText(mode.id, 'tooltip')}
              style={getModeOptionStyle(!!mode.disabled)}
            >
              <span className={`codicon ${mode.icon}`} />
              <div style={MODE_INFO_STYLE}>
                <span style={MODE_TEXT_STYLE}>{getModeText(mode.id, 'label')}</span>
                <span className="mode-description" style={MODE_TEXT_STYLE}>{getModeText(mode.id, 'description')}</span>
              </div>
              {mode.id === value && (
                <span className="codicon codicon-check check-mark" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ModeSelect;
