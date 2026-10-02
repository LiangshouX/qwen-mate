import { expect, test, type Page } from '@playwright/test';

type InputTestWindow = Window & typeof globalThis & {
  __sentMessages: string[];
  sendToJava?: (message: string) => void;
  updateSendShortcut?: (payload: string) => void;
};

async function sentMessages(page: Page) {
  return page.evaluate(() => (window as InputTestWindow).__sentMessages);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('model-selection-state', JSON.stringify({
      provider: 'qwen',
      qwenModel: 'qwen3-max',
      qwenPermissionMode: 'bypassPermissions',
    }));

    const bridge = window as InputTestWindow;
    bridge.__sentMessages = [];
    bridge.sendToJava = (message) => {
      if (message.startsWith('send_message:')) {
        const payload = JSON.parse(message.slice('send_message:'.length)) as { text: string };
        bridge.__sentMessages.push(payload.text);
      }
      if (message.startsWith('get_dependency_status:')) {
        setTimeout(() => {
          const callback = (window as unknown as Record<string, unknown>).updateDependencyStatus;
          if (typeof callback === 'function') {
            callback(JSON.stringify({
              'qwen-sdk': { status: 'installed', meetsMinimumVersion: true },
            }));
          }
        }, 0);
      }
    };
  });
  await page.goto('/');
  await expect(page.locator('.input-editable')).toBeVisible();
  await expect(page.locator('.sdk-warning-bar')).toHaveCount(0);
  await page.addStyleTag({ content: '#__vconsole { display: none !important; }' });
});

test('Enter sends once and a held key cannot submit the next draft', async ({ page }) => {
  const editable = page.locator('.input-editable');
  await editable.fill('first message');
  await page.keyboard.down('Enter');
  await expect.poll(() => sentMessages(page)).toEqual(['first message']);
  await expect(editable).toBeEmpty();

  await page.keyboard.insertText('next draft');
  await page.keyboard.down('Enter');
  await expect(editable).toHaveText('next draft');
  await page.keyboard.up('Enter');
  await expect.poll(() => sentMessages(page)).toEqual(['first message']);
});

test('Shift+Enter preserves a multiline message before Enter sends it', async ({ page }) => {
  const editable = page.locator('.input-editable');
  await editable.fill('first line');
  await editable.press('Shift+Enter');
  await page.keyboard.insertText('second line');
  await expect(editable).toHaveText('first line\nsecond line', { useInnerText: true });
  await editable.press('Enter');

  await expect.poll(() => sentMessages(page)).toEqual(['first line\nsecond line']);
  await expect(editable).toBeEmpty();
});

test('Cmd/Ctrl+Enter mode lets plain Enter insert a paragraph and uses the new shortcut', async ({ page }) => {
  await page.evaluate(() => {
    (window as InputTestWindow).updateSendShortcut?.(JSON.stringify({ sendShortcut: 'cmdEnter' }));
  });
  const editable = page.locator('.input-editable');
  await expect(editable).toHaveAttribute('data-placeholder', /⌘Enter/);
  await editable.fill('first line');
  await editable.press('Enter');
  await page.keyboard.insertText('second line');
  expect(await sentMessages(page)).toEqual([]);
  await editable.press('Control+Enter');

  await expect.poll(() => sentMessages(page)).toEqual(['first line\nsecond line']);
  await expect(editable).toBeEmpty();
});

test('IME confirmation keeps an unfinished composition separate from sending', async ({ page, context }) => {
  const editable = page.locator('.input-editable');
  await editable.click();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 });
  await page.keyboard.press('Enter');
  // Let the post-composition guard expire while Chromium still owns the composition.
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await expect(editable).toHaveText('中');
  expect(await sentMessages(page)).toEqual([]);

  await cdp.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 });
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await expect(editable).toHaveText('中文');
  expect(await sentMessages(page)).toEqual([]);

  await cdp.send('Input.insertText', { text: '中文' });
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await expect.poll(() => sentMessages(page)).toEqual(['中文']);
  await expect(editable).toBeEmpty();
});

test('leaving the chat before debounce preserves the latest draft', async ({ page }) => {
  await page.locator('.input-editable').evaluate((editable) => {
    editable.textContent = 'draft saved while leaving';
    editable.dispatchEvent(new InputEvent('input', { inputType: 'insertText', bubbles: true }));
    const settingsButton = document.querySelector('.header .codicon-settings-gear')?.closest('button');
    settingsButton?.click();
  });
  await expect(page.locator('.input-editable')).toHaveCount(0);
  await page.locator('button:has(.codicon-arrow-left)').click();

  await expect(page.locator('.input-editable')).toHaveText('draft saved while leaving');
  expect(await sentMessages(page)).toEqual([]);
});
