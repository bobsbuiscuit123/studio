import { test, expect } from '@playwright/test';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.skip(!email || !password, 'E2E_EMAIL/E2E_PASSWORD not set');

test('create org and announcement', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Log In' }).click();

  await expect(page.getByText('Your Clubs')).toBeVisible();

  await page.getByRole('button', { name: /create club|create a club/i }).click();
  await page.getByLabel('Club Name').fill(`E2E Club ${Date.now()}`);
  await page.getByLabel('Category').click();
  await page.getByRole('option', { name: 'STEM' }).click();
  await page.getByLabel('Description').fill('E2E club description');
  await page.getByLabel('Meeting Time').fill('Fridays 5pm');
  await page.getByRole('button', { name: /create/i }).click();

  await expect(page.getByText('Club created successfully!')).toBeVisible();

  await page.goto('/announcements');
  await page.getByRole('button', { name: /new announcement|create announcement/i }).click();
  await page.getByLabel('Title').fill('E2E Announcement');
  await page.getByLabel('Content').fill('Hello from E2E tests');
  await page.getByRole('button', { name: /post announcement|post/i }).click();

  await expect(page.getByText('Announcement posted successfully!')).toBeVisible();
});

