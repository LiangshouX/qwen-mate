import {
  resetSlashCommandsState,
  slashCommandProvider,
} from './slashCommandProvider.js';

describe('slashCommandProvider', () => {
  beforeEach(() => {
    resetSlashCommandsState();
    delete window.updateSlashCommands;
    delete window.__pendingSlashCommands;
    delete window.updateRuntimeSlashCommands;
    delete window.__pendingRuntimeSlashCommands;
  });

  it('ignores malformed optional metadata without failing the whole payload', async () => {
    const resultPromise = slashCommandProvider('', new AbortController().signal);

    window.updateSlashCommands?.(JSON.stringify([
      { name: '/review', type: { unexpected: true }, source: 42, description: { unexpected: true } },
    ]));

    await expect(resultPromise).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'review',
        label: '/review',
        description: '',
        contentType: 'command',
      }),
    ]));
  });

  it('keeps valid entries when an earlier entry is malformed', async () => {
    const resultPromise = slashCommandProvider('', new AbortController().signal);

    window.updateSlashCommands?.(JSON.stringify([
      { invalid: true },
      { name: '/review', description: 'Review' },
    ]));

    await expect(resultPromise).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'review', label: '/review' }),
    ]));
  });

  it('suggests /doctor since it is a real Qwen Code command', async () => {
    const resultPromise = slashCommandProvider('', new AbortController().signal);

    window.updateSlashCommands?.(JSON.stringify([
      { name: '/doctor', description: 'Run diagnostics' },
    ]));

    const result = await resultPromise;
    expect(result.map(cmd => cmd.label)).toContain('/doctor');
  });

  it('calibrates suggestions against the CLI runtime list', async () => {
    const resultPromise = slashCommandProvider('', new AbortController().signal);

    window.updateSlashCommands?.(JSON.stringify([
      { name: '/compress', description: 'Compress the conversation' },
      { name: '/theme', description: 'Change the visual theme' },
      { name: '/resume', description: 'Resume a previous conversation' },
      { name: '/custom-skill', description: 'Project skill' },
    ]));
    // Names only, no leading "/", same shape as the [SLASH_COMMANDS] payload.
    window.updateRuntimeSlashCommands?.(JSON.stringify(['compress', 'brand-new']));

    const labels = (await resultPromise).map(cmd => cmd.label);

    expect(labels).toContain('/compress');
    expect(labels).toContain('/resume');      // GUI-handled: never reaches the CLI
    expect(labels).toContain('/clear');       // local new-session entry
    expect(labels).not.toContain('/theme');   // rejected by the CLI in this mode
    expect(labels).not.toContain('/custom-skill');
    expect(labels).toContain('/brand-new');   // runtime command missing from the table
  });
});
