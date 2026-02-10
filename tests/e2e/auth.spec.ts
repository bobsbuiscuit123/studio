import { test, expect } from '@playwright/test';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, 'E2E_EMAIL/E2E_PASSWORD not set');

test('login/logout flow', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Log In' }).click();

  await expect(page.getByText('Your Clubs')).toBeVisible();

  await page.getByRole('button', { name: /logout/i }).click();
  await expect(page.getByText('Log In to ClubHub AI')).toBeVisible();
});

