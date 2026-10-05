import { expect, test, type Locator, type Page } from '@playwright/test';

type BridgeWindow = Window & typeof globalThis & {
  sendToJava?: (message: string) => void;
};

const NODE_PROCESS_SNAPSHOT = {
  snapshotAt: Date.now(),
  totals: { daemon: 1, channel: 1, orphan: 1, all: 3 },
  processes: [
    {
      id: 'daemon-1',
      kind: 'DAEMON',
      provider: 'qwen',
      pid: 3010,
      alive: true,
      startedAt: Date.now() - 120_000,
      uptimeMs: 120_000,
      command: 'node daemon.js',
      heapUsed: 42 * 1024 * 1024,
      activeRequestCount: 0,
      orphan: false,
    },
    {
      id: 'channel-1',
      kind: 'CHANNEL',
      provider: 'qwen',
      pid: 3011,
      alive: true,
      startedAt: Date.now() - 60_000,
      uptimeMs: 60_000,
      command: 'node channel.js',
      activeRequestCount: 1,
      tabName: 'QwenMate',
      orphan: false,
    },
    {
      id: 'orphan-1',
      kind: 'ORPHAN',
      provider: 'qwen',
      pid: 3012,
      alive: true,
      startedAt: Date.now() - 30_000,
      uptimeMs: 30_000,
      command: 'node orphan.js',
      activeRequestCount: 0,
      orphan: true,
    },
  ],
};

const LONG_MODEL = {
  id: 'vendor/super-long-model-name-that-should-not-force-horizontal-overflow-in-selector-menus',
  label: 'Extremely Long Qwen-Compatible Model Display Name With Multiple Provider And Capability Suffixes',
  description: 'A very long model description that should remain clipped inside the selector row instead of pushing the dropdown outside the visible webview viewport.',
};

const SEARCH_TARGET_MODEL = {
  id: 'vendor/large-model-search-target-220',
  label: 'Large Model Search Target 220',
  description: 'Model outside the initial render cap that should still be selectable through search.',
};

const LARGE_MODEL_LIST = Array.from({ length: 240 }, (_, index) => {
  if (index === 220) return SEARCH_TARGET_MODEL;
  const padded = String(index).padStart(3, '0');
  return {
    id: `vendor/large-model-${padded}`,
    label: `Large Model ${padded}`,
    description: `Large model fixture ${padded}`,
  };
});

async function installBridgeMocks(page: Page, customModels = [LONG_MODEL]) {
  await page.addInitScript(({ processSnapshot, models }) => {
    localStorage.setItem('model-selection-state', JSON.stringify({
      provider: 'qwen',
      qwenModel: 'qwen3-max',
      qwenPermissionMode: 'bypassPermissions',
      longContextEnabled: true,
      reasoningEffort: 'high',
    }));
    localStorage.setItem('qwen-custom-models', JSON.stringify(models));

    const hideVConsole = () => {
      const style = document.createElement('style');
      style.textContent = '#__vconsole { display: none !important; pointer-events: none !important; }';
      (document.head || document.documentElement)?.appendChild(style);
    };
    if (document.head || document.documentElement) {
      hideVConsole();
    } else {
      window.addEventListener('DOMContentLoaded', hideVConsole, { once: true });
    }

    const respond = (callbackName: string, payload: unknown) => {
      window.setTimeout(() => {
        const callback = (window as unknown as Record<string, unknown>)[callbackName];
        if (typeof callback === 'function') {
          callback(JSON.stringify(payload));
        }
      }, 0);
    };

    (window as BridgeWindow).sendToJava = (message: string) => {
      if (message.startsWith('get_node_processes:')) respond('updateNodeProcesses', processSnapshot);
    };
  }, {
    processSnapshot: NODE_PROCESS_SNAPSHOT,
    models: customModels,
  });
}

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

function significantErrors(errors: string[]) {
  return errors.filter((error) => !error.includes('ResizeObserver loop'));
}

async function expectInsideViewport(page: Page, locator: Locator, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label} should have a visible bounding box`).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport, 'viewport should be available').not.toBeNull();
  if (!box || !viewport) return;

  const tolerance = 2;
  expect(box.x, `${label} left edge`).toBeGreaterThanOrEqual(-tolerance);
  expect(box.y, `${label} top edge`).toBeGreaterThanOrEqual(-tolerance);
  expect(box.x + box.width, `${label} right edge`).toBeLessThanOrEqual(viewport.width + tolerance);
  expect(box.y + box.height, `${label} bottom edge`).toBeLessThanOrEqual(viewport.height + tolerance);
}

async function expectContainedWithin(container: Locator, child: Locator, label: string) {
  const containerBox = await container.boundingBox();
  const childBox = await child.boundingBox();
  expect(containerBox, `${label} container should have a visible bounding box`).not.toBeNull();
  expect(childBox, `${label} child should have a visible bounding box`).not.toBeNull();
  if (!containerBox || !childBox) return;

  const tolerance = 2;
  expect(childBox.x, `${label} left edge`).toBeGreaterThanOrEqual(containerBox.x - tolerance);
  expect(childBox.x + childBox.width, `${label} right edge`).toBeLessThanOrEqual(containerBox.x + containerBox.width + tolerance);
}

async function expectSubmenuAnchoredToRow(page: Page, trigger: Locator, submenu: Locator, label: string) {
  const triggerBox = await trigger.boundingBox();
  const submenuBox = await submenu.boundingBox();
  expect(triggerBox, `${label} trigger should have a visible bounding box`).not.toBeNull();
  expect(submenuBox, `${label} submenu should have a visible bounding box`).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport, 'viewport should be available').not.toBeNull();
  if (!triggerBox || !submenuBox || !viewport) return;

  const verticalOverlap = Math.max(
    0,
    Math.min(triggerBox.y + triggerBox.height, submenuBox.y + submenuBox.height) - Math.max(triggerBox.y, submenuBox.y),
  );
  expect(verticalOverlap, `${label} should stay vertically attached to trigger row`).toBeGreaterThan(12);

  const rightSideGap = Math.abs(submenuBox.x - (triggerBox.x + triggerBox.width));
  const leftSideGap = Math.abs(triggerBox.x - (submenuBox.x + submenuBox.width));
  const horizontalGap = Math.min(rightSideGap, leftSideGap);
  const horizontalOverlap = Math.max(
    0,
    Math.min(triggerBox.x + triggerBox.width, submenuBox.x + submenuBox.width) - Math.max(triggerBox.x, submenuBox.x),
  );

  expect(
    horizontalGap <= 48 || horizontalOverlap > 12,
    `${label} should be adjacent to or intentionally overlap trigger row`,
  ).toBe(true);
}

async function closeOpenMenus(page: Page) {
  await page.mouse.click(8, 8);
  await page.waitForTimeout(50);
}

async function openSelectorMenu(page: Page, button: Locator, label: string) {
  await button.click();
  const dropdown = page.locator('.selector-dropdown').first();
  await expect(dropdown, `${label} dropdown`).toBeVisible();
  await expectInsideViewport(page, dropdown, `${label} dropdown`);
  await closeOpenMenus(page);
}

test.beforeEach(async ({ page }, testInfo) => {
  const customModels = testInfo.title.includes('large model selector')
    ? LARGE_MODEL_LIST
    : [LONG_MODEL];
  await installBridgeMocks(page, customModels);
});

test('footer selector menus render inside the viewport', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await expect(page.locator('.button-area-left')).toBeVisible();
  await expect(page.locator('.button-area').first()).toHaveAttribute('data-provider', 'qwen');

  const buttons = page.locator('.button-area-left .selector-button');
  await expect(buttons).toHaveCount(4);

  await openSelectorMenu(page, buttons.nth(0), 'config');
  await openSelectorMenu(page, buttons.nth(1), 'provider');
  await openSelectorMenu(page, buttons.nth(2), 'mode');
  await openSelectorMenu(page, buttons.nth(3), 'model config');

  expect(significantErrors(errors)).toEqual([]);
});

test('tabbing from a pointer-opened provider menu continues through the toolbar', async ({ page }) => {
  await page.goto('/');
  const toolbarButtons = page.locator('.button-area-left .selector-button');
  const providerButton = toolbarButtons.nth(1);

  for (const { key, targetIndex } of [{ key: 'Tab', targetIndex: 2 }, { key: 'Shift+Tab', targetIndex: 0 }]) {
    await providerButton.click();
    await expect(providerButton).toBeFocused();
    await expect(page.locator('.provider-dropdown')).toBeVisible();
    await page.keyboard.press(key);
    await expect(providerButton).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.provider-dropdown')).toHaveCount(0);
    await expect(toolbarButtons.nth(targetIndex)).toBeFocused();
  }
});

test('config submenus stay visible across constrained viewports', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await expect(page.locator('.button-area-left')).toBeVisible();

  const configButton = page.locator('.button-area-left .selector-button').first();
  await configButton.click();
  const mainDropdown = page.locator('.selector-dropdown').first();
  await expect(mainDropdown).toBeVisible();
  await expectInsideViewport(page, mainDropdown, 'config dropdown');

  const nodeProcessRow = mainDropdown.getByTestId('config-option-node-processes');
  await nodeProcessRow.hover();
  const nodeDropdown = page.locator('.node-process-dropdown');
  await expect(nodeDropdown).toBeVisible();
  await expect(page.getByText('PID 3012')).toBeVisible();
  await expectInsideViewport(page, nodeDropdown, 'node process submenu');
  await expectSubmenuAnchoredToRow(page, nodeProcessRow, nodeDropdown, 'node process submenu');

  const runtimeProviderRow = mainDropdown.getByTestId('config-option-runtime-provider');
  await runtimeProviderRow.hover();
  const runtimeDropdown = page.locator('.runtime-provider-dropdown');
  await expect(runtimeDropdown).toBeVisible();
  await expectInsideViewport(page, runtimeDropdown, 'runtime provider submenu');
  await expectSubmenuAnchoredToRow(page, runtimeProviderRow, runtimeDropdown, 'runtime provider submenu');

  const agentRow = mainDropdown.getByTestId('config-option-agent');
  await agentRow.hover();
  const agentDropdown = agentRow.locator('.selector-dropdown').first();
  await expect(agentDropdown).toBeVisible();
  await expectInsideViewport(page, agentDropdown, 'agent submenu');
  await expectSubmenuAnchoredToRow(page, agentRow, agentDropdown, 'agent submenu');

  expect(significantErrors(errors)).toEqual([]);
});

test('long model and mode text stays contained in selector menus', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await expect(page.locator('.button-area-left')).toBeVisible();

  const buttons = page.locator('.button-area-left .selector-button');
  await expect(buttons).toHaveCount(4);

  await buttons.nth(2).click();
  const modeDropdown = page.locator('.selector-dropdown').first();
  await expect(modeDropdown).toBeVisible();
  await expectInsideViewport(page, modeDropdown, 'mode dropdown with long descriptions');
  const longModeOption = modeDropdown.getByTestId('mode-option-bypassPermissions');
  const longModeDescription = longModeOption.locator('.mode-description');
  await expect(longModeDescription).toBeVisible();
  await expectContainedWithin(longModeOption, longModeDescription, 'long mode description');
  await closeOpenMenus(page);

  await buttons.nth(3).click();
  const modelConfigDropdown = page.locator('.model-config-dropdown');
  await expect(modelConfigDropdown).toBeVisible();
  await expectInsideViewport(page, modelConfigDropdown, 'model config dropdown');
  const modelDropdown = modelConfigDropdown.getByTestId('model-selector-dropdown');
  await expect(modelDropdown).toBeVisible();
  await expectInsideViewport(page, modelDropdown, 'model dropdown with long custom model');
  const longModelOption = modelDropdown.locator('.selector-option').filter({ hasText: LONG_MODEL.label }).first();
  const longModelLabel = longModelOption.locator('span').filter({ hasText: LONG_MODEL.label }).first();
  const longModelDescription = longModelOption.locator('span').filter({ hasText: LONG_MODEL.description }).first();
  await expect(longModelLabel).toBeVisible();
  await expect(longModelDescription).toBeVisible();
  await expectContainedWithin(longModelOption, longModelLabel, 'long model label');
  await expectContainedWithin(longModelOption, longModelDescription, 'long model description');

  expect(significantErrors(errors)).toEqual([]);
});

test('large model selector remains searchable and capped', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await expect(page.locator('.button-area-left')).toBeVisible();

  const modelButton = page.locator('.button-area-left .selector-button').nth(3);
  await modelButton.click();
  const modelConfigDropdown = page.locator('.model-config-dropdown');
  await expect(modelConfigDropdown).toBeVisible();
  const modelDropdown = modelConfigDropdown.getByTestId('model-selector-dropdown');
  await expect(modelDropdown).toBeVisible();
  await expectInsideViewport(page, modelConfigDropdown, 'large model dropdown');

  const renderedLargeModels = modelDropdown.getByText(/^Large Model \d{3}$/);
  await expect(renderedLargeModels).toHaveCount(100);
  await expect(modelDropdown.getByTestId('model-hidden-count')).toBeVisible();
  await expect(modelDropdown.getByText(SEARCH_TARGET_MODEL.label)).toHaveCount(0);

  const searchInput = modelDropdown.getByTestId('model-search-input');
  await expect(searchInput).toBeVisible();
  await searchInput.fill('Search Target 220');

  const targetOption = modelDropdown.locator('.selector-option').filter({ hasText: SEARCH_TARGET_MODEL.label }).first();
  await expect(targetOption).toBeVisible();
  await targetOption.click();
  await expect(targetOption).toHaveClass(/selected/);

  expect(significantErrors(errors)).toEqual([]);
});
