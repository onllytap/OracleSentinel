import { expect, test, type Page } from '@playwright/test';

const openWidget = async (page: Page) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');

  const launcher = page.getByTestId('chat-launcher');
  await expect(launcher).toBeVisible();
  await launcher.click();

  const openChat = page.getByTestId('open-chat-button');
  await expect(openChat).toBeVisible();
  await openChat.click();

  await expect(page.getByTestId('chat-panel')).toBeVisible();

  return { pageErrors };
};

test('chat launcher opens the panel without console crashes', async ({ page }) => {
  const { pageErrors } = await openWidget(page);

  await expect(page.getByTestId('messages-welcome-screen')).toBeVisible();
  await expect(page.getByTestId('bottom-nav')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('bottom navigation switches primary widget views', async ({ page }) => {
  const { pageErrors } = await openWidget(page);

  await page.getByTestId('bottom-nav-home').click();
  await expect(page.getByTestId('welcome-screen')).toBeVisible();

  await page.getByTestId('bottom-nav-messages').click();
  await expect(page.getByTestId('messages-welcome-screen')).toBeVisible();

  await page.getByTestId('bottom-nav-contact').click();
  await expect(page.getByTestId('contact-screen')).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('chat widget keeps a usable mobile panel', async ({ page }) => {
  const { pageErrors } = await openWidget(page);
  const panelBox = await page.getByTestId('chat-panel').boundingBox();

  expect(panelBox?.width).toBeGreaterThan(300);
  await expect(page.getByTestId('bottom-nav')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('chat widget handles backend unavailability cleanly', async ({ page }) => {
  const { pageErrors } = await openWidget(page);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const textbox = page.getByTestId('chat-input');
    if (await textbox.isVisible().catch(() => false)) {
      break;
    }

    const start = page.getByTestId('start-chat-button');
    await expect(start).toBeVisible();
    await start.click();
  }

  const textbox = page.getByTestId('chat-input');
  await expect(textbox).toBeVisible();
  await textbox.fill('Bonjour');

  const sendButton = page.getByTestId('chat-send');
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  await expect(page.getByText('Bonjour', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/service est temporairement indisponible/i),
  ).toBeVisible({ timeout: 20000 });
  expect(pageErrors).toEqual([]);
});
