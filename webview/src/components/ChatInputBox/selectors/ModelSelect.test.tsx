import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ModelSelect } from './ModelSelect';
import { QWEN_MODELS, type ModelInfo } from '../types';

const LABELS: Record<string, string> = {
  'models.qwen.coderPlus.label': 'Qwen3-Coder-Plus',
  'models.qwen.coderFlash.label': 'Qwen3-Coder-Flash',
  'models.qwen.max.label': 'Qwen-Max',
  'models.qwen.plus.label': 'Qwen-Plus',
  'models.qwen.turbo.label': 'Qwen-Turbo',
  'models.qwen.followCliDefault.label': '默认（跟随 CLI 配置）',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => options?.model ?? LABELS[key] ?? key,
  }),
}));

describe('ModelSelect', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('Qwen 模型列表应按序展示，自定义模型在前', () => {
    const customModel: ModelInfo = {
      id: 'my-custom-model',
      label: 'My Custom Model',
      description: 'User-defined custom model',
    };

    render(
      <ModelSelect
        value={customModel.id}
        onChange={vi.fn()}
        models={[customModel, ...QWEN_MODELS]}
        currentProvider="qwen"
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    const ids = screen
      .getAllByTestId(/^model-option-/)
      .map((el) => el.getAttribute('data-testid')!.replace('model-option-', ''));
    expect(ids).toEqual([customModel.id, ...QWEN_MODELS.map((model) => model.id)]);

    // Built-in Qwen entries resolve their i18n labels in the list.
    expect(screen.getByText('Qwen3-Coder-Plus')).toBeTruthy();
    expect(screen.getByText('Qwen-Max')).toBeTruthy();
  });

  it('loading 时应显示加载状态', () => {
    render(
      <ModelSelect
        value="auto"
        onChange={vi.fn()}
        models={[
          {
            id: 'auto',
            label: 'DSH Auto',
            description: 'Use the model configured in the DSH Web UI',
          },
        ]}
        currentProvider="dsh"
        loading
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('model-loading')).toBeTruthy();
    expect(screen.getByText('chat.loadingDropdown')).toBeTruthy();
  });

  it('error 时应显示失败状态并支持点击重试', () => {
    const onRetry = vi.fn();
    render(
      <ModelSelect
        value="auto"
        onChange={vi.fn()}
        models={[
          {
            id: 'auto',
            label: 'DSH Auto',
            description: 'Use the model configured in the DSH Web UI',
          },
        ]}
        currentProvider="dsh"
        error="llm.models failed"
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    const errorRow = screen.getByTestId('model-load-error');
    expect(errorRow).toBeTruthy();
    expect(screen.getByText('chat.modelsLoadFailed')).toBeTruthy();

    fireEvent.click(errorRow);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('loading 时不应同时显示 error 状态', () => {
    render(
      <ModelSelect
        value="auto"
        onChange={vi.fn()}
        models={[{ id: 'auto', label: 'DSH Auto' }]}
        currentProvider="dsh"
        loading
        error="timeout"
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('model-loading')).toBeTruthy();
    expect(screen.queryByTestId('model-load-error')).toBeNull();
  });

  // Long third-party catalogs use `vendor/model` ids. The dropdown groups them
  // by vendor prefix and offers search once the list is long enough.
  const catalogModels: ModelInfo[] = [
    { id: 'opencode/big-pickle', label: 'opencode/Big-Pickle', description: 'opencode/big-pickle' },
    { id: 'opencode/longcat-2.0-free', label: 'opencode/Longcat-2.0-Free', description: 'opencode/longcat-2.0-free' },
    { id: 'anthropic/claude-sonnet-4', label: 'anthropic/Claude-Sonnet-4', description: 'anthropic/claude-sonnet-4' },
    { id: 'deepseek/deepseek-v4-flash-free', label: 'deepseek/Deepseek-V4-Flash-Free', description: 'deepseek/deepseek-v4-flash-free' },
    { id: 'xiaomi/mimo-v2.5-free', label: 'xiaomi/Mimo-V2.5-Free', description: 'xiaomi/mimo-v2.5-free' },
    { id: 'laguna/laguna-s-2.1-free', label: 'laguna/Laguna-S-2.1-Free', description: 'laguna/laguna-s-2.1-free' },
    { id: 'ling/ling-3.0-tiny-free', label: 'ling/Ling-3.0-Tiny-Free', description: 'ling/ling-3.0-tiny-free' },
    { id: 'nvidia/nemotron-3-ultra-free', label: 'nvidia/Nemotron-3-Ultra-Free', description: 'nvidia/nemotron-3-ultra-free' },
  ];

  it('长列表应显示搜索并按 vendor 前缀分组', () => {
    render(
      <ModelSelect
        value="opencode/big-pickle"
        onChange={vi.fn()}
        models={catalogModels}
        currentProvider="dsh"
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('model-search-input')).toBeTruthy();
    expect(screen.getByTestId('model-group-opencode')).toBeTruthy();
    expect(screen.getByTestId('model-group-anthropic')).toBeTruthy();
    expect(screen.getByTestId('model-group-deepseek')).toBeTruthy();
  });

  it('搜索应过滤模型并隐藏空分组', () => {
    render(
      <ModelSelect
        value="opencode/big-pickle"
        onChange={vi.fn()}
        models={catalogModels}
        currentProvider="dsh"
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByTestId('model-search-input'), {
      target: { value: 'deepseek' },
    });

    expect(screen.getByTestId('model-option-deepseek/deepseek-v4-flash-free')).toBeTruthy();
    expect(screen.queryByTestId('model-option-opencode/big-pickle')).toBeNull();
    // Empty vendor groups disappear; a single remaining match stays flat (no group header).
    expect(screen.queryByTestId('model-group-opencode')).toBeNull();
    expect(screen.queryByTestId('model-group-deepseek')).toBeNull();
  });

  it('置顶后模型应出现在 Pinned 分组顶部', () => {
    render(
      <ModelSelect
        value="opencode/big-pickle"
        onChange={vi.fn()}
        models={catalogModels}
        currentProvider="dsh"
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByTestId('model-pin-deepseek/deepseek-v4-flash-free'));

    expect(screen.getByTestId('model-group-__pinned__')).toBeTruthy();
    const pinnedSection = screen.getByTestId('model-section-__pinned__');
    expect(pinnedSection.textContent).toContain('deepseek/Deepseek-V4-Flash-Free');
  });

  // Custom/third-party catalogs carry their own labels; ModelSelect must render
  // them verbatim (only the built-in Qwen ids go through i18n label keys).
  it('自定义目录标签应原样显示', () => {
    const catalogModel: ModelInfo = {
      id: 'acme/widget-4',
      label: 'Acme Widget-4',
      description: 'acme/widget-4',
    };

    render(
      <ModelSelect
        value={catalogModel.id}
        onChange={vi.fn()}
        models={[catalogModel]}
        currentProvider="dsh"
      />,
    );

    expect(screen.getByRole('button').textContent).toContain('Acme Widget-4');
  });

  // The empty id is the "Default (follow CLI config)" entry: trigger and list
  // row must render the localized label — never a blank name or a concrete
  // model — and keep the configured-model suffix the resolver built.
  it('空 id 条目应渲染"默认（跟随 CLI 配置）"标签', () => {
    render(
      <ModelSelect
        value=""
        onChange={vi.fn()}
        models={[{ id: '', label: '' }, ...QWEN_MODELS]}
        currentProvider="qwen"
      />,
    );

    expect(screen.getByRole('button').textContent).toContain('默认（跟随 CLI 配置）');

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('model-option-').textContent).toContain('默认（跟随 CLI 配置）');
  });

  it('列表缺少空 id 条目时触发器仍显示本地化默认文案', () => {
    render(
      <ModelSelect
        value=""
        onChange={vi.fn()}
        models={QWEN_MODELS}
        currentProvider="qwen"
      />,
    );

    const triggerText = screen.getByRole('button').textContent ?? '';
    expect(triggerText).toContain('默认（跟随 CLI 配置）');
    // …and never snaps to the first concrete model.
    expect(triggerText).not.toContain('Qwen3-Coder-Plus');
  });

  it('默认条目应原样展示 configuredModel 后缀', () => {
    render(
      <ModelSelect
        value=""
        onChange={vi.fn()}
        models={[
          { id: '', label: '默认（跟随 CLI 配置 · mimo-v2.6-pro）' },
          ...QWEN_MODELS,
        ]}
        currentProvider="qwen"
      />,
    );

    expect(screen.getByRole('button').textContent).toContain('默认（跟随 CLI 配置 · mimo-v2.6-pro）');

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('model-option-').textContent).toContain('默认（跟随 CLI 配置 · mimo-v2.6-pro）');
  });
});
