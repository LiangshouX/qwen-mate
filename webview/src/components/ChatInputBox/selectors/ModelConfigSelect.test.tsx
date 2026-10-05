import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelConfigSelect, SUBMENU_HOVER_DELAY_MS, SUBMENU_TRIGGER_DELAY_MS } from './ModelConfigSelect';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; model?: string }) =>
      options?.model ?? LABELS[key] ?? options?.defaultValue ?? key,
  }),
}));

const LABELS: Record<string, string> = {
  'models.qwen.coderPlus.label': 'Qwen3-Coder-Plus',
  'models.qwen.coderFlash.label': 'Qwen3-Coder-Flash',
};

const qwenModels = [
  { id: 'qwen3-coder-plus', label: 'Qwen3-Coder-Plus', description: 'Coding flagship' },
  { id: 'qwen3-coder-flash', label: 'Qwen3-Coder-Flash', description: 'Fast coding model' },
];

describe('ModelConfigSelect', () => {
  it('collapses model and effort into one summary trigger', () => {
    render(
      <ModelConfigSelect
        selectedModel="qwen3-coder-plus"
        onModelSelect={vi.fn()}
        models={qwenModels}
        currentProvider="qwen"
        reasoningEffort="high"
        onReasoningChange={vi.fn()}
      />,
    );

    const trigger = screen.getByTestId('model-config-trigger');
    expect(trigger.textContent).toContain('Qwen3-Coder-Plus');
    expect(trigger.textContent).toContain('High');
    expect(screen.queryByTestId('model-config-dropdown')).toBeNull();
  });

  it('shows the model list flat with the function rows below it', () => {
    render(
      <ModelConfigSelect
        selectedModel="qwen3-coder-plus"
        onModelSelect={vi.fn()}
        models={qwenModels}
        currentProvider="qwen"
        reasoningEffort="high"
        onReasoningChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('model-config-trigger'));

    // Model list is inline, not behind a fly-out row.
    expect(screen.getByTestId('model-selector-dropdown')).toBeTruthy();
    expect(screen.getByTestId('model-option-qwen3-coder-plus')).toBeTruthy();
    // The effort row sits below the model list, next to the trigger.
    const modelList = screen.getByTestId('model-selector-dropdown');
    expect(
      modelList.compareDocumentPosition(screen.getByTestId('model-config-option-effort'))
        & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Effort is a row that opens a fly-out.
    expect(screen.getByTestId('model-config-option-effort')).toBeTruthy();
    expect(screen.getByTestId('model-config-option-effort').textContent).toContain('High');
    expect(screen.queryByTestId('reasoning-selector-dropdown')).toBeNull();
  });

  it('selects a model from the inline list without closing the popover', () => {
    const onModelSelect = vi.fn();
    render(
      <ModelConfigSelect
        selectedModel="qwen3-coder-plus"
        onModelSelect={onModelSelect}
        models={qwenModels}
        currentProvider="qwen"
        reasoningEffort="high"
        onReasoningChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('model-config-trigger'));
    fireEvent.click(screen.getByTestId('model-option-qwen3-coder-flash'));

    expect(onModelSelect).toHaveBeenCalledWith('qwen3-coder-flash');
    expect(screen.getByTestId('model-config-dropdown')).toBeTruthy();
  });

  it('opens the effort fly-out and selects a new level, closing the menu', () => {
    const onReasoningChange = vi.fn();
    render(
      <ModelConfigSelect
        selectedModel="qwen3-coder-plus"
        onModelSelect={vi.fn()}
        models={qwenModels}
        currentProvider="qwen"
        reasoningEffort="high"
        onReasoningChange={onReasoningChange}
      />,
    );

    fireEvent.click(screen.getByTestId('model-config-trigger'));
    fireEvent.click(screen.getByTestId('model-config-option-effort'));

    expect(screen.getByTestId('reasoning-selector-dropdown')).toBeTruthy();
    fireEvent.click(screen.getByText('Low'));

    expect(onReasoningChange).toHaveBeenCalledWith('low');
    expect(screen.queryByTestId('model-config-dropdown')).toBeNull();
  });

  it('keeps the effort row for every model (no model-based hiding)', () => {
    render(
      <ModelConfigSelect
        selectedModel="qwen3-coder-flash"
        onModelSelect={vi.fn()}
        models={qwenModels}
        currentProvider="qwen"
        reasoningEffort="high"
        onReasoningChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('model-config-trigger'));
    expect(screen.getByTestId('model-config-option-effort')).toBeTruthy();
    expect(screen.getByTestId('model-selector-dropdown')).toBeTruthy();
  });

  it('renders the follow-CLI label for the empty model id in the summary trigger', () => {
    render(
      <ModelConfigSelect
        selectedModel=""
        onModelSelect={vi.fn()}
        models={[{ id: '', label: '' }, ...qwenModels]}
        currentProvider="qwen"
        reasoningEffort="high"
        onReasoningChange={vi.fn()}
      />,
    );

    const trigger = screen.getByTestId('model-config-trigger');
    expect(trigger.textContent).toContain('默认（跟随 CLI 配置）');
    // The empty id must never render as a concrete model.
    expect(trigger.textContent).not.toContain('Qwen3-Coder-Plus');
  });

  it('keeps the configured-model suffix on the follow-CLI summary entry', () => {
    render(
      <ModelConfigSelect
        selectedModel=""
        onModelSelect={vi.fn()}
        models={[
          { id: '', label: '默认（跟随 CLI 配置 · mimo-v2.6-pro）' },
          ...qwenModels,
        ]}
        currentProvider="qwen"
        reasoningEffort="high"
        onReasoningChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('model-config-trigger').textContent).toContain(
      '默认（跟随 CLI 配置 · mimo-v2.6-pro）',
    );
  });

  describe('submenu hover delay', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('dismisses the effort fly-out when the pointer moves onto the flat model list', () => {
      render(
        <ModelConfigSelect
          selectedModel="qwen3-coder-plus"
          onModelSelect={vi.fn()}
          models={qwenModels}
          currentProvider="qwen"
          reasoningEffort="high"
          onReasoningChange={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId('model-config-trigger'));
      fireEvent.mouseEnter(screen.getByTestId('model-config-option-effort'));
      act(() => {
        vi.advanceTimersByTime(SUBMENU_TRIGGER_DELAY_MS);
      });
      expect(screen.getByTestId('reasoning-selector-dropdown')).toBeTruthy();

      fireEvent.mouseEnter(screen.getByTestId('model-selector-dropdown'));
      act(() => {
        vi.advanceTimersByTime(SUBMENU_HOVER_DELAY_MS);
      });
      expect(screen.queryByTestId('reasoning-selector-dropdown')).toBeNull();
      // The main popover stays open; only the fly-out is dismissed.
      expect(screen.getByTestId('model-config-dropdown')).toBeTruthy();
    });

    it('delays the first fly-out so a passing pointer does not trigger it', () => {
      render(
        <ModelConfigSelect
          selectedModel="qwen3-coder-plus"
          onModelSelect={vi.fn()}
          models={qwenModels}
          currentProvider="qwen"
          reasoningEffort="high"
          onReasoningChange={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId('model-config-trigger'));
      fireEvent.mouseEnter(screen.getByTestId('model-config-option-effort'));

      // Passing by: no fly-out yet.
      act(() => {
        vi.advanceTimersByTime(SUBMENU_TRIGGER_DELAY_MS - 1);
      });
      expect(screen.queryByTestId('reasoning-selector-dropdown')).toBeNull();

      // Leaving the row before the delay cancels the pending open.
      fireEvent.mouseEnter(screen.getByTestId('model-selector-dropdown'));
      act(() => {
        vi.advanceTimersByTime(SUBMENU_TRIGGER_DELAY_MS);
      });
      expect(screen.queryByTestId('reasoning-selector-dropdown')).toBeNull();

      // Resting on the row for the full delay opens the fly-out.
      fireEvent.mouseEnter(screen.getByTestId('model-config-option-effort'));
      act(() => {
        vi.advanceTimersByTime(SUBMENU_TRIGGER_DELAY_MS);
      });
      expect(screen.getByTestId('reasoning-selector-dropdown')).toBeTruthy();
    });
  });
});
