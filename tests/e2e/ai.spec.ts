import { test, expect } from '@playwright/test';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, 'E2E_EMAIL/E2E_PASSWORD not set');

test('AI failure does not crash calendar flow', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Log In' }).click();

  await page.goto('/calendar');
  await page.route('/api/calendar/ai', route =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: { message: 'AI down' } }),
    })
  );

  await page.getByLabel('Describe your event').fill('Schedule a meeting tomorrow');
  await page.getByRole('button', { name: /generate|add event/i }).click();

  await expect(page.getByText(/AI down|problem generating/i)).toBeVisible();
});

