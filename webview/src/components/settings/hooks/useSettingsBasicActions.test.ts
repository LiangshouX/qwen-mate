import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useSettingsBasicActions } from './useSettingsBasicActions';
import type { CommitAiConfig } from '../../../types/aiFeatureConfig';
import { DEFAULT_AI_FEATURE_MODELS } from '../../../types/aiFeatureConfig';
import type { CodeFontConfig } from '../../../types/uiFontConfig';

describe('useSettingsBasicActions', () => {
  const defaultCommitAiConfig: CommitAiConfig = {
    provider: null,
    effectiveProvider: 'qwen',
    resolutionSource: 'auto',
    models: { ...DEFAULT_AI_FEATURE_MODELS },
    availability: {
      qwen: true,
      dsh: true,
    },
  };

  beforeEach(() => {
    window.sendToJava = vi.fn();
  });

  it('updates commit AI provider without mutating prompt enhancer state', () => {
    const { result } = renderHook(() => useSettingsBasicActions({}));

    act(() => {
      result.current.setCommitAiConfig(defaultCommitAiConfig);
    });

    const promptEnhancerBefore = result.current.promptEnhancerConfig;

    act(() => {
      result.current.handleCommitAiProviderChange('qwen');
    });

    expect(result.current.commitAiConfig.provider).toBe('qwen');
    expect(result.current.promptEnhancerConfig).toEqual(promptEnhancerBefore);
    expect(window.sendToJava).toHaveBeenCalledWith(
      `set_commit_ai_config:${JSON.stringify({
        provider: 'qwen',
        models: defaultCommitAiConfig.models,
      })}`
    );
  });

  it('updates commit AI model without mutating prompt enhancer models', () => {
    const { result } = renderHook(() => useSettingsBasicActions({}));

    act(() => {
      result.current.setCommitAiConfig({
        ...defaultCommitAiConfig,
        provider: 'dsh',
        effectiveProvider: 'dsh',
        resolutionSource: 'manual',
      });
    });

    const promptEnhancerBefore = result.current.promptEnhancerConfig;

    act(() => {
      result.current.handleCommitAiModelChange('provider/model-a');
    });

    expect(result.current.commitAiConfig.models.dsh).toBe('provider/model-a');
    expect(result.current.promptEnhancerConfig).toEqual(promptEnhancerBefore);
    expect(window.sendToJava).toHaveBeenCalledWith(
      `set_commit_ai_config:${JSON.stringify({
        provider: 'dsh',
        models: {
          ...defaultCommitAiConfig.models,
          dsh: 'provider/model-a',
        },
      })}`
    );
  });

  it('can select a beta CLI provider for commit AI settings', () => {
    const { result } = renderHook(() => useSettingsBasicActions({}));

    act(() => {
      result.current.setCommitAiConfig({
        ...defaultCommitAiConfig,
        availability: { ...defaultCommitAiConfig.availability, dsh: true },
      });
    });

    act(() => {
      result.current.handleCommitAiProviderChange('dsh');
    });

    expect(result.current.commitAiConfig.provider).toBe('dsh');
    expect(result.current.commitAiConfig.effectiveProvider).toBe('dsh');
    expect(result.current.commitAiConfig.resolutionSource).toBe('manual');
    expect(window.sendToJava).toHaveBeenCalledWith(
      expect.stringContaining('"provider":"dsh"')
    );
  });

  it('prompt enhancer auto mode follows current chat provider when available', () => {
    const { result } = renderHook(() => useSettingsBasicActions({ currentProvider: 'dsh' }));

    act(() => {
      result.current.setPromptEnhancerConfig({
        provider: null,
        effectiveProvider: 'qwen',
        resolutionSource: 'auto',
        models: { ...DEFAULT_AI_FEATURE_MODELS },
        availability: {
          qwen: true,
          dsh: true,
        },
      });
    });

    act(() => {
      result.current.handlePromptEnhancerResetToDefault();
    });

    expect(result.current.promptEnhancerConfig.provider).toBeNull();
    expect(result.current.promptEnhancerConfig.effectiveProvider).toBe('dsh');
    expect(result.current.promptEnhancerConfig.resolutionSource).toBe('auto');
  });

  it('commit AI auto mode falls back to qwen when the chat provider is unavailable', () => {
    const { result } = renderHook(() => useSettingsBasicActions({ currentProvider: 'dsh' }));

    act(() => {
      result.current.setCommitAiConfig({
        provider: null,
        effectiveProvider: 'dsh',
        resolutionSource: 'auto',
        models: { ...DEFAULT_AI_FEATURE_MODELS },
        availability: {
          qwen: true,
          dsh: false,
        },
      });
    });

    act(() => {
      result.current.handleCommitAiResetToDefault();
    });

    expect(result.current.commitAiConfig.provider).toBeNull();
    expect(result.current.commitAiConfig.effectiveProvider).toBe('qwen');
    expect(result.current.commitAiConfig.resolutionSource).toBe('auto');
  });

  it('prompt enhancer auto effectiveProvider updates when chat CLI changes', () => {
    const { result, rerender } = renderHook(
      ({ currentProvider }) => useSettingsBasicActions({ currentProvider }),
      { initialProps: { currentProvider: 'qwen' } },
    );

    act(() => {
      result.current.setPromptEnhancerConfig({
        provider: null,
        effectiveProvider: 'qwen',
        resolutionSource: 'auto',
        models: { ...DEFAULT_AI_FEATURE_MODELS },
        availability: {
          qwen: true,
          dsh: true,
        },
      });
    });

    rerender({ currentProvider: 'dsh' });

    expect(result.current.promptEnhancerConfig.provider).toBeNull();
    expect(result.current.promptEnhancerConfig.effectiveProvider).toBe('dsh');
    expect(result.current.promptEnhancerConfig.resolutionSource).toBe('auto');
  });

  it('commit AI auto effectiveProvider updates when chat CLI changes', () => {
    const { result, rerender } = renderHook(
      ({ currentProvider }) => useSettingsBasicActions({ currentProvider }),
      { initialProps: { currentProvider: 'qwen' } },
    );

    act(() => {
      result.current.setCommitAiConfig({
        provider: null,
        effectiveProvider: 'qwen',
        resolutionSource: 'auto',
        models: { ...DEFAULT_AI_FEATURE_MODELS },
        availability: {
          qwen: true,
          dsh: true,
        },
      });
    });

    rerender({ currentProvider: 'dsh' });

    expect(result.current.commitAiConfig.provider).toBeNull();
    expect(result.current.commitAiConfig.effectiveProvider).toBe('dsh');
    expect(result.current.commitAiConfig.resolutionSource).toBe('auto');
  });

  it('sends independent code font updates without mutating ui font state', () => {
    const { result } = renderHook(() => useSettingsBasicActions({}));

    act(() => {
      result.current.handleCodeFontSelectionChange('followEditor');
    });

    expect(window.sendToJava).not.toHaveBeenCalledWith(
      'set_ui_font_config:{"mode":"customFile"}'
    );
    expect(window.sendToJava).toHaveBeenCalledWith(
      'set_code_font_config:{"mode":"followEditor"}'
    );
  });

  it('sends a code font customFile update when a saved path exists', () => {
    const { result } = renderHook(() => useSettingsBasicActions({}));

    const customCodeFontConfig: CodeFontConfig = {
      mode: 'customFile',
      effectiveMode: 'customFile',
      customFontPath: '/tmp/my-code-font.ttf',
      fontFamily: 'QwenMate Code Custom',
      fontSize: 13,
      lineSpacing: 1,
    };

    act(() => {
      result.current.setCodeFontConfig(customCodeFontConfig);
    });

    act(() => {
      result.current.handleCodeFontSelectionChange('customFile');
    });

    expect(window.sendToJava).toHaveBeenCalledWith(
      'set_code_font_config:{"mode":"customFile","customFontPath":"/tmp/my-code-font.ttf"}'
    );
  });

  it('does not send anything when switching to customFile without a saved path (silent no-op)', () => {
    const { result } = renderHook(() => useSettingsBasicActions({}));

    act(() => {
      result.current.handleCodeFontSelectionChange('customFile');
    });

    expect(window.sendToJava).not.toHaveBeenCalled();
  });
});
