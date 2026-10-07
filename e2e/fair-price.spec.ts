import { expect, test } from '@playwright/test';

const EXAMPLE = 'דירת 4 חדרים בגבעתיים, 95 מ״ר, קומה 3 עם מעלית, מבקשים 3.9 מיליון';

test.beforeEach(({ page }) => {
  // Any console error — including a CSP violation from the self-only policy — fails the test.
  page.on('console', (msg) => {
    if (msg.type() === 'error') throw new Error(`console error: ${msg.text()}`);
  });
});

test('search → numbers, explanation and comparables, in RTL, without sideways scrolling', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.getByLabel('תארו את הנכס').fill(EXAMPLE);
  await page.getByRole('button', { name: 'בדיקת מחיר' }).click();

  await expect(page.getByRole('heading', { name: 'המחיר המבוקש נמוך מטווח העסקאות הדומות' })).toBeVisible();
  await expect(page.getByText('נוסח אוטומטי')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'העסקאות הדומות ביותר' })).toBeVisible();
  await expect(page.getByText('המערכת פועלת ללא AI')).toBeVisible();

  // The range reads low→high, not flipped by bidi ("4.5–3.5").
  await expect(page.getByText(/3\.5–4\.5/).first()).toBeVisible();

  // The page never scrolls sideways (the comparables table scrolls inside its card).
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // The search is in the fragment (never sent to the server), not the query string.
  const url = new URL(page.url());
  expect(url.search).toBe('');
  expect(new URLSearchParams(url.hash.slice(1)).get('q')).toBe(EXAMPLE);
});

test('tapping a number in the explanation shows where it came from', async ({ page }) => {
  await page.goto(`/#q=${encodeURIComponent(EXAMPLE)}`);
  const fact = page.getByRole('button', { name: /3,900,000/ }).first();
  await fact.click();
  await expect(fact).toHaveAttribute('aria-expanded', 'true');
  const panelId = await fact.getAttribute('aria-controls');
  await expect(page.locator(`[id="${panelId}"]`)).toContainText('המחיר המבוקש');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('editing a chip re-analyzes and survives a reload', async ({ page }) => {
  await page.goto(`/#q=${encodeURIComponent(EXAMPLE)}`);
  await page.getByRole('button', { name: /חדרים: 4 חד׳/ }).click();
  await page.getByLabel('חדרים', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'עדכון החישוב' }).click();
  await expect(page.getByRole('button', { name: /חדרים: 3 חד׳/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: /חדרים: 3 חד׳/ })).toBeVisible();
});

test('no city → asks, and picking one shows a result', async ({ page }) => {
  await page.goto(`/#q=${encodeURIComponent('דירת 3 חדרים 70 מ״ר, 2.1 מיליון')}`);
  await expect(page.getByText('באיזו עיר נמצא הנכס?')).toBeVisible();
  await page.getByLabel('הערים שיש לנו עליהן נתונים:').selectOption('חולון');
  await expect(page.getByRole('heading', { name: /טווח העסקאות הדומות|טווח המחירים/ })).toBeVisible();
});
