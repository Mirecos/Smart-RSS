import { expect, test, type Page } from '@playwright/test';

const FIXTURES = 'http://127.0.0.1:4599';

const ADMIN = { username: 'admin', password: 'e2e-admin-password' };

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 10_000 });
test.setTimeout(60_000);

/** Signs in through the login page. */
async function signIn(page: Page, username: string, password: string) {
  await page.goto('/');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Feeds' })).toBeVisible();
}

test('shows the login page and rejects a wrong password', async ({ page }) => {
  await page.goto('/sources');
  await expect(page.getByRole('heading', { name: 'Sign in to Smart RSS' })).toBeVisible();

  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText('Invalid username or password')).toBeVisible();
});

test.describe('as admin', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ADMIN.username, ADMIN.password);
  });

  test('rejects an incomplete source form', async ({ page }) => {
    await page.goto('/sources/new');

    await page.getByRole('button', { name: 'Save source' }).click();

    await expect(page.getByText(/Please fix \d+ problem/)).toBeVisible();
  });

  test('adds an RSS feed, reads and stars an item', async ({ page }) => {
    await page.goto('/sources/new');
    await page.getByLabel('URL').fill(`${FIXTURES}/feed.xml`);
    await page.getByLabel('Name').fill('Example Blog');

    await expect(page.getByText('2 items', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Save source' }).click();

    await expect(page).toHaveURL(/\/source\/\d+$/);
    const row = page.getByRole('button', { name: /First & foremost/ });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect(page.getByRole('heading', { name: 'First & foremost' })).toBeVisible();
    await expect(page.locator('.article-content')).toContainText('Full content');
    await expect(page.locator('.article-content script')).toHaveCount(0);

    await page.getByRole('button', { name: '☆ Star' }).click();
    await page.goto('/starred');
    await expect(page.getByRole('button', { name: /First & foremost/ })).toBeVisible();
  });

  test('builds an HTML scraper with the live preview and full-text extraction', async ({
    page,
  }) => {
    await page.goto('/sources/new');
    await page.getByRole('button', { name: /Web page \(CSS selectors\)/ }).click();
    await page.getByLabel('URL').fill(`${FIXTURES}/blog`);
    await page.getByLabel('Name').fill('Scraped blog');
    await page.getByLabel('Item selector').fill('article.post');
    await page.getByLabel('Title path').fill('h2.title');

    await expect(page.getByText('Post one').first()).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Full-text extraction').selectOption('readability');
    await page.getByRole('button', { name: 'Save source' }).click();

    await expect(page).toHaveURL(/\/source\/\d+$/);
    const row = page.getByRole('button', { name: /Post one/ });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect(page.locator('.article-content')).toContainText('complete article text');
  });

  test('maps an arbitrary JSON API with JSONPath', async ({ page }) => {
    await page.goto('/sources/new');
    await page.getByRole('button', { name: /JSON API/ }).click();
    await page.getByLabel('URL').fill(`${FIXTURES}/api.json`);
    await page.getByLabel('Name').fill('Posts API');
    await page.getByLabel('Items path (JSONPath)').fill('$.data.posts[*]');
    await page.getByLabel('Title path').fill('headline');
    await page.getByLabel('Link path').fill('permalink');

    await expect(page.getByText('Hello API').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Save source' }).click();

    await expect(page).toHaveURL(/\/source\/\d+$/);
    await expect(page.getByRole('button', { name: /Bye API/ })).toBeVisible({ timeout: 15_000 });
  });

  test('manages sources, categories and exports', async ({ page }) => {
    const request = page.request; // shares the signed-in session cookie
    await page.goto('/sources');
    const table = page.getByRole('table');
    for (const name of ['Example Blog', 'Scraped blog', 'Posts API']) {
      await expect(table.getByRole('link', { name, exact: true })).toBeVisible();
    }

    await page.goto('/settings');
    await page.getByLabel('New category name').fill('News');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(
      page.getByRole('navigation', { name: 'Feeds' }).getByRole('link', { name: 'News' }),
    ).toBeVisible();

    const opml = await request.get('/api/opml');
    expect(await opml.text()).toContain('Example Blog');
    const rss = await request.get('/feeds/all.rss');
    expect(rss.headers()['content-type']).toContain('application/rss+xml');
    expect(await rss.text()).toContain('Hello API');
  });

  test('creates a read-only user', async ({ page }) => {
    await page.goto('/users');
    await page.getByLabel('Username').fill('reader');
    await page.getByLabel('Password').fill('reader-password');
    await page.getByRole('button', { name: 'Add user' }).click();

    await expect(page.getByRole('table').getByText('reader', { exact: true })).toBeVisible();
  });
});

test('a read-only user can read and star, but sees no admin tools', async ({ page }) => {
  await signIn(page, 'reader', 'reader-password');
  const nav = page.getByRole('navigation', { name: 'Feeds' });

  await expect(nav.getByRole('link', { name: 'Manage sources' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0);
  await page.getByRole('button', { name: /First & foremost/ }).click();
  await page.getByRole('button', { name: '☆ Star' }).click();
  await expect(page.getByRole('button', { name: '★ Starred' })).toBeVisible();

  await page.goto('/sources');
  await expect(page).toHaveURL(/\/$/);

  await nav.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Smart RSS' })).toBeVisible();
});
