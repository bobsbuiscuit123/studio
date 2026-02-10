import { test, expect } from '@playwright/test';

const email = process.env.E2E_MEMBER_EMAIL;
const password = process.env.E2E_MEMBER_PASSWORD;

test.skip(!email || !password, 'E2E_MEMBER_EMAIL/E2E_MEMBER_PASSWORD not set');

test('member cannot create announcement', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Log In' }).click();

  await page.goto('/announcements');
  await expect(page.getByText(/Access Denied|not available/i)).toBeVisible();
});

