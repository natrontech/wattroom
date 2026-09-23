import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './signin';

/**
 * The sidebar's update row (#2588): what's new and every update, one row at
 * the foot of the column. Both halves were silent before it — the release
 * notes rendered only on a Home that WattRoom no longer opens on, and a
 * deploy under an open window was noticed by nothing at all.
 */
const CHANGELOG = `# Changelog

## [Unreleased]

## [2026.09.9] - 2026-09-09

### Added

- Your crew's Workouts page shows what you rode together. Each workout opens to its sessions.

### Fixed

- Starting WattRoom opens the crew you were in again.

## [2026.09.8] - 2026-09-08

### Fixed

- Something older.
`;

/** Serve this build as `version`, with the fixture changelog above. */
async function serve(page: Page, version: () => string, asked = { n: 0 }) {
	await page.route('**/api/version', (route) => {
		asked.n += 1;
		return route.fulfill({ json: { version: version() } });
	});
	await page.route('**/changelog.md', (route) =>
		route.fulfill({ contentType: 'text/markdown', body: CHANGELOG }),
	);
}

const nav = (page: Page) =>
	page.locator('nav[aria-label="crews and channels"]');

test('an unread release is a row at the foot, and the sheet says it', async ({
	page,
}) => {
	await serve(page, () => '2026.09.9');
	// Seen the release before: this load is the first to see 2026.09.9.
	await page.addInitScript(() =>
		localStorage.setItem('wattroom.seen-version.v1', '2026.09.8'),
	);
	await signInAs(page, 'Update Row Reader', '/home');

	const row = nav(page).getByRole('button', { name: /New in WattRoom/ });
	await expect(row).toBeVisible();
	await expect(row).toContainText('2026.09.9 · 2 changes');
	// At the foot — under everything it could otherwise push down.
	const dms = nav(page).getByRole('button', { name: /direct messages/i });
	expect((await row.boundingBox())!.y).toBeGreaterThan(
		(await dms.boundingBox())!.y,
	);

	await row.click();
	const sheet = page.getByRole('dialog', { name: "What's new" });
	await expect(sheet.getByRole('heading', { name: '2026.09.9' })).toBeVisible();
	await expect(
		sheet.getByText("Your crew's Workouts page shows what you rode together."),
	).toBeVisible();
	await expect(sheet.getByText('Fixed', { exact: true })).toBeVisible();

	await sheet.getByRole('button', { name: 'Got it' }).click();
	await expect(sheet).toHaveCount(0);
	await expect(row).toHaveCount(0);
});

test('a deploy under an open window says reload', async ({ page }) => {
	let live = '2026.09.9';
	const asked = { n: 0 };
	await serve(page, () => live, asked);
	await page.addInitScript(() =>
		localStorage.setItem('wattroom.seen-version.v1', '2026.09.9'),
	);
	await signInAs(page, 'Update Row Stale', '/home');
	const row = nav(page).getByRole('button', { name: /is live/ });
	// The window has learned what it runs — the changelog's read and the
	// watch's first — before anything changes under it.
	await expect.poll(() => asked.n).toBeGreaterThanOrEqual(2);
	await page.waitForLoadState('networkidle');
	await expect(row).toHaveCount(0);

	// The deploy: the server answers with a new version, and the window hears
	// of it when it comes back to the front.
	live = '2026.09.10';
	await page.evaluate(() =>
		document.dispatchEvent(new Event('visibilitychange')),
	);
	await expect(row).toBeVisible();
	await expect(row).toContainText('2026.09.10 is live');
});
