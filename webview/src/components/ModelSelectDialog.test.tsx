import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ModelSelectDialog from './ModelSelectDialog';

const mocks = vi.hoisted(() => ({
  setDefaultModel: vi.fn(),
  options: {
    configuredModel: 'm2',
    models: [
      { id: 'm1', label: 'Model One', description: 'openai' },
      { id: 'm2', label: 'Model Two', description: 'openai' },
    ] as Array<{ id: string; label: string; description?: string }>,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => String(opts?.defaultValue ?? key)
      .replace(/\{\{(\w+)\}\}/g, (_match, name) => String(opts?.[name] ?? '')),
  }),
}));

vi.mock('../utils/defaultModel', () => ({
  setDefaultModel: mocks.setDefaultModel,
}));

vi.mock('../hooks/providers/useQwenModelOptions', () => ({
  useQwenModelOptions: () => mocks.options,
}));

describe('ModelSelectDialog', () => {
  beforeEach(() => {
    mocks.setDefaultModel.mockReset();
    mocks.options = {
      configuredModel: 'm2',
      models: [
        { id: 'm1', label: 'Model One', description: 'openai' },
        { id: 'm2', label: 'Model Two', description: 'openai' },
      ],
    };
  });

  it('marks the CLI-configured model as the current default', () => {
    render(<ModelSelectDialog isOpen onClose={vi.fn()} />);

    expect(screen.getByTestId('model-select-row-m1').getAttribute('aria-selected')).toBe('false');
    expect(screen.getByTestId('model-select-row-m2').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Model One')).toBeTruthy();
    expect(screen.getByText('Model Two')).toBeTruthy();
  });

  it('writes the selected model globally, then closes and reports it', async () => {
    mocks.setDefaultModel.mockResolvedValue({ success: true, modelId: 'm1' });
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<ModelSelectDialog isOpen onClose={onClose} onSaved={onSaved} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('model-select-row-m1'));
    });

    expect(mocks.setDefaultModel).toHaveBeenCalledWith('m1', 'openai');
    expect(onSaved).toHaveBeenCalledWith('m1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open and shows the writer error on failure', async () => {
    mocks.setDefaultModel.mockResolvedValue({
      success: false,
      code: 'model_not_found',
      error: '模型不存在：ghost',
    });
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<ModelSelectDialog isOpen onClose={onClose} onSaved={onSaved} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('model-select-row-m1'));
    });

    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('模型不存在：ghost')).toBeTruthy();
  });

  it('closes on Escape when no write is in flight', () => {
    const onClose = vi.fn();
    render(<ModelSelectDialog isOpen onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state and routes to provider settings', () => {
    mocks.options = { configuredModel: '', models: [] };
    const onClose = vi.fn();
    const onOpenProviderSettings = vi.fn();
    render(
      <ModelSelectDialog
        isOpen
        onClose={onClose}
        onOpenProviderSettings={onOpenProviderSettings}
      />,
    );

    expect(screen.getByText(/No models are configured/)).toBeTruthy();
    fireEvent.click(screen.getByText('Open provider settings'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenProviderSettings).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while closed', () => {
    const { container } = render(<ModelSelectDialog isOpen={false} onClose={vi.fn()} />);
    expect(container.querySelector('.model-select-dialog')).toBeNull();
    expect(mocks.setDefaultModel).not.toHaveBeenCalled();
  });

  it('disables rows while a write is pending', async () => {
    let resolveWrite: (value: any) => void = () => {};
    mocks.setDefaultModel.mockImplementation(() => new Promise((resolve) => {
      resolveWrite = resolve;
    }));
    const onClose = vi.fn();
    render(<ModelSelectDialog isOpen onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('model-select-row-m1'));
    });

    expect(screen.getByTestId('model-select-row-m2').hasAttribute('disabled')).toBe(true);

    await act(async () => {
      resolveWrite({ success: true, modelId: 'm1' });
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
