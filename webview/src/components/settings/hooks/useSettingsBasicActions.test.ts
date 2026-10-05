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
        provider: 'qwen',
        effectiveProvider: 'qwen',
        resolutionSource: 'manual',
      });
    });

    const promptEnhancerBefore = result.current.promptEnhancerConfig;

    act(() => {
      result.current.handleCommitAiModelChange('provider/model-a');
    });

    expect(result.current.commitAiConfig.models.qwen).toBe('provider/model-a');
    expect(result.current.promptEnhancerConfig).toEqual(promptEnhancerBefore);
    expect(window.sendToJava).toHaveBeenCalledWith(
      `set_commit_ai_config:${JSON.stringify({
        provider: 'qwen',
        models: {
          ...defaultCommitAiConfig.models,
          qwen: 'provider/model-a',
        },
      })}`
    );
  });

  it('prompt enhancer auto mode follows current chat provider when available', () => {
    const { result } = renderHook(() => useSettingsBasicActions({ currentProvider: 'qwen' }));

    act(() => {
      result.current.setPromptEnhancerConfig({
        provider: null,
        effectiveProvider: 'qwen',
        resolutionSource: 'auto',
        models: { ...DEFAULT_AI_FEATURE_MODELS },
        availability: {
          qwen: true,
        },
      });
    });

    act(() => {
      result.current.handlePromptEnhancerResetToDefault();
    });

    expect(result.current.promptEnhancerConfig.provider).toBeNull();
    expect(result.current.promptEnhancerConfig.effectiveProvider).toBe('qwen');
    expect(result.current.promptEnhancerConfig.resolutionSource).toBe('auto');
  });

  it('commit AI auto mode falls back to qwen when the chat provider is unavailable', () => {
    const { result } = renderHook(() => useSettingsBasicActions({ currentProvider: 'other-cli' }));

    act(() => {
      result.current.setCommitAiConfig({
        provider: null,
        effectiveProvider: 'qwen',
        resolutionSource: 'auto',
        models: { ...DEFAULT_AI_FEATURE_MODELS },
        availability: {
          qwen: true,
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
